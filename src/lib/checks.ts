import type { SlotDraft } from "./preview";
import type { Question, Study, StudyWithQuestions } from "./types";

/** Words a study must never ask for. Checked in English and Arabic. */
const BAD_EN = /\b(pin|otp|card|password|cvv|iban)\b/i;
const BAD_AR = /(رقم سري|كلمة المرور|كلمة السر|رمز التحقق|بطاقة|الرقم السري)/;

export function isBad(text: string): boolean {
  return BAD_EN.test(text) || BAD_AR.test(text);
}

export interface Check {
  level: "error" | "warn";
  text: string;
}

/** Pre-flight checks shown in the builder. Errors block publishing. */
/** `published`: the study is already in the channel, so slots that have already happened are not errors (new slots still are). */
export function runChecks(study: Study | StudyWithQuestions, questions: Question[], slots: SlotDraft[] = [], opts: { published?: boolean } = {}): Check[] {
  const out: Check[] = [];
  const texts = [study.title_en, study.title_ar, study.intro_en, study.intro_ar];
  if (!study.title_en.trim()) out.push({ level: "error", text: "English title is empty." });
  if (!study.title_ar.trim()) out.push({ level: "warn", text: "Arabic title is empty. The post will show English only." });

  if (study.type === "session_recruitment") {
    // Sessions have slots, not questions.
    const now = Date.now();
    if (slots.length === 0) out.push({ level: "error", text: "Add at least one session slot." });
    slots.forEach((s, i) => {
      const t = new Date(s.starts_at).getTime();
      if (Number.isNaN(t)) out.push({ level: "error", text: `Slot ${i + 1} has no date.` });
      else if (t < now && (!opts.published || s.id.startsWith("tmp-"))) out.push({ level: "error", text: `Slot ${i + 1} is in the past.` });
      if (study.close_at && !Number.isNaN(t) && t < new Date(study.close_at).getTime())
        out.push({ level: "warn", text: `Slot ${i + 1} starts before the round closes; bookings stop when the slot starts.` });
      texts.push(s.place);
    });
    const times = slots.map((s) => s.starts_at);
    if (new Set(times).size !== times.length) out.push({ level: "warn", text: "Two slots start at the same time. Use capacity instead, unless they are in different places." });
  } else if (study.type === "preference_test") {
    const q = questions[0];
    if (!q) out.push({ level: "error", text: "Write the question the images answer." });
    if (questions.length > 1) out.push({ level: "error", text: "A preference test has one question. The images are its options." });
    if (q) {
      texts.push(q.text_en, q.text_ar);
      if (!q.text_en.trim()) out.push({ level: "error", text: "The question has no English text." });
      const withImage = q.options.filter((o) => o.image_url);
      if (withImage.length < 2) out.push({ level: "error", text: "Upload at least two images." });
      if (withImage.length > 6) out.push({ level: "error", text: "At most six images; Slack posts get long." });
      q.options.forEach((o, i) => {
        if (o.image_url && !o.label_en.trim()) out.push({ level: "error", text: `Image ${i + 1} needs a short label; it becomes the button.` });
        if (!o.image_url && o.label_en.trim()) out.push({ level: "warn", text: `Option ${i + 1} has a label but no image, so it will not be posted.` });
        texts.push(o.label_en, o.label_ar);
      });
    }
  } else {
    if (questions.length === 0) out.push({ level: "error", text: "Add at least one question." });
    if (study.type === "poll" && questions.length > 1)
      out.push({ level: "error", text: "A poll has exactly one question. Use a survey for more." });
    if (study.type === "survey" && questions.length > 8)
      out.push({ level: "error", text: "A survey has at most eight questions." });
    questions.forEach((q, i) => {
      texts.push(q.text_en, q.text_ar);
      if (!q.text_en.trim()) out.push({ level: "error", text: `Question ${i + 1} has no English text.` });
      if (["single", "multi"].includes(q.kind)) {
        const filled = q.options.filter((o) => o.label_en.trim());
        if (filled.length < 2) out.push({ level: "error", text: `Question ${i + 1} needs at least two options.` });
        if (filled.length > 10) out.push({ level: "error", text: `Question ${i + 1} has more than ten options.` });
        q.options.forEach((o) => texts.push(o.label_en, o.label_ar));
      }
    });
  }

  if (texts.some(isBad))
    out.push({ level: "error", text: "A question mentions PIN, OTP, card or password. Studies never ask for these." });

  if (study.close_at && study.publish_at && new Date(study.close_at) <= new Date(study.publish_at))
    out.push({ level: "error", text: "Close date must be after the publish date." });
  if (!study.close_at) out.push({ level: "warn", text: "No close date. You will close it by hand." });
  return out;
}
