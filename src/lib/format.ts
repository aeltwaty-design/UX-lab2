import type { StudyStatus, StudyType } from "./types";

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return DATE.format(new Date(iso));
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return DATE_TIME.format(new Date(iso));
}

const RIYADH = "Asia/Riyadh";
const SLOT_DAY = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: RIYADH });
const SLOT_TIME = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: RIYADH });

/** "Sun 2 Nov · 10:00–10:30" in Riyadh time, the same words the bot posts. */
export function fmtSlot(startsAt: string, minutes: number): string {
  const start = new Date(startsAt);
  if (Number.isNaN(start.getTime())) return "—";
  const end = new Date(start.getTime() + minutes * 60_000);
  return `${SLOT_DAY.format(start)} · ${SLOT_TIME.format(start)}–${SLOT_TIME.format(end)}`;
}

/** Value for an <input type="datetime-local"> from an ISO string, in local time. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
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
