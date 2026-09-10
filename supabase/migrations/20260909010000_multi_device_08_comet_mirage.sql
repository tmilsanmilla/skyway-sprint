-- Multi-device 08 -- server-owned Comet HEATFEAST and Mirage invasion.
--
-- Forward-only and rerunnable.  No client can write either ability ledger.
-- Every balance, lane, cooldown, and damage decision below is derived from the
-- authenticated participant's immutable match character snapshot.

begin;

do $ability_assertions$
begin
  if to_regclass('public.multiplayer_matches') is null
     or to_regclass('public.multiplayer_players') is null
     or to_regclass('public.multiplayer_attacks') is null
     or to_regprocedure(
       'app_private.next_1v1_attack_placement(uuid,uuid,uuid,text)'
     ) is null
     or to_regprocedure(
       'app_private.mark_1v1_eliminated(uuid,uuid,timestamptz)'
     ) is null
     or to_regprocedure(
       'app_private.finalize_1v1_after_second_death(uuid,timestamptz)'
     ) is null
     or to_regprocedure(
       'app_private.one_v_one_attack_point_multiplier(text,integer,numeric,numeric,integer,integer,timestamptz,timestamptz,timestamptz)'
     ) is null then
    raise exception 'Run the current Multi-device 01 / MAPS MISC query first';
  end if;
end;
$ability_assertions$;

-- HEATFEAST belongs to the match, not a device or one Comet.  Spending by
-- either player is added when at least one snapshotted participant is Comet.
create table if not exists public.multiplayer_heatfeast (
  match_id uuid primary key
    references public.multiplayer_matches(id) on delete cascade,
  stored numeric(16,4) not null default 0,
  consumed numeric(16,4) not null default 0,
  updated_at timestamptz not null default now(),
  constraint multiplayer_heatfeast_stored_check
    check (stored >= 0),
  constraint multiplayer_heatfeast_consumed_check
    check (consumed >= 0)
);

create table if not exists public.multiplayer_heatfeast_wave_usage (
  match_id uuid not null,
  user_id uuid not null,
  wave integer not null,
  consumed numeric(16,4) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (match_id, user_id, wave),
  foreign key (match_id, user_id)
    references public.multiplayer_players(match_id, user_id)
    on delete cascade,
  constraint multiplayer_heatfeast_wave_usage_wave_check
    check (wave >= 1),
  constraint multiplayer_heatfeast_wave_usage_consumed_check
    check (consumed between 0 and 100)
);

-- A removal purchase creates one durable token for one natural obstacle in
-- the upcoming wave. The browser acknowledges the exact token it used, so a
-- reconnect cannot replay one paid removal forever. These receipts never
-- permit deleting opponent-sent multiplayer_attacks rows.
create table if not exists public.multiplayer_comet_removals (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null,
  user_id uuid not null,
  purchase_id text not null,
  obstacle_type text not null,
  point_cost integer not null,
  spawn_wave integer not null,
  obstacle_id text,
  created_at timestamptz not null default now(),
  redeemed_at timestamptz,
  foreign key (match_id, user_id)
    references public.multiplayer_players(match_id, user_id)
    on delete cascade,
  unique (match_id, user_id, purchase_id),
  constraint multiplayer_comet_removals_purchase_id_check
    check (length(btrim(purchase_id)) between 1 and 160),
  constraint multiplayer_comet_removals_obstacle_type_check
    check (obstacle_type in (
      'barrel', 'log', 'snowflake', 'car', 'spike', 'rock'
    )),
  constraint multiplayer_comet_removals_point_cost_check
    check (point_cost between 1 and 8),
  constraint multiplayer_comet_removals_spawn_wave_check
    check (spawn_wave >= 1),
  constraint multiplayer_comet_removals_obstacle_id_check
    check (
      obstacle_id is null
      or length(btrim(obstacle_id)) between 1 and 160
    ),
  constraint multiplayer_comet_removals_redemption_check
    check (
      (redeemed_at is null and obstacle_id is null)
      or (redeemed_at is not null and obstacle_id is not null)
  )
);

create table if not exists public.multiplayer_heatfeast_tax_events (
  match_id uuid not null,
  comet_user_id uuid not null,
  opponent_user_id uuid not null,
  wave integer not null,
  amount numeric(16,4) not null,
  created_at timestamptz not null default now(),
  primary key (match_id, comet_user_id, wave),
  foreign key (match_id, comet_user_id)
    references public.multiplayer_players(match_id, user_id)
    on delete cascade,
  foreign key (match_id, opponent_user_id)
    references public.multiplayer_players(match_id, user_id)
    on delete cascade,
  constraint multiplayer_heatfeast_tax_players_check
    check (comet_user_id <> opponent_user_id),
  constraint multiplayer_heatfeast_tax_wave_check
    check (wave >= 1),
  constraint multiplayer_heatfeast_tax_amount_check
    check (amount >= 0)
);

create table if not exists public.multiplayer_heatfeast_split_state (
  match_id uuid not null,
  comet_user_id uuid not null,
  wave integer not null,
  incoming_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (match_id, comet_user_id, wave),
  foreign key (match_id, comet_user_id)
    references public.multiplayer_players(match_id, user_id)
    on delete cascade,
  constraint multiplayer_heatfeast_split_wave_check
    check (wave >= 1),
  constraint multiplayer_heatfeast_split_count_check
    check (incoming_count >= 0)
);

create index if not exists multiplayer_comet_removals_pending_idx
  on public.multiplayer_comet_removals(match_id, user_id, spawn_wave)
  where redeemed_at is null;

alter table public.multiplayer_heatfeast enable row level security;
alter table public.multiplayer_heatfeast force row level security;
alter table public.multiplayer_heatfeast_wave_usage enable row level security;
alter table public.multiplayer_heatfeast_wave_usage force row level security;
alter table public.multiplayer_comet_removals enable row level security;
alter table public.multiplayer_comet_removals force row level security;
alter table public.multiplayer_heatfeast_tax_events enable row level security;
alter table public.multiplayer_heatfeast_tax_events force row level security;
alter table public.multiplayer_heatfeast_split_state enable row level security;
alter table public.multiplayer_heatfeast_split_state force row level security;
revoke all on table public.multiplayer_heatfeast
  from public, anon, authenticated;
revoke all on table public.multiplayer_heatfeast_wave_usage
  from public, anon, authenticated;
revoke all on table public.multiplayer_comet_removals
  from public, anon, authenticated;
revoke all on table public.multiplayer_heatfeast_tax_events
  from public, anon, authenticated;
revoke all on table public.multiplayer_heatfeast_split_state
  from public, anon, authenticated;

comment on table public.multiplayer_heatfeast is
  'Private match-shared HEATFEAST balance. Only authenticated ability RPCs may mutate it.';
comment on table public.multiplayer_heatfeast_wave_usage is
  'Private per-Comet, per-wave receipts enforcing the 100 HEATFEAST consumption ceiling.';
comment on table public.multiplayer_comet_removals is
  'Private idempotent receipts for Comet removal of natural, never opponent-sent, obstacles.';
comment on table public.multiplayer_heatfeast_tax_events is
  'Private one-per-Comet-per-wave receipts for the 250 HEATFEAST intermission tax.';
comment on table public.multiplayer_heatfeast_split_state is
  'Private deterministic odd/even allocator for returning half of opponent-sent attacks at 1000 HEATFEAST.';

