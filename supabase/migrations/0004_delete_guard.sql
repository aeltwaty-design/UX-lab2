-- Delete guard: a study that is still collecting answers cannot be deleted. Close it first.
-- The dashboard disables Delete while a study is live; this makes the rule hold for the API too.

create or replace function public.guard_study_delete() returns trigger
language plpgsql as $$
begin
  if old.status = 'live' then
    raise exception 'Close the study before deleting it.' using errcode = 'check_violation';
  end if;
  return old;
end
$$;

create or replace trigger studies_guard_delete
  before delete on public.studies
  for each row execute function public.guard_study_delete();
