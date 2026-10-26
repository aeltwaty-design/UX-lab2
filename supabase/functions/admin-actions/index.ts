// Actions the dashboard cannot do itself because they need the Slack bot token.
// The caller must be a signed-in admin (Supabase Auth JWT + admins table).
import { createClient } from "jsr:@supabase/supabase-js@2";
import { db } from "../_shared/db.ts";
import { closeStudy, deletePost, postResults, publishStudy, remindMissingProfiles, remindStudy, repostProfile, syncMembers, testSlack, type Outcome } from "../_shared/actions.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: Outcome, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

async function callerIsAdmin(req: Request): Promise<boolean> {
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return false;
  const anon = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const { data, error } = await anon.auth.getUser();
  const email = data.user?.email?.toLowerCase();
  if (error || !email) return false;
  const { data: row } = await db.from("admins").select("email").ilike("email", email).maybeSingle();
  return Boolean(row);
}

type Body = { action: string; study_id?: string; link?: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!(await callerIsAdmin(req))) return reply({ ok: false, message: "Not an admin." }, 401);

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return reply({ ok: false, message: "Bad request." }, 400);
  }
  const id = body.study_id ?? "";
  try {
    switch (body.action) {
      case "publish_now":
        return reply(await publishStudy(id));
      case "close_now":
        return reply(await closeStudy(id));
      case "remind":
        return reply(await remindStudy(id));
      case "post_results":
        return reply(await postResults(id));
      case "repost_profile":
        return reply(await repostProfile());
      case "remind_missing_profiles":
        return reply(await remindMissingProfiles());
      case "sync_members":
        return reply(await syncMembers());
      case "test_slack":
        return reply(await testSlack());
      case "delete_post":
        return reply(await deletePost(body.link ?? ""));
      default:
        return reply({ ok: false, message: `Unknown action ${body.action}.` }, 400);
    }
  } catch (e) {
    console.error("admin-actions", body.action, e);
    return reply({ ok: false, message: (e as Error).message }, 500);
  }
});
