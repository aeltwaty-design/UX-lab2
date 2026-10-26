// Slack interactivity endpoint: poll taps, "Answer" buttons, the profile form, survey forms,
// the /friction command and form, and session booking. Slack expects a reply within three seconds,
// so the slow parts (screenshot copy, DMs, refreshing the channel post) run after the reply.
import { dm, displayName, openView, SlackError, updateMessage, userInfo, verifySlack } from "../_shared/slack.ts";
import { db, fmtSlot, getParticipant, getSettings, getStudy, setSetting, type Participant, type Settings } from "../_shared/db.ts";
import { frictionModal, profileModal, sessionBookedBlocks, surveyModal, type Pending } from "../_shared/blocks.ts";
import { bookSlot, cancelBooking, processScreenshot, readFriction, recordFriction, recordPollTap, recordSurvey, thank, type SurveyValues } from "../_shared/actions.ts";
import { hasAnswered } from "../_shared/db.ts";

const ok = (body: unknown = "") =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": typeof body === "string" ? "text/plain" : "application/json" },
  });

/** Keeps a task running after the reply has gone to Slack (Supabase edge runtime). */
function after(p: Promise<unknown>) {
  const guarded = p.catch((e) => console.error("background", e));
  const rt = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(guarded);
}

interface Payload {
  type: string;
  trigger_id?: string;
  user: { id: string; name?: string };
  container?: { channel_id?: string; message_ts?: string; is_ephemeral?: boolean };
  channel?: { id: string };
  actions?: { action_id: string; value?: string; selected_option?: { value: string } }[];
  view?: { callback_id: string; private_metadata?: string; state: { values: Record<string, SurveyValues> } };
}

/** Sent instead of the form to a member whose profile is already saved: it is filled in once and is then final. */
const PROFILE_FINAL =
  "Your profile is already saved and is final, so it cannot be changed. If something in it is wrong, message the research team. · ملفك محفوظ ونهائي ولا يمكن تغييره. إن كان فيه خطأ فراسل فريق البحث.";

/** Opens the profile form for a member who has none. A member with a profile gets a note instead. */
async function openProfile(trigger_id: string, user: string, pending: Pending | null, channel: string) {
  const [settings, existing] = await Promise.all([getSettings(), getParticipant(user)]);
  if (existing) {
    await thank(channel, user, PROFILE_FINAL);
    return;
  }
  let prefill = "";
  try {
    prefill = displayName(await userInfo(user));
  } catch {
    /* users:read missing */
  }
  if (pending) await db.from("pending_actions").upsert({ slack_user_id: user, payload: pending }, { onConflict: "slack_user_id" });
  await openView(trigger_id, profileModal(settings, prefill, pending, channel));
}

/** The friction form, behind the profile gate. Falls back to a form without the screenshot field when Slack refuses it (no files:read yet). */
async function openFriction(trigger_id: string, user: string, channel: string) {
  const participant = await getParticipant(user);
  if (!participant) {
    await openProfile(trigger_id, user, { kind: "friction", study_id: "", channel }, channel);
    return;
  }
  try {
    await openView(trigger_id, frictionModal(channel, true));
    await setSetting("friction_files_ok", true);
  } catch (e) {
    if (!(e instanceof SlackError)) throw e;
    await openView(trigger_id, frictionModal(channel, false));
    await setSetting("friction_files_ok", false);
  }
}

async function finishBooking(p: Participant, studyId: string, slotId: string, channel: string, settings: Settings) {
  const r = await bookSlot(p, studyId, slotId, settings);
  if (!r.ok) {
    const why: Record<string, string> = {
      closed: "This round is closed.",
      unknown: "That slot no longer exists.",
      past: "That slot has already passed.",
      full: "That slot just filled up. Pick another one.",
      cap: `That would take you past ${r.hours ?? settings.hours_cap} hours of research that week, so it was not booked.`,
    };
    await thank(channel, p.slack_user_id, why[r.reason] ?? "Could not book that slot.");
    return;
  }
  const when = `${fmtSlot(r.slot.starts_at, r.slot.minutes)}${r.slot.place ? ` · ${r.slot.place}` : ""}`;
  if (r.same) {
    await thank(channel, p.slack_user_id, `You already have that slot: ${when}.`);
    return;
  }
  const study = await getStudy(studyId);
  await dm(p.slack_user_id, `${r.moved ? "Moved" : "Booked"}: ${study.title_en}, ${when}.`, sessionBookedBlocks(study, r.slot, r.bookingId, r.moved));
  await thank(channel, p.slack_user_id, `${r.moved ? "Moved to" : "Booked"}: ${when}. The details and a cancel button are in your DMs.`);
}

