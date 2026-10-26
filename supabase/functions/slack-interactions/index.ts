// Slack interactivity endpoint: poll taps, "Answer" buttons, the profile form and survey forms.
// Slack expects a reply within three seconds, so each branch does one small piece of work.
import { openView, userInfo, displayName, verifySlack } from "../_shared/slack.ts";
import { db, getParticipant, getSettings, getStudy, type Participant } from "../_shared/db.ts";
import { profileModal, surveyModal, type Pending } from "../_shared/blocks.ts";
import { recordPollTap, recordSurvey, thank, type SurveyValues } from "../_shared/actions.ts";

const ok = (body: unknown = "") =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": typeof body === "string" ? "text/plain" : "application/json" },
  });

interface Payload {
  type: string;
  trigger_id?: string;
  user: { id: string; name?: string };
  container?: { channel_id?: string };
  channel?: { id: string };
  actions?: { action_id: string; value?: string }[];
  view?: { callback_id: string; private_metadata?: string; state: { values: Record<string, SurveyValues> } };
}

async function openProfile(trigger_id: string, user: string, pending: Pending | null, channel: string) {
  const [settings, existing] = await Promise.all([getSettings(), getParticipant(user)]);
  let prefill = "";
  if (!existing) {
    try {
      prefill = displayName(await userInfo(user));
    } catch {
      /* users:read missing */
    }
  }
  if (pending) await db.from("pending_actions").upsert({ slack_user_id: user, payload: pending }, { onConflict: "slack_user_id" });
  await openView(trigger_id, profileModal(settings, prefill, existing, pending, channel));
}

async function applyPending(p: Participant, pending: Pending | null, user: string) {
  if (!pending) return;
  await db.from("pending_actions").delete().eq("slack_user_id", user);
  if (pending.kind === "poll" && pending.option_id) {
    try {
      const r = await recordPollTap(p, pending.study_id, pending.option_id);
      await thank(pending.channel, user, `Profile saved and your answer recorded: *${r.label}*. You can change it until ${r.closes}.`);
    } catch {
      await thank(pending.channel, user, "Profile saved. That poll is closed now, so the answer was not recorded.");
    }
  }
}

function readProfile(values: Record<string, SurveyValues>) {
  const v = (b: string) => values[b]?.v;
  const errors: Record<string, string> = {};
  const name = (v("name")?.value ?? "").trim();
  if (name.length < 2) errors.name = "Please write your name.";
  const age_band = v("age_band")?.selected_option?.value;
  if (!age_band) errors.age_band = "Pick your age band.";
  const gender = v("gender")?.selected_option?.value;
  if (!gender) errors.gender = "Pick one.";
  const device = v("device")?.selected_option?.value;
  if (!device) errors.device = "Pick your phone type.";
  if (Object.keys(errors).length) return { errors };
  return {
    row: {
      name,
      age_band,
      gender,
      device,
      team: v("team")?.selected_option?.value ?? null,
      apps: (v("apps")?.selected_options ?? []).map((o) => o.value),
      language: v("language")?.selected_option?.value ?? "en",
      sessions_ok: (v("sessions_ok")?.selected_options ?? []).length > 0,
    },
  };
}

Deno.serve(async (req) => {
  const raw = await req.text();
  if (!(await verifySlack(req, raw))) return new Response("bad signature", { status: 401 });
  const payload = JSON.parse(new URLSearchParams(raw).get("payload") ?? "{}") as Payload;
  const user = payload.user?.id;
  if (!user) return ok();
  const channel = payload.container?.channel_id ?? payload.channel?.id ?? "";

  try {
    if (payload.type === "block_actions") {
      const action = payload.actions?.[0];
      if (!action || !payload.trigger_id) return ok();
      const [kind, studyId, optionId] = action.action_id.split(":");

      if (kind === "profile") {
        await openProfile(payload.trigger_id, user, null, channel);
        return ok();
      }

      const participant = await getParticipant(user);

      if (kind === "poll" && studyId && optionId) {
        if (!participant) {
          await openProfile(payload.trigger_id, user, { kind: "poll", study_id: studyId, option_id: optionId, channel }, channel);
          return ok();
        }
        try {
          const r = await recordPollTap(participant, studyId, optionId);
          await thank(channel, user, `Recorded: *${r.label}*. You can change it until ${r.closes}. Thank you.`);
        } catch {
          await thank(channel, user, "This study is closed.");
        }
        return ok();
      }

      if (kind === "survey" && studyId) {
        if (!participant) {
          await openProfile(payload.trigger_id, user, { kind: "survey", study_id: studyId, channel }, channel);
          return ok();
        }
        const study = await getStudy(studyId);
        if (study.status !== "live") {
          await thank(channel, user, "This study is closed.");
          return ok();
        }
        await openView(payload.trigger_id, surveyModal(study, channel));
        return ok();
      }
      return ok();
    }

    if (payload.type === "view_submission" && payload.view) {
      const meta = JSON.parse(payload.view.private_metadata || "{}") as { pending?: Pending | null; channel?: string };
      const values = payload.view.state.values;

      if (payload.view.callback_id === "profile") {
        const r = readProfile(values);
        if ("errors" in r) return ok({ response_action: "errors", errors: r.errors });
        const { data, error } = await db
          .from("participants")
          .upsert({ slack_user_id: user, ...r.row, deleted_at: null }, { onConflict: "slack_user_id" })
          .select("*")
          .single();
        if (error) throw error;
        const p = data as Participant;
        const pending = meta.pending ?? null;
        if (pending?.kind === "survey") {
          await db.from("pending_actions").delete().eq("slack_user_id", user);
          const study = await getStudy(pending.study_id);
          if (study.status === "live") return ok({ response_action: "update", view: surveyModal(study, meta.channel ?? "") });
        }
        await applyPending(p, pending, user);
        if (!pending) await thank(meta.channel, user, `Profile saved. Thank you. Tap any poll or survey in ${(await getSettings()).channel_name} to answer.`);
        return ok({ response_action: "clear" });
      }

      if (payload.view.callback_id.startsWith("survey:")) {
        const studyId = payload.view.callback_id.slice(7);
        const participant = await getParticipant(user);
        if (!participant) return ok({ response_action: "errors", errors: {} });
        try {
          const errors = await recordSurvey(participant, studyId, values);
          if (errors) return ok({ response_action: "errors", errors });
          await thank(meta.channel, user, "Answers saved. Thank you. Results come back to the channel after it closes.");
        } catch {
          await thank(meta.channel, user, "This study is closed, so the answers were not saved.");
        }
        return ok({ response_action: "clear" });
      }
    }
  } catch (e) {
    console.error("slack-interactions", e);
    await thank(channel, user, "Something went wrong on our side. Please try once more.");
  }
  return ok();
});
