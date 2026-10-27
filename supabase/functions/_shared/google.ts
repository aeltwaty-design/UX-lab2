// Google Calendar and Meet for session recruitment. One Google Workspace account is connected once from
// Settings; its refresh token lives in the google_calendar table (row level security on, no policies, so only
// the service role reads it). Every slot with a booking becomes one event on that account's calendar, with the
// booked members as guests (Google emails the invites) and, when the study asks for it, a Google Meet link.
// Nothing here throws into a booking: a Google failure is recorded in google_calendar.last_error and the booking
// goes ahead without the invite.
import { clearSetting, db, getSettings, setSetting, type SessionSlot, type Settings, type SlotWithBookings, type Study } from "./db.ts";
import { userInfo } from "./slack.ts";

const CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID") ?? "";
const CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";
const SCOPES = "openid email https://www.googleapis.com/auth/calendar.events";
const EVENTS = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const TZ = "Asia/Riyadh";

export interface Outcome {
  ok: boolean;
  message: string;
  [k: string]: unknown;
}

export class GoogleError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** True once both client secrets are set on the functions. */
export const configured = () => Boolean(CLIENT_ID && CLIENT_SECRET);

interface Connection { account_email: string; refresh_token: string; connected_at: string; last_error: string | null }

async function getConnection(): Promise<Connection | null> {
  const { data, error } = await db.from("google_calendar").select("account_email, refresh_token, connected_at, last_error").eq("id", 1).maybeSingle();
  if (error) throw error;
  return (data as Connection | null) ?? null;
}

async function noteError(e: unknown) {
  const message = (e instanceof Error ? e.message : String(e)).slice(0, 500);
  console.error("google", message);
  try {
    await db.from("google_calendar").update({ last_error: message }).eq("id", 1);
  } catch {
    /* nothing to record on */
  }
}

// ---------- OAuth ----------

function authUrl(redirectUri: string, state: string): string {
  const q = new URLSearchParams({ client_id: CLIENT_ID, redirect_uri: redirectUri, response_type: "code", scope: SCOPES, access_type: "offline", prompt: "consent", state });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

async function tokenRequest(params: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, ...params }).toString(),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new GoogleError(res.status, String(json.error_description ?? json.error ?? `Google token request failed (${res.status})`));
  return json;
}

/** The email claim of an id_token. It only labels the connection; every call is authorised by the token itself. */
function emailFromIdToken(idToken: unknown): string {
  if (typeof idToken !== "string") return "";
  try {
    const part = idToken.split(".")[1] ?? "";
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (part.length % 4)) % 4);
    const payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))) as { email?: string };
    return (payload.email ?? "").toLowerCase();
  } catch {
    return "";
  }
}

async function revoke(token: string) {
  try {
    await fetch("https://oauth2.googleapis.com/revoke", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token }).toString() });
  } catch {
    /* best effort */
  }
}

let cached: { token: string; until: number } | null = null;

/** A live access token, or null when Google is not connected or refuses (the reason is kept in google_calendar.last_error). */
async function accessToken(): Promise<string | null> {
  if (!configured()) return null;
  if (cached && cached.until > Date.now() + 30_000) return cached.token;
  const c = await getConnection();
  if (!c) return null;
  try {
    const t = await tokenRequest({ refresh_token: c.refresh_token, grant_type: "refresh_token" });
    cached = { token: String(t.access_token), until: Date.now() + Number(t.expires_in ?? 3600) * 1000 };
    return cached.token;
  } catch (e) {
    await noteError(e);
    return null;
  }
}

// ---------- Calendar API ----------

interface GEvent {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string };
  end?: { dateTime?: string };
  attendees?: { email: string; organizer?: boolean }[];
  hangoutLink?: string;
  conferenceData?: { entryPoints?: { entryPointType: string; uri: string }[] };
}

