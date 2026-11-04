import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { clsx } from "clsx";
import { PageHeader } from "@/components/AppShell";
import { NotificationPreview, ProfileReminderDm, TwoLanguageDms } from "@/components/DmPreview";
import { Icon } from "@/components/Icon";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { Spinner } from "@/components/ui/Empty";
import { Input, Label, Textarea } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { getReminderTexts, getSettings, listSlots, listStudies, saveReminderTexts } from "@/data/queries";
import { fmtDateTime, fmtSlot } from "@/lib/format";
import {
  DEFAULT_REMINDERS,
  fillReminder,
  HEADER_MAX,
  mergeReminders,
  PLACEHOLDERS,
  SAMPLE_SESSION,
  SAMPLE_STUDY,
  sampleSlot,
  sessionValues,
  studyValues,
  unknownPlaceholders,
  type ExampleSlot,
  type ExampleStudy,
  type ReminderKey,
  type ReminderTexts,
} from "@/lib/reminders";
import { clearBackup, readBackup, stable, writeBackup, type Backup } from "@/lib/unsaved";
import type { Lang, Settings, Study } from "@/lib/types";

const BACKUP = "research-desk:reminders";
/** Leaves room under Slack's 3,000 characters for the titles and links the placeholders bring in. */
const TEMPLATE_MAX = 2500;
const KEYS: ReminderKey[] = ["profile", "study_answer", "study_book", "session"];

interface FieldSpec {
  field: string;
  label: string;
  hint?: string;
  /** ar: right to left in the Arabic font; en: left to right; auto: follows the first letter typed. */
  dir: "ar" | "en" | "auto";
  /** 1: a one-line box (the heading). More: a text box with that many rows. */
  rows: number;
}

const FIELDS: Record<ReminderKey, FieldSpec[]> = {
  profile: [
    { field: "header", label: "Heading", hint: `one line, up to ${HEADER_MAX} characters`, dir: "auto", rows: 1 },
    { field: "body_ar", label: "Arabic text", dir: "ar", rows: 6 },
    { field: "body_en", label: "English text", dir: "en", rows: 6 },
    { field: "notify", label: "Notification line", hint: "the phone notification and the Slack sidebar", dir: "auto", rows: 2 },
  ],
  study_answer: [
    { field: "ar", label: "Arabic", dir: "ar", rows: 3 },
    { field: "en", label: "English", dir: "en", rows: 3 },
  ],
  study_book: [
    { field: "ar", label: "Arabic", dir: "ar", rows: 3 },
    { field: "en", label: "English", dir: "en", rows: 3 },
  ],
  session: [
    { field: "ar", label: "Arabic", dir: "ar", rows: 4 },
    { field: "en", label: "English", dir: "en", rows: 4 },
  ],
};

const ONE_LANGUAGE = "Arabic to members whose profile language is Arabic, English to everyone else.";

const ABOUT: Record<ReminderKey, { title: string; short: string; who: string; when: string; lang: string }> = {
  profile: {
    title: "Profile reminder",
    short: "Profile",
    who: "Channel members who have not filled in their profile, except anyone switched off for reminders on the Participants page.",
    when: "When a study goes live; while any study is live, at most once a week each; and when you press Remind N without a profile on the Participants page.",
    lang: "One DM in both languages, Arabic first. The button and the privacy line under it stay as they are.",
  },
  study_answer: {
    title: "Study reminder: not answered",
    short: "Not answered",
    who: "Members in a live poll, survey or preference test's audience who have not answered yet, except anyone switched off for reminders.",
    when: "Automatically in the last 24 hours before the study closes, unless you already sent one with Remind N by DM on the study's page.",
    lang: ONE_LANGUAGE,
  },
  study_book: {
    title: "Study reminder: not booked",
    short: "Not booked",
    who: "Members in a live session study's audience who have not booked a slot yet, except anyone switched off for reminders.",
    when: "Automatically in the last 24 hours before the study closes, unless you already sent one with Remind N by DM on the study's page.",
    lang: ONE_LANGUAGE,
  },
  session: {
    title: "Session reminder",
    short: "Session",
    who: "Everyone with a booked slot, including members switched off for reminders.",
    when: "Once per booking, in the 24 hours before the session starts.",
    lang: ONE_LANGUAGE,
  },
};

