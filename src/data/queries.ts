import { supabase } from "@/lib/supabase";
import type { SlotDraft } from "@/lib/preview";
import { composeComparison, type CompareOption } from "@/lib/compare";
import {
  DEFAULT_SETTINGS,
  type Announcement,
  type AnnouncementStatus,
  type ChannelMember,
  type FrictionReport,
  type Participant,
  type Question,
  type Response,
  type ResultsPost,
  type SessionBooking,
  type SessionSlot,
  type Settings,
  type Study,
  type StudyWithQuestions,
} from "@/lib/types";

function fail(e: { message: string } | null): never {
  throw new Error(e?.message ?? "Unknown error");
}

// ---------- Studies ----------

export async function listStudies(): Promise<Study[]> {
  const { data, error } = await supabase
    .from("study_stats")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) fail(error);
  return (data ?? []) as Study[];
}

export async function getStudy(id: string): Promise<StudyWithQuestions> {
  const { data, error } = await supabase
    .from("study_stats")
    .select("*, questions(*, options(*)), session_slots(*)")
    .eq("id", id)
    .single();
  if (error) fail(error);
  const row = data as StudyWithQuestions & { session_slots?: SessionSlot[] };
  const { session_slots, ...s } = row;
  s.questions = (s.questions ?? [])
    .sort((a, b) => a.position - b.position)
    .map((q) => ({ ...q, options: (q.options ?? []).sort((a, b) => a.position - b.position) }));
  s.slots = (session_slots ?? []).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  return s;
}

export interface StudyDraft {
  id?: string;
  type: Study["type"];
  status: Study["status"];
  title_en: string;
  title_ar: string;
  intro_en: string;
  intro_ar: string;
  audience: Study["audience"];
  audience_teams: string[];
  target: number | null;
  publish_at: string | null;
  close_at: string | null;
  allow_changes: boolean;
  /** Preference tests: the side-by-side picture. saveComparison sets it after the save. */
  compare_url: string | null;
  /** Session recruitment: a Google Meet link with every booked slot's calendar event. */
  meet: boolean;
}

/**
 * Upserts the study row and replaces its questions, options and session slots. Returns the id.
 * Only drafts and scheduled studies are saved this way, so no answers or bookings hang off the rows replaced here.
 */
export async function saveStudy(draft: StudyDraft, questions: Question[], slots: SlotDraft[] = []): Promise<string> {
  const row = { ...draft };
  if (!row.id) delete row.id;
  const { data, error } = await supabase.from("studies").upsert(row).select("id").single();
  if (error) fail(error);
  const id = (data as { id: string }).id;

  const del = await supabase.from("questions").delete().eq("study_id", id);
  if (del.error) fail(del.error);
  const delSlots = await supabase.from("session_slots").delete().eq("study_id", id);
  if (delSlots.error) fail(delSlots.error);

  if (draft.type === "session_recruitment") {
    const rows = [...slots]
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
      .map((s, i) => ({ study_id: id, position: i, starts_at: s.starts_at, minutes: s.minutes, place: s.place.trim(), capacity: s.capacity }));
    if (rows.length) {
      const ins = await supabase.from("session_slots").insert(rows);
      if (ins.error) fail(ins.error);
    }
    return id;
  }

  for (const [qi, q] of questions.entries()) {
    const qr = await supabase
      .from("questions")
      .insert({
        study_id: id,
        position: qi,
        kind: q.kind,
        text_en: q.text_en,
        text_ar: q.text_ar,
        required: q.required,
      })
      .select("id")
      .single();
    if (qr.error) fail(qr.error);
    const qid = (qr.data as { id: string }).id;
    const opts =
      draft.type === "preference_test"
        ? q.options.filter((o) => o.image_url)
        : ["single", "multi"].includes(q.kind)
          ? q.options.filter((o) => o.label_en.trim())
          : [];
    if (opts.length) {
      const or = await supabase.from("options").insert(
        opts.map((o, oi) => ({ question_id: qid, position: oi, label_en: o.label_en, label_ar: o.label_ar, image_url: o.image_url ?? null })),
      );
      if (or.error) fail(or.error);
    }
  }
  return id;
}

/**
 * Saves edits to a study that is already in the channel (live, closed or reported) without touching the ids that
 * answers and bookings point at: the study's words, audience, target and (while live) close date; question and option
 * wording in place; for session recruitment, slot details, new slots, and the removal of slots nobody booked.
 * Type, status, publish date, question kinds and option counts stay as they are.
 */
