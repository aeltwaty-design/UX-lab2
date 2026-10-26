import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { clsx } from "clsx";
import { PageHeader } from "@/components/AppShell";
import { SlackPreview } from "@/components/SlackPreview";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { Input, Label, Select, Textarea, Toggle } from "@/components/ui/Field";
import { Spinner } from "@/components/ui/Empty";
import { Icon } from "@/components/Icon";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { useToast } from "@/components/ui/Toast";
import { getSettings, getStudy, listBookings, runAdminAction, saveStudy, updatePublishedStudy, uploadStudyImage, type StudyDraft } from "@/data/queries";
import { runChecks } from "@/lib/checks";
import { fmtSlot, fromLocalInput, toLocalInput } from "@/lib/format";
import type { SlotDraft } from "@/lib/preview";
import {
  DEFAULT_SETTINGS,
  QUESTION_KINDS,
  STATUS_LABEL,
  STUDY_TYPES,
  type Option,
  type Question,
  type QuestionKind,
  type Settings,
  type Study,
  type StudyType,
} from "@/lib/types";

let seq = 0;
const tmpId = () => `tmp-${++seq}`;

function newOption(question_id: string, position: number): Option {
  return { id: tmpId(), question_id, position, label_en: "", label_ar: "", image_url: null };
}

function newQuestion(position: number, kind: QuestionKind = "single"): Question {
  const id = tmpId();
  return {
    id,
    study_id: "",
    position,
    kind,
    text_en: "",
    text_ar: "",
    required: true,
    options: kind === "single" || kind === "multi" ? [newOption(id, 0), newOption(id, 1)] : [],
  };
}

const MINUTES = [15, 20, 30, 45, 60, 90];

/** The next slot follows the previous one with a short gap; the first one lands the day after publishing at 10:00. */
function nextSlot(slots: SlotDraft[], publishAt: string | null): SlotDraft {
  const last = slots[slots.length - 1];
  if (last) {
    const start = new Date(new Date(last.starts_at).getTime() + (last.minutes + 15) * 60_000);
    return { id: tmpId(), starts_at: start.toISOString(), minutes: last.minutes, place: last.place, capacity: last.capacity };
  }
  const start = publishAt ? new Date(publishAt) : new Date();
  start.setDate(start.getDate() + 1);
  start.setHours(10, 0, 0, 0);
  if (start.getTime() < Date.now()) start.setTime(Date.now() + 86_400_000);
  return { id: tmpId(), starts_at: start.toISOString(), minutes: 30, place: "", capacity: 1 };
}

function blankDraft(): StudyDraft {
  const publish = new Date();
  publish.setDate(publish.getDate() + 1);
  publish.setHours(10, 0, 0, 0);
  const close = new Date(publish);
  close.setDate(close.getDate() + 7);
  return {
    type: "poll",
    status: "draft",
    title_en: "",
    title_ar: "",
    intro_en: "",
    intro_ar: "",
    audience: "everyone",
    audience_teams: [],
    target: null,
    publish_at: publish.toISOString(),
    close_at: close.toISOString(),
    allow_changes: true,
  };
}

