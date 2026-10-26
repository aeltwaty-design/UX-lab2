// Slack Events API endpoint: keeps the channel roster current and asks newcomers for a profile.
import { dm, displayName, userInfo, verifySlack } from "../_shared/slack.ts";
import { getSettings } from "../_shared/db.ts";
import { profilePromptBlocks } from "../_shared/blocks.ts";
import { memberJoined, memberLeft } from "../_shared/actions.ts";

interface Event {
  type: string;
  user?: string;
  channel?: string;
  channel_type?: string;
}

Deno.serve(async (req) => {
  const raw = await req.text();
  const body = JSON.parse(raw || "{}") as { type: string; challenge?: string; event?: Event };
  if (body.type === "url_verification") return new Response(body.challenge ?? "", { status: 200 });
  if (!(await verifySlack(req, raw))) return new Response("bad signature", { status: 401 });

  const ev = body.event;
  try {
    if (ev?.type === "member_joined_channel" && ev.user && ev.channel) {
      const settings = await getSettings();
      if (ev.channel !== settings.channel_id) return new Response("ignored", { status: 200 });
      let name = "";
      try {
        const u = await userInfo(ev.user);
        if (u.is_bot) return new Response("bot", { status: 200 });
        name = displayName(u);
      } catch {
        /* users:read missing */
      }
      await memberJoined(ev.user, name);
      await dm(ev.user, `Welcome to ${settings.channel_name}. Before your first answer, fill in a short profile.`, profilePromptBlocks(settings));
    } else if (ev?.type === "member_left_channel" && ev.user && ev.channel) {
      const settings = await getSettings();
      if (ev.channel === settings.channel_id) await memberLeft(ev.user);
    }
  } catch (e) {
    console.error("slack-events", e);
  }
  return new Response("ok", { status: 200 });
});
