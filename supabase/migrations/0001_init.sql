-- Research Desk schema. Run once on an empty Supabase project.
-- Admins sign in with Supabase Auth; colleagues never touch the database directly,
-- the Slack edge functions write on their behalf with the service role key.

create extension if not exists pgcrypto;

-- ---------- admins ----------
create table if not exists admins (
  email text primary key,
  added_at timestamptz not null default now()
);

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from admins where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- ---------- settings ----------
create table if not exists settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

insert into settings (key, value) values
  ('channel_id', '""'),
  ('channel_name', '"#ux-research"'),
  ('workspace_url', '""'),
  ('hours_cap', '6'),
  ('small_group', '8'),
  ('default_lang', '"en"'),
  ('teams', '["Product","Engineering","Design","Marketing","Sales","Customer support","Finance","People","Operations"]')
on conflict (key) do nothing;

-- ---------- studies ----------
create table if not exists studies (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('poll','survey','preference_test','session_recruitment','friction_report')),
  status text not null default 'draft' check (status in ('draft','scheduled','live','closed','reported')),
  title_en text not null default '',
  title_ar text not null default '',
  intro_en text not null default '',
  intro_ar text not null default '',
  audience text not null default 'everyone' check (audience in ('everyone','panel','teams')),
  audience_teams text[] not null default '{}',
  target int,
  publish_at timestamptz,
  close_at timestamptz,
  published_at timestamptz,
  closed_at timestamptz,
  slack_channel_id text,
  slack_ts text,
  reminder_sent_at timestamptz,
  created_by text default (auth.jwt() ->> 'email'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists questions (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references studies(id) on delete cascade,
  position int not null default 0,
  kind text not null check (kind in ('single','multi','scale','yesno','text')),
  text_en text not null default '',
  text_ar text not null default '',
  required boolean not null default true
);
create index if not exists questions_study on questions(study_id, position);

create table if not exists options (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references questions(id) on delete cascade,
  position int not null default 0,
  label_en text not null default '',
  label_ar text not null default ''
);
create index if not exists options_question on options(question_id, position);

-- ---------- participants (one row per Slack member who filled in the profile) ----------
create table if not exists participants (
  id uuid primary key default gen_random_uuid(),
  slack_user_id text not null unique,
  name text not null,
  age_band text not null check (age_band in ('18-24','25-34','35-44','45+')),
  gender text not null check (gender in ('female','male')),
  device text not null check (device in ('iphone','android')),
  team text,
  apps text[] not null default '{}',
  language text not null default 'en' check (language in ('en','ar')),
  sessions_ok boolean not null default false,
  profile_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Channel roster, synced from Slack, so "missing a profile" can be counted.
create table if not exists channel_members (
  slack_user_id text primary key,
  name text not null default '',
  is_active boolean not null default true,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  profile_asked_at timestamptz
);

-- ---------- responses ----------
create table if not exists responses (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references studies(id) on delete cascade,
  participant_id uuid not null references participants(id) on delete cascade,
  submitted_at timestamptz not null default now(),
  profile jsonb not null,            -- snapshot of the profile at answer time
  unique (study_id, participant_id)
);
create index if not exists responses_study on responses(study_id);

create table if not exists answers (
  id uuid primary key default gen_random_uuid(),
  response_id uuid not null references responses(id) on delete cascade,
  question_id uuid not null references questions(id) on delete cascade,
  option_id uuid references options(id) on delete cascade,
  value_text text,
  value_num int
);
create index if not exists answers_response on answers(response_id);
create index if not exists answers_question on answers(question_id);

-- A tap before the profile exists: remembered here, applied once the profile is saved.
create table if not exists pending_actions (
  slack_user_id text primary key,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

-- ---------- results posts ----------
create table if not exists results_posts (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null unique references studies(id) on delete cascade,
  body_en text not null default '',
  body_ar text not null default '',
  include_totals boolean not null default true,
  posted_at timestamptz,
  slack_ts text,
  created_at timestamptz not null default now()
);

-- ---------- friction reports (version two; the table exists so nothing migrates later) ----------
create table if not exists friction_reports (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid references participants(id) on delete set null,
  app text not null check (app in ('walaplus','walaone')),
  tried text not null,
  happened text not null,
  screenshot_url text,
  status text not null default 'new' check (status in ('new','fixed','duplicate','by_design')),
  created_at timestamptz not null default now()
);

-- ---------- bookkeeping ----------
create or replace function touch_updated_at() returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists studies_touch on studies;
create trigger studies_touch before update on studies for each row execute function touch_updated_at();
drop trigger if exists participants_touch on participants;
create trigger participants_touch before update on participants for each row execute function touch_updated_at();
drop trigger if exists settings_touch on settings;
create trigger settings_touch before update on settings for each row execute function touch_updated_at();

-- ---------- views the dashboard reads ----------
create or replace view study_stats with (security_invoker = true) as
  select s.*, coalesce(r.n, 0)::int as response_count
  from studies s
  left join (select study_id, count(*) as n from responses group by study_id) r on r.study_id = s.id;

create or replace view participant_stats with (security_invoker = true) as
  select p.id as participant_id, count(r.id)::int as response_count
  from participants p left join responses r on r.participant_id = p.id
  group by p.id;

-- Remove a colleague's name from everything, keep the counts.
create or replace function forget_participant(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'not an admin'; end if;
  update participants
     set name = 'Forgotten member', slack_user_id = 'forgotten:' || id::text, deleted_at = now()
   where id = p_id and deleted_at is null;
  update responses set profile = profile || jsonb_build_object('name', 'Forgotten member') where participant_id = p_id;
end $$;

-- ---------- row level security: admins only; the service role (edge functions) bypasses RLS ----------
alter table admins enable row level security;
alter table settings enable row level security;
alter table studies enable row level security;
alter table questions enable row level security;
alter table options enable row level security;
alter table participants enable row level security;
alter table channel_members enable row level security;
alter table responses enable row level security;
alter table answers enable row level security;
alter table pending_actions enable row level security;
alter table results_posts enable row level security;
alter table friction_reports enable row level security;

do $$
declare t text;
begin
  foreach t in array array['admins','settings','studies','questions','options','participants','channel_members','responses','answers','pending_actions','results_posts','friction_reports'] loop
    execute format('drop policy if exists admin_all on %I', t);
    execute format('create policy admin_all on %I for all to authenticated using (is_admin()) with check (is_admin())', t);
  end loop;
end $$;

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on study_stats, participant_stats to authenticated;
revoke execute on function is_admin() from public, anon;
revoke execute on function forget_participant(uuid) from public, anon;
grant execute on function is_admin() to authenticated;
grant execute on function forget_participant(uuid) to authenticated;
