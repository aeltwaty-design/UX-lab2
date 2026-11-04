// The wording of the bot's reminder DMs.
// The defaults below are what the bot sent before the wording became editable. An admin can change any text on the
// dashboard's Reminders page; only the texts that differ from these defaults are stored, in the settings row
// "reminder_texts". The edge functions and the dashboard preview both use this file, so it must not import anything.

export type ReminderKey = "profile" | "study_answer" | "study_book" | "session";

export interface ReminderTexts {
  /** Block Kit DM to members without a profile: header, Arabic section, English section, notification line. */
  profile: { header: string; body_ar: string; body_en: string; notify: string };
  /** Plain DM to members who have not answered a live poll, survey or preference test, in their profile language. */
  study_answer: { ar: string; en: string };
  /** Plain DM to members who have not booked a slot in a live session study, in their profile language. */
  study_book: { ar: string; en: string };
  /** Plain DM the day before a booked session, in the member's profile language. */
  session: { ar: string; en: string };
}

export const DEFAULT_REMINDERS: ReminderTexts = {
  profile: {
    header: "⏰ تذكير: ملفك لم يُعبّأ بعد",
    body_ar:
      "*📝 عبّئ ملفك مرة واحدة (دقيقة واحدة)*\nللمشاركة في استطلاعات {channel} ومقارنات التصميم والجلسات، تحتاج أولاً إلى تعبئة ملفك. اضغط الزر وراجع بياناتك قبل الحفظ، فهو يُحفظ مرة واحدة ولا يمكن تغييره ✅\n🔗 كل إجابة ترتبط بملفك، حتى نتابع معك ونفهم تجربة كل فريق.",
    body_en:
      "*⏰ Reminder: your profile is still missing*\nTo take part in the polls, design comparisons and sessions in {channel}, fill in your profile first (one minute, once only). Tap the button and check your details before you save: it is saved once and cannot be changed ✅\n🔗 Every answer is linked to your profile, so we can follow up and see how each team experiences the apps.",
    notify: "⏰ تذكير: عبّئ ملفك للمشاركة في {channel} · Reminder: fill in your profile to take part in {channel}",
  },
  study_answer: {
    ar: 'تذكير لطيف: لم تُجب بعد على "{title}" في {channel}. تُغلق {closes}. {link}',
    en: 'A gentle reminder: you have not answered "{title}" in {channel} yet. It closes {closes}. {link}',
  },
  study_book: {
    ar: 'تذكير لطيف: لم تحجز موعداً بعد في "{title}" في {channel}. تُغلق {closes}. {link}',
    en: 'A gentle reminder: you have not booked a slot for "{title}" in {channel} yet. It closes {closes}. {link}',
  },
  session: {
    ar: 'تذكير: جلسة "{title}" {when}.\nرابط Google Meet: {meet}\nإن لم تستطع الحضور، ألغِ الحجز من رسالة التأكيد.',
    en: 'Reminder: your session "{title}" is {when}.\nGoogle Meet: {meet}\nIf you cannot make it, cancel from the booking message.',
  },
};

/** What each placeholder stands for, by reminder. Anything else in braces is refused when saving. */
export const PLACEHOLDERS: Record<ReminderKey, Record<string, string>> = {
  profile: { channel: "The channel name, e.g. #ux-hub" },
  study_answer: {
    title: "The study title in the member's language (Arabic falls back to English)",
    title_ar: "The Arabic title",
    title_en: "The English title",
    channel: "The channel name",
    closes: "The close date, e.g. 5 Nov",
    link: "Link to the study post in the channel",
  },
  study_book: {
    title: "The study title in the member's language (Arabic falls back to English)",
    title_ar: "The Arabic title",
    title_en: "The English title",
    channel: "The channel name",
    closes: "The close date, e.g. 5 Nov",
    link: "Link to the study post in the channel",
  },
  session: {
    title: "The study title in the member's language (Arabic falls back to English)",
    title_ar: "The Arabic title",
    title_en: "The English title",
    when: "Day and time, then the slot's place, e.g. Wed 4 Nov · 11:00–11:45 · meet.google.com/…",
    time: "Day and time only, Riyadh",
    place: "The slot's place or link, empty if none",
    meet: "The Google Meet link of the calendar invite, empty unless Google Calendar is connected",
  },
};

/** Slack limits: a header block takes 150 characters, a section 3,000. */
export const HEADER_MAX = 150;
export const TEXT_MAX = 3000;

/**
 * The fixed parts of the profile reminder, shared with the welcome post. They are not editable, and they live here so the
 * dashboard preview shows exactly what the bot sends.
 */
export const PROFILE_BUTTON = "✍️ عبّئ ملفي · Fill in my profile";
export const PROFILE_FOOTER =
  "🔒 لا نطلب أبداً رقم PIN أو رمز التحقق أو بيانات البطاقة أو كلمة المرور. يمكنك طلب حذف بياناتك في أي وقت.\nNever asked: PIN, OTP, card or password. You can ask to be forgotten at any time.";

/** The saved overrides on top of the defaults. Empty or missing texts fall back to the default. */
export function mergeReminders(saved: unknown): ReminderTexts {
  const out = JSON.parse(JSON.stringify(DEFAULT_REMINDERS)) as ReminderTexts;
  if (!saved || typeof saved !== "object") return out;
  const src = saved as Record<string, unknown>;
  for (const key of Object.keys(out) as ReminderKey[]) {
    const part = src[key];
    if (!part || typeof part !== "object") continue;
    const target = out[key] as unknown as Record<string, string>;
    for (const field of Object.keys(target)) {
      const v = (part as Record<string, unknown>)[field];
      if (typeof v === "string" && v.trim()) target[field] = v;
    }
  }
  return out;
}

/** Only the texts that differ from the defaults, which is what gets stored. */
export function reminderOverrides(texts: ReminderTexts): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const key of Object.keys(DEFAULT_REMINDERS) as ReminderKey[]) {
    const def = DEFAULT_REMINDERS[key] as unknown as Record<string, string>;
    const cur = texts[key] as unknown as Record<string, string>;
    for (const field of Object.keys(def)) {
      const v = (cur[field] ?? "").trim();
      if (v && v !== def[field].trim()) (out[key] ??= {})[field] = cur[field];
    }
  }
  return out;
}

const TOKEN = /\{(\w+)\}/g;

/** Placeholders in a text that the reminder does not know. */
export function unknownPlaceholders(text: string, key: ReminderKey): string[] {
  const known = PLACEHOLDERS[key];
  const bad = new Set<string>();
  for (const m of text.matchAll(TOKEN)) if (!Object.hasOwn(known, m[1])) bad.add(m[1]);
  return [...bad];
}

/**
 * Fills the placeholders. A line whose placeholders are all empty is left out, so "Google Meet: {meet}" disappears
 * when there is no Meet link. Unknown placeholders stay as typed.
 */
export function fillReminder(text: string, values: Record<string, string>): string {
  const lines: string[] = [];
  for (const line of text.split("\n")) {
    const used = [...line.matchAll(TOKEN)].map((m) => m[1]).filter((k) => Object.hasOwn(values, k));
    if (used.length && used.every((k) => !values[k])) continue;
    lines.push(line.replace(TOKEN, (whole, k: string) => (Object.hasOwn(values, k) ? values[k] : whole)).replace(/[ \t]+$/, ""));
  }
  return lines.join("\n").trim();
}
