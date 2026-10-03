-- WebNBA career saves. Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- Safe to run again: it only creates what is missing.

create table if not exists public.career_saves (
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  slot smallint not null check (slot between 1 and 3),
  -- Bumped on every save; a client saving over a newer version is told so.
  version integer not null default 1 check (version > 0),
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, slot)
);

-- Saves are capped at 1 MB each.
alter table public.career_saves drop constraint if exists career_saves_size;
alter table public.career_saves add constraint career_saves_size check (pg_column_size(data) < 1048576);

-- Row level security: everyone reads and writes only their own rows. The
-- publishable key in the web page can do nothing else.
alter table public.career_saves enable row level security;

drop policy if exists "own saves: read" on public.career_saves;
drop policy if exists "own saves: insert" on public.career_saves;
drop policy if exists "own saves: update" on public.career_saves;
drop policy if exists "own saves: delete" on public.career_saves;

create policy "own saves: read" on public.career_saves
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "own saves: insert" on public.career_saves
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own saves: update" on public.career_saves
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own saves: delete" on public.career_saves
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Anonymous visitors get no access at all.
revoke all on public.career_saves from anon;
grant select, insert, update, delete on public.career_saves to authenticated;

-- Account-wide data (coins; later MyTeam): one row per player. Added 2026-10-04.
create table if not exists public.account_data (
  user_id uuid primary key references auth.users (id) on delete cascade default auth.uid(),
  version integer not null default 1 check (version > 0),
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.account_data drop constraint if exists account_data_size;
alter table public.account_data add constraint account_data_size check (pg_column_size(data) < 1048576);

alter table public.account_data enable row level security;

drop policy if exists "own account: read" on public.account_data;
drop policy if exists "own account: insert" on public.account_data;
drop policy if exists "own account: update" on public.account_data;

create policy "own account: read" on public.account_data
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "own account: insert" on public.account_data
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own account: update" on public.account_data
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

revoke all on public.account_data from anon;
grant select, insert, update on public.account_data to authenticated;
