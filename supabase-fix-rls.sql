-- Fix: infinite recursion in crew_members RLS policy.
-- Run this in Supabase SQL Editor AFTER supabase-setup.sql.
-- Cause: the crew_members SELECT policy queried crew_members from within its own
-- USING clause, so Postgres re-triggered the same policy evaluating itself forever.
-- Fix: a SECURITY DEFINER helper function checks membership while bypassing RLS
-- internally (safe here — it only ever returns a boolean, never row data).

create or replace function public.is_crew_member(target_crew_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.crew_members
    where crew_id = target_crew_id and user_id = auth.uid()
  );
$$;
grant execute on function public.is_crew_member(uuid) to authenticated;

drop policy if exists "view own crew memberships" on public.crew_members;
create policy "view own crew memberships" on public.crew_members
  for select using (
    user_id = auth.uid() or public.is_crew_member(crew_id)
  );

drop policy if exists "crew members can view crew" on public.crews;
create policy "crew members can view crew" on public.crews
  for select using ( public.is_crew_member(id) );

drop policy if exists "select shared crew trips" on public.trips;
create policy "select shared crew trips" on public.trips
  for select using (
    shared = true and public.is_crew_member(crew_id)
  );
