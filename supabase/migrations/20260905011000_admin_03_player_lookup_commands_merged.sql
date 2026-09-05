-- Admin 03 Player Lookup and Commands — merged current setup
--
-- One rerunnable source of truth merged from:
--   20260901160000_admin_02_player_look_commands.sql
--   20260902120000_admin_02_player_record.sql
--   20260902140100_admin_03_player_lookup_labels.sql
--   20260902180000_admin_03_player_lookup_unban.sql
--   20260904041000_admin_03_player_lookup_commands_current.sql
--
-- Provides secure player search, receipt-free account/inventory lookup,
-- device registration, scoped bans, typed command execution/autocomplete,
-- durable moderation history, and /unban username-or-email support.
-- Command text is parsed by the client into typed RPC arguments; it is never
-- executed as SQL.

begin;

create extension if not exists pgcrypto with schema extensions;

create schema if not exists app_private;
revoke all on schema app_private from public;

-- This merged query owns Admin 03. It intentionally depends only on the
-- canonical Player 01 data model and Player 04/Admin 02 authorization setup.
do $$
begin
  if to_regclass('public.player_stats') is null
     or to_regclass('public.player_profiles') is null
     or to_regclass('public.player_unlocks') is null
     or to_regclass('public.player_loadouts') is null
     or to_regclass('public.extraction_catalog') is null then
    raise exception 'Player 01 Stats is missing. Run the merged Player 01 query first.';
  end if;

  if to_regclass('public.admin_users') is null
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public'
         and table_name = 'admin_users'
         and column_name = 'user_id'
     )
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public'
         and table_name = 'admin_users'
         and column_name = 'role'
     ) then
    raise exception 'Admin 02 / Player 04 authorization setup is missing.';
  end if;

  if to_regclass('public.multiplayer_queue') is null
     or to_regclass('public.multiplayer_matches') is null
     or to_regclass('public.multiplayer_players') is null
     or to_regclass('public.multiplayer_attacks') is null then
    raise exception 'The 1v1 tables required by Admin 03 coin commands are missing.';
  end if;
end
$$;

-- Close the direct-write hole left by the original player_stats policies.
-- Players read their own row; trusted SECURITY DEFINER RPCs perform mutations.
revoke insert, update, delete on table public.player_stats from anon, authenticated;
grant select on table public.player_stats to authenticated;
drop policy if exists "Players create their own stats" on public.player_stats;
drop policy if exists "Players update their own stats" on public.player_stats;

-- -------------------------------------------------------------------------
-- Starter ownership
-- -------------------------------------------------------------------------

-- Every account owns every class and one starter character in each class.
-- The four starters cannot be extracted from a paid box.
update public.extraction_catalog
set extractable = false
where item_key in (
  'runner_ace', 'medic_patch', 'tank_bulwark', 'trickster_rogue'
);

-- Keep the established cave-map key/CSS while matching the player-facing
-- cosmetic name used by the command examples.
update public.extraction_catalog
set display_name = 'Dark Caves'
where item_key = 'cave_map';

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
  select
    new.id,
    starter.item_key,
    starter.item_type,
    starter.rarity,
    now()
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
  on conflict (user_id, item_key) do nothing;

  insert into public.player_loadouts(user_id, class_key, character_key, updated_at)
  values (new.id, 'runner', 'runner_ace', now())
  on conflict (user_id) do nothing;

  return new;
end;
$$;

revoke all on function public.provision_player_starters() from public, anon, authenticated;

drop trigger if exists provision_player_starters_after_signup on auth.users;
create trigger provision_player_starters_after_signup
after insert on auth.users
for each row execute function public.provision_player_starters();

-- Backfill current accounts without replacing any equipped loadout or item.
insert into public.player_stats(user_id, total_gems, high_score, updated_at)
select users.id, 0, 0, now()
from auth.users users
on conflict (user_id) do nothing;

insert into public.player_unlocks(
  user_id, item_key, item_type, rarity, unlocked_at
)
select
  users.id,
  starter.item_key,
  starter.item_type,
  starter.rarity,
  now()
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
on conflict (user_id, item_key) do nothing;

insert into public.player_loadouts(user_id, class_key, character_key, updated_at)
select users.id, 'runner', 'runner_ace', now()
from auth.users users
on conflict (user_id) do nothing;

-- Shop/extraction receipts remain server-only and are intentionally omitted
-- from the Admin 03 player lookup response.

-- -------------------------------------------------------------------------
-- Device identities, scoped bans, and command audit
-- -------------------------------------------------------------------------

create table if not exists public.player_devices (
  id uuid primary key default gen_random_uuid(),
  token_hash bytea not null unique,
  token_hint text not null,
  label text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  constraint player_devices_hash_length_check
    check (octet_length(token_hash) = 32),
  constraint player_devices_label_length_check
    check (label is null or char_length(label) <= 80)
);

create table if not exists public.player_device_links (
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid not null references public.player_devices(id) on delete cascade,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (user_id, device_id)
);

create index if not exists player_device_links_device_idx
  on public.player_device_links(device_id, last_seen_at desc);

create table if not exists public.player_bans (
  id bigint generated always as identity primary key,
  scope text not null check (scope in ('account', 'device', 'leaderboard')),
  target_user_id uuid references auth.users(id) on delete cascade,
  target_device_id uuid references public.player_devices(id) on delete cascade,
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  reason text not null default 'Issued from admin player editor',
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  revoked_reason text,
  constraint player_bans_target_check check (
    (scope in ('account', 'leaderboard')
      and target_user_id is not null
      and target_device_id is null)
    or
    (scope = 'device'
      and target_user_id is null
      and target_device_id is not null)
  ),
  constraint player_bans_expiry_check
    check (expires_at is null or expires_at > starts_at),
  constraint player_bans_revocation_check check (
    (revoked_at is null and revoked_by is null and revoked_reason is null)
    or (revoked_at is not null and revoked_by is not null)
  ),
  constraint player_bans_reason_length_check
    check (char_length(reason) between 1 and 500)
);

create index if not exists player_bans_user_active_idx
  on public.player_bans(target_user_id, scope, expires_at)
  where revoked_at is null;
create index if not exists player_bans_device_active_idx
  on public.player_bans(target_device_id, expires_at)
  where revoked_at is null and scope = 'device';

create table if not exists public.admin_command_audit (
  id bigint generated always as identity primary key,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_email text not null,
  target_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  command_text text,
  request jsonb not null default '{}'::jsonb,
  result jsonb,
  succeeded boolean not null,
  error_message text,
  created_at timestamptz not null default now(),
  constraint admin_command_audit_command_length_check
    check (command_text is null or char_length(command_text) <= 1000),
  constraint admin_command_audit_error_check check (
    (succeeded and error_message is null)
    or (not succeeded and error_message is not null)
  )
);

create index if not exists admin_command_audit_target_created_idx
  on public.admin_command_audit(target_user_id, created_at desc);
