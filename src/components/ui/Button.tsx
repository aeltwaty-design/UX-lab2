import { clsx } from "clsx";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon, type IconName } from "../Icon";

type Variant = "primary" | "default" | "ghost" | "danger";
type Size = "sm" | "md";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: IconName;
  loading?: boolean;
  children?: ReactNode;
}

const VARIANT: Record<Variant, string> = {
  primary: "bg-brand text-brand-ink border-brand hover:bg-brand-mid",
  default: "bg-white text-ink border-line hover:bg-fill",
  ghost: "bg-transparent text-ink-2 border-transparent hover:bg-fill",
  danger: "bg-white text-danger border-danger/40 hover:bg-danger-light",
};

const SIZE: Record<Size, string> = {
  sm: "h-7 px-2.5 text-[12px] gap-1.5",
  md: "h-9 px-3.5 text-[13px] gap-2",
};

export function Button({
  variant = "default",
  size = "md",
  icon,
  loading,
  className,
  children,
  disabled,
  ...rest
}: Props) {
  return (
    <button
      type="button"
      className={clsx(
        "inline-flex items-center justify-center rounded-sm border font-medium whitespace-nowrap transition-colors",
        "disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer",
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? (
        <span className="inline-block h-3 w-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
      ) : (
        icon && <Icon name={icon} size={size === "sm" ? 13 : 15} />
      )}
      {children}
    </button>
  );
}
