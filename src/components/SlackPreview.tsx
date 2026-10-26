import { clsx } from "clsx";
import type { Question, SlotDraft, StudyDraftLike } from "@/lib/preview";
import { fmtDate, fmtSlot } from "@/lib/format";

/** A faithful-enough rendering of the Block Kit message the bot will post. */
export function SlackPreview({
  study,
  questions,
  slots = [],
  channel,
  closed,
}: {
  study: StudyDraftLike;
  questions: Question[];
  slots?: SlotDraft[];
  channel: string;
  closed?: boolean;
}) {
  const q = questions[0];
  const sessions = study.type === "session_recruitment";
  const images = study.type === "preference_test" && q ? q.options.filter((o) => o.image_url).slice(0, 6) : [];
  const orderedSlots = [...slots].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  return (
    <div className="bg-white border border-line rounded-md overflow-hidden">
      <div className="px-3 py-2 border-b border-line-2 text-[11.5px] text-muted flex items-center gap-2">
        <span className="font-semibold text-ink-2">{channel || "#ux-research"}</span>
        <span>· posted by the bot</span>
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

          {study.type === "preference_test" && q && (
            <div className="mt-2.5">
              <div className="text-[13px] text-ink font-semibold">{q.text_en || "Which one do you prefer?"}</div>
              {q.text_ar && <div className="ar text-[13px] text-ink">{q.text_ar}</div>}
              <div className="space-y-2 mt-2">
                {images.map((o, i) => (
                  <div key={o.id}>
                    <div className="text-[12px] font-semibold text-ink-2 mb-1">{o.label_en || `Option ${i + 1}`}{o.label_ar ? ` · ${o.label_ar}` : ""}</div>
                    <img src={o.image_url ?? ""} alt={o.label_en} className="max-h-40 rounded-sm border border-line-2 object-contain bg-fill" />
                  </div>
                ))}
                {images.length === 0 && <div className="text-[12px] text-muted">Upload two to six images to see them here.</div>}
              </div>
              {images.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {images.map((o, i) => (
                    <span key={o.id} className={clsx("h-7 px-2.5 inline-flex items-center rounded-sm border text-[12.5px] font-medium", closed ? "border-line text-muted bg-fill" : "border-line text-ink bg-white")}>
                      {o.label_en || `Option ${i + 1}`}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {sessions && (
            <div className="mt-2.5">
              <div className="text-[13px] text-ink space-y-0.5">
                {orderedSlots.map((s) => (
                  <div key={s.id} className="tabular-nums">
                    {fmtSlot(s.starts_at, s.minutes)}
                    {s.place ? ` · ${s.place}` : ""} · {s.capacity} of {s.capacity} free
                  </div>
                ))}
                {orderedSlots.length === 0 && <div className="text-muted text-[12px]">Add slots to see them here.</div>}
              </div>
              {!closed && orderedSlots.length > 0 && (
                <div className="mt-2 flex items-center justify-between gap-3">
                  <div className="text-[13px] text-ink">
                    <span className="font-semibold">Pick a time · اختر وقتاً</span>
                    <div className="text-[12px] text-ink-2">One slot each. You get a DM with the details and a cancel button.</div>
                  </div>
                  <span className="h-7 px-2.5 inline-flex items-center gap-2 rounded-sm border border-line text-[12.5px] text-ink-2 bg-white shrink-0">
                    Choose a slot <span className="text-muted">▾</span>
                  </span>
                </div>
              )}
            </div>
          )}

          {study.type === "survey" && (
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
              ? `Closed. Thanks to everyone who ${sessions ? "booked" : "answered"}.`
              : `Closes ${fmtDate(study.close_at)} · ${sessions ? "bookings" : "answers"} are linked to your profile${!sessions && study.allow_changes === false ? " · answers are final" : ""} · results back in this channel`}
          </div>
        </div>
      </div>
    </div>
  );
}
