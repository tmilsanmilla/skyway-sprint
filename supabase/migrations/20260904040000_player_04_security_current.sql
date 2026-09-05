-- Player 04 Security
--
-- Rerunnable current-state repair for immutable administrator identity,
-- account provisioning, least-privilege RLS/table access, and SECURITY
-- DEFINER function exposure. Run this before Admin 03 Player Lookup.

begin;

create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;
revoke create on schema public from public, anon, authenticated;
grant usage on schema public to anon, authenticated;
alter default privileges in schema public
  revoke execute on functions from public;

do $$
begin
  if to_regclass('public.player_stats') is null
     or to_regclass('public.player_profiles') is null
     or to_regclass('public.player_unlocks') is null
     or to_regclass('public.player_loadouts') is null
     or to_regclass('public.extraction_catalog') is null then
    raise exception 'Player 01/03 account tables are missing. Run Player 01 Stats and Player 03 Usernames first.';
  end if;

  if to_regclass('public.admin_users') is null
     or to_regclass('public.player_bans') is null
     or to_regclass('public.player_devices') is null
     or to_regclass('public.player_device_links') is null
     or to_regclass('public.admin_command_audit') is null then
    raise exception 'Admin security tables are missing. Run the existing Admin 02 role/player-security setup first.';
  end if;
end
$$;

-- -------------------------------------------------------------------------
-- Immutable admin identities
-- -------------------------------------------------------------------------

alter table public.admin_users
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists role text not null default 'co_admin';

update public.admin_users admin
set user_id = users.id,
    email = lower(users.email)
from auth.users users
where users.email is not null
  and lower(users.email) = lower(admin.email)
  and (
    admin.user_id is null
    or admin.user_id = users.id
  );

create unique index if not exists admin_users_user_id_uidx
  on public.admin_users(user_id)
  where user_id is not null;

create or replace function app_private.has_active_ban(
  p_user_id uuid,
  p_scope text,
  p_device_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.player_bans ban
    where ban.scope = p_scope
      and ban.starts_at <= now()
      and ban.revoked_at is null
      and (ban.expires_at is null or ban.expires_at > now())
      and (
        (p_scope in ('account', 'leaderboard')
          and p_user_id is not null
          and ban.target_user_id = p_user_id)
        or
        (p_scope = 'device'
          and p_device_id is not null
          and ban.target_device_id = p_device_id)
      )
  );
$$;

-- Admin authorization is based on the immutable Auth user ID. Legacy
-- email-only rows are linked above; an unresolved email row grants no access.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and not app_private.has_active_ban(auth.uid(), 'account', null)
    and exists (
      select 1
      from public.admin_users admin
      where admin.user_id = auth.uid()
    );
$$;

create or replace function public.is_main_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and not app_private.has_active_ban(auth.uid(), 'account', null)
    and exists (
      select 1
      from public.admin_users admin
      where admin.user_id = auth.uid()
        and admin.role = 'main'
    );
$$;

create or replace function public.get_admin_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select admin.role
  from public.admin_users admin
  where auth.uid() is not null
    and admin.user_id = auth.uid()
    and not app_private.has_active_ban(auth.uid(), 'account', null)
  limit 1;
$$;