async function call(token: string, method: string, path = "", body?: unknown, query: Record<string, string> = {}): Promise<GEvent | null> {
  const q = new URLSearchParams(query).toString();
  const res = await fetch(`${EVENTS}${path}${q ? `?${q}` : ""}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } } & GEvent;
  if (!res.ok) throw new GoogleError(res.status, json.error?.message ?? `Google Calendar ${method} failed (${res.status})`);
  return json;
}

const gone = (e: unknown) => e instanceof GoogleError && (e.status === 404 || e.status === 410);
const conference = () => ({ createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } });

function meetLink(ev: GEvent | null): string | null {
  return ev?.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video")?.uri ?? ev?.hangoutLink ?? null;
}

interface Guest { slack: string; email: string | null }

/** The members booked on a slot with their work email, read from Slack the first time (needs users:read.email) and kept on the participant. */
async function guests(slotId: string): Promise<Guest[]> {
  const { data, error } = await db.from("session_bookings").select("participant:participants(id, slack_user_id, email, deleted_at)").eq("slot_id", slotId).is("cancelled_at", null);
  if (error) throw error;
  const out: Guest[] = [];
  for (const row of (data ?? []) as unknown as { participant: { id: string; slack_user_id: string; email: string | null; deleted_at: string | null } | null }[]) {
    const p = row.participant;
    if (!p || p.deleted_at) continue;
    let email = p.email;
    if (!email) {
      try {
        email = (await userInfo(p.slack_user_id)).profile?.email?.toLowerCase() ?? null;
      } catch {
        email = null;
      }
      if (email) await db.from("participants").update({ email }).eq("id", p.id);
    }
    out.push({ slack: p.slack_user_id, email });
  }
  return out;
}

function eventBody(study: Study, slot: SessionSlot, settings: Settings, attendees: { email: string }[]) {
  const start = new Date(slot.starts_at);
  const end = new Date(start.getTime() + slot.minutes * 60_000);
  const description = [
    study.intro_en.trim(),
    `Booked from ${settings.channel_name} in Slack. To cancel, use the button in the booking message in your Slack DMs; declining this invite does not free the slot.`,
  ].filter(Boolean).join("\n\n");
  return {
    summary: `${study.title_en} · UX research session`,
    description,
    location: slot.place || "",
    start: { dateTime: start.toISOString(), timeZone: TZ },
    end: { dateTime: end.toISOString(), timeZone: TZ },
    attendees,
    guestsCanInviteOthers: false,
  };
}

const plain = (s: string | undefined) => (s ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

/** True when the event already says what the body says, so a patch (and Google's update email) can be skipped. */
function sameEvent(ev: GEvent, body: ReturnType<typeof eventBody>): boolean {
  const at = (s?: string) => (s ? new Date(s).getTime() : 0);
  const mails = (list: { email: string }[]) => list.map((a) => a.email.toLowerCase()).sort().join(",");
  return (ev.summary ?? "") === body.summary &&
    plain(ev.description) === plain(body.description) &&
    (ev.location ?? "") === body.location &&
    at(ev.start?.dateTime) === at(body.start.dateTime) &&
    at(ev.end?.dateTime) === at(body.end.dateTime) &&
    mails((ev.attendees ?? []).filter((a) => !a.organizer)) === mails(body.attendees);
}

export interface SlotSync {
  meet_url: string | null;
  /** Slack ids of the members on the event, so Google has emailed them. */
  invited: string[];
}

/**
 * Makes the slot's calendar event mirror its active bookings: created on the first booking, patched when the guests,
 * time, place or wording changed, removed when nobody is booked any more. Returns the Meet link and who is invited.
 * Never throws: a Google failure leaves the booking alone and is recorded in google_calendar.last_error.
 */
export async function syncSlotEvent(study: Study, slotId: string, settings: Settings): Promise<SlotSync> {
  let known: string | null = null;
  try {
    const { data, error } = await db.from("session_slots").select("*").eq("id", slotId).maybeSingle();
    if (error) throw error;
    const slot = data as SessionSlot | null;
    if (!slot) return { meet_url: null, invited: [] };
    known = slot.meet_url;
    const token = await accessToken();
    if (!token) return { meet_url: known, invited: [] };

    const list = await guests(slotId);
    if (!list.length) {
      if (slot.google_event_id) {
        try {
          await call(token, "DELETE", `/${slot.google_event_id}`, undefined, { sendUpdates: "all" });
        } catch (e) {
          if (!gone(e)) throw e;
        }
        await db.from("session_slots").update({ google_event_id: null, meet_url: null }).eq("id", slotId);
      }
      return { meet_url: null, invited: [] };
    }

    const body = eventBody(study, slot, settings, list.filter((g) => g.email).map((g) => ({ email: g.email as string })));
    let ev: GEvent | null = null;
    if (slot.google_event_id) {
      try {
        ev = await call(token, "GET", `/${slot.google_event_id}`);
        if (ev?.status === "cancelled") ev = null;
      } catch (e) {
        if (!gone(e)) throw e;
      }
    }
    if (ev) {
      const needMeet = study.meet && !meetLink(ev);
      if (needMeet || !sameEvent(ev, body)) {
        ev = await call(token, "PATCH", `/${ev.id}`, { ...body, ...(needMeet ? { conferenceData: conference() } : {}) }, { conferenceDataVersion: "1", sendUpdates: "all" });
      }
    } else {
      ev = await call(token, "POST", "", { ...body, ...(study.meet ? { conferenceData: conference() } : {}) }, { conferenceDataVersion: "1", sendUpdates: "all" });
    }
    if (!ev) return { meet_url: known, invited: [] };
    let meet = meetLink(ev);
    if (study.meet && !meet) {
      // The Meet room is sometimes ready a moment after the event.
      await new Promise((r) => setTimeout(r, 1500));
      meet = meetLink(await call(token, "GET", `/${ev.id}`));
    }
    await db.from("session_slots").update({ google_event_id: ev.id, meet_url: meet }).eq("id", slotId);
    await db.from("google_calendar").update({ last_error: null }).eq("id", 1).not("last_error", "is", null);
    return { meet_url: meet, invited: list.filter((g) => g.email).map((g) => g.slack) };
  } catch (e) {
    await noteError(e);
    return { meet_url: known, invited: [] };
  }
}

/** After an edit in the dashboard: every slot with bookings or an event is brought in line (place, intro, Meet switch). */
export async function syncStudyEvents(study: Study, settings: Settings, slots: SlotWithBookings[]) {
  if (!configured()) return;
  for (const s of slots) if (s.booked > 0 || s.google_event_id) await syncSlotEvent(study, s.id, settings);
}

/** Removes the study's events before the study is deleted. Guests get Google's cancellation email. Best effort. */
export async function deleteStudyEvents(studyId: string) {
  try {
    const { data, error } = await db.from("session_slots").select("id, google_event_id").eq("study_id", studyId).not("google_event_id", "is", null);
    if (error) throw error;
    const rows = (data ?? []) as { id: string; google_event_id: string }[];
    if (!rows.length) return;
    const token = await accessToken();
    if (!token) return;
    for (const r of rows) {
      try {
        await call(token, "DELETE", `/${r.google_event_id}`, undefined, { sendUpdates: "all" });
      } catch (e) {
        if (!gone(e)) throw e;
      }
    }
  } catch (e) {
    await noteError(e);
  }
}

// ---------- admin actions (Settings → Google Calendar) ----------

export async function googleStatus(): Promise<Outcome> {
  const c = configured() ? await getConnection() : null;
  return { ok: true, message: "", configured: configured(), connected: Boolean(c), email: c?.account_email ?? null, connected_at: c?.connected_at ?? null, last_error: c?.last_error ?? null };
}

/** Step one of Connect: remembers a one-time state and returns Google's consent URL. */
export async function googleAuthUrl(redirectUri: string): Promise<Outcome> {
  if (!configured()) return { ok: false, message: "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in the function secrets first (README, step 7)." };
  if (!/^(https:\/\/|http:\/\/localhost)/.test(redirectUri)) return { ok: false, message: "The app must be served over https for Google sign-in." };
  const state = crypto.randomUUID();
  await setSetting("google_oauth_state", { state, redirect: redirectUri, at: new Date().toISOString() });
  return { ok: true, message: "", url: authUrl(redirectUri, state) };
}

/** Step two: Google sent the browser back with a code. Checks the state, trades the code for a refresh token and stores it. */
export async function googleConnect(code: string, state: string, redirectUri: string): Promise<Outcome> {
  if (!configured()) return { ok: false, message: "Google client secrets are not set." };
  const pending = (await getSettings()).google_oauth_state;
  if (!pending || !state || pending.state !== state) return { ok: false, message: "That sign-in is stale. Press Connect again." };
  if (pending.redirect !== redirectUri) return { ok: false, message: "The app's address changed during the sign-in. Press Connect again from the same address." };
  if (Date.now() - new Date(pending.at).getTime() > 15 * 60_000) return { ok: false, message: "The sign-in took more than 15 minutes. Press Connect again." };
  await clearSetting("google_oauth_state");
  const t = await tokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirectUri });
  const refresh = String(t.refresh_token ?? "");
  if (!refresh) return { ok: false, message: "Google did not return a long-lived token. Remove the app at myaccount.google.com/permissions and connect again." };
  if (!String(t.scope ?? "").includes("calendar.events")) {
    await revoke(refresh);
    return { ok: false, message: "Calendar access was not granted. Connect again and allow the calendar permission." };
  }
  const email = emailFromIdToken(t.id_token) || "(account email not shared)";
  const { error } = await db.from("google_calendar").upsert({ id: 1, account_email: email, refresh_token: refresh, connected_at: new Date().toISOString(), last_error: null }, { onConflict: "id" });
  if (error) throw error;
  cached = null;
  return { ok: true, message: `Google Calendar connected as ${email}. Save a live session study to create events for its existing bookings.`, email };
}

export async function googleDisconnect(): Promise<Outcome> {
  const c = await getConnection();
  if (!c) return { ok: true, message: "Google Calendar was not connected." };
  await revoke(c.refresh_token);
  const { error } = await db.from("google_calendar").delete().eq("id", 1);
  if (error) throw error;
  cached = null;
  return { ok: true, message: "Google Calendar disconnected. Events already in the calendar stay; new bookings get no invite until you connect again." };
}
