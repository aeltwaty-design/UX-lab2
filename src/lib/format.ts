import type { StudyStatus, StudyType } from "./types";

// Every date and time on the dashboard is Riyadh time, like the bot's posts, whatever time zone the admin's computer is in.
const RIYADH = "Asia/Riyadh";
const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: RIYADH });
const DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: RIYADH,
});

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return DATE.format(new Date(iso));
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return DATE_TIME.format(new Date(iso));
}

const SLOT_DAY = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: RIYADH });
const SLOT_TIME = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: RIYADH });

/** "Sun 2 Nov · 10:00–10:30" in Riyadh time, the same words the bot posts. */
export function fmtSlot(startsAt: string, minutes: number): string {
  const start = new Date(startsAt);
  if (Number.isNaN(start.getTime())) return "—";
  const end = new Date(start.getTime() + minutes * 60_000);
  return `${SLOT_DAY.format(start)} · ${SLOT_TIME.format(start)}–${SLOT_TIME.format(end)}`;
}

/** Riyadh is UTC+3 all year (no daylight saving). */
const RIYADH_OFFSET = 3 * 3_600_000;

/** Value for an <input type="datetime-local"> from an ISO string, in Riyadh time. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  return new Date(t + RIYADH_OFFSET).toISOString().slice(0, 16);
}

/** An <input type="datetime-local"> value, read as Riyadh time, to an ISO string. */
export function fromLocalInput(v: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v);
  if (!m) return null;
  const t = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!) - RIYADH_OFFSET;
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export function pct(n: number, total: number): number {
  if (!total) return 0;
  return Math.round((100 * n) / total);
}

/** The channel never sees a group smaller than the threshold as a number. */
export function smallGroup(n: number, threshold: number): string {
  return n < threshold ? `under ${threshold}` : String(n);
}

export function typeLabel(t: StudyType): string {
  return (
    {
      poll: "Poll",
      survey: "Survey",
      preference_test: "Preference test",
      session_recruitment: "Session recruitment",
      friction_report: "Friction report",
    } as const
  )[t];
}

export function statusTone(s: StudyStatus): "draft" | "scheduled" | "live" | "closed" | "reported" {
  return s;
}

export function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("");
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
