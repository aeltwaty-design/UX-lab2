// The operations behind every Slack-facing button, shared by the four functions.
import { channelMemberIds, deleteMessage, displayName, dm, listUsers, permalink, pin, postEphemeral, postMessage, slack, SlackError, sleep, updateMessage } from "./slack.ts";
import { countResponses, db, getSettings, getStudy, setSetting, snapshot, type Participant, type Settings, type Study } from "./db.ts";
import { profilePromptBlocks, resultsBlocks, studyBlocks, totalsText } from "./blocks.ts";

export interface Outcome {
  ok: boolean;
  message: string;
  [k: string]: unknown;
}

function needChannel(s: Settings): string {
  if (!s.channel_id) throw new Error("Set the Slack channel ID in Settings first.");
  return s.channel_id;
}

/** Posts the study to the channel and marks it live. Idempotent for an already-live study. */
export async function publishStudy(id: string): Promise<Outcome> {
  const [study, settings] = await Promise.all([getStudy(id), getSettings()]);
  const channel = needChannel(settings);
  if (study.status === "live") return { ok: true, message: "Already live." };
  if (study.status === "closed" || study.status === "reported") return { ok: false, message: "This study is closed." };
  if (!study.questions.length) return { ok: false, message: "The study has no questions." };

  const text = `${study.title_en}${study.title_ar ? ` · ${study.title_ar}` : ""}`;
  const r = await postMessage(channel, text, studyBlocks(study, settings));
  const { error } = await db
    .from("studies")
    .update({ status: "live", published_at: new Date().toISOString(), slack_channel_id: channel, slack_ts: r.ts })
    .eq("id", id);
  if (error) throw error;

  const asked = await askForProfiles(settings, 40);
  return { ok: true, message: `Posted to ${settings.channel_name}.${asked ? ` Profile form sent to ${asked} members without one.` : ""}` };
}