create index if not exists admin_command_audit_actor_created_idx
  on public.admin_command_audit(actor_user_id, created_at desc);

alter table public.player_devices enable row level security;
alter table public.player_device_links enable row level security;
alter table public.player_bans enable row level security;
alter table public.admin_command_audit enable row level security;

revoke all on table public.player_devices from public, anon, authenticated;
revoke all on table public.player_device_links from public, anon, authenticated;
revoke all on table public.player_bans from public, anon, authenticated;
revoke all on table public.admin_command_audit from public, anon, authenticated;

-- No direct table policies are intentionally created. Every read or mutation
-- crosses a narrow SECURITY DEFINER RPC that performs an admin-role check.

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
          and ban.target_user_id = p_user_id)
        or
        (p_scope = 'device'
          and p_device_id is not null
          and ban.target_device_id = p_device_id)
      )
  );
$$;

revoke all on function app_private.has_active_ban(uuid, text, uuid)
  from public, anon, authenticated;

-- Link legacy email-only rows once. Authorization below never trusts the
-- mutable email claim; immutable Auth user IDs are authoritative.
update public.admin_users admin
set user_id = users.id,
    email = lower(users.email)
from auth.users users
where users.email is not null
  and lower(users.email) = lower(admin.email)
  and (admin.user_id is null or admin.user_id = users.id);

create unique index if not exists admin_users_user_id_uidx
  on public.admin_users(user_id)
  where user_id is not null;

-- Account bans also suspend every admin capability until revoked or expired.
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

revoke all on function public.is_admin()
  from public, anon, authenticated;
revoke all on function public.is_main_admin()
  from public, anon, authenticated;
revoke all on function public.get_admin_role()
  from public, anon, authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_main_admin() to authenticated;
grant execute on function public.get_admin_role() to authenticated;


-- Database mutations made by an account-banned authenticated actor are
-- rejected even when an older client calls an existing SECURITY DEFINER RPC.
-- Device bans still require the app to present its device token.
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

drop trigger if exists block_banned_multiplayer_queue on public.multiplayer_queue;
create trigger block_banned_multiplayer_queue
before insert or update or delete on public.multiplayer_queue
for each row execute function app_private.block_account_banned_actor();

drop trigger if exists block_banned_multiplayer_matches on public.multiplayer_matches;
create trigger block_banned_multiplayer_matches
before insert or update or delete on public.multiplayer_matches
for each row execute function app_private.block_account_banned_actor();

drop trigger if exists block_banned_multiplayer_players on public.multiplayer_players;
create trigger block_banned_multiplayer_players
before insert or update or delete on public.multiplayer_players
for each row execute function app_private.block_account_banned_actor();

drop trigger if exists block_banned_multiplayer_attacks on public.multiplayer_attacks;
create trigger block_banned_multiplayer_attacks
before insert or update or delete on public.multiplayer_attacks
for each row execute function app_private.block_account_banned_actor();

-- The app creates one random opaque token per browser profile. Only its SHA-256
-- digest is retained. Reusing the same token across accounts links the same app
-- device to each account without exposing the token to admins.
drop function if exists public.register_player_device(text, text);

create or replace function public.register_player_device(
  p_device_token text,
  p_label text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_hash bytea;
  v_device_id uuid;
  v_label text := nullif(trim(p_label), '');
  v_bans jsonb;
begin
  if v_uid is null then
    raise exception 'Sign in required';
  end if;
  if p_device_token is null
     or p_device_token !~ '^[A-Za-z0-9._~+/=-]{24,128}$' then
    raise exception 'Invalid app device token';
  end if;
  if v_label is not null and char_length(v_label) > 80 then
    raise exception 'Device label must be 80 characters or fewer';
  end if;

  v_hash := extensions.digest(
    convert_to(p_device_token, 'UTF8'),
    'sha256'
  );

  insert into public.player_devices(
    token_hash, token_hint, label, first_seen_at, last_seen_at
  ) values (
    v_hash,
    left(p_device_token, 4) || '…' || right(p_device_token, 4),
    v_label,
    now(),
    now()
  )
  on conflict (token_hash) do update
  set label = coalesce(excluded.label, public.player_devices.label),
      last_seen_at = now()
  returning id into v_device_id;

  insert into public.player_device_links(
    user_id, device_id, first_seen_at, last_seen_at
  ) values (
    v_uid, v_device_id, now(), now()
  )
  on conflict (user_id, device_id) do update
  set last_seen_at = now();

  select coalesce(
    jsonb_agg(jsonb_build_object(
      'id', ban.id,
      'scope', ban.scope,
      'expires_at', ban.expires_at,
      'reason', ban.reason
    ) order by ban.created_at),
    '[]'::jsonb
  )
  into v_bans
  from public.player_bans ban
  where ban.starts_at <= now()
    and ban.revoked_at is null
    and (ban.expires_at is null or ban.expires_at > now())
    and (
      ban.target_user_id = v_uid
      or ban.target_device_id = v_device_id
    );

  return jsonb_build_object(
    'device_id', v_device_id,
    'account_banned', app_private.has_active_ban(v_uid, 'account', null),
    'device_banned', app_private.has_active_ban(v_uid, 'device', v_device_id),
    'leaderboard_banned', app_private.has_active_ban(v_uid, 'leaderboard', null),
    'active_bans', v_bans
  );
end;
$$;

revoke all on function public.register_player_device(text, text)
  from public, anon;
grant execute on function public.register_player_device(text, text)
  to authenticated;

-- Guests present the same opaque browser-profile token without creating an
-- account link. This prevents a device ban from being bypassed by signing out
-- and choosing guest mode.
drop function if exists public.check_player_device(text);

create or replace function public.check_player_device(p_device_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_hash bytea;
  v_device_id uuid;
  v_bans jsonb := '[]'::jsonb;
begin
  if p_device_token is null
     or p_device_token !~ '^[A-Za-z0-9._~+/=-]{24,128}$' then
    raise exception 'Invalid app device token';
  end if;

  v_hash := extensions.digest(
    convert_to(p_device_token, 'UTF8'),
    'sha256'
  );

  select device.id
  into v_device_id
  from public.player_devices device
  where device.token_hash = v_hash;

  if v_device_id is null then
    return jsonb_build_object(
      'known', false,
      'device_banned', false,
      'active_bans', '[]'::jsonb
    );
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', ban.id,
    'scope', ban.scope,
    'expires_at', ban.expires_at,
    'reason', ban.reason
  ) order by ban.created_at), '[]'::jsonb)
  into v_bans
  from public.player_bans ban
  where ban.scope = 'device'
    and ban.target_device_id = v_device_id
    and ban.starts_at <= now()
    and ban.revoked_at is null
    and (ban.expires_at is null or ban.expires_at > now());

  return jsonb_build_object(
    'known', true,
    'device_banned', app_private.has_active_ban(null, 'device', v_device_id),
    'active_bans', v_bans
  );
