-- Announcements: posts from the research team to the channel that are not studies
-- (a launch, a thank-you, what changed because of the answers). Written in the dashboard,
-- posted by the bot now or on a date, editable and removable afterwards.

create table if not exists announcements (
  id uuid primary key default gen_random_uuid(),
  title_en text not null default '',
  body_en text not null default '',
  body_ar text not null default '',
  pin boolean not null default false,
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'posted')),
  publish_at timestamptz,
  posted_at timestamptz,
  slack_channel_id text,
  slack_ts text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table announcements is 'Free-form posts from the research team to the channel, outside any study.';

create or replace trigger announcements_touch before update on announcements for each row execute function touch_updated_at();

alter table announcements enable row level security;
create policy admin_all on announcements for all to authenticated using (is_admin()) with check (is_admin());
grant select, insert, update, delete on announcements to authenticated;
