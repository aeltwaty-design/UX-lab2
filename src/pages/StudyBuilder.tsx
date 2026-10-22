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
import { useToast } from "@/components/ui/Toast";
import { deleteStudy, getSettings, getStudy, runAdminAction, saveStudy, type StudyDraft } from "@/data/queries";
import { runChecks } from "@/lib/checks";
import { fromLocalInput, toLocalInput } from "@/lib/format";
import {
  DEFAULT_SETTINGS,
  QUESTION_KINDS,
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
  return { id: tmpId(), question_id, position, label_en: "", label_ar: "" };
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
  };
}

const TEMPLATES: { label: string; apply: (d: StudyDraft) => { draft: StudyDraft; questions: Question[] } }[] = [
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
];

export default function StudyBuilder() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const [draft, setDraft] = useState<StudyDraft | null>(id ? null : blankDraft());
  const [questions, setQuestions] = useState<Question[]>(id ? [] : [newQuestion(0)]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    getSettings().then(setSettings).catch(() => {});
    if (!id) return;
    getStudy(id)
      .then((s) => {
        if (s.status !== "draft" && s.status !== "scheduled") {
          toast("Live and closed studies cannot be edited. Showing results instead.");
          nav(`/studies/${s.id}`, { replace: true });
          return;
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
        });
        setQuestions(s.questions.length ? s.questions : [newQuestion(0)]);
      })
      .catch((e: Error) => toast(e.message, "error"));
  }, [id, nav, toast]);

  const checks = useMemo(
    () => (draft ? runChecks(draft as unknown as Study, questions) : []),
    [draft, questions],
  );
  const hasErrors = checks.some((c) => c.level === "error");

  if (!draft) return <Spinner />;

  const set = <K extends keyof StudyDraft>(k: K, v: StudyDraft[K]) => setDraft({ ...draft, [k]: v });
  const setQ = (i: number, patch: Partial<Question>) =>
    setQuestions(questions.map((q, qi) => (qi === i ? { ...q, ...patch } : q)));
  const setOpt = (qi: number, oi: number, patch: Partial<Option>) =>
    setQ(qi, { options: questions[qi]!.options.map((o, i) => (i === oi ? { ...o, ...patch } : o)) });

  function changeType(t: StudyType) {
    if (t === "poll" && questions.length > 1) setQuestions([questions[0]!]);
    set("type", t);
  }

  function changeKind(qi: number, kind: QuestionKind) {
    const q = questions[qi]!;
    const needsOptions = kind === "single" || kind === "multi";
    setQ(qi, { kind, options: needsOptions ? (q.options.length ? q.options : [newOption(q.id, 0), newOption(q.id, 1)]) : [] });
  }

  async function persist(status: StudyDraft["status"]): Promise<string> {
    const saved = await saveStudy({ ...draft!, status }, questions);
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
      if (draft.id) await deleteStudy(draft.id);
      toast("Study deleted.");
      nav("/studies");
    });

  const isPoll = draft.type === "poll";

  return (
    <>
      <PageHeader
        title={id ? `Edit: ${draft.title_en || "Untitled"}` : "New study"}
        back={{ to: "/studies", label: "Studies" }}
        sub={
          <span className="flex items-center gap-2">
            <Chip tone={draft.status}>{draft.status === "scheduled" ? "Scheduled" : "Draft"}</Chip>
            Nothing reaches Slack until you schedule or publish.
          </span>
        }
        actions={
          <>
            {draft.id && (
              <Button variant="danger" icon="trash" loading={busy === "delete"} onClick={remove}>
                Delete
              </Button>
            )}
            <Button loading={busy === "draft"} onClick={saveDraft}>Save draft</Button>
            <Button icon="clock" loading={busy === "schedule"} disabled={hasErrors} onClick={schedule}>Schedule</Button>
            <Button variant="primary" icon="send" loading={busy === "publish"} disabled={hasErrors} onClick={publishNow}>Publish now</Button>
          </>
        }
      />

      <div className="px-7 pb-10 grid grid-cols-[minmax(0,1fr)_400px] gap-4 items-start">
        <div className="space-y-4">
          <Card title="Type">
            <div className="grid grid-cols-5 gap-2">
              {STUDY_TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  disabled={t.v2}
                  onClick={() => changeType(t.value)}
                  className={clsx(
                    "text-left p-3 rounded-sm border transition-colors cursor-pointer disabled:cursor-not-allowed",
                    draft.type === t.value ? "border-brand bg-brand-light" : "border-line bg-white hover:bg-fill",
                    t.v2 && "opacity-60",
                  )}
                >
                  <div className="text-[13px] font-semibold text-ink flex items-center gap-1.5">
                    {t.label} {t.v2 && <Chip tone="v2">v2</Chip>}
                  </div>
                  <div className="text-[11.5px] text-muted mt-1 leading-snug">{t.hint}</div>
                </button>
              ))}
            </div>
            {!id && (
              <div className="flex items-center gap-2 mt-3 text-[12px] text-muted">
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

          <Card
            title={isPoll ? "The question" : `Questions (${questions.length} of 8)`}
            action={
              !isPoll && (
                <Button size="sm" icon="plus" disabled={questions.length >= 8} onClick={() => setQuestions([...questions, newQuestion(questions.length)])}>
                  Add question
                </Button>
              )
            }
          >
            <div className="space-y-4">
              {questions.map((q, qi) => (
                <div key={q.id} className="border border-line rounded-sm p-3 bg-fill/50">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="h-6 w-6 rounded-full bg-ink text-white text-[11.5px] font-semibold grid place-items-center">{qi + 1}</span>
                    <Select className="w-40" value={q.kind} onChange={(e) => changeKind(qi, e.target.value as QuestionKind)}>
                      {QUESTION_KINDS.map((k) => (
                        <option key={k.value} value={k.value}>{k.label}</option>
                      ))}
                    </Select>
                    <div className="flex-1" />
                    <Toggle checked={q.required} onChange={(v) => setQ(qi, { required: v })} label={<span className="text-[12px]">Required</span>} />
                    {!isPoll && questions.length > 1 && (
                      <Button size="sm" variant="ghost" icon="trash" onClick={() => setQuestions(questions.filter((_, i) => i !== qi))} />
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Input value={q.text_en} onChange={(e) => setQ(qi, { text_en: e.target.value })} placeholder="Question in English" />
                    <Input className="ar" value={q.text_ar} onChange={(e) => setQ(qi, { text_ar: e.target.value })} placeholder="السؤال بالعربية" />
                  </div>
                  {(q.kind === "single" || q.kind === "multi") && (
                    <div className="mt-2 space-y-1.5">
                      {q.options.map((o, oi) => (
                        <div key={o.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_28px] gap-2 items-center">
                          <Input value={o.label_en} onChange={(e) => setOpt(qi, oi, { label_en: e.target.value })} placeholder={`Option ${oi + 1}`} />
                          <Input className="ar" value={o.label_ar} onChange={(e) => setOpt(qi, oi, { label_ar: e.target.value })} placeholder="الخيار" />
                          <button
                            type="button"
                            className="h-7 w-7 grid place-items-center text-muted hover:text-danger cursor-pointer disabled:opacity-30"
                            disabled={q.options.length <= 2}
                            onClick={() => setQ(qi, { options: q.options.filter((_, i) => i !== oi) })}
                            aria-label="Remove option"
                          >
                            <Icon name="x" size={14} />
                          </button>
                        </div>
                      ))}
                      <Button size="sm" variant="ghost" icon="plus" disabled={q.options.length >= 10} onClick={() => setQ(qi, { options: [...q.options, newOption(q.id, q.options.length)] })}>
                        Add option
                      </Button>
                    </div>
                  )}
                  {q.kind === "scale" && <div className="text-[12px] text-muted mt-2">Answered 1 to 5. The post shows 1 = hard, 5 = easy.</div>}
                  {q.kind === "text" && <div className="text-[12px] text-muted mt-2">One short text field. Never ask for PIN, OTP, card or password.</div>}
                </div>
              ))}
            </div>
          </Card>

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
                <Label hint="optional">Target answers</Label>
                <Input type="number" min={1} value={draft.target ?? ""} onChange={(e) => set("target", e.target.value ? Number(e.target.value) : null)} placeholder="e.g. 60" />
              </div>
              <div />
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
                <Input type="datetime-local" value={toLocalInput(draft.publish_at)} onChange={(e) => set("publish_at", fromLocalInput(e.target.value))} />
              </div>
              <div>
                <Label>Close</Label>
                <Input type="datetime-local" value={toLocalInput(draft.close_at)} onChange={(e) => set("close_at", fromLocalInput(e.target.value))} />
              </div>
              <div className="text-[12px] text-muted self-end pb-2">A reminder goes by DM to non-responders a day before close.</div>
            </div>
          </Card>
        </div>

        <div className="space-y-4 sticky top-6">
          <div>
            <Label>Slack preview</Label>
            <SlackPreview study={draft} questions={questions} channel={settings.channel_name} />
          </div>
          <Card title="Checks before posting">
            {checks.length === 0 ? (
              <div className="flex items-center gap-2 text-[13px] text-brand-text"><Icon name="check" /> Ready to post.</div>
            ) : (
              <ul className="space-y-1.5">
                {checks.map((c, i) => (
                  <li key={i} className={clsx("flex gap-2 text-[12.5px]", c.level === "error" ? "text-danger" : "text-warn-text")}>
                    <Icon name="warn" size={14} className="mt-0.5 shrink-0" /> {c.text}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[11.5px] text-muted mt-3">Colleagues without a profile get the profile form first, then their answer is saved.</p>
          </Card>
        </div>
      </div>
    </>
  );
}
