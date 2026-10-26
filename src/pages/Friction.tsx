import { useCallback, useEffect, useMemo, useState } from "react";
import { clsx } from "clsx";
import { PageHeader } from "@/components/AppShell";
import { StatTile } from "@/components/StatTile";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Chip, type Tone } from "@/components/ui/Chip";
import { Empty, Spinner } from "@/components/ui/Empty";
import { Label, Select, Textarea } from "@/components/ui/Field";
import { Icon } from "@/components/Icon";
import { useToast } from "@/components/ui/Toast";
import { frictionScreenshotUrl, getSettings, listFriction, runAdminAction, updateFriction } from "@/data/queries";
import { fmtDateTime } from "@/lib/format";
import { DEFAULT_SETTINGS, FRICTION_STATUS, type FrictionReport, type FrictionStatus, type Settings } from "@/lib/types";

type StatusFilter = "all" | FrictionStatus;
type AppFilter = "all" | "walaplus" | "walaone";

const STATUS_TONE: Record<FrictionStatus, Tone> = { new: "warn", fixed: "live", duplicate: "neutral", by_design: "closed" };
const APP_LABEL = { walaplus: "WalaPlus", walaone: "WalaOne" } as const;

function statusLabel(s: FrictionStatus): string {
  return FRICTION_STATUS.find((x) => x.value === s)?.label ?? s;
}

