import { useEffect, type ReactNode } from "react";
import { Button } from "./Button";

interface Props {
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel?: string;
  /** Styles the confirm button as destructive. */
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/** A small modal confirmation. Escape or the backdrop closes it; the confirm button carries the action. */
export function ConfirmDialog({ open, title, children, confirmLabel = "Confirm", danger, busy, onConfirm, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" onClick={() => !busy && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="w-full max-w-[440px] rounded-md bg-white border border-line shadow-xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-dialog-title" className="text-[15px] font-semibold text-ink">
          {title}
        </h2>
        <div className="mt-2 text-[13px] text-ink-2 leading-relaxed space-y-3">{children}</div>
        <div className="mt-5 flex justify-end gap-2">
          <Button autoFocus disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button variant={danger ? "danger" : "primary"} loading={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
