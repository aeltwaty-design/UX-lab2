import { clsx } from "clsx";
import type { ReactNode } from "react";

export function StatTile({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "default" | "brand" | "one" | "warn";
}) {
  return (
    <div className="bg-white border border-line rounded-md shadow-card px-4 py-3.5 min-w-0">
      <div className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-muted">{label}</div>
      <div
        className={clsx(
          "text-[26px] leading-tight font-semibold mt-1 tabular-nums",
          tone === "brand" && "text-brand-text",
          tone === "one" && "text-one-text",
          tone === "warn" && "text-warn-text",
          tone === "default" && "text-ink",
        )}
      >
        {value}
      </div>
      {sub && <div className="text-[12px] text-muted mt-0.5">{sub}</div>}
    </div>
  );
}
