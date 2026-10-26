-- Preference tests: one picture with the options side by side, labelled A, B, C…, built by the dashboard when the
-- study is saved (Slack stacks image blocks one under the other). The bot posts it when present and falls back to
-- one image per option.

alter table studies add column if not exists compare_url text;

-- create or replace only allows appending a column, so the new one goes last.
create or replace view study_stats with (security_invoker = true) as
  select s.id, s.type, s.status, s.title_en, s.title_ar, s.intro_en, s.intro_ar, s.audience, s.audience_teams, s.target,
         s.publish_at, s.close_at, s.published_at, s.closed_at, s.slack_channel_id, s.slack_ts, s.reminder_sent_at,
         s.created_by, s.created_at, s.updated_at,
         coalesce(r.n, 0)::int as response_count,
         coalesce(b.n, 0)::int as booking_count,
         s.allow_changes,
         s.compare_url
  from studies s
  left join (select study_id, count(*) as n from responses group by study_id) r on r.study_id = s.id
  left join (select study_id, count(*) as n from session_bookings where cancelled_at is null group by study_id) b on b.study_id = s.id;
grant select on study_stats to authenticated;
