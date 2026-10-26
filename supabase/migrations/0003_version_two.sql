-- Version two: preference tests (an image per option), session recruitment (slots and bookings),
-- the friction inbox (screenshots, notes, status) and the two storage buckets they need.
-- Safe to re-run. No DROP statements on purpose.

-- ---------- preference tests ----------
alter table options add column if not exists image_url text;

-- ---------- session recruitment ----------
create table if not exists session_slots (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references studies(id) on delete cascade,
  position int not null default 0,
  starts_at timestamptz not null,
  minutes int not null default 30 check (minutes between 10 and 180),
  place text not null default '',
  capacity int not null default 1 check (capacity between 1 and 20),
  created_at timestamptz not null default now()
);
create index if not exists session_slots_study on session_slots(study_id, starts_at);

create table if not exists session_bookings (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references session_slots(id) on delete cascade,
  study_id uuid not null references studies(id) on delete cascade,
  participant_id uuid not null references participants(id) on delete cascade,
  booked_at timestamptz not null default now(),
  cancelled_at timestamptz,
  reminded_at timestamptz,
  profile jsonb not null default '{}'::jsonb
);
create index if not exists session_bookings_slot on session_bookings(slot_id);
create index if not exists session_bookings_participant on session_bookings(participant_id);
-- One active booking per member per study; moving a booking cancels the old one first.
create unique index if not exists session_bookings_one_active on session_bookings(study_id, participant_id) where cancelled_at is null;

-- ---------- friction inbox ----------
alter table friction_reports add column if not exists slack_user_id text;
alter table friction_reports add column if not exists channel_id text;
alter table friction_reports add column if not exists screenshot_path text;
alter table friction_reports add column if not exists note text not null default '';
alter table friction_reports add column if not exists resolved_at timestamptz;
alter table friction_reports add column if not exists updated_at timestamptz not null default now();
alter table friction_reports add column if not exists profile jsonb not null default '{}'::jsonb;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'friction_touch') then
    create trigger friction_touch before update on friction_reports for each row execute function touch_updated_at();
  end if;
end $$;

-- ---------- row level security for the new tables (admins only; edge functions use the service role) ----------
alter table session_slots enable row level security;
alter table session_bookings enable row level security;
do $$
declare t text;
begin
  foreach t in array array['session_slots','session_bookings'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'admin_all') then
      execute format('create policy admin_all on %I for all to authenticated using (is_admin()) with check (is_admin())', t);
    end if;
  end loop;
end $$;
grant select, insert, update, delete on session_slots, session_bookings to authenticated;

-- ---------- the studies view gains a booking count ----------
create or replace view study_stats with (security_invoker = true) as
  select s.*, coalesce(r.n, 0)::int as response_count, coalesce(b.n, 0)::int as booking_count
  from studies s
  left join (select study_id, count(*) as n from responses group by study_id) r on r.study_id = s.id
  left join (select study_id, count(*) as n from session_bookings where cancelled_at is null group by study_id) b on b.study_id = s.id;
grant select on study_stats to authenticated;

-- ---------- storage: public study images, private friction screenshots ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('study-images', 'study-images', true, 5242880, array['image/png','image/jpeg','image/gif','image/webp'])
on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit)
values ('friction', 'friction', false, 10485760)
on conflict (id) do nothing;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'study_images_read') then
    create policy study_images_read on storage.objects for select to public using (bucket_id = 'study-images');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'study_images_admin_insert') then
    create policy study_images_admin_insert on storage.objects for insert to authenticated with check (bucket_id = 'study-images' and public.is_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'study_images_admin_update') then
    create policy study_images_admin_update on storage.objects for update to authenticated using (bucket_id = 'study-images' and public.is_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'study_images_admin_delete') then
    create policy study_images_admin_delete on storage.objects for delete to authenticated using (bucket_id = 'study-images' and public.is_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'friction_admin_read') then
    create policy friction_admin_read on storage.objects for select to authenticated using (bucket_id = 'friction' and public.is_admin());
  end if;
end $$;
