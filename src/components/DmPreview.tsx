import { clsx } from "clsx";
import type { ReactNode } from "react";
import { fillReminder, HEADER_MAX, PROFILE_BUTTON, PROFILE_FOOTER, TEXT_MAX, type ReminderTexts } from "@/lib/reminders";
import type { Lang } from "@/lib/types";

// Previews of the bot's DMs as a member sees them in Slack. The texts are filled by the same functions the bot uses.

// Slack mrkdwn: <url|label> links, bare links, then *bold*, _italic_, ~strike~ and `code` between word boundaries.
const INLINE =
  /<((?:https?:\/\/|mailto:)[^|>\s]+)(?:\|([^>]+))?>|(https?:\/\/[^\s<>]+)|(?<![\p{L}\p{N}_])([*_~`])(?=\S)([^\n]*?\S)\4(?![\p{L}\p{N}_])/gu;

function link(key: number, text: string) {
  return (
    <span key={key} className="text-[#1264a3]">
      {text}
    </span>
  );
}

function inline(line: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of line.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(line.slice(last, at));
    if (m[1]) out.push(link(k++, m[2] ?? m[1]));
    else if (m[3]) {
      // Slack leaves sentence punctuation after a bare link outside it.
      const trail = /[.,;:!?)]+$/.exec(m[3])?.[0] ?? "";
      out.push(link(k++, m[3].slice(0, m[3].length - trail.length)));
      if (trail) out.push(trail);
    } else {
      const body = inline(m[5]);
      if (m[4] === "*") out.push(<strong key={k++} className="font-bold text-ink">{body}</strong>);
      else if (m[4] === "_") out.push(<em key={k++}>{body}</em>);
      else if (m[4] === "~") out.push(<s key={k++}>{body}</s>);
      else out.push(<code key={k++} className="px-1 rounded-[3px] border border-line bg-fill text-[12px] text-danger">{m[5]}</code>);
    }
    last = at + m[0].length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

/** A mrkdwn text, one block per line so that each line takes its own direction: Arabic lines right to left. */
export function Mrkdwn({ text, className }: { text: string; className?: string }) {
  return (
    <div className={clsx("text-[13px] leading-[1.45] text-ink-2 break-words", className)}>
      {text.split("\n").map((line, i) => (
        <div key={i} dir="auto" className="min-h-[1.45em] whitespace-pre-wrap">
          {inline(line)}
        </div>
      ))}
    </div>
  );
}

/** The bot's DM window: who it goes to in the bar, then the message under the bot's name. */
export function DmFrame({ to, children }: { to: ReactNode; children: ReactNode }) {
  return (
    <div className="bg-white border border-line rounded-md overflow-hidden">
      <div className="px-3 py-2 border-b border-line-2 text-[11.5px] text-muted flex items-center gap-1.5">
        <span className="font-semibold text-ink-2">Direct message</span>
        <span className="truncate">· {to}</span>
      </div>
      <div className="p-3 flex gap-2.5">
        <span className="h-8 w-8 rounded-sm bg-brand text-brand-ink grid place-items-center text-[11px] font-bold shrink-0">RD</span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px]">
            <span className="font-semibold text-ink">Research Desk</span> <span className="text-[11px] text-muted">APP · now</span>
          </div>
          <div className="mt-0.5">{children}</div>
        </div>
      </div>
    </div>
  );
}

/** The phone notification and sidebar line of a DM. */
export function NotificationPreview({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-line bg-fill px-3 py-2 flex gap-2.5 items-start">
      <span className="h-6 w-6 rounded-[6px] bg-brand text-brand-ink grid place-items-center text-[9px] font-bold shrink-0">RD</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2 text-[11.5px]">
          <span className="font-semibold text-ink">Research Desk</span>
          <span className="text-muted">now</span>
        </div>
        <div dir="auto" className="text-[12px] text-ink-2 line-clamp-2 break-words">
          {text || <span className="text-muted">Nothing to show</span>}
        </div>
      </div>
    </div>
  );
}

/** The Block Kit DM to a member without a profile, as profileReminderBlocks builds it. */
export function ProfileReminderDm({ t, channel }: { t: ReminderTexts["profile"]; channel: string }) {
  const values = { channel };
  const header = fillReminder(t.header, values).replace(/\s+/g, " ").slice(0, HEADER_MAX);
  const bodies = [t.body_ar, t.body_en].map((b) => fillReminder(b, values).slice(0, TEXT_MAX)).filter(Boolean);
  return (
    <DmFrame to="each member without a profile">
      {header && (
        <div dir="auto" className="text-[15px] font-bold text-ink leading-snug mt-1">
          {header}
        </div>
      )}
      {bodies.map((b, i) => (
        <Mrkdwn key={i} text={b} className="mt-2" />
      ))}
      <div className="mt-2.5">
        <span className="h-7 px-3 inline-flex items-center rounded-sm bg-brand text-brand-ink text-[12.5px] font-semibold">{PROFILE_BUTTON}</span>
      </div>
      <Mrkdwn text={PROFILE_FOOTER} className="mt-2.5 text-[11.5px] text-muted" />
    </DmFrame>
  );
}

/**
 * A reminder sent in one language per member: the Arabic version to members whose profile language is Arabic, the English
 * one to everyone else. `values` gives the placeholders for each language; `label` says who gets each version.
 */
export function TwoLanguageDms({
  tpl,
  values,
  label,
  columns = false,
}: {
  tpl: { ar: string; en: string };
  values: (lang: Lang) => Record<string, string>;
  label: (lang: Lang) => ReactNode;
  /** Side by side instead of one under the other. */
  columns?: boolean;
}) {
  return (
    <div className={clsx(columns ? "grid grid-cols-2 gap-3 items-start" : "space-y-2.5")}>
      {(["ar", "en"] as const).map((lang) => {
        const text = fillReminder(tpl[lang], values(lang)).slice(0, TEXT_MAX);
        return (
          <DmFrame key={lang} to={label(lang)}>
            {text ? <Mrkdwn text={text} /> : <div className="text-[12px] text-muted">Empty: the bot skips this DM.</div>}
          </DmFrame>
        );
      })}
    </div>
  );
}
