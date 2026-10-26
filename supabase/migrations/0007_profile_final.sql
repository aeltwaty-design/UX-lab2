-- Profile final: a member fills the profile in once; after that the bot (service role) cannot change the row.
-- Admins keep corrections from the dashboard, and forget_participant still works because it sets deleted_at.
-- The bot already refuses to reopen the form; this makes the rule hold at the database too.

create or replace function public.guard_profile_final() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.deleted_at is null and new.deleted_at is null and not is_admin()
     and row(new.slack_user_id, new.name, new.age_band, new.gender, new.device, new.team, new.apps, new.language, new.sessions_ok)
         is distinct from
         row(old.slack_user_id, old.name, old.age_band, old.gender, old.device, old.team, old.apps, old.language, old.sessions_ok) then
    raise exception 'A saved profile is final and cannot be changed.' using errcode = 'check_violation';
  end if;
  return new;
end
$$;

create or replace trigger participants_guard_final
  before update on public.participants
  for each row execute function public.guard_profile_final();