export default function Friction() {
  const toast = useToast();
  const [rows, setRows] = useState<FrictionReport[] | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [app, setApp] = useState<AppFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    listFriction()
      .then((r) => {
        setRows(r);
        setSelectedId((cur) => cur && r.some((x) => x.id === cur) ? cur : (r[0]?.id ?? null));
      })
      .catch((e: Error) => toast(e.message, "error"));
    getSettings().then(setSettings).catch(() => {});
  }, [toast]);

  useEffect(load, [load]);

  const stats = useMemo(() => {
    const all = rows ?? [];
    const weekAgo = Date.now() - 7 * 86_400_000;
    const monthAgo = Date.now() - 30 * 86_400_000;
    return {
      open: all.filter((r) => r.status === "new").length,
      week: all.filter((r) => new Date(r.created_at).getTime() > weekAgo).length,
      fixedMonth: all.filter((r) => r.status === "fixed" && r.resolved_at && new Date(r.resolved_at).getTime() > monthAgo).length,
      walaplus: all.filter((r) => r.app === "walaplus" && r.status === "new").length,
      walaone: all.filter((r) => r.app === "walaone" && r.status === "new").length,
    };
  }, [rows]);

  const visible = (rows ?? []).filter((r) => (status === "all" || r.status === status) && (app === "all" || r.app === app));
  const selected = (rows ?? []).find((r) => r.id === selectedId) ?? null;
  const extra = settings as Settings & { friction_post_ts?: string; friction_digest_at?: string };

  async function act(label: string, fn: () => Promise<string>) {
    setBusy(label);
    try {
      toast(await fn());
      load();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }
  const slack = (action: "post_friction_prompt" | "friction_digest") => () =>
    act(action, async () => {
      const r = await runAdminAction({ action });
      if (!r.ok) throw new Error(r.message);
      return r.message;
    });

  return (
    <>
      <PageHeader
        title="Friction inbox"
        sub={`Colleagues report a broken step with /friction or the pinned button in ${settings.channel_name}. Each report lands here with the sender's profile.`}
        actions={
          <>
            <Button icon="bell" loading={busy === "friction_digest"} onClick={slack("friction_digest")} title="Posts this week's counts to the channel now. The bot also posts them every Sunday at 09:00.">
              Send digest now
            </Button>
            <Button variant="primary" icon="slack" loading={busy === "post_friction_prompt"} onClick={slack("post_friction_prompt")} title="Posts and pins the 'Report a broken step' button, replacing the previous one.">
              {extra.friction_post_ts ? "Re-post the prompt" : "Post the prompt"}
            </Button>
          </>
        }
      />
      <div className="px-7 pb-8 space-y-4">
        <div className="grid grid-cols-4 gap-3">
          <StatTile label="Open" value={stats.open} tone={stats.open ? "warn" : "default"} sub={`WalaPlus ${stats.walaplus} · WalaOne ${stats.walaone}`} />
          <StatTile label="Received, last 7 days" value={stats.week} tone="brand" sub="goes into Sunday's digest" />
          <StatTile label="Fixed, last 30 days" value={stats.fixedMonth} sub="marked fixed here" />
          <StatTile label="Prompt in the channel" value={extra.friction_post_ts ? "Pinned" : "Not yet"} sub={extra.friction_digest_at ? `last digest ${fmtDateTime(extra.friction_digest_at)}` : "no digest sent yet"} />
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {(["all", "new", "fixed", "duplicate", "by_design"] as StatusFilter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setStatus(f)}
              className={clsx(
                "h-7 px-3 rounded-full text-[12.5px] font-medium border cursor-pointer transition-colors",
                status === f ? "bg-ink text-white border-ink" : "bg-white text-ink-2 border-line hover:bg-fill",
              )}
            >
              {f === "all" ? "All" : statusLabel(f)}
              {f !== "all" && rows && <span className="ml-1 opacity-60">{rows.filter((r) => r.status === f).length}</span>}
            </button>
          ))}
          <span className="w-px h-5 bg-line mx-1" />
          {(["all", "walaplus", "walaone"] as AppFilter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setApp(f)}
              className={clsx(
                "h-7 px-3 rounded-full text-[12.5px] font-medium border cursor-pointer transition-colors",
                app === f ? "bg-ink text-white border-ink" : "bg-white text-ink-2 border-line hover:bg-fill",
              )}
            >
              {f === "all" ? "Both apps" : APP_LABEL[f]}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-4 items-start">
          <div className="bg-white border border-line rounded-md shadow-card overflow-hidden">
            {!rows && <Spinner />}
            {rows && visible.length === 0 && (
              <Empty
                title={rows.length === 0 ? "No reports yet" : "Nothing here"}
                hint={rows.length === 0 ? `Post the prompt so colleagues can report a broken step from ${settings.channel_name}, or type /friction in Slack to try it yourself.` : "Try another status or app."}
              />
            )}
            {rows &&
              visible.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setSelectedId(r.id)}
                  className={clsx(
                    "w-full text-left px-4 py-3 border-b border-line-2 last:border-b-0 cursor-pointer transition-colors",
                    r.id === selectedId ? "bg-brand-light/60" : "hover:bg-fill/70",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Chip tone={STATUS_TONE[r.status]}>{statusLabel(r.status)}</Chip>
                    <span className="text-[12px] text-muted">{APP_LABEL[r.app]}</span>
                    <span className="flex-1" />
                    <span className="text-[11.5px] text-muted tabular-nums">{fmtDateTime(r.created_at)}</span>
                  </div>
                  <div className="text-[13px] font-medium text-ink mt-1.5 truncate">{r.tried}</div>
                  <div className="text-[12.5px] text-ink-2 line-clamp-2 mt-0.5">{r.happened}</div>
                  <div className="text-[11.5px] text-muted mt-1 flex items-center gap-1.5">
                    <span>{r.profile?.name ?? "Unknown"}</span>
                    {r.profile?.team && <span>· {r.profile.team}</span>}
                    {(r.screenshot_path || r.screenshot_url) && <span className="inline-flex items-center gap-1">· <Icon name="eye" size={12} /> screenshot</span>}
                  </div>
                </button>
              ))}
          </div>

          <div className="sticky top-6">
            {selected ? <Detail key={selected.id} report={selected} onChange={load} /> : rows && rows.length > 0 ? <Card><div className="text-[13px] text-muted">Pick a report on the left.</div></Card> : null}
          </div>
        </div>
      </div>
    </>
  );
}

