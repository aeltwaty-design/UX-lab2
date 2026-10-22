// Block Kit builders. Every message is bilingual: English line, Arabic line.
import type { Block } from "./slack.ts";
import { fmtDate, smallGroup, type Participant, type Question, type Settings, type Study } from "./db.ts";

const AGE_BANDS = ["18-24", "25-34", "35-44", "45+"];

const bi = (en: string, ar: string) => (ar ? `${en}\n${ar}` : en);
const pt = (text: string, emoji = true) => ({ type: "plain_text", text: text.slice(0, 75), emoji });
const md = (text: string) => ({ type: "section", text: { type: "mrkdwn", text } });
const ctx = (text: string) => ({ type: "context", elements: [{ type: "mrkdwn", text }] });

function optionLabel(en: string, ar: string): string {
  return ar ? `${en} · ${ar}` : en;
}

/** The channel post for a poll or survey. `closed` swaps the buttons for a closing line. */
export function studyBlocks(study: Study, settings: Settings, closed = false, answered = 0): Block[] {
  const blocks: Block[] = [{ type: "header", text: pt(study.title_en || "Study", true) }];
  const intro = [study.title_ar, study.intro_en, study.intro_ar].filter(Boolean).join("\n");
  if (intro) blocks.push(md(intro));

  const q = study.questions[0];
  if (study.type === "poll" && q) {
    blocks.push(md(`*${q.text_en}*${q.text_ar ? `\n${q.text_ar}` : ""}`));
    if (!closed)
      blocks.push({
        type: "actions",
        block_id: `poll:${study.id}`,
        elements: q.options.slice(0, 10).map((o) => ({
          type: "button",
          text: pt(optionLabel(o.label_en, o.label_ar)),
          action_id: `poll:${study.id}:${o.id}`,
          value: o.id,
        })),
      });
  } else if (!closed) {
    blocks.push({
      type: "actions",
      block_id: `survey:${study.id}`,
      elements: [
        { type: "button", style: "primary", text: pt("Answer · أجب"), action_id: `survey:${study.id}`, value: study.id },
      ],
    });
    blocks.push(ctx(`${study.questions.length} question${study.questions.length === 1 ? "" : "s"} · under 10 minutes`));
  }

  blocks.push(
    closed
      ? ctx(`Closed · ${smallGroup(answered, settings.small_group)} answered · results come back here. Thank you.\nأُغلقت الدراسة. شكراً لكل من أجاب.`)
      : ctx(`Closes ${fmtDate(study.close_at)} · answers are linked to your profile · results come back in this channel\nتُغلق ${fmtDate(study.close_at)} · إجاباتك مرتبطة بملفك · النتائج تعود هنا`),
  );
  return blocks;
}

/** Channel or DM message asking a member to fill in the profile. */
export function profilePromptBlocks(settings: Settings): Block[] {
  return [
    md(bi(
      `*Before your first answer, fill in a short profile (one minute, once).*\nName, age, gender and phone. Every answer you give in ${settings.channel_name} is linked to it, so we can follow up and see how each group experiences the apps.`,
      `*قبل أول إجابة، عبّئ ملفاً قصيراً (دقيقة واحدة، مرة واحدة).*\nالاسم والعمر والجنس والهاتف. كل إجابة تقدّمها مرتبطة به.`,
    )),
    {
      type: "actions",
      block_id: "profile",
      elements: [{ type: "button", style: "primary", text: pt("Fill in my profile · عبّئ ملفي"), action_id: "profile:open", value: "open" }],
    },
    ctx("Never asked: PIN, OTP, card or password. You can ask to be forgotten at any time."),
  ];
}

export interface Pending {
  kind: "poll" | "survey";
  study_id: string;
  option_id?: string;
  channel?: string;
}

const select = (block_id: string, label: string, options: { value: string; text: string }[], initial?: string, optional = false) => ({
  type: "input",
  block_id,
  optional,
  label: pt(label),
  element: {
    type: "static_select",
    action_id: "v",
    options: options.map((o) => ({ text: pt(o.text), value: o.value })),
    ...(initial ? { initial_option: { text: pt(options.find((o) => o.value === initial)?.text ?? initial), value: initial } } : {}),
  },
});

export function profileModal(settings: Settings, prefillName: string, existing: Participant | null, pending: Pending | null, channel: string): Block {
  const teams = settings.teams.length ? settings.teams : ["Other"];
  return {
    type: "modal",
    callback_id: "profile",
    private_metadata: JSON.stringify({ pending, channel }),
    title: pt("Your profile"),
    submit: pt("Save · حفظ"),
    close: pt("Cancel"),
    blocks: [
      md(bi("Once only. Every answer you give is linked to this profile.", "مرة واحدة فقط. كل إجابة تقدّمها مرتبطة بهذا الملف.")),
      {
        type: "input",
        block_id: "name",
        label: pt("Name · الاسم"),
        element: { type: "plain_text_input", action_id: "v", initial_value: existing?.name ?? prefillName, max_length: 80 },
      },
      select("age_band", "Age · العمر", AGE_BANDS.map((a) => ({ value: a, text: a })), existing?.age_band),
      select("gender", "Gender · الجنس", [{ value: "female", text: "Female · أنثى" }, { value: "male", text: "Male · ذكر" }], existing?.gender),
      select("device", "Phone · الهاتف", [{ value: "iphone", text: "iPhone" }, { value: "android", text: "Android" }], existing?.device),
      select("team", "Team · الفريق", teams.map((t) => ({ value: t, text: t })), existing?.team ?? undefined, true),
      {
        type: "input",
        block_id: "apps",
        optional: true,
        label: pt("Apps you use · التطبيقات"),
        element: {
          type: "checkboxes",
          action_id: "v",
          options: [
            { text: pt("WalaPlus"), value: "walaplus" },
            { text: pt("WalaOne"), value: "walaone" },
          ],
          ...(existing?.apps?.length
            ? { initial_options: existing.apps.map((a) => ({ text: pt(a === "walaone" ? "WalaOne" : "WalaPlus"), value: a })) }
            : {}),
        },
      },
      select("language", "Language · اللغة", [{ value: "en", text: "English" }, { value: "ar", text: "العربية" }], existing?.language ?? settings.default_lang),
      {
        type: "input",
        block_id: "sessions_ok",
        optional: true,
        label: pt("Sessions · الجلسات"),
        element: {
          type: "checkboxes",
          action_id: "v",
          options: [{ text: pt("Happy to join a 30-minute session · أرحّب بجلسة 30 دقيقة"), value: "yes" }],
          ...(existing?.sessions_ok ? { initial_options: [{ text: pt("Happy to join a 30-minute session · أرحّب بجلسة 30 دقيقة"), value: "yes" }] } : {}),
        },
      },
    ],
  };
}

