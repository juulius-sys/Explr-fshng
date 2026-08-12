-- Explr Fshng — RSVP, shopping list, and cost splitting.
-- Run this in Supabase SQL Editor AFTER supabase-setup.sql and supabase-fix-rls.sql.

alter table public.trips add column if not exists respond_by date;

create table public.trip_responses (
  trip_id uuid references public.trips(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  response text not null check (response in ('accept', 'decline', 'maybe')),
  responded_at timestamptz not null default now(),
  primary key (trip_id, user_id)
);

create table public.trip_shopping_items (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid references public.trips(id) on delete cascade,
  label text not null,
  done boolean not null default false,
  added_by uuid references auth.users(id) not null,
  created_at timestamptz not null default now()
);

create table public.trip_expenses (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid references public.trips(id) on delete cascade,
  label text not null,
  amount numeric(10, 2) not null,
  paid_by uuid references auth.users(id) not null,
  created_at timestamptz not null default now()
);

alter table public.trip_responses enable row level security;
alter table public.trip_shopping_items enable row level security;
alter table public.trip_expenses enable row level security;

-- Same pattern as is_crew_member: SECURITY DEFINER so policies on these tables
-- don't have to subquery trips (and trips' own policies) directly.
create or replace function public.can_view_trip(target_trip_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.trips t
    where t.id = target_trip_id
    and (t.user_id = auth.uid() or (t.shared = true and public.is_crew_member(t.crew_id)))
  );
$$;
grant execute on function public.can_view_trip(uuid) to authenticated;

-- Responses: anyone who can see the trip can see/set their own RSVP
create policy "view responses on visible trips" on public.trip_responses
  for select using (public.can_view_trip(trip_id));
create policy "set own response" on public.trip_responses
  for insert with check (user_id = auth.uid() and public.can_view_trip(trip_id));
create policy "update own response" on public.trip_responses
  for update using (user_id = auth.uid());
create policy "delete own response" on public.trip_responses
  for delete using (user_id = auth.uid());

-- Shopping list: collaborative — anyone who can see the trip can add/check items
create policy "view shopping items on visible trips" on public.trip_shopping_items
  for select using (public.can_view_trip(trip_id));
create policy "add shopping items" on public.trip_shopping_items
  for insert with check (added_by = auth.uid() and public.can_view_trip(trip_id));
create policy "check off shopping items" on public.trip_shopping_items
  for update using (public.can_view_trip(trip_id));
create policy "remove own shopping items" on public.trip_shopping_items
  for delete using (added_by = auth.uid());

-- Expenses: anyone who can see the trip can log one; only the person who paid can remove it
create policy "view expenses on visible trips" on public.trip_expenses
  for select using (public.can_view_trip(trip_id));
create policy "add expenses" on public.trip_expenses
  for insert with check (paid_by = auth.uid() and public.can_view_trip(trip_id));
create policy "remove own expenses" on public.trip_expenses
  for delete using (paid_by = auth.uid());