export async function updatePublishedStudy(draft: StudyDraft & { id: string }, questions: Question[], slots: SlotDraft[] = []): Promise<void> {
  const patch: Record<string, unknown> = {
    title_en: draft.title_en,
    title_ar: draft.title_ar,
    intro_en: draft.intro_en,
    intro_ar: draft.intro_ar,
    audience: draft.audience,
    audience_teams: draft.audience_teams,
    target: draft.target,
    allow_changes: draft.allow_changes,
    meet: draft.meet,
  };
  if (draft.status === "live") patch.close_at = draft.close_at;
  const up = await supabase.from("studies").update(patch).eq("id", draft.id);
  if (up.error) fail(up.error);

  for (const q of questions) {
    if (q.id.startsWith("tmp-")) continue;
    const qu = await supabase.from("questions").update({ text_en: q.text_en, text_ar: q.text_ar, required: q.required }).eq("id", q.id);
    if (qu.error) fail(qu.error);
    for (const o of q.options) {
      if (o.id.startsWith("tmp-")) continue;
      const ou = await supabase.from("options").update({ label_en: o.label_en, label_ar: o.label_ar }).eq("id", o.id);
      if (ou.error) fail(ou.error);
    }
  }

  if (draft.type === "session_recruitment") {
    const { data: existing, error } = await supabase.from("session_slots").select("id").eq("study_id", draft.id);
    if (error) fail(error);
    const keep = new Set(slots.map((s) => s.id));
    const gone = ((existing ?? []) as { id: string }[]).map((r) => r.id).filter((sid) => !keep.has(sid));
    if (gone.length) {
      // Deleting a slot would cascade to its bookings, so a booked slot stays.
      const { count, error: e2 } = await supabase.from("session_bookings").select("id", { count: "exact", head: true }).in("slot_id", gone).is("cancelled_at", null);
      if (e2) fail(e2);
      if (count) throw new Error("A slot you removed has bookings. Keep it; members can cancel from their DM.");
      const del = await supabase.from("session_slots").delete().in("id", gone);
      if (del.error) fail(del.error);
    }
    const sorted = [...slots].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    for (const [i, s] of sorted.entries()) {
      const row = { position: i, starts_at: s.starts_at, minutes: s.minutes, place: s.place.trim(), capacity: s.capacity };
      const r = s.id.startsWith("tmp-")
        ? await supabase.from("session_slots").insert({ ...row, study_id: draft.id })
        : await supabase.from("session_slots").update(row).eq("id", s.id);
      if (r.error) fail(r.error);
    }
  }
}

/** Uploads a preference-test image to the public study-images bucket and returns its URL. */
export async function uploadStudyImage(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) throw new Error("Use a PNG, JPEG, GIF or WebP image.");
  if (file.size > 5 * 1024 * 1024) throw new Error("Images are limited to 5 MB.");
  const ext = file.type.split("/")[1] === "jpeg" ? "jpg" : file.type.split("/")[1];
  const path = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from("study-images").upload(path, file, { contentType: file.type, cacheControl: "31536000" });
  if (error) throw new Error(error.message);
  return supabase.storage.from("study-images").getPublicUrl(path).data.publicUrl;
}

/**
 * Builds the side-by-side picture for a preference test, stores it in study-images and records it on the study.
 * Every build gets a new file name, because Slack caches an image by its URL. Returns the new URL.
 */
export async function saveComparison(studyId: string, options: CompareOption[], previousUrl: string | null): Promise<string> {
  const blob = await composeComparison(options);
  const path = `compare/${studyId}-${Date.now()}.jpg`;
  const up = await supabase.storage.from("study-images").upload(path, blob, { contentType: "image/jpeg", cacheControl: "31536000" });
  if (up.error) throw new Error(up.error.message);
  const url = supabase.storage.from("study-images").getPublicUrl(path).data.publicUrl;
  const { error } = await supabase.from("studies").update({ compare_url: url }).eq("id", studyId);
  if (error) fail(error);
  await removeStudyImage(previousUrl);
  return url;
}

/** Forgets the side-by-side picture: the study is no longer a preference test, or has fewer than two images. */
export async function clearComparison(studyId: string, previousUrl: string | null): Promise<void> {
  if (!previousUrl) return;
  const { error } = await supabase.from("studies").update({ compare_url: null }).eq("id", studyId);
  if (error) fail(error);
  await removeStudyImage(previousUrl);
}

