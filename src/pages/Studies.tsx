import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { clsx } from "clsx";
import { PageHeader } from "@/components/AppShell";
import { StatTile } from "@/components/StatTile";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Empty, Spinner } from "@/components/ui/Empty";
import { useToast } from "@/components/ui/Toast";
import { listStudies } from "@/data/queries";
import { fmtDate, typeLabel } from "@/lib/format";
import { STATUS_LABEL, type Study, type StudyStatus } from "@/lib/types";

type Filter = "all" | StudyStatus;
const FILTERS: { v: Filter; label: string }[] = [
  { v: "all", label: "All" },
  { v: "draft", label: "Draft" },
  { v: "scheduled", label: "Scheduled" },
  { v: "live", label: "Live" },
  { v: "closed", label: "Closed" },
  { v: "reported", label: "Reported" },
];

export function audienceLabel(s: Pick<Study, "audience" | "audience_teams">): string {
  if (s.audience === "everyone") return "Everyone in the channel";
  if (s.audience === "panel") return "Members with a profile";
  return s.audience_teams.length ? s.audience_teams.join(", ") : "Chosen teams";
}

export default function Studies() {
  const nav = useNavigate();
  const toast = useToast();
  const [rows, setRows] = useState<Study[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    listStudies()
      .then(setRows)
      .catch((e: Error) => toast(e.message, "error"));
  }, [toast]);

  const stats = useMemo(() => {
    const all = rows ?? [];
    const monthAgo = Date.now() - 30 * 86_400_000;
    return {
      live: all.filter((s) => s.status === "live").length,
      scheduled: all.filter((s) => s.status === "scheduled").length,
      closedMonth: all.filter((s) => s.closed_at && new Date(s.closed_at).getTime() > monthAgo).length,
      answersMonth: all
        .filter((s) => s.published_at && new Date(s.published_at).getTime() > monthAgo)
        .reduce((n, s) => n + s.response_count, 0),
    };
  }, [rows]);

  const visible = (rows ?? []).filter((s) => filter === "all" || s.status === filter);

  return (
    <>
      <PageHeader
        title="Studies"
        sub="Every poll and survey the channel has seen, with its answers and results post."
        actions={<Button variant="primary" icon="plus" onClick={() => nav("/studies/new")}>New study</Button>}
      />
      <div className="px-7 pb-8 space-y-4">
        <div className="grid grid-cols-4 gap-3">
          <StatTile label="Live now" value={stats.live} tone="brand" sub="collecting answers" />
          <StatTile label="Scheduled" value={stats.scheduled} tone="one" sub="post themselves on time" />
          <StatTile label="Closed, last 30 days" value={stats.closedMonth} sub="awaiting or carrying a results post" />
          <StatTile label="Answers, last 30 days" value={stats.answersMonth} sub="across studies published in the period" />
        </div>

        <div className="flex items-center gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.v}
              type="button"
              onClick={() => setFilter(f.v)}
              className={clsx(
                "h-7 px-3 rounded-full text-[12.5px] font-medium border cursor-pointer transition-colors",
                filter === f.v ? "bg-ink text-white border-ink" : "bg-white text-ink-2 border-line hover:bg-fill",
              )}
            >
              {f.label}
              {f.v !== "all" && rows && (
                <span className="ml-1 opacity-60">{rows.filter((s) => s.status === f.v).length}</span>
              )}
            </button>
          ))}
        </div>

        <div className="bg-white border border-line rounded-md shadow-card overflow-hidden">
          <div className="grid grid-cols-[minmax(0,2fr)_120px_minmax(0,1.2fr)_150px_110px_110px] gap-3 px-4 h-9 items-center text-[11.5px] font-semibold uppercase tracking-[0.04em] text-muted border-b border-line-2 bg-fill">
            <div>Study</div>
            <div>Type</div>
            <div>Audience</div>
            <div>Publish → close</div>
            <div className="text-right">Answers</div>
            <div>Status</div>
          </div>
          {!rows && <Spinner />}
          {rows && visible.length === 0 && (
            <Empty
              title={filter === "all" ? "No studies yet" : `Nothing ${STATUS_LABEL[filter as StudyStatus].toLowerCase()}`}
              hint="Create a poll for the first channel post. It takes two minutes and posts itself on the date you choose."
              action={filter === "all" ? <Button variant="primary" icon="plus" onClick={() => nav("/studies/new")}>New study</Button> : undefined}
            />
          )}
          {rows &&
            visible.map((s) => (
              <Link
                key={s.id}
                to={s.status === "draft" ? `/studies/${s.id}/edit` : `/studies/${s.id}`}
                className="grid grid-cols-[minmax(0,2fr)_120px_minmax(0,1.2fr)_150px_110px_110px] gap-3 px-4 py-3 items-center border-b border-line-2 last:border-b-0 hover:bg-fill/70 transition-colors"
              >
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-ink truncate">{s.title_en || "Untitled"}</div>
                  {s.title_ar && <div className="ar text-[12px] text-muted truncate">{s.title_ar}</div>}
                </div>
                <div className="text-[12.5px] text-ink-2">{typeLabel(s.type)}</div>
                <div className="text-[12.5px] text-ink-2 truncate">{audienceLabel(s)}</div>
                <div className="text-[12.5px] text-ink-2 tabular-nums">
                  {fmtDate(s.publish_at ?? s.published_at)} → {fmtDate(s.close_at ?? s.closed_at)}
                </div>
                <div className="text-[13px] text-ink text-right tabular-nums">
                  {s.response_count}
                  {s.target ? <span className="text-muted"> / {s.target}</span> : null}
                </div>
                <div>
                  <Chip tone={s.status}>{STATUS_LABEL[s.status]}</Chip>
                </div>
              </Link>
            ))}
        </div>
      </div>
    </>
  );
}
