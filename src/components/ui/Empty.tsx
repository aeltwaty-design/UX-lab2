import type { ReactNode } from "react";

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-6">
      <div className="text-[14px] font-semibold text-ink">{title}</div>
      {hint && <div className="text-[13px] text-muted mt-1 max-w-sm">{hint}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-[13px] text-muted py-10 justify-center">
      <span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-muted border-t-transparent animate-spin" />
      {label}
    </div>
  );
}