function Detail({ report, onChange }: { report: FrictionReport; onChange: () => void }) {
  const toast = useToast();
  const [note, setNote] = useState(report.note);
  const [reply, setReply] = useState("");
  const [shot, setShot] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    setShot(null);
    if (!report.screenshot_path) return;
    let alive = true;
    frictionScreenshotUrl(report.screenshot_path)
      .then((u) => alive && setShot(u))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [report.screenshot_path]);

  async function act(label: string, fn: () => Promise<string>) {
    setBusy(label);
    try {
      toast(await fn());
      onChange();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  const setStatus = (s: FrictionStatus) =>
    act("status", async () => {
      await updateFriction(report.id, { status: s, resolved_at: s === "new" ? null : new Date().toISOString() });
      return s === "new" ? "Reopened." : `Marked ${statusLabel(s).toLowerCase()}.`;
    });

  const saveNote = () =>
    act("note", async () => {
      await updateFriction(report.id, { note: note.trim() });
      return "Note saved.";
    });

  const sendReply = () =>
    act("reply", async () => {
      if (!report.participant_id) throw new Error("This member was forgotten, so no DM is possible.");
      const r = await runAdminAction({ action: "dm_participant", participant_id: report.participant_id, text: reply.trim() });
      if (!r.ok) throw new Error(r.message);
      setReply("");
      return r.message;
    });

  const p = report.profile ?? {};
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <Chip tone={STATUS_TONE[report.status]}>{statusLabel(report.status)}</Chip>
          {APP_LABEL[report.app]}
        </span>
      }
      action={
        <Select className="w-36 h-7 text-[12px]" value={report.status} disabled={busy === "status"} onChange={(e) => void setStatus(e.target.value as FrictionStatus)}>
          {FRICTION_STATUS.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </Select>
      }
    >
      <div className="space-y-4">
        <div>
          <Label>Tried to</Label>
          <div className="text-[14px] font-medium text-ink">{report.tried}</div>
        </div>
        <div>
          <Label>What happened</Label>
          <div className="text-[13px] text-ink whitespace-pre-wrap">{report.happened}</div>
        </div>
        {(shot || report.screenshot_url) && (
          <div>
            <Label>Screenshot</Label>
            {shot ? (
              <a href={shot} target="_blank" rel="noreferrer" className="block">
                <img src={shot} alt="Screenshot sent with the report" className="max-h-72 rounded-sm border border-line object-contain bg-fill" />
              </a>
            ) : (
              <a href={report.screenshot_url ?? "#"} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[13px] text-brand-text hover:underline">
                <Icon name="external" size={13} /> Open in Slack
              </a>
            )}
          </div>
        )}
        <div>
          <Label>Sent by</Label>
          <div className="text-[13px] text-ink">
            {p.name ?? "Unknown"}
            <span className="text-muted">
              {[p.age_band, p.gender ? p.gender[0]!.toUpperCase() + p.gender.slice(1) : null, p.device ? (p.device === "iphone" ? "iPhone" : "Android") : null, p.team, p.apps?.length ? p.apps.map((a) => (a === "walaone" ? "WalaOne" : "WalaPlus")).join(" + ") : null]
                .filter(Boolean)
                .map((x) => ` · ${x}`)
                .join("")}
            </span>
          </div>
          <div className="text-[11.5px] text-muted mt-0.5 tabular-nums">
            {fmtDateTime(report.created_at)}
            {report.resolved_at && ` · ${statusLabel(report.status).toLowerCase()} ${fmtDateTime(report.resolved_at)}`}
          </div>
        </div>
        <div>
          <Label hint="only you see this">Note</Label>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ticket number, what you found, who owns the fix." className="min-h-16" />
          <div className="mt-1.5 flex justify-end">
            <Button size="sm" loading={busy === "note"} disabled={note.trim() === report.note} onClick={saveNote}>Save note</Button>
          </div>
        </div>
        <div>
          <Label hint={report.participant_id ? "sent as the bot" : "member forgotten"}>Reply by DM</Label>
          <Textarea value={reply} onChange={(e) => setReply(e.target.value)} placeholder={`Thanks ${p.name?.split(" ")[0] ?? ""}, we reproduced it and the fix ships next week.`} className="min-h-16" disabled={!report.participant_id} />
          <div className="mt-1.5 flex justify-end">
            <Button size="sm" variant="primary" icon="send" loading={busy === "reply"} disabled={!reply.trim() || !report.participant_id} onClick={sendReply}>Send DM</Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
