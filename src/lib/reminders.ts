// The reminder wording is shared with the bot: the templates, defaults and fill rules live in
// supabase/functions/_shared/reminders.ts and the dashboard imports that same file, so a preview fills a text exactly as the
// bot will. What follows are the example values a preview fills it with.
import { fmtSlot, fmtSlotAr } from "./format";
import type { Lang } from "./types";

export * from "../../supabase/functions/_shared/reminders";

const CLOSES = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Riyadh" });

/** The close date as the bot writes it: "5 Nov" in Riyadh time, "soon" when the study has none. */
export function fmtCloses(iso: string | null | undefined): string {
  if (!iso) return "soon";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "soon" : CLOSES.format(d);
}

/** A Slack message link in the shape chat.getPermalink returns, built here because only the bot can ask Slack for it. */
export function postLink(workspace: string, channel: string | null, ts: string | null): string {
  if (!channel || !ts) return "";
  const base = (workspace.trim() || "https://walaplus.slack.com").replace(/\/+$/, "");
  return `${base}/archives/${channel}/p${ts.replace(".", "")}`;
}

export interface ExampleStudy {
  id: string;
  title_en: string;
  title_ar: string;
  close_at: string | null;
  slack_channel_id: string | null;
  slack_ts: string | null;
}

export interface ExampleSlot {
  starts_at: string;
  minutes: number;
  place: string;
  meet_url: string | null;
}

/** Stand-ins for a dashboard with no study of the kind yet. */
export const SAMPLE_STUDY: ExampleStudy = {
  id: "sample",
  title_en: "Home screen first impressions",
  title_ar: "الانطباع الأول عن الشاشة الرئيسية",
  close_at: new Date(Date.now() + 3 * 86_400_000).toISOString(),
  slack_channel_id: "C0SAMPLE",
  slack_ts: "1730000000.000100",
};

export const SAMPLE_SESSION: ExampleStudy = {
  id: "sample",
  title_en: "45-minute usability session",
  title_ar: "جلسة اختبار استخدام (45 دقيقة)",
  close_at: new Date(Date.now() + 5 * 86_400_000).toISOString(),
  slack_channel_id: "C0SAMPLE",
  slack_ts: "1730000000.000200",
};

/** Tomorrow at 11:00 Riyadh (08:00 UTC), with the Meet link in the slot's place as admins write it today. */
export function sampleSlot(): ExampleSlot {
  const d = new Date(Date.now() + 86_400_000);
  d.setUTCHours(8, 0, 0, 0);
  return { starts_at: d.toISOString(), minutes: 45, place: "https://meet.google.com/abc-defg-hij", meet_url: null };
}

/** The values remindStudy fills a study reminder with, for one member's language. */
export function studyValues(s: ExampleStudy, channel: string, workspace: string, lang: Lang): Record<string, string> {
  const titleAr = s.title_ar || s.title_en;
  return {
    title: lang === "ar" ? titleAr : s.title_en,
    title_ar: titleAr,
    title_en: s.title_en,
    channel,
    closes: fmtCloses(s.close_at),
    link: postLink(workspace, s.slack_channel_id, s.slack_ts),
  };
}

/** The values sessionReminders fills the day-before reminder with. */
export function sessionValues(s: ExampleStudy, slot: ExampleSlot, lang: Lang): Record<string, string> {
  const titleAr = s.title_ar || s.title_en;
  const time = (lang === "ar" ? fmtSlotAr : fmtSlot)(slot.starts_at, slot.minutes);
  const place = slot.place ?? "";
  return {
    title: lang === "ar" ? titleAr : s.title_en,
    title_ar: titleAr,
    title_en: s.title_en,
    when: `${time}${place ? ` · ${place}` : ""}`,
    time,
    place,
    meet: slot.meet_url ?? "",
  };
}
