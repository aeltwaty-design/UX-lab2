// Thin Slack Web API client plus request verification. Runs in Deno (Supabase Edge Functions).

const TOKEN = Deno.env.get("SLACK_BOT_TOKEN") ?? "";
const SIGNING_SECRET = Deno.env.get("SLACK_SIGNING_SECRET") ?? "";

export type Block = Record<string, unknown>;

export class SlackError extends Error {
  constructor(public method: string, public code: string) {
    super(`Slack ${method} failed: ${code}`);
  }
}

export async function slack<T = Record<string, unknown>>(method: string, body: Record<string, unknown>): Promise<T> {
  // Form-encoded, like Slack's own SDK: the read methods (users.info, users.list, conversations.members,
  // chat.getPermalink) reject JSON bodies with invalid_arguments. Nested values travel as JSON strings.
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) {
    if (v === undefined || v === null) continue;
    form.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
  }
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=utf-8", Authorization: `Bearer ${TOKEN}` },
    body: form.toString(),
  });
  const json = (await res.json()) as { ok: boolean; error?: string } & T;
  if (!json.ok) throw new SlackError(method, json.error ?? "unknown_error");
  return json;
}

/** Verifies the Slack signature on a raw request body. Rejects requests older than five minutes. */
export async function verifySlack(req: Request, raw: string): Promise<boolean> {
  const ts = req.headers.get("x-slack-request-timestamp") ?? "";
  const sig = req.headers.get("x-slack-signature") ?? "";
  if (!ts || !sig || !SIGNING_SECRET) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SIGNING_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`v0:${ts}:${raw}`));
  const expected = "v0=" + [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

export function postMessage(channel: string, text: string, blocks?: Block[], extra: Record<string, unknown> = {}) {
  return slack<{ ts: string; channel: string }>("chat.postMessage", { channel, text, blocks, unfurl_links: false, ...extra });
}

export function updateMessage(channel: string, ts: string, text: string, blocks: Block[]) {
  return slack("chat.update", { channel, ts, text, blocks });
}

export function postEphemeral(channel: string, user: string, text: string, blocks?: Block[]) {
  return slack("chat.postEphemeral", { channel, user, text, blocks });
}

/** A DM: posting to a user id opens the conversation (needs im:write). */
export function dm(user: string, text: string, blocks?: Block[]) {
  return postMessage(user, text, blocks);
}

export function openView(trigger_id: string, view: Block) {
  return slack("views.open", { trigger_id, view });
}

export async function permalink(channel: string, message_ts: string): Promise<string> {
  const r = await slack<{ permalink: string }>("chat.getPermalink", { channel, message_ts });
  return r.permalink;
}

export async function pin(channel: string, timestamp: string) {
  try {
    await slack("pins.add", { channel, timestamp });
  } catch {
    /* pins:write missing is not fatal */
  }
}

/** Unpins and deletes one of the bot's own messages. False when Slack refuses (already gone, or not ours). */
export async function deleteMessage(channel: string, ts: string): Promise<boolean> {
  try {
    await slack("pins.remove", { channel, timestamp: ts });
  } catch {
    /* not pinned */
  }
  try {
    await slack("chat.delete", { channel, ts });
    return true;
  } catch {
    return false;
  }
}

export async function channelMemberIds(channel: string): Promise<string[]> {
  const ids: string[] = [];
  let cursor = "";
  do {
    const r = await slack<{ members: string[]; response_metadata?: { next_cursor?: string } }>("conversations.members", {
      channel,
      limit: 200,
      cursor: cursor || undefined,
    });
    ids.push(...r.members);
    cursor = r.response_metadata?.next_cursor ?? "";
  } while (cursor);
  return ids;
}

export interface SlackUser {
  id: string;
  name: string;
  real_name?: string;
  is_bot?: boolean;
  deleted?: boolean;
  profile?: { display_name?: string; real_name?: string };
}

export async function listUsers(): Promise<SlackUser[]> {
  const out: SlackUser[] = [];
  let cursor = "";
  do {
    const r = await slack<{ members: SlackUser[]; response_metadata?: { next_cursor?: string } }>("users.list", {
      limit: 200,
      cursor: cursor || undefined,
    });
    out.push(...r.members);
    cursor = r.response_metadata?.next_cursor ?? "";
  } while (cursor);
  return out;
}

export async function userInfo(user: string): Promise<SlackUser> {
  const r = await slack<{ user: SlackUser }>("users.info", { user });
  return r.user;
}

export function displayName(u: SlackUser): string {
  return u.profile?.display_name || u.real_name || u.profile?.real_name || u.name;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Downloads a Slack-hosted file with the bot token (needs files:read). Without the scope Slack answers with a login page. */
export async function downloadFile(url: string): Promise<{ bytes: Uint8Array; type: string }> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const type = (res.headers.get("content-type") ?? "application/octet-stream").split(";")[0]!.trim();
  if (!res.ok || type.includes("text/html")) throw new Error(`file download refused (${res.status}, ${type})`);
  return { bytes: new Uint8Array(await res.arrayBuffer()), type };
}
