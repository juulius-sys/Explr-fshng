-- Explr Fshng — support multiple target species per trip.
-- Run in Supabase SQL Editor after the earlier setup scripts.
-- Converts existing single-species rows into 1-element arrays, no data lost.

alter table public.trips
  alter column species type text[] using array[species];
