// Block Kit builders. Every message is bilingual: English line, Arabic line.
import type { Block } from "./slack.ts";
import { fmtDate, fmtSlot, smallGroup, type Option, type Question, type SessionSlot, type Settings, type SlotWithBookings, type Study } from "./db.ts";

const AGE_BANDS = ["18-24", "25-34", "35-44", "45+"];
const LETTERS = ["A", "B", "C", "D", "E", "F"];

const bi = (en: string, ar: string) => (ar ? `${en}\n${ar}` : en);
const pt = (text: string, emoji = true) => ({ type: "plain_text", text: text.slice(0, 75), emoji });
const md = (text: string) => ({ type: "section", text: { type: "mrkdwn", text } });
const ctx = (text: string) => ({ type: "context", elements: [{ type: "mrkdwn", text }] });

function optionLabel(en: string, ar: string): string {
  return ar ? `${en} · ${ar}` : en;
}

const select = (block_id: string, label: string, options: { value: string; text: string }[], initial?: string) => ({
  type: "input",
  block_id,
  label: pt(label),
  element: {
    type: "static_select",
    action_id: "v",
    options: options.map((o) => ({ text: pt(o.text), value: o.value })),
    ...(initial ? { initial_option: { text: pt(options.find((o) => o.value === initial)?.text ?? initial), value: initial } } : {}),
  },
});

/** The channel post for any study type. `closed` swaps the controls for a closing line. `slots` only matter for session recruitment. */
export function studyBlocks(study: Study, settings: Settings, closed = false, answered = 0, slots: SlotWithBookings[] = []): Block[] {
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
  } else if (study.type === "preference_test" && q) {
    blocks.push(md(`*${q.text_en}*${q.text_ar ? `\n${q.text_ar}` : ""}`));
    const opts = q.options.filter((o) => o.image_url).slice(0, 6);
    // One picture with the options side by side, built by the dashboard on save. Without it, one image block each
    // (Slack stacks them) and the buttons carry the labels alone.
    const sheet = Boolean(study.compare_url);
    const name = (o: Option, i: number) => `${sheet ? `${LETTERS[i]} · ` : ""}${optionLabel(o.label_en, o.label_ar) || `Option ${i + 1}`}`;
    if (sheet) blocks.push({ type: "image", image_url: study.compare_url, alt_text: opts.map(name).join(", ").slice(0, 2000) });
    else opts.forEach((o, i) => blocks.push({ type: "image", image_url: o.image_url, alt_text: name(o, i), title: pt(name(o, i)) }));
    if (!closed)
      blocks.push({
        type: "actions",
        block_id: `poll:${study.id}`,
        elements: opts.map((o, i) => ({
          type: "button",
          text: pt(name(o, i)),
          action_id: `poll:${study.id}:${o.id}`,
          value: o.id,
        })),
      });
  } else if (study.type === "session_recruitment") {
    const lines = slots.map((s) => {
      const full = s.booked >= s.capacity;
      const line = `${fmtSlot(s.starts_at, s.minutes)}${s.place ? ` · ${s.place}` : ""} · ${full ? "full" : `${s.capacity - s.booked} of ${s.capacity} free`}`;
      return full ? `~${line}~` : line;
    });
    if (lines.length) blocks.push(md(lines.join("\n")));
    const open = slots.filter((s) => s.booked < s.capacity && new Date(s.starts_at).getTime() > Date.now());
    if (!closed && open.length)
      blocks.push({
        type: "section",
        block_id: `session:${study.id}`,
        text: { type: "mrkdwn", text: "*Pick a time · اختر وقتاً*\nOne slot each. You get a DM with the details and a cancel button." },
        accessory: {
          type: "static_select",
          action_id: `session:pick:${study.id}`,
          placeholder: pt("Choose a slot"),
          options: open.slice(0, 100).map((s) => ({ text: pt(fmtSlot(s.starts_at, s.minutes)), value: s.id })),
        },
      });
    else if (!closed) blocks.push(md("All sessions are booked. Thank you · اكتملت الحجوزات، شكراً لكم"));
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

  const sessions = study.type === "session_recruitment";
  const finalAnswers = !sessions && study.allow_changes === false;
  blocks.push(
    closed
      ? ctx(`Closed · ${smallGroup(answered, settings.small_group)} ${sessions ? "booked" : "answered"} · results come back here. Thank you.\nأُغلقت الدراسة. شكراً لكل من شارك.`)
      : ctx(`Closes ${fmtDate(study.close_at)} · ${sessions ? "bookings" : "answers"} are linked to your profile${finalAnswers ? " · answers are final" : ""} · results come back in this channel\nتُغلق ${fmtDate(study.close_at)} · مشاركتك مرتبطة بملفك${finalAnswers ? " · الإجابات نهائية" : ""} · النتائج تعود هنا`),
  );
  return blocks;
}