end;
$$;

revoke all on function public.check_player_device(text) from public;
grant execute on function public.check_player_device(text) to anon, authenticated;

-- -------------------------------------------------------------------------
-- Read-only admin lookup and command autocomplete (main + co-admin)
-- -------------------------------------------------------------------------

drop function if exists public.admin_player_search(text, integer);

create or replace function public.admin_player_search(
  p_query text,
  p_limit integer default 20
)
returns table(
  user_id uuid,
  username text,
  email text,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  account_banned boolean,
  leaderboard_banned boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_query text := lower(trim(coalesce(p_query, '')));
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 25));
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;
  if char_length(v_query) < 2 then
    raise exception 'Enter at least 2 characters';
  end if;

  return query
  select
    users.id,
    profile.username::text,
    lower(users.email)::text,
    users.created_at,
    users.last_sign_in_at,
    app_private.has_active_ban(users.id, 'account', null),
    app_private.has_active_ban(users.id, 'leaderboard', null)
  from auth.users users
  left join public.player_profiles profile on profile.user_id = users.id
  where position(v_query in lower(coalesce(users.email, ''))) > 0
     or position(v_query in lower(coalesce(profile.username, ''))) > 0
     or users.id::text = v_query
  order by
    case
      when lower(coalesce(users.email, '')) = v_query then 0
      when lower(coalesce(profile.username, '')) = v_query then 0
      when users.id::text = v_query then 0
      else 1
    end,
    lower(coalesce(profile.username, users.email, users.id::text))
  limit v_limit;
end;
$$;

drop function if exists public.admin_command_suggestions(
  text, text, uuid, integer
);

create or replace function public.admin_command_suggestions(
  p_fragment text default '',
  p_kind text default null,
  p_selected_user_id uuid default null,
  p_limit integer default 12
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_fragment text := lower(trim(coalesce(p_fragment, '')));
  v_kind text := lower(nullif(trim(p_kind), ''));
  v_limit integer := greatest(1, least(coalesce(p_limit, 12), 25));
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;
  if v_kind is not null
     and v_kind not in ('character', 'cosmetic', 'player', 'obstacle', 'environment') then
    raise exception 'Invalid suggestion kind';
  end if;

  return jsonb_build_object(
    'commands', jsonb_build_array(
      '/grant <character|cosmetic> [item] [username|email]',
      '/revoke <character|cosmetic> [item] [from username|email]',
      '/set <gems|high_score|coins> <value> [username|email]',
      '/ban [account + device + leaderboard] for <duration|permanently>',
      '/bann [account + device + score] for <duration|permanently>',
      '/unban username/email'
    ),
    'item_kinds', jsonb_build_array('character', 'cosmetic'),
    'stats', jsonb_build_array('gems', 'high_score', 'coins'),
    'ban_scopes', jsonb_build_array('account', 'device', 'leaderboard'),
    'duration_units', jsonb_build_array('years', 'days', 'hours', 'minutes'),
    'selected_user_id', p_selected_user_id,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'item_key', item.item_key,
        'display_name', item.display_name,
        'command_kind', case
          when item.item_type = 'character' then 'character'
          else 'cosmetic'
        end,
        'item_type', item.item_type,
        'rarity', item.rarity,
        'character_class', item.character_class,
        'owned', case when p_selected_user_id is null then null else exists (
          select 1
          from public.player_unlocks unlock
          where unlock.user_id = p_selected_user_id
            and unlock.item_key = item.item_key
        ) end
      ) order by item.display_name)
      from (
        select catalog.*
        from public.extraction_catalog catalog
        where catalog.active
          and (
            v_kind is null
            or (v_kind = 'character' and catalog.item_type = 'character')
            or (v_kind = 'cosmetic' and catalog.item_type <> 'character')
            or catalog.item_type = v_kind
          )
          and (
            v_fragment = ''
            or position(v_fragment in lower(catalog.display_name)) > 0
            or position(v_fragment in lower(catalog.item_key)) > 0
          )
        order by
          case
            when lower(catalog.display_name) = v_fragment then 0
            when lower(catalog.item_key) = v_fragment then 0
            else 1
          end,
          catalog.display_name
        limit v_limit
      ) item
    ), '[]'::jsonb),
    'players', case
      when char_length(v_fragment) < 2 then '[]'::jsonb
      else coalesce((
        select jsonb_agg(jsonb_build_object(
          'user_id', player.user_id,
          'username', player.username,
          'email', player.email
        ) order by player.username nulls last, player.email)
        from (
          select
            users.id as user_id,
            profile.username,
            lower(users.email)::text as email
          from auth.users users
          left join public.player_profiles profile on profile.user_id = users.id
          where position(v_fragment in lower(coalesce(users.email, ''))) > 0
             or position(v_fragment in lower(coalesce(profile.username, ''))) > 0
             or users.id::text = v_fragment
          order by
            case
              when lower(coalesce(users.email, '')) = v_fragment then 0
              when lower(coalesce(profile.username, '')) = v_fragment then 0
              else 1
            end,
            lower(coalesce(profile.username, users.email, users.id::text))
          limit v_limit
        ) player
      ), '[]'::jsonb)
    end
  );
end;
$$;

revoke all on function public.admin_player_search(text, integer)
  from public, anon;
revoke all on function public.admin_command_suggestions(text, text, uuid, integer)
  from public, anon;
grant execute on function public.admin_player_search(text, integer)
  to authenticated;
grant execute on function public.admin_command_suggestions(text, text, uuid, integer)
  to authenticated;

-- -------------------------------------------------------------------------
-- Typed admin command execution (main admins only)
-- -------------------------------------------------------------------------

drop function if exists public.admin_execute_player_command(
  text, uuid, text, text, text, bigint, text[], uuid, bigint, boolean,
  bigint, text, text
);

