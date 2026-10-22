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
export function runChecks(study: Study | StudyWithQuestions, questions: Question[]): Check[] {
  const out: Check[] = [];
  if (!study.title_en.trim()) out.push({ level: "error", text: "English title is empty." });
  if (!study.title_ar.trim()) out.push({ level: "warn", text: "Arabic title is empty. The post will show English only." });
  if (questions.length === 0) out.push({ level: "error", text: "Add at least one question." });
  if (study.type === "poll" && questions.length > 1)
    out.push({ level: "error", text: "A poll has exactly one question. Use a survey for more." });
  if (study.type === "survey" && questions.length > 8)
    out.push({ level: "error", text: "A survey has at most eight questions." });

  const texts = [study.title_en, study.title_ar, study.intro_en, study.intro_ar];
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
  if (texts.some(isBad))
    out.push({ level: "error", text: "A question mentions PIN, OTP, card or password. Studies never ask for these." });

  if (study.close_at && study.publish_at && new Date(study.close_at) <= new Date(study.publish_at))
    out.push({ level: "error", text: "Close date must be after the publish date." });
  if (!study.close_at) out.push({ level: "warn", text: "No close date. You will close it by hand." });
  return out;
}
