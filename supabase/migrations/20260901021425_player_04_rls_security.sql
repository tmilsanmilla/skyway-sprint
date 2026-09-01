-- Player 04 RLS + security: centralized player and admin authorization.
create table if not exists public.admin_users (
  email text primary key check (email = lower(email)),
  created_at timestamptz not null default now()
);
insert into public.admin_users(email) values ('tmilsanmilla@gmail.com') on conflict do nothing;
alter table public.admin_users enable row level security;
revoke all on table public.admin_users from anon, authenticated;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admin_users
    where email = lower(coalesce(auth.jwt()->>'email',''))
  );
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

revoke all on table public.player_profiles from anon, authenticated;
grant select on table public.player_profiles to authenticated;
drop policy if exists "Players read their profile" on public.player_profiles;
create policy "Players read their profile" on public.player_profiles for select to authenticated using ((select auth.uid())=user_id);
drop policy if exists "Admins read player profiles" on public.player_profiles;
create policy "Admins read player profiles" on public.player_profiles for select to authenticated using ((select public.is_admin()));

revoke all on table public.player_stats from anon, authenticated;
grant select, insert, update on table public.player_stats to authenticated;
drop policy if exists "Players read their own stats" on public.player_stats;
create policy "Players read their own stats" on public.player_stats for select to authenticated using ((select auth.uid())=user_id);
drop policy if exists "Players create their own stats" on public.player_stats;
create policy "Players create their own stats" on public.player_stats for insert to authenticated with check ((select auth.uid())=user_id);
drop policy if exists "Players update their own stats" on public.player_stats;
create policy "Players update their own stats" on public.player_stats for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);

revoke all on table public.player_reports from anon, authenticated;
grant insert, select, update on table public.player_reports to authenticated;
drop policy if exists "Players submit their own reports" on public.player_reports;
create policy "Players submit their own reports" on public.player_reports for insert to authenticated with check ((select auth.uid())=user_id);
drop policy if exists "Admins read reports" on public.player_reports;
create policy "Admins read reports" on public.player_reports for select to authenticated using ((select public.is_admin()));
drop policy if exists "Admins resolve reports" on public.player_reports;
create policy "Admins resolve reports" on public.player_reports for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
