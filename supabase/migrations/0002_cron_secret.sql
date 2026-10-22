-- A shared secret for the scheduler, generated inside the database so nobody has to paste it anywhere.
-- publish-due reads it through cron_secret() (service role only); supabase/cron.sql sends it as a header.
create schema if not exists private;
create table if not exists private.cron (key text primary key, value text not null, created_at timestamptz not null default now());
insert into private.cron (key, value) values ('cron_secret', encode(gen_random_bytes(24), 'hex')) on conflict (key) do nothing;

create or replace function public.cron_secret() returns text
language sql stable security definer set search_path = private, public as $$
  select value from private.cron where key = 'cron_secret';
$$;
revoke all on function public.cron_secret() from public;
revoke all on function public.cron_secret() from anon;
revoke all on function public.cron_secret() from authenticated;
grant execute on function public.cron_secret() to service_role;
