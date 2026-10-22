import { clsx } from "clsx";
import type { Question, StudyDraftLike } from "@/lib/preview";
import { fmtDate } from "@/lib/format";

/** A faithful-enough rendering of the Block Kit message the bot will post. */
export function SlackPreview({
  study,
  questions,
  channel,
  closed,
}: {
  study: StudyDraftLike;
  questions: Question[];
  channel: string;
  closed?: boolean;
}) {
  const q = questions[0];
  return (
    <div className="bg-white border border-line rounded-md overflow-hidden">
      <div className="px-3 py-2 border-b border-line-2 text-[11.5px] text-muted flex items-center gap-2">
        <span className="font-semibold text-ink-2">{channel || "#ux-research"}</span>
        <span>· posted by Research Desk</span>
      </div>
      <div className="p-3 flex gap-2.5">
        <span className="h-8 w-8 rounded-sm bg-brand text-brand-ink grid place-items-center text-[11px] font-bold shrink-0">RD</span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px]">
            <span className="font-semibold text-ink">Research Desk</span>{" "}
            <span className="text-[11px] text-muted">APP · now</span>
          </div>
          <div className="text-[13.5px] font-semibold text-ink mt-1">{study.title_en || "Untitled study"}</div>
          {study.title_ar && <div className="ar text-[13.5px] font-semibold text-ink">{study.title_ar}</div>}
          {study.intro_en && <div className="text-[13px] text-ink-2 mt-1 whitespace-pre-wrap">{study.intro_en}</div>}
          {study.intro_ar && <div className="ar text-[13px] text-ink-2 whitespace-pre-wrap">{study.intro_ar}</div>}

          {study.type === "poll" && q && (
            <div className="mt-2.5">
              <div className="text-[13px] text-ink">{q.text_en}</div>
              {q.text_ar && <div className="ar text-[13px] text-ink">{q.text_ar}</div>}
              <div className="flex flex-wrap gap-1.5 mt-2">
                {q.options.filter((o) => o.label_en.trim()).map((o) => (
                  <span
                    key={o.id}
                    className={clsx(
                      "h-7 px-2.5 inline-flex items-center rounded-sm border text-[12.5px] font-medium",
                      closed ? "border-line text-muted bg-fill" : "border-line text-ink bg-white",
                    )}
                  >
                    {o.label_en}
                    {o.label_ar ? ` · ${o.label_ar}` : ""}
                  </span>
                ))}
              </div>
            </div>
          )}
          {study.type !== "poll" && (
            <div className="mt-2.5 flex items-center gap-2">
              <span className="h-7 px-3 inline-flex items-center rounded-sm bg-brand text-brand-ink text-[12.5px] font-semibold">
                Answer · أجب
              </span>
              <span className="text-[12px] text-muted">
                {questions.length} question{questions.length === 1 ? "" : "s"} · under 10 minutes
              </span>
            </div>
          )}
          <div className="text-[11.5px] text-muted mt-2.5">
            {closed
              ? "Closed. Thanks to everyone who answered."
              : `Closes ${fmtDate(study.close_at)} · answers are linked to your profile · results back in this channel`}
          </div>
        </div>
      </div>
    </div>
  );
}
