-- Explr Fshng — run this once in Supabase SQL Editor (Dashboard > SQL Editor > New query > Run)

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now()
);

create table public.crews (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique,
  created_by uuid references auth.users(id) not null,
  created_at timestamptz not null default now()
);

create table public.crew_members (
  crew_id uuid references public.crews(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (crew_id, user_id)
);

create table public.trips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) not null,
  crew_id uuid references public.crews(id),
  shared boolean not null default false,
  location jsonb not null,
  species text not null,
  method text not null,
  time_window jsonb not null,
  reasons jsonb not null,
  status text not null default 'planned',
  log jsonb,
  created_at timestamptz not null default now()
);

create index trips_user_id_idx on public.trips(user_id);
create index trips_crew_id_idx on public.trips(crew_id);

alter table public.profiles enable row level security;
alter table public.crews enable row level security;
alter table public.crew_members enable row level security;
alter table public.trips enable row level security;

-- Profiles: visible to yourself and to anyone who shares a crew with you
create policy "profiles viewable by self or crewmates" on public.profiles
  for select using (
    id = auth.uid()
    or id in (
      select cm2.user_id from public.crew_members cm1
      join public.crew_members cm2 on cm1.crew_id = cm2.crew_id
      where cm1.user_id = auth.uid()
    )
  );
create policy "users manage own profile" on public.profiles
  for insert with check (id = auth.uid());
create policy "users update own profile" on public.profiles
  for update using (id = auth.uid());

-- Membership checks go through this helper (SECURITY DEFINER bypasses RLS
-- internally) instead of a raw subquery on crew_members, because a policy on
-- crew_members that subqueries crew_members directly recurses infinitely.
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

-- Crews: visible to members; created via the function below (not direct insert)
create policy "crew members can view crew" on public.crews
  for select using ( public.is_crew_member(id) );

-- Crew membership: visible to yourself and crewmates
create policy "view own crew memberships" on public.crew_members
  for select using (
    user_id = auth.uid() or public.is_crew_member(crew_id)
  );

-- Trips: you can always manage your own; crewmates can see ones you choose to share
create policy "select own trips" on public.trips
  for select using (user_id = auth.uid());
create policy "select shared crew trips" on public.trips
  for select using (
    shared = true and public.is_crew_member(crew_id)
  );
create policy "insert own trips" on public.trips
  for insert with check (user_id = auth.uid());
create policy "update own trips" on public.trips
  for update using (user_id = auth.uid());
create policy "delete own trips" on public.trips
  for delete using (user_id = auth.uid());

-- Create a crew + auto-join the creator, returns the invite code to share with buddies
create or replace function public.create_crew(crew_name text)
returns table(crew_id uuid, invite_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  new_code text;
  new_id uuid;
begin
  new_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
  insert into public.crews (name, invite_code, created_by) values (crew_name, new_code, auth.uid()) returning id into new_id;
  insert into public.crew_members (crew_id, user_id) values (new_id, auth.uid());
  return query select new_id, new_code;
end;
$$;
grant execute on function public.create_crew(text) to authenticated;

-- Join a crew using an invite code a buddy gave you
create or replace function public.join_crew_by_code(code text)
returns table(crew_id uuid, crew_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  found record;
begin
  select id, name into found from public.crews where invite_code = upper(code);
  if found.id is null then
    raise exception 'Invalid invite code';
  end if;
  insert into public.crew_members (crew_id, user_id) values (found.id, auth.uid())
  on conflict do nothing;
  return query select found.id, found.name;
end;
$$;
grant execute on function public.join_crew_by_code(text) to authenticated;
