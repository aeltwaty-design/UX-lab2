import { useEffect, useState } from "react";
import { PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input, Label, Select, Textarea } from "@/components/ui/Field";
import { Spinner } from "@/components/ui/Empty";
import { useToast } from "@/components/ui/Toast";
import { addAdmin, getSettings, listAdmins, removeAdmin, runAdminAction, saveSettings } from "@/data/queries";
import { useAuth } from "@/lib/auth";
import type { Settings as SettingsT } from "@/lib/types";

export default function Settings() {
  const toast = useToast();
  const { session } = useAuth();
  const [s, setS] = useState<SettingsT | null>(null);
  const [admins, setAdmins] = useState<string[]>([]);
  const [newAdmin, setNewAdmin] = useState("");
  const [postLink, setPostLink] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const fnBase = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

  useEffect(() => {
    Promise.all([getSettings(), listAdmins()])
      .then(([st, ad]) => {
        setS(st);
        setAdmins(ad);
      })
      .catch((e: Error) => toast(e.message, "error"));
  }, [toast]);

  async function run(label: string, fn: () => Promise<string>) {
    setBusy(label);
    try {
      toast(await fn());
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  if (!s) return <Spinner />;
  const set = <K extends keyof SettingsT>(k: K, v: SettingsT[K]) => setS({ ...s, [k]: v });

  return (
    <>
      <PageHeader title="Settings" sub="Where the bot posts, who can sign in, and the rules every study follows." />
      <div className="px-7 pb-8 grid grid-cols-[minmax(0,1fr)_380px] gap-4 items-start">
        <div className="space-y-4">
          <Card
            title="Slack channel"
            action={
              <Button size="sm" icon="slack" loading={busy === "test"} onClick={() => run("test", async () => (await runAdminAction({ action: "test_slack" })).message)}>
                Test connection
              </Button>
            }
          >
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label hint="Starts with C">Channel ID</Label>
                <Input value={s.channel_id} onChange={(e) => set("channel_id", e.target.value.trim())} placeholder="C0123ABCDEF" />
              </div>
              <div>
                <Label>Channel name</Label>
                <Input value={s.channel_name} onChange={(e) => set("channel_name", e.target.value)} />
              </div>
              <div className="col-span-2">
                <Label hint="used for links in DMs">Workspace URL</Label>
                <Input value={s.workspace_url} onChange={(e) => set("workspace_url", e.target.value.trim())} placeholder="https://walaplus.slack.com" />
              </div>
            </div>
            <p className="text-[12px] text-muted mt-3">
              The bot token and signing secret live in Supabase as function secrets, never in this app. See the README.
            </p>
          </Card>

          <Card title="Rules">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label hint="per member, per week">Hours cap</Label>
                <Input type="number" min={1} max={20} value={s.hours_cap} onChange={(e) => set("hours_cap", Number(e.target.value))} />
              </div>
              <div>
                <Label hint="written as 'under N' in the channel">Small group</Label>
                <Input type="number" min={2} max={30} value={s.small_group} onChange={(e) => set("small_group", Number(e.target.value))} />
              </div>
              <div>
                <Label>Default language</Label>
                <Select value={s.default_lang} onChange={(e) => set("default_lang", e.target.value as "en" | "ar")}>
                  <option value="en">English first</option>
                  <option value="ar">Arabic first</option>
                </Select>
              </div>
              <div className="col-span-3">
                <Label hint="one per line; shown in the profile form">Teams</Label>
                <Textarea
                  value={s.teams.join("\n")}
                  onChange={(e) => set("teams", e.target.value.split("\n").map((t) => t.trim()).filter(Boolean))}
                  className="min-h-32"
                />
              </div>
            </div>
            <div className="flex justify-end mt-3">
              <Button variant="primary" loading={busy === "save"} onClick={() => run("save", async () => { await saveSettings(s); return "Settings saved."; })}>
                Save settings
              </Button>
            </div>
          </Card>

          <Card title="Admins">
            <p className="text-[12.5px] text-muted mb-3">Only these emails can sign in. Colleagues never need an account.</p>
            <ul className="divide-y divide-line-2 border border-line rounded-sm">
              {admins.map((a) => (
                <li key={a} className="flex items-center justify-between px-3 h-9 text-[13px]">
                  <span>{a}{a === session?.user.email && <span className="text-muted"> · you</span>}</span>
                  {a !== session?.user.email && (
                    <Button size="sm" variant="ghost" icon="trash" onClick={() => run("rm", async () => { await removeAdmin(a); setAdmins(admins.filter((x) => x !== a)); return "Removed."; })}>
                      Remove
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            <div className="flex gap-2 mt-3">
              <Input type="email" placeholder="colleague@walaplus.com" value={newAdmin} onChange={(e) => setNewAdmin(e.target.value)} />
              <Button
                icon="plus"
                disabled={!newAdmin.includes("@")}
                loading={busy === "add"}
                onClick={() => run("add", async () => { await addAdmin(newAdmin); setAdmins([...admins, newAdmin.trim().toLowerCase()].sort()); setNewAdmin(""); return "Admin added. They sign in with an email link."; })}
              >
                Add
              </Button>
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Slack app wiring">
            <dl className="text-[12.5px] space-y-2.5">
              <div>
                <dt className="text-muted">Event subscriptions request URL</dt>
                <dd className="font-mono text-[11.5px] text-ink break-all">{fnBase}/slack-events</dd>
              </div>
              <div>
                <dt className="text-muted">Interactivity request URL</dt>
                <dd className="font-mono text-[11.5px] text-ink break-all">{fnBase}/slack-interactions</dd>
              </div>
              <div>
                <dt className="text-muted">Bot events</dt>
                <dd className="text-ink">member_joined_channel, member_left_channel</dd>
              </div>
              <div>
                <dt className="text-muted">Bot scopes</dt>
                <dd className="text-ink">chat:write, im:write, users:read, channels:read, groups:read, channels:history</dd>
              </div>
              <div>
                <dt className="text-muted">Scheduler</dt>
                <dd className="text-ink">pg_cron calls publish-due every five minutes (supabase/cron.sql).</dd>
              </div>
            </dl>
          </Card>
          <Card title="Channel upkeep">
            <div className="space-y-2">
              <Button className="w-full" icon="users" loading={busy === "sync"} onClick={() => run("sync", async () => (await runAdminAction({ action: "sync_members" })).message)}>
                Sync channel members
              </Button>
              <Button className="w-full" icon="send" loading={busy === "repost"} onClick={() => run("repost", async () => (await runAdminAction({ action: "repost_profile" })).message)}>
                Re-post the profile form
              </Button>
            </div>
            <p className="text-[12px] text-muted mt-3">Members are synced every hour as well. Re-posting replaces the pinned "fill in your profile" message in the channel.</p>
          </Card>
          <Card title="Delete a bot post">
            <p className="text-[12.5px] text-muted mb-3">In Slack, open the message menu (More actions) and choose Copy link. Only the bot's own posts can be deleted.</p>
            <div className="flex gap-2">
              <Input placeholder="https://walaplus.slack.com/archives/C…/p…" value={postLink} onChange={(e) => setPostLink(e.target.value)} />
              <Button
                icon="trash"
                disabled={!postLink.trim()}
                loading={busy === "delete_post"}
                onClick={() =>
                  run("delete_post", async () => {
                    const r = await runAdminAction({ action: "delete_post", link: postLink.trim() });
                    if (!r.ok) throw new Error(r.message);
                    setPostLink("");
                    return r.message;
                  })
                }
              >
                Delete
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
