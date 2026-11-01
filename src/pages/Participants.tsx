import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/AppShell";
import { Bar } from "@/components/Bar";
import { StatTile } from "@/components/StatTile";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { Input, Select, Toggle } from "@/components/ui/Field";
import { Spinner } from "@/components/ui/Empty";
import { useToast } from "@/components/ui/Toast";
import { forgetParticipant, listChannelMembers, listParticipants, listReminderExclusions, participantResponseCounts, runAdminAction, setReminders } from "@/data/queries";
import { fmtDate } from "@/lib/format";
import { groupBy, profileOf, SPLITS, type SplitKey } from "@/lib/results";
import type { ChannelMember, Participant } from "@/lib/types";

const MEMBER_COLS = "grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_70px_70px_80px_110px_60px_90px_70px_80px]";

export default function Participants() {
  const toast = useToast();
  const [people, setPeople] = useState<Participant[] | null>(null);
  const [members, setMembers] = useState<ChannelMember[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  /** Slack ids of members who get no reminder DMs. */
  const [off, setOff] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [qMissing, setQMissing] = useState("");
  const [group, setGroup] = useState<SplitKey>("team");
  const [busy, setBusy] = useState<string | null>(null);

  function load() {
    Promise.all([listParticipants(), listChannelMembers(), participantResponseCounts(), listReminderExclusions()])
      .then(([p, m, c, x]) => {
        setPeople(p);
        setMembers(m);
        setCounts(c);
        setOff(new Set(x));
      })
      .catch((e: Error) => toast(e.message, "error"));
  }
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const stats = useMemo(() => {
    const p = people ?? [];
    const withProfile = new Set(p.map((x) => x.slack_user_id));
    const monthAgo = Date.now() - 30 * 86_400_000;
    const missing = members.filter((m) => !withProfile.has(m.slack_user_id)).sort((a, b) => a.name.localeCompare(b.name));
    const toRemind = missing.filter((m) => !off.has(m.slack_user_id)).length;
    return {
      size: p.length,
      missing: missing.length,
      toRemind,
      month: p.filter((x) => new Date(x.profile_at).getTime() > monthAgo).length,
      missingMembers: missing,
    };
  }, [people, members, off]);

  const weeks = useMemo(() => {
    const out: { label: string; n: number }[] = [];
    const now = new Date();
    for (let w = 7; w >= 0; w--) {
      const start = new Date(now);
      start.setDate(now.getDate() - 7 * w - now.getDay());
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(start.getDate() + 7);
      const n = (people ?? []).filter((p) => {
        const t = new Date(p.profile_at).getTime();
        return t >= start.getTime() && t < end.getTime();
      }).length;
      out.push({ label: fmtDate(start.toISOString()), n });
    }
    return out;
  }, [people]);

  const groups = useMemo(() => groupBy((people ?? []).map(profileOf), group), [people, group]);

  const visible = (people ?? []).filter((p) => {
    const s = q.trim().toLowerCase();
    return !s || [p.name, p.team ?? "", p.device, p.age_band, p.gender].some((v) => v.toLowerCase().includes(s));
  });

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
  /** Switches reminder DMs on or off for one member, at once on screen, then in the database. */
  async function toggleReminders(slackUserId: string, name: string, on: boolean) {
    const flip = (wantOn: boolean) =>
      setOff((cur) => {
        const next = new Set(cur);
        if (wantOn) next.delete(slackUserId);
        else next.add(slackUserId);
        return next;
      });
    flip(on);
    try {
      await setReminders(slackUserId, name, on);
      toast(on ? `${name} gets reminder DMs again.` : `${name} will not get reminder DMs.`);
    } catch (e) {
      flip(!on);
      toast((e as Error).message, "error");
    }
  }

  const slack = (action: "repost_profile" | "remind_missing_profiles" | "sync_members") => () =>
    act(action, async () => {
      const r = await runAdminAction({ action });
      if (!r.ok) throw new Error(r.message);
      return r.message;
    });

  if (!people) return <Spinner />;
  const maxWeek = Math.max(1, ...weeks.map((w) => w.n));

  return (
    <>
      <PageHeader
        title="Participants"
        sub="Everyone in the channel who has filled in a profile. No profile, no answers: the bot asks for it first. A saved profile is final; to correct one, forget the member and they fill it in again. Switch Reminders off for anyone who should not get reminder DMs."
        actions={
          <>
            <Button icon="users" loading={busy === "sync_members"} onClick={slack("sync_members")}>Sync channel</Button>
            <Button icon="bell" loading={busy === "remind_missing_profiles"} disabled={!stats.toRemind} onClick={slack("remind_missing_profiles")}>
              Remind {stats.toRemind} without a profile
            </Button>
            <Button variant="primary" icon="send" loading={busy === "repost_profile"} onClick={slack("repost_profile")}>Update profile post</Button>
          </>
        }
      />
      <div className="px-7 pb-10 space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <StatTile label="With a profile" value={stats.size} tone="brand" sub={`of ${members.length || "?"} channel members`} />
          <StatTile
            label="Missing a profile"
            value={stats.missing}
            tone={stats.missing ? "warn" : "default"}
            sub={stats.missing > stats.toRemind ? `${stats.missing - stats.toRemind} excluded from reminders` : "cannot answer until they fill it in"}
          />
          <StatTile label="Joined last 30 days" value={stats.month} tone="one" sub="profiles completed" />
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4">
          <Card
            title="Who is on the panel"
            action={
              <Select className="w-32 h-7 text-[12px]" value={group} onChange={(e) => setGroup(e.target.value as SplitKey)}>
                {SPLITS.filter((s) => s.value !== "none").map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </Select>
            }
          >
            {groups.length === 0 ? (
              <div className="text-[13px] text-muted">No profiles yet. Put the profile post in the channel.</div>
            ) : (
              groups.map((g) => <Bar key={g.label} label={g.label} count={g.count} total={stats.size} tone="one" />)
            )}
          </Card>
          <Card title="Profiles completed, last eight weeks">
            <div className="flex items-end gap-2 h-32">
              {weeks.map((w) => (
                <div key={w.label} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                  <div className="text-[11px] text-ink-2 tabular-nums">{w.n}</div>
                  <div className="w-full rounded-t-sm bg-brand" style={{ height: `${Math.max(4, (100 * w.n) / maxWeek)}%` }} />
                  <div className="text-[10.5px] text-muted truncate">{w.label}</div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {stats.missing > 0 && (
          <Card
            title={`Without a profile (${stats.missing})`}
            action={<Input className="w-56 h-8" placeholder="Search name" value={qMissing} onChange={(e) => setQMissing(e.target.value)} />}
          >
            <p className="text-[12px] text-muted mb-3">
              Reminders on: the bot sends the profile reminder DM when a study goes live (once a week at most) and when you press Remind. Switch it off to leave someone out.
            </p>
            <div className="grid grid-cols-3 gap-x-6 gap-y-1.5 max-h-72 overflow-y-auto pr-1">
              {stats.missingMembers
                .filter((m) => !qMissing.trim() || m.name.toLowerCase().includes(qMissing.trim().toLowerCase()))
                .map((m) => {
                  const on = !off.has(m.slack_user_id);
                  return (
                    <div key={m.slack_user_id} className="flex items-center justify-between gap-2 min-w-0 py-0.5">
                      <span className={on ? "text-[12.5px] text-ink truncate" : "text-[12.5px] text-muted line-through truncate"}>{m.name || m.slack_user_id}</span>
                      <Toggle checked={on} onChange={(v) => void toggleReminders(m.slack_user_id, m.name, v)} ariaLabel={`Reminders for ${m.name}`} />
                    </div>
                  );
                })}
            </div>
          </Card>
        )}

        <Card title={`Members (${visible.length})`} action={<Input className="w-64 h-8" placeholder="Search name, team, device" value={q} onChange={(e) => setQ(e.target.value)} />} pad={false}>
          <div className={`grid ${MEMBER_COLS} gap-2 px-4 h-8 items-center text-[11px] font-semibold uppercase tracking-[0.04em] text-muted bg-fill border-b border-line-2`}>
            <div>Name</div><div>Team</div><div>Age</div><div>Gender</div><div>Device</div><div>Apps</div><div>Lang</div><div>Profile</div><div className="text-right">Answers</div><div className="text-right">Reminders</div>
          </div>
          {visible.map((p) => (
            <div key={p.id} className={`grid ${MEMBER_COLS} gap-2 px-4 py-2 items-center text-[12.5px] border-b border-line-2 last:border-b-0 group`}>
              <div className="text-ink truncate flex items-center gap-2">
                {p.name}
                <button
                  type="button"
                  className="opacity-0 group-hover:opacity-100 text-[11px] text-muted hover:text-danger cursor-pointer"
                  disabled={busy === p.id}
                  onClick={() => {
                    if (window.confirm(`Forget ${p.name}? Their name is removed from every answer. The counts stay.`))
                      void act(p.id, async () => {
                        await forgetParticipant(p.id);
                        return "Forgotten.";
                      });
                  }}
                >
                  forget
                </button>
              </div>
              <div className="text-ink-2 truncate">{p.team ?? "—"}</div>
              <div className="text-ink-2">{p.age_band}</div>
              <div className="text-ink-2 capitalize">{p.gender}</div>
              <div className="text-ink-2">{p.device === "iphone" ? "iPhone" : "Android"}</div>
              <div className="flex gap-1">
                {p.apps.map((a) => (
                  <Chip key={a} tone={a === "walaone" ? "one" : "live"}>{a === "walaone" ? "WalaOne" : "WalaPlus"}</Chip>
                ))}
              </div>
              <div className="text-ink-2 uppercase">{p.language}</div>
              <div className="text-muted tabular-nums">{fmtDate(p.profile_at)}</div>
              <div className="text-ink text-right tabular-nums">{counts[p.id] ?? 0}</div>
              <div className="flex justify-end">
                <Toggle checked={!off.has(p.slack_user_id)} onChange={(v) => void toggleReminders(p.slack_user_id, p.name, v)} ariaLabel={`Reminders for ${p.name}`} />
              </div>
            </div>
          ))}
          {visible.length === 0 && <div className="px-4 py-8 text-[13px] text-muted text-center">No one matches.</div>}
        </Card>
      </div>
    </>
  );
}
