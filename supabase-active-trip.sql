-- Explr Fshng — Active Trip mode: live location sharing (via a secret link,
-- no login needed for viewers) and photo-attached field reports.
-- Run in Supabase SQL Editor after the earlier setup scripts.

alter table public.trips add column if not exists is_active boolean not null default false;
alter table public.trips add column if not exists share_token text unique;
alter table public.trips add column if not exists live_lat double precision;
alter table public.trips add column if not exists live_lon double precision;
alter table public.trips add column if not exists live_updated_at timestamptz;

-- Public, read-only, narrow: returns only what a shared-link viewer needs
-- (label + live position + status), never the whole trip or any other data.
-- SECURITY DEFINER so it can bypass the trips RLS policies (which are
-- normally scoped to the owner/crew) for this one specific, deliberate case.
create or replace function public.get_shared_trip_location(token text)
returns table(label text, lat double precision, lon double precision, updated_at timestamptz, is_active boolean)
language sql
security definer
set search_path = public
stable
as $$
  select (location->>'name')::text, live_lat, live_lon, live_updated_at, is_active
  from public.trips
  where share_token = token;
$$;
grant execute on function public.get_shared_trip_location(text) to anon, authenticated;

-- New pin categories for field reports made during a trip.
alter table public.map_pins drop constraint if exists map_pins_category_check;
alter table public.map_pins add constraint map_pins_category_check
  check (category in ('fishing_spot', 'boat_launch', 'closed_road', 'bait_shop', 'hazard', 'catch', 'pollution', 'environment_change', 'other'));
alter table public.map_pins add column if not exists photo_url text;

-- Storage bucket for pin photos. Public read (so photos display without
-- needing a signed URL per view) — same public-by-design tradeoff as the
-- Supabase publishable key: not secret, just needs a hard-to-guess path,
-- which the generated file path already gives it.
insert into storage.buckets (id, name, public)
values ('pin-photos', 'pin-photos', true)
on conflict (id) do nothing;

create policy "authenticated users can upload pin photos" on storage.objects
  for insert with check (bucket_id = 'pin-photos' and auth.role() = 'authenticated');
create policy "anyone can view pin photos" on storage.objects
  for select using (bucket_id = 'pin-photos');
