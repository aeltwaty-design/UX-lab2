import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { Label, Textarea, Toggle } from "@/components/ui/Field";
import { Spinner } from "@/components/ui/Empty";
import { useToast } from "@/components/ui/Toast";
import { getResultsPost, getSettings, getStudy, listResponses, runAdminAction, saveResultsPost } from "@/data/queries";
import { fmtDateTime, pct, smallGroup } from "@/lib/format";
import { scaleMean, tally } from "@/lib/results";
import { DEFAULT_SETTINGS, STATUS_LABEL, type Response, type ResultsPost as ResultsPostT, type Settings, type StudyWithQuestions } from "@/lib/types";

/** The totals block exactly as the bot writes it: small groups become "under N". */
export function totalsLines(study: StudyWithQuestions, responses: Response[], threshold: number): string[] {
  const lines: string[] = [];
  for (const q of study.questions) {
    if (q.kind === "text") continue;
    lines.push(`*${q.text_en}*`);
    const counts = tally(q, responses);
    const total = q.kind === "multi" ? responses.length : counts.reduce((n, c) => n + c.count, 0);
    for (const c of counts) {
      const shown = smallGroup(c.count, threshold);
      const p = c.count < threshold ? "" : ` (${pct(c.count, total)}%)`;
      const bar = "▇".repeat(Math.round((10 * c.count) / Math.max(1, total)));
      lines.push(`${bar || "·"} ${c.label}: ${shown}${p}`);
    }
    if (q.kind === "scale") {
      const m = scaleMean(q, responses);
      if (m != null) lines.push(`Average ${m} out of 5`);
    }
    lines.push("");
  }
  return lines;
}

export default function ResultsPost() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const [study, setStudy] = useState<StudyWithQuestions | null>(null);
  const [responses, setResponses] = useState<Response[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [post, setPost] = useState<Pick<ResultsPostT, "body_en" | "body_ar" | "include_totals"> & Partial<ResultsPostT>>({
    body_en: "",
    body_ar: "",
    include_totals: true,
  });
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getStudy(id), listResponses(id), getSettings(), getResultsPost(id)])
      .then(([s, r, st, p]) => {
        setStudy(s);
        setResponses(r);
        setSettings(st);
        if (p) setPost(p);
        else
          setPost({
            body_en: `Thanks to the ${r.length} of you who answered "${s.title_en}". Here is what you told us and what changes next.\n\nWhat we change: `,
            body_ar: s.title_ar ? `شكراً لـ ${r.length} زميلاً أجابوا على "${s.title_ar}". هذا ما قلتموه وما سيتغير.\n\nما سنغيّره: ` : "",
            include_totals: true,
          });
      })
      .catch((e: Error) => toast(e.message, "error"));
  }, [id, toast]);

  const totals = useMemo(() => (study ? totalsLines(study, responses, settings.small_group) : []), [study, responses, settings.small_group]);

  if (!study) return <Spinner />;
  const posted = Boolean(post.posted_at);

  async function act(label: string, fn: () => Promise<string>) {
    setBusy(label);
    try {
      toast(await fn());
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  const save = () =>
    act("save", async () => {
      const saved = await saveResultsPost({ study_id: id, body_en: post.body_en, body_ar: post.body_ar, include_totals: post.include_totals });
      setPost(saved);
      return "Draft saved.";
    });

  const publish = () =>
    act("post", async () => {
      if (!post.body_en.trim()) throw new Error("Write the English body first.");
      await saveResultsPost({ study_id: id, body_en: post.body_en, body_ar: post.body_ar, include_totals: post.include_totals });
      const r = await runAdminAction({ action: "post_results", study_id: id });
      if (!r.ok) throw new Error(r.message);
      nav(`/studies/${id}`);
      return r.message;
    });

  return (
    <>
      <PageHeader
        title={`Results post: ${study.title_en}`}
        back={{ to: `/studies/${id}`, label: "Back to results" }}
        sub={
          <span className="flex items-center gap-2">
            <Chip tone={study.status}>{STATUS_LABEL[study.status]}</Chip>
            {posted ? `Posted to ${settings.channel_name} on ${fmtDateTime(post.posted_at)}.` : "A study is not reported until this post is in the channel."}
          </span>
        }
        actions={
          !posted && (
            <>
              <Button loading={busy === "save"} onClick={save}>Save draft</Button>
              <Button variant="primary" icon="send" loading={busy === "post"} disabled={study.status !== "closed"} onClick={publish}>
                Post to channel
              </Button>
            </>
          )
        }
      />
      <div className="px-7 pb-10 grid grid-cols-[minmax(0,1fr)_420px] gap-4 items-start">
        <div className="space-y-4">
          <Card title="What the channel reads">
            <div className="space-y-3">
              <div>
                <Label hint="what you heard, what changes, by when">English</Label>
                <Textarea className="min-h-40" value={post.body_en} disabled={posted} onChange={(e) => setPost({ ...post, body_en: e.target.value })} />
              </div>
              <div>
                <Label>Arabic</Label>
                <Textarea className="ar min-h-40" value={post.body_ar} disabled={posted} onChange={(e) => setPost({ ...post, body_ar: e.target.value })} />
              </div>
              <Toggle
                checked={post.include_totals}
                onChange={(v) => !posted && setPost({ ...post, include_totals: v })}
                label="Append the totals"
                hint={`Counts per option. Groups under ${settings.small_group} are written as "under ${settings.small_group}". Names never appear.`}
              />
            </div>
          </Card>
        </div>
        <div className="sticky top-6">
          <Label>Slack preview</Label>
          <div className="bg-white border border-line rounded-md p-3 flex gap-2.5">
            <span className="h-8 w-8 rounded-sm bg-brand text-brand-ink grid place-items-center text-[11px] font-bold shrink-0">RD</span>
            <div className="min-w-0 flex-1 text-[13px]">
              <div><span className="font-semibold text-ink">Research Desk</span> <span className="text-[11px] text-muted">APP</span></div>
              <div className="font-semibold text-ink mt-1">Results: {study.title_en}</div>
              <div className="text-ink-2 whitespace-pre-wrap mt-1">{post.body_en || "…"}</div>
              {post.body_ar && <div className="ar text-ink-2 whitespace-pre-wrap mt-1">{post.body_ar}</div>}
              {post.include_totals && (
                <pre className="font-sans text-[12.5px] text-ink-2 whitespace-pre-wrap mt-2 border-l-2 border-line pl-2">{totals.join("\n")}</pre>
              )}
              <div className="text-[11.5px] text-muted mt-2">{responses.length} answered · thank you</div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
