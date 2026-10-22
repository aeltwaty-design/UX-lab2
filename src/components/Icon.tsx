import type { SVGProps } from "react";

export type IconName =
  | "studies"
  | "users"
  | "inbox"
  | "settings"
  | "plus"
  | "search"
  | "check"
  | "x"
  | "back"
  | "send"
  | "bell"
  | "clock"
  | "chart"
  | "logout"
  | "slack"
  | "warn"
  | "eye"
  | "trash"
  | "copy"
  | "external";

const PATHS: Record<IconName, string> = {
  studies: "M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2M9 12h6M9 16h4",
  users: "M17 20h5v-2a3 3 0 0 0-5.4-1.8M17 20H7m10 0v-2c0-.7-.1-1.3-.4-1.8M7 20H2v-2a3 3 0 0 1 5.4-1.8M7 20v-2c0-.7.1-1.3.4-1.8m0 0a5 5 0 0 1 9.2 0M15 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM7 10a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z",
  inbox: "M20 13V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7m16 0v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-5m16 0h-3.3a1 1 0 0 0-.9.6l-.6 1.3a1 1 0 0 1-.9.6h-4.6a1 1 0 0 1-.9-.6l-.6-1.3a1 1 0 0 0-.9-.6H4",
  settings: "M10.3 4.3c.4-1.8 3-1.8 3.4 0a1.7 1.7 0 0 0 2.6 1.1c1.6-1 3.4.8 2.4 2.4a1.7 1.7 0 0 0 1 2.6c1.8.4 1.8 3 0 3.4a1.7 1.7 0 0 0-1 2.6c1 1.6-.8 3.4-2.4 2.4a1.7 1.7 0 0 0-2.6 1c-.4 1.8-3 1.8-3.4 0a1.7 1.7 0 0 0-2.6-1c-1.6 1-3.4-.8-2.4-2.4a1.7 1.7 0 0 0-1-2.6c-1.8-.4-1.8-3 0-3.4a1.7 1.7 0 0 0 1-2.6c-1-1.6.8-3.4 2.4-2.4a1.7 1.7 0 0 0 2.6-1ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  plus: "M12 5v14M5 12h14",
  search: "M21 21l-4.3-4.3M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z",
  check: "M5 13l4 4L19 7",
  x: "M6 18L18 6M6 6l12 12",
  back: "M10 19l-7-7m0 0 7-7m-7 7h18",
  send: "M12 19l9 2-9-18-9 18 9-2Zm0 0v-8",
  bell: "M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 0 0-4-5.7V5a2 2 0 1 0-4 0v.3A6 6 0 0 0 6 11v3.2c0 .5-.2 1-.6 1.4L4 17h5m6 0v1a3 3 0 1 1-6 0v-1m6 0H9",
  clock: "M12 8v4l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  chart: "M9 19v-6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2Zm0 0V9a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v10m-6 0a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2m0 0V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2Z",
  logout: "M17 16l4-4m0 0-4-4m4 4H7m6 4v1a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3h4a3 3 0 0 1 3 3v1",
  slack: "M10 4v6M14 14v6M4 14h6M14 10h6M8.5 4a1.5 1.5 0 1 1 1.5 1.5H8.5V4Zm7 16a1.5 1.5 0 1 1-1.5-1.5h1.5V20ZM4 8.5A1.5 1.5 0 1 1 5.5 10H4V8.5ZM20 15.5a1.5 1.5 0 1 1-1.5-1.5H20v1.5Z",
  warn: "M12 9v2m0 4h.01M5.1 19h13.8c1.5 0 2.5-1.7 1.7-3L13.7 4a2 2 0 0 0-3.4 0L3.4 16c-.8 1.3.2 3 1.7 3Z",
  eye: "M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm7 0s-4 7-10 7S2 12 2 12s4-7 10-7 10 7 10 7Z",
  trash: "M19 7l-.9 12.1A2 2 0 0 1 16.1 21H7.9a2 2 0 0 1-2-1.9L5 7m5 4v6m4-6v6m1-10V4a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v3M4 7h16",
  copy: "M8 16H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2m-6 12h8a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2Z",
  external: "M10 6H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4M14 4h6m0 0v6m0-6L10 14",
};

interface Props extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: IconName;
  size?: number;
}

/** Inline stroke icons. No icon package: lucide-react is banned in WalaPlus repos. */
export function Icon({ name, size = 16, ...rest }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