/** Channel or DM message asking a member to fill in the profile. */
export function profilePromptBlocks(settings: Settings): Block[] {
  return [
    md(bi(
      `*Before your first answer, fill in a short profile (one minute, once).*\nName, age band, gender, phone type, team and the apps you use; all fields are required. It is saved once and cannot be changed afterwards, so check it before you save. Every answer you give in ${settings.channel_name} is linked to it, so we can follow up and see how each group experiences the apps.`,
      `*قبل أول إجابة، عبّئ ملفاً قصيراً (دقيقة واحدة، مرة واحدة).*\nالاسم والفئة العمرية والجنس ونوع الهاتف والفريق والتطبيقات؛ كل الحقول مطلوبة. يُحفظ مرة واحدة ولا يمكن تغييره بعد ذلك، فراجعه قبل الحفظ. كل إجابة تقدّمها مرتبطة به.`,
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
  kind: "poll" | "survey" | "friction" | "session";
  study_id: string;
  option_id?: string;
  slot_id?: string;
  channel?: string;
}

/** The profile form. It is filled in once: after Save the row is final (the bot refuses to reopen it and the database refuses changes). */
export function profileModal(settings: Settings, prefillName: string, pending: Pending | null, channel: string): Block {
  const teams = settings.teams.length ? settings.teams : ["Other"];
  return {
    type: "modal",
    callback_id: "profile",
    private_metadata: JSON.stringify({ pending, channel }),
    title: pt("Your profile"),
    submit: pt("Save · حفظ"),
    close: pt("Cancel"),
    blocks: [
      md(bi("Once only: after Save the profile is final and cannot be changed. All fields are required. Every answer you give is linked to this profile.", "مرة واحدة فقط: بعد الحفظ يصبح الملف نهائياً ولا يمكن تغييره. كل الحقول مطلوبة. كل إجابة تقدّمها مرتبطة بهذا الملف.")),
      {
        type: "input",
        block_id: "name",
        label: pt("Name · الاسم"),
        element: { type: "plain_text_input", action_id: "v", ...(prefillName ? { initial_value: prefillName } : {}), max_length: 80 },
      },
      select("age_band", "Age · العمر", AGE_BANDS.map((a) => ({ value: a, text: a }))),
      select("gender", "Gender · الجنس", [{ value: "female", text: "Female · أنثى" }, { value: "male", text: "Male · ذكر" }]),
      select("device", "Phone type · نوع الهاتف", [{ value: "iphone", text: "iPhone" }, { value: "android", text: "Android" }]),
      select("team", "Team · الفريق", teams.map((t) => ({ value: t, text: t }))),
      {
        type: "input",
        block_id: "apps",
        label: pt("Apps you use · التطبيقات"),
        element: {
          type: "checkboxes",
          action_id: "v",
          options: [
            { text: pt("WalaPlus"), value: "walaplus" },
            { text: pt("WalaOne"), value: "walaone" },
          ],
        },
      },
      select("language", "Language · اللغة", [{ value: "en", text: "English" }, { value: "ar", text: "العربية" }], settings.default_lang),
    ],
  };
}

/** The /friction form. `withFile` adds the screenshot field, which Slack only accepts when the app has files:read. */
export function frictionModal(channel: string, withFile: boolean): Block {
  return {
    type: "modal",
    callback_id: "friction",
    private_metadata: JSON.stringify({ channel }),
    title: pt("Report a broken step"),
    submit: pt("Send · إرسال"),
    close: pt("Cancel"),
    blocks: [
      md(bi("One minute. Say what you tried and what happened; the research team replies by DM.", "دقيقة واحدة. اذكر ما حاولت فعله وما الذي حدث؛ يرد فريق البحث برسالة خاصة.")),
      select("app", "App · التطبيق", [{ value: "walaplus", text: "WalaPlus" }, { value: "walaone", text: "WalaOne" }]),
      {
        type: "input",
        block_id: "tried",
        label: pt("What did you try to do? · ماذا حاولت أن تفعل؟"),
        element: { type: "plain_text_input", action_id: "v", max_length: 300, placeholder: pt("e.g. redeem the Jarir offer") },
      },
      {
        type: "input",
        block_id: "happened",
        label: pt("What happened instead? · ماذا حدث؟"),
        element: { type: "plain_text_input", action_id: "v", multiline: true, max_length: 1000 },
      },
      ...(withFile
        ? [{
          type: "input",
          block_id: "shot",
          optional: true,
          label: pt("Screenshot · لقطة شاشة"),
          element: { type: "file_input", action_id: "v", filetypes: ["png", "jpg", "jpeg", "gif", "webp", "heic"], max_files: 1 },
        }]
        : []),
      ctx("Never include a PIN, OTP, card number or password."),
    ],
  };
}

/** The pinned channel post that invites friction reports. */
export function frictionPromptBlocks(): Block[] {
  return [
    md(bi(
      "*Something broken in WalaPlus or WalaOne?* Report it in one minute: what you tried, what happened, a screenshot if you have one. The research team replies by DM.",
      "*هل تعطّلت خطوة في ولاء بلس أو ولاء ون؟* أبلغ عنها في دقيقة: ما حاولت فعله، وما الذي حدث، ولقطة شاشة إن وُجدت. يرد فريق البحث برسالة خاصة.",
    )),
    {
      type: "actions",
      block_id: "friction",
      elements: [{ type: "button", style: "primary", text: pt("Report a broken step · أبلغ عن خطوة"), action_id: "friction:open", value: "open" }],
    },
    ctx("Or type /friction anywhere in Slack. Never include a PIN, OTP, card number or password."),
  ];
}

export interface DigestStats { received: number; fixed: number; open: number; walaplus: number; walaone: number }

/** The weekly friction digest for the channel. */
export function frictionDigestBlocks(s: DigestStats, settings: Settings): Block[] {
  return [
    { type: "header", text: pt("Friction this week · احتكاك هذا الأسبوع") },
    md(
      `*${s.received}* reported this week (WalaPlus ${s.walaplus}, WalaOne ${s.walaone}) · *${s.fixed}* fixed · *${s.open}* still open.\n` +
        `*${s.received}* بلاغاً هذا الأسبوع · *${s.fixed}* أُصلح · *${s.open}* ما زال مفتوحاً.`,
    ),
    {
      type: "actions",
      block_id: "friction",
      elements: [{ type: "button", text: pt("Report a broken step · أبلغ عن خطوة"), action_id: "friction:open", value: "open" }],
    },
    ctx(`Every report gets a reply by DM from the research team in ${settings.channel_name}.`),
  ];
}

export interface SlotCalendar {
  /** The Google Meet link of the slot's calendar event, when there is one. */
  meet_url: string | null;
  /** True when the member is a guest on the calendar event, so Google has emailed them the invite. */
  invited: boolean;
}

/** A "save to Google Calendar" link for a member the bot could not invite (no connected calendar, or no work email on Slack). */
export function calendarTemplateUrl(study: Study, slot: SessionSlot, meetUrl: string | null): string {
  const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const start = new Date(slot.starts_at);
  const end = new Date(start.getTime() + slot.minutes * 60_000);
  const q = new URLSearchParams({
    action: "TEMPLATE",
    text: `${study.title_en} · UX research session`,
    dates: `${stamp(start)}/${stamp(end)}`,
    details: [study.intro_en, meetUrl ? `Google Meet: ${meetUrl}` : ""].filter(Boolean).join("\n\n"),
    location: slot.place || meetUrl || "",
    ctz: "Asia/Riyadh",
  });
  return `https://calendar.google.com/calendar/render?${q}`;
}

/** The DM that confirms a session booking: when, where, the Meet link and the calendar status, with its cancel button. */
export function sessionBookedBlocks(study: Study, slot: SlotWithBookings, bookingId: string, moved: boolean, cal: SlotCalendar = { meet_url: null, invited: false }): Block[] {
  const when = `${fmtSlot(slot.starts_at, slot.minutes)}${slot.place ? ` · ${slot.place}` : ""}`;
  const add = calendarTemplateUrl(study, slot, cal.meet_url);
  const en = [
    `*${moved ? "Moved" : "Booked"}: ${study.title_en}*`,
    when,
    ...(cal.meet_url ? [`On Google Meet: ${cal.meet_url}`] : []),
    `${slot.minutes} minutes. We remind you the day before.`,
    cal.invited ? "A calendar invite is on its way to your work inbox." : `<${add}|Add it to your calendar>`,
  ].join("\n");
  const ar = [
    `*${moved ? "تم نقل الحجز" : "تم الحجز"}: ${study.title_ar || study.title_en}*`,
    ...(cal.meet_url ? ["الجلسة على Google Meet، الرابط أعلاه."] : []),
    `${slot.minutes} دقيقة. نذكّرك قبل الموعد بيوم.`,
    cal.invited ? "ستصلك دعوة تقويم على بريد العمل." : `<${add}|أضفها إلى تقويمك>`,
  ].join("\n");
  const buttons: Block[] = [];
  if (cal.meet_url) buttons.push({ type: "button", style: "primary", text: pt("Join Google Meet · انضم"), url: cal.meet_url, action_id: `meet:${bookingId}`, value: bookingId });
  buttons.push({
    type: "button",
    style: "danger",
    text: pt("Cancel this booking · إلغاء الحجز"),
    action_id: `session:cancel:${bookingId}`,
    value: bookingId,
    confirm: { title: pt("Cancel the booking?"), text: { type: "mrkdwn", text: "The slot goes back to the channel." }, confirm: pt("Cancel it"), deny: pt("Keep it") },
  });
  return [md(bi(en, ar)), { type: "actions", block_id: `booking:${bookingId}`, elements: buttons }];
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
