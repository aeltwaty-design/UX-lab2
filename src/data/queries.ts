import { supabase } from "@/lib/supabase";
import {
  DEFAULT_SETTINGS,
  type ChannelMember,
  type Participant,
  type Question,
  type Response,
  type ResultsPost,
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
    .select("*, questions(*, options(*))")
    .eq("id", id)
    .single();
  if (error) fail(error);
  const s = data as StudyWithQuestions;
  s.questions = (s.questions ?? [])
    .sort((a, b) => a.position - b.position)
    .map((q) => ({ ...q, options: (q.options ?? []).sort((a, b) => a.position - b.position) }));
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
}

/** Upserts the study row and replaces its questions and options. Returns the id. */
export async function saveStudy(draft: StudyDraft, questions: Question[]): Promise<string> {
  const row = { ...draft };
  if (!row.id) delete row.id;
  const { data, error } = await supabase.from("studies").upsert(row).select("id").single();
  if (error) fail(error);
  const id = (data as { id: string }).id;

  const del = await supabase.from("questions").delete().eq("study_id", id);
  if (del.error) fail(del.error);

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
    const opts = ["single", "multi"].includes(q.kind)
      ? q.options.filter((o) => o.label_en.trim())
      : [];
    if (opts.length) {
      const or = await supabase.from("options").insert(
        opts.map((o, oi) => ({ question_id: qid, position: oi, label_en: o.label_en, label_ar: o.label_ar })),
      );
      if (or.error) fail(or.error);
    }
  }
  return id;
}

export async function deleteStudy(id: string): Promise<void> {
  const { error } = await supabase.from("studies").delete().eq("id", id);
  if (error) fail(error);
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

// ---------- Slack actions (edge function, needs the bot token) ----------

export type AdminAction =
  | { action: "publish_now"; study_id: string }
  | { action: "close_now"; study_id: string }
  | { action: "remind"; study_id: string }
  | { action: "post_results"; study_id: string }
  | { action: "repost_profile" }
  | { action: "remind_missing_profiles" }
  | { action: "sync_members" }
  | { action: "test_slack" };

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
