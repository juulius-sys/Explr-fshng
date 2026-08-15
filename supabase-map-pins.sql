-- Explr Fshng — shared crew map pins (fishing spots, boat launches, closed
-- roads, bait shops, hazards). Run in Supabase SQL Editor after the earlier
-- setup scripts.

create table public.map_pins (
  id uuid primary key default gen_random_uuid(),
  crew_id uuid references public.crews(id) not null,
  created_by uuid references auth.users(id) not null,
  category text not null check (category in ('fishing_spot', 'boat_launch', 'closed_road', 'bait_shop', 'hazard', 'other')),
  label text not null,
  notes text,
  lat double precision not null,
  lon double precision not null,
  created_at timestamptz not null default now()
);

create index map_pins_crew_id_idx on public.map_pins(crew_id);

alter table public.map_pins enable row level security;

create policy "view pins for your crew" on public.map_pins
  for select using (public.is_crew_member(crew_id));
create policy "add pins to your crew" on public.map_pins
  for insert with check (created_by = auth.uid() and public.is_crew_member(crew_id));
create policy "remove own pins" on public.map_pins
  for delete using (created_by = auth.uid());
