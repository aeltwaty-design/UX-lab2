import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Empty, Spinner } from "@/components/ui/Empty";
import { useToast } from "@/components/ui/Toast";
import { listAnnouncements } from "@/data/queries";
import { fmtDateTime } from "@/lib/format";
import { ANNOUNCEMENT_STATUS, type Announcement, type AnnouncementStatus } from "@/lib/types";

export function announcementTone(s: AnnouncementStatus): "draft" | "scheduled" | "closed" {
  return s === "posted" ? "closed" : s;
}

export function firstLine(s: string): string {
  return s.trim().split("\n")[0] ?? "";
}

const COLS = "grid-cols-[minmax(0,2fr)_190px_80px_110px]";

export default function Announcements() {
  const nav = useNavigate();
  const toast = useToast();
  const [rows, setRows] = useState<Announcement[] | null>(null);

  useEffect(() => {
    listAnnouncements()
      .then(setRows)
      .catch((e: Error) => toast(e.message, "error"));
  }, [toast]);

  const when = (a: Announcement) =>
    a.status === "posted" ? `Posted ${fmtDateTime(a.posted_at)}` : a.status === "scheduled" ? `Goes out ${fmtDateTime(a.publish_at)}` : `Edited ${fmtDateTime(a.updated_at)}`;

  return (
    <>
      <PageHeader
        title="Announcements"
        sub="Posts from the research team that are not studies: a launch, a thank-you, what changed because of the answers."
        actions={<Button variant="primary" icon="plus" onClick={() => nav("/announcements/new")}>New announcement</Button>}
      />
      <div className="px-7 pb-8">
        <div className="bg-white border border-line rounded-md shadow-card overflow-hidden">
          <div className={`grid ${COLS} gap-3 px-4 h-9 items-center text-[11.5px] font-semibold uppercase tracking-[0.04em] text-muted border-b border-line-2 bg-fill`}>
            <div>Announcement</div>
            <div>When</div>
            <div>Pinned</div>
            <div>Status</div>
          </div>
          {!rows && <Spinner />}
          {rows && rows.length === 0 && (
            <Empty
              title="No announcements yet"
              hint="Write one in English and Arabic, post it now or schedule it. The bot posts it in the channel; you can edit or remove it later."
              action={<Button variant="primary" icon="plus" onClick={() => nav("/announcements/new")}>New announcement</Button>}
            />
          )}
          {rows &&
            rows.map((a) => (
              <Link
                key={a.id}
                to={`/announcements/${a.id}`}
                className={`grid ${COLS} gap-3 px-4 py-3 items-center border-b border-line-2 last:border-b-0 hover:bg-fill/70 transition-colors`}
              >
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-ink truncate">{a.title_en || firstLine(a.body_en) || "Untitled"}</div>
                  {a.title_en && <div className="text-[12px] text-muted truncate">{firstLine(a.body_en)}</div>}
                </div>
                <div className="text-[12.5px] text-ink-2 tabular-nums">{when(a)}</div>
                <div className="text-[12.5px] text-ink-2">{a.pin ? "Yes" : "—"}</div>
                <div>
                  <Chip tone={announcementTone(a.status)}>{ANNOUNCEMENT_STATUS[a.status]}</Chip>
                </div>
              </Link>
            ))}
        </div>
      </div>
    </>
  );
}