revoke all on function app_private.has_active_ban(uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function public.is_admin() from public, anon, authenticated;
revoke all on function public.is_main_admin() from public, anon, authenticated;
revoke all on function public.get_admin_role() from public, anon, authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_main_admin() to authenticated;
grant execute on function public.get_admin_role() to authenticated;

-- -------------------------------------------------------------------------
-- Safe account provisioning and current-account repair
-- -------------------------------------------------------------------------

create or replace function public.provision_player_starters()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.player_stats(user_id, total_gems, high_score, updated_at)
  values (new.id, 0, 0, now())
  on conflict (user_id) do nothing;

  insert into public.player_unlocks(
    user_id, item_key, item_type, rarity, unlocked_at
  )
  select new.id, starter.item_key, starter.item_type, starter.rarity, now()
  from (values
    ('runner', 'class', 'common'),
    ('medic', 'class', 'common'),
    ('tank', 'class', 'common'),
    ('trickster', 'class', 'common'),
    ('runner_ace', 'character', 'common'),
    ('medic_patch', 'character', 'common'),
    ('tank_bulwark', 'character', 'common'),
    ('trickster_rogue', 'character', 'uncommon')
  ) as starter(item_key, item_type, rarity)
  on conflict (user_id, item_key) do update
  set item_type = excluded.item_type,
      rarity = excluded.rarity;

  insert into public.player_loadouts(
    user_id, class_key, character_key, updated_at
  ) values (
    new.id, 'runner', 'runner_ace', now()
  )
  on conflict (user_id) do nothing;

  return new;
end;
$$;

revoke all on function public.provision_player_starters()
  from public, anon, authenticated;

drop trigger if exists provision_player_starters_after_signup on auth.users;
create trigger provision_player_starters_after_signup
after insert on auth.users
for each row execute function public.provision_player_starters();

-- Backfill only permanent base rows and the included starter inventory. No
-- paid character or cosmetic is granted by this repair.
insert into public.player_stats(user_id, total_gems, high_score, updated_at)
select users.id, 0, 0, now()
from auth.users users
on conflict (user_id) do nothing;

insert into public.player_unlocks(
  user_id, item_key, item_type, rarity, unlocked_at
)
select users.id, starter.item_key, starter.item_type, starter.rarity, now()
from auth.users users
cross join (values
  ('runner', 'class', 'common'),
  ('medic', 'class', 'common'),
  ('tank', 'class', 'common'),
  ('trickster', 'class', 'common'),
  ('runner_ace', 'character', 'common'),
  ('medic_patch', 'character', 'common'),
  ('tank_bulwark', 'character', 'common'),
  ('trickster_rogue', 'character', 'uncommon')
) as starter(item_key, item_type, rarity)
on conflict (user_id, item_key) do update
set item_type = excluded.item_type,
    rarity = excluded.rarity;

insert into public.player_loadouts(
  user_id, class_key, character_key, updated_at
)
select users.id, 'runner', 'runner_ace', now()
from auth.users users
on conflict (user_id) do nothing;

-- -------------------------------------------------------------------------
-- Least-privilege RLS for normal account flows
-- -------------------------------------------------------------------------

alter table public.player_stats enable row level security;
alter table public.player_profiles enable row level security;
alter table public.player_unlocks enable row level security;
alter table public.player_loadouts enable row level security;
alter table public.extraction_catalog enable row level security;
alter table public.player_reports enable row level security;
alter table public.admin_users enable row level security;
alter table public.player_devices enable row level security;
alter table public.player_device_links enable row level security;
alter table public.player_bans enable row level security;
alter table public.admin_command_audit enable row level security;

-- Remove every historical/auto-generated policy from the client-readable
-- account tables before installing the exact allowlist below. Matching only
-- old policy names is unsafe because a permissive policy can have any name.
do $$
declare
  table_name text;
  policy_row record;
begin
  foreach table_name in array array[
    'player_stats', 'player_profiles', 'player_unlocks',
    'player_loadouts', 'extraction_catalog', 'player_reports'
  ]
  loop
    for policy_row in
      select policyname
      from pg_policies
      where schemaname = 'public' and tablename = table_name
    loop
      execute format(
        'drop policy %I on public.%I',
        policy_row.policyname,
        table_name
      );
    end loop;
  end loop;
end
$$;

revoke all on table public.player_stats
  from public, anon, authenticated;
revoke all on table public.player_profiles
  from public, anon, authenticated;
revoke all on table public.player_unlocks
  from public, anon, authenticated;
revoke all on table public.player_loadouts
  from public, anon, authenticated;
revoke all on table public.extraction_catalog
  from public, anon, authenticated;
revoke all on table public.player_reports
  from public, anon, authenticated;
revoke all on table public.admin_users
  from public, anon, authenticated;
revoke all on table public.player_devices
  from public, anon, authenticated;
revoke all on table public.player_device_links
  from public, anon, authenticated;
revoke all on table public.player_bans
  from public, anon, authenticated;
revoke all on table public.admin_command_audit
  from public, anon, authenticated;

grant select on table public.player_stats to authenticated;
grant select on table public.player_profiles to authenticated;
grant select on table public.player_unlocks to authenticated;
grant select on table public.player_loadouts to authenticated;
grant select on table public.extraction_catalog to authenticated;
grant select on table public.player_reports to authenticated;
grant insert(user_id, report_type, message)
  on table public.player_reports to authenticated;

create policy "Players read their own stats"
  on public.player_stats for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Players read their profile"
  on public.player_profiles for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Players read own unlocks"
  on public.player_unlocks for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Players read own loadout"
  on public.player_loadouts for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Authenticated players read extraction catalog"
  on public.extraction_catalog for select to authenticated
  using (active);

create policy "Players submit their own reports"
  on public.player_reports for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "Admins read reports"
  on public.player_reports for select to authenticated
  using ((select public.is_admin()));

do $$
declare
  sequence_row record;
begin
  for sequence_row in
    select namespace.nspname as schema_name,
           sequence_class.relname as sequence_name
    from pg_class sequence_class
    join pg_namespace namespace
      on namespace.oid = sequence_class.relnamespace
    where namespace.nspname = 'public'
      and sequence_class.relkind = 'S'
  loop
    execute format(
      'revoke all on sequence %I.%I from public, anon, authenticated',
      sequence_row.schema_name,
      sequence_row.sequence_name
    );
  end loop;

  if to_regclass('public.player_reports_id_seq') is not null then
    execute 'grant usage on sequence public.player_reports_id_seq to authenticated';
  end if;
end
$$;

-- Everything in these tables is server-owned. Remove any stale policy as well
-- as direct client grants left by an older saved query.
do $$
declare
  table_name text;
  policy_row record;
begin
  foreach table_name in array array[
    'admin_users', 'admin_role_audit', 'admin_command_audit', 'admin_todos',
    'player_devices', 'player_device_links', 'player_bans',
    'username_blocklist', 'admin_compensation_ledger',
    'extraction_transactions', 'multiplayer_queue',
    'multiplayer_ranked_results', 'player_1v1_stats',
    'multiplayer_point_events'
  ]
  loop
    if to_regclass(format('public.%I', table_name)) is not null then
      execute format('alter table public.%I enable row level security', table_name);
      execute format(
        'revoke all on table public.%I from public, anon, authenticated',
        table_name
      );
      for policy_row in
        select policyname
        from pg_policies
        where schemaname = 'public' and tablename = table_name
      loop
        execute format(
          'drop policy %I on public.%I',
          policy_row.policyname,
          table_name
        );
      end loop;
    end if;
  end loop;
end
$$;

-- 1v1 Realtime rows are read-only to authenticated match participants. All
-- writes stay inside the checked multiplayer RPCs.
do $$
declare
  policy_row record;
begin
  if to_regclass('public.multiplayer_matches') is not null
     and to_regclass('public.multiplayer_players') is not null
     and to_regclass('public.multiplayer_attacks') is not null then
    execute $definition$
      create or replace function public.is_1v1_participant(p_match_id uuid)
      returns boolean
      language sql
      stable
      security definer
      set search_path = ''
      as $function$
        select auth.uid() is not null
          and not app_private.has_active_ban(auth.uid(), 'account', null)
          and exists (
            select 1
            from public.multiplayer_players player
            where player.match_id = p_match_id
              and player.user_id = auth.uid()
          );
      $function$
    $definition$;

    execute 'revoke all on function public.is_1v1_participant(uuid) from public, anon, authenticated';
    execute 'grant execute on function public.is_1v1_participant(uuid) to authenticated';

    execute 'alter table public.multiplayer_matches enable row level security';
    execute 'alter table public.multiplayer_players enable row level security';
    execute 'alter table public.multiplayer_attacks enable row level security';
    execute 'revoke all on table public.multiplayer_matches from public, anon, authenticated';
    execute 'revoke all on table public.multiplayer_players from public, anon, authenticated';
    execute 'revoke all on table public.multiplayer_attacks from public, anon, authenticated';
    execute 'grant select on table public.multiplayer_matches to authenticated';
    execute 'grant select on table public.multiplayer_players to authenticated';
    execute 'grant select on table public.multiplayer_attacks to authenticated';

    for policy_row in
      select tablename, policyname
      from pg_policies
      where schemaname = 'public'
        and tablename in (
          'multiplayer_matches', 'multiplayer_players', 'multiplayer_attacks'
        )
    loop
      execute format(
        'drop policy %I on public.%I',
        policy_row.policyname,
        policy_row.tablename
      );
    end loop;

    execute 'create policy "Participants read their 1v1 matches" on public.multiplayer_matches for select to authenticated using ((select public.is_1v1_participant(id)))';
    execute 'create policy "Participants read 1v1 players" on public.multiplayer_players for select to authenticated using ((select public.is_1v1_participant(match_id)))';
    execute 'create policy "Participants read 1v1 attacks" on public.multiplayer_attacks for select to authenticated using ((select public.is_1v1_participant(match_id)))';
  end if;
end
$$;

-- Once the receipt-backed Multi-device 05 RPC exists, remove the obsolete
-- replayable three-argument coin endpoint.
do $$
begin
  if to_regprocedure(
    'public.award_1v1_points(uuid,text,integer,text)'
  ) is not null
     and to_regprocedure(
       'public.award_1v1_points(uuid,text,integer)'
     ) is not null then
    execute 'drop function if exists public.award_1v1_points(uuid, text, integer)';
  end if;
end
$$;

-- Reject data mutations initiated by an account-banned session even when an
-- older client reaches a SECURITY DEFINER gameplay RPC.
create or replace function app_private.block_account_banned_actor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null
     and app_private.has_active_ban(auth.uid(), 'account', null) then
    raise exception 'This account is banned from gameplay'
      using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function app_private.block_account_banned_actor()
  from public, anon, authenticated;

drop trigger if exists block_banned_player_stats on public.player_stats;
create trigger block_banned_player_stats
before insert or update or delete on public.player_stats
for each row execute function app_private.block_account_banned_actor();

drop trigger if exists block_banned_player_profiles on public.player_profiles;
create trigger block_banned_player_profiles
before insert or update or delete on public.player_profiles
for each row execute function app_private.block_account_banned_actor();

drop trigger if exists block_banned_player_unlocks on public.player_unlocks;
create trigger block_banned_player_unlocks
before insert or update or delete on public.player_unlocks
for each row execute function app_private.block_account_banned_actor();

drop trigger if exists block_banned_player_loadouts on public.player_loadouts;
create trigger block_banned_player_loadouts
before insert or update or delete on public.player_loadouts
for each row execute function app_private.block_account_banned_actor();

drop trigger if exists block_banned_player_reports on public.player_reports;
create trigger block_banned_player_reports
before insert or update or delete on public.player_reports
for each row execute function app_private.block_account_banned_actor();

-- Reports are resolved through this checked RPC; clients cannot update or
-- delete arbitrary report rows directly.
create or replace function public.resolve_player_report(report_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  delete from public.player_reports report
  where report.id = report_id;

  if not found then
    raise exception 'Report not found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.resolve_player_report(bigint)
  from public, anon, authenticated;
grant execute on function public.resolve_player_report(bigint)
  to authenticated;

-- Close PostgreSQL's default PUBLIC EXECUTE grant on every existing definer
-- function. Authenticated grants already installed by the app migrations are
-- preserved; the two deliberately public read/check RPCs are restored below.
do $$
declare
  routine record;
begin
  for routine in
    select
      namespace.nspname as schema_name,
      procedure.proname as function_name,
      pg_get_function_identity_arguments(procedure.oid) as identity_arguments
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where procedure.prosecdef
      and namespace.nspname in ('public', 'app_private')
  loop
    if routine.schema_name = 'app_private' then
      execute format(
        'revoke all on function %I.%I(%s) from public, anon, authenticated',
        routine.schema_name,
        routine.function_name,
        routine.identity_arguments
      );
    else
      execute format(
        'revoke all on function %I.%I(%s) from public, anon',
        routine.schema_name,
        routine.function_name,
        routine.identity_arguments
      );
    end if;
  end loop;
end
$$;

-- These are the only SECURITY DEFINER functions intentionally callable while
-- signed out. They expose no private account row.
do $$
begin
  if to_regprocedure('public.check_player_device(text)') is not null then
    grant execute on function public.check_player_device(text)
      to anon, authenticated;
  end if;
  if to_regprocedure('public.get_leaderboard()') is not null then
    grant execute on function public.get_leaderboard()
      to anon, authenticated;
  end if;
end
$$;

-- The dynamic PUBLIC hardening above preserves authenticated grants, while
-- these critical account/admin endpoints are asserted explicitly.
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_main_admin() to authenticated;
grant execute on function public.get_admin_role() to authenticated;
grant execute on function public.resolve_player_report(bigint)
  to authenticated;

notify pgrst, 'reload schema';

-- Fail the transaction instead of leaving a partially repaired live schema.
do $$
begin
  if exists (
    select 1
    from auth.users users
    where not exists (
      select 1 from public.player_stats stats where stats.user_id = users.id
    )
       or not exists (
         select 1 from public.player_loadouts loadout
         where loadout.user_id = users.id
       )
       or (
         select count(*)
         from public.player_unlocks unlock
         where unlock.user_id = users.id
           and unlock.item_key in (
             'runner', 'medic', 'tank', 'trickster',
             'runner_ace', 'medic_patch', 'tank_bulwark', 'trickster_rogue'
           )
       ) <> 8
  ) then
    raise exception 'One or more Auth accounts are still missing base player rows';
  end if;

  if has_table_privilege('anon', 'public.player_stats', 'SELECT')
     or has_table_privilege('authenticated', 'public.player_stats', 'INSERT')
     or has_table_privilege('authenticated', 'public.player_stats', 'UPDATE')
     or has_table_privilege('authenticated', 'public.player_unlocks', 'INSERT')
     or has_table_privilege('authenticated', 'public.player_loadouts', 'UPDATE')
     or has_table_privilege('authenticated', 'public.player_reports', 'UPDATE')
     or has_table_privilege('authenticated', 'public.admin_users', 'SELECT') then
    raise exception 'A direct client table privilege remains too broad';
  end if;

  if exists (
    select 1
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    cross join lateral aclexplode(
      coalesce(procedure.proacl, acldefault('f', procedure.proowner))
    ) privilege
    where procedure.prosecdef
      and namespace.nspname in ('public', 'app_private')
      and privilege.grantee = 0
      and privilege.privilege_type = 'EXECUTE'
  ) then
    raise exception 'A SECURITY DEFINER function is still executable by PUBLIC';
  end if;
end
$$;

commit;

select
  (
    select count(*) = 0
    from auth.users users
    where not exists (
      select 1 from public.player_stats stats where stats.user_id = users.id
    )
       or not exists (
         select 1 from public.player_loadouts loadout
         where loadout.user_id = users.id
       )
  ) as all_accounts_have_base_rows,
  not has_table_privilege(
    'authenticated', 'public.player_stats', 'UPDATE'
  ) as direct_stat_writes_blocked,
  not has_table_privilege(
    'authenticated', 'public.player_unlocks', 'INSERT'
  ) as direct_inventory_grants_blocked,
  not has_table_privilege(
    'authenticated', 'public.admin_users', 'SELECT'
  ) as admin_registry_private,
  not has_table_privilege(
    'authenticated', 'public.player_reports', 'UPDATE'
  ) as report_mutation_requires_rpc;
