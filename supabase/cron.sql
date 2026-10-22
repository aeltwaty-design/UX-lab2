-- Scheduler: publish and close studies on time, sync the channel roster.
-- Replace PROJECT_REF and CRON_SECRET, then run once in the SQL editor.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('research-desk-publish-due') where exists (select 1 from cron.job where jobname = 'research-desk-publish-due');
select cron.schedule(
  'research-desk-publish-due',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://PROJECT_REF.supabase.co/functions/v1/publish-due',
    headers := '{"Content-Type":"application/json","x-cron-secret":"CRON_SECRET"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
