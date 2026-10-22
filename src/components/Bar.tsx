import { clsx } from "clsx";

/** Horizontal distribution bar with label, count and percentage. */
export function Bar({
  label,
  count,
  total,
  tone = "brand",
  countLabel,
}: {
  label: string;
  count: number;
  total: number;
  tone?: "brand" | "one" | "muted";
  countLabel?: string;
}) {
  const p = total ? Math.round((100 * count) / total) : 0;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 items-center py-1">
      <div className="min-w-0">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[13px] text-ink truncate">{label}</span>
        </div>
        <div className="h-2 rounded-full bg-line-2 mt-1 overflow-hidden">
          <div
            className={clsx(
              "h-full rounded-full",
              tone === "brand" && "bg-brand",
              tone === "one" && "bg-one",
              tone === "muted" && "bg-slate-chip/50",
            )}
            style={{ width: `${p}%` }}
          />
        </div>
      </div>
      <div className="text-[12px] text-muted tabular-nums text-right w-20">
        {countLabel ?? count} <span className="text-ink-2">· {p}%</span>
      </div>
    </div>
  );
}
