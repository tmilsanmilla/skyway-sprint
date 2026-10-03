-- Run after provisioning the Neon Data API with --skip-auth-schema.

begin;

do $bootstrap$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    raise exception 'Neon Data API authenticated role is missing';
  end if;

  if not exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'create role anon nologin noinherit';
  end if;
end
$bootstrap$;

-- Vercel uses one deliberately narrow, non-login role for operations that
-- cannot safely be exposed through the browser Data API.
do $server_role$
begin
  if not exists (
    select 1 from pg_roles where rolname = 'skyway_server_api'
  ) then
    create role skyway_server_api nologin noinherit nosuperuser nobypassrls;
  end if;
end
$server_role$;

create schema if not exists app_private;

create table if not exists app_private.realtime_ticket_rate_limits (
  user_id uuid primary key,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0
    check (request_count between 0 and 1000)
);

revoke all on table app_private.realtime_ticket_rate_limits
  from public, anon, anonymous, authenticated;

-- Shared by the account and realtime bootstrap routes before either route asks
-- managed Neon Auth to verify its secure session cookie. Only an HMAC of Vercel's trusted
-- client-address header is stored; raw network addresses never reach Neon.
create table if not exists app_private.pre_auth_network_rate_limits (
  bucket_key text primary key
    check (bucket_key ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0
    check (request_count between 0 and 1000000)
);

create index if not exists pre_auth_network_rate_limits_window_idx
  on app_private.pre_auth_network_rate_limits(window_started_at);

revoke all on table app_private.pre_auth_network_rate_limits
  from public, anon, anonymous, authenticated;

create table if not exists app_private.guest_access_rate_limits (
  bucket_key text primary key,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0
    check (request_count between 0 and 1000000),
  check (bucket_key ~ '^(network|device):[0-9a-f]{64}$')
);

create index if not exists guest_access_rate_limits_window_idx
  on app_private.guest_access_rate_limits(window_started_at);

revoke all on table app_private.guest_access_rate_limits
  from public, anon, anonymous, authenticated;

drop function if exists app_private.check_guest_device(text);

create or replace function app_private.check_guest_device(
  p_device_token text,
  p_network_bucket text,
  p_device_bucket text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_network_count integer;
  v_device_count integer;
  v_now timestamptz := clock_timestamp();
begin
  if p_device_token is null
     or p_device_token !~ '^[A-Za-z0-9._~+/=-]{24,128}$'
     or p_network_bucket is null
     or p_network_bucket !~ '^[0-9a-f]{64}$'
     or p_device_bucket is null
     or p_device_bucket !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid guest access request';
  end if;

  -- Keep the server-only bucket table proportional to recent traffic. Rotating
  -- device tokens must not create durable rows forever, and one request must
  -- never perform an unbounded cleanup that can stall the guest endpoint.
  with stale_buckets as (
    select rate_limit.ctid
    from app_private.guest_access_rate_limits rate_limit
    where rate_limit.window_started_at <= v_now - interval '5 minutes'
    order by rate_limit.window_started_at
    limit 64
    for update skip locked
  )
  delete from app_private.guest_access_rate_limits rate_limit
  using stale_buckets
  where rate_limit.ctid = stale_buckets.ctid;

  -- The network bucket is checked first, which prevents rotating fake device
  -- tokens from creating an unbounded number of rows behind one address.
  insert into app_private.guest_access_rate_limits(
    bucket_key,
    window_started_at,
    request_count
  ) values ('network:' || p_network_bucket, v_now, 1)
  on conflict (bucket_key) do update
  set window_started_at = case
        when app_private.guest_access_rate_limits.window_started_at
             <= v_now - interval '1 minute'
          then v_now
        else app_private.guest_access_rate_limits.window_started_at
      end,
      request_count = case
        when app_private.guest_access_rate_limits.window_started_at
             <= v_now - interval '1 minute'
          then 1
        else least(
          1000000,
          app_private.guest_access_rate_limits.request_count + 1
        )
      end
  returning request_count into v_network_count;

  if v_network_count > 120 then
    return jsonb_build_object('rate_limited', true, 'access', null);
  end if;

  insert into app_private.guest_access_rate_limits(
    bucket_key,
    window_started_at,
    request_count
  ) values ('device:' || p_device_bucket, v_now, 1)
  on conflict (bucket_key) do update
  set window_started_at = case
        when app_private.guest_access_rate_limits.window_started_at
             <= v_now - interval '1 minute'
          then v_now
        else app_private.guest_access_rate_limits.window_started_at
      end,
      request_count = case
        when app_private.guest_access_rate_limits.window_started_at
             <= v_now - interval '1 minute'
          then 1
        else least(
          1000000,
          app_private.guest_access_rate_limits.request_count + 1
        )
      end
  returning request_count into v_device_count;

  if v_device_count > 12 then
    return jsonb_build_object('rate_limited', true, 'access', null);
  end if;

  return jsonb_build_object(
    'rate_limited', false,
    'access', public.check_player_device(p_device_token)
  );
end;
$$;

drop function if exists app_private.consume_realtime_ticket_quota(uuid);

create or replace function app_private.consume_pre_auth_network_quota(
  p_network_bucket text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_now timestamptz := clock_timestamp();
begin
  if p_network_bucket is null
     or p_network_bucket !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid pre-auth network bucket';
  end if;

  -- Retain only a short traffic window. Cleanup work is capped so a single
  -- request can never turn accumulated rate-limit state into an unbounded scan
  -- or delete, while the index keeps the candidate lookup bounded.
  with stale_buckets as (
    select rate_limit.ctid
    from app_private.pre_auth_network_rate_limits rate_limit
    where rate_limit.window_started_at <= v_now - interval '5 minutes'
    order by rate_limit.window_started_at
    limit 64
    for update skip locked
  )
  delete from app_private.pre_auth_network_rate_limits rate_limit
  using stale_buckets
  where rate_limit.ctid = stale_buckets.ctid;

  insert into app_private.pre_auth_network_rate_limits(
    bucket_key,
    window_started_at,
    request_count
  ) values (p_network_bucket, v_now, 1)
  on conflict (bucket_key) do update
  set window_started_at = case
        when app_private.pre_auth_network_rate_limits.window_started_at
             <= v_now - interval '1 minute'
          then v_now
        else app_private.pre_auth_network_rate_limits.window_started_at
      end,
      request_count = case
        when app_private.pre_auth_network_rate_limits.window_started_at
             <= v_now - interval '1 minute'
          then 1
        else least(
          1000000,
          app_private.pre_auth_network_rate_limits.request_count + 1
        )
      end
  returning request_count into v_count;

  return v_count <= 120;
end;
$$;

create or replace function app_private.authorize_realtime_ticket(
  p_user_id uuid,
  p_match_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_slot integer;
  v_status text;
  v_count integer;
begin
  if p_user_id is null or p_match_id is null then
    return jsonb_build_object('allowed', false, 'reason', 'not_found');
  end if;

  insert into app_private.realtime_ticket_rate_limits(
    user_id,
    window_started_at,
    request_count
  ) values (p_user_id, now(), 1)
  on conflict (user_id) do update
  set window_started_at = case
        when app_private.realtime_ticket_rate_limits.window_started_at
             <= now() - interval '1 minute'
          then now()
        else app_private.realtime_ticket_rate_limits.window_started_at
      end,
      request_count = case
        when app_private.realtime_ticket_rate_limits.window_started_at
             <= now() - interval '1 minute'
          then 1
        else least(
          1000,
          app_private.realtime_ticket_rate_limits.request_count + 1
        )
      end
  returning request_count into v_count;

  if v_count > 10 then
    return jsonb_build_object('allowed', false, 'reason', 'rate_limited');
  end if;

  select player.slot, match.status
  into v_slot, v_status
  from public.multiplayer_matches match
  join public.multiplayer_players player on player.match_id = match.id
  where match.id = p_match_id and player.user_id = p_user_id;

  if not found or v_slot is null or v_slot not in (1, 2) then
    return jsonb_build_object('allowed', false, 'reason', 'not_found');
  end if;
  if v_status is null
     or v_status not in ('countdown', 'playing', 'intermission') then
    return jsonb_build_object('allowed', false, 'reason', 'inactive');
  end if;

  return jsonb_build_object(
    'allowed', true,
    'slot', v_slot,
    'status', v_status
  );
end;
$$;

drop function if exists public.sync_current_identity();
do $browser_device_check$
begin
  if to_regprocedure('public.check_player_device(text)') is not null then
    revoke all on function public.check_player_device(text)
      from public, anon, anonymous, authenticated;
  end if;
end
$browser_device_check$;

-- The browser calls this SECURITY DEFINER function immediately after managed
-- Neon Auth succeeds. Keep unauthenticated roles out while allowing the
-- authenticated JWT role to perform the account/device access check.
do $player_device_registration$
begin
  if to_regprocedure('public.register_player_device(text,text)') is null then
    raise exception 'Player device registration function is missing';
  end if;
end
$player_device_registration$;
revoke all on function public.register_player_device(text, text)
  from public, anon, anonymous;
grant execute on function public.register_player_device(text, text)
  to authenticated;

revoke all on schema app_private from public, anon, anonymous, authenticated;
grant usage on schema app_private to skyway_server_api;
revoke all on function app_private.check_guest_device(text, text, text)
  from public, anon, anonymous, authenticated;
revoke all on function app_private.consume_pre_auth_network_quota(text)
  from public, anon, anonymous, authenticated;
revoke all on function app_private.authorize_realtime_ticket(uuid, uuid)
  from public, anon, anonymous, authenticated;
grant execute on function app_private.check_guest_device(text, text, text)
  to skyway_server_api;
grant execute on function app_private.consume_pre_auth_network_quota(text)
  to skyway_server_api;
grant execute on function app_private.authorize_realtime_ticket(uuid, uuid)
  to skyway_server_api;

commit;