/** Closes the study: removes the buttons, writes the closing line, stamps closed_at. */
export async function closeStudy(id: string): Promise<Outcome> {
  const [study, settings] = await Promise.all([getStudy(id), getSettings()]);
  if (study.status !== "live") return { ok: false, message: "Only a live study can be closed." };
  const answered = await countResponses(id);
  if (study.slack_channel_id && study.slack_ts)
    await updateMessage(study.slack_channel_id, study.slack_ts, `${study.title_en} · closed`, studyBlocks(study, settings, true, answered));
  const { error } = await db.from("studies").update({ status: "closed", closed_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
  return { ok: true, message: `Closed with ${answered} answers. Write the results post next.` };
}

/** Members in the study's audience who have a profile but no answer yet. */
async function nonResponders(study: Study): Promise<Participant[]> {
  const { data: people, error } = await db.from("participants").select("*").is("deleted_at", null);
  if (error) throw error;
  const { data: done, error: e2 } = await db.from("responses").select("participant_id").eq("study_id", study.id);
  if (e2) throw e2;
  const answered = new Set((done ?? []).map((r: { participant_id: string }) => r.participant_id));
  return ((people ?? []) as Participant[]).filter((p) => {
    if (answered.has(p.id)) return false;
    if (study.audience === "teams") return Boolean(p.team && study.audience_teams.includes(p.team));
    return true;
  });
}

/** DMs everyone in the audience who has not answered. */
export async function remindStudy(id: string): Promise<Outcome> {
  const [study, settings] = await Promise.all([getStudy(id), getSettings()]);
  if (study.status !== "live") return { ok: false, message: "Only a live study can be reminded." };
  const people = await nonResponders(study);
  const link = study.slack_channel_id && study.slack_ts ? await permalink(study.slack_channel_id, study.slack_ts) : "";
  let sent = 0;
  for (const p of people) {
    const ar = p.language === "ar";
    const text = ar
      ? `تذكير لطيف: لم تُجب بعد على "${study.title_ar || study.title_en}" في ${settings.channel_name}. تُغلق ${fmt(study.close_at)}. ${link}`
      : `A gentle reminder: you have not answered "${study.title_en}" in ${settings.channel_name} yet. It closes ${fmt(study.close_at)}. ${link}`;
    try {
      await dm(p.slack_user_id, text);
      sent++;
      await sleep(60);
    } catch {
      /* a member who left the workspace */
    }
  }
  const { error } = await db.from("studies").update({ reminder_sent_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
  return { ok: true, message: `Reminded ${sent} of ${people.length} by DM.` };
}

/** Posts the results post to the channel and marks the study reported. */
export async function postResults(id: string): Promise<Outcome> {
  const [study, settings] = await Promise.all([getStudy(id), getSettings()]);
  const channel = needChannel(settings);
  if (study.status !== "closed") return { ok: false, message: study.status === "reported" ? "Already posted." : "Close the study before posting results." };
  const { data: post, error } = await db.from("results_posts").select("*").eq("study_id", id).maybeSingle();
  if (error) throw error;
  if (!post || !post.body_en?.trim()) return { ok: false, message: "Write the results post first." };

  const { data: responses, error: e2 } = await db.from("responses").select("id, answers(question_id, option_id, value_num)").eq("study_id", id);
  if (e2) throw e2;
  const rows = (responses ?? []) as { answers: { question_id: string; option_id: string | null; value_num: number | null }[] }[];
  const totals = post.include_totals ? totalsText(study, rows, settings.small_group) : null;
  const r = await postMessage(channel, `Results: ${study.title_en}`, resultsBlocks(study, post.body_en, post.body_ar, totals, rows.length, settings.small_group));
  const now = new Date().toISOString();
  const u1 = await db.from("results_posts").update({ posted_at: now, slack_ts: r.ts }).eq("study_id", id);
  if (u1.error) throw u1.error;
  const u2 = await db.from("studies").update({ status: "reported" }).eq("id", id);
  if (u2.error) throw u2.error;
  return { ok: true, message: `Results posted to ${settings.channel_name}. Study marked reported.` };
}

/** Pulls the channel roster from Slack into channel_members. */
export async function syncMembers(): Promise<Outcome> {
  const settings = await getSettings();
  const channel = needChannel(settings);
  const [ids, users] = await Promise.all([channelMemberIds(channel), listUsers()]);
  const byId = new Map(users.map((u) => [u.id, u]));
  const humans = ids.filter((id) => {
    const u = byId.get(id);
    return u && !u.is_bot && !u.deleted && id !== "USLACKBOT";
  });
  const rows = humans.map((id) => ({ slack_user_id: id, name: displayName(byId.get(id)!), is_active: true, left_at: null }));
  if (rows.length) {
    const { error } = await db.from("channel_members").upsert(rows, { onConflict: "slack_user_id" });
    if (error) throw error;
  }
  const { data: known, error: e2 } = await db.from("channel_members").select("slack_user_id").eq("is_active", true);
  if (e2) throw e2;
  const present = new Set(humans);
  const gone = ((known ?? []) as { slack_user_id: string }[]).map((r) => r.slack_user_id).filter((id) => !present.has(id));
  if (gone.length) {
    const { error } = await db.from("channel_members").update({ is_active: false, left_at: new Date().toISOString() }).in("slack_user_id", gone);
    if (error) throw error;
  }
  await setSetting("members_synced_at", new Date().toISOString());
  return { ok: true, message: `${humans.length} members in the channel, ${gone.length} marked as left.`, members: humans.length };
}

/** Upserts one member who just joined, by Slack id. */
export async function memberJoined(slackUserId: string, name: string) {
  const { error } = await db
    .from("channel_members")
    .upsert({ slack_user_id: slackUserId, name, is_active: true, left_at: null, joined_at: new Date().toISOString() }, { onConflict: "slack_user_id" });
  if (error) throw error;
}

export async function memberLeft(slackUserId: string) {
  await db.from("channel_members").update({ is_active: false, left_at: new Date().toISOString() }).eq("slack_user_id", slackUserId);
}

/** DMs the profile form to active members without a profile, at most `limit` per call, not more than once a week each. */
export async function askForProfiles(settings: Settings, limit = 50): Promise<number> {
  const { data: members, error } = await db.from("channel_members").select("slack_user_id, profile_asked_at").eq("is_active", true);
  if (error) throw error;
  const { data: people, error: e2 } = await db.from("participants").select("slack_user_id").is("deleted_at", null);
  if (e2) throw e2;
  const has = new Set((people ?? []).map((p: { slack_user_id: string }) => p.slack_user_id));
  const weekAgo = Date.now() - 7 * 86_400_000;
  const due = ((members ?? []) as { slack_user_id: string; profile_asked_at: string | null }[]).filter(
    (m) => !has.has(m.slack_user_id) && (!m.profile_asked_at || new Date(m.profile_asked_at).getTime() < weekAgo),
  );
  let sent = 0;
  for (const m of due.slice(0, limit)) {
    try {
      await dm(m.slack_user_id, `Before your first answer in ${settings.channel_name}, fill in a short profile.`, profilePromptBlocks(settings));
      await db.from("channel_members").update({ profile_asked_at: new Date().toISOString() }).eq("slack_user_id", m.slack_user_id);
      sent++;
      await sleep(60);
    } catch {
      /* member cannot be messaged */
    }
  }
  return sent;
}

export async function remindMissingProfiles(): Promise<Outcome> {
  const settings = await getSettings();
  needChannel(settings);
  // Force a fresh ask for everyone without a profile.
  await db.from("channel_members").update({ profile_asked_at: null }).eq("is_active", true);
  const sent = await askForProfiles(settings, 150);
  return { ok: true, message: `Profile form sent by DM to ${sent} members.` };
}

/** Posts (and pins) the profile prompt in the channel, after removing the previous one. */
export async function repostProfile(): Promise<Outcome> {
  const settings = await getSettings();
  const channel = needChannel(settings);
  const old = [settings.profile_post_ts, ...(settings.profile_posts_old ?? [])].filter((ts): ts is string => Boolean(ts));
  let removed = 0;
  for (const ts of old) if (await deleteMessage(channel, ts)) removed++;
  const r = await postMessage(channel, "Fill in your research profile · عبّئ ملفك", profilePromptBlocks(settings));
  await pin(channel, r.ts);
  await setSetting("profile_post_ts", r.ts);
  if (settings.profile_posts_old?.length) await setSetting("profile_posts_old", []);
  const note = removed ? ` Removed ${removed} older post${removed === 1 ? "" : "s"}.` : "";
  return { ok: true, message: `Profile form posted and pinned in ${settings.channel_name}.${note}` };
}

/** Deletes one of the bot's own posts, given a Slack message link (or a bare message ts in the channel). */
export async function deletePost(link: string): Promise<Outcome> {
  const settings = await getSettings();
  const m = link.trim().match(/archives\/([A-Z0-9]+)\/p(\d{10})(\d{6})/i);
  const channel = m ? m[1] : settings.channel_id;
  const ts = m ? `${m[2]}.${m[3]}` : link.trim();
  if (!channel || !/^\d{10}\.\d{6}$/.test(ts)) return { ok: false, message: "Paste the message link (in Slack: More actions, then Copy link)." };
  try {
    await slack("pins.remove", { channel, timestamp: ts });
  } catch {
    /* was not pinned */
  }
  try {
    await slack("chat.delete", { channel, ts });
  } catch (e) {
    const code = e instanceof SlackError ? e.code : (e as Error).message;
    const why: Record<string, string> = {
      cant_delete_message: "the bot can only delete its own posts",
      message_not_found: "no such post, maybe already deleted",
      channel_not_found: "the bot is not in that channel",
    };
    return { ok: false, message: `Not deleted: ${why[code] ?? code}.` };
  }
  if (ts === settings.profile_post_ts) await setSetting("profile_post_ts", "");
  return { ok: true, message: "Post deleted." };
}

export async function testSlack(): Promise<Outcome> {
  const settings = await getSettings();
  try {
    const r = await slack<{ team: string; user: string }>("auth.test", {});
    const extra = settings.channel_id ? ` Channel ${settings.channel_id} set.` : " Channel ID not set yet.";
    return { ok: true, message: `Connected to ${r.team} as ${r.user}.${extra}` };
  } catch (e) {
    return { ok: false, message: `Slack refused: ${(e as Error).message}. Check SLACK_BOT_TOKEN.` };
  }
}

// ---------- answers ----------

export async function recordPollTap(p: Participant, studyId: string, optionId: string): Promise<{ label: string; closes: string }> {
  const study = await getStudy(studyId);
  if (study.status !== "live") throw new Error("closed");
  const q = study.questions[0];
  const opt = q?.options.find((o) => o.id === optionId);
  if (!q || !opt) throw new Error("unknown option");
  const { data: resp, error } = await db
    .from("responses")
    .upsert({ study_id: studyId, participant_id: p.id, profile: snapshot(p), submitted_at: new Date().toISOString() }, { onConflict: "study_id,participant_id" })
    .select("id")
    .single();
  if (error) throw error;
  const rid = (resp as { id: string }).id;
  await db.from("answers").delete().eq("response_id", rid).eq("question_id", q.id);
  const ins = await db.from("answers").insert({ response_id: rid, question_id: q.id, option_id: opt.id });
  if (ins.error) throw ins.error;
  return { label: opt.label_en, closes: fmt(study.close_at) };
}

export type SurveyValues = Record<string, { type: string; value?: string; selected_option?: { value: string }; selected_options?: { value: string }[] }>;

export async function recordSurvey(p: Participant, studyId: string, values: Record<string, SurveyValues>): Promise<Record<string, string> | null> {
  const study = await getStudy(studyId);
  if (study.status !== "live") throw new Error("closed");
  const errors: Record<string, string> = {};
  const rows: { question_id: string; option_id?: string; value_text?: string; value_num?: number }[] = [];
  for (const q of study.questions) {
    const v = values[q.id]?.v;
    if (!v) continue;
    if (q.kind === "single") {
      if (v.selected_option) rows.push({ question_id: q.id, option_id: v.selected_option.value });
    } else if (q.kind === "multi") {
      for (const o of v.selected_options ?? []) rows.push({ question_id: q.id, option_id: o.value });
    } else if (q.kind === "scale" || q.kind === "yesno") {
      if (v.selected_option) rows.push({ question_id: q.id, value_num: Number(v.selected_option.value) });
    } else if (q.kind === "text") {
      const t = (v.value ?? "").trim();
      if (t) {
        if (/\b(pin|otp|password|cvv|iban)\b/i.test(t) && /\d{4,}/.test(t)) errors[q.id] = "Please do not type a PIN, OTP or password.";
        rows.push({ question_id: q.id, value_text: t.slice(0, 500) });
      }
    }
    if (q.required && !rows.some((r) => r.question_id === q.id)) errors[q.id] = "Please answer this one.";
  }
  if (Object.keys(errors).length) return errors;

  const { data: resp, error } = await db
    .from("responses")
    .upsert({ study_id: studyId, participant_id: p.id, profile: snapshot(p), submitted_at: new Date().toISOString() }, { onConflict: "study_id,participant_id" })
    .select("id")
    .single();
  if (error) throw error;
  const rid = (resp as { id: string }).id;
  await db.from("answers").delete().eq("response_id", rid);
  const ins = await db.from("answers").insert(rows.map((r) => ({ ...r, response_id: rid })));
  if (ins.error) throw ins.error;
  return null;
}

export async function thank(channel: string | undefined, user: string, text: string) {
  try {
    if (channel && channel.startsWith("C")) await postEphemeral(channel, user, text);
    else await dm(user, text);
  } catch {
    /* ignore */
  }
}

function fmt(iso: string | null): string {
  if (!iso) return "soon";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Riyadh" });
}
