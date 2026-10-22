// Scheduler, called by pg_cron every five minutes with the x-cron-secret header.
// Publishes scheduled studies, closes live ones at their close date, sends the day-before reminder,
// keeps asking for missing profiles, and refreshes the channel roster once an hour.
import { db, getSettings } from "../_shared/db.ts";
import { askForProfiles, closeStudy, publishStudy, remindStudy, syncMembers } from "../_shared/actions.ts";

/** CRON_SECRET from the function secrets wins; otherwise the value migration 0002 generated in the database. */
async function cronSecret(): Promise<string> {
  const env = Deno.env.get("CRON_SECRET");
  if (env) return env;
  const { data } = await db.rpc("cron_secret");
  return typeof data === "string" ? data : "";
}

Deno.serve(async (req) => {
  const secret = await cronSecret();
  if (!secret || req.headers.get("x-cron-secret") !== secret) return new Response("forbidden", { status: 403 });

  const now = new Date();
  const log: string[] = [];
  const settings = await getSettings();
  if (!settings.channel_id) return Response.json({ ok: false, message: "channel_id not set" });

  try {
    const { data: due } = await db.from("studies").select("id, title_en").eq("status", "scheduled").lte("publish_at", now.toISOString());
    for (const s of (due ?? []) as { id: string; title_en: string }[]) {
      const r = await publishStudy(s.id);
      log.push(`publish ${s.title_en}: ${r.message}`);
    }

    const { data: closing } = await db.from("studies").select("id, title_en").eq("status", "live").lte("close_at", now.toISOString());
    for (const s of (closing ?? []) as { id: string; title_en: string }[]) {
      const r = await closeStudy(s.id);
      log.push(`close ${s.title_en}: ${r.message}`);
    }

    const dayAhead = new Date(now.getTime() + 24 * 3600_000).toISOString();
    const { data: reminders } = await db
      .from("studies")
      .select("id, title_en")
      .eq("status", "live")
      .is("reminder_sent_at", null)
      .lte("close_at", dayAhead)
      .gt("close_at", now.toISOString());
    for (const s of (reminders ?? []) as { id: string; title_en: string }[]) {
      const r = await remindStudy(s.id);
      log.push(`remind ${s.title_en}: ${r.message}`);
    }

    const lastSync = settings.members_synced_at ? new Date(settings.members_synced_at).getTime() : 0;
    if (now.getTime() - lastSync > 3600_000) {
      const r = await syncMembers();
      log.push(`sync: ${r.message}`);
    }

    const { count } = await db.from("studies").select("id", { count: "exact", head: true }).eq("status", "live");
    if ((count ?? 0) > 0) {
      const asked = await askForProfiles(settings, 40);
      if (asked) log.push(`asked ${asked} members for a profile`);
    }
  } catch (e) {
    console.error("publish-due", e);
    log.push(`error: ${(e as Error).message}`);
  }
  return Response.json({ ok: true, ran_at: now.toISOString(), log });
});