const TEMPLATES: { label: string; apply: (d: StudyDraft) => { draft: StudyDraft; questions: Question[]; slots?: SlotDraft[] } }[] = [
  {
    label: "Weekly pulse poll",
    apply: (d) => {
      const q = newQuestion(0, "single");
      q.text_en = "Which app did you open this week?";
      q.text_ar = "أي تطبيق فتحت هذا الأسبوع؟";
      q.options = [
        { ...newOption(q.id, 0), label_en: "WalaPlus", label_ar: "ولاء بلس" },
        { ...newOption(q.id, 1), label_en: "WalaOne", label_ar: "ولاء ون" },
        { ...newOption(q.id, 2), label_en: "Both", label_ar: "كلاهما" },
        { ...newOption(q.id, 3), label_en: "Neither", label_ar: "لا شيء" },
      ];
      return {
        draft: { ...d, type: "poll", title_en: "Weekly pulse", title_ar: "نبض الأسبوع", intro_en: "Two taps, no typing. Results back here on Thursday.", intro_ar: "ضغطتان فقط. النتائج هنا يوم الخميس." },
        questions: [q],
      };
    },
  },
  {
    label: "Feature survey",
    apply: (d) => {
      const q1 = newQuestion(0, "scale");
      q1.text_en = "How easy was it to redeem an offer last time?";
      q1.text_ar = "ما مدى سهولة استبدال عرض في المرة الأخيرة؟";
      const q2 = newQuestion(1, "text");
      q2.text_en = "What got in the way, if anything?";
      q2.text_ar = "ما الذي أعاقك، إن وجد؟";
      q2.required = false;
      return {
        draft: { ...d, type: "survey", title_en: "Redeeming an offer", title_ar: "استبدال العروض", intro_en: "Five minutes. Answers are linked to your profile so we can follow up.", intro_ar: "خمس دقائق. الإجابات مرتبطة بملفك لنتابع معك." },
        questions: [q1, q2],
      };
    },
  },
  {
    label: "Two screens, pick one",
    apply: (d) => {
      const q = newQuestion(0, "single");
      q.text_en = "Which home screen is clearer?";
      q.text_ar = "أي شاشة رئيسية أوضح؟";
      q.options = [
        { ...newOption(q.id, 0), label_en: "A", label_ar: "أ" },
        { ...newOption(q.id, 1), label_en: "B", label_ar: "ب" },
      ];
      return {
        draft: { ...d, type: "preference_test", title_en: "Home screen: A or B?", title_ar: "الشاشة الرئيسية: أ أم ب؟", intro_en: "One tap. Look at both, pick the one you would rather use.", intro_ar: "ضغطة واحدة. انظر إلى الاثنتين واختر التي تفضّل استخدامها." },
        questions: [q],
      };
    },
  },
  {
    label: "Usability sessions",
    apply: (d) => {
      const slots: SlotDraft[] = [];
      for (let i = 0; i < 4; i++) slots.push(nextSlot(slots, d.publish_at));
      return {
        draft: { ...d, type: "session_recruitment", title_en: "Thirty minutes with the new checkout", title_ar: "ثلاثون دقيقة مع صفحة الدفع الجديدة", intro_en: "A one-to-one session: you try a prototype, we watch and ask. Pick a slot that suits you.", intro_ar: "جلسة فردية: تجرّب نموذجاً أولياً ونحن نراقب ونسأل. اختر الوقت المناسب لك." },
        questions: [],
        slots,
      };
    },
  },
];