create or replace function public.admin_execute_player_command(
  p_action text,
  p_target_user_id uuid,
  p_item_kind text default null,
  p_item_key text default null,
  p_stat_key text default null,
  p_value bigint default null,
  p_ban_scopes text[] default null,
  p_device_id uuid default null,
  p_duration_seconds bigint default null,
  p_permanent boolean default false,
  p_ban_id bigint default null,
  p_reason text default null,
  p_command_text text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_email text;
  v_action text := lower(trim(coalesce(p_action, '')));
  v_item_kind text := lower(trim(coalesce(p_item_kind, '')));
  v_item_key text := lower(trim(coalesce(p_item_key, '')));
  v_stat_key text := lower(trim(coalesce(p_stat_key, '')));
  v_reason text := coalesce(nullif(trim(p_reason), ''), 'Issued from admin player editor');
  v_catalog record;
  v_result jsonb;
  v_request jsonb;
  v_error text;
  v_sqlstate text;
  v_rows integer;
  v_scopes text[];
  v_scope text;
  v_device_id uuid := p_device_id;
  v_device_count integer;
  v_expires_at timestamptz;
  v_ban_id bigint;
  v_ban_ids jsonb := '[]'::jsonb;
  v_active_match_id uuid;
begin
  if not public.is_main_admin() then
    raise exception 'Only main admins can run player commands';
  end if;
  if not exists (select 1 from auth.users users where users.id = p_target_user_id) then
    raise exception 'Player not found';
  end if;

  select lower(users.email)::text
  into v_actor_email
  from auth.users users
  where users.id = v_actor;

  if v_action = 'bann' then
    v_action := 'ban';
  end if;
  if v_action not in ('grant', 'revoke', 'set', 'ban', 'unban') then
    raise exception 'Unknown player command';
  end if;
  if char_length(v_reason) > 500 then
    raise exception 'Reason must be 500 characters or fewer';
  end if;

  v_request := jsonb_build_object(
    'item_kind', p_item_kind,
    'item_key', p_item_key,
    'stat_key', p_stat_key,
    'value', p_value,
    'ban_scopes', p_ban_scopes,
    'device_id', p_device_id,
    'duration_seconds', p_duration_seconds,
    'permanent', p_permanent,
    'ban_id', p_ban_id,
    'reason', v_reason
  );

  -- Expected validation failures are returned as structured results. The inner
  -- exception block rolls back a partial mutation before the failed attempt is
  -- appended to the audit table.
  begin
    if v_action in ('grant', 'revoke') then
      if v_item_kind not in ('character', 'cosmetic') then
        raise exception 'Item kind must be character or cosmetic';
      end if;
      if v_item_key = '' then
        raise exception 'Choose an exact catalog item';
      end if;

      select
        catalog.item_key,
        catalog.display_name,
        catalog.item_type,
        catalog.rarity,
        catalog.character_class,
        catalog.active
      into v_catalog
      from public.extraction_catalog catalog
      where catalog.item_key = v_item_key;

      if not found then
        raise exception 'Catalog item not found';
      end if;
      if v_action = 'grant' and not coalesce(v_catalog.active, false) then
        raise exception 'Catalog item not found';
      end if;
      if v_item_kind = 'character' and v_catalog.item_type <> 'character' then
        raise exception 'That catalog item is a cosmetic, not a character';
      end if;
      if v_item_kind = 'cosmetic' and v_catalog.item_type = 'character' then
        raise exception 'That catalog item is a character, not a cosmetic';
      end if;

      if v_action = 'grant' then
        insert into public.player_unlocks(
          user_id, item_key, item_type, rarity, unlocked_at
        ) values (
          p_target_user_id,
          v_catalog.item_key,
          v_catalog.item_type,
          v_catalog.rarity,
          now()
        )
        on conflict (user_id, item_key) do nothing;
        get diagnostics v_rows = row_count;

        v_result := jsonb_build_object(
          'ok', true,
          'action', v_action,
          'target_user_id', p_target_user_id,
          'item_key', v_catalog.item_key,
          'display_name', v_catalog.display_name,
          'item_type', v_catalog.item_type,
          'granted', v_rows = 1,
          'already_owned', v_rows = 0
        );
      else
        if v_catalog.item_key in (
          'runner_ace', 'medic_patch', 'tank_bulwark', 'trickster_rogue'
        ) then
          raise exception 'Starter characters cannot be revoked';
        end if;

        delete from public.player_unlocks unlock
        where unlock.user_id = p_target_user_id
          and unlock.item_key = v_catalog.item_key
          and unlock.item_type = v_catalog.item_type;
        get diagnostics v_rows = row_count;
        if v_rows = 0 then
          raise exception 'Player does not own that item';
        end if;

        if v_catalog.item_type = 'character' then
          update public.player_loadouts loadout
          set character_key = case v_catalog.character_class
                when 'medic' then 'medic_patch'
                when 'tank' then 'tank_bulwark'
                when 'trickster' then 'trickster_rogue'
                else 'runner_ace'
              end,
              updated_at = now()
          where loadout.user_id = p_target_user_id
            and loadout.character_key = v_catalog.item_key;
        elsif v_catalog.item_type = 'player' then
          update public.player_loadouts loadout
          set player_cosmetic = null, updated_at = now()
          where loadout.user_id = p_target_user_id
            and loadout.player_cosmetic = v_catalog.item_key;
        elsif v_catalog.item_type = 'obstacle' then
          update public.player_loadouts loadout
          set obstacle_cosmetic = null, updated_at = now()
          where loadout.user_id = p_target_user_id
            and loadout.obstacle_cosmetic = v_catalog.item_key;
        elsif v_catalog.item_type = 'environment' then
          update public.player_loadouts loadout
          set environment_cosmetic = null, updated_at = now()
          where loadout.user_id = p_target_user_id
            and loadout.environment_cosmetic = v_catalog.item_key;
        end if;

        v_result := jsonb_build_object(
          'ok', true,
          'action', v_action,
          'target_user_id', p_target_user_id,
          'item_key', v_catalog.item_key,
          'display_name', v_catalog.display_name,
          'item_type', v_catalog.item_type,
          'revoked', true
        );
      end if;

    elsif v_action = 'set' then
      if v_stat_key = 'score' then
        v_stat_key := 'high_score';
      end if;
      if v_stat_key not in ('gems', 'high_score', 'coins') then
        raise exception 'Stat must be gems, high_score, or coins';
      end if;
      if p_value is null or p_value < 0 then
        raise exception 'Stat value must be a non-negative whole number';
      end if;
      if (v_stat_key = 'gems' and p_value > 1000000000)
         or (v_stat_key = 'high_score' and p_value > 1000000000000)
         or (v_stat_key = 'coins' and p_value > 1000000) then
        raise exception 'Stat value is above the administrative safety limit';
      end if;

      if v_stat_key in ('gems', 'high_score') then
        insert into public.player_stats(user_id, total_gems, high_score, updated_at)
        values (p_target_user_id, 0, 0, now())
        on conflict (user_id) do nothing;

        update public.player_stats stats
        set total_gems = case
              when v_stat_key = 'gems' then p_value
              else stats.total_gems
            end,
            high_score = case
              when v_stat_key = 'high_score' then p_value
              else stats.high_score
            end,
            updated_at = now()
        where stats.user_id = p_target_user_id;
      else
        select player.match_id
        into v_active_match_id
        from public.multiplayer_players player
        join public.multiplayer_matches match on match.id = player.match_id
        where player.user_id = p_target_user_id
          and match.status in ('countdown', 'playing', 'intermission')
        order by match.created_at desc
        limit 1
        for update of player;

        if v_active_match_id is null then
          raise exception 'Coins can only be set while the player has an active 1v1 match';
        end if;

        update public.multiplayer_players player
        set obstacle_points = p_value::integer,
            updated_at = now()
        where player.match_id = v_active_match_id
          and player.user_id = p_target_user_id;
      end if;

      v_result := jsonb_build_object(
        'ok', true,
        'action', v_action,
        'target_user_id', p_target_user_id,
        'stat_key', v_stat_key,
        'value', p_value,
        'match_id', v_active_match_id
      );

    elsif v_action = 'ban' then
      if exists (
        select 1
        from public.admin_users admin
        join auth.users users
          on users.id = admin.user_id
          or (admin.user_id is null and lower(users.email) = admin.email)
        where users.id = p_target_user_id
      ) then
        raise exception 'Remove this player from the admin team before banning them';
      end if;
      if p_ban_scopes is null or cardinality(p_ban_scopes) = 0 then
        raise exception 'Choose at least one ban scope';
      end if;
      if exists (
        select 1
        from unnest(p_ban_scopes) requested(scope)
        where lower(trim(requested.scope))
          not in ('account', 'device', 'leaderboard', 'score')
      ) then
        raise exception 'Ban scopes are account, device, and leaderboard';
      end if;

      select array_agg(normalized.scope order by normalized.scope)
      into v_scopes
      from (
        select distinct case lower(trim(requested.scope))
          when 'score' then 'leaderboard'
          else lower(trim(requested.scope))
        end as scope
        from unnest(p_ban_scopes) requested(scope)
      ) normalized;

      if p_permanent then
        v_expires_at := null;
      else
        if p_duration_seconds is null
           or p_duration_seconds < 60
           or p_duration_seconds > 3155760000 then
          raise exception 'Timed bans must be between 1 minute and 100 years';
        end if;
        v_expires_at := clock_timestamp()
          + make_interval(secs => p_duration_seconds::double precision);
      end if;

      if 'device' = any(v_scopes) then
        if v_device_id is null then
          select
            count(*)::integer,
            (array_agg(link.device_id order by link.last_seen_at desc))[1]
          into v_device_count, v_device_id
          from public.player_device_links link
          where link.user_id = p_target_user_id;

          if v_device_count = 0 then
            raise exception 'This player has no registered app device';
          elsif v_device_count > 1 then
            raise exception 'Choose one device before issuing a device ban';
          end if;
        elsif not exists (
          select 1
          from public.player_device_links link
          where link.user_id = p_target_user_id
            and link.device_id = v_device_id
        ) then
          raise exception 'Selected device is not linked to this player';
        end if;

        if exists (
          select 1
          from public.player_device_links link
          join public.admin_users admin
            on admin.user_id = link.user_id
          where link.device_id = v_device_id
        ) then
          raise exception 'A device linked to an admin cannot be banned';
        end if;
      end if;

      foreach v_scope in array v_scopes loop
        update public.player_bans ban
        set revoked_at = now(),
            revoked_by = v_actor,
            revoked_reason = 'Superseded by a newer admin ban'
        where ban.scope = v_scope
          and ban.revoked_at is null
          and (ban.expires_at is null or ban.expires_at > now())
          and (
            (v_scope in ('account', 'leaderboard')
              and ban.target_user_id = p_target_user_id)
            or
            (v_scope = 'device' and ban.target_device_id = v_device_id)
          );

        insert into public.player_bans(
          scope,
          target_user_id,
          target_device_id,
          starts_at,
          expires_at,
          reason,
          created_by,
          created_at
        ) values (
          v_scope,
          case when v_scope in ('account', 'leaderboard')
            then p_target_user_id else null end,
          case when v_scope = 'device' then v_device_id else null end,
          now(),
          v_expires_at,
          v_reason,
          v_actor,
          now()
        ) returning id into v_ban_id;

        v_ban_ids := v_ban_ids || jsonb_build_array(v_ban_id);
      end loop;

      v_result := jsonb_build_object(
        'ok', true,
        'action', v_action,
        'target_user_id', p_target_user_id,
        'scopes', v_scopes,
        'device_id', v_device_id,
        'expires_at', v_expires_at,
        'permanent', p_permanent,
        'ban_ids', v_ban_ids
      );

    else
      if p_ban_id is null then
        raise exception 'Choose a ban to revoke';
      end if;

      update public.player_bans ban
      set revoked_at = now(),
          revoked_by = v_actor,
          revoked_reason = v_reason
      where ban.id = p_ban_id
        and ban.revoked_at is null
        and (
          ban.target_user_id = p_target_user_id
          or exists (
            select 1
            from public.player_device_links link
            where link.user_id = p_target_user_id
              and link.device_id = ban.target_device_id
          )
        );
      get diagnostics v_rows = row_count;
      if v_rows = 0 then
        raise exception 'Active ban not found for this player';
      end if;

      v_result := jsonb_build_object(
        'ok', true,
        'action', v_action,
        'target_user_id', p_target_user_id,
        'ban_id', p_ban_id,
        'revoked', true
      );
    end if;

  exception when others then
    get stacked diagnostics
      v_error = message_text,
      v_sqlstate = returned_sqlstate;

    insert into public.admin_command_audit(
      actor_user_id,
      actor_email,
      target_user_id,
      action,
      command_text,
      request,
      result,
      succeeded,
      error_message,
      created_at
    ) values (
      v_actor,
      coalesce(v_actor_email, ''),
      p_target_user_id,
      v_action,
      nullif(left(coalesce(p_command_text, ''), 1000), ''),
      v_request,
      jsonb_build_object('sqlstate', v_sqlstate),
      false,
      left(v_error, 1000),
      now()
    );

    return jsonb_build_object(
      'ok', false,
      'action', v_action,
      'target_user_id', p_target_user_id,
      'error', v_error
    );
  end;

  insert into public.admin_command_audit(
    actor_user_id,
    actor_email,
    target_user_id,
    action,
    command_text,
    request,
    result,
    succeeded,
    created_at
  ) values (
    v_actor,
    coalesce(v_actor_email, ''),
    p_target_user_id,
    v_action,
    nullif(left(coalesce(p_command_text, ''), 1000), ''),
    v_request,
    v_result,
    true,
    now()
  );

  return v_result;
end;
$$;

drop function if exists public.admin_get_command_audit(uuid, integer);

create or replace function public.admin_get_command_audit(
  p_target_user_id uuid default null,
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 100), 250));
begin
  if not public.is_main_admin() then
    raise exception 'Only main admins can read the command audit';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', audit.id,
      'actor_user_id', audit.actor_user_id,
      'actor_email', audit.actor_email,
      'target_user_id', audit.target_user_id,
      'action', audit.action,
      'command_text', audit.command_text,
      'request', audit.request,
      'result', audit.result,
      'succeeded', audit.succeeded,
      'error_message', audit.error_message,
      'created_at', audit.created_at
    ) order by audit.created_at desc)
    from (
      select command.*
      from public.admin_command_audit command
      where p_target_user_id is null
         or command.target_user_id = p_target_user_id
      order by command.created_at desc
      limit v_limit
    ) audit
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.admin_execute_player_command(
  text, uuid, text, text, text, bigint, text[], uuid, bigint, boolean,
  bigint, text, text
) from public, anon;
revoke all on function public.admin_get_command_audit(uuid, integer)
  from public, anon;