function questionInput(q: Question): Block {
  const label = pt(q.text_en.slice(0, 150) || "Question");
  const hint = q.text_ar ? { hint: pt(q.text_ar) } : {};
  const base = { type: "input", block_id: q.id, optional: !q.required, label, ...hint };
  if (q.kind === "single")
    return { ...base, element: { type: "radio_buttons", action_id: "v", options: q.options.slice(0, 10).map((o) => ({ text: pt(optionLabel(o.label_en, o.label_ar)), value: o.id })) } };
  if (q.kind === "multi")
    return { ...base, element: { type: "checkboxes", action_id: "v", options: q.options.slice(0, 10).map((o) => ({ text: pt(optionLabel(o.label_en, o.label_ar)), value: o.id })) } };
  if (q.kind === "scale")
    return { ...base, element: { type: "radio_buttons", action_id: "v", options: ["1", "2", "3", "4", "5"].map((v) => ({ text: pt(v === "1" ? "1 · hard · صعب" : v === "5" ? "5 · easy · سهل" : v), value: v })) } };
  if (q.kind === "yesno")
    return { ...base, element: { type: "radio_buttons", action_id: "v", options: [{ text: pt("Yes · نعم"), value: "1" }, { text: pt("No · لا"), value: "0" }] } };
  return { ...base, element: { type: "plain_text_input", action_id: "v", multiline: true, max_length: 500 } };
}

export function surveyModal(study: Study, channel: string): Block {
  return {
    type: "modal",
    callback_id: `survey:${study.id}`,
    private_metadata: JSON.stringify({ channel }),
    title: pt((study.title_en || "Survey").slice(0, 24)),
    submit: pt("Send · إرسال"),
    close: pt("Cancel"),
    blocks: [
      ...(study.intro_en || study.intro_ar ? [md(bi(study.intro_en, study.intro_ar))] : []),
      ...study.questions.map(questionInput),
      ctx("Your answers are linked to your profile. Only the research team sees names; the channel sees totals."),
    ],
  };
}

/** Totals block for a results post. Small groups are written as "under N". */
export function totalsText(study: Study, responses: { answers: { question_id: string; option_id: string | null; value_num: number | null }[] }[], threshold: number): string {
  const lines: string[] = [];
  for (const q of study.questions) {
    if (q.kind === "text") continue;
    lines.push(`*${q.text_en}*`);
    const counts = new Map<string, number>();
    const bump = (k: string) => counts.set(k, (counts.get(k) ?? 0) + 1);
    const vals: number[] = [];
    for (const r of responses)
      for (const a of r.answers) {
        if (a.question_id !== q.id) continue;
        if (q.kind === "single" || q.kind === "multi") {
          if (a.option_id) bump(a.option_id);
        } else if (q.kind === "scale") {
          if (a.value_num != null) {
            bump(String(a.value_num));
            vals.push(a.value_num);
          }
        } else if (q.kind === "yesno") bump(a.value_num === 1 ? "yes" : "no");
      }
    const rows: { label: string; n: number }[] =
      q.kind === "single" || q.kind === "multi"
        ? q.options.map((o) => ({ label: o.label_en, n: counts.get(o.id) ?? 0 }))
        : q.kind === "scale"
          ? ["1", "2", "3", "4", "5"].map((k) => ({ label: k, n: counts.get(k) ?? 0 }))
          : [{ label: "Yes", n: counts.get("yes") ?? 0 }, { label: "No", n: counts.get("no") ?? 0 }];
    const total = q.kind === "multi" ? responses.length : rows.reduce((s, r) => s + r.n, 0);
    for (const r of rows) {
      const bar = "▇".repeat(Math.round((10 * r.n) / Math.max(1, total)));
      const p = r.n < threshold ? "" : ` (${Math.round((100 * r.n) / Math.max(1, total))}%)`;
      lines.push(`${bar || "·"} ${r.label}: ${smallGroup(r.n, threshold)}${p}`);
    }
    if (vals.length) lines.push(`Average ${Math.round((10 * vals.reduce((s, v) => s + v, 0)) / vals.length) / 10} out of 5`);
    lines.push("");
  }
  return lines.join("\n").trim();
}

export function resultsBlocks(study: Study, body_en: string, body_ar: string, totals: string | null, answered: number, threshold: number): Block[] {
  const blocks: Block[] = [{ type: "header", text: pt(`Results: ${study.title_en}`.slice(0, 150)) }, md(body_en)];
  if (body_ar) blocks.push(md(body_ar));
  if (totals) blocks.push({ type: "divider" }, md(totals.slice(0, 2900)));
  blocks.push(ctx(`${smallGroup(answered, threshold)} answered · thank you · شكراً لكم`));
  return blocks;
}
