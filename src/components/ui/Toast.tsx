import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { clsx } from "clsx";

interface ToastState {
  text: string;
  tone: "ok" | "error";
}

const Ctx = createContext<(text: string, tone?: "ok" | "error") => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const flash = useCallback((text: string, tone: "ok" | "error" = "ok") => {
    setToast({ text, tone });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), tone === "error" ? 6000 : 2800);
  }, []);
  return (
    <Ctx.Provider value={flash}>
      {children}
      {toast && (
        <div
          role="status"
          className={clsx(
            "fixed bottom-5 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-sm text-[13px] text-white shadow-toast",
            toast.tone === "error" ? "bg-danger" : "bg-ink",
          )}
        >
          {toast.text}
        </div>
      )}
    </Ctx.Provider>
  );
}

export function useToast() {
  return useContext(Ctx);
}