async function handleCancel(payload: Payload, bookingId: string) {
  const user = payload.user.id;
  const r = await cancelBooking(bookingId, user);
  const ch = payload.container?.channel_id;
  const ts = payload.container?.message_ts;
  if (!r.ok) {
    await thank(ch, user, "That booking is not yours or no longer exists.");
    return;
  }
  const when = r.slot ? fmtSlot(r.slot.starts_at, r.slot.minutes) : "";
  const text = `*Cancelled · أُلغي الحجز*\n${r.study?.title_en ?? ""}${when ? `, ${when}` : ""}. The slot is back in the channel.`;
  if (ch && ts) await updateMessage(ch, ts, "Booking cancelled.", [{ type: "section", text: { type: "mrkdwn", text } }]);
  else await dm(user, `Cancelled: ${when}.`);
}

async function applyPending(p: Participant, pending: Pending | null, user: string) {
  if (!pending) return;
  await db.from("pending_actions").delete().eq("slack_user_id", user);
  if (pending.kind === "poll" && pending.option_id) {
    try {
      const r = await recordPollTap(p, pending.study_id, pending.option_id);
      await thank(pending.channel, user, r.final ? `Profile saved and your answer recorded: *${r.label}*. Thank you.` : `Profile saved and your answer recorded: *${r.label}*. You can change it until ${r.closes}.`);
    } catch (e) {
      const final = (e as Error).message === "final";
      await thank(pending.channel, user, final ? "Profile saved. Your earlier answer stands; this study does not allow changes." : "Profile saved. That poll is closed now, so the answer was not recorded.");
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
  const team = v("team")?.selected_option?.value;
  if (!team) errors.team = "Pick your team.";
  const apps = (v("apps")?.selected_options ?? []).map((o) => o.value);
  if (!apps.length) errors.apps = "Tick at least one app.";
  const language = v("language")?.selected_option?.value;
  if (!language) errors.language = "Pick a language.";
  if (Object.keys(errors).length) return { errors };
  return { row: { name, age_band, gender, device, team, apps, language } };
}

Deno.serve(async (req) => {
  const raw = await req.text();
  if (!(await verifySlack(req, raw))) return new Response("bad signature", { status: 401 });
  const form = new URLSearchParams(raw);

  // Slash commands arrive as plain form fields, not as an interaction payload.
  const command = form.get("command");
  if (command) {
    const user = form.get("user_id") ?? "";
    const trigger = form.get("trigger_id") ?? "";
    const channel = form.get("channel_id") ?? "";
    try {
      if (command === "/friction" && user && trigger) await openFriction(trigger, user, channel);
    } catch (e) {
      console.error("slash", command, e);
      return ok({ response_type: "ephemeral", text: "Something went wrong on our side. Please try once more." });
    }
    return ok();
  }

  const payload = JSON.parse(form.get("payload") ?? "{}") as Payload;
  const user = payload.user?.id;
  if (!user) return ok();
  const channel = payload.container?.channel_id ?? payload.channel?.id ?? "";

  try {
    if (payload.type === "block_actions") {
      const action = payload.actions?.[0];
      if (!action) return ok();
      const [kind, a, b] = action.action_id.split(":");

      if (kind === "profile") {
        if (payload.trigger_id) await openProfile(payload.trigger_id, user, null, channel);
        return ok();
      }
      if (kind === "friction") {
        if (payload.trigger_id) await openFriction(payload.trigger_id, user, channel);
        return ok();
      }
      if (kind === "session" && a === "pick" && b) {
        const slotId = action.selected_option?.value;
        if (!slotId) return ok();
        const participant = await getParticipant(user);
        if (!participant) {
          if (payload.trigger_id) await openProfile(payload.trigger_id, user, { kind: "session", study_id: b, slot_id: slotId, channel }, channel);
          return ok();
        }
        after(finishBooking(participant, b, slotId, channel, await getSettings()));
        return ok();
      }
      if (kind === "session" && a === "cancel" && b) {
        after(handleCancel(payload, b));
        return ok();
      }

      if (!payload.trigger_id) return ok();
      const participant = await getParticipant(user);

      if (kind === "poll" && a && b) {
        if (!participant) {
          await openProfile(payload.trigger_id, user, { kind: "poll", study_id: a, option_id: b, channel }, channel);
          return ok();
        }
        try {
          const r = await recordPollTap(participant, a, b);
          await thank(channel, user, r.final ? `Recorded: *${r.label}*. Thank you. This study takes one answer per member.` : `Recorded: *${r.label}*. You can change it until ${r.closes}. Thank you.`);
        } catch (e) {
          const final = (e as Error).message === "final";
          await thank(channel, user, final ? "Your answer is already in. This study does not allow changes." : "This study is closed.");
        }
        return ok();
      }

      if (kind === "survey" && a) {
        if (!participant) {
          await openProfile(payload.trigger_id, user, { kind: "survey", study_id: a, channel }, channel);
          return ok();
        }
        const study = await getStudy(a);
        if (study.status !== "live") {
          await thank(channel, user, "This study is closed.");
          return ok();
        }
        if (study.allow_changes === false && (await hasAnswered(study.id, participant.id))) {
          await thank(channel, user, "Your answers are already in. This study does not allow changes.");
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
        const pending = meta.pending ?? null;
        // Saved once, then final: a second submission (a stale form, two windows) is refused rather than merged in.
        if (await getParticipant(user)) {
          await db.from("pending_actions").delete().eq("slack_user_id", user);
          await thank(meta.channel, user, PROFILE_FINAL);
          return ok({ response_action: "clear" });
        }
        const { data, error } = await db.from("participants").insert({ slack_user_id: user, ...r.row }).select("*").single();
        if (error) throw error;
        const p = data as Participant;
        if (pending?.kind === "survey") {
          await db.from("pending_actions").delete().eq("slack_user_id", user);
          const study = await getStudy(pending.study_id);
          if (study.status === "live") return ok({ response_action: "update", view: surveyModal(study, meta.channel ?? "") });
        }
        if (pending?.kind === "friction") {
          await db.from("pending_actions").delete().eq("slack_user_id", user);
          const settings = await getSettings();
          return ok({ response_action: "update", view: frictionModal(pending.channel ?? meta.channel ?? "", Boolean(settings.friction_files_ok)) });
        }
        if (pending?.kind === "session" && pending.slot_id) {
          await db.from("pending_actions").delete().eq("slack_user_id", user);
          after(finishBooking(p, pending.study_id, pending.slot_id, pending.channel ?? meta.channel ?? "", await getSettings()));
          return ok({ response_action: "clear" });
        }
        await applyPending(p, pending, user);
        if (!pending) await thank(meta.channel, user, `Profile saved and final. Thank you. Tap any poll or survey in ${(await getSettings()).channel_name} to answer.`);
        return ok({ response_action: "clear" });
      }

      if (payload.view.callback_id === "friction") {
        const participant = await getParticipant(user);
        if (!participant) return ok({ response_action: "errors", errors: { tried: "Fill in your profile first (tap the pinned post)." } });
        const r = readFriction(values);
        if ("errors" in r) return ok({ response_action: "errors", errors: r.errors });
        const id = await recordFriction(participant, r.input, meta.channel ?? "");
        const file = r.input.file;
        after((async () => {
          if (file) await processScreenshot(id, file);
          await thank(meta.channel, user, "Logged, thank you. The research team replies by DM · تم التسجيل، شكراً لك");
        })());
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
        } catch (e) {
          const final = (e as Error).message === "final";
          await thank(meta.channel, user, final ? "Your answers were already in, so this submission was not saved. This study does not allow changes." : "This study is closed, so the answers were not saved.");
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
