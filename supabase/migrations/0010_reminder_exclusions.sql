-- Members the research team never sends reminder DMs to: the profile reminder (no profile yet) and the
-- study reminder (no answer or booking yet). Set per member on the Participants page. The welcome DM for
-- newcomers and the day-before reminder for a booked session still go out.
alter table channel_members add column if not exists no_reminders boolean not null default false;
