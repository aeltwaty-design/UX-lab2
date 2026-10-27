// The operations behind every Slack-facing button, shared by the four functions.
import { channelMemberIds, deleteMessage, displayName, dm, downloadFile, listUsers, permalink, pin, postEphemeral, postMessage, slack, SlackError, sleep, updateMessage, userInfo } from "./slack.ts";
import { countResponses, db, fmtSlot, getSettings, getSlots, getStudy, hasAnswered, riyadh, setSetting, snapshot, weekKey, type Participant, type Settings, type SlotWithBookings, type Study } from "./db.ts";
import { frictionDigestBlocks, frictionPromptBlocks, profilePromptBlocks, resultsBlocks, studyBlocks, totalsText, type SlotCalendar } from "./blocks.ts";
import { deleteStudyEvents, syncSlotEvent, syncStudyEvents } from "./google.ts";

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
  let slots: SlotWithBookings[] = [];
  if (study.type === "session_recruitment") {
    slots = await getSlots(id);
    if (!slots.length) return { ok: false, message: "Add at least one slot." };
  } else if (study.type === "preference_test") {
    const images = study.questions[0]?.options.filter((o) => o.image_url) ?? [];
    if (images.length < 2) return { ok: false, message: "A preference test needs at least two images." };
  } else if (!study.questions.length) return { ok: false, message: "The study has no questions." };

  const text = `${study.title_en}${study.title_ar ? ` · ${study.title_ar}` : ""}`;
  const r = await postMessage(channel, text, studyBlocks(study, settings, false, 0, slots));
  const { error } = await db
    .from("studies")
    .update({ status: "live", published_at: new Date().toISOString(), slack_channel_id: channel, slack_ts: r.ts })
    .eq("id", id);
  if (error) throw error;

  const asked = await askForProfiles(settings, 40);
  return { ok: true, message: `Posted to ${settings.channel_name}.${asked ? ` Profile form sent to ${asked} members without one.` : ""}` };
}

