import { clsx } from "clsx";
import type { ReactNode } from "react";

export type Tone = "draft" | "scheduled" | "live" | "closed" | "reported" | "warn" | "v2" | "neutral" | "one";

const TONE: Record<Tone, string> = {
  draft: "bg-fill text-ink-2 border-line",
  scheduled: "bg-one-light text-one-text border-one-light",
  live: "bg-brand-light text-brand-text border-brand-light",
  closed: "bg-[#e9ebf2] text-slate-chip border-[#e9ebf2]",
  reported: "bg-[#111317] text-white border-[#111317]",
  warn: "bg-warn-light text-warn-text border-warn-light",
  v2: "bg-white text-muted border-line border-dashed",
  neutral: "bg-white text-ink-2 border-line",
  one: "bg-one-light text-one-text border-one-light",
};

export function Chip({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 h-[22px] px-2 rounded-full border text-[11.5px] font-medium whitespace-nowrap",
        TONE[tone],
        className,
      )}
    >
      {tone === "live" && <span className="h-1.5 w-1.5 rounded-full bg-brand" />}
      {children}
    </span>
  );
}
