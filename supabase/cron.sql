-- Scheduler: publish and close studies on time, remind, sync the channel roster.
-- Replace PROJECT_REF, then run once in the SQL editor (after migration 0002). Re-running replaces the job.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'research-desk-publish-due',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://PROJECT_REF.supabase.co/functions/v1/publish-due',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select value from private.cron where key = 'cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
