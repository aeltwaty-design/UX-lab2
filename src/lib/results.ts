import type { Participant, ProfileSnapshot, Question, Response } from "./types";

export type SplitKey = "none" | "age_band" | "gender" | "device" | "team" | "apps";

export const SPLITS: { value: SplitKey; label: string }[] = [
  { value: "none", label: "No split" },
  { value: "age_band", label: "Age" },
  { value: "gender", label: "Gender" },
  { value: "device", label: "Device" },
  { value: "team", label: "Team" },
  { value: "apps", label: "App used" },
];

export function segmentOf(p: ProfileSnapshot, key: SplitKey): string[] {
  switch (key) {
    case "age_band":
      return [p.age_band];
    case "gender":
      return [p.gender === "female" ? "Female" : "Male"];
    case "device":
      return [p.device === "iphone" ? "iPhone" : "Android"];
    case "team":
      return [p.team || "No team"];
    case "apps":
      return p.apps.length ? p.apps.map((a) => (a === "walaplus" ? "WalaPlus" : "WalaOne")) : ["Neither"];
    default:
      return ["All"];
  }
}

export interface OptionCount {
  key: string;
  label: string;
  count: number;
}

/** Counts answers to one question, optionally restricted to one segment. */
export function tally(q: Question, responses: Response[]): OptionCount[] {
  const counts = new Map<string, number>();
  const bump = (k: string) => counts.set(k, (counts.get(k) ?? 0) + 1);
  for (const r of responses) {
    for (const a of r.answers) {
      if (a.question_id !== q.id) continue;
      if (q.kind === "single" || q.kind === "multi") {
        if (a.option_id) bump(a.option_id);
      } else if (q.kind === "scale") {
        if (a.value_num != null) bump(String(a.value_num));
      } else if (q.kind === "yesno") {
        bump(a.value_num === 1 ? "yes" : "no");
      }
    }
  }
  if (q.kind === "single" || q.kind === "multi")
    return q.options.map((o) => ({ key: o.id, label: o.label_en, count: counts.get(o.id) ?? 0 }));
  if (q.kind === "scale")
    return ["1", "2", "3", "4", "5"].map((k) => ({ key: k, label: k === "1" ? "1 · hard" : k === "5" ? "5 · easy" : k, count: counts.get(k) ?? 0 }));
  if (q.kind === "yesno")
    return [
      { key: "yes", label: "Yes", count: counts.get("yes") ?? 0 },
      { key: "no", label: "No", count: counts.get("no") ?? 0 },
    ];
  return [];
}

export function textAnswers(q: Question, responses: Response[]): { who: string; text: string; when: string }[] {
  const out: { who: string; text: string; when: string }[] = [];
  for (const r of responses)
    for (const a of r.answers)
      if (a.question_id === q.id && a.value_text?.trim())
        out.push({ who: r.profile.name, text: a.value_text.trim(), when: r.submitted_at });
  return out;
}

/** Average of a 1 to 5 scale question, one decimal. */
export function scaleMean(q: Question, responses: Response[]): number | null {
  const vals: number[] = [];
  for (const r of responses) for (const a of r.answers) if (a.question_id === q.id && a.value_num != null) vals.push(a.value_num);
  if (!vals.length) return null;
  return Math.round((10 * vals.reduce((s, v) => s + v, 0)) / vals.length) / 10;
}

/** Group participants by a profile field. */
export function groupBy<T extends ProfileSnapshot>(rows: T[], key: SplitKey): { label: string; count: number }[] {
  const m = new Map<string, number>();
  for (const r of rows) for (const seg of segmentOf(r, key)) m.set(seg, (m.get(seg) ?? 0) + 1);
  return [...m.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
}

export function profileOf(p: Participant): ProfileSnapshot {
  return { name: p.name, age_band: p.age_band, gender: p.gender, device: p.device, team: p.team, apps: p.apps, language: p.language };
}

/** Answer summary for the "who answered" table. */
export function answerSummary(q: Question | undefined, r: Response): string {
  if (!q) return "";
  const mine = r.answers.filter((a) => a.question_id === q.id);
  if (!mine.length) return "—";
  if (q.kind === "single" || q.kind === "multi")
    return mine.map((a) => q.options.find((o) => o.id === a.option_id)?.label_en ?? "?").join(", ");
  if (q.kind === "scale") return `${mine[0]!.value_num} / 5`;
  if (q.kind === "yesno") return mine[0]!.value_num === 1 ? "Yes" : "No";
  return mine[0]!.value_text ?? "";
}