grant execute on function public.admin_execute_player_command(
  text, uuid, text, text, text, bigint, text[], uuid, bigint, boolean,
  bigint, text, text
) to authenticated;
grant execute on function public.admin_get_command_audit(uuid, integer)
  to authenticated;

-- Leaderboard bans hide scores without deleting the player's personal best.
create or replace function public.get_leaderboard()
returns table(rank bigint, username text, high_score bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select
    row_number() over (
      order by stats.high_score desc, profile.username asc
    ),
    profile.username,
    stats.high_score
  from public.player_stats stats
  join public.player_profiles profile on profile.user_id = stats.user_id
  where stats.high_score > 0
    and not app_private.has_active_ban(stats.user_id, 'account', null)
    and not app_private.has_active_ban(stats.user_id, 'leaderboard', null)
  order by stats.high_score desc, profile.username asc
  limit 50;
$$;

revoke all on function public.get_leaderboard() from public;
grant execute on function public.get_leaderboard() to anon, authenticated;

-- -------------------------------------------------------------------------
-- Merged player record and username/email unban surface
-- -------------------------------------------------------------------------

-- This is the final receipt-free player-detail definition. Keeping it after
-- the historical command surface guarantees stale saved-query versions are
-- overwritten before PostgREST reloads its schema cache.

drop function if exists public.admin_get_player(uuid);

create or replace function public.admin_get_player(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if p_user_id is null or not exists (
    select 1 from auth.users users where users.id = p_user_id
  ) then
    raise exception 'Player not found' using errcode = 'P0002';
  end if;

  select jsonb_build_object(
    'account', jsonb_build_object(
      'user_id', users.id,
      'email', lower(users.email),
      'created_at', users.created_at,
      'last_sign_in_at', users.last_sign_in_at,
      'email_confirmed_at', users.email_confirmed_at,
      'admin_role', coalesce((
        select admin.role from public.admin_users admin
        where admin.user_id = users.id limit 1
      ), 'player'),
      'account_banned', app_private.has_active_ban(users.id, 'account', null),
      'leaderboard_banned', app_private.has_active_ban(users.id, 'leaderboard', null)
    ),
    'profile', jsonb_build_object(
      'username', profile.username,
      'username_changed_at', profile.username_changed_at,
      'created_at', profile.created_at
    ),
    'stats', jsonb_build_object(
      'total_gems', coalesce(stats.total_gems, 0),
      'high_score', coalesce(stats.high_score, 0),
      'updated_at', stats.updated_at
    ),
    'loadout', jsonb_build_object(
      'class_key', coalesce(loadout.class_key, 'runner'),
      'character_key', coalesce(loadout.character_key, 'runner_ace'),
      'player_cosmetic', loadout.player_cosmetic,
      'obstacle_cosmetic', loadout.obstacle_cosmetic,
      'environment_cosmetic', loadout.environment_cosmetic,
      'updated_at', loadout.updated_at
    ),
    'unlocks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'item_key', unlock.item_key,
        'display_name', coalesce(
          catalog.display_name,
          initcap(replace(unlock.item_key, '_', ' '))
        ),
        'item_type', unlock.item_type,
        'rarity', unlock.rarity,
        'character_class', catalog.character_class,
        'weapon_name', catalog.weapon_name,
        'weapon_score_bonus', catalog.weapon_score_bonus,
        'unlocked_at', unlock.unlocked_at
      ) order by unlock.item_type, unlock.unlocked_at, unlock.item_key)
      from public.player_unlocks unlock
      left join public.extraction_catalog catalog
        on catalog.item_key = unlock.item_key
      where unlock.user_id = users.id
    ), '[]'::jsonb),
    'devices', coalesce((
      select jsonb_agg(jsonb_build_object(
        'device_id', device.id,
        'token_hint', device.token_hint,
        'label', device.label,
        'first_seen_at', link.first_seen_at,
        'last_seen_at', link.last_seen_at,
        'device_banned', app_private.has_active_ban(
          users.id, 'device', device.id
        )
      ) order by link.last_seen_at desc, device.id)
      from public.player_device_links link
      join public.player_devices device on device.id = link.device_id
      where link.user_id = users.id
    ), '[]'::jsonb)
  ) into v_result
  from auth.users users
  left join public.player_profiles profile on profile.user_id = users.id
  left join public.player_stats stats on stats.user_id = users.id
  left join public.player_loadouts loadout on loadout.user_id = users.id
  where users.id = p_user_id;

  return v_result;