const get = (t: ReminderTexts, key: ReminderKey, field: string): string => (t[key] as unknown as Record<string, string>)[field] ?? "";
const sameTexts = (a: ReminderTexts, b: ReminderTexts, key: ReminderKey) =>
  FIELDS[key].every((f) => get(a, key, f.field).trim() === get(b, key, f.field).trim());

function problemOf(key: ReminderKey, f: FieldSpec, v: string, channel: string): string | null {
  if (!v.trim()) return "Empty. Write the text, or reset this reminder to the default.";
  const bad = unknownPlaceholders(v, key);
  if (bad.length) {
    const list = bad.map((b) => `{${b}}`).join(", ");
    return `${list} ${bad.length === 1 ? "is not a placeholder" : "are not placeholders"} in this reminder. Use the ones listed below.`;
  }
  if (f.rows === 1) {
    const n = fillReminder(v, { channel }).replace(/\s+/g, " ").length;
    if (n > HEADER_MAX) return `Slack cuts a heading after ${HEADER_MAX} characters, and this one has ${n}.`;
  } else if (v.length > TEMPLATE_MAX) {
    return `Too long for one Slack message: keep it under ${TEMPLATE_MAX.toLocaleString("en")} characters (it has ${v.length.toLocaleString("en")}).`;
  }
  return null;
}

/** Live first, then studies with a post in the channel (their DM carries a link), then the rest; newest first within each. */
function byExampleValue(list: Study[]): Study[] {
  const rank = (s: Study) => (s.status === "live" ? 0 : s.slack_ts ? 1 : 2);
  return [...list].sort((a, b) => rank(a) - rank(b) || b.created_at.localeCompare(a.created_at));
}