export default function StudyBuilder() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const [draft, setDraft] = useState<StudyDraft | null>(id ? null : blankDraft());
  const [questions, setQuestions] = useState<Question[]>(id ? [] : [newQuestion(0)]);
  const [slots, setSlots] = useState<SlotDraft[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [uploading, setUploading] = useState<string[]>([]);
  /** Active bookings per slot, for studies already in the channel. */
  const [bookedBySlot, setBookedBySlot] = useState<Record<string, number>>({});

  useEffect(() => {
    getSettings().then(setSettings).catch(() => {});
    if (!id) return;
    getStudy(id)
      .then(async (s) => {
        if (s.type === "session_recruitment" && s.status !== "draft" && s.status !== "scheduled") {
          const counts: Record<string, number> = {};
          for (const b of await listBookings(s.id)) counts[b.slot_id] = (counts[b.slot_id] ?? 0) + 1;
          setBookedBySlot(counts);
        }
        setDraft({
          id: s.id,
          type: s.type,
          status: s.status,
          title_en: s.title_en,
          title_ar: s.title_ar,
          intro_en: s.intro_en,
          intro_ar: s.intro_ar,
          audience: s.audience,
          audience_teams: s.audience_teams,
          target: s.target,
          publish_at: s.publish_at,
          close_at: s.close_at,
          allow_changes: s.allow_changes ?? true,
        });
        setQuestions(s.questions.length ? s.questions : s.type === "session_recruitment" ? [] : [newQuestion(0)]);
        setSlots(s.slots.map((x) => ({ id: x.id, starts_at: x.starts_at, minutes: x.minutes, place: x.place, capacity: x.capacity })));
      })
      .catch((e: Error) => toast(e.message, "error"));
  }, [id, nav, toast]);

  /** Already in the channel: wording, audience and slots can change; the structure answers point at cannot. */
  const locked = Boolean(draft && draft.status !== "draft" && draft.status !== "scheduled");
  const checks = useMemo(
    () => (draft ? runChecks(draft as unknown as Study, questions, slots, { published: locked }) : []),
    [draft, questions, slots, locked],
  );
  const hasErrors = checks.some((c) => c.level === "error");

  if (!draft) return <Spinner />;

  const set = <K extends keyof StudyDraft>(k: K, v: StudyDraft[K]) => setDraft({ ...draft, [k]: v });
  const setQ = (i: number, patch: Partial<Question>) =>
    setQuestions(questions.map((q, qi) => (qi === i ? { ...q, ...patch } : q)));
  const setOpt = (qi: number, oi: number, patch: Partial<Option>) =>
    setQ(qi, { options: questions[qi]!.options.map((o, i) => (i === oi ? { ...o, ...patch } : o)) });
  const setSlot = (i: number, patch: Partial<SlotDraft>) => setSlots(slots.map((s, si) => (si === i ? { ...s, ...patch } : s)));

  function changeType(t: StudyType) {
    if (t === "poll" || t === "preference_test") {
      const first = questions[0] ?? newQuestion(0);
      const q = { ...first, kind: "single" as QuestionKind, options: first.options.length >= 2 ? first.options : [newOption(first.id, 0), newOption(first.id, 1)] };
      setQuestions([q]);
    } else if (t === "survey" && questions.length === 0) {
      setQuestions([newQuestion(0)]);
    }
    if (t === "session_recruitment" && slots.length === 0) setSlots([nextSlot([], draft!.publish_at)]);
    set("type", t);
  }

  function changeKind(qi: number, kind: QuestionKind) {
    const q = questions[qi]!;
    const needsOptions = kind === "single" || kind === "multi";
    setQ(qi, { kind, options: needsOptions ? (q.options.length ? q.options : [newOption(q.id, 0), newOption(q.id, 1)]) : [] });
  }

  async function pickImage(qi: number, oi: number, file: File | undefined) {
    if (!file) return;
    const oid = questions[qi]!.options[oi]!.id;
    setUploading((u) => [...u, oid]);
    try {
      const url = await uploadStudyImage(file);
      setOpt(qi, oi, { image_url: url });
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setUploading((u) => u.filter((x) => x !== oid));
    }
  }

  async function persist(status: StudyDraft["status"]): Promise<string> {
    const saved = await saveStudy({ ...draft!, status }, draft!.type === "session_recruitment" ? [] : questions, slots);
    setDraft({ ...draft!, id: saved, status });
    return saved;
  }

  async function act(label: string, fn: () => Promise<void>) {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  const saveDraft = () =>
    act("draft", async () => {
      const sid = await persist("draft");
      toast("Draft saved.");
      if (!id) nav(`/studies/${sid}/edit`, { replace: true });
    });

  const schedule = () =>
    act("schedule", async () => {
      if (hasErrors) throw new Error("Fix the errors in the checks panel first.");
      if (!draft.publish_at || new Date(draft.publish_at).getTime() < Date.now())
        throw new Error("Pick a publish date in the future, or use Publish now.");
      const sid = await persist("scheduled");
      toast("Scheduled. The bot posts it on time.");
      nav(`/studies/${sid}`);
    });

  const publishNow = () =>
    act("publish", async () => {
      if (hasErrors) throw new Error("Fix the errors in the checks panel first.");
      if (!settings.channel_id) throw new Error("Set the Slack channel ID in Settings first.");
      const sid = await persist("draft");
      const r = await runAdminAction({ action: "publish_now", study_id: sid });
      if (!r.ok) throw new Error(r.message);
      toast(r.message);
      nav(`/studies/${sid}`);
    });

  const remove = () =>
    act("delete", async () => {
      if (!draft.id) return;
      const r = await runAdminAction({ action: "delete_study", study_id: draft.id, remove_posts: false });
      if (!r.ok) throw new Error(r.message);
      setConfirmDelete(false);
      toast(r.message);
      nav("/studies");
    });

  const saveChanges = () =>
    act("save", async () => {
      if (hasErrors) throw new Error("Fix the errors in the checks panel first.");
      await updatePublishedStudy({ ...draft, id: draft.id! }, questions, slots);
      const r = await runAdminAction({ action: "refresh_post", study_id: draft.id! });
      toast(r.message, r.ok ? "ok" : "error");
      nav(`/studies/${draft.id}`);
    });

  const isPoll = draft.type === "poll";
  const isPreference = draft.type === "preference_test";
  const isSessions = draft.type === "session_recruitment";
  const singleQuestion = isPoll || isPreference;
  /** Closed or reported: the round is over, so dates and slots are history. */
  const closedLocked = locked && draft.status !== "live";
  const slotCols = locked
    ? "grid-cols-[minmax(0,1.5fr)_110px_minmax(0,1.2fr)_90px_60px_28px]"
    : "grid-cols-[minmax(0,1.5fr)_110px_minmax(0,1.2fr)_90px_28px]";

  return (
    <>
      <PageHeader
        title={id ? `Edit: ${draft.title_en || "Untitled"}` : "New study"}
        back={locked ? { to: `/studies/${draft.id}`, label: "Study" } : { to: "/studies", label: "Studies" }}
        sub={
          <span className="flex items-center gap-2">
            <Chip tone={draft.status}>{STATUS_LABEL[draft.status]}</Chip>
            {locked
              ? draft.status === "live"
                ? `Live in ${settings.channel_name}. Wording, audience, target, close date and slots can change; questions keep their structure so answers stay valid. Saving updates the post.`
                : "Closed. Wording, audience and target can change. Saving updates the post."
              : "Nothing reaches Slack until you schedule or publish."}
          </span>
        }
        actions={
          locked ? (
            <Button variant="primary" icon="check" loading={busy === "save"} disabled={hasErrors} onClick={saveChanges}>
              Save changes
            </Button>
          ) : (
            <>
              {draft.id && (
                <Button variant="danger" icon="trash" loading={busy === "delete"} onClick={() => setConfirmDelete(true)}>
                  Delete
                </Button>
              )}
              <Button loading={busy === "draft"} onClick={saveDraft}>Save draft</Button>
              <Button icon="clock" loading={busy === "schedule"} disabled={hasErrors} onClick={schedule}>Schedule</Button>
              <Button variant="primary" icon="send" loading={busy === "publish"} disabled={hasErrors} onClick={publishNow}>Publish now</Button>
            </>
          )
        }
      />

      <ConfirmDialog
        open={confirmDelete}
        title={`Delete “${draft.title_en || "Untitled"}”?`}
        confirmLabel={draft.status === "scheduled" ? "Delete scheduled study" : "Delete draft"}
        danger
        busy={busy === "delete"}
        onClose={() => setConfirmDelete(false)}
        onConfirm={remove}
      >
        <p>This permanently removes the {draft.status === "scheduled" ? "scheduled study" : "draft"}. Nothing of it reached the channel. There is no undo.</p>
      </ConfirmDialog>

      <div className="px-7 pb-10 grid grid-cols-[minmax(0,1fr)_400px] gap-4 items-start">
        <div className="space-y-4">
          <Card title="Type">
            {locked ? (
              <div className="text-[13px] text-ink">
                {STUDY_TYPES.find((t) => t.value === draft.type)?.label ?? draft.type}
                <span className="text-muted"> · fixed once posted</span>
              </div>
            ) : (
            <div className="grid grid-cols-4 gap-2">
              {STUDY_TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => changeType(t.value)}
                  className={clsx(
                    "text-left p-3 rounded-sm border transition-colors cursor-pointer",
                    draft.type === t.value ? "border-brand bg-brand-light" : "border-line bg-white hover:bg-fill",
                  )}
                >
                  <div className="text-[13px] font-semibold text-ink">{t.label}</div>
                  <div className="text-[11.5px] text-muted mt-1 leading-snug">{t.hint}</div>
                </button>
              ))}
            </div>
            )}
            {!id && (
              <div className="flex items-center gap-2 mt-3 text-[12px] text-muted flex-wrap">
                Start from:
                {TEMPLATES.map((t) => (
                  <button
                    key={t.label}
                    type="button"
                    className="h-6 px-2 rounded-full border border-line bg-white text-ink-2 hover:bg-fill cursor-pointer"
                    onClick={() => {
                      const r = t.apply(draft);
                      setDraft(r.draft);
                      setQuestions(r.questions);
                      if (r.slots) setSlots(r.slots);
                    }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            )}
          </Card>

          <Card title="Words the channel will read">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Title, English</Label>
                <Input value={draft.title_en} onChange={(e) => set("title_en", e.target.value)} placeholder="Weekly pulse" />
              </div>
              <div>
                <Label>Title, Arabic</Label>
                <Input className="ar" value={draft.title_ar} onChange={(e) => set("title_ar", e.target.value)} placeholder="نبض الأسبوع" />
              </div>
              <div>
                <Label hint="one or two lines">Intro, English</Label>
                <Textarea value={draft.intro_en} onChange={(e) => set("intro_en", e.target.value)} />
              </div>
              <div>
                <Label>Intro, Arabic</Label>
                <Textarea className="ar" value={draft.intro_ar} onChange={(e) => set("intro_ar", e.target.value)} />
              </div>
            </div>
          </Card>

          {isSessions ? (
            <Card
              title={`Session slots (${slots.length})`}
              action={
                <Button size="sm" icon="plus" disabled={slots.length >= 40 || closedLocked} onClick={() => setSlots([...slots, nextSlot(slots, draft.publish_at)])}>
                  Add slot
                </Button>
              }
            >
              {slots.length === 0 ? (
                <div className="text-[13px] text-muted">No slots yet. Each slot is one time, one place and how many people can book it.</div>
              ) : (
                <div className="space-y-2">
                  <div className={clsx("grid gap-2 text-[11.5px] font-semibold uppercase tracking-[0.04em] text-muted", slotCols)}>
                    <div>Starts (your local time)</div><div>Length</div><div>Place or link</div><div>Seats</div>{locked && <div>Booked</div>}<div />
                  </div>
                  {slots.map((s, i) => {
                    const booked = bookedBySlot[s.id] ?? 0;
                    const fixed = closedLocked || (locked && booked > 0);
                    return (
                      <div key={s.id} className={clsx("grid gap-2 items-center", slotCols)}>
                        <Input type="datetime-local" disabled={fixed} value={toLocalInput(s.starts_at)} onChange={(e) => setSlot(i, { starts_at: fromLocalInput(e.target.value) ?? s.starts_at })} />
                        <Select disabled={fixed} value={s.minutes} onChange={(e) => setSlot(i, { minutes: Number(e.target.value) })}>
                          {MINUTES.map((m) => (
                            <option key={m} value={m}>{m} min</option>
                          ))}
                        </Select>
                        <Input disabled={closedLocked} value={s.place} onChange={(e) => setSlot(i, { place: e.target.value })} placeholder="Meeting room 2, or a Meet link" />
                        <Input type="number" disabled={closedLocked} min={Math.max(1, booked)} max={20} value={s.capacity} onChange={(e) => setSlot(i, { capacity: Math.min(20, Math.max(1, booked, Number(e.target.value) || 1)) })} />
                        {locked && <div className="text-[12.5px] text-ink-2 tabular-nums">{booked}</div>}
                        <button
                          type="button"
                          className="h-7 w-7 grid place-items-center text-muted hover:text-danger cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                          disabled={fixed}
                          title={locked && booked > 0 ? "A booked slot stays; members cancel from their DM." : undefined}
                          onClick={() => setSlots(slots.filter((_, si) => si !== i))}
                          aria-label="Remove slot"
                        >
                          <Icon name="x" size={14} />
                        </button>
                      </div>
                    );
                  })}
                  <div className="text-[12px] text-muted pt-1">
                    The channel reads slots in Riyadh time: {slots[0] ? fmtSlot(slots[0].starts_at, slots[0].minutes) : ""}. One active booking per person per study; a member who picks again is moved. The weekly cap of {settings.hours_cap} research hours per member applies.
                    {locked && !closedLocked && " Booked slots keep their time and length; add seats or new slots to open more room."}
                  </div>
                </div>
              )}
            </Card>
          ) : (
            <Card
              title={isPoll ? "The question" : isPreference ? "The question and its images" : `Questions (${questions.length} of 8)`}
              action={
                !locked && !singleQuestion && (
                  <Button size="sm" icon="plus" disabled={questions.length >= 8} onClick={() => setQuestions([...questions, newQuestion(questions.length)])}>
                    Add question
                  </Button>
                )
              }
            >
              <div className="space-y-4">
                {questions.map((q, qi) => (
                  <div key={q.id} className="border border-line rounded-sm p-3 bg-fill/50">
                    {!isPreference && (
                      <div className="flex items-center gap-2 mb-2">
                        <span className="h-6 w-6 rounded-full bg-ink text-white text-[11.5px] font-semibold grid place-items-center">{qi + 1}</span>
                        <Select className="w-40" disabled={locked} value={q.kind} onChange={(e) => changeKind(qi, e.target.value as QuestionKind)}>
                          {QUESTION_KINDS.map((k) => (
                            <option key={k.value} value={k.value}>{k.label}</option>
                          ))}
                        </Select>
                        <div className="flex-1" />
                        <Toggle checked={q.required} onChange={(v) => setQ(qi, { required: v })} label={<span className="text-[12px]">Required</span>} />
                        {!locked && !isPoll && questions.length > 1 && (
                          <Button size="sm" variant="ghost" icon="trash" onClick={() => setQuestions(questions.filter((_, i) => i !== qi))} />
                        )}
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      <Input value={q.text_en} onChange={(e) => setQ(qi, { text_en: e.target.value })} placeholder={isPreference ? "Which one do you prefer?" : "Question in English"} />
                      <Input className="ar" value={q.text_ar} onChange={(e) => setQ(qi, { text_ar: e.target.value })} placeholder={isPreference ? "أيهما تفضّل؟" : "السؤال بالعربية"} />
                    </div>

                    {isPreference ? (
                      <div className="mt-3 space-y-2">
                        {q.options.map((o, oi) => {
                          const busyUpload = uploading.includes(o.id);
                          return (
                            <div key={o.id} className="grid grid-cols-[128px_minmax(0,1fr)_minmax(0,1fr)_28px] gap-2 items-center">
                              <label
                                className={clsx(
                                  "relative h-24 rounded-sm border overflow-hidden grid place-items-center text-[11.5px] text-muted text-center",
                                  locked ? "cursor-default" : "cursor-pointer",
                                  o.image_url ? "border-line bg-fill" : "border-dashed border-line bg-white hover:bg-fill",
                                )}
                              >
                                {o.image_url ? (
                                  <img src={o.image_url} alt={o.label_en} className="h-full w-full object-contain" />
                                ) : busyUpload ? (
                                  <span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-muted border-t-transparent animate-spin" />
                                ) : (
                                  <span className="px-2">Upload image<br />PNG, JPEG, WebP · 5 MB</span>
                                )}
                                {o.image_url && busyUpload && <span className="absolute inset-0 bg-white/70 grid place-items-center"><span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-muted border-t-transparent animate-spin" /></span>}
                                <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="sr-only" disabled={locked} onChange={(e) => void pickImage(qi, oi, e.target.files?.[0])} />
                              </label>
                              <div className="space-y-1.5">
                                <Input value={o.label_en} onChange={(e) => setOpt(qi, oi, { label_en: e.target.value })} placeholder={`Label, e.g. ${String.fromCharCode(65 + oi)}`} />
                                <div className="text-[11.5px] text-muted">{locked ? "The image is fixed once posted; the label can change." : o.image_url ? "Shown under the image and on its button." : "Add the image first."}</div>
                              </div>
                              <Input className="ar self-start" value={o.label_ar} onChange={(e) => setOpt(qi, oi, { label_ar: e.target.value })} placeholder="التسمية" />
                              <button
                                type="button"
                                className="h-7 w-7 grid place-items-center text-muted hover:text-danger cursor-pointer disabled:opacity-30 self-start"
                                disabled={locked || q.options.length <= 2}
                                onClick={() => setQ(qi, { options: q.options.filter((_, i) => i !== oi) })}
                                aria-label="Remove image"
                              >
                                <Icon name="x" size={14} />
                              </button>
                            </div>
                          );
                        })}
                        {!locked && (
                          <Button size="sm" variant="ghost" icon="plus" disabled={q.options.length >= 6} onClick={() => setQ(qi, { options: [...q.options, newOption(q.id, q.options.length)] })}>
                            Add image
                          </Button>
                        )}
                        <div className="text-[12px] text-muted">Two to six images. Members tap one button and can change their pick until the study closes. Keep every image the same size, or the post looks uneven.</div>
                      </div>
                    ) : (
                      (q.kind === "single" || q.kind === "multi") && (
                        <div className="mt-2 space-y-1.5">
                          {q.options.map((o, oi) => (
                            <div key={o.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_28px] gap-2 items-center">
                              <Input value={o.label_en} onChange={(e) => setOpt(qi, oi, { label_en: e.target.value })} placeholder={`Option ${oi + 1}`} />
                              <Input className="ar" value={o.label_ar} onChange={(e) => setOpt(qi, oi, { label_ar: e.target.value })} placeholder="الخيار" />
                              <button
                                type="button"
                                className="h-7 w-7 grid place-items-center text-muted hover:text-danger cursor-pointer disabled:opacity-30"
                                disabled={locked || q.options.length <= 2}
                                onClick={() => setQ(qi, { options: q.options.filter((_, i) => i !== oi) })}
                                aria-label="Remove option"
                              >
                                <Icon name="x" size={14} />
                              </button>
                            </div>
                          ))}
                          {!locked && (
                            <Button size="sm" variant="ghost" icon="plus" disabled={q.options.length >= 10} onClick={() => setQ(qi, { options: [...q.options, newOption(q.id, q.options.length)] })}>
                              Add option
                            </Button>
                          )}
                        </div>
                      )
                    )}
                    {!isPreference && q.kind === "scale" && <div className="text-[12px] text-muted mt-2">Answered 1 to 5. The post shows 1 = hard, 5 = easy.</div>}
                    {!isPreference && q.kind === "text" && <div className="text-[12px] text-muted mt-2">One short text field. Never ask for PIN, OTP, card or password.</div>}
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card title="Audience and dates">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>Audience</Label>
                <Select value={draft.audience} onChange={(e) => set("audience", e.target.value as StudyDraft["audience"])}>
                  <option value="everyone">Everyone in the channel</option>
                  <option value="panel">Members with a profile</option>
                  <option value="teams">Chosen teams</option>
                </Select>
              </div>
              <div>
                <Label hint="optional">{isSessions ? "Target bookings" : "Target answers"}</Label>
                <Input type="number" min={1} value={draft.target ?? ""} onChange={(e) => set("target", e.target.value ? Number(e.target.value) : null)} placeholder="e.g. 60" />
              </div>
              <div className="self-end pb-1">
                {!isSessions && (
                  <Toggle
                    checked={draft.allow_changes}
                    onChange={(v) => set("allow_changes", v)}
                    label="Members can change their answer"
                    hint={draft.allow_changes ? "Until the study closes. A second tap replaces the first." : "Off: the first answer is final, and later taps get a short note."}
                  />
                )}
              </div>
              {draft.audience === "teams" && (
                <div className="col-span-3 flex flex-wrap gap-1.5">
                  {settings.teams.map((t) => {
                    const on = draft.audience_teams.includes(t);
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => set("audience_teams", on ? draft.audience_teams.filter((x) => x !== t) : [...draft.audience_teams, t])}
                        className={clsx(
                          "h-7 px-3 rounded-full border text-[12.5px] cursor-pointer",
                          on ? "bg-ink text-white border-ink" : "bg-white text-ink-2 border-line hover:bg-fill",
                        )}
                      >
                        {t}
                      </button>
                    );
                  })}
                  <span className="text-[12px] text-muted self-center">Reminders go only to these teams. The post is still visible to the whole channel.</span>
                </div>
              )}
              <div>
                <Label>Publish</Label>
                <Input type="datetime-local" disabled={locked} value={toLocalInput(draft.publish_at)} onChange={(e) => set("publish_at", fromLocalInput(e.target.value))} />
              </div>
              <div>
                <Label>Close</Label>
                <Input type="datetime-local" disabled={closedLocked} value={toLocalInput(draft.close_at)} onChange={(e) => set("close_at", fromLocalInput(e.target.value))} />
              </div>
              <div className="text-[12px] text-muted self-end pb-2">
                {isSessions ? "A reminder goes by DM to members without a booking a day before close, and to everyone booked a day before their slot." : "A reminder goes by DM to non-responders a day before close."}
              </div>
            </div>
          </Card>
        </div>

        <div className="space-y-4 sticky top-6">
          <div>
            <Label>Slack preview</Label>
            <SlackPreview study={draft} questions={questions} slots={slots} channel={settings.channel_name} />
          </div>
          <Card title={locked ? "Checks before saving" : "Checks before posting"}>
            {checks.length === 0 ? (
              <div className="flex items-center gap-2 text-[13px] text-brand-text"><Icon name="check" /> {locked ? "Ready to save." : "Ready to post."}</div>
            ) : (
              <ul className="space-y-1.5">
                {checks.map((c, i) => (
                  <li key={i} className={clsx("flex gap-2 text-[12.5px]", c.level === "error" ? "text-danger" : "text-warn-text")}>
                    <Icon name="warn" size={14} className="mt-0.5 shrink-0" /> {c.text}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[11.5px] text-muted mt-3">Colleagues without a profile get the profile form first, then their {isSessions ? "booking" : "answer"} is saved.</p>
          </Card>
        </div>
      </div>
    </>
  );
}
