// Domain types for Research Desk. They mirror supabase/migrations/0001_init.sql.

export type StudyType =
  | "poll"
  | "survey"
  | "preference_test"
  | "session_recruitment"
  | "friction_report";

export type StudyStatus = "draft" | "scheduled" | "live" | "closed" | "reported";

export type Audience = "everyone" | "panel" | "teams";

export type QuestionKind = "single" | "multi" | "scale" | "yesno" | "text";

export type Lang = "en" | "ar";

export interface Option {
  id: string;
  question_id: string;
  position: number;
  label_en: string;
  label_ar: string;
}

export interface Question {
  id: string;
  study_id: string;
  position: number;
  kind: QuestionKind;
  text_en: string;
  text_ar: string;
  required: boolean;
  options: Option[];
}

export interface Study {
  id: string;
  type: StudyType;
  status: StudyStatus;
  title_en: string;
  title_ar: string;
  intro_en: string;
  intro_ar: string;
  audience: Audience;
  audience_teams: string[];
  target: number | null;
  publish_at: string | null;
  close_at: string | null;
  published_at: string | null;
  closed_at: string | null;
  slack_channel_id: string | null;
  slack_ts: string | null;
  reminder_sent_at: string | null;
  created_at: string;
  updated_at: string;
  /** From the study_stats view. */
  response_count: number;
}

export interface StudyWithQuestions extends Study {
  questions: Question[];
}

export type AgeBand = "18-24" | "25-34" | "35-44" | "45+";
export type Gender = "female" | "male";
export type Device = "iphone" | "android";

export interface Participant {
  id: string;
  slack_user_id: string;
  name: string;
  age_band: AgeBand;
  gender: Gender;
  device: Device;
  team: string | null;
  apps: string[];
  language: Lang;
  profile_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export type ProfileSnapshot = Pick<
  Participant,
  "name" | "age_band" | "gender" | "device" | "team" | "apps" | "language"
>;

export interface Answer {
  id: string;
  response_id: string;
  question_id: string;
  option_id: string | null;
  value_text: string | null;
  value_num: number | null;
}

export interface Response {
  id: string;
  study_id: string;
  participant_id: string;
  submitted_at: string;
  profile: ProfileSnapshot;
  answers: Answer[];
  participant: Pick<Participant, "slack_user_id" | "name" | "deleted_at"> | null;
}

export interface ResultsPost {
  id: string;
  study_id: string;
  body_en: string;
  body_ar: string;
  include_totals: boolean;
  posted_at: string | null;
  slack_ts: string | null;
  created_at: string;
}

export interface ChannelMember {
  slack_user_id: string;
  name: string;
  is_active: boolean;
  joined_at: string;
  left_at: string | null;
}

export interface Settings {
  channel_id: string;
  channel_name: string;
  hours_cap: number;
  small_group: number;
  default_lang: Lang;
  teams: string[];
  workspace_url: string;
}

export const DEFAULT_SETTINGS: Settings = {
  channel_id: "",
  channel_name: "#ux-research",
  hours_cap: 6,
  small_group: 8,
  default_lang: "en",
  teams: [
    "Product",
    "Engineering",
    "Design",
    "Marketing",
    "Sales",
    "Customer support",
    "Finance",
    "People",
    "Operations",
  ],
  workspace_url: "",
};

export const STUDY_TYPES: { value: StudyType; label: string; hint: string; v2?: boolean }[] = [
  { value: "poll", label: "Poll", hint: "One question, buttons in Slack. Answered in two taps." },
  { value: "survey", label: "Survey", hint: "Up to eight questions in a Slack form. Ten minutes at most." },
  { value: "preference_test", label: "Preference test", hint: "Two or more images, pick one. Version two.", v2: true },
  { value: "session_recruitment", label: "Session recruitment", hint: "Book thirty-minute sessions. Version two.", v2: true },
  { value: "friction_report", label: "Friction report", hint: "Colleagues report a broken step. Version two.", v2: true },
];

export const STATUS_LABEL: Record<StudyStatus, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  live: "Live",
  closed: "Closed",
  reported: "Reported",
};

export const QUESTION_KINDS: { value: QuestionKind; label: string }[] = [
  { value: "single", label: "Pick one" },
  { value: "multi", label: "Pick many" },
  { value: "scale", label: "Scale 1 to 5" },
  { value: "yesno", label: "Yes or no" },
  { value: "text", label: "Short text" },
];

export const AGE_BANDS: AgeBand[] = ["18-24", "25-34", "35-44", "45+"];
export const GENDERS: { value: Gender; label: string }[] = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
];
export const DEVICES: { value: Device; label: string }[] = [
  { value: "iphone", label: "iPhone" },
  { value: "android", label: "Android" },
];
export const APPS = [
  { value: "walaplus", label: "WalaPlus" },
  { value: "walaone", label: "WalaOne" },
];
