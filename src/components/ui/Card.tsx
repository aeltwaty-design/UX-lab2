import { clsx } from "clsx";
import type { HTMLAttributes, ReactNode } from "react";

interface Props extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title?: ReactNode;
  action?: ReactNode;
  pad?: boolean;
  children?: ReactNode;
}

export function Card({ title, action, pad = true, className, children, ...rest }: Props) {
  return (
    <div className={clsx("bg-white border border-line rounded-md shadow-card", className)} {...rest}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-line-2">
          <div className="text-[13px] font-semibold text-ink">{title}</div>
          {action && <div className="flex items-center gap-2">{action}</div>}
        </div>
      )}
      <div className={pad ? "p-4" : undefined}>{children}</div>
    </div>
  );
}
