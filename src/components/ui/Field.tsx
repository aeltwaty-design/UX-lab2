import { clsx } from "clsx";
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

const BASE =
  "w-full bg-white border border-line rounded-sm text-[13px] text-ink placeholder:text-muted/70 " +
  "focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/25 disabled:bg-fill disabled:text-muted";

export function Label({ children, hint, className }: { children: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <div className={clsx("flex items-baseline justify-between mb-1", className)}>
      <span className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-muted">{children}</span>
      {hint && <span className="text-[11.5px] text-muted">{hint}</span>}
    </div>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={clsx(BASE, "h-9 px-3", className)} {...rest} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={clsx(BASE, "px-3 py-2 min-h-20 resize-y", className)} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={clsx(BASE, "h-9 px-2.5 pr-8 appearance-none bg-no-repeat bg-[right_10px_center]", className)}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23626c83' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\")",
      }}
      {...rest}
    >
      {children}
    </select>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer select-none">
      <span
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={clsx(
          "mt-0.5 relative inline-block h-5 w-9 rounded-full transition-colors shrink-0",
          checked ? "bg-brand" : "bg-line",
        )}
      >
        <span
          className={clsx(
            "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-[18px]" : "translate-x-0.5",
          )}
        />
      </span>
      <span>
        <span className="block text-[13px] text-ink">{label}</span>
        {hint && <span className="block text-[12px] text-muted">{hint}</span>}
      </span>
    </label>
  );
}