/** Best effort: a leftover file in the bucket is not worth failing a save over. */
async function removeStudyImage(url: string | null): Promise<void> {
  const path = url?.split("/study-images/")[1];
  if (path) await supabase.storage.from("study-images").remove([path]);
}

// ---------- Session bookings ----------

export async function listBookings(studyId: string): Promise<SessionBooking[]> {
  const { data, error } = await supabase
    .from("session_bookings")
    .select("*, participant:participants(slack_user_id, name, deleted_at)")
    .eq("study_id", studyId)
    .is("cancelled_at", null)
    .order("booked_at", { ascending: false });
  if (error) fail(error);
  return (data ?? []) as SessionBooking[];
}

export async function setStudyStatus(id: string, status: Study["status"]): Promise<void> {
  const { error } = await supabase.from("studies").update({ status }).eq("id", id);
  if (error) fail(error);
}

// ---------- Responses ----------

export async function listResponses(studyId: string): Promise<Response[]> {
  const { data, error } = await supabase
    .from("responses")
    .select("*, answers(*), participant:participants(slack_user_id, name, deleted_at)")
    .eq("study_id", studyId)
    .order("submitted_at", { ascending: false });
  if (error) fail(error);
  return (data ?? []) as Response[];
}

// ---------- Participants ----------

export async function listParticipants(): Promise<Participant[]> {
  const { data, error } = await supabase
    .from("participants")
    .select("*")
    .is("deleted_at", null)
    .order("profile_at", { ascending: false });
  if (error) fail(error);
  return (data ?? []) as Participant[];
}

export async function listChannelMembers(): Promise<ChannelMember[]> {
  const { data, error } = await supabase.from("channel_members").select("*").eq("is_active", true);
  if (error) fail(error);
  return (data ?? []) as ChannelMember[];
}

export async function forgetParticipant(id: string): Promise<void> {
  const { error } = await supabase.rpc("forget_participant", { p_id: id });
  if (error) fail(error);
}

export async function participantResponseCounts(): Promise<Record<string, number>> {
  const { data, error } = await supabase.from("participant_stats").select("participant_id, response_count");
  if (error) fail(error);
  const out: Record<string, number> = {};
  for (const r of (data ?? []) as { participant_id: string; response_count: number }[]) out[r.participant_id] = r.response_count;
  return out;
}

// ---------- Results posts ----------

export async function getResultsPost(studyId: string): Promise<ResultsPost | null> {
  const { data, error } = await supabase.from("results_posts").select("*").eq("study_id", studyId).maybeSingle();
  if (error) fail(error);
  return (data as ResultsPost | null) ?? null;
}

export async function saveResultsPost(p: Pick<ResultsPost, "study_id" | "body_en" | "body_ar" | "include_totals">): Promise<ResultsPost> {
  const { data, error } = await supabase
    .from("results_posts")
    .upsert(p, { onConflict: "study_id" })
    .select("*")
    .single();
  if (error) fail(error);
  return data as ResultsPost;
}

// ---------- Friction inbox ----------

export async function listFriction(): Promise<FrictionReport[]> {
  const { data, error } = await supabase.from("friction_reports").select("*").order("created_at", { ascending: false });
  if (error) fail(error);
  return (data ?? []) as FrictionReport[];
}

export async function updateFriction(id: string, patch: Partial<Pick<FrictionReport, "status" | "note" | "resolved_at">>): Promise<void> {
  const { error } = await supabase.from("friction_reports").update(patch).eq("id", id);
  if (error) fail(error);
}

/** A one-hour link to a screenshot in the private friction bucket. */
export async function frictionScreenshotUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from("friction").createSignedUrl(path, 3600);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

// ---------- Settings ----------

export async function getSettings(): Promise<Settings> {
  const { data, error } = await supabase.from("settings").select("key, value");
  if (error) fail(error);
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of (data ?? []) as { key: string; value: unknown }[]) out[r.key] = r.value;
  return out as unknown as Settings;
}

export async function saveSettings(s: Settings): Promise<void> {
  const rows = (Object.keys(s) as (keyof Settings)[]).map((key) => ({ key, value: s[key] }));
  const { error } = await supabase.from("settings").upsert(rows, { onConflict: "key" });
  if (error) fail(error);
}

export async function listAdmins(): Promise<string[]> {
  const { data, error } = await supabase.from("admins").select("email").order("email");
  if (error) fail(error);
  return ((data ?? []) as { email: string }[]).map((r) => r.email);
}