function ExamplePicker({ studies, value, onChange }: { studies: Study[]; value: string; onChange: (id: string) => void }) {
  if (!studies.length) return <span className="text-[11.5px] text-muted">with an example study</span>;
  return (
    <label className="flex items-center gap-1.5 text-[11.5px] text-muted min-w-0">
      <span className="shrink-0">Example</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 min-w-0 max-w-[250px] rounded-sm border border-line bg-white px-2 text-[12px] text-ink focus:outline-none focus:border-brand cursor-pointer"
      >
        {studies.map((s) => (
          <option key={s.id} value={s.id}>
            {s.title_en || "Untitled"}
            {s.status === "live" ? " · live" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

function PreviewHead({ children }: { children?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 min-h-7 mb-2">
      <span className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-muted shrink-0">What members see</span>
      {children}
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="text-[12px] text-muted leading-relaxed">{children}</p>;
}

const langLabel = (lang: Lang) => (lang === "ar" ? "members whose profile is in Arabic" : "everyone else, in English");

export default function Reminders() {
  const toast = useToast();
  const { hash } = useLocation();
  /** The wording as the bot reads it now. */
  const [saved, setSaved] = useState<ReminderTexts | null>(null);
  /** The wording on screen. */
  const [texts, setTexts] = useState<ReminderTexts | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [studies, setStudies] = useState<Study[]>([]);
  const [pick, setPick] = useState<Partial<Record<"answer" | "book" | "session", string>>>({});
  const [slots, setSlots] = useState<{ study: string; slot: ExampleSlot | null } | null>(null);
  const [pendingRestore, setPendingRestore] = useState<Backup<ReminderTexts> | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  /** The placeholder under the pointer, described under its card. */
  const [hint, setHint] = useState<{ key: ReminderKey; name: string } | null>(null);
  const boxes = useRef(new Map<string, HTMLInputElement | HTMLTextAreaElement>());
  /** The box last typed in on each card, where a clicked placeholder goes. */
  const lastBox = useRef<Partial<Record<ReminderKey, string>>>({});
  const scrolled = useRef(false);

  useEffect(() => {
    Promise.all([getReminderTexts(), getSettings(), listStudies()])
      .then(([t, s, st]) => {
        setSaved(t);
        setTexts(t);
        setSettings(s);
        setStudies(st);
        const b = readBackup<ReminderTexts>(BACKUP);
        if (b && stable(mergeReminders(b.data)) !== stable(t)) setPendingRestore(b);
        else if (b) clearBackup(BACKUP);
      })
      .catch((e: Error) => toast(e.message, "error"));
  }, [toast]);

  const answerStudies = useMemo(() => byExampleValue(studies.filter((s) => s.type === "poll" || s.type === "survey" || s.type === "preference_test")), [studies]);
  const sessionStudies = useMemo(() => byExampleValue(studies.filter((s) => s.type === "session_recruitment")), [studies]);
  const answerId = pick.answer ?? answerStudies[0]?.id ?? "";
  const bookId = pick.book ?? sessionStudies[0]?.id ?? "";
  const sessionId = pick.session ?? sessionStudies[0]?.id ?? "";
  const answerEx: ExampleStudy = answerStudies.find((s) => s.id === answerId) ?? SAMPLE_STUDY;
  const bookEx: ExampleStudy = sessionStudies.find((s) => s.id === bookId) ?? SAMPLE_SESSION;
  const sessionEx: ExampleStudy = sessionStudies.find((s) => s.id === sessionId) ?? SAMPLE_SESSION;
  const fallbackSlot = useMemo(sampleSlot, []);

  // The session example uses the study's next slot, or its last one once all have passed.
  useEffect(() => {
    if (!sessionId) return;
    let gone = false;
    listSlots(sessionId)
      .then((list) => {
        if (gone) return;
        const next = list.find((s) => new Date(s.starts_at).getTime() > Date.now()) ?? list[list.length - 1];
        setSlots({ study: sessionId, slot: next ? { starts_at: next.starts_at, minutes: next.minutes, place: next.place, meet_url: next.meet_url } : null });
      })
      .catch(() => !gone && setSlots({ study: sessionId, slot: null }));
    return () => {
      gone = true;
    };
  }, [sessionId]);
  const realSlot = sessionId && slots?.study === sessionId ? slots.slot : null;
  const slotEx = realSlot ?? fallbackSlot;

  const channel = settings?.channel_name ?? "#ux-hub";
  const workspace = settings?.workspace_url ?? "";

  const dirty = Boolean(texts && saved && stable(texts) !== stable(saved));
  const problems = useMemo(() => {
    const out: Record<string, string> = {};
    if (!texts) return out;
    for (const key of KEYS)
      for (const f of FIELDS[key]) {
        const p = problemOf(key, f, get(texts, key, f.field), channel);
        if (p) out[`${key}.${f.field}`] = p;
      }
    return out;
  }, [texts, channel]);
  const hasErrors = Object.keys(problems).length > 0;

  // Unsaved wording stays in this browser until it is saved or discarded; wait while an older copy is offered back.
  useEffect(() => {
    if (!texts || !saved || pendingRestore) return;
    if (dirty) writeBackup(BACKUP, texts);
    else clearBackup(BACKUP);
  }, [texts, saved, dirty, pendingRestore]);

  // Closing or reloading the tab with unsaved wording asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // A link such as /reminders#study_book (from a study's page) opens at that reminder.
  useEffect(() => {
    if (!texts || scrolled.current || !hash) return;
    scrolled.current = true;
    requestAnimationFrame(() => document.getElementById(hash.slice(1))?.scrollIntoView({ block: "start" }));
  }, [texts, hash]);

  if (!texts || !saved) return <Spinner />;

  const setField = (key: ReminderKey, field: string, v: string) =>
    setTexts((t) => (t ? ({ ...t, [key]: { ...t[key], [field]: v } } as ReminderTexts) : t));

  /** Puts {name} where the cursor is in the card's last-used box, or at the end of its first box. */
  function insert(key: ReminderKey, name: string) {
    if (!texts) return;
    const field = lastBox.current[key] ?? FIELDS[key][0].field;
    const el = boxes.current.get(`${key}.${field}`);
    const cur = get(texts, key, field);
    const token = `{${name}}`;
    let start = cur.length;
    let end = cur.length;
    if (el && lastBox.current[key] !== undefined) {
      start = el.selectionStart ?? cur.length;
      end = el.selectionEnd ?? cur.length;
    }
    setField(key, field, cur.slice(0, start) + token + cur.slice(end));
    lastBox.current[key] = field;
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  }

  function reset(key: ReminderKey) {
    setTexts((t) => (t ? ({ ...t, [key]: { ...DEFAULT_REMINDERS[key] } } as ReminderTexts) : t));
  }

  async function save() {
    if (!texts) return;
    setSaving(true);
    try {
      const next = await saveReminderTexts(texts);
      setSaved(next);
      setTexts(next);
      clearBackup(BACKUP);
      toast("Saved. The bot uses this wording from the next reminder.");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  function restore() {
    if (!pendingRestore) return;
    setTexts(mergeReminders(pendingRestore.data));
    setPendingRestore(null);
    toast("Your unsaved wording is back. Save to keep it.");
  }

  function box(key: ReminderKey, f: FieldSpec) {
    const id = `${key}.${f.field}`;
    const problem = problems[id];
    const props = {
      id: `reminder-${key}-${f.field}`,
      value: get(texts!, key, f.field),
      "aria-label": `${ABOUT[key].title}: ${f.label}`,
      "aria-invalid": problem ? true : undefined,
      dir: f.dir === "ar" ? "rtl" : f.dir === "en" ? "ltr" : "auto",
      spellCheck: f.dir === "en",
      ref: (el: HTMLInputElement | HTMLTextAreaElement | null) => {
        if (el) boxes.current.set(id, el);
        else boxes.current.delete(id);
      },
      onFocus: () => {
        lastBox.current[key] = f.field;
      },
      className: clsx(f.dir === "ar" && "ar", problem && "ring-1 ring-danger"),
    };
    return (
      <div key={id}>
        <Label hint={f.hint}>{f.label}</Label>
        {f.rows === 1 ? (
          <Input {...props} onChange={(e) => setField(key, f.field, e.target.value)} />
        ) : (
          <Textarea {...props} rows={f.rows} onChange={(e) => setField(key, f.field, e.target.value)} />
        )}
        {problem && (
          <div className="mt-1 flex items-start gap-1.5 text-[12px] text-danger">
            <Icon name="warn" size={13} className="mt-[2px] shrink-0" />
            <span>{problem}</span>
          </div>
        )}
      </div>
    );
  }

  function placeholders(key: ReminderKey) {
    const list = PLACEHOLDERS[key];
    const shown = hint?.key === key ? hint.name : null;
    return (
      <div className="pt-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-muted mr-1">Placeholders</span>
          {Object.keys(list).map((name) => (
            <button
              key={name}
              type="button"
              aria-label={`Insert {${name}}: ${list[name]}`}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setHint({ key, name })}
              onMouseLeave={() => setHint(null)}
              onFocus={() => setHint({ key, name })}
              onBlur={() => setHint(null)}
              onClick={() => insert(key, name)}
              className="h-6 px-2 rounded-sm border border-line bg-white font-mono text-[11.5px] text-ink-2 hover:border-brand hover:text-brand-text cursor-pointer"
            >
              {`{${name}}`}
            </button>
          ))}
        </div>
        <div className="mt-1.5 text-[12px] text-muted min-h-[18px]">
          {shown ? (
            <>
              <span className="font-mono text-ink-2">{`{${shown}}`}</span> {list[shown]}
            </>
          ) : (
            "Click one to put it where the cursor is. A line whose placeholders are all empty is left out of the DM."
          )}
        </div>
      </div>
    );
  }

  function preview(key: ReminderKey): ReactNode {
    const t = texts!;
    if (key === "profile")
      return (
        <>
          <PreviewHead />
          <div className="space-y-2.5">
            <NotificationPreview text={fillReminder(t.profile.notify, { channel })} />
            <ProfileReminderDm t={t.profile} channel={channel} />
          </div>
        </>
      );
    if (key === "study_answer" || key === "study_book") {
      const book = key === "study_book";
      const list = book ? sessionStudies : answerStudies;
      const ex = book ? bookEx : answerEx;
      return (
        <>
          <PreviewHead>
            <ExamplePicker studies={list} value={book ? bookId : answerId} onChange={(id) => setPick((p) => (book ? { ...p, book: id } : { ...p, answer: id }))} />
          </PreviewHead>
          <div className="space-y-2.5">
            <TwoLanguageDms tpl={t[key]} values={(lang) => studyValues(ex, channel, workspace, lang)} label={langLabel} />
            {!list.length ? (
              <Note>A made-up study, until you have {book ? "a session study" : "a poll, survey or preference test"}.</Note>
            ) : !ex.slack_ts ? (
              <Note>This study has no post in the channel yet, so {"{link}"} is empty and the DM carries no link.</Note>
            ) : (
              <Note>In Slack the link opens the study's post in {channel}.</Note>
            )}
          </div>
        </>
      );
    }
    return (
      <>
        <PreviewHead>
          <ExamplePicker studies={sessionStudies} value={sessionId} onChange={(id) => setPick((p) => ({ ...p, session: id }))} />
        </PreviewHead>
        <div className="space-y-2.5">
          <TwoLanguageDms tpl={t.session} values={(lang) => sessionValues(sessionEx, slotEx, lang)} label={langLabel} />
          <Note>
            {realSlot ? `With the slot ${fmtSlot(slotEx.starts_at, slotEx.minutes)}.` : sessionStudies.length ? "This study has no slots, so a made-up one stands in." : "A made-up study and slot, until you have a session study."}{" "}
            {slotEx.meet_url
              ? "The Meet link comes from the slot's Google Calendar event."
              : "This slot has no Google Meet link from the calendar, so the line with {meet} is left out; the slot's place still shows through {when}."}
          </Note>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Reminders"
        sub="The DMs the bot sends on its own, filled in the way members get them. Edit the wording and save: the bot uses it from the next reminder."
        actions={
          <>
            {hasErrors && <span className="text-[12px] text-danger">Fix the boxes marked in red to save</span>}
            {dirty && (
              <Button variant="ghost" onClick={() => setConfirmDiscard(true)}>
                Discard changes
              </Button>
            )}
            <Button variant="primary" icon="check" loading={saving} disabled={!dirty || hasErrors} onClick={save}>
              Save changes
            </Button>
          </>
        }
      />

      {pendingRestore && (
        <div className="mx-7 mb-4 flex items-center gap-3 rounded-md border border-warn-light bg-warn-light px-4 py-3 text-[13px] text-warn-text">
          <Icon name="warn" size={16} />
          <span className="flex-1">You have reminder wording from {fmtDateTime(new Date(pendingRestore.at).toISOString())} that was never saved.</span>
          <Button size="sm" variant="primary" onClick={restore}>
            Restore it
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              clearBackup(BACKUP);
              setPendingRestore(null);
            }}
          >
            Discard
          </Button>
        </div>
      )}

      <div className="px-7 pb-10 space-y-4">
        <nav aria-label="Reminders on this page" className="flex flex-wrap items-center gap-1.5">
          {KEYS.map((key) => {
            const changed = stable(texts[key]) !== stable(saved[key]);
            return (
              <a
                key={key}
                href={`#${key}`}
                onClick={(e) => {
                  e.preventDefault();
                  document.getElementById(key)?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
                className="h-7 px-2.5 inline-flex items-center gap-1.5 rounded-full border border-line bg-white text-[12px] font-medium text-ink-2 hover:border-brand hover:text-brand-text"
              >
                {ABOUT[key].short}
                {changed && (
                  <>
                    <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-warn-text" />
                    <span className="sr-only">not saved</span>
                  </>
                )}
              </a>
            );
          })}
        </nav>

        {KEYS.map((key) => {
          const about = ABOUT[key];
          const edited = !sameTexts(texts, DEFAULT_REMINDERS, key);
          const unsaved = stable(texts[key]) !== stable(saved[key]);
          return (
            <Card
              key={key}
              id={key}
              className="scroll-mt-4"
              title={
                <span className="flex items-center gap-2">
                  {about.title}
                  {edited && <Chip tone="one">Your wording</Chip>}
                  {unsaved && <Chip tone="warn">Not saved</Chip>}
                </span>
              }
              action={
                edited ? (
                  <Button size="sm" variant="ghost" onClick={() => reset(key)}>
                    Reset to default
                  </Button>
                ) : (
                  <span className="text-[12px] text-muted">Default wording</span>
                )
              }
            >
              <dl className="grid grid-cols-[72px_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-sm border border-line-2 bg-fill px-3 py-2.5 text-[12.5px] mb-4">
                <dt className="text-muted">Who</dt>
                <dd className="text-ink-2">{about.who}</dd>
                <dt className="text-muted">When</dt>
                <dd className="text-ink-2">{about.when}</dd>
                <dt className="text-muted">Language</dt>
                <dd className="text-ink-2">{about.lang}</dd>
              </dl>
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-5 items-start">
                <div className="space-y-3">
                  {FIELDS[key].map((f) => box(key, f))}
                  {placeholders(key)}
                </div>
                <div>{preview(key)}</div>
              </div>
            </Card>
          );
        })}

        <p className="text-[12px] text-muted">
          Not on this page: the welcome DM and the pinned profile post (Settings → Update the pinned profile post), the booking confirmation, and the DM you write when you remove a booking.
        </p>
      </div>

      <ConfirmDialog
        open={confirmDiscard}
        title="Discard your changes?"
        confirmLabel="Discard changes"
        danger
        onClose={() => setConfirmDiscard(false)}
        onConfirm={() => {
          setTexts(saved);
          clearBackup(BACKUP);
          setConfirmDiscard(false);
        }}
      >
        <p>Every reminder goes back to the wording the bot uses now.</p>
      </ConfirmDialog>
    </>
  );
}
