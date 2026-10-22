import type { Question, StudyType } from "./types";

export type { Question };

/** The subset of a study the Slack preview needs. Works for drafts and saved rows. */
export interface StudyDraftLike {
  type: StudyType;
  title_en: string;
  title_ar: string;
  intro_en: string;
  intro_ar: string;
  close_at: string | null;
}
