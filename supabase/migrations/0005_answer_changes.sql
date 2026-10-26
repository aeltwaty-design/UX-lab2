-- Per study: may a member change their answer after submitting it? On by default (the behaviour so far).
-- When off, the bot refuses a second poll tap or survey submission and the post says answers are final.

alter table studies add column if not exists allow_changes boolean not null default true;

-- The view lists the columns explicitly so a new one can be appended (create or replace only allows appending).
create or replace view study_stats with (security_invoker = true) as
  select s.id, s.type, s.status, s.title_en, s.title_ar, s.intro_en, s.intro_ar, s.audience, s.audience_teams, s.target,
         s.publish_at, s.close_at, s.published_at, s.closed_at, s.slack_channel_id, s.slack_ts, s.reminder_sent_at,
         s.created_by, s.created_at, s.updated_at,
         coalesce(r.n, 0)::int as response_count,
         coalesce(b.n, 0)::int as booking_count,
         s.allow_changes
  from studies s
  left join (select study_id, count(*) as n from responses group by study_id) r on r.study_id = s.id
  left join (select study_id, count(*) as n from session_bookings where cancelled_at is null group by study_id) b on b.study_id = s.id;
grant select on study_stats to authenticated;
