-- Google Calendar and Meet for session recruitment. The bot mirrors every booked slot into one event on a connected
-- Google Workspace calendar (booked members as guests, Google emails the invites) and, when the study asks for it,
-- adds a Google Meet link. The connection (one refresh token) lives in google_calendar, readable by the service role only.

alter table studies add column if not exists meet boolean not null default true;
comment on column studies.meet is 'Session recruitment: create a Google Meet link with each slot''s calendar event.';

alter table session_slots
  add column if not exists google_event_id text,
  add column if not exists meet_url text;

-- The work email Slack reports for the member (users:read.email), cached for calendar invites.
alter table participants add column if not exists email text;

create table if not exists google_calendar (
  id int primary key default 1 check (id = 1),
  account_email text not null,
  refresh_token text not null,
  connected_at timestamptz not null default now(),
  last_error text
);
-- Row level security with no policies: only the service role (edge functions) can read the token. The dashboard asks
-- the admin-actions function for the connection status instead.
alter table google_calendar enable row level security;

-- Forgetting a member drops the cached email as well.
create or replace function forget_participant(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'not an admin'; end if;
  update participants
     set name = 'Forgotten member', slack_user_id = 'forgotten:' || id::text, email = null, deleted_at = now()
   where id = p_id and deleted_at is null;
  update responses set profile = profile || jsonb_build_object('name', 'Forgotten member') where participant_id = p_id;
end $$;

-- create or replace only allows appending a column, so the new one goes last.
create or replace view study_stats with (security_invoker = true) as
  select s.id, s.type, s.status, s.title_en, s.title_ar, s.intro_en, s.intro_ar, s.audience, s.audience_teams, s.target,
         s.publish_at, s.close_at, s.published_at, s.closed_at, s.slack_channel_id, s.slack_ts, s.reminder_sent_at,
         s.created_by, s.created_at, s.updated_at,
         coalesce(r.n, 0)::int as response_count,
         coalesce(b.n, 0)::int as booking_count,
         s.allow_changes,
         s.compare_url,
         s.meet
  from studies s
  left join (select study_id, count(*) as n from responses group by study_id) r on r.study_id = s.id
  left join (select study_id, count(*) as n from session_bookings where cancelled_at is null group by study_id) b on b.study_id = s.id;
grant select on study_stats to authenticated;