end;
$$;

drop function if exists public.admin_get_player_record(uuid);

create or replace function public.admin_get_player_record(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  if p_user_id is null or not exists (
    select 1 from auth.users users where users.id = p_user_id
  ) then
    raise exception 'Player not found';
  end if;

  select jsonb_build_object(
    'bans', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ban.id,
        'scope', ban.scope,
        'device_id', ban.target_device_id,
        'starts_at', ban.starts_at,
        'expires_at', ban.expires_at,
        'reason', ban.reason,
        'created_at', ban.created_at,
        'active', ban.revoked_at is null
          and ban.starts_at <= now()
          and (ban.expires_at is null or ban.expires_at > now()),
        'created_by_user_id', ban.created_by,
        'created_by_email', lower(created_actor.email),
        'created_by_username', created_profile.username,
        'created_by_role', (
          select admin.role
          from public.admin_users admin
          where admin.user_id = ban.created_by
             or (
               admin.user_id is null
               and admin.email = lower(created_actor.email)
             )
          order by (admin.user_id = ban.created_by) desc
          limit 1
        ),
        'revoked_at', ban.revoked_at,
        'revoked_reason', ban.revoked_reason,
        'revoked_by_user_id', ban.revoked_by,
        'revoked_by_email', lower(revoked_actor.email),
        'revoked_by_username', revoked_profile.username,
        'revoked_by_role', (
          select admin.role
          from public.admin_users admin
          where admin.user_id = ban.revoked_by
             or (
               admin.user_id is null
               and admin.email = lower(revoked_actor.email)
             )
          order by (admin.user_id = ban.revoked_by) desc
          limit 1
        )
      ) order by ban.created_at desc)
      from public.player_bans ban
      left join auth.users created_actor on created_actor.id = ban.created_by
      left join public.player_profiles created_profile
        on created_profile.user_id = ban.created_by
      left join auth.users revoked_actor on revoked_actor.id = ban.revoked_by
      left join public.player_profiles revoked_profile
        on revoked_profile.user_id = ban.revoked_by
      where ban.target_user_id = p_user_id
         or exists (
           select 1
           from public.player_device_links link
           where link.user_id = p_user_id
             and link.device_id = ban.target_device_id
         )
    ), '[]'::jsonb),
    'commands', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', audit.id,
        'action', audit.action,
        'command_text', audit.command_text,
        'succeeded', audit.succeeded,
        'error_message', audit.error_message,
        'created_at', audit.created_at,
        'actor_user_id', audit.actor_user_id,
        'actor_email', audit.actor_email,
        'actor_username', actor_profile.username,
        'actor_role', (
          select admin.role
          from public.admin_users admin
          where admin.user_id = audit.actor_user_id
             or (
               admin.user_id is null
               and admin.email = lower(audit.actor_email)
             )
          order by (admin.user_id = audit.actor_user_id) desc
          limit 1
        )
      ) order by audit.created_at desc)
      from public.admin_command_audit audit
      left join public.player_profiles actor_profile
        on actor_profile.user_id = audit.actor_user_id
      where audit.target_user_id = p_user_id
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.admin_get_player_record(uuid)
  from public, anon;
