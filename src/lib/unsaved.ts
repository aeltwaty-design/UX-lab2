// Unsaved editor changes kept in this browser, so a reload, a tab the browser discarded or a click elsewhere in the
// app does not lose them. A per-viewer convenience: storage can be missing or blocked, so every call is guarded.

export interface Backup<T> {
  /** When the backup was last written, in milliseconds. */
  at: number;
  data: T;
}

/** JSON with object keys sorted, so two equal values always compare equal as strings. */
export function stable(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

export function readBackup<T>(key: string): Backup<T> | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const b = JSON.parse(raw) as Backup<T>;
    return b && typeof b.at === "number" && b.data ? b : null;
  } catch {
    return null;
  }
}

export function writeBackup<T>(key: string, data: T) {
  try {
    window.localStorage.setItem(key, JSON.stringify({ at: Date.now(), data }));
  } catch {
    /* storage full or blocked: the editor still works, only without the safety net */
  }
}

export function clearBackup(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* nothing to clear */
  }
}
