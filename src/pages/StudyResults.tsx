import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { clsx } from "clsx";
import { PageHeader } from "@/components/AppShell";
import { Bar } from "@/components/Bar";
import { StatTile } from "@/components/StatTile";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { Empty, Spinner } from "@/components/ui/Empty";
import { Select } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { getResultsPost, getStudy, listParticipants, listResponses, runAdminAction } from "@/data/queries";
import { daysBetween, fmtDate, fmtDateTime, pct, typeLabel } from "@/lib/format";
import { answerSummary, scaleMean, segmentOf, SPLITS, tally, textAnswers, type SplitKey } from "@/lib/results";
import { STATUS_LABEL, type Participant, type Response, type ResultsPost, type StudyWithQuestions } from "@/lib/types";
import { audienceLabel } from "./Studies";

export default function StudyResults() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const [study, setStudy] = useState<StudyWithQuestions | null>(null);
  const [responses, setResponses] = useState<Response[]>([]);
  const [panel, setPanel] = useState<Participant[]>([]);
  const [post, setPost] = useState<ResultsPost | null>(null);
  const [split, setSplit] = useState<SplitKey>("none");
  const [qIndex, setQIndex] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([getStudy(id), listResponses(id), listParticipants(), getResultsPost(id)])
      .then(([s, r, p, rp]) => {
        setStudy(s);
        setResponses(r);
        setPanel(p);
        setPost(rp);
      })
      .catch((e: Error) => toast(e.message, "error"));
  }, [id, toast]);

  useEffect(load, [load]);

  const now = new Date().toISOString();
  const eligible = useMemo(() => {
    if (!study) return panel;
    if (study.audience === "teams") return panel.filter((p) => p.team && study.audience_teams.includes(p.team));
    return panel;
  }, [panel, study]);

  const splitRows = useMemo(() => {
    if (!study || split === "none") return [];
    const q = study.questions[qIndex];
    if (!q || q.kind === "text") return [];
    const segs = new Map<string, Response[]>();
    for (const r of responses) for (const s of segmentOf(r.profile, split)) segs.set(s, [...(segs.get(s) ?? []), r]);
    return [...segs.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([label, rs]) => ({ label, n: rs.length, counts: tally(q, rs) }));
  }, [study, split, qIndex, responses]);

  if (!study) return <Spinner />;

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
  const slack = (action: "publish_now" | "close_now" | "remind") => () =>
    act(action, async () => {
      const r = await runAdminAction({ action, study_id: id });
      if (!r.ok) throw new Error(r.message);
      return r.message;
    });

  const answered = responses.length;
  const reach = eligible.length ? pct(answered, eligible.length) : 0;
  const answeredIds = new Set(responses.map((r) => r.participant_id));
  const missing = eligible.filter((p) => !answeredIds.has(p.id));
  const isLive = study.status === "live";
  const days =
    isLive && study.close_at ? Math.max(0, daysBetween(now, study.close_at)) : study.closed_at ? daysBetween(study.closed_at, now) : null;
  const firstQ = study.questions[0];

  return (
    <>
      <PageHeader
        title={study.title_en || "Untitled"}
        back={{ to: "/studies", label: "Studies" }}
        sub={
          <span className="flex items-center gap-2 flex-wrap">
            <Chip tone={study.status}>{STATUS_LABEL[study.status]}</Chip>
            <span>{typeLabel(study.type)}</span>
            <span>·</span>
            <span>{audienceLabel(study)}</span>
            <span>·</span>
            <span className="tabular-nums">
              {fmtDate(study.published_at ?? study.publish_at)} → {fmtDate(study.closed_at ?? study.close_at)}
            </span>
          </span>
        }
        actions={
          <>
            {(study.status === "draft" || study.status === "scheduled") && (
              <>
                <Button onClick={() => nav(`/studies/${id}/edit`)}>Edit</Button>
                <Button variant="primary" icon="send" loading={busy === "publish_now"} onClick={slack("publish_now")}>Publish now</Button>
              </>
            )}
            {isLive && (
              <>
                <Button icon="bell" loading={busy === "remind"} disabled={!missing.length} onClick={slack("remind")}>
                  Remind {missing.length} by DM
                </Button>
                <Button variant="danger" loading={busy === "close_now"} onClick={slack("close_now")}>Close now</Button>
              </>
            )}
            {study.status === "closed" && (
              <Button variant="primary" icon="chart" onClick={() => nav(`/studies/${id}/post`)}>
                {post ? "Finish results post" : "Write results post"}
              </Button>
            )}
            {study.status === "reported" && (
              <Button icon="eye" onClick={() => nav(`/studies/${id}/post`)}>View results post</Button>
            )}
          </>
        }
      />

      <div className="px-7 pb-10 space-y-4">
        <div className="grid grid-cols-4 gap-3">
          <StatTile label="Answers" value={answered} tone="brand" sub={study.target ? `target ${study.target}` : "identified, one per member"} />
          <StatTile label="Reach" value={`${reach}%`} sub={`of ${eligible.length} members with a profile`} />
          <StatTile label="Not yet answered" value={missing.length} tone={missing.length && isLive ? "warn" : "default"} sub={isLive ? "reminder goes by DM" : "at close"} />
          <StatTile
            label={isLive ? "Days left" : study.closed_at ? "Days since close" : "Status"}
            value={days ?? STATUS_LABEL[study.status]}
            sub={isLive ? `closes ${fmtDateTime(study.close_at)}` : study.closed_at ? `closed ${fmtDateTime(study.closed_at)}` : "not posted yet"}
          />
        </div>

        {study.status === "draft" || study.status === "scheduled" ? (
          <Empty
            title={study.status === "draft" ? "This study is still a draft" : `Posts itself on ${fmtDateTime(study.publish_at)}`}
            hint="Answers appear here the moment colleagues tap in Slack. Each answer carries the colleague's profile."
          />
        ) : (
          <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-4 items-start">
            <div className="space-y-4">
              {study.questions.map((q, qi) => {
                const counts = tally(q, responses);
                const total = counts.reduce((n, c) => n + c.count, 0);
                const mean = q.kind === "scale" ? scaleMean(q, responses) : null;
                return (
                  <Card
                    key={q.id}
                    title={
                      <span className="flex items-center gap-2">
                        <span className="h-5 w-5 rounded-full bg-ink text-white text-[11px] grid place-items-center">{qi + 1}</span>
                        {q.text_en}
                      </span>
                    }
                    action={mean != null ? <Chip tone="neutral">mean {mean} / 5</Chip> : undefined}
                  >
                    {q.text_ar && <div className="ar text-[12.5px] text-muted mb-2">{q.text_ar}</div>}
                    {q.kind === "text" ? (
                      <ul className="divide-y divide-line-2">
                        {textAnswers(q, responses).map((t, i) => (
                          <li key={i} className="py-2 text-[13px]">
                            <span className="text-ink">{t.text}</span>
                            <span className="text-muted"> · {t.who}, {fmtDate(t.when)}</span>
                          </li>
                        ))}
                        {textAnswers(q, responses).length === 0 && <li className="py-2 text-[13px] text-muted">No text answers yet.</li>}
                      </ul>
                    ) : (
                      counts.map((c) => <Bar key={c.key} label={c.label} count={c.count} total={q.kind === "multi" ? answered : total} />)
                    )}
                  </Card>
                );
              })}

              <Card
                title="Who answered"
                action={<span className="text-[12px] text-muted">Identified research: you see names, the channel sees totals.</span>}
              >
                {responses.length === 0 ? (
                  <div className="text-[13px] text-muted">Nobody yet.</div>
                ) : (
                  <div className="-mx-4 -mb-4">
                    <div className="grid grid-cols-[minmax(0,1.2fr)_90px_70px_80px_minmax(0,1fr)_minmax(0,1.4fr)_110px] gap-2 px-4 h-8 items-center text-[11px] font-semibold uppercase tracking-[0.04em] text-muted bg-fill border-y border-line-2">
                      <div>Name</div><div>Age</div><div>Gender</div><div>Device</div><div>Team</div><div>{firstQ ? "Answer" : ""}</div><div>When</div>
                    </div>
                    {responses.map((r) => (
                      <div key={r.id} className="grid grid-cols-[minmax(0,1.2fr)_90px_70px_80px_minmax(0,1fr)_minmax(0,1.4fr)_110px] gap-2 px-4 py-2 items-center text-[12.5px] border-b border-line-2 last:border-b-0">
                        <div className="text-ink truncate">
                          {r.profile.name}
                          {r.participant?.deleted_at && <span className="text-muted"> · forgotten</span>}
                        </div>
                        <div className="text-ink-2">{r.profile.age_band}</div>
                        <div className="text-ink-2 capitalize">{r.profile.gender}</div>
                        <div className="text-ink-2">{r.profile.device === "iphone" ? "iPhone" : "Android"}</div>
                        <div className="text-ink-2 truncate">{r.profile.team ?? "—"}</div>
                        <div className="text-ink truncate">{answerSummary(firstQ, r)}</div>
                        <div className="text-muted tabular-nums">{fmtDateTime(r.submitted_at)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>

            <div className="space-y-4">
              <Card
                title="Split by profile"
                action={
                  <>
                    {study.questions.length > 1 && (
                      <Select className="w-36 h-7 text-[12px]" value={qIndex} onChange={(e) => setQIndex(Number(e.target.value))}>
                        {study.questions.map((q, i) => (
                          <option key={q.id} value={i}>Question {i + 1}</option>
                        ))}
                      </Select>
                    )}
                    <Select className="w-32 h-7 text-[12px]" value={split} onChange={(e) => setSplit(e.target.value as SplitKey)}>
                      {SPLITS.map((s) => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                      ))}
                    </Select>
                  </>
                }
              >
                {split === "none" ? (
                  <div className="text-[13px] text-muted">Pick age, gender, device, team or app to see how each group answered.</div>
                ) : splitRows.length === 0 ? (
                  <div className="text-[13px] text-muted">No answers to split, or the question is free text.</div>
                ) : (
                  <div className="space-y-3">
                    {splitRows.map((row) => (
                      <div key={row.label}>
                        <div className="flex items-baseline justify-between text-[12.5px]">
                          <span className="font-semibold text-ink">{row.label}</span>
                          <span className="text-muted">{row.n} answered</span>
                        </div>
                        <div className="flex h-2.5 rounded-full overflow-hidden bg-line-2 mt-1">
                          {row.counts.map((c, i) => (
                            <div
                              key={c.key}
                              title={`${c.label}: ${c.count}`}
                              className={clsx(i % 4 === 0 && "bg-brand", i % 4 === 1 && "bg-one", i % 4 === 2 && "bg-brand-ink", i % 4 === 3 && "bg-slate-chip")}
                              style={{ width: `${row.n ? (100 * c.count) / row.n : 0}%` }}
                            />
                          ))}
                        </div>
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-[11.5px] text-muted">
                          {row.counts.map((c) => (
                            <span key={c.key}>{c.label} {c.count}</span>
                          ))}
                        </div>
                      </div>
                    ))}
                    <p className="text-[11.5px] text-muted">In the channel, any group under the small-group threshold is written as "under N".</p>
                  </div>
                )}
              </Card>

              <Card title="Not yet answered">
                {missing.length === 0 ? (
                  <div className="text-[13px] text-brand-text">Everyone with a profile has answered.</div>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-1.5">
                      {missing.slice(0, 30).map((p) => (
                        <Chip key={p.id} tone="neutral">{p.name}</Chip>
                      ))}
                      {missing.length > 30 && <Chip tone="neutral">+{missing.length - 30} more</Chip>}
                    </div>
                    {isLive && <p className="text-[11.5px] text-muted mt-2">The reminder DM links to the post. One reminder per study, sent by you.</p>}
                  </>
                )}
              </Card>

              {post?.posted_at && (
                <Card title="Results post">
                  <div className="text-[13px] text-ink whitespace-pre-wrap">{post.body_en}</div>
                  <div className="text-[11.5px] text-muted mt-2">Posted {fmtDateTime(post.posted_at)}</div>
                </Card>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
