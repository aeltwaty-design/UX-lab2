import type { Question, StudyType } from "./types";

export type { Question };

/** A session slot as the builder holds it (same shape as the row, id may be temporary). */
export interface SlotDraft {
  id: string;
  starts_at: string;
  minutes: number;
  place: string;
  capacity: number;
}

/** The subset of a study the Slack preview needs. Works for drafts and saved rows. */
export interface StudyDraftLike {
  type: StudyType;
  title_en: string;
  title_ar: string;
  intro_en: string;
  intro_ar: string;
  close_at: string | null;
}