export async function addAdmin(email: string): Promise<void> {
  const { error } = await supabase.from("admins").insert({ email: email.trim().toLowerCase() });
  if (error) fail(error);
}

export async function removeAdmin(email: string): Promise<void> {
  const { error } = await supabase.from("admins").delete().eq("email", email);
  if (error) fail(error);
}

// ---------- Announcements ----------

export async function listAnnouncements(): Promise<Announcement[]> {
  const { data, error } = await supabase.from("announcements").select("*").order("created_at", { ascending: false });
  if (error) fail(error);
  return (data ?? []) as Announcement[];
}

export async function getAnnouncement(id: string): Promise<Announcement> {
  const { data, error } = await supabase.from("announcements").select("*").eq("id", id).single();
  if (error) fail(error);
  return data as Announcement;
}

export type AnnouncementDraft = Pick<Announcement, "title_en" | "body_en" | "body_ar" | "pin" | "publish_at"> & { id?: string; status: AnnouncementStatus };

/** Inserts or updates the row. A posted announcement keeps its post ids; the caller then refreshes the post. */
export async function saveAnnouncement(d: AnnouncementDraft): Promise<Announcement> {
  const row = { title_en: d.title_en.trim(), body_en: d.body_en, body_ar: d.body_ar, pin: d.pin, publish_at: d.publish_at, status: d.status };
  const res = d.id
    ? await supabase.from("announcements").update(row).eq("id", d.id).select("*").single()
    : await supabase.from("announcements").insert(row).select("*").single();
  if (res.error) fail(res.error);
  return res.data as Announcement;
}

// ---------- Slack actions (edge function, needs the bot token) ----------

export type AdminAction =
  | { action: "publish_now"; study_id: string }
  | { action: "close_now"; study_id: string }
  | { action: "remind"; study_id: string }
  | { action: "post_results"; study_id: string }
  | { action: "repost_profile" }
  | { action: "remind_missing_profiles" }
  | { action: "sync_members" }
  | { action: "test_slack" }
  | { action: "delete_post"; link: string }
  | { action: "delete_study"; study_id: string; remove_posts: boolean }
  | { action: "refresh_post"; study_id: string }
  | { action: "post_friction_prompt" }
  | { action: "friction_digest" }
  | { action: "session_reminders" }
  | { action: "dm_participant"; participant_id: string; text: string }
  | { action: "post_announcement"; announcement_id: string }
  | { action: "refresh_announcement"; announcement_id: string }
  | { action: "delete_announcement"; announcement_id: string; remove_posts: boolean }
  | { action: "google_status" }
  | { action: "google_auth_url"; redirect_uri: string }
  | { action: "google_connect"; code: string; state: string; redirect_uri: string }
  | { action: "google_disconnect" };

export interface AdminResult {
  ok: boolean;
  message: string;
  [k: string]: unknown;
}

export async function runAdminAction(body: AdminAction): Promise<AdminResult> {
  const { data, error } = await supabase.functions.invoke<AdminResult>("admin-actions", { body });
  if (error) {
    // The function returns a JSON body on handled errors; surface it.
    const ctx = (error as { context?: globalThis.Response }).context;
    try {
      const j = ctx ? ((await ctx.json()) as AdminResult) : null;
      if (j?.message) return { ok: false, message: j.message };
    } catch {
      /* fall through */
    }
    return { ok: false, message: error.message };
  }
  return data ?? { ok: false, message: "No reply from the function." };
}

// ---------- Google Calendar (the connection lives in the database, behind the admin-actions function) ----------

export interface GoogleStatus {
  /** Both client secrets are set on the functions. */
  configured: boolean;
  connected: boolean;
  email: string | null;
  connected_at: string | null;
  last_error: string | null;
}

export async function googleStatus(): Promise<GoogleStatus> {
  const r = await runAdminAction({ action: "google_status" });
  if (!r.ok) throw new Error(r.message);
  return {
    configured: r.configured === true,
    connected: r.connected === true,
    email: typeof r.email === "string" ? r.email : null,
    connected_at: typeof r.connected_at === "string" ? r.connected_at : null,
    last_error: typeof r.last_error === "string" ? r.last_error : null,
  };
}

/** Where Google sends the browser back after consent: the app's root, which must be listed on the OAuth client. */
export function googleRedirectUri(): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}`;
}