grant execute on function public.admin_get_player_record(uuid)
  to authenticated;

-- Recreate, rather than replace, so the exact named-argument surface is
-- guaranteed even if a stale live function used different parameter names.
drop function if exists public.admin_unban_player(uuid, text, text);

create function public.admin_unban_player(
  p_target_user_id uuid,
  p_reason text default null,
  p_command_text text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_email text;
  v_reason text := coalesce(
    nullif(trim(p_reason), ''), 'Issued from admin player editor'
  );
  v_revoked_count integer := 0;
  v_revoked_ban_ids jsonb := '[]'::jsonb;
  v_result jsonb;
begin
  if not public.is_main_admin() then
    raise exception 'Only main admins can run player commands'
      using errcode = '42501';
  end if;
  if p_target_user_id is null or not exists (
    select 1 from auth.users users where users.id = p_target_user_id
  ) then
    raise exception 'Player not found' using errcode = 'P0002';
  end if;
  if char_length(v_reason) > 500 then
    raise exception 'Reason must be 500 characters or fewer'
      using errcode = '22023';
  end if;

  select lower(users.email)::text into v_actor_email
  from auth.users users where users.id = v_actor;

  with revoked as (
    update public.player_bans ban
    set revoked_at = now(), revoked_by = v_actor, revoked_reason = v_reason
    where ban.revoked_at is null
      and ban.starts_at <= now()
      and (ban.expires_at is null or ban.expires_at > now())
      and (
        ban.target_user_id = p_target_user_id
        or exists (
          select 1 from public.player_device_links link
          where link.user_id = p_target_user_id
            and link.device_id = ban.target_device_id
        )
      )
    returning ban.id
  )
  select count(*)::integer,
         coalesce(jsonb_agg(revoked.id order by revoked.id), '[]'::jsonb)
  into v_revoked_count, v_revoked_ban_ids
  from revoked;

  v_result := jsonb_build_object(
    'ok', true,
    'action', 'unban',
    'target_user_id', p_target_user_id,
    'revoked_count', v_revoked_count,
    'revoked_ban_ids', v_revoked_ban_ids
  );

  insert into public.admin_command_audit(
    actor_user_id, actor_email, target_user_id, action, command_text,
    request, result, succeeded, created_at
  ) values (
    v_actor, coalesce(v_actor_email, ''), p_target_user_id, 'unban',
    nullif(left(coalesce(p_command_text, ''), 1000), ''),
    jsonb_build_object(
      'target_user_id', p_target_user_id,
      'mode', 'all_active_bans_for_player',
      'reason', v_reason
    ),
    v_result, true, now()
  );

  return v_result;
end;
$$;

revoke all on function public.admin_get_player(uuid)
  from public, anon, authenticated;
revoke all on function public.admin_get_player_record(uuid)
  from public, anon, authenticated;
revoke all on function public.admin_unban_player(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.admin_get_player(uuid) to authenticated;
grant execute on function public.admin_get_player_record(uuid) to authenticated;
grant execute on function public.admin_unban_player(uuid, text, text)
  to authenticated;

comment on function public.admin_get_player(uuid) is
  'Admin 03: role-checked account, inventory, stats, loadout, and device lookup. Shop receipts are intentionally excluded.';
comment on function public.admin_get_player_record(uuid) is
  'Admin 03: role-checked ban and command history for one player.';
comment on function public.admin_unban_player(uuid, text, text) is
  'Admin 03: main-admin-only idempotent revocation of all active bans attached to one player.';

-- -------------------------------------------------------------------------
-- Final immutable-ID authorization and least-privilege hardening
-- -------------------------------------------------------------------------

-- Link any legacy email-only admin row once, then authorize strictly by the
-- immutable Auth user ID. Email is only display/lookup metadata after this.
update public.admin_users admin
set user_id = users.id,
    email = lower(users.email)
from auth.users users
where users.email is not null
  and lower(users.email) = lower(admin.email)
  and (admin.user_id is null or admin.user_id = users.id);

create unique index if not exists admin_users_user_id_uidx
  on public.admin_users(user_id)
  where user_id is not null;

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

alter table public.admin_users enable row level security;
alter table public.player_devices enable row level security;
alter table public.player_device_links enable row level security;
alter table public.player_bans enable row level security;
alter table public.admin_command_audit enable row level security;

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

revoke all on function public.is_admin()
  from public, anon, authenticated;
revoke all on function public.is_main_admin()
  from public, anon, authenticated;
revoke all on function public.get_admin_role()
  from public, anon, authenticated;
revoke all on function public.admin_player_search(text, integer)
  from public, anon, authenticated;
revoke all on function public.admin_get_player(uuid)
  from public, anon, authenticated;
revoke all on function public.admin_command_suggestions(text, text, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.admin_execute_player_command(
  text, uuid, text, text, text, bigint, text[], uuid, bigint, boolean,
  bigint, text, text
) from public, anon, authenticated;
revoke all on function public.admin_get_command_audit(uuid, integer)
  from public, anon, authenticated;
revoke all on function public.admin_get_player_record(uuid)
  from public, anon, authenticated;
revoke all on function public.admin_unban_player(uuid, text, text)
  from public, anon, authenticated;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_main_admin() to authenticated;
grant execute on function public.get_admin_role() to authenticated;
grant execute on function public.admin_player_search(text, integer)
  to authenticated;
grant execute on function public.admin_get_player(uuid)
  to authenticated;
grant execute on function public.admin_command_suggestions(text, text, uuid, integer)
  to authenticated;
grant execute on function public.admin_execute_player_command(
  text, uuid, text, text, text, bigint, text[], uuid, bigint, boolean,
  bigint, text, text
) to authenticated;
grant execute on function public.admin_get_command_audit(uuid, integer)
  to authenticated;
grant execute on function public.admin_get_player_record(uuid)
  to authenticated;
grant execute on function public.admin_unban_player(uuid, text, text)
  to authenticated;

comment on table public.player_devices is
  'Admin 03 Player Lookup and Commands: opaque app-device identities used for account/device moderation.';
comment on table public.player_device_links is
  'Admin 03 Player Lookup and Commands: server-only links between accounts and opaque app devices.';
comment on table public.player_bans is
  'Admin 03 Player Lookup and Commands: account, device, and leaderboard moderation records.';
comment on table public.admin_command_audit is
  'Admin 03 Player Lookup and Commands: append-only audit of typed player-editor commands.';
comment on function public.register_player_device(text, text) is
  'Admin 03: registers an opaque browser-profile device and returns active access restrictions.';
comment on function public.check_player_device(text) is
  'Admin 03: checks guest device access without exposing the raw token.';
comment on function public.admin_player_search(text, integer) is
  'Admin 03: role-checked player search by username, email, or exact user ID.';
comment on function public.admin_get_player(uuid) is
  'Admin 03: role-checked account, inventory, stats, loadout, and device lookup. Shop receipts are intentionally excluded.';
comment on function public.admin_command_suggestions(text, text, uuid, integer) is
  'Admin 03: role-checked command, catalog-item, and player suggestions.';
comment on function public.admin_execute_player_command(
  text, uuid, text, text, text, bigint, text[], uuid, bigint, boolean,
  bigint, text, text
) is
  'Admin 03: main-admin-only typed inventory, stat, and ban command executor.';
comment on function public.admin_get_command_audit(uuid, integer) is
  'Admin 03: main-admin-only command audit reader.';
comment on function public.admin_get_player_record(uuid) is
  'Admin 03: role-checked ban and command history for one player.';
comment on function public.admin_unban_player(uuid, text, text) is
  'Admin 03: main-admin-only idempotent revocation of every active ban attached to one player.';

notify pgrst, 'reload schema';

-- Fail atomically if the merged Admin 03 surface or its security contract is
-- incomplete. These checks do not expose player data.
do $$
declare
  v_signature text;
  v_oid oid;
begin
  foreach v_signature in array array[
    'public.register_player_device(text,text)',
    'public.check_player_device(text)',
    'public.admin_player_search(text,integer)',
    'public.admin_get_player(uuid)',
    'public.admin_command_suggestions(text,text,uuid,integer)',
    'public.admin_execute_player_command(text,uuid,text,text,text,bigint,text[],uuid,bigint,boolean,bigint,text,text)',
    'public.admin_get_command_audit(uuid,integer)',
    'public.admin_get_player_record(uuid)',
    'public.admin_unban_player(uuid,text,text)'
  ]
  loop
    v_oid := to_regprocedure(v_signature);
    if v_oid is null or not exists (
      select 1
      from pg_proc procedure
      where procedure.oid = v_oid
        and procedure.prosecdef
        and exists (
          select 1
          from unnest(coalesce(procedure.proconfig, array[]::text[])) setting
          where setting like 'search_path=%'
            and setting not like '%public%'
        )
    ) then
      raise exception 'Missing or unsafe Admin 03 function: %', v_signature;
    end if;
  end loop;

  v_oid := to_regprocedure('public.admin_unban_player(uuid,text,text)');
  if not exists (
    select 1
    from pg_proc procedure
    where procedure.oid = v_oid
      and procedure.proargnames = array[
        'p_target_user_id', 'p_reason', 'p_command_text'
      ]::text[]
  ) then
    raise exception 'admin_unban_player named arguments are incorrect';
  end if;

  if position(
    'extraction_transactions' in lower(
      pg_get_functiondef(to_regprocedure('public.admin_get_player(uuid)'))
    )
  ) > 0
     or position(
       '''extractions''' in lower(
         pg_get_functiondef(to_regprocedure('public.admin_get_player(uuid)'))
       )
     ) > 0 then
    raise exception 'admin_get_player still exposes shop receipts';
  end if;

  if position(
    'auth.jwt' in lower(
      pg_get_functiondef(to_regprocedure('public.is_admin()'))
    )
  ) > 0
     or position(
       'auth.jwt' in lower(
         pg_get_functiondef(to_regprocedure('public.is_main_admin()'))
       )
     ) > 0 then
    raise exception 'Admin authorization still trusts mutable JWT email';
  end if;

  if has_table_privilege('authenticated', 'public.admin_users', 'SELECT')
     or has_table_privilege('authenticated', 'public.player_devices', 'SELECT')
     or has_table_privilege('authenticated', 'public.player_device_links', 'SELECT')
     or has_table_privilege('authenticated', 'public.player_bans', 'SELECT')
     or has_table_privilege('authenticated', 'public.admin_command_audit', 'SELECT') then
    raise exception 'A private Admin 03 table is directly readable';
  end if;

  if has_function_privilege(
       'anon', 'public.admin_player_search(text,integer)', 'EXECUTE'
     )
     or has_function_privilege(
       'anon', 'public.admin_get_player(uuid)', 'EXECUTE'
     )
     or has_function_privilege(
       'anon', 'public.admin_command_suggestions(text,text,uuid,integer)', 'EXECUTE'
     )
     or has_function_privilege(
       'anon', 'public.admin_execute_player_command(text,uuid,text,text,text,bigint,text[],uuid,bigint,boolean,bigint,text,text)', 'EXECUTE'
     )
     or has_function_privilege(
       'anon', 'public.admin_get_player_record(uuid)', 'EXECUTE'
     )
     or has_function_privilege(
       'anon', 'public.admin_unban_player(uuid,text,text)', 'EXECUTE'
     ) then
    raise exception 'Anonymous role can execute an Admin 03 endpoint';
  end if;
end
$$;

commit;

select
  to_regprocedure('public.admin_player_search(text,integer)') is not null
    as player_search_installed,
  to_regprocedure('public.admin_get_player(uuid)') is not null
    as receipt_free_player_lookup_installed,
  to_regprocedure(
    'public.admin_command_suggestions(text,text,uuid,integer)'
  ) is not null as command_suggestions_installed,
  to_regprocedure(
    'public.admin_execute_player_command(text,uuid,text,text,text,bigint,text[],uuid,bigint,boolean,bigint,text,text)'
  ) is not null as command_executor_installed,
  to_regprocedure('public.admin_get_player_record(uuid)') is not null
    as moderation_record_installed,
  to_regprocedure('public.admin_unban_player(uuid,text,text)') is not null
    as username_unban_installed,
  not has_function_privilege(
    'anon', 'public.admin_get_player(uuid)', 'EXECUTE'
  ) as anonymous_lookup_blocked,
  not has_table_privilege(
    'authenticated', 'public.admin_command_audit', 'SELECT'
  ) as direct_audit_reads_blocked,
  position(
    'extraction_transactions' in lower(
      pg_get_functiondef(to_regprocedure('public.admin_get_player(uuid)'))
    )
  ) = 0 as shop_receipts_excluded;
