import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { Spinner } from "@/components/ui/Empty";
import { Input, Label, Textarea, Toggle } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { getAnnouncement, getSettings, runAdminAction, saveAnnouncement, type AnnouncementDraft } from "@/data/queries";
import { fmtDateTime, fromLocalInput, toLocalInput } from "@/lib/format";
import { ANNOUNCEMENT_STATUS, DEFAULT_SETTINGS, type Settings } from "@/lib/types";
import { announcementTone } from "./Announcements";

const blank = (): AnnouncementDraft => ({ title_en: "", body_en: "", body_ar: "", pin: false, publish_at: null, status: "draft" });

/** New announcement, or an existing one in any state. A posted one is edited in place and the bot's post follows. */
export default function AnnouncementEditor() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const [draft, setDraft] = useState<AnnouncementDraft | null>(id ? null : blank());
  const [postedAt, setPostedAt] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [removePost, setRemovePost] = useState(true);

  useEffect(() => {
    getSettings().then(setSettings).catch(() => {});
    if (!id) return;
    getAnnouncement(id)
      .then((a) => {
        setDraft({ id: a.id, title_en: a.title_en, body_en: a.body_en, body_ar: a.body_ar, pin: a.pin, publish_at: a.publish_at, status: a.status });
        setPostedAt(a.posted_at);
      })
      .catch((e: Error) => toast(e.message, "error"));
  }, [id, toast]);

  if (!draft) return <Spinner />;
  const posted = draft.status === "posted";
  const ready = draft.body_en.trim().length > 0;
  const set = <K extends keyof AnnouncementDraft>(k: K, v: AnnouncementDraft[K]) => setDraft({ ...draft, [k]: v });

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

  async function persist(status: AnnouncementDraft["status"]): Promise<string> {
    const saved = await saveAnnouncement({ ...draft!, status });
    setDraft({ ...draft!, id: saved.id, status: saved.status });
    return saved.id;
  }

  const saveDraft = () =>
    act("draft", async () => {
      const aid = await persist("draft");
      toast(draft.status === "scheduled" ? "Saved as a draft; it is no longer scheduled." : "Draft saved.");
      if (!id) nav(`/announcements/${aid}`, { replace: true });
    });

  const schedule = () =>
    act("schedule", async () => {
      if (!ready) throw new Error("Write the English text first.");
      if (!draft.publish_at || new Date(draft.publish_at).getTime() < Date.now()) throw new Error("Pick a date and time in the future, or use Post now.");
      await persist("scheduled");
      toast("Scheduled. The bot posts it within five minutes of that time.");
      nav("/announcements");
    });

  const postNow = () =>
    act("post", async () => {
      if (!ready) throw new Error("Write the English text first.");
      if (!settings.channel_id) throw new Error("Set the Slack channel ID in Settings first.");
      const aid = await persist("draft");
      const r = await runAdminAction({ action: "post_announcement", announcement_id: aid });
      if (!r.ok) throw new Error(r.message);
      toast(r.message);
      nav("/announcements");
    });

  const saveChanges = () =>
    act("save", async () => {
      if (!ready) throw new Error("Write the English text first.");
      const aid = await persist("posted");
      const r = await runAdminAction({ action: "refresh_announcement", announcement_id: aid });
      toast(r.message, r.ok ? "ok" : "error");
      nav("/announcements");
    });

  const remove = () =>
    act("delete", async () => {
      if (!draft.id) return;
      const r = await runAdminAction({ action: "delete_announcement", announcement_id: draft.id, remove_posts: posted && removePost });
      if (!r.ok) throw new Error(r.message);
      setConfirmDelete(false);
      toast(r.message);
      nav("/announcements");
    });

  return (
    <>
      <PageHeader
        title={id ? draft.title_en || "Announcement" : "New announcement"}
        back={{ to: "/announcements", label: "Announcements" }}
        sub={
          <span className="flex items-center gap-2">
            <Chip tone={announcementTone(draft.status)}>{ANNOUNCEMENT_STATUS[draft.status]}</Chip>
            {posted
              ? `Posted to ${settings.channel_name} on ${fmtDateTime(postedAt)}. Saving updates the post there.`
              : draft.status === "scheduled"
                ? `Goes out ${fmtDateTime(draft.publish_at)}. Save draft takes it off the schedule; Schedule puts it back.`
                : "Nothing reaches Slack until you post or schedule."}
          </span>
        }
        actions={
          posted ? (
            <>
              <Button variant="danger" icon="trash" onClick={() => setConfirmDelete(true)}>Delete</Button>
              <Button variant="primary" icon="check" loading={busy === "save"} disabled={!ready} onClick={saveChanges}>
                Save changes
              </Button>
            </>
          ) : (
            <>
              {draft.id && (
                <Button variant="danger" icon="trash" onClick={() => setConfirmDelete(true)}>Delete</Button>
              )}
              <Button loading={busy === "draft"} onClick={saveDraft}>Save draft</Button>
              <Button icon="clock" loading={busy === "schedule"} disabled={!ready} onClick={schedule}>Schedule</Button>
              <Button variant="primary" icon="send" loading={busy === "post"} disabled={!ready} onClick={postNow}>Post now</Button>
            </>
          )
        }
      />

      <ConfirmDialog
        open={confirmDelete}
        title={`Delete “${draft.title_en || "this announcement"}”?`}
        confirmLabel="Delete"
        danger
        busy={busy === "delete"}
        onClose={() => setConfirmDelete(false)}
        onConfirm={remove}
      >
        {posted ? (
          <>
            <p>The announcement leaves the dashboard. There is no undo.</p>
            <Toggle checked={removePost} onChange={setRemovePost} label={`Also remove the bot's post from ${settings.channel_name}`} hint="Off: the post stays in Slack and only the dashboard record goes." />
          </>
        ) : (
          <p>Nothing of it reached the channel. There is no undo.</p>
        )}
      </ConfirmDialog>

      <div className="px-7 pb-10 grid grid-cols-[minmax(0,1fr)_400px] gap-4 items-start">
        <div className="space-y-4">
          <Card title="What the channel reads">
            <div className="space-y-3">
              <div>
                <Label hint="optional, shown as the bold headline">Title</Label>
                <Input maxLength={75} value={draft.title_en} onChange={(e) => set("title_en", e.target.value)} placeholder="e.g. Thank you: the first poll is closed" />
              </div>
              <div>
                <Label hint="Slack formatting works: *bold*, _italic_, <https://link|text>">English</Label>
                <Textarea className="min-h-40" maxLength={2900} value={draft.body_en} onChange={(e) => set("body_en", e.target.value)} />
              </div>
              <div>
                <Label hint="optional">Arabic</Label>
                <Textarea className="ar min-h-40" maxLength={2900} value={draft.body_ar} onChange={(e) => set("body_ar", e.target.value)} />
              </div>
            </div>
          </Card>
          <Card title="Where and when">
            <div className="space-y-3">
              <Toggle
                checked={draft.pin}
                onChange={(v) => set("pin", v)}
                label={`Pin it in ${settings.channel_name}`}
                hint="Pinned posts sit in the channel's pinned list. Switch off and save to unpin."
              />
              {!posted && (
                <div>
                  <Label hint="leave empty and use Post now to send it by hand">Schedule for</Label>
                  <Input type="datetime-local" value={toLocalInput(draft.publish_at)} onChange={(e) => set("publish_at", fromLocalInput(e.target.value))} />
                  <div className="text-[12px] text-muted mt-1">The scheduler runs every five minutes, so the post lands within five minutes of this time.</div>
                </div>
              )}
            </div>
          </Card>
        </div>
        <div className="sticky top-6">
          <Label>Slack preview</Label>
          <div className="bg-white border border-line rounded-md overflow-hidden">
            <div className="px-3 py-2 border-b border-line-2 text-[11.5px] text-muted flex items-center gap-2">
              <span className="font-semibold text-ink-2">{settings.channel_name}</span>
              <span>· posted by the bot{draft.pin ? " · pinned" : ""}</span>
            </div>
            <div className="p-3 flex gap-2.5">
              <span className="h-8 w-8 rounded-sm bg-brand text-brand-ink grid place-items-center text-[11px] font-bold shrink-0">RD</span>
              <div className="min-w-0 flex-1 text-[13px]">
                <div>
                  <span className="font-semibold text-ink">Research Desk</span> <span className="text-[11px] text-muted">APP · now</span>
                </div>
                {draft.title_en.trim() && <div className="text-[13.5px] font-semibold text-ink mt-1">{draft.title_en}</div>}
                <div className="text-ink-2 whitespace-pre-wrap mt-1">{draft.body_en || "…"}</div>
                {draft.body_ar && <div className="ar text-ink-2 whitespace-pre-wrap mt-1">{draft.body_ar}</div>}
                <div className="text-[11.5px] text-muted mt-2">From the research team · من فريق البحث</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