create or replace function app_private.one_v_one_heatfeast_json(
  p_match_id uuid,
  p_user_id uuid,
  p_wave integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_stored numeric := 0;
  v_consumed numeric := 0;
  v_this_wave numeric := 0;
begin
  select ledger.stored, ledger.consumed
  into v_stored, v_consumed
  from public.multiplayer_heatfeast ledger
  where ledger.match_id = p_match_id;
  select usage.consumed into v_this_wave
  from public.multiplayer_heatfeast_wave_usage usage
  where usage.match_id = p_match_id
    and usage.user_id = p_user_id
    and usage.wave = greatest(1, coalesce(p_wave, 1));
  v_stored := coalesce(v_stored, 0);
  v_consumed := coalesce(v_consumed, 0);
  v_this_wave := coalesce(v_this_wave, 0);
  return jsonb_build_object(
    'stored', v_stored,
    'consumed', v_consumed,
    'tracked_wave', greatest(1, coalesce(p_wave, 1)),
    'consumed_this_wave', v_this_wave,
    'remaining_this_wave', greatest(0, 100 - v_this_wave),
    'attack_coin_multiplier', case when v_consumed >= 50 then 1.2 else 1 end,
    'self_damage_multiplier', case when v_consumed >= 100 then 0.75 else 1 end,
    'opponent_damage_multiplier', case when v_consumed >= 100 then 1.25 else 1 end,
    'opponent_coin_tax_fraction', case when v_consumed >= 250 then 0.10 else 0 end,
    'natural_removal_price_multiplier', case when v_consumed >= 500 then 0.5 else 1 end,
    'sent_obstacle_price_multiplier', case when v_consumed >= 750 then 0.5 else 1 end,
    'split_opponent_sent_obstacles', v_consumed >= 1000
  );
end;
$$;

revoke all on function app_private.one_v_one_heatfeast_json(
  uuid, uuid, integer
) from public, anon, authenticated;

-- Star Spear's static 1.5 multiplier is already part of the base character
-- helper. The match-aware overload adds the shared 1.2 threshold only after
-- 50 HEATFEAST has actually been consumed in the private ledger.
create or replace function app_private.one_v_one_attack_point_multiplier(
  p_match_id uuid,
  p_user_id uuid,
  p_character_key text,
  p_wave integer,
  p_hearts numeric,
  p_max_hearts numeric,
  p_lane_index integer,
  p_lane_count integer,
  p_last_damage_at timestamptz,
  p_wave_started_at timestamptz,
  p_run_started_at timestamptz
)
returns numeric
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_multiplier numeric;
  v_gem_receipts bigint := 0;
  v_heat_consumed numeric := 0;
begin
  v_multiplier := app_private.one_v_one_attack_point_multiplier(
    p_character_key, p_wave, p_hearts, p_max_hearts, p_lane_index,
    p_lane_count, p_last_damage_at, p_wave_started_at, p_run_started_at
  );
  if p_character_key = 'runner_spark' then
    select count(*) into v_gem_receipts
    from public.player_progression_events event
    where event.user_id = p_user_id and event.source = 'gem'
      and event.metadata->>'context_id' = p_match_id::text;
    v_multiplier := v_multiplier * (1 + v_gem_receipts * 0.01);
  elsif p_character_key = 'runner_comet' then
    select coalesce(ledger.consumed, 0) into v_heat_consumed
    from public.multiplayer_heatfeast ledger
    where ledger.match_id = p_match_id;
    if coalesce(v_heat_consumed, 0) >= 50 then
      v_multiplier := v_multiplier * 1.2;
    end if;
  end if;
  return greatest(0.1, round(v_multiplier, 4));
end;
$$;

revoke all on function app_private.one_v_one_attack_point_multiplier(
  uuid, uuid, text, integer, numeric, numeric, integer, integer,
  timestamptz, timestamptz, timestamptz
) from public, anon, authenticated;

-- The public state heartbeat remains compatible with every shipped client,
-- while this private copy preserves the newest implementation installed by
-- MAPS MISC. On a rerun, do not accidentally copy this wrapper into itself.
do $heatfeast_state_delegate$
declare
  v_public regprocedure := to_regprocedure(
    'public.update_1v1_state(uuid,numeric,integer,bigint,text)'
  );
  v_definition text;
  v_private_definition text;
begin
  if v_public is null then
    raise exception 'The current update_1v1_state RPC is missing';
  end if;
  v_definition := pg_get_functiondef(v_public);
  if position(
       'app_private.update_1v1_state_unadjusted' in v_definition
     ) = 0 then
    v_private_definition := regexp_replace(
      v_definition,
      '^CREATE OR REPLACE FUNCTION public\.update_1v1_state\(',
      'CREATE OR REPLACE FUNCTION app_private.update_1v1_state_unadjusted(',
      'i'
    );
    if v_private_definition = v_definition then
      raise exception 'Could not preserve the current update_1v1_state RPC';
    end if;
    execute v_private_definition;
  elsif to_regprocedure(
          'app_private.update_1v1_state_unadjusted(uuid,numeric,integer,bigint,text)'
        ) is null then
    raise exception 'The HEATFEAST state delegate is missing';
  end if;
end;
$heatfeast_state_delegate$;

revoke all on function app_private.update_1v1_state_unadjusted(
  uuid, numeric, integer, bigint, text
) from public, anon, authenticated;

-- The browser still reports the raw post-collision heart total, as it did
-- before HEATFEAST. The database alone applies Comet's obstacle modifiers to
-- that loss. Fractional hearts remain exact and intentionally are not rounded.
create or replace function public.update_1v1_state(
  p_match_id uuid,
  p_hearts numeric,
  p_wave integer,
  p_score bigint,
  p_status text default 'playing'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_match public.multiplayer_matches;
  v_self public.multiplayer_players;
  v_opponent public.multiplayer_players;
  v_heat_consumed numeric := 0;
  v_damage numeric;
  v_damage_multiplier numeric := 1;
  v_effective_hearts numeric := p_hearts;
  v_effective_status text := p_status;
begin
  if v_uid is not null then
    select * into v_match
    from public.multiplayer_matches match_row
    where match_row.id = p_match_id
    for update;
    perform 1
    from public.multiplayer_players player
    where player.match_id = p_match_id
    order by player.slot
    for update;
    select * into v_self
    from public.multiplayer_players player
    where player.match_id = p_match_id and player.user_id = v_uid;
    select * into v_opponent
    from public.multiplayer_players player
    where player.match_id = p_match_id and player.user_id <> v_uid
    limit 1;
  end if;

  if v_match.status = 'playing'
     and v_self.status = 'playing'
     and p_hearts is not null
     and p_hearts < v_self.hearts then
    select coalesce(ledger.consumed, 0)
    into v_heat_consumed
    from public.multiplayer_heatfeast ledger
    where ledger.match_id = p_match_id;
    if coalesce(v_heat_consumed, 0) >= 100 then
      if v_self.character_key = 'runner_comet' then
        v_damage_multiplier := v_damage_multiplier * 0.75;
      end if;
      if v_opponent.character_key = 'runner_comet' then
        v_damage_multiplier := v_damage_multiplier * 1.25;
      end if;
      v_damage := v_self.hearts - p_hearts;
      v_effective_hearts := greatest(
        0,
        v_self.hearts - v_damage * v_damage_multiplier
      );
      if v_effective_hearts > 0 and v_effective_status = 'eliminated' then
        v_effective_status := 'playing';
      end if;
    end if;
  end if;

  return app_private.update_1v1_state_unadjusted(
    p_match_id,
    v_effective_hearts,
    p_wave,
    p_score,
    v_effective_status
  );
end;
$$;

revoke all on function public.update_1v1_state(
  uuid, numeric, integer, bigint, text
) from public, anon, authenticated;
grant execute on function public.update_1v1_state(
  uuid, numeric, integer, bigint, text
) to authenticated;

-- Internal balance transfers must not be mistaken for coin pickups by the
-- general character multiplier trigger. Only this transaction-local flag can
-- bypass that trigger; callers cannot set it through an exposed RPC.
create or replace function app_private.multiply_1v1_attack_point_award()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lane_count integer := 5;
  v_multiplier numeric := 1;
begin
  if current_setting(
       'app_private.skip_1v1_point_multiplier', true
     ) = 'on' then
    return new;
  end if;
  if new.obstacle_points <= old.obstacle_points then return new; end if;
  select coalesce(rules.lane_count, 5)
  into v_lane_count
  from public.multiplayer_matches match_row
  left join app_private.one_v_one_map_rules rules
    on rules.map_key = match_row.map_key
  where match_row.id = new.match_id;
  v_multiplier := app_private.one_v_one_attack_point_multiplier(
    new.match_id, new.user_id, new.character_key, new.wave, new.hearts,
    new.max_hearts, coalesce(new.lane_index, 0), v_lane_count,
    new.last_damage_at, new.wave_started_at, new.run_started_at
  );
  new.obstacle_points := old.obstacle_points
    + (new.obstacle_points - old.obstacle_points) * v_multiplier;
  return new;
end;
$$;

revoke all on function app_private.multiply_1v1_attack_point_award()
  from public, anon, authenticated;

-- Coin receipts are synchronized after the shared intermission begins. Tax
-- those later positive awards too, after the normal character multiplier, so
-- the whole balance earned for the wave receives exactly the same 10% tax.
create or replace function app_private.settle_1v1_heatfeast_income_tax()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match public.multiplayer_matches;
  v_opponent public.multiplayer_players;
  v_heat_consumed numeric := 0;
  v_tax numeric := 0;
  v_now timestamptz := clock_timestamp();
begin
  if current_setting(
       'app_private.skip_1v1_point_multiplier', true
     ) = 'on'
     or old.status <> 'intermission'
     or new.status <> 'intermission'
     or new.obstacle_points <= old.obstacle_points then
    return new;
  end if;
  select * into v_match
  from public.multiplayer_matches match_row
  where match_row.id = new.match_id;
  if v_match.status <> 'intermission' then return new; end if;
  select coalesce(ledger.consumed, 0)
  into v_heat_consumed
  from public.multiplayer_heatfeast ledger
  where ledger.match_id = new.match_id;
  if coalesce(v_heat_consumed, 0) < 250 then return new; end if;
  select * into v_opponent
  from public.multiplayer_players player
  where player.match_id = new.match_id and player.user_id <> new.user_id
  for update;
  if v_opponent.user_id is null
     or v_opponent.character_key <> 'runner_comet'
     or v_opponent.status <> 'intermission' then
    return new;
  end if;

  v_tax := round((new.obstacle_points - old.obstacle_points) * 0.10, 4);
  if v_tax <= 0 then return new; end if;
  new.obstacle_points := new.obstacle_points - v_tax;
  insert into public.multiplayer_heatfeast_tax_events(
    match_id, comet_user_id, opponent_user_id, wave, amount, created_at
  ) values (
    new.match_id, v_opponent.user_id, new.user_id,
    v_match.current_wave, v_tax, v_now
  )
  on conflict (match_id, comet_user_id, wave) do update
    set amount = public.multiplayer_heatfeast_tax_events.amount
          + excluded.amount;
  perform set_config(
    'app_private.skip_1v1_point_multiplier', 'on', true
  );
  update public.multiplayer_players player
  set obstacle_points = player.obstacle_points + v_tax,
      updated_at = v_now
  where player.match_id = new.match_id
    and player.user_id = v_opponent.user_id;
  perform set_config(
    'app_private.skip_1v1_point_multiplier', 'off', true
  );
  return new;
end;
$$;

revoke all on function app_private.settle_1v1_heatfeast_income_tax()
  from public, anon, authenticated;
drop trigger if exists settle_1v1_heatfeast_income_tax
  on public.multiplayer_players;
create trigger settle_1v1_heatfeast_income_tax
before update of obstacle_points on public.multiplayer_players
for each row execute function app_private.settle_1v1_heatfeast_income_tax();

-- At the exact playing -> intermission transition, every live Comet at 250
-- consumed HEATFEAST takes ten percent of the opponent's pre-tax balance.
-- Receipts and deterministic row locks make the transfer exactly-once even if
-- a stale client repeats its wave-completion heartbeat.
create or replace function app_private.settle_1v1_heatfeast_tax()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_one public.multiplayer_players;
  v_two public.multiplayer_players;
  v_heat_consumed numeric := 0;
  v_one_tax numeric := 0;
  v_two_tax numeric := 0;
  v_one_applies boolean := false;
  v_two_applies boolean := false;
  v_now timestamptz := clock_timestamp();
begin
  if old.status = 'intermission'
     or new.status <> 'intermission' then
    return new;
  end if;
  select coalesce(ledger.consumed, 0)
  into v_heat_consumed
  from public.multiplayer_heatfeast ledger
  where ledger.match_id = new.id;
  if coalesce(v_heat_consumed, 0) < 250 then return new; end if;

  perform 1
  from public.multiplayer_players player
  where player.match_id = new.id
  order by player.slot
  for update;
  select * into v_one
  from public.multiplayer_players player
  where player.match_id = new.id and player.slot = 1;
  select * into v_two
  from public.multiplayer_players player
  where player.match_id = new.id and player.slot = 2;
  if v_one.user_id is null or v_two.user_id is null then return new; end if;

  if v_one.character_key = 'runner_comet'
     and v_one.status = 'intermission'
     and v_two.status = 'intermission' then
    v_one_tax := round(greatest(0, v_two.obstacle_points) * 0.10, 4);
    insert into public.multiplayer_heatfeast_tax_events(
      match_id, comet_user_id, opponent_user_id, wave, amount, created_at
    ) values (
      new.id, v_one.user_id, v_two.user_id, new.current_wave,
      v_one_tax, v_now
    ) on conflict (match_id, comet_user_id, wave) do nothing
    returning true into v_one_applies;
  end if;
  if v_two.character_key = 'runner_comet'
     and v_two.status = 'intermission'
     and v_one.status = 'intermission' then
    v_two_tax := round(greatest(0, v_one.obstacle_points) * 0.10, 4);
    insert into public.multiplayer_heatfeast_tax_events(
      match_id, comet_user_id, opponent_user_id, wave, amount, created_at
    ) values (
      new.id, v_two.user_id, v_one.user_id, new.current_wave,
      v_two_tax, v_now
    ) on conflict (match_id, comet_user_id, wave) do nothing
    returning true into v_two_applies;
  end if;
  v_one_tax := case when coalesce(v_one_applies, false)
    then v_one_tax else 0 end;
  v_two_tax := case when coalesce(v_two_applies, false)
    then v_two_tax else 0 end;
  if v_one_tax = 0 and v_two_tax = 0 then return new; end if;

  perform set_config(
    'app_private.skip_1v1_point_multiplier', 'on', true
  );
  update public.multiplayer_players player
  set obstacle_points = case player.user_id
        when v_one.user_id then player.obstacle_points - v_two_tax + v_one_tax
        when v_two.user_id then player.obstacle_points - v_one_tax + v_two_tax
        else player.obstacle_points
      end,
      updated_at = v_now
  where player.match_id = new.id
    and player.user_id in (v_one.user_id, v_two.user_id);
  perform set_config(
    'app_private.skip_1v1_point_multiplier', 'off', true
  );
  return new;
end;
$$;

revoke all on function app_private.settle_1v1_heatfeast_tax()
  from public, anon, authenticated;
drop trigger if exists settle_1v1_heatfeast_tax
  on public.multiplayer_matches;
create trigger settle_1v1_heatfeast_tax
after update of status on public.multiplayer_matches
for each row
when (old.status is distinct from new.status)
execute function app_private.settle_1v1_heatfeast_tax();

-- Mirage state stays on the match-player row so the existing participant-only
-- Realtime stream can render the invader without opening another table.
alter table public.multiplayer_players
  add column if not exists mirage_used_wave integer,
  add column if not exists mirage_started_at timestamptz,
  add column if not exists mirage_active_until timestamptz,
  add column if not exists mirage_matching_since_at timestamptz,
  add column if not exists mirage_next_damage_at timestamptz,
  add column if not exists mirage_exit_damage_applied boolean
    not null default false,
  add column if not exists mirage_damage_dealt numeric(12,1)
    not null default 0;

alter table public.multiplayer_players
  drop constraint if exists multiplayer_players_mirage_used_wave_check,
  drop constraint if exists multiplayer_players_mirage_window_check,
  drop constraint if exists multiplayer_players_mirage_damage_check;
alter table public.multiplayer_players
  add constraint multiplayer_players_mirage_used_wave_check
    check (mirage_used_wave is null or mirage_used_wave >= 1) not valid,
  add constraint multiplayer_players_mirage_window_check
    check (
      mirage_started_at is null
      or (
        mirage_active_until is not null
        and mirage_active_until = mirage_started_at + interval '5 seconds'
      )
    ) not valid,
  add constraint multiplayer_players_mirage_damage_check
    check (mirage_damage_dealt >= 0) not valid;
alter table public.multiplayer_players
  validate constraint multiplayer_players_mirage_used_wave_check;
alter table public.multiplayer_players
  validate constraint multiplayer_players_mirage_window_check;
alter table public.multiplayer_players
  validate constraint multiplayer_players_mirage_damage_check;

-- A client heartbeat cannot report natural damage or death while Mirage is
-- active. Server Mirage damage also checks the target's immunity before write.
create or replace function app_private.enforce_1v1_mirage_invulnerability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.mirage_active_until > clock_timestamp()
     and not old.mirage_exit_damage_applied
     and (
       new.hearts < old.hearts
       or (new.status = 'eliminated' and old.status <> 'eliminated')
     ) then
    new.hearts := old.hearts;
    new.status := old.status;
    new.eliminated_at := old.eliminated_at;
    new.death_order := old.death_order;
  end if;
  return new;
end;
$$;

revoke all on function app_private.enforce_1v1_mirage_invulnerability()
  from public, anon, authenticated;
drop trigger if exists enforce_1v1_mirage_invulnerability
  on public.multiplayer_players;
create trigger enforce_1v1_mirage_invulnerability
before update of hearts, status, eliminated_at, death_order
on public.multiplayer_players
for each row execute function app_private.enforce_1v1_mirage_invulnerability();

create or replace function app_private.settle_1v1_mirage_exit(
  p_match_id uuid,
  p_user_id uuid,
  p_now timestamptz
)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player public.multiplayer_players;
  v_after numeric;
begin
  select * into v_player
  from public.multiplayer_players player
  where player.match_id = p_match_id and player.user_id = p_user_id
  for update;
  if v_player.user_id is null
     or v_player.mirage_started_at is null
     or v_player.mirage_active_until is null
     or v_player.mirage_active_until > p_now
     or v_player.mirage_exit_damage_applied then
    return 0;
  end if;
  if v_player.status in ('eliminated', 'left', 'finished') then
    update public.multiplayer_players player
    set mirage_exit_damage_applied = true,
        mirage_matching_since_at = null,
        mirage_next_damage_at = null,
        updated_at = p_now
    where player.match_id = p_match_id and player.user_id = p_user_id;
    return 0;
  end if;

  update public.multiplayer_players player
  set hearts = greatest(0, player.hearts - 1),
      mirage_exit_damage_applied = true,
      mirage_matching_since_at = null,
      mirage_next_damage_at = null,
      last_damage_at = p_now,
      updated_at = p_now
  where player.match_id = p_match_id and player.user_id = p_user_id
  returning hearts into v_after;
  if v_after = 0 then
    perform app_private.mark_1v1_eliminated(p_match_id, p_user_id, p_now);
    perform app_private.finalize_1v1_after_second_death(p_match_id, p_now);
  end if;
  return least(1, v_player.hearts);
end;
$$;

revoke all on function app_private.settle_1v1_mirage_exit(
  uuid, uuid, timestamptz
) from public, anon, authenticated;

create or replace function public.activate_1v1_mirage(
  p_match_id uuid,
  p_lane_index integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_match public.multiplayer_matches;
  v_self public.multiplayer_players;
  v_opponent public.multiplayer_players;
  v_lane_count integer := 5;
  v_now timestamptz := clock_timestamp();
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  select * into v_match from public.multiplayer_matches match_row
  where match_row.id = p_match_id for update;
  perform 1 from public.multiplayer_players player
  where player.match_id = p_match_id order by player.slot for update;
  select * into v_self from public.multiplayer_players player
  where player.match_id = p_match_id and player.user_id = v_uid;
  select * into v_opponent from public.multiplayer_players player
  where player.match_id = p_match_id and player.user_id <> v_uid limit 1;
  if v_match.id is null or v_self.user_id is null or v_opponent.user_id is null then
    raise exception '1v1 match not found';
  end if;
  if v_match.status <> 'playing' or v_self.status <> 'playing' then
    raise exception 'Mirage Invasion is only available during active 1v1 play';
  end if;
  if v_self.character_key <> 'trickster_mirage' then
    raise exception 'Only Mirage can start Mirage Invasion';
  end if;
  select rules.lane_count into v_lane_count
  from app_private.one_v_one_map_rules rules
  where rules.map_key = v_match.map_key;
  v_lane_count := coalesce(v_lane_count, 5);
  if p_lane_index is null or p_lane_index < 0
     or p_lane_index >= v_lane_count then
    raise exception 'Lane must be between 0 and %', v_lane_count - 1;
  end if;
  if p_lane_index = v_opponent.lane_index then
    raise exception 'Mirage must enter in a lane the opponent is not in';
  end if;
  if v_self.mirage_used_wave = v_self.wave then
    raise exception 'Mirage Invasion was already used this wave';
  end if;
  if v_self.mirage_active_until > v_now
     and not v_self.mirage_exit_damage_applied then
    raise exception 'Mirage Invasion is already active';
  end if;
  perform app_private.settle_1v1_mirage_exit(
    p_match_id, v_uid, v_now
  );
  select * into v_self from public.multiplayer_players player
  where player.match_id = p_match_id and player.user_id = v_uid;
  if v_self.status <> 'playing' or v_self.hearts <= 0 then
    raise exception 'Eliminated players cannot start Mirage Invasion';
  end if;

  update public.multiplayer_players player
  set lane_index = p_lane_index::smallint,
      last_position_at = v_now,
      mirage_used_wave = player.wave,
      mirage_started_at = v_now,
      mirage_active_until = v_now + interval '5 seconds',
      mirage_matching_since_at = null,
      mirage_next_damage_at = null,
      mirage_exit_damage_applied = false,
      mirage_damage_dealt = 0,
      last_seen_at = v_now,
      updated_at = v_now
  where player.match_id = p_match_id and player.user_id = v_uid;
  update public.multiplayer_matches match_row
  set last_activity_at = v_now where match_row.id = p_match_id;
  return jsonb_build_object(
    'match_id', p_match_id,
    'wave', v_self.wave,
    'lane_index', p_lane_index,
    'opponent_lane_index', v_opponent.lane_index,
    'started_at', v_now,
    'ends_at', v_now + interval '5 seconds',
    'active', true,
    'damage_dealt', 0
  );
end;
$$;

-- Position reports also maintain the server's continuous same-lane clock.
-- Repeating the same position does not reset the 500ms cadence.
create or replace function public.update_1v1_position(
  p_match_id uuid,
  p_lane_index integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_match public.multiplayer_matches;
  v_lane_count integer := 5;
  v_now timestamptz := clock_timestamp();
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  select * into v_match from public.multiplayer_matches match_row
  where match_row.id = p_match_id for update;
  if v_match.id is null or not exists (
    select 1 from public.multiplayer_players player
    where player.match_id = p_match_id and player.user_id = v_uid
  ) then raise exception '1v1 match not found'; end if;
  if v_match.status not in ('countdown', 'playing', 'intermission') then
    raise exception 'This 1v1 match has ended';
  end if;
  select rules.lane_count into v_lane_count
  from app_private.one_v_one_map_rules rules
  where rules.map_key = v_match.map_key;
  v_lane_count := coalesce(v_lane_count, 5);
  if p_lane_index is null or p_lane_index < 0
     or p_lane_index >= v_lane_count then
    raise exception 'Lane must be between 0 and %', v_lane_count - 1;
  end if;

  perform 1 from public.multiplayer_players player
  where player.match_id = p_match_id order by player.slot for update;
  update public.multiplayer_players player
  set lane_index = p_lane_index::smallint,
      last_position_at = v_now,
      last_seen_at = v_now,
      updated_at = v_now
  where player.match_id = p_match_id and player.user_id = v_uid
    and player.status not in ('eliminated', 'left', 'finished');
  if not found then raise exception 'Eliminated players cannot move'; end if;

  update public.multiplayer_players invader
  set mirage_matching_since_at = case
        when invader.lane_index = opponent.lane_index
          then coalesce(invader.mirage_matching_since_at, v_now)
        else null
      end,
      mirage_next_damage_at = case
        when invader.lane_index = opponent.lane_index
          then coalesce(
            invader.mirage_next_damage_at,
            coalesce(invader.mirage_matching_since_at, v_now)
              + interval '0.5 seconds'
          )
        else null
      end,
      updated_at = v_now
  from public.multiplayer_players opponent
  where invader.match_id = p_match_id
    and opponent.match_id = invader.match_id
    and opponent.user_id <> invader.user_id
    and invader.character_key = 'trickster_mirage'
    and invader.mirage_active_until > v_now
    and not invader.mirage_exit_damage_applied;

  update public.multiplayer_matches match_row
  set last_activity_at = v_now where match_row.id = p_match_id;
  return jsonb_build_object(
    'match_id', p_match_id,
    'lane_index', p_lane_index,
    'lane_count', v_lane_count
  );
end;
$$;

-- p_damage is retained for the already-shipped browser signature, but it is
-- only a poll hint. The server calculates due ticks from locked lane state and
-- its own timestamps, so callers cannot choose the damage amount or cadence.
create or replace function public.apply_1v1_mirage_damage(
  p_match_id uuid,
  p_damage numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_match public.multiplayer_matches;
  v_self public.multiplayer_players;
  v_opponent public.multiplayer_players;
  v_now timestamptz := clock_timestamp();
  v_effective_now timestamptz;
  v_next timestamptz;
  v_due integer := 0;
  v_applied numeric := 0;
  v_self_damage numeric := 0;
  v_opponent_after numeric;
  v_self_after numeric;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  if p_damage is null or p_damage <= 0 or p_damage > 10
     or p_damage <> trunc(p_damage) then
    raise exception 'Invalid Mirage damage poll';
  end if;
  select * into v_match from public.multiplayer_matches match_row
  where match_row.id = p_match_id for update;
  perform 1 from public.multiplayer_players player
  where player.match_id = p_match_id order by player.slot for update;
  select * into v_self from public.multiplayer_players player
  where player.match_id = p_match_id and player.user_id = v_uid;
  select * into v_opponent from public.multiplayer_players player
  where player.match_id = p_match_id and player.user_id <> v_uid limit 1;
  if v_match.id is null or v_self.user_id is null or v_opponent.user_id is null then
    raise exception '1v1 match not found';
  end if;
  if v_match.status not in ('playing', 'intermission') then
    raise exception 'This 1v1 match is not active';
  end if;
  if v_self.character_key <> 'trickster_mirage'
     or v_self.mirage_started_at is null
     or v_self.mirage_active_until is null
     or v_self.mirage_exit_damage_applied then
    raise exception 'Mirage Invasion is not active';
  end if;

  v_effective_now := least(v_now, v_self.mirage_active_until);
  if v_match.status = 'playing'
     and v_self.status = 'playing'
     and v_opponent.status = 'playing'
     and v_self.lane_index = v_opponent.lane_index then
    if v_self.mirage_matching_since_at is null then
      update public.multiplayer_players player
      set mirage_matching_since_at = v_effective_now,
          mirage_next_damage_at = v_effective_now + interval '0.5 seconds',
          updated_at = v_now
      where player.match_id = p_match_id and player.user_id = v_uid;
    else
      v_next := coalesce(
        v_self.mirage_next_damage_at,
        v_self.mirage_matching_since_at + interval '0.5 seconds'
      );
      if v_next <= v_effective_now then
        v_due := 1 + floor(
          extract(epoch from (v_effective_now - v_next)) / 0.5
        )::integer;
        v_due := least(10, greatest(0, v_due));
        v_next := v_next + v_due * interval '0.5 seconds';
      end if;
      -- An invading Mirage is immune, including to another Mirage.
      if v_due > 0 and not (
        v_opponent.character_key = 'trickster_mirage'
        and v_opponent.mirage_active_until > v_now
        and not v_opponent.mirage_exit_damage_applied
      ) then
        v_applied := least(v_due::numeric, v_opponent.hearts);
        update public.multiplayer_players player
        set hearts = greatest(0, player.hearts - v_applied),
            last_damage_at = v_now,
            updated_at = v_now
        where player.match_id = p_match_id
          and player.user_id = v_opponent.user_id
        returning hearts into v_opponent_after;
      end if;
      update public.multiplayer_players player
      set mirage_next_damage_at = v_next,
          mirage_damage_dealt = player.mirage_damage_dealt + v_applied,
          last_seen_at = v_now,
          updated_at = v_now
      where player.match_id = p_match_id and player.user_id = v_uid;
      if coalesce(v_opponent_after, v_opponent.hearts) = 0
         and v_applied > 0 then
        perform app_private.mark_1v1_eliminated(
          p_match_id, v_opponent.user_id, v_now
        );
        perform app_private.finalize_1v1_after_second_death(
          p_match_id, v_now
        );
      end if;
    end if;
  else
    update public.multiplayer_players player
    set mirage_matching_since_at = null,
        mirage_next_damage_at = null,
        updated_at = v_now
    where player.match_id = p_match_id and player.user_id = v_uid;
  end if;

  if v_now >= v_self.mirage_active_until then
    v_self_damage := app_private.settle_1v1_mirage_exit(
      p_match_id, v_uid, v_now
    );
  end if;
  select player.hearts into v_self_after
  from public.multiplayer_players player
  where player.match_id = p_match_id and player.user_id = v_uid;
  select player.hearts into v_opponent_after
  from public.multiplayer_players player
  where player.match_id = p_match_id and player.user_id = v_opponent.user_id;
  update public.multiplayer_matches match_row
  set last_activity_at = v_now where match_row.id = p_match_id;
  return jsonb_build_object(
    'match_id', p_match_id,
    'damage_applied', v_applied,
    'self_damage_applied', v_self_damage,
    'self_hearts', v_self_after,
    'opponent_hearts', v_opponent_after,
    'active', v_now < v_self.mirage_active_until,
    'ends_at', v_self.mirage_active_until
  );
end;
$$;

create or replace function public.finish_1v1_mirage(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_self public.multiplayer_players;
  v_now timestamptz := clock_timestamp();
  v_damage numeric := 0;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  select * into v_self from public.multiplayer_players player
  where player.match_id = p_match_id and player.user_id = v_uid
  for update;
  if v_self.user_id is null then raise exception '1v1 match not found'; end if;
  if v_self.character_key <> 'trickster_mirage'
     or v_self.mirage_active_until is null then
    raise exception 'Mirage Invasion has not started';
  end if;
  if v_self.mirage_active_until > v_now then
    return jsonb_build_object(
      'match_id', p_match_id,
      'active', true,
      'ends_at', v_self.mirage_active_until,
      'self_damage_applied', 0,
      'self_hearts', v_self.hearts
    );
  end if;
  v_damage := app_private.settle_1v1_mirage_exit(
    p_match_id, v_uid, v_now
  );
  select * into v_self from public.multiplayer_players player
  where player.match_id = p_match_id and player.user_id = v_uid;
  return jsonb_build_object(
    'match_id', p_match_id,
    'active', false,
    'ends_at', v_self.mirage_active_until,
    'self_damage_applied', v_damage,
    'self_hearts', v_self.hearts
  );
end;
$$;

create or replace function public.consume_1v1_heatfeast(
  p_match_id uuid,
  p_amount integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_match public.multiplayer_matches;
  v_self public.multiplayer_players;
  v_ledger public.multiplayer_heatfeast;
  v_used numeric := 0;
  v_amount numeric := 0;
  v_now timestamptz := clock_timestamp();
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  if p_amount is null or p_amount < 1 or p_amount > 100 then
    raise exception 'HEATFEAST consumption must be between 1 and 100';
  end if;
  select * into v_match from public.multiplayer_matches match_row
  where match_row.id = p_match_id for update;
  select * into v_self from public.multiplayer_players player
  where player.match_id = p_match_id and player.user_id = v_uid
  for update;
  if v_match.id is null or v_self.user_id is null then
    raise exception '1v1 match not found';
  end if;
  if v_match.status not in ('playing', 'intermission')
     or v_self.status not in ('playing', 'intermission') then
    raise exception 'HEATFEAST is only available during an active 1v1';
  end if;
  if v_self.character_key <> 'runner_comet' then
    raise exception 'Only Comet can consume HEATFEAST';
  end if;

  insert into public.multiplayer_heatfeast(match_id)
  values (p_match_id) on conflict (match_id) do nothing;
  select * into v_ledger from public.multiplayer_heatfeast ledger
  where ledger.match_id = p_match_id for update;
  select usage.consumed into v_used
  from public.multiplayer_heatfeast_wave_usage usage
  where usage.match_id = p_match_id and usage.user_id = v_uid
    and usage.wave = v_self.wave for update;
  v_used := coalesce(v_used, 0);
  v_amount := least(
    p_amount::numeric,
    greatest(0, 100 - v_used),
    v_ledger.stored
  );
  if v_amount > 0 then
    insert into public.multiplayer_heatfeast_wave_usage(
      match_id, user_id, wave, consumed, updated_at
    ) values (
      p_match_id, v_uid, v_self.wave, v_amount, v_now
    )
    on conflict (match_id, user_id, wave) do update
      set consumed = public.multiplayer_heatfeast_wave_usage.consumed
            + excluded.consumed,
          updated_at = excluded.updated_at;
    update public.multiplayer_heatfeast ledger
    set stored = ledger.stored - v_amount,
        consumed = ledger.consumed + v_amount,
        updated_at = v_now
    where ledger.match_id = p_match_id;
    update public.multiplayer_matches match_row
    set last_activity_at = v_now where match_row.id = p_match_id;
  end if;
  return app_private.one_v_one_heatfeast_json(
    p_match_id, v_uid, v_self.wave
  ) || jsonb_build_object('amount', v_amount, 'match_id', p_match_id);
end;
$$;

create or replace function public.purchase_1v1_comet_removal(
  p_match_id uuid,
  p_purchase_id text,
  p_obstacle_type text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_purchase_id text := btrim(p_purchase_id);
  v_type text := lower(btrim(p_obstacle_type));
  v_match public.multiplayer_matches;
  v_self public.multiplayer_players;
  v_existing public.multiplayer_comet_removals;
  v_base_cost integer;
  v_cost integer;
  v_heat_consumed numeric := 0;
  v_remaining numeric;
  v_receipt_id uuid;
  v_spawn_wave integer;
  v_now timestamptz := clock_timestamp();
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  if p_purchase_id is null
     or length(v_purchase_id) not between 1 and 160 then
    raise exception 'Removal purchase id must contain 1 to 160 characters';
  end if;
  if v_type = 'spikes' then v_type := 'spike'; end if;
  v_base_cost := case v_type
    when 'barrel' then 6
    when 'log' then 6
    when 'snowflake' then 7
    when 'car' then 8
    when 'spike' then 8
    when 'rock' then 8
    else null
  end;
  if v_base_cost is null then
    raise exception 'Only natural barrels, logs, snowflakes, cars, spikes, and rocks can be removed';
  end if;

  select * into v_match from public.multiplayer_matches match_row
  where match_row.id = p_match_id for update;
  select * into v_self from public.multiplayer_players player
  where player.match_id = p_match_id and player.user_id = v_uid
  for update;
  if v_match.id is null or v_self.user_id is null then
    raise exception '1v1 match not found';
  end if;

  -- Lost-response retries return their original receipt even if the shared
  -- intermission ended after the successful first transaction.
  select * into v_existing
  from public.multiplayer_comet_removals receipt
  where receipt.match_id = p_match_id and receipt.user_id = v_uid
    and receipt.purchase_id = v_purchase_id;
  if v_existing.id is not null then
    if v_existing.obstacle_type <> v_type then
      raise exception 'Removal purchase id was already used for another obstacle';
    end if;
    return jsonb_build_object(
      'match_id', p_match_id,
      'receipt_id', v_existing.id,
      'purchase_id', v_existing.purchase_id,
      'obstacle_type', v_existing.obstacle_type,
      'point_cost', v_existing.point_cost,
      'spawn_wave', v_existing.spawn_wave,
      'duplicate', true,
      'remaining_points', v_self.obstacle_points,
      'heatfeast', app_private.one_v_one_heatfeast_json(
        p_match_id, v_uid, v_self.wave
      )
    );
  end if;
  if v_match.status <> 'intermission'
     or v_match.intermission_ends_at is null
     or v_match.intermission_ends_at <= v_now
     or v_self.status <> 'intermission' then
    raise exception 'Natural removals can only be bought during the 10-second intermission';
  end if;
  if v_self.character_key <> 'runner_comet' then
    raise exception 'Only Comet can buy natural obstacle removals';
  end if;

  insert into public.multiplayer_heatfeast(match_id)
  values (p_match_id) on conflict (match_id) do nothing;
  select ledger.consumed into v_heat_consumed
  from public.multiplayer_heatfeast ledger
  where ledger.match_id = p_match_id for update;
  v_cost := case when coalesce(v_heat_consumed, 0) >= 500
    then ceil(v_base_cost::numeric / 2)::integer
    else v_base_cost
  end;
  v_spawn_wave := greatest(v_match.current_wave, v_self.wave);

  update public.multiplayer_players player
  set obstacle_points = player.obstacle_points - v_cost,
      last_seen_at = v_now,
      updated_at = v_now
  where player.match_id = p_match_id and player.user_id = v_uid
    and player.status = 'intermission'
    and player.obstacle_points >= v_cost
  returning obstacle_points into v_remaining;
  if v_remaining is null then raise exception 'Not enough obstacle points'; end if;

  insert into public.multiplayer_comet_removals(
    match_id, user_id, purchase_id, obstacle_type,
    point_cost, spawn_wave, created_at
  ) values (
    p_match_id, v_uid, v_purchase_id, v_type,
    v_cost, v_spawn_wave, v_now
  ) returning id into v_receipt_id;
  update public.multiplayer_heatfeast ledger
  set stored = ledger.stored + v_cost,
      updated_at = v_now
  where ledger.match_id = p_match_id;
  update public.multiplayer_matches match_row
  set last_activity_at = v_now where match_row.id = p_match_id;
  return jsonb_build_object(
    'match_id', p_match_id,
    'receipt_id', v_receipt_id,
    'purchase_id', v_purchase_id,
    'obstacle_type', v_type,
    'base_point_cost', v_base_cost,
    'point_cost', v_cost,
    'spawn_wave', v_spawn_wave,
    'duplicate', false,
    'remaining_points', v_remaining,
    'heatfeast', app_private.one_v_one_heatfeast_json(
      p_match_id, v_uid, v_self.wave
    )
  );
end;
$$;

create or replace function public.redeem_1v1_comet_removal(
  p_match_id uuid,
  p_receipt_id uuid,
  p_obstacle_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_obstacle_id text := btrim(p_obstacle_id);
  v_match public.multiplayer_matches;
  v_self public.multiplayer_players;
  v_receipt public.multiplayer_comet_removals;
  v_now timestamptz := clock_timestamp();
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  if p_receipt_id is null or p_obstacle_id is null
     or length(v_obstacle_id) not between 1 and 160 then
    raise exception 'Removal receipt and obstacle id are required';
  end if;
  select * into v_match from public.multiplayer_matches match_row
  where match_row.id = p_match_id for update;
  select * into v_self from public.multiplayer_players player
  where player.match_id = p_match_id and player.user_id = v_uid
  for update;
  select * into v_receipt from public.multiplayer_comet_removals receipt
  where receipt.id = p_receipt_id and receipt.match_id = p_match_id
    and receipt.user_id = v_uid for update;
  if v_match.id is null or v_self.user_id is null or v_receipt.id is null then
    raise exception 'Comet removal receipt not found';
  end if;
  if v_match.status <> 'playing' or v_self.status <> 'playing'
     or v_receipt.spawn_wave <> v_self.wave then
    raise exception 'This removal receipt is not valid in the current wave';
  end if;
  if v_receipt.redeemed_at is not null then
    if v_receipt.obstacle_id <> v_obstacle_id then
      raise exception 'This removal receipt was already redeemed';
    end if;
    return jsonb_build_object(
      'match_id', p_match_id,
      'receipt_id', v_receipt.id,
      'obstacle_type', v_receipt.obstacle_type,
      'obstacle_id', v_receipt.obstacle_id,
      'duplicate', true
    );
  end if;
  update public.multiplayer_comet_removals receipt
  set obstacle_id = v_obstacle_id,
      redeemed_at = v_now
  where receipt.id = p_receipt_id;
  return jsonb_build_object(
    'match_id', p_match_id,
    'receipt_id', v_receipt.id,
    'obstacle_type', v_receipt.obstacle_type,
    'obstacle_id', v_obstacle_id,
    'duplicate', false
  );
end;
$$;

-- Existing clients call this signature. Comet's paid amount and doubled rows
-- are now server-owned, and every successful spend is added once to the shared
-- ledger (the free second row never adds HEATFEAST).
-- TODO SERVER GAMEPLAY: Gambit's doubled-send / Two Pair / Royal Flush coin
-- effects intentionally remain disabled until poker hands have immutable,
-- server-generated receipts. A client-reported hand would be a cheat path.
alter table public.multiplayer_attacks
  drop constraint if exists multiplayer_attacks_point_cost_check,
  drop constraint if exists multiplayer_attacks_source_check,
  drop constraint if exists multiplayer_attacks_source_cost_check;
alter table public.multiplayer_attacks
  add constraint multiplayer_attacks_point_cost_check
    check (point_cost between 0 and 8) not valid,
  add constraint multiplayer_attacks_source_check
    check (source in (
      'purchased', 'katana', 'comet_bonus', 'heatfeast_return'
    )) not valid,
  add constraint multiplayer_attacks_source_cost_check check (
    (source = 'purchased' and point_cost between 1 and 8)
    or (source in ('katana', 'comet_bonus') and point_cost = 0)
    or (source = 'heatfeast_return' and point_cost between 0 and 8)
  ) not valid;
alter table public.multiplayer_attacks
  validate constraint multiplayer_attacks_point_cost_check;
alter table public.multiplayer_attacks
  validate constraint multiplayer_attacks_source_check;
alter table public.multiplayer_attacks
  validate constraint multiplayer_attacks_source_cost_check;

create or replace function public.send_1v1_attack(
  p_match_id uuid,
  p_obstacle_type text,
  p_cost integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_type text := lower(trim(p_obstacle_type));
  v_base_cost integer;
  v_cost integer;
  v_quantity integer := 1;
  v_match public.multiplayer_matches;
  v_self public.multiplayer_players;
  v_target public.multiplayer_players;
  v_allowed text[];
  v_remaining numeric;
  v_attack_id uuid;
  v_first_attack_id uuid;
  v_attack_ids jsonb := '[]'::jsonb;
  v_placement record;
  v_heat_consumed numeric := 0;
  v_has_comet boolean := false;
  v_index integer;
  v_actual_sender uuid;
  v_actual_target uuid;
  v_source text;
  v_row_cost integer;
  v_split_count integer;
  v_returned_quantity integer := 0;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  if v_type = 'spikes' then v_type := 'spike'; end if;
  v_base_cost := case v_type
    when 'log' then 6
    when 'barrel' then 6
    when 'snowflake' then 7
    when 'current' then 7
    when 'spike' then 8
    when 'car' then 8
    when 'rock' then 8
    else null
  end;
  if v_base_cost is null then raise exception 'Unknown obstacle type'; end if;

  select * into v_match from public.multiplayer_matches match_row
  where match_row.id = p_match_id for update;
  perform 1 from public.multiplayer_players player
  where player.match_id = p_match_id order by player.slot for update;
  select * into v_self from public.multiplayer_players player
  where player.match_id = p_match_id and player.user_id = v_uid;
  select * into v_target from public.multiplayer_players player
  where player.match_id = p_match_id and player.user_id <> v_uid limit 1;
  if v_match.id is null or v_self.user_id is null then
    raise exception '1v1 match not found';
  end if;
  if v_match.status <> 'intermission'
     or v_match.intermission_ends_at is null
     or v_match.intermission_ends_at <= now() then
    raise exception 'Attacks can only be bought during the 10-second intermission';
  end if;
  if v_self.status <> 'intermission' then
    raise exception 'Only a living intermission player can buy attacks';
  end if;
  if v_target.user_id is null then raise exception '1v1 opponent not found'; end if;
  if v_target.status in ('eliminated', 'left', 'finished') then
    raise exception 'The opponent is no longer accepting attacks';
  end if;

  select rules.allowed_attacks into v_allowed
  from app_private.one_v_one_map_rules rules
  where rules.map_key = v_match.map_key;
  if not (v_type = any(v_allowed)) then
    raise exception '% is not available on %', v_type, v_match.map_key;
  end if;
  v_has_comet := v_self.character_key = 'runner_comet'
    or v_target.character_key = 'runner_comet';
  if v_has_comet then
    insert into public.multiplayer_heatfeast(match_id)
    values (p_match_id) on conflict (match_id) do nothing;
    select ledger.consumed into v_heat_consumed
    from public.multiplayer_heatfeast ledger
    where ledger.match_id = p_match_id for update;
  end if;
  v_cost := v_base_cost;
  if v_self.character_key = 'runner_comet' then
    v_cost := ceil(v_cost::numeric / 2)::integer;
    v_quantity := 2;
    if coalesce(v_heat_consumed, 0) >= 750 then
      v_cost := ceil(v_cost::numeric / 2)::integer;
    end if;
  end if;
  -- p_cost remains a compatibility assertion and never controls the charge.
  if p_cost is not null and p_cost not in (v_base_cost, v_cost) then
    raise exception 'Incorrect obstacle cost';
  end if;

  update public.multiplayer_players player
  set obstacle_points = player.obstacle_points - v_cost,
      last_seen_at = now(),
      updated_at = now()
  where player.match_id = p_match_id and player.user_id = v_uid
    and player.status = 'intermission'
    and player.obstacle_points >= v_cost
  returning obstacle_points into v_remaining;
  if v_remaining is null then raise exception 'Not enough obstacle points'; end if;

  for v_index in 1..v_quantity loop
    v_actual_sender := v_uid;
    v_actual_target := v_target.user_id;
    v_source := case when v_index = 1
      then 'purchased' else 'comet_bonus' end;
    v_row_cost := case when v_index = 1 then v_cost else 0 end;

    -- At 1000 consumed HEATFEAST, every second attack row aimed at Comet is
    -- reflected. Counting rows (not purchases) makes doubled Comet sends and
    -- ordinary sends use the same deterministic split. Odd extras stay on the
    -- Comet side exactly as specified.
    if v_target.character_key = 'runner_comet'
       and coalesce(v_heat_consumed, 0) >= 1000 then
      insert into public.multiplayer_heatfeast_split_state(
        match_id, comet_user_id, wave, incoming_count, updated_at
      ) values (
        p_match_id, v_target.user_id, v_match.current_wave, 1, now()
      )
      on conflict (match_id, comet_user_id, wave) do update
        set incoming_count =
              public.multiplayer_heatfeast_split_state.incoming_count + 1,
            updated_at = excluded.updated_at
      returning incoming_count into v_split_count;
      if mod(v_split_count, 2) = 0 then
        v_actual_sender := v_target.user_id;
        v_actual_target := v_uid;
        v_source := 'heatfeast_return';
        v_returned_quantity := v_returned_quantity + 1;
      end if;
    end if;

    select * into v_placement
    from app_private.next_1v1_attack_placement(
      p_match_id, v_actual_sender, v_actual_target, v_type
    );
    insert into public.multiplayer_attacks(
      match_id, sender_user_id, target_user_id,
      obstacle_type, point_cost, spawn_wave, source,
      lane_index, lane_group, lane_position, escape_lane_index,
      wall_parity, wall_lane_index, wall_size
    ) values (
      p_match_id, v_actual_sender, v_actual_target,
      v_type, v_row_cost,
      v_match.current_wave,
      v_source,
      v_placement.lane_index, v_placement.lane_group,
      v_placement.lane_position, v_placement.escape_lane_index,
      v_placement.wall_parity, v_placement.wall_lane_index,
      v_placement.wall_size
    ) returning id into v_attack_id;
    if v_index = 1 then v_first_attack_id := v_attack_id; end if;
    v_attack_ids := v_attack_ids || jsonb_build_array(v_attack_id);
  end loop;

  if v_has_comet then
    update public.multiplayer_heatfeast ledger
    set stored = ledger.stored + v_cost,
        updated_at = now()
    where ledger.match_id = p_match_id;
  end if;
  update public.multiplayer_matches match_row
  set last_activity_at = now() where match_row.id = p_match_id;
  return jsonb_build_object(
    'id', v_first_attack_id,
    'attack_ids', v_attack_ids,
    'quantity', v_quantity,
    'returned_quantity', v_returned_quantity,
    'delivered_to_opponent_quantity', v_quantity - v_returned_quantity,
    'match_id', p_match_id,
    'map_key', v_match.map_key,
    'target_user_id', v_target.user_id,
    'obstacle_type', v_type,
    'base_point_cost', v_base_cost,
    'point_cost', v_cost,
    'spawn_wave', v_match.current_wave,
    'source', 'purchased',
    'remaining_points', v_remaining,
    'available_attacks', to_jsonb(v_allowed),
    'heatfeast', case when v_has_comet then
      app_private.one_v_one_heatfeast_json(
        p_match_id, v_uid, v_self.wave
      ) else null end
  );
end;
$$;

-- This small companion state endpoint lets reconnects hydrate both abilities
-- without duplicating or destabilizing the large map-state payload. It also
-- settles any expired Mirage exactly once using the server clock.
create or replace function public.get_1v1_ability_state(p_match_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_match public.multiplayer_matches;
  v_self public.multiplayer_players;
  v_opponent public.multiplayer_players;
  v_now timestamptz := clock_timestamp();
  v_player record;
  v_pending_removals jsonb := '[]'::jsonb;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  select * into v_match from public.multiplayer_matches match_row
  where match_row.id = p_match_id for update;
  perform 1 from public.multiplayer_players player
  where player.match_id = p_match_id order by player.slot for update;
  select * into v_self from public.multiplayer_players player
  where player.match_id = p_match_id and player.user_id = v_uid;
  if v_match.id is null or v_self.user_id is null then
    raise exception '1v1 match not found';
  end if;
  for v_player in
    select player.user_id
    from public.multiplayer_players player
    where player.match_id = p_match_id
      and player.mirage_active_until is not null
      and player.mirage_active_until <= v_now
      and not player.mirage_exit_damage_applied
  loop
    perform app_private.settle_1v1_mirage_exit(
      p_match_id, v_player.user_id, v_now
    );
  end loop;
  select * into v_self from public.multiplayer_players player
  where player.match_id = p_match_id and player.user_id = v_uid;
  select * into v_opponent from public.multiplayer_players player
  where player.match_id = p_match_id and player.user_id <> v_uid limit 1;
  select coalesce(jsonb_agg(jsonb_build_object(
    'receipt_id', receipt.id,
    'purchase_id', receipt.purchase_id,
    'obstacle_type', receipt.obstacle_type,
    'point_cost', receipt.point_cost,
    'spawn_wave', receipt.spawn_wave,
    'created_at', receipt.created_at
  ) order by receipt.created_at, receipt.id), '[]'::jsonb)
  into v_pending_removals
  from public.multiplayer_comet_removals receipt
  where receipt.match_id = p_match_id and receipt.user_id = v_uid
    and receipt.spawn_wave = v_self.wave
    and receipt.redeemed_at is null;
  return jsonb_build_object(
    'match_id', p_match_id,
    'server_now', v_now,
    'heatfeast', app_private.one_v_one_heatfeast_json(
      p_match_id, v_uid, v_self.wave
    ),
    'pending_comet_removals', v_pending_removals,
    'self', jsonb_build_object(
      'lane_index', v_self.lane_index,
      'mirage_active', coalesce(
        v_self.mirage_active_until > v_now
          and not v_self.mirage_exit_damage_applied,
        false
      ),
      'mirage_used_wave', v_self.mirage_used_wave,
      'mirage_started_at', v_self.mirage_started_at,
      'mirage_ends_at', v_self.mirage_active_until,
      'mirage_matching_since_at', v_self.mirage_matching_since_at,
      'mirage_damage_dealt', v_self.mirage_damage_dealt,
      'mirage_exit_damage_applied', v_self.mirage_exit_damage_applied,
      'hearts', v_self.hearts
    ),
    'opponent', jsonb_build_object(
      'lane_index', v_opponent.lane_index,
      'mirage_active', coalesce(
        v_opponent.mirage_active_until > v_now
          and not v_opponent.mirage_exit_damage_applied,
        false
      ),
      'mirage_started_at', v_opponent.mirage_started_at,
      'mirage_ends_at', v_opponent.mirage_active_until,
      'mirage_damage_dealt', v_opponent.mirage_damage_dealt,
      'hearts', v_opponent.hearts
    )
  );
end;
$$;

comment on function public.activate_1v1_mirage(uuid, integer) is
  'Starts the authenticated Mirage participant once per wave in a server-validated lane for exactly five seconds.';
comment on function public.apply_1v1_mirage_damage(uuid, numeric) is
  'Applies only server-clocked 500ms same-lane Mirage damage; the numeric argument is an ignored compatibility poll hint.';
comment on function public.finish_1v1_mirage(uuid) is
  'Settles Mirage one-HP exit damage exactly once after the server-owned five-second window.';
comment on function public.consume_1v1_heatfeast(uuid, integer) is
  'Consumes a caller-selected amount from shared HEATFEAST with a server-enforced 100-per-Comet-per-wave ceiling.';
comment on function public.purchase_1v1_comet_removal(uuid, text, text) is
  'Charges Comet once for an idempotent, next-wave natural-obstacle removal receipt; opponent-sent attacks are excluded.';
comment on function public.redeem_1v1_comet_removal(uuid, uuid, text) is
  'Consumes one owned Comet natural-removal receipt against one client obstacle id in its exact wave.';
comment on function public.get_1v1_ability_state(uuid) is
  'Participant-relative reconnect state for shared HEATFEAST and visible Mirage invasion.';
comment on function public.update_1v1_state(
  uuid, numeric, integer, bigint, text
) is
  'Current 1v1 heartbeat with exact server-owned Comet HEATFEAST obstacle-damage modifiers.';
comment on function public.send_1v1_attack(uuid, text, integer) is
  'Server-priced 1v1 purchase with Comet quantity, HEATFEAST discounts, and deterministic 1000-point split reflection.';

revoke all on function public.activate_1v1_mirage(uuid, integer)
  from public, anon, authenticated;
revoke all on function public.apply_1v1_mirage_damage(uuid, numeric)
  from public, anon, authenticated;
revoke all on function public.finish_1v1_mirage(uuid)
  from public, anon, authenticated;
revoke all on function public.consume_1v1_heatfeast(uuid, integer)
  from public, anon, authenticated;
revoke all on function public.purchase_1v1_comet_removal(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.redeem_1v1_comet_removal(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.get_1v1_ability_state(uuid)
  from public, anon, authenticated;
revoke all on function public.update_1v1_position(uuid, integer)
  from public, anon, authenticated;
revoke all on function public.send_1v1_attack(uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.activate_1v1_mirage(uuid, integer)
  to authenticated;
grant execute on function public.apply_1v1_mirage_damage(uuid, numeric)
  to authenticated;
grant execute on function public.finish_1v1_mirage(uuid)
  to authenticated;
grant execute on function public.consume_1v1_heatfeast(uuid, integer)
  to authenticated;
grant execute on function public.purchase_1v1_comet_removal(uuid, text, text)
  to authenticated;
grant execute on function public.redeem_1v1_comet_removal(uuid, uuid, text)
  to authenticated;
grant execute on function public.get_1v1_ability_state(uuid)
  to authenticated;
grant execute on function public.update_1v1_position(uuid, integer)
  to authenticated;
grant execute on function public.send_1v1_attack(uuid, text, integer)
  to authenticated;

-- Installation and authorization assertions fail the transaction instead of
-- leaving a partially exposed ability surface.
do $installation_assertions$
begin
  if has_table_privilege(
       'authenticated', 'public.multiplayer_heatfeast', 'SELECT'
     ) or has_table_privilege(
       'authenticated', 'public.multiplayer_heatfeast_wave_usage', 'SELECT'
     ) or has_table_privilege(
       'authenticated', 'public.multiplayer_comet_removals', 'SELECT'
     ) or has_table_privilege(
       'authenticated', 'public.multiplayer_heatfeast_tax_events', 'SELECT'
     ) or has_table_privilege(
       'authenticated', 'public.multiplayer_heatfeast_split_state', 'SELECT'
     ) then
    raise exception 'HEATFEAST ledgers must remain RPC-only';
  end if;
  if not has_function_privilege(
       'authenticated',
       'public.activate_1v1_mirage(uuid,integer)', 'EXECUTE'
     ) or has_function_privilege(
       'anon', 'public.activate_1v1_mirage(uuid,integer)', 'EXECUTE'
     ) or not has_function_privilege(
       'authenticated',
       'public.consume_1v1_heatfeast(uuid,integer)', 'EXECUTE'
     ) or has_function_privilege(
       'anon', 'public.consume_1v1_heatfeast(uuid,integer)', 'EXECUTE'
     ) or not has_function_privilege(
       'authenticated',
       'public.purchase_1v1_comet_removal(uuid,text,text)', 'EXECUTE'
     ) or has_function_privilege(
       'anon',
       'public.purchase_1v1_comet_removal(uuid,text,text)', 'EXECUTE'
     ) or has_function_privilege(
       'authenticated',
       'app_private.update_1v1_state_unadjusted(uuid,numeric,integer,bigint,text)',
       'EXECUTE'
     ) then
    raise exception 'Comet / Mirage RPC permissions are unsafe';
  end if;
  if position(
       $$v_self.character_key <> 'trickster_mirage'$$
       in pg_get_functiondef(to_regprocedure(
         'public.activate_1v1_mirage(uuid,integer)'
       ))
     ) = 0 or position(
       $$v_self.character_key <> 'runner_comet'$$
       in pg_get_functiondef(to_regprocedure(
         'public.consume_1v1_heatfeast(uuid,integer)'
       ))
     ) = 0 then
    raise exception 'Character snapshot gates are missing';
  end if;
  if position(
       $$v_damage_multiplier := v_damage_multiplier * 0.75$$
       in pg_get_functiondef(to_regprocedure(
         'public.update_1v1_state(uuid,numeric,integer,bigint,text)'
       ))
     ) = 0
     or position(
       $$v_damage_multiplier := v_damage_multiplier * 1.25$$
       in pg_get_functiondef(to_regprocedure(
         'public.update_1v1_state(uuid,numeric,integer,bigint,text)'
       ))
     ) = 0
     or position(
       $$v_target.character_key = 'runner_comet'$$
       in pg_get_functiondef(to_regprocedure(
         'public.send_1v1_attack(uuid,text,integer)'
       ))
     ) = 0
     or not exists (
       select 1 from pg_trigger trigger_row
       where trigger_row.tgrelid = 'public.multiplayer_matches'::regclass
         and trigger_row.tgname = 'settle_1v1_heatfeast_tax'
         and not trigger_row.tgisinternal
     )
     or not exists (
       select 1 from pg_trigger trigger_row
       where trigger_row.tgrelid = 'public.multiplayer_players'::regclass
         and trigger_row.tgname = 'settle_1v1_heatfeast_income_tax'
         and not trigger_row.tgisinternal
     ) then
    raise exception 'HEATFEAST threshold enforcement is incomplete';
  end if;
end;
$installation_assertions$;

notify pgrst, 'reload schema';
commit;

select
  to_regprocedure('public.activate_1v1_mirage(uuid,integer)')
    is not null as mirage_activation_installed,
  to_regprocedure('public.apply_1v1_mirage_damage(uuid,numeric)')
    is not null as mirage_damage_installed,
  to_regprocedure('public.consume_1v1_heatfeast(uuid,integer)')
    is not null as shared_heatfeast_installed,
  to_regprocedure('public.purchase_1v1_comet_removal(uuid,text,text)')
    is not null as comet_natural_removal_installed,
  to_regprocedure(
    'app_private.settle_1v1_heatfeast_tax()'
  ) is not null as heatfeast_tax_installed,
  position(
    $$'heatfeast_return'$$ in pg_get_functiondef(to_regprocedure(
      'public.send_1v1_attack(uuid,text,integer)'
    ))
  ) > 0 as heatfeast_split_installed,
  not has_table_privilege(
    'authenticated', 'public.multiplayer_heatfeast', 'SELECT'
  ) as heatfeast_ledger_private;