/** Closes the study: removes the controls, writes the closing line, stamps closed_at. */
export async function closeStudy(id: string): Promise<Outcome> {
  const [study, settings] = await Promise.all([getStudy(id), getSettings()]);
  if (study.status !== "live") return { ok: false, message: "Only a live study can be closed." };
  const sessions = study.type === "session_recruitment";
  const slots = sessions ? await getSlots(id) : [];
  const answered = sessions ? slots.reduce((n, s) => n + s.booked, 0) : await countResponses(id);
  if (study.slack_channel_id && study.slack_ts)
    await updateMessage(study.slack_channel_id, study.slack_ts, `${study.title_en} · closed`, studyBlocks(study, settings, true, answered, slots));
  const { error } = await db.from("studies").update({ status: "closed", closed_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
  return { ok: true, message: `Closed with ${answered} ${sessions ? "bookings" : "answers"}. Write the results post next.` };
}

/** Members in the study's audience who have a profile but no answer (or booking) yet. */
async function nonResponders(study: Study): Promise<Participant[]> {
  const { data: people, error } = await db.from("participants").select("*").is("deleted_at", null);
  if (error) throw error;
  const done =
    study.type === "session_recruitment"
      ? await db.from("session_bookings").select("participant_id").eq("study_id", study.id).is("cancelled_at", null)
      : await db.from("responses").select("participant_id").eq("study_id", study.id);
  if (done.error) throw done.error;
  const answered = new Set((done.data ?? []).map((r: { participant_id: string }) => r.participant_id));
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
  const sessions = study.type === "session_recruitment";
  let sent = 0;
  for (const p of people) {
    const ar = p.language === "ar";
    const text = ar
      ? `تذكير لطيف: ${sessions ? "لم تحجز موعداً بعد في" : "لم تُجب بعد على"} "${study.title_ar || study.title_en}" في ${settings.channel_name}. تُغلق ${fmt(study.close_at)}. ${link}`
      : `A gentle reminder: you have not ${sessions ? "booked a slot for" : "answered"} "${study.title_en}" in ${settings.channel_name} yet. It closes ${fmt(study.close_at)}. ${link}`;
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
  const answered = study.type === "session_recruitment" ? (await getSlots(id)).reduce((n, s) => n + s.booked, 0) : rows.length;
  const r = await postMessage(channel, `Results: ${study.title_en}`, resultsBlocks(study, post.body_en, post.body_ar, totals, answered, settings.small_group));
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
  if (ts === settings.friction_post_ts) await setSetting("friction_post_ts", "");
  return { ok: true, message: "Post deleted." };
}

/**
 * Removes a draft, scheduled, closed or reported study with everything hanging off it (answers, bookings, slots,
 * results post row, preference images and their side-by-side picture) and, when asked, the bot's posts for it in the channel.
 * A live study must be closed first; the database refuses the delete as well.
 */
export async function deleteStudy(id: string, removePosts: boolean): Promise<Outcome> {
  const [study, settings] = await Promise.all([getStudy(id), getSettings()]);
  if (study.status === "live") return { ok: false, message: "Close the study before deleting it." };
  const notes: string[] = [];
  if (removePosts) {
    let removed = 0;
    if (study.slack_channel_id && study.slack_ts && (await deleteMessage(study.slack_channel_id, study.slack_ts))) removed++;
    const { data: post, error } = await db.from("results_posts").select("slack_ts").eq("study_id", id).maybeSingle();
    if (error) throw error;
    const resultsTs = (post as { slack_ts: string | null } | null)?.slack_ts;
    if (resultsTs && settings.channel_id && (await deleteMessage(settings.channel_id, resultsTs))) removed++;
    notes.push(removed ? `${removed} post${removed === 1 ? "" : "s"} removed from ${settings.channel_name}` : "no posts to remove");
  }
  await deleteStudyEvents(id);
  const images = [...study.questions.flatMap((q) => q.options.map((o) => o.image_url ?? "")), study.compare_url ?? ""]
    .map((u) => u.split("/study-images/")[1] ?? "")
    .filter(Boolean);
  if (images.length) {
    const { error } = await db.storage.from("study-images").remove(images);
    if (error) console.error("delete images", error);
  }
  const { error } = await db.from("studies").delete().eq("id", id);
  if (error) throw error;
  return { ok: true, message: `Study deleted${notes.length ? ` (${notes.join(", ")})` : ""}.` };
}

/** Re-renders the study's channel post after an edit in the dashboard. Closed and reported studies keep their closed state. */
export async function refreshStudyPost(id: string): Promise<Outcome> {
  const [study, settings] = await Promise.all([getStudy(id), getSettings()]);
  if (!study.slack_channel_id || !study.slack_ts) return { ok: true, message: "Saved." };
  const sessions = study.type === "session_recruitment";
  const closed = study.status !== "live";
  const slots = sessions ? await getSlots(id) : [];
  // Booked slots carry a calendar event: a changed place, intro or Meet switch reaches the guests.
  if (sessions) await syncStudyEvents(study, settings, slots);
  const answered = closed ? (sessions ? slots.reduce((n, s) => n + s.booked, 0) : await countResponses(id)) : 0;
  const text = closed ? `${study.title_en} · closed` : `${study.title_en}${study.title_ar ? ` · ${study.title_ar}` : ""}`;
  try {
    await updateMessage(study.slack_channel_id, study.slack_ts, text, studyBlocks(study, settings, closed, answered, slots));
  } catch (e) {
    const code = e instanceof SlackError ? e.code : (e as Error).message;
    return { ok: false, message: `Saved, but the post in ${settings.channel_name} was not updated (${code}).` };
  }
  return { ok: true, message: `Saved. The post in ${settings.channel_name} is updated.` };
}

export async function testSlack(): Promise<Outcome> {
  const settings = await getSettings();
  try {
    const r = await slack<{ team: string; user: string; user_id: string }>("auth.test", {});
    // The handle (r.user) is fixed at first install; the display name is what members see.
    let who = `@${r.user}`;
    try {
      who = `${displayName(await userInfo(r.user_id))} (@${r.user})`;
    } catch {
      /* users:read missing */
    }
    const extra = settings.channel_id ? ` Channel ${settings.channel_id} set.` : " Channel ID not set yet.";
    return { ok: true, message: `Connected to ${r.team} as ${who}.${extra}` };
  } catch (e) {
    return { ok: false, message: `Slack refused: ${(e as Error).message}. Check SLACK_BOT_TOKEN.` };
  }
}

// ---------- answers ----------

/** Records a poll or preference-test tap. Throws "closed" after close, and "final" when the study takes one answer and the member already gave it. */
export async function recordPollTap(p: Participant, studyId: string, optionId: string): Promise<{ label: string; closes: string; final: boolean }> {
  const study = await getStudy(studyId);
  if (study.status !== "live") throw new Error("closed");
  if (study.allow_changes === false && (await hasAnswered(studyId, p.id))) throw new Error("final");
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
  return { label: opt.label_en, closes: fmt(study.close_at), final: study.allow_changes === false };
}

export interface SlackFile { id: string; name?: string; mimetype?: string; url_private?: string; url_private_download?: string; permalink?: string }

export type SurveyValues = Record<string, { type: string; value?: string; selected_option?: { value: string }; selected_options?: { value: string }[]; files?: SlackFile[] }>;

/** Saves a survey submission. Throws "closed" after close, and "final" when the study takes one answer and the member already answered. */
export async function recordSurvey(p: Participant, studyId: string, values: Record<string, SurveyValues>): Promise<Record<string, string> | null> {
  const study = await getStudy(studyId);
  if (study.status !== "live") throw new Error("closed");
  if (study.allow_changes === false && (await hasAnswered(studyId, p.id))) throw new Error("final");
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

/** A short confirmation: ephemeral in the channel when the bot is there, otherwise by DM. */
export async function thank(channel: string | undefined, user: string, text: string) {
  try {
    if (channel && channel.startsWith("C")) {
      try {
        await postEphemeral(channel, user, text);
        return;
      } catch {
        /* the bot is not in that channel */
      }
    }
    await dm(user, text);
  } catch {
    /* ignore */
  }
}

// ---------- session recruitment ----------

/** Re-renders the channel post so full slots are struck through and the picker only offers free ones. */
export async function refreshSessionPost(study: Study, settings: Settings, closed = false) {
  if (!study.slack_channel_id || !study.slack_ts) return;
  const slots = await getSlots(study.id);
  const booked = slots.reduce((n, s) => n + s.booked, 0);
  await updateMessage(study.slack_channel_id, study.slack_ts, `${study.title_en}${closed ? " · closed" : ""}`, studyBlocks(study, settings, closed, booked, slots));
}

export type BookResult =
  | { ok: true; slot: SlotWithBookings; bookingId: string; moved: boolean; same: boolean; fromSlotId: string | null }
  | { ok: false; reason: "closed" | "unknown" | "past" | "full" | "cap"; hours?: number };

/** Books a slot for a member: one active booking per study, moving it when they pick again, within the weekly hours cap. */
export async function bookSlot(p: Participant, studyId: string, slotId: string, settings: Settings): Promise<BookResult> {
  const study = await getStudy(studyId);
  if (study.status !== "live") return { ok: false, reason: "closed" };
  const slots = await getSlots(studyId);
  const slot = slots.find((s) => s.id === slotId);
  if (!slot) return { ok: false, reason: "unknown" };
  if (new Date(slot.starts_at).getTime() < Date.now()) return { ok: false, reason: "past" };

  const { data: mine, error } = await db.from("session_bookings").select("id, slot_id").eq("study_id", studyId).eq("participant_id", p.id).is("cancelled_at", null).maybeSingle();
  if (error) throw error;
  const current = mine as { id: string; slot_id: string } | null;
  if (current?.slot_id === slotId) return { ok: true, slot, bookingId: current.id, moved: false, same: true, fromSlotId: null };
  if (slot.booked >= slot.capacity) return { ok: false, reason: "full" };

  // The weekly hours cap, counted on the Riyadh week the slot falls in.
  const { data: others, error: e2 } = await db.from("session_bookings").select("id, slot:session_slots(starts_at, minutes)").eq("participant_id", p.id).is("cancelled_at", null);
  if (e2) throw e2;
  const week = weekKey(slot.starts_at);
  let minutes = slot.minutes;
  for (const b of (others ?? []) as unknown as { id: string; slot: { starts_at: string; minutes: number } | null }[])
    if (b.id !== current?.id && b.slot && weekKey(b.slot.starts_at) === week) minutes += b.slot.minutes;
  if (minutes > settings.hours_cap * 60) return { ok: false, reason: "cap", hours: settings.hours_cap };

  if (current) {
    const u = await db.from("session_bookings").update({ cancelled_at: new Date().toISOString() }).eq("id", current.id);
    if (u.error) throw u.error;
  }
  const { data: ins, error: e3 } = await db
    .from("session_bookings")
    .insert({ slot_id: slotId, study_id: studyId, participant_id: p.id, profile: snapshot(p) })
    .select("id")
    .single();
  if (e3) throw e3;
  await refreshSessionPost(study, settings);
  return { ok: true, slot: { ...slot, booked: slot.booked + 1 }, bookingId: (ins as { id: string }).id, moved: Boolean(current), same: false, fromSlotId: current?.slot_id ?? null };
}

/** Mirrors a new booking (and the slot it moved from) into Google Calendar, and says what the DM should show. */
export async function sessionCalendar(study: Study, settings: Settings, slotId: string, fromSlotId: string | null, slackUserId: string): Promise<SlotCalendar> {
  if (fromSlotId && fromSlotId !== slotId) await syncSlotEvent(study, fromSlotId, settings);
  const r = await syncSlotEvent(study, slotId, settings);
  return { meet_url: r.meet_url, invited: r.invited.includes(slackUserId) };
}

/** Cancels a booking from its DM button. Only the member who booked can cancel. */
export async function cancelBooking(bookingId: string, slackUserId: string): Promise<{ ok: boolean; study?: Study; slot?: SlotWithBookings }> {
  const { data, error } = await db
    .from("session_bookings")
    .select("id, study_id, slot_id, cancelled_at, participant:participants(slack_user_id)")
    .eq("id", bookingId)
    .maybeSingle();
  if (error) throw error;
  const b = data as { id: string; study_id: string; slot_id: string; cancelled_at: string | null; participant: { slack_user_id: string } | null } | null;
  if (!b || b.participant?.slack_user_id !== slackUserId) return { ok: false };
  if (!b.cancelled_at) {
    const u = await db.from("session_bookings").update({ cancelled_at: new Date().toISOString() }).eq("id", b.id);
    if (u.error) throw u.error;
  }
  const [study, settings] = await Promise.all([getStudy(b.study_id), getSettings()]);
  if (study.status === "live") await refreshSessionPost(study, settings);
  await syncSlotEvent(study, b.slot_id, settings);
  const slot = (await getSlots(b.study_id)).find((s) => s.id === b.slot_id);
  return { ok: true, study, slot };
}

/** DMs everyone whose session starts within the next day. Once per booking. */
export async function sessionReminders(): Promise<Outcome> {
  const { data, error } = await db
    .from("session_bookings")
    .select("id, participant:participants(slack_user_id, language, deleted_at), slot:session_slots(starts_at, minutes, place, meet_url), study:studies(title_en, title_ar)")
    .is("cancelled_at", null)
    .is("reminded_at", null);
  if (error) throw error;
  type Row = {
    id: string;
    participant: { slack_user_id: string; language: string; deleted_at: string | null } | null;
    slot: { starts_at: string; minutes: number; place: string; meet_url: string | null } | null;
    study: { title_en: string; title_ar: string } | null;
  };
  const now = Date.now();
  let sent = 0;
  for (const b of (data ?? []) as unknown as Row[]) {
    if (!b.slot || !b.participant || b.participant.deleted_at) continue;
    const t = new Date(b.slot.starts_at).getTime();
    if (t < now || t > now + 24 * 3600_000) continue;
    const when = `${fmtSlot(b.slot.starts_at, b.slot.minutes)}${b.slot.place ? ` · ${b.slot.place}` : ""}`;
    const meet = b.slot.meet_url;
    const text = b.participant.language === "ar"
      ? `تذكير: جلسة "${b.study?.title_ar || b.study?.title_en || ""}" ${when}.${meet ? ` رابط Google Meet: ${meet}` : ""} إن لم تستطع الحضور، ألغِ الحجز من رسالة التأكيد.`
      : `Reminder: your session "${b.study?.title_en ?? ""}" is ${when}.${meet ? ` Google Meet: ${meet}` : ""} If you cannot make it, cancel from the booking message.`;
    try {
      await dm(b.participant.slack_user_id, text);
      sent++;
      await sleep(60);
    } catch {
      /* left the workspace */
    }
    await db.from("session_bookings").update({ reminded_at: new Date().toISOString() }).eq("id", b.id);
  }
  return { ok: true, message: `${sent} session reminder${sent === 1 ? "" : "s"} sent.` };
}

// ---------- friction inbox ----------

export interface FrictionInput { app: string; tried: string; happened: string; file: SlackFile | null }

/** Validates the friction form. Returns block errors or the clean input. */
export function readFriction(values: Record<string, SurveyValues>): { errors: Record<string, string> } | { input: FrictionInput } {
  const v = (b: string) => values[b]?.v;
  const errors: Record<string, string> = {};
  const app = v("app")?.selected_option?.value ?? "";
  if (!app) errors.app = "Pick the app.";
  const tried = (v("tried")?.value ?? "").trim();
  if (tried.length < 3) errors.tried = "Say what you tried to do.";
  const happened = (v("happened")?.value ?? "").trim();
  if (happened.length < 3) errors.happened = "Say what happened.";
  if ([tried, happened].some((t) => /\b(pin|otp|password|cvv|iban)\b/i.test(t) && /\d{4,}/.test(t))) errors.happened = "Please do not type a PIN, OTP or password.";
  if (Object.keys(errors).length) return { errors };
  const file = (v("shot")?.files ?? [])[0] ?? null;
  return { input: { app, tried, happened, file } };
}

/** Stores the report and returns its id. The screenshot is copied afterwards, see processScreenshot. */
export async function recordFriction(p: Participant, input: FrictionInput, channel: string): Promise<string> {
  const { data, error } = await db
    .from("friction_reports")
    .insert({
      participant_id: p.id,
      slack_user_id: p.slack_user_id,
      channel_id: channel || null,
      app: input.app,
      tried: input.tried,
      happened: input.happened,
      screenshot_url: input.file?.permalink ?? null,
      profile: snapshot(p),
    })
    .select("id")
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

/** Copies the Slack screenshot into the private bucket. Without files:read the Slack link stays as the fallback. */
export async function processScreenshot(reportId: string, file: SlackFile) {
  const url = file.url_private_download ?? file.url_private;
  if (!url) return;
  try {
    const { bytes, type } = await downloadFile(url);
    const ext = (file.name?.split(".").pop() ?? "").toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
    const path = `${reportId}/screenshot.${ext}`;
    const up = await db.storage.from("friction").upload(path, bytes, { contentType: file.mimetype || type, upsert: true });
    if (up.error) throw up.error;
    const { error } = await db.from("friction_reports").update({ screenshot_path: path }).eq("id", reportId);
    if (error) throw error;
  } catch (e) {
    console.error("friction screenshot", reportId, e);
  }
}

/** Posts the weekly digest. `force` posts even when there is nothing new. */
export async function frictionDigest(force = false): Promise<Outcome> {
  const settings = await getSettings();
  const channel = needChannel(settings);
  const weekAgo = Date.now() - 7 * 86_400_000;
  const { data, error } = await db.from("friction_reports").select("app, status, created_at, resolved_at");
  if (error) throw error;
  const rows = (data ?? []) as { app: string; status: string; created_at: string; resolved_at: string | null }[];
  const received = rows.filter((r) => new Date(r.created_at).getTime() >= weekAgo);
  const stats = {
    received: received.length,
    fixed: rows.filter((r) => r.status === "fixed" && r.resolved_at && new Date(r.resolved_at).getTime() >= weekAgo).length,
    open: rows.filter((r) => r.status === "new").length,
    walaplus: received.filter((r) => r.app === "walaplus").length,
    walaone: received.filter((r) => r.app === "walaone").length,
  };
  if (!force && !stats.received && !stats.open) return { ok: true, message: "Nothing to report this week; digest skipped." };
  await postMessage(channel, `Friction this week: ${stats.received} reported, ${stats.fixed} fixed, ${stats.open} open.`, frictionDigestBlocks(stats, settings));
  await setSetting("friction_digest_at", new Date().toISOString());
  return { ok: true, message: `Digest posted to ${settings.channel_name}: ${stats.received} reported, ${stats.fixed} fixed, ${stats.open} open.` };
}

/** Sunday 09:00 Riyadh, once a week. Called by the scheduler every five minutes. */
export async function frictionDigestIfDue(settings: Settings): Promise<Outcome> {
  const r = riyadh(new Date());
  const last = settings.friction_digest_at ? new Date(settings.friction_digest_at).getTime() : 0;
  if (r.weekday !== 0 || r.hour !== 9 || Date.now() - last < 6 * 86_400_000) return { ok: true, message: "not due" };
  return frictionDigest();
}

/** Posts (and pins) the "report a broken step" prompt, replacing the previous one. */
export async function postFrictionPrompt(): Promise<Outcome> {
  const settings = await getSettings();
  const channel = needChannel(settings);
  if (settings.friction_post_ts) await deleteMessage(channel, settings.friction_post_ts);
  const r = await postMessage(channel, "Something broken in WalaPlus or WalaOne? Report it in one minute.", frictionPromptBlocks());
  await pin(channel, r.ts);
  await setSetting("friction_post_ts", r.ts);
  return { ok: true, message: `Friction prompt posted and pinned in ${settings.channel_name}.` };
}

/** A DM from the research team to one member, for example a reply to a friction report. */
export async function dmParticipant(participantId: string, text: string): Promise<Outcome> {
  const t = text.trim();
  if (!t) return { ok: false, message: "Write the message first." };
  const { data, error } = await db.from("participants").select("slack_user_id, name, deleted_at").eq("id", participantId).maybeSingle();
  if (error) throw error;
  const p = data as { slack_user_id: string; name: string; deleted_at: string | null } | null;
  if (!p || p.deleted_at) return { ok: false, message: "That member was forgotten, so no DM is possible." };
  await dm(p.slack_user_id, t.slice(0, 2000));
  return { ok: true, message: `DM sent to ${p.name}.` };
}

function fmt(iso: string | null): string {
  if (!iso) return "soon";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Riyadh" });
}
