import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

export const db: SupabaseClient = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  { auth: { persistSession: false } },
);

export interface Settings {
  channel_id: string;
  channel_name: string;
  workspace_url: string;
  hours_cap: number;
  small_group: number;
  default_lang: "en" | "ar";
  teams: string[];
  members_synced_at?: string;
  profile_post_ts?: string;
  /** Older profile posts still to be removed on the next re-post. */
  profile_posts_old?: string[];
  /** The pinned "report a broken step" post. */
  friction_post_ts?: string;
  /** When the weekly friction digest last went out. */
  friction_digest_at?: string;
  /** True once Slack accepted the friction form with its screenshot field (needs files:read). */
  friction_files_ok?: boolean;
}

export async function getSettings(): Promise<Settings> {
  const { data, error } = await db.from("settings").select("key, value");
  if (error) throw error;
  const s: Record<string, unknown> = { channel_id: "", channel_name: "#ux-research", workspace_url: "", hours_cap: 6, small_group: 8, default_lang: "en", teams: [] };
  for (const r of (data ?? []) as { key: string; value: unknown }[]) s[r.key] = r.value;
  return s as unknown as Settings;
}

export async function setSetting(key: string, value: unknown) {
  const { error } = await db.from("settings").upsert({ key, value }, { onConflict: "key" });
  if (error) throw error;
}

export interface Option { id: string; position: number; label_en: string; label_ar: string; image_url: string | null }
export interface Question { id: string; position: number; kind: "single" | "multi" | "scale" | "yesno" | "text"; text_en: string; text_ar: string; required: boolean; options: Option[] }
export interface Study {
  id: string;
  type: string;
  status: "draft" | "scheduled" | "live" | "closed" | "reported";
  title_en: string;
  title_ar: string;
  intro_en: string;
  intro_ar: string;
  audience: "everyone" | "panel" | "teams";
  audience_teams: string[];
  publish_at: string | null;
  close_at: string | null;
  published_at: string | null;
  closed_at: string | null;
  slack_channel_id: string | null;
  slack_ts: string | null;
  reminder_sent_at: string | null;
  questions: Question[];
}

export async function getStudy(id: string): Promise<Study> {
  const { data, error } = await db.from("studies").select("*, questions(*, options(*))").eq("id", id).single();
  if (error) throw error;
  const s = data as Study;
  s.questions = (s.questions ?? [])
    .sort((a, b) => a.position - b.position)
    .map((q) => ({ ...q, options: (q.options ?? []).sort((a, b) => a.position - b.position) }));
  return s;
}

// ---------- session recruitment ----------

export interface SessionSlot { id: string; study_id: string; position: number; starts_at: string; minutes: number; place: string; capacity: number }
export interface SlotWithBookings extends SessionSlot { booked: number }

/** The study's slots in time order, each with its count of active bookings. */
export async function getSlots(studyId: string): Promise<SlotWithBookings[]> {
  const { data, error } = await db.from("session_slots").select("*, session_bookings(id, cancelled_at)").eq("study_id", studyId).order("starts_at");
  if (error) throw error;
  return ((data ?? []) as (SessionSlot & { session_bookings?: { id: string; cancelled_at: string | null }[] })[]).map((s) => {
    const { session_bookings, ...slot } = s;
    return { ...slot, booked: (session_bookings ?? []).filter((b) => !b.cancelled_at).length };
  });
}

const RIYADH = "Asia/Riyadh";
const DAY = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: RIYADH });
const TIME = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: RIYADH });

/** "Sun 2 Nov · 10:00–10:30", Riyadh time. */
export function fmtSlot(startsAt: string, minutes: number): string {
  const start = new Date(startsAt);
  const end = new Date(start.getTime() + minutes * 60_000);
  return `${DAY.format(start)} · ${TIME.format(start)}–${TIME.format(end)}`;
}

/** Riyadh calendar parts of an instant. weekday: 0 = Sunday. */
export function riyadh(d: Date): { y: number; m: number; d: number; weekday: number; hour: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: RIYADH, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", hour12: false, weekday: "short" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { y: Number(get("year")), m: Number(get("month")), d: Number(get("day")), weekday, hour: Number(get("hour")) % 24 };
}

/** The Sunday that starts the Riyadh week an instant falls in, as YYYY-MM-DD. Saudi weeks start on Sunday. */
export function weekKey(iso: string): string {
  const r = riyadh(new Date(iso));
  return new Date(Date.UTC(r.y, r.m - 1, r.d - r.weekday)).toISOString().slice(0, 10);
}

// ---------- participants ----------

export interface Participant {
  id: string;
  slack_user_id: string;
  name: string;
  age_band: string;
  gender: string;
  device: string;
  team: string | null;
  apps: string[];
  language: "en" | "ar";
  deleted_at: string | null;
}

export async function getParticipant(slackUserId: string): Promise<Participant | null> {
  const { data, error } = await db.from("participants").select("*").eq("slack_user_id", slackUserId).is("deleted_at", null).maybeSingle();
  if (error) throw error;
  return (data as Participant | null) ?? null;
}

export function snapshot(p: Participant) {
  return { name: p.name, age_band: p.age_band, gender: p.gender, device: p.device, team: p.team, apps: p.apps, language: p.language };
}

export async function countResponses(studyId: string): Promise<number> {
  const { count, error } = await db.from("responses").select("id", { count: "exact", head: true }).eq("study_id", studyId);
  if (error) throw error;
  return count ?? 0;
}

export function fmtDate(iso: string | null): string {
  if (!iso) return "soon";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Riyadh" });
}

export function smallGroup(n: number, threshold: number): string {
  return n < threshold ? `under ${threshold}` : String(n);
}
