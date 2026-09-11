-- Multi-device 06 -- server-owned 1v1 maps, map economy, and score results.
--
-- Forward-only, rerunnable delta.  Endless is intentionally untouched and
-- remains Classic in the browser.  This migration owns only online 1v1 state.
--
-- Frontend contract (all map keys are lowercase):
--   * set_1v1_map_priorities(text[]) accepts exactly two distinct map votes.
--   * get_1v1_map_priorities() returns configured, map_votes, the legacy
--     map_order alias, and catalog.
--   * Matchmaking has no hidden fixed map weights. One shared vote wins; two
--     shared votes are chosen uniformly; no overlap is chosen uniformly from
--     the four distinct votes.
--   * join_1v1_queue(...) adds map_key and map_rules to its existing JSON.
--   * get_1v1_state(uuid) adds map metadata, mushroom/death/katana fields,
--     a caller-relative outcome, and server-selected pending-attack lanes.
--   * award_1v1_mushroom(uuid, integer, text) accepts match, wave, pickup id.
--   * reflect_1v1_attack(uuid, text, text) accepts match, idempotency token,
--     obstacle kind.  It is for Pitch collision resolution, including rocks.
--     The four-argument overload additionally consumes a server-sent attack;
--     natural obstacles use the three-argument form.
--   * update_1v1_state keeps its legacy signature.  The first eliminated player
--     stops while the match remains live; the second receives exactly 280 score,
--     then the server chooses the higher score or records a draw.
--   * sync_1v1_score cannot advance an eliminated/left/finished player score.
--   * activate_1v1_zenith_time_stop(uuid, bigint) accepts the caller's latest
--     score before applying Zenith's one-use, server-bounded 15,000 bonus.
--   * leave_1v1 delegates active matches to the protected finish_1v1 path, so
--     an eliminated caller can disconnect without truncating the survivor run.
--   * pending_attacks[].lane_index is authoritative.  Paid/reflected attacks
--     must not be passed through a client planner that preserves a safe lane.
--   * Point-award constraints and function locals do not block a later
--     character migration from retaining every fractional earning exactly.

begin;

do $$
begin
  if to_regclass('public.multiplayer_matches') is null
     or to_regclass('public.multiplayer_players') is null
     or to_regclass('public.multiplayer_attacks') is null
     or to_regclass('public.multiplayer_point_events') is null
     or to_regclass('public.player_progression_1v1_activity') is null
     or to_regclass('public.player_unlocks') is null
     or to_regprocedure(
       'public.update_1v1_state(uuid,numeric,integer,bigint,text)'
     ) is null
     or to_regprocedure(
       'public.award_1v1_points(uuid,text,integer,text)'
     ) is null
     or to_regprocedure('public.join_1v1_queue(text)') is null then
    raise exception
      'Run Multi-device 05, Player 06, and Player 07 first';
  end if;
end;
$$;

-- This private catalog is the single server source for matchmaking, rewards,
-- attack availability, spawn weights, and the rules returned to clients.
create table if not exists app_private.one_v_one_map_rules (
  map_key text primary key,
  sort_order smallint not null unique,
  display_name text not null unique,
  lane_count smallint not null check (lane_count between 3 and 7),
  obstacle_scaling text not null
    check (obstacle_scaling in ('normal', 'same_total', 'same_per_lane')),
  healing_enabled boolean not null,
  coin_point_reward smallint not null
    check (coin_point_reward between 1 and 20),
  wave_point_reward smallint not null
    check (wave_point_reward between 0 and 20),
  allowed_attacks text[] not null,
  allowed_character_classes text[] not null,
  forced_character_key text,
  natural_spawn_weights jsonb not null,
  gameplay_rules jsonb not null,
  check (map_key in (
    'classic', 'alley', 'desert', 'skyway',
    'pitch', 'volcano', 'factory', 'grove'
  )),
  check (cardinality(allowed_attacks) > 0),
  check (cardinality(allowed_character_classes) > 0),
  check (jsonb_typeof(natural_spawn_weights) = 'object'),
  check (jsonb_typeof(gameplay_rules) = 'object')
);

revoke all on table app_private.one_v_one_map_rules
  from public, anon, authenticated;

insert into app_private.one_v_one_map_rules(
  map_key, sort_order, display_name, lane_count, obstacle_scaling,
  healing_enabled, coin_point_reward, wave_point_reward, allowed_attacks,
  allowed_character_classes, forced_character_key, natural_spawn_weights,
  gameplay_rules
) values
  (
    'classic', 1, 'Classic', 5, 'normal', true, 6, 8,
    array['log','barrel','snowflake','spike','car','rock']::text[],
    array['runner','medic','tank','trickster','misc']::text[], null,
    '{"log":30,"spike":30,"barrel":15,"rock":15,"snowflake":10}'::jsonb,
    jsonb_build_object(
      'hp_multiplier', 1, 'hp_bonus', 0, 'snowflake_enabled', true,
      'katana_enabled', false, 'mushrooms_enabled', false
    )
  ),
  (
    'alley', 2, 'Alley', 3, 'same_total', true, 7, 7,
    array['log','barrel','snowflake','spike','car','rock']::text[],
    array['runner','medic','tank','trickster','misc']::text[], null,
    '{"log":40,"spike":25,"rock":20,"barrel":10,"snowflake":5}'::jsonb,
    jsonb_build_object(
      'hp_multiplier', 2, 'hp_bonus', 0, 'snowflake_enabled', true,
      'obstacle_damage_multiplier', 1, 'katana_enabled', false,
      'mushrooms_enabled', false
    )
  ),
  (
    'desert', 3, 'Desert', 7, 'same_total', false, 5, 5,
    array['log','barrel','spike','car','rock']::text[],
    array['runner','trickster']::text[], null,
    '{"log":25,"spike":25,"barrel":30,"rock":20}'::jsonb,
    jsonb_build_object(
      'hp_multiplier', 1, 'hp_bonus', 0, 'snowflake_enabled', false,
      'katana_enabled', false, 'mushrooms_enabled', false,
      'illegal_character_fallback', 'runner_ace'
    )
  ),
  (
    'skyway', 4, 'Skyway', 6, 'same_total', true, 5, 5,
    array['log','barrel','snowflake','current','spike','car','rock']::text[],
    array['runner','medic','tank','misc']::text[], null,
    '{"log":25,"spike":25,"barrel":5,"rock":10,"snowflake":20,"current":15}'::jsonb,
    jsonb_build_object(
      'hp_multiplier', 1, 'hp_bonus', 0, 'snowflake_enabled', true,
      'katana_enabled', false, 'mushrooms_enabled', false,
      'illegal_character_fallback', 'runner_ace',
      'current', jsonb_build_object(
        'speed_relative_to_barrel', 0.95, 'allowed_lanes', jsonb_build_array(1,2,3,4),
        'direct_damage', 0.5, 'edge_adjacent_damage', 1,
        'pushes_adjacent_non_edge_player', true,
        'ignores_frozen_movement_delay', true
      )
    )
  ),
  (
    'pitch', 5, 'Pitch', 6, 'same_total', true, 6, 6,
    array['log','barrel','snowflake','spike','car','rock']::text[],
    array['runner','medic','tank','trickster','misc']::text[], null,
    '{"log":25,"spike":30,"barrel":20,"rock":20,"snowflake":5}'::jsonb,
    jsonb_build_object(
      'hp_multiplier', 1, 'hp_bonus', 0, 'snowflake_enabled', true,
      'mushrooms_enabled', false,
      'katana_enabled', true, 'katana_active_seconds', 0.4,
      'katana_cooldown_seconds', 6, 'katana_post_lock_seconds', 0.1,
      'katana_miss_damage', 0.5, 'katana_rock_breaks', true,
      'katana_blocked_while_frozen', true,
      'katana_cooldown_resets_each_wave', true
    )
  ),
  (
    'volcano', 6, 'Volcano', 7, 'same_total', true, 5, 5,
    array['log','barrel','spike','car','rock']::text[],
    array['runner']::text[], 'runner_ace',
    '{"log":15,"spike":20,"barrel":25,"rock":40}'::jsonb,
    jsonb_build_object(
      'hp_multiplier', 1, 'hp_bonus', 0, 'snowflake_enabled', false,
      'katana_enabled', false, 'mushrooms_enabled', false,
      'forced_character_key', 'runner_ace', 'turn_delay_seconds', 0.15,
      'lane_burn_grace_seconds', 1, 'lane_burn_interval_seconds', 1,
      'lane_burn_damage', 0.5
    )
  ),
  (
    'factory', 7, 'Factory', 4, 'same_per_lane', true, 5, 5,
    array['log','barrel','snowflake','spike','car','rock']::text[],
    array['runner','medic','tank','trickster','misc']::text[], null,
    '{"log":15,"spike":30,"barrel":5,"rock":35,"snowflake":5,"car":10}'::jsonb,
    jsonb_build_object(
      'hp_multiplier', 1, 'hp_bonus', 0, 'snowflake_enabled', true,
      'katana_enabled', false, 'mushrooms_enabled', false,
      'conveyor', jsonb_build_object(
        'one_lane_per_wave', true,
        'speed_multipliers', jsonb_build_array(0.5, 2)
      )
    )
  ),
  (
    'grove', 8, 'Grove', 6, 'same_per_lane', true, 5, 0,
    array['log','barrel','spike','car','rock']::text[],
    array['runner','medic','tank','trickster','misc']::text[], null,
    '{"log":30,"spike":20,"barrel":15,"rock":20,"mushroom":15}'::jsonb,
    jsonb_build_object(
      'hp_multiplier', 1, 'hp_bonus', 1, 'snowflake_enabled', false,
      'katana_enabled', false, 'mushrooms_enabled', true,
      'mushroom_score', 120, 'wave_more_mushrooms_points', 14,
      'wave_tied_mushrooms_points_each', 7,
      'wave_fewer_mushrooms_damage', 1,
      'mushroom_comparison_after_healing', true
    )
  )
on conflict (map_key) do update set
  sort_order = excluded.sort_order,
  display_name = excluded.display_name,
  lane_count = excluded.lane_count,
  obstacle_scaling = excluded.obstacle_scaling,
  healing_enabled = excluded.healing_enabled,
  coin_point_reward = excluded.coin_point_reward,
  wave_point_reward = excluded.wave_point_reward,
  allowed_attacks = excluded.allowed_attacks,
  allowed_character_classes = excluded.allowed_character_classes,
  forced_character_key = excluded.forced_character_key,
  natural_spawn_weights = excluded.natural_spawn_weights,
  gameplay_rules = excluded.gameplay_rules;

create or replace function app_private.one_v_one_map_rules_json(p_map_key text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'map_key', rules.map_key,
    'display_name', rules.display_name,
    'lane_count', rules.lane_count,
    'obstacle_scaling', rules.obstacle_scaling,
    'healing_enabled', rules.healing_enabled,
    'coin_point_reward', rules.coin_point_reward,
    'wave_point_reward', rules.wave_point_reward,
    'allowed_attacks', to_jsonb(rules.allowed_attacks),
    'allowed_character_classes', to_jsonb(rules.allowed_character_classes),
    'forced_character_key', rules.forced_character_key,
    'natural_spawn_weights', rules.natural_spawn_weights,
    'attack_costs', jsonb_build_object(
      'log', 6, 'barrel', 6, 'snowflake', 7, 'current', 7,
      'spike', 8, 'car', 8, 'rock', 8
    ),
    'gameplay', rules.gameplay_rules
  )
  from app_private.one_v_one_map_rules rules
  where rules.map_key = lower(trim(p_map_key));
$$;

revoke all on function app_private.one_v_one_map_rules_json(text)
  from public, anon, authenticated;

create or replace function public.get_1v1_map_catalog()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      app_private.one_v_one_map_rules_json(rules.map_key)
      order by rules.sort_order
    ),
    '[]'::jsonb
  )
  from app_private.one_v_one_map_rules rules;
$$;

create table if not exists public.player_1v1_map_priorities (
  user_id uuid not null references auth.users(id) on delete cascade,
  map_key text not null,
  priority smallint not null check (priority between 1 and 2),
  updated_at timestamptz not null default now(),
  primary key (user_id, map_key),
  unique (user_id, priority),
  check (map_key in (
    'classic', 'alley', 'desert', 'skyway',
    'pitch', 'volcano', 'factory', 'grove'
  ))
);

-- Reruns also upgrade accounts that previously stored an eight-map ordering.
delete from public.player_1v1_map_priorities
where priority > 2;
alter table public.player_1v1_map_priorities
  drop constraint if exists player_1v1_map_priorities_priority_check;
alter table public.player_1v1_map_priorities
  add constraint player_1v1_map_priorities_priority_check
    check (priority between 1 and 2) not valid;
alter table public.player_1v1_map_priorities
  validate constraint player_1v1_map_priorities_priority_check;

alter table public.player_1v1_map_priorities enable row level security;
revoke all on table public.player_1v1_map_priorities
  from public, anon, authenticated;

comment on table public.player_1v1_map_priorities is
  'Private per-account online 1v1 map votes. Each configured player selects exactly two distinct maps; missing votes are safely randomized by matchmaking.';

create or replace function public.set_1v1_map_priorities(p_map_order text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_order text[];
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  if p_map_order is null or cardinality(p_map_order) <> 2 then
    raise exception 'Choose exactly two maps to vote for';
  end if;

  select array_agg(lower(trim(item.map_key)) order by item.ordinality)
  into v_order
  from unnest(p_map_order) with ordinality as item(map_key, ordinality);

  if exists (select 1 from unnest(v_order) item where item is null or item = '')
     or (select count(distinct item) from unnest(v_order) item) <> 2
     or exists (
       select 1 from unnest(v_order) item
       where item not in (
         'classic', 'alley', 'desert', 'skyway',
         'pitch', 'volcano', 'factory', 'grove'
       )
     ) then
    raise exception 'Choose exactly two different maps from the map list';
  end if;

  delete from public.player_1v1_map_priorities where user_id = v_uid;
  insert into public.player_1v1_map_priorities(
    user_id, map_key, priority, updated_at
  )
  select v_uid, item.map_key, item.ordinality::smallint, now()
  from unnest(v_order) with ordinality as item(map_key, ordinality);

  return jsonb_build_object(
    'configured', true,
    'map_votes', to_jsonb(v_order),
    'map_order', to_jsonb(v_order),
    'max_selections', 2,
    'catalog', public.get_1v1_map_catalog()
  );
end;
$$;

create or replace function public.get_1v1_map_priorities()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_order text[];
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  select array_agg(priority.map_key order by priority.priority)
  into v_order
  from public.player_1v1_map_priorities priority
  where priority.user_id = v_uid;

  return jsonb_build_object(
    'configured', coalesce(cardinality(v_order), 0) = 2,
    'map_votes', coalesce(to_jsonb(v_order), '[]'::jsonb),
    'map_order', coalesce(to_jsonb(v_order), '[]'::jsonb),
    'max_selections', 2,
    'catalog', public.get_1v1_map_catalog()
  );
end;
$$;

-- Each player votes for two distinct maps. A single shared vote is selected;
-- matching pairs are chosen uniformly; disjoint pairs are chosen uniformly
-- from their four-map union. Missing/incomplete settings receive two random
-- distinct votes so matchmaking can never fail on a legacy account.
create or replace function app_private.choose_1v1_map(
  p_player_one uuid,
  p_player_two uuid
)
returns table(map_key text, selection_method text, candidates text[])
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_all constant text[] :=
    array['classic','alley','desert','skyway','pitch','volcano','factory','grove']::text[];
  v_one_votes text[];
  v_two_votes text[];
  v_shared text[];
  v_pool text[];
  v_method text;
begin
  select array_agg(vote.map_key order by vote.priority)
  into v_one_votes
  from public.player_1v1_map_priorities vote
  where vote.user_id = p_player_one;

  if coalesce(cardinality(v_one_votes), 0) <> 2 then
    select array_agg(sample.map_key)
    into v_one_votes
    from (
      select item.map_key
      from unnest(v_all) item(map_key)
      order by random()
      limit 2
    ) sample;
  end if;

  select array_agg(vote.map_key order by vote.priority)
  into v_two_votes
  from public.player_1v1_map_priorities vote
  where vote.user_id = p_player_two;

  if coalesce(cardinality(v_two_votes), 0) <> 2 then
    select array_agg(sample.map_key)
    into v_two_votes
    from (
      select item.map_key
      from unnest(v_all) item(map_key)
      order by random()
      limit 2
    ) sample;
  end if;

  select array_agg(item order by item)
  into v_shared
  from unnest(v_one_votes) item
  where item = any(v_two_votes);

  if coalesce(cardinality(v_shared), 0) > 0 then
    v_pool := v_shared;
    v_method := 'votes_overlap';
  else
    select array_agg(distinct_votes.item order by distinct_votes.item)
    into v_pool
    from (
      select distinct candidate.item
      from unnest(v_one_votes || v_two_votes) candidate(item)
    ) distinct_votes;
    v_method := 'votes_union';
  end if;

  return query
  select v_pool[1 + floor(random() * cardinality(v_pool))::integer],
         v_method,
         v_pool;
end;
$$;

revoke all on function app_private.choose_1v1_map(uuid, uuid)
  from public, anon, authenticated;

-- Persist the selected ruleset and enough selection evidence to reconnect and
-- audit a match without rerolling anything.
alter table public.multiplayer_matches
  add column if not exists map_key text not null default 'classic',
  add column if not exists map_selection_method text not null default 'legacy_default',
  add column if not exists map_candidates text[] not null default array['classic']::text[];

alter table public.multiplayer_matches
  drop constraint if exists multiplayer_matches_map_key_check,
  drop constraint if exists multiplayer_matches_map_selection_method_check,
  drop constraint if exists multiplayer_matches_map_candidates_check;
alter table public.multiplayer_matches
  add constraint multiplayer_matches_map_key_check check (map_key in (
    'classic', 'alley', 'desert', 'skyway',
    'pitch', 'volcano', 'factory', 'grove'
  )) not valid,
  add constraint multiplayer_matches_map_selection_method_check check (
    map_selection_method in (
      'legacy_default', 'fixed', 'preferences', 'preferences_shared_last',
      'votes_overlap', 'votes_union'
    )
  ) not valid,
  add constraint multiplayer_matches_map_candidates_check check (
    cardinality(map_candidates) between 1 and 4
  ) not valid;
alter table public.multiplayer_matches
  validate constraint multiplayer_matches_map_key_check;
alter table public.multiplayer_matches
  validate constraint multiplayer_matches_map_selection_method_check;
alter table public.multiplayer_matches
  validate constraint multiplayer_matches_map_candidates_check;

-- Player rows retain their existing character snapshot, but now support the
-- 12-heart Alley ceiling, Grove mushrooms, a two-death result, reported lane,
-- and Pitch's per-wave katana cooldown/break state.
alter table public.multiplayer_players
  add column if not exists mushrooms_collected integer not null default 0,
  add column if not exists eliminated_at timestamptz,
  add column if not exists death_order smallint,
  add column if not exists second_death_bonus_awarded boolean not null default false,
  add column if not exists lane_index smallint,
  add column if not exists last_position_at timestamptz,
  add column if not exists last_katana_at timestamptz,
  add column if not exists last_katana_wave integer,
  add column if not exists katana_broken boolean not null default false,
  add column if not exists zenith_time_stop_until timestamptz,
  add column if not exists zenith_time_stop_used boolean not null default false,
  add column if not exists obstacle_speed_multiplier numeric(8,4)
    not null default 1;

with ordered_deaths as (
  select player.match_id, player.user_id,
         row_number() over (
           partition by player.match_id
           order by player.updated_at, player.user_id
         )::smallint as inferred_order
  from public.multiplayer_players player
  where player.status = 'eliminated'
)
update public.multiplayer_players player
set eliminated_at = coalesce(player.eliminated_at, player.updated_at),
    death_order = coalesce(player.death_order, ordered.inferred_order)
from ordered_deaths ordered
where player.match_id = ordered.match_id
  and player.user_id = ordered.user_id
  and (player.eliminated_at is null or player.death_order is null);

alter table public.multiplayer_players
  drop constraint if exists multiplayer_players_max_hearts_check,
  drop constraint if exists multiplayer_players_hearts_check,
  drop constraint if exists multiplayer_players_hearts_within_character_max_check,
  drop constraint if exists multiplayer_players_mushrooms_collected_check,
  drop constraint if exists multiplayer_players_death_order_check,
  drop constraint if exists multiplayer_players_lane_index_check,
  drop constraint if exists multiplayer_players_last_katana_wave_check,
  drop constraint if exists multiplayer_players_obstacle_speed_multiplier_check;
alter table public.multiplayer_players
  add constraint multiplayer_players_max_hearts_check
    check (max_hearts between 1 and 12) not valid,
  add constraint multiplayer_players_hearts_check
    check (hearts between 0 and 12) not valid,
  add constraint multiplayer_players_hearts_within_character_max_check
    check (hearts <= max_hearts) not valid,
  add constraint multiplayer_players_mushrooms_collected_check
    check (mushrooms_collected >= 0) not valid,
  add constraint multiplayer_players_death_order_check
    check (death_order is null or death_order in (1, 2)) not valid,
  add constraint multiplayer_players_lane_index_check
    check (lane_index is null or lane_index between 0 and 6) not valid,
  add constraint multiplayer_players_last_katana_wave_check
    check (last_katana_wave is null or last_katana_wave >= 1) not valid,
  add constraint multiplayer_players_obstacle_speed_multiplier_check
    check (obstacle_speed_multiplier > 0 and obstacle_speed_multiplier <= 1)
    not valid;
alter table public.multiplayer_players
  validate constraint multiplayer_players_max_hearts_check;
alter table public.multiplayer_players
  validate constraint multiplayer_players_hearts_check;
alter table public.multiplayer_players
  validate constraint multiplayer_players_hearts_within_character_max_check;
alter table public.multiplayer_players
  validate constraint multiplayer_players_mushrooms_collected_check;
alter table public.multiplayer_players
  validate constraint multiplayer_players_death_order_check;
alter table public.multiplayer_players
  validate constraint multiplayer_players_lane_index_check;
alter table public.multiplayer_players
  validate constraint multiplayer_players_last_katana_wave_check;
alter table public.multiplayer_players
  validate constraint multiplayer_players_obstacle_speed_multiplier_check;

create unique index if not exists multiplayer_players_match_death_order_uidx
  on public.multiplayer_players(match_id, death_order)
  where death_order is not null;

-- Existing paid attacks are normalized to the authoritative 6/7/8 economy.
-- Reflected Pitch attacks use zero cost and are explicitly marked as katana.
alter table public.multiplayer_attacks
  add column if not exists source text not null default 'purchased',
  add column if not exists lane_index smallint,
  add column if not exists lane_group integer,
  add column if not exists lane_position smallint,
  add column if not exists escape_lane_index smallint,
  add column if not exists wall_parity smallint,
  add column if not exists wall_lane_index smallint,
  add column if not exists wall_size smallint;

alter table public.multiplayer_attacks
  drop constraint if exists multiplayer_attacks_obstacle_type_check,
  drop constraint if exists multiplayer_attacks_point_cost_check,
  drop constraint if exists multiplayer_attacks_source_check,
  drop constraint if exists multiplayer_attacks_lane_index_check,
  drop constraint if exists multiplayer_attacks_lane_group_check,
  drop constraint if exists multiplayer_attacks_lane_position_check,
  drop constraint if exists multiplayer_attacks_escape_lane_index_check,
  drop constraint if exists multiplayer_attacks_wall_parity_check,
  drop constraint if exists multiplayer_attacks_wall_lane_index_check,
  drop constraint if exists multiplayer_attacks_wall_size_check,
  drop constraint if exists multiplayer_attacks_wall_shape_check,
  drop constraint if exists multiplayer_attacks_source_cost_check;

update public.multiplayer_attacks
set point_cost = case obstacle_type
  when 'log' then 6
  when 'barrel' then 6
  when 'snowflake' then 7
  when 'spike' then 8
  when 'car' then 8
  when 'rock' then 8
  else point_cost
end
where source = 'purchased';

alter table public.multiplayer_attacks
  add constraint multiplayer_attacks_obstacle_type_check check (
    obstacle_type in ('barrel','log','car','snowflake','current','spike','rock')
  ) not valid,
  add constraint multiplayer_attacks_point_cost_check check (
    point_cost in (0, 6, 7, 8)
  ) not valid,
  add constraint multiplayer_attacks_source_check check (
    source in ('purchased', 'katana')
  ) not valid,
  add constraint multiplayer_attacks_lane_index_check check (
    lane_index is null or lane_index between 0 and 6
  ) not valid,
  add constraint multiplayer_attacks_lane_group_check check (
    lane_group is null or lane_group >= 1
  ) not valid,
  add constraint multiplayer_attacks_lane_position_check check (
    lane_position is null or lane_position between 0 and 3
  ) not valid,
  add constraint multiplayer_attacks_escape_lane_index_check check (
    escape_lane_index is null or escape_lane_index between 0 and 6
  ) not valid,
  add constraint multiplayer_attacks_wall_parity_check check (
    wall_parity is null or wall_parity in (0, 1)
  ) not valid,
  add constraint multiplayer_attacks_wall_lane_index_check check (
    wall_lane_index is null or wall_lane_index between 0 and 6
  ) not valid,
  add constraint multiplayer_attacks_wall_size_check check (
    wall_size is null or wall_size between 1 and 4
  ) not valid,
  add constraint multiplayer_attacks_wall_shape_check check (
    (wall_parity is null and wall_lane_index is null and wall_size is null)
    or (
      wall_parity is not null
      and wall_lane_index is not null
      and wall_size is not null
      and mod(wall_lane_index, 2) = wall_parity
      and lane_position < wall_size
    )
  ) not valid,
  add constraint multiplayer_attacks_source_cost_check check (
    (source = 'purchased' and point_cost in (6, 7, 8))
    or (source = 'katana' and point_cost = 0)
  ) not valid;
alter table public.multiplayer_attacks
  validate constraint multiplayer_attacks_obstacle_type_check;
alter table public.multiplayer_attacks
  validate constraint multiplayer_attacks_point_cost_check;
alter table public.multiplayer_attacks
  validate constraint multiplayer_attacks_source_check;
alter table public.multiplayer_attacks
  validate constraint multiplayer_attacks_lane_index_check;
alter table public.multiplayer_attacks
  validate constraint multiplayer_attacks_lane_group_check;
alter table public.multiplayer_attacks
  validate constraint multiplayer_attacks_lane_position_check;
alter table public.multiplayer_attacks
  validate constraint multiplayer_attacks_escape_lane_index_check;
alter table public.multiplayer_attacks
  validate constraint multiplayer_attacks_wall_parity_check;
alter table public.multiplayer_attacks
  validate constraint multiplayer_attacks_wall_lane_index_check;
alter table public.multiplayer_attacks
  validate constraint multiplayer_attacks_wall_size_check;
alter table public.multiplayer_attacks
  validate constraint multiplayer_attacks_wall_shape_check;
alter table public.multiplayer_attacks
  validate constraint multiplayer_attacks_source_cost_check;

alter table public.multiplayer_point_events
  drop constraint if exists multiplayer_point_events_points_awarded_check;
alter table public.multiplayer_point_events
  add constraint multiplayer_point_events_points_awarded_check
    check (points_awarded > 0 and points_awarded <= 1000000) not valid;
alter table public.multiplayer_point_events
  validate constraint multiplayer_point_events_points_awarded_check;

create table if not exists public.multiplayer_mushroom_events (
  match_id uuid not null,
  user_id uuid not null,
  pickup_id text not null,
  wave integer not null check (wave >= 1),
  score_awarded integer not null default 120 check (score_awarded = 120),
  created_at timestamptz not null default now(),
  primary key (match_id, user_id, pickup_id),
  foreign key (match_id, user_id)
    references public.multiplayer_players(match_id, user_id) on delete cascade,
  check (length(pickup_id) between 1 and 160)
);
create index if not exists multiplayer_mushroom_events_wave_idx
  on public.multiplayer_mushroom_events(match_id, wave, user_id);
alter table public.multiplayer_mushroom_events enable row level security;
revoke all on table public.multiplayer_mushroom_events
  from public, anon, authenticated;

create table if not exists public.multiplayer_grove_wave_results (
  match_id uuid not null references public.multiplayer_matches(id) on delete cascade,
  wave integer not null check (wave >= 1),
  player_one_user_id uuid not null references auth.users(id) on delete cascade,
  player_two_user_id uuid not null references auth.users(id) on delete cascade,
  player_one_mushrooms integer not null check (player_one_mushrooms >= 0),
  player_two_mushrooms integer not null check (player_two_mushrooms >= 0),
  player_one_points numeric not null,
  player_two_points numeric not null,
  penalized_user_id uuid references auth.users(id) on delete set null,
  settled_at timestamptz not null default now(),
  primary key (match_id, wave),
  check (player_one_user_id <> player_two_user_id),
  check (
    penalized_user_id is null
    or penalized_user_id = player_one_user_id
    or penalized_user_id = player_two_user_id
  )
);
alter table public.multiplayer_grove_wave_results
  drop constraint if exists
    multiplayer_grove_wave_results_player_one_points_check,
  drop constraint if exists
    multiplayer_grove_wave_results_player_two_points_check;
alter table public.multiplayer_grove_wave_results
  alter column player_one_points type numeric
    using player_one_points::numeric,
  alter column player_two_points type numeric
    using player_two_points::numeric;
alter table public.multiplayer_grove_wave_results
  add constraint multiplayer_grove_wave_results_player_one_points_check
    check (player_one_points >= 0) not valid,
  add constraint multiplayer_grove_wave_results_player_two_points_check
    check (player_two_points >= 0) not valid;
alter table public.multiplayer_grove_wave_results
  validate constraint multiplayer_grove_wave_results_player_one_points_check;
alter table public.multiplayer_grove_wave_results
  validate constraint multiplayer_grove_wave_results_player_two_points_check;
alter table public.multiplayer_grove_wave_results enable row level security;
revoke all on table public.multiplayer_grove_wave_results
  from public, anon, authenticated;

create table if not exists public.multiplayer_katana_events (
  match_id uuid not null,
  user_id uuid not null,
  reflection_id text not null,
  wave integer not null check (wave >= 1),
  obstacle_type text not null
    check (obstacle_type in ('barrel','log','car','snowflake','spike','rock')),
  outcome text not null check (outcome in ('reflected', 'broken')),
  source_attack_id uuid references public.multiplayer_attacks(id)
    on delete set null,
  attack_id uuid references public.multiplayer_attacks(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (match_id, user_id, reflection_id),
  foreign key (match_id, user_id)
    references public.multiplayer_players(match_id, user_id) on delete cascade,
  check (length(reflection_id) between 1 and 160)
);
alter table public.multiplayer_katana_events
  add column if not exists source_attack_id uuid
    references public.multiplayer_attacks(id) on delete set null;
create index if not exists multiplayer_katana_events_recent_idx
  on public.multiplayer_katana_events(match_id, user_id, created_at desc);
alter table public.multiplayer_katana_events enable row level security;
revoke all on table public.multiplayer_katana_events
  from public, anon, authenticated;

comment on column public.multiplayer_attacks.lane_index is
  'Zero-based, server-selected lane. Clients must honor it for paid/reflected attacks.';
comment on column public.multiplayer_attacks.lane_group is
  'Server wall number. Consecutive completed walls alternate hazard parity.';
comment on column public.multiplayer_attacks.wall_parity is
  'Logical checkerboard hazard parity (lane modulo 2); the next wall flips it.';
comment on column public.multiplayer_attacks.wall_lane_index is
  'Logical lane covered by this wall member. Skyway Current may occupy the adjacent legal lane to cover an edge.';
comment on column public.multiplayer_attacks.wall_size is
  'Number of logical parity lanes in this wall, always between one and four.';
comment on column public.multiplayer_players.melons_collected is
  'Legacy column name retained for compatibility; counts 1v1 attack-coin pickups.';
comment on column public.multiplayer_players.mushrooms_collected is
  'Grove mushrooms only; each accepted receipt also contributes 120 authoritative score.';

-- The match-row lock held by every caller serializes placement. Each group is
-- one checkerboard wall: every logical lane of one parity, at most four on a
-- seven-lane map. The next completed wall flips parity, so every opening in
-- the prior wall is covered instead of leaving a permanently campable lane.
-- A partially purchased final wall simply contains the leading subset, with
-- the reported/prior escape lane assigned first so even one attack pressures
-- the runner. Skyway Current keeps the same logical wall but maps logical edge
-- coverage to legal lanes 1/4; its central escapes alternate 3 <-> 2.
create or replace function app_private.next_1v1_attack_placement(
  p_match_id uuid,
  p_sender_user_id uuid,
  p_target_user_id uuid,
  p_obstacle_type text
)
returns table(
  lane_index smallint,
  lane_group integer,
  lane_position smallint,
  escape_lane_index smallint,
  wall_parity smallint,
  wall_lane_index smallint,
  wall_size smallint
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_map_key text;
  v_lane_count integer;
  v_spawn_wave integer;
  v_target_lane integer;
  v_group integer;
  v_position integer;
  v_parity integer;
  v_size integer;
  v_last_group integer;
  v_last_parity integer;
  v_last_size integer;
  v_last_count integer := 0;
  v_last_escape integer;
  v_wall_lanes integer[];
  v_logical_lane integer;
  v_chosen integer;
  v_escape integer;
  v_pressure_lane integer;
  v_adjacent_escapes integer[];
  v_start_new_group boolean := true;
begin
  select match.map_key, rules.lane_count, match.current_wave,
         target.lane_index
  into v_map_key, v_lane_count, v_spawn_wave, v_target_lane
  from public.multiplayer_matches match
  join app_private.one_v_one_map_rules rules on rules.map_key = match.map_key
  join public.multiplayer_players target
    on target.match_id = match.id and target.user_id = p_target_user_id
  where match.id = p_match_id;

  if v_lane_count is null then raise exception '1v1 map not found'; end if;

  -- Find the latest wall for this direction and wave. Legacy rows without
  -- wall metadata are left untouched; the next attack starts a fresh wall.
  select attack.lane_group, attack.wall_parity, attack.wall_size,
         attack.escape_lane_index
  into v_last_group, v_last_parity, v_last_size, v_last_escape
  from public.multiplayer_attacks attack
  where attack.match_id = p_match_id
    and attack.sender_user_id = p_sender_user_id
    and attack.target_user_id = p_target_user_id
    and attack.spawn_wave = v_spawn_wave
    and attack.lane_group is not null
  order by attack.lane_group desc, attack.lane_position desc,
           attack.created_at desc, attack.id desc
  limit 1;

  if v_last_group is not null
     and v_last_parity is not null
     and v_last_size is not null then
    select count(*)::integer into v_last_count
    from public.multiplayer_attacks attack
    where attack.match_id = p_match_id
      and attack.sender_user_id = p_sender_user_id
      and attack.target_user_id = p_target_user_id
      and attack.spawn_wave = v_spawn_wave
      and attack.lane_group = v_last_group
      and attack.wall_parity = v_last_parity;
    v_start_new_group := v_last_count >= v_last_size;
  end if;

  if v_start_new_group then
    v_group := coalesce(v_last_group, 0) + 1;
    v_position := 0;
    if v_last_parity is not null then
      v_parity := 1 - v_last_parity;
    else
      v_parity := mod(
        coalesce(
          v_target_lane,
          floor(random() * v_lane_count)::integer
        ),
        2
      );
    end if;

    -- A current lane report wins when it belongs to this wall. Otherwise the
    -- prior advertised opening is guaranteed to have the newly flipped parity.
    if v_target_lane is not null and mod(v_target_lane, 2) = v_parity then
      v_pressure_lane := v_target_lane;
    elsif v_last_escape is not null
          and mod(v_last_escape, 2) = v_parity then
      v_pressure_lane := v_last_escape;
    end if;
  else
    v_group := v_last_group;
    v_position := v_last_count;
    v_parity := v_last_parity;
    v_size := v_last_size;
    v_escape := v_last_escape;
    select attack.wall_lane_index into v_pressure_lane
    from public.multiplayer_attacks attack
    where attack.match_id = p_match_id
      and attack.sender_user_id = p_sender_user_id
      and attack.target_user_id = p_target_user_id
      and attack.spawn_wave = v_spawn_wave
      and attack.lane_group = v_group
      and attack.lane_position = 0
      and attack.wall_lane_index is not null
    order by attack.created_at, attack.id
    limit 1;
  end if;

  select array_agg(
    lane order by
      case when lane = v_pressure_lane then 0 else 1 end,
      abs(lane - coalesce(v_pressure_lane, lane)),
      lane
  )
  into v_wall_lanes
  from generate_series(0, v_lane_count - 1) lane
  where mod(lane, 2) = v_parity;
  v_size := coalesce(v_size, cardinality(v_wall_lanes));
  if v_size < 1 or v_size > 4 or v_position >= v_size then
    raise exception 'Invalid 1v1 checkerboard wall';
  end if;
  v_logical_lane := v_wall_lanes[v_position + 1];
  v_pressure_lane := coalesce(v_pressure_lane, v_logical_lane);

  if v_start_new_group then
    if v_map_key = 'skyway' then
      -- These are the only lanes that remain non-damaging if every member of
      -- the parity wall happens to be a Current. They flip by one lane, making
      -- the route reachable while never advertising Current-damaged edges.
      v_escape := case when v_parity = 0 then 3 else 2 end;
    else
      select array_agg(lane order by random()) into v_adjacent_escapes
      from generate_series(0, v_lane_count - 1) lane
      where mod(lane, 2) <> v_parity
        and abs(lane - v_pressure_lane) = 1;
      if coalesce(cardinality(v_adjacent_escapes), 0) = 0 then
        raise exception 'No reachable 1v1 checkerboard opening';
      end if;
      v_escape := v_adjacent_escapes[1];
    end if;
  end if;

  -- Current can occupy only lanes 1..4. Mapping a logical edge to its adjacent
  -- legal lane still pressures that edge via Current's one-damage rule. The
  -- parity metadata retains which opening the next wall must cover.
  v_chosen := case
    when p_obstacle_type = 'current' and v_logical_lane = 0 then 1
    when p_obstacle_type = 'current'
      and v_logical_lane = v_lane_count - 1 then v_lane_count - 2
    else v_logical_lane
  end;
  if p_obstacle_type = 'current' and v_chosen not between 1 and 4 then
    raise exception 'Current has no safe legal lane for this wall';
  end if;

  return query
  select v_chosen::smallint, v_group, v_position::smallint,
         v_escape::smallint, v_parity::smallint, v_logical_lane::smallint,
         v_size::smallint;
end;
$$;

revoke all on function app_private.next_1v1_attack_placement(
  uuid, uuid, uuid, text
) from public, anon, authenticated;

create or replace function app_private.mark_1v1_eliminated(
  p_match_id uuid,
  p_user_id uuid,
  p_now timestamptz
)
returns smallint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing smallint;
  v_prior_deaths integer;
  v_order smallint;
begin
  select player.death_order into v_existing
  from public.multiplayer_players player
  where player.match_id = p_match_id and player.user_id = p_user_id;
  if v_existing is not null then return v_existing; end if;

  select count(*) into v_prior_deaths
  from public.multiplayer_players player
  where player.match_id = p_match_id and player.eliminated_at is not null;
  v_order := least(v_prior_deaths + 1, 2)::smallint;

  update public.multiplayer_players player
  set hearts = 0,
      status = 'eliminated',
      eliminated_at = coalesce(player.eliminated_at, p_now),
      death_order = coalesce(player.death_order, v_order),
      updated_at = p_now
  where player.match_id = p_match_id and player.user_id = p_user_id;
  return v_order;
end;
$$;

create or replace function app_private.finalize_1v1_after_second_death(
  p_match_id uuid,
  p_now timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match public.multiplayer_matches;
  v_deaths integer;
  v_second_user_id uuid;
  v_one public.multiplayer_players;
  v_two public.multiplayer_players;
  v_winner uuid;
begin
  select * into v_match from public.multiplayer_matches
  where id = p_match_id for update;
  if v_match.id is null then raise exception '1v1 match not found'; end if;
  if v_match.status = 'finished' then return true; end if;

  select count(*) into v_deaths
  from public.multiplayer_players player
  where player.match_id = p_match_id
    and (player.eliminated_at is not null or player.status = 'eliminated');
  if v_deaths < 2 then return false; end if;

  select player.user_id into v_second_user_id
  from public.multiplayer_players player
  where player.match_id = p_match_id
  order by
    case when player.death_order = 2 then 0 else 1 end,
    player.eliminated_at desc nulls last,
    player.user_id
  limit 1;

  update public.multiplayer_players player
  set score = player.score + 280,
      second_death_bonus_awarded = true,
      updated_at = p_now
  where player.match_id = p_match_id
    and player.user_id = v_second_user_id
    and not player.second_death_bonus_awarded;

  select * into v_one from public.multiplayer_players player
  where player.match_id = p_match_id and player.slot = 1;
  select * into v_two from public.multiplayer_players player
  where player.match_id = p_match_id and player.slot = 2;
  if v_one.user_id is null or v_two.user_id is null then
    raise exception '1v1 players not found';
  end if;

  v_winner := case
    when v_one.score > v_two.score then v_one.user_id
    when v_two.score > v_one.score then v_two.user_id
    else null
  end;

  update public.multiplayer_matches
  set status = 'finished',
      winner_user_id = v_winner,
      finished_at = coalesce(finished_at, p_now),
      last_activity_at = p_now,
      intermission_ends_at = null
  where id = p_match_id and status <> 'finished';
  return true;
end;
$$;

revoke all on function app_private.mark_1v1_eliminated(uuid, uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function app_private.finalize_1v1_after_second_death(
  uuid, timestamptz
) from public, anon, authenticated;

-- Grove settlement happens only at the synchronized post-heal barrier.  The
-- result receipt makes point awards, HP loss, and a possible death idempotent.
create or replace function app_private.settle_grove_wave(
  p_match_id uuid,
  p_wave integer,
  p_now timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_one public.multiplayer_players;
  v_two public.multiplayer_players;
  v_one_mushrooms integer;
  v_two_mushrooms integer;
  v_one_points numeric;
  v_two_points numeric;
  v_penalized uuid;
  v_inserted uuid;
  v_penalized_hearts numeric;
begin
  if not exists (
    select 1 from public.multiplayer_matches match
    where match.id = p_match_id and match.map_key = 'grove'
  ) then return false; end if;

  select * into v_one from public.multiplayer_players player
  where player.match_id = p_match_id and player.slot = 1;
  select * into v_two from public.multiplayer_players player
  where player.match_id = p_match_id and player.slot = 2;

  select count(*)::integer into v_one_mushrooms
  from public.multiplayer_mushroom_events event
  where event.match_id = p_match_id and event.user_id = v_one.user_id
    and event.wave = p_wave;
  select count(*)::integer into v_two_mushrooms
  from public.multiplayer_mushroom_events event
  where event.match_id = p_match_id and event.user_id = v_two.user_id
    and event.wave = p_wave;

  if v_one_mushrooms > v_two_mushrooms then
    v_one_points := 14; v_two_points := 0; v_penalized := v_two.user_id;
  elsif v_two_mushrooms > v_one_mushrooms then
    v_one_points := 0; v_two_points := 14; v_penalized := v_one.user_id;
  else
    v_one_points := 7; v_two_points := 7; v_penalized := null;
  end if;

  insert into public.multiplayer_grove_wave_results(
    match_id, wave, player_one_user_id, player_two_user_id,
    player_one_mushrooms, player_two_mushrooms,
    player_one_points, player_two_points, penalized_user_id, settled_at
  ) values (
    p_match_id, p_wave, v_one.user_id, v_two.user_id,
    v_one_mushrooms, v_two_mushrooms,
    v_one_points, v_two_points, v_penalized, p_now
  )
  on conflict (match_id, wave) do nothing
  returning match_id into v_inserted;
  if v_inserted is null then
    return app_private.finalize_1v1_after_second_death(p_match_id, p_now);
  end if;

  update public.multiplayer_players player
  set obstacle_points = player.obstacle_points + case
        when player.user_id = v_one.user_id then v_one_points else v_two_points
      end,
      last_rewarded_wave = greatest(player.last_rewarded_wave, p_wave),
      updated_at = p_now
  where player.match_id = p_match_id;

  if v_penalized is not null then
    update public.multiplayer_players player
    set hearts = greatest(0, player.hearts - 1), updated_at = p_now
    where player.match_id = p_match_id and player.user_id = v_penalized
      and player.status not in ('eliminated', 'left', 'finished')
    returning hearts into v_penalized_hearts;
    if v_penalized_hearts = 0 then
      perform app_private.mark_1v1_eliminated(
        p_match_id, v_penalized, p_now
      );
    end if;
  end if;

  return app_private.finalize_1v1_after_second_death(p_match_id, p_now);
end;
$$;

revoke all on function app_private.settle_grove_wave(uuid, integer, timestamptz)
  from public, anon, authenticated;

create or replace function app_private.one_v_one_character_snapshot(
  p_user_id uuid,
  p_map_key text
)
returns table(
  character_key text,
  character_class text,
  max_hearts numeric,
  starting_hearts numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_class text;
  v_allowed text[];
  v_forced text;
  v_base_max numeric;
  v_base_start numeric;
  v_multiplier numeric;
  v_bonus numeric;
begin
  select loadout.character_key, catalog.character_class
  into v_key, v_class
  from public.player_loadouts loadout
  join public.extraction_catalog catalog
    on catalog.item_key = loadout.character_key
   and catalog.item_type = 'character'
  join public.player_unlocks unlock
    on unlock.user_id = loadout.user_id
   and unlock.item_key = loadout.character_key
   and unlock.item_type = 'character'
  where loadout.user_id = p_user_id;
  v_key := coalesce(v_key, 'runner_ace');
  v_class := coalesce(v_class, 'runner');

  select rules.allowed_character_classes, rules.forced_character_key,
         coalesce((rules.gameplay_rules->>'hp_multiplier')::numeric, 1),
         coalesce((rules.gameplay_rules->>'hp_bonus')::numeric, 0)
  into v_allowed, v_forced, v_multiplier, v_bonus
  from app_private.one_v_one_map_rules rules
  where rules.map_key = p_map_key;

  if v_forced is not null then
    v_key := v_forced;
    v_class := 'runner';
  elsif not (v_class = any(v_allowed)) then
    v_key := 'runner_ace';
    v_class := 'runner';
  end if;

  v_base_max := case
    when v_key in ('medic_oracle', 'tank_atlas') then 6
    when v_key in ('medic_seraph', 'medic_beacon', 'tank_colossus') then 5.5
    when v_key = 'tank_guard' then 4.5
    when v_key = 'medic_patch' then 4
    when v_key = 'tank_hammer' or v_class = 'medic' then 5
    when v_class = 'tank' then 4
    when v_class = 'trickster' then 2
    else 3
  end;
  v_base_start := case
    when v_class = 'tank' then 4
    when v_class = 'trickster' then 2
    else 3
  end;

  return query select v_key, v_class,
    (v_base_max * v_multiplier + v_bonus)::numeric,
    (v_base_start * v_multiplier + v_bonus)::numeric;
end;
$$;

revoke all on function app_private.one_v_one_character_snapshot(uuid, text)
  from public, anon, authenticated;

-- Mode-aware matchmaking is preserved.  The selected map and all character/HP
-- adjustments are server snapshots created in the same serialized transaction.
create or replace function public.join_1v1_queue(p_mode text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_mode text := lower(trim(p_mode));
  v_username text;
  v_level integer;
  v_opponent_id uuid;
  v_opponent_username text;
  v_match_id uuid;
  v_status text;
  v_match_mode text;
  v_existing_map_key text;
  v_map record;
  v_character record;
  v_opponent_character record;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  if v_mode not in ('casual', 'ranked') then
    raise exception '1v1 mode must be Casual or Ranked';
  end if;
  if app_private.has_active_ban(v_uid, 'account', null) then
    raise exception 'This account is banned';
  end if;
  if v_mode = 'ranked'
     and app_private.has_active_ban(v_uid, 'leaderboard', null) then
    raise exception 'This account cannot enter Ranked 1v1';
  end if;

  select profile.username into v_username
  from public.player_profiles profile where profile.user_id = v_uid;
  if v_username is null then
    raise exception 'Choose a username before entering 1v1';
  end if;

  select coalesce(stats.level, 1) into v_level
  from public.player_stats stats where stats.user_id = v_uid;
  v_level := coalesce(v_level, 1);
  if v_mode = 'ranked' and v_level < 25 then
    raise exception 'Ranked 1v1 unlocks at level 25';
  end if;

  perform pg_advisory_xact_lock(917240115);
  delete from public.multiplayer_queue
  where queued_at < now() - interval '2 minutes';

  select player.match_id, match.status, match.mode, match.map_key
  into v_match_id, v_status, v_match_mode, v_existing_map_key
  from public.multiplayer_players player
  join public.multiplayer_matches match on match.id = player.match_id
  where player.user_id = v_uid
    and match.status in ('countdown', 'playing', 'intermission')
  order by match.created_at desc limit 1;
  if v_match_id is not null then
    select username into v_opponent_username
    from public.multiplayer_players
    where match_id = v_match_id and user_id <> v_uid limit 1;
    return jsonb_build_object(
      'match_id', v_match_id, 'status', v_status,
      'mode', v_match_mode, 'opponent_username', v_opponent_username,
      'map_key', v_existing_map_key,
      'map_rules', app_private.one_v_one_map_rules_json(v_existing_map_key)
    );
  end if;

  select queue.user_id, profile.username
  into v_opponent_id, v_opponent_username
  from public.multiplayer_queue queue
  join public.player_profiles profile on profile.user_id = queue.user_id
  join public.player_stats stats on stats.user_id = queue.user_id
  where queue.user_id <> v_uid
    and queue.mode = v_mode
    and (v_mode = 'casual' or stats.level >= 25)
    and not app_private.has_active_ban(queue.user_id, 'account', null)
    and (
      v_mode = 'casual'
      or not app_private.has_active_ban(queue.user_id, 'leaderboard', null)
    )
    and not exists (
      select 1 from public.multiplayer_players player
      join public.multiplayer_matches match on match.id = player.match_id
      where player.user_id = queue.user_id
        and match.status in ('countdown', 'playing', 'intermission')
    )
  order by queue.queued_at limit 1 for update of queue skip locked;

  if v_opponent_id is null then
    insert into public.multiplayer_queue(user_id, queued_at, mode)
    values (v_uid, now(), v_mode)
    on conflict (user_id) do update
      set queued_at = excluded.queued_at, mode = excluded.mode;
    return jsonb_build_object(
      'match_id', null, 'status', 'waiting', 'mode', v_mode,
      'opponent_username', null, 'map_key', null, 'map_rules', null
    );
  end if;

  select * into v_map
  from app_private.choose_1v1_map(v_opponent_id, v_uid);
  select * into v_opponent_character
  from app_private.one_v_one_character_snapshot(v_opponent_id, v_map.map_key);
  select * into v_character
  from app_private.one_v_one_character_snapshot(v_uid, v_map.map_key);

  insert into public.multiplayer_matches(
    host_user_id, guest_user_id, mode,
    map_key, map_selection_method, map_candidates
  ) values (
    v_opponent_id, v_uid, v_mode,
    v_map.map_key, v_map.selection_method, v_map.candidates
  ) returning id into v_match_id;

  insert into public.multiplayer_players(
    match_id, user_id, slot, username, character_key, character_class,
    max_hearts, hearts, lane_index
  ) values
    (
      v_match_id, v_opponent_id, 1, v_opponent_username,
      v_opponent_character.character_key,
      v_opponent_character.character_class,
      v_opponent_character.max_hearts,
      v_opponent_character.starting_hearts,
      floor((select lane_count from app_private.one_v_one_map_rules
             where map_key = v_map.map_key) / 2)::smallint
    ),
    (
      v_match_id, v_uid, 2, v_username,
      v_character.character_key, v_character.character_class,
      v_character.max_hearts, v_character.starting_hearts,
      floor((select lane_count from app_private.one_v_one_map_rules
             where map_key = v_map.map_key) / 2)::smallint
    );

  delete from public.multiplayer_queue where user_id in (v_uid, v_opponent_id);
  return jsonb_build_object(
    'match_id', v_match_id, 'status', 'countdown', 'mode', v_mode,
    'opponent_username', v_opponent_username,
    'map_key', v_map.map_key,
    'map_rules', app_private.one_v_one_map_rules_json(v_map.map_key)
  );
end;
$$;

create or replace function public.join_1v1_queue()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.join_1v1_queue('casual');
$$;

-- Lightweight lane reports let the server pressure a player's actual lane on
-- the first paid-attack group.  They never change health, score, or currency.
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
  v_lane_count integer;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  select match.* into v_match
  from public.multiplayer_matches match
  where match.id = p_match_id for update;
  select rules.lane_count into v_lane_count
  from app_private.one_v_one_map_rules rules
  where rules.map_key = v_match.map_key;
  if v_match.id is null or not exists (
    select 1 from public.multiplayer_players player
    where player.match_id = p_match_id and player.user_id = v_uid
  ) then raise exception '1v1 match not found'; end if;
  if v_match.status not in ('countdown', 'playing', 'intermission') then
    raise exception 'This 1v1 match has ended';
  end if;
  if p_lane_index is null or p_lane_index < 0 or p_lane_index >= v_lane_count then
    raise exception 'Lane must be between 0 and %', v_lane_count - 1;
  end if;

  update public.multiplayer_players player
  set lane_index = p_lane_index::smallint,
      last_position_at = clock_timestamp(),
      last_seen_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where player.match_id = p_match_id and player.user_id = v_uid
    and player.status not in ('eliminated', 'left', 'finished');
  if not found then raise exception 'Eliminated players cannot move'; end if;

  update public.multiplayer_matches
  set last_activity_at = clock_timestamp() where id = p_match_id;
  return jsonb_build_object(
    'match_id', p_match_id, 'lane_index', p_lane_index,
    'lane_count', v_lane_count
  );
end;
$$;

-- Factory's conveyor choice is server-derived from the persisted match id and
-- wave, so reconnects and both devices receive the same lane/speed without a
-- mutable random-state race.  Other maps return only their wave number.
create or replace function app_private.one_v_one_wave_rules(
  p_match_id uuid,
  p_wave integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_map_key text;
  v_lane_count integer;
  v_lane integer;
  v_fast boolean;
begin
  select match.map_key, rules.lane_count
  into v_map_key, v_lane_count
  from public.multiplayer_matches match
  join app_private.one_v_one_map_rules rules on rules.map_key = match.map_key
  where match.id = p_match_id;
  if v_map_key is null then return null; end if;
  if v_map_key <> 'factory' then
    return jsonb_build_object('wave', p_wave);
  end if;
  v_lane := mod(
    abs(hashtextextended(p_match_id::text || ':' || p_wave::text, 71)::numeric),
    v_lane_count
  )::integer;
  v_fast := mod(
    abs(hashtextextended(p_match_id::text || ':' || p_wave::text, 97)::numeric),
    2
  ) = 0;
  return jsonb_build_object(
    'wave', p_wave,
    'conveyor_lane_index', v_lane,
    'conveyor_speed_multiplier', case when v_fast then 2 else 0.5 end
  );
end;
$$;

revoke all on function app_private.one_v_one_wave_rules(uuid, integer)
  from public, anon, authenticated;

create or replace function public.get_1v1_state(p_match_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_match public.multiplayer_matches;
  v_self public.multiplayer_players;
  v_opponent public.multiplayer_players;
  v_attacks jsonb;
  v_self_wave_mushrooms integer := 0;
  v_opponent_wave_mushrooms integer := 0;
  v_last_grove_wave jsonb;
  v_outcome text;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  select * into v_match from public.multiplayer_matches where id = p_match_id;
  select * into v_self from public.multiplayer_players
  where match_id = p_match_id and user_id = v_uid;
  if v_match.id is null or v_self.user_id is null then
    raise exception '1v1 match not found';
  end if;
  select * into v_opponent from public.multiplayer_players
  where match_id = p_match_id and user_id <> v_uid limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', attack.id,
    'obstacle_type', attack.obstacle_type,
    'point_cost', attack.point_cost,
    'spawn_wave', attack.spawn_wave,
    'created_at', attack.created_at,
    'source', attack.source,
    'lane_index', attack.lane_index,
    'lane_group', attack.lane_group,
    'lane_position', attack.lane_position,
    'escape_lane_index', attack.escape_lane_index,
    'wall_parity', attack.wall_parity,
    'wall_lane_index', attack.wall_lane_index,
    'wall_size', attack.wall_size
  ) order by attack.spawn_wave, attack.lane_group, attack.lane_position,
             attack.created_at), '[]'::jsonb)
  into v_attacks
  from public.multiplayer_attacks attack
  where attack.match_id = p_match_id
    and attack.target_user_id = v_uid
    and attack.delivered_at is null;

  if v_match.map_key = 'grove' then
    select count(*)::integer into v_self_wave_mushrooms
    from public.multiplayer_mushroom_events event
    where event.match_id = p_match_id and event.user_id = v_self.user_id
      and event.wave = v_self.wave;
    select count(*)::integer into v_opponent_wave_mushrooms
    from public.multiplayer_mushroom_events event
    where event.match_id = p_match_id and event.user_id = v_opponent.user_id
      and event.wave = v_opponent.wave;
    select jsonb_build_object(
      'wave', result.wave,
      'self_mushrooms', case
        when result.player_one_user_id = v_uid then result.player_one_mushrooms
        else result.player_two_mushrooms end,
      'opponent_mushrooms', case
        when result.player_one_user_id = v_uid then result.player_two_mushrooms
        else result.player_one_mushrooms end,
      'self_points', case
        when result.player_one_user_id = v_uid then result.player_one_points
        else result.player_two_points end,
      'opponent_points', case
        when result.player_one_user_id = v_uid then result.player_two_points
        else result.player_one_points end,
      'penalized_user_id', result.penalized_user_id
    ) into v_last_grove_wave
    from public.multiplayer_grove_wave_results result
    where result.match_id = p_match_id
    order by result.wave desc limit 1;
  end if;

  v_outcome := case
    when v_match.status <> 'finished' then 'pending'
    when v_match.winner_user_id is null then 'draw'
    when v_match.winner_user_id = v_uid then 'win'
    else 'loss'
  end;

  return jsonb_build_object(
    'match', jsonb_build_object(
      'id', v_match.id,
      'status', v_match.status,
      'mode', v_match.mode,
      'map_key', v_match.map_key,
      'map_selection_method', v_match.map_selection_method,
      'map_candidates', to_jsonb(v_match.map_candidates),
      'current_wave', v_match.current_wave,
      'intermission_ends_at', v_match.intermission_ends_at,
      'winner_user_id', v_match.winner_user_id,
      'is_draw', v_match.status = 'finished' and v_match.winner_user_id is null,
      'second_death_bonus_points', 280,
      'started_at', v_match.started_at,
      'finished_at', v_match.finished_at
    ),
    'map_rules', app_private.one_v_one_map_rules_json(v_match.map_key),
    'wave_rules', app_private.one_v_one_wave_rules(
      p_match_id, v_match.current_wave
    ),
    'outcome', v_outcome,
    'self', jsonb_build_object(
      'user_id', v_self.user_id,
      'username', v_self.username,
      'character_key', v_self.character_key,
      'character_class', v_self.character_class,
      'max_hearts', v_self.max_hearts,
      'hearts', v_self.hearts,
      'wave', v_self.wave,
      'score', v_self.score,
      'final_score', v_self.score,
      'obstacle_points', v_self.obstacle_points,
      'melons_collected', v_self.melons_collected,
      'coins_collected', v_self.melons_collected,
      'mushrooms_collected', v_self.mushrooms_collected,
      'current_wave_mushrooms', v_self_wave_mushrooms,
      'status', v_self.status,
      'eliminated_at', v_self.eliminated_at,
      'death_order', v_self.death_order,
      'second_death_bonus_awarded', v_self.second_death_bonus_awarded,
      'lane_index', v_self.lane_index,
      'katana_broken', v_self.katana_broken,
      'zenith_time_stop_until', v_self.zenith_time_stop_until,
      'zenith_time_stop_used', v_self.zenith_time_stop_used,
      'obstacle_speed_multiplier', v_self.obstacle_speed_multiplier,
      'katana_cooldown_ends_at', case
        when v_match.map_key <> 'pitch' or v_self.katana_broken then null
        when v_self.last_katana_wave = v_self.wave
          then v_self.last_katana_at + interval '6 seconds'
        else now()
      end,
      'katana_cooldown_until', case
        when v_match.map_key <> 'pitch' or v_self.katana_broken then null
        when v_self.last_katana_wave = v_self.wave
          then v_self.last_katana_at + interval '6 seconds'
        else now()
      end
    ),
    'opponent', jsonb_build_object(
      'user_id', v_opponent.user_id,
      'username', v_opponent.username,
      'character_key', v_opponent.character_key,
      'character_class', v_opponent.character_class,
      'max_hearts', v_opponent.max_hearts,
      'hearts', v_opponent.hearts,
      'wave', v_opponent.wave,
      'score', v_opponent.score,
      'final_score', v_opponent.score,
      'obstacle_points', v_opponent.obstacle_points,
      'melons_collected', v_opponent.melons_collected,
      'coins_collected', v_opponent.melons_collected,
      'mushrooms_collected', v_opponent.mushrooms_collected,
      'current_wave_mushrooms', v_opponent_wave_mushrooms,
      'status', v_opponent.status,
      'eliminated_at', v_opponent.eliminated_at,
      'death_order', v_opponent.death_order,
      'second_death_bonus_awarded', v_opponent.second_death_bonus_awarded,
      'lane_index', v_opponent.lane_index,
      'katana_broken', v_opponent.katana_broken,
      'zenith_time_stop_until', v_opponent.zenith_time_stop_until,
      'zenith_time_stop_used', v_opponent.zenith_time_stop_used,
      'obstacle_speed_multiplier', v_opponent.obstacle_speed_multiplier,
      'katana_cooldown_ends_at', case
        when v_match.map_key <> 'pitch' or v_opponent.katana_broken then null
        when v_opponent.last_katana_wave = v_opponent.wave
          then v_opponent.last_katana_at + interval '6 seconds'
        else now()
      end,
      'katana_cooldown_until', case
        when v_match.map_key <> 'pitch' or v_opponent.katana_broken then null
        when v_opponent.last_katana_wave = v_opponent.wave
          then v_opponent.last_katana_at + interval '6 seconds'
        else now()
      end
    ),
    'last_grove_wave', v_last_grove_wave,
    'pending_attacks', v_attacks
  );
end;
$$;

-- The survivor keeps playing after the first death, so the narrow score RPC
-- must freeze the eliminated player's score even while the match row itself is
-- still active.  The row predicate repeats the locked-status check as a
-- defense-in-depth guard against future changes to this function.
create or replace function public.sync_1v1_score(
  p_match_id uuid,
  p_score bigint
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_match_status text;
  v_player_status text;
  v_current_score bigint;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  if p_score is null or p_score < 0 or p_score > 1000000000000 then
    raise exception 'Invalid 1v1 score';
  end if;

  select match.status into v_match_status
  from public.multiplayer_matches match
  where match.id = p_match_id
  for update;
  if v_match_status is null
     or v_match_status not in ('countdown', 'playing', 'intermission') then
    raise exception '1v1 match is not active';
  end if;

  select player.score, player.status
  into v_current_score, v_player_status
  from public.multiplayer_players player
  where player.match_id = p_match_id and player.user_id = v_uid
  for update;
  if v_current_score is null then raise exception '1v1 match not found'; end if;
  if v_player_status in ('eliminated', 'left', 'finished') then
    raise exception 'This player can no longer update their 1v1 score';
  end if;
  if p_score < v_current_score then raise exception 'Score cannot decrease'; end if;

  update public.multiplayer_players player
  set score = p_score,
      last_seen_at = now(),
      updated_at = now()
  where player.match_id = p_match_id
    and player.user_id = v_uid
    and player.status not in ('eliminated', 'left', 'finished');
  if not found then
    raise exception 'This player can no longer update their 1v1 score';
  end if;

  update public.multiplayer_matches match
  set last_activity_at = now()
  where match.id = p_match_id;
  return p_score;
end;
$$;

-- Zenith's wave-15 Time Stop is committed by the server so the rival receives
-- the same ten-second pause and reconnecting cannot replay the one-use skill.
-- Only the Zenith player receives the heal, score, and permanent slow reward.
drop function if exists public.activate_1v1_zenith_time_stop(uuid);

create or replace function public.activate_1v1_zenith_time_stop(
  p_match_id uuid,
  p_score bigint
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
  v_now timestamptz := clock_timestamp();
  v_until timestamptz := v_now + interval '10 seconds';
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  if p_score is null or p_score < 0 or p_score > 1000000000000 then
    raise exception 'Invalid 1v1 score';
  end if;

  select * into v_match from public.multiplayer_matches match
  where match.id = p_match_id for update;
  select * into v_self from public.multiplayer_players player
  where player.match_id = p_match_id and player.user_id = v_uid for update;

  if v_match.id is null or v_self.user_id is null then
    raise exception '1v1 match not found';
  end if;
  if v_match.status <> 'playing' or v_self.status <> 'playing' then
    raise exception 'Time Stop requires active 1v1 play';
  end if;
  if v_self.character_key <> 'runner_zenith'
     or v_self.character_class <> 'runner' then
    raise exception 'Only Zenith can activate Time Stop';
  end if;
  if v_self.wave < 15 then
    raise exception 'Time Stop unlocks on wave 15';
  end if;
  if v_self.zenith_time_stop_used then
    raise exception 'Time Stop was already used in this match';
  end if;
  if p_score < v_self.score then
    raise exception 'Score cannot decrease';
  end if;

  update public.multiplayer_players player
  set hearts = player.max_hearts,
      score = greatest(player.score, p_score) + 15000,
      zenith_time_stop_used = true,
      zenith_time_stop_until = v_until,
      obstacle_speed_multiplier = least(player.obstacle_speed_multiplier, .75),
      last_seen_at = v_now,
      updated_at = v_now
  where player.match_id = p_match_id and player.user_id = v_uid;

  update public.multiplayer_players player
  set zenith_time_stop_until = greatest(
        coalesce(player.zenith_time_stop_until, '-infinity'::timestamptz),
        v_until
      ),
      updated_at = v_now
  where player.match_id = p_match_id
    and player.user_id <> v_uid
    and player.status = 'playing';

  update public.multiplayer_matches match
  set last_activity_at = v_now where match.id = p_match_id;

  select * into v_self from public.multiplayer_players player
  where player.match_id = p_match_id and player.user_id = v_uid;
  return jsonb_build_object(
    'match_id', p_match_id,
    'score', v_self.score,
    'hearts', v_self.hearts,
    'max_hearts', v_self.max_hearts,
    'time_stop_until', v_self.zenith_time_stop_until,
    'time_stop_used', v_self.zenith_time_stop_used,
    'obstacle_speed_multiplier', v_self.obstacle_speed_multiplier
  );
end;
$$;

-- Server-created mushroom score, Zenith's one-use 15,000-point reward, and the
-- 75-point second-death bonus are added to the pre-existing elapsed-time
-- allowance before its trigger validates a score write. Ordinary client score
-- claims remain bounded exactly as before.
create or replace function app_private.enforce_1v1_score_ceiling()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_started_at timestamptz;
  v_elapsed_seconds numeric;
  v_score_ceiling bigint;
  v_mushroom_score bigint := 0;
begin
  select match.started_at into v_started_at
  from public.multiplayer_matches match where match.id = new.match_id;
  if v_started_at is null then raise exception '1v1 match not found'; end if;
  v_elapsed_seconds := greatest(
    0, extract(epoch from (clock_timestamp() - v_started_at))
  );
  select count(*)::bigint * 120 into v_mushroom_score
  from public.multiplayer_mushroom_events event
  where event.match_id = new.match_id and event.user_id = new.user_id;
  v_score_ceiling := least(
    10000000::bigint,
    10000::bigint + floor(v_elapsed_seconds * 25000)::bigint
  ) + v_mushroom_score
    + case when new.zenith_time_stop_used then 15000 else 0 end
    + case when new.second_death_bonus_awarded then 280 else 0 end;
  if new.score < 0 or new.score > v_score_ceiling then
    raise exception '1v1 score exceeds the server play-time allowance';
  end if;
  return new;
end;
$$;

revoke all on function app_private.enforce_1v1_score_ceiling()
  from public, anon, authenticated;

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
  v_completed_wave integer;
  v_wave_reward numeric := 0;
  v_standard_wave_reward numeric := 0;
  v_ready_players integer := 0;
  v_active_players integer := 0;
  v_ready_min_wave integer;
  v_ready_max_wave integer;
  v_verified_wave integer := 1;
  v_finalized boolean := false;
  v_now timestamptz := clock_timestamp();
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  if p_wave is null or p_wave < 1 or p_score is null or p_score < 0 then
    raise exception 'Invalid 1v1 state';
  end if;
  if p_status not in ('playing', 'intermission', 'eliminated') then
    raise exception 'Invalid player status';
  end if;

  select * into v_match from public.multiplayer_matches
  where id = p_match_id for update;
  select * into v_self from public.multiplayer_players
  where match_id = p_match_id and user_id = v_uid for update;
  if v_match.id is null or v_self.user_id is null then
    raise exception '1v1 match not found';
  end if;
  if v_match.status not in ('countdown', 'playing', 'intermission') then
    return public.get_1v1_state(p_match_id);
  end if;
  if v_self.status in ('eliminated', 'left', 'finished') then
    return public.get_1v1_state(p_match_id);
  end if;
  if p_hearts is null or p_hearts < 0 or p_hearts > v_self.max_hearts then
    raise exception 'Hearts must be between 0 and %', v_self.max_hearts;
  end if;
  if v_match.map_key = 'desert' and p_hearts > v_self.hearts then
    raise exception 'Healing is disabled on Desert';
  end if;
  if p_wave > v_self.wave + 1 then
    raise exception 'Wave can only advance one at a time';
  end if;
  select coalesce(max(activity.verified_wave), 1)
  into v_verified_wave
  from public.player_progression_1v1_activity activity
  where activity.match_id = p_match_id and activity.user_id = v_uid;
  if p_wave > v_verified_wave + 1 then
    raise exception 'Wave is ahead of verified active play';
  end if;
  if p_wave = v_self.wave and p_hearts > v_self.hearts
     and v_self.character_class <> 'medic' then
    raise exception 'Mid-wave healing is not available to this character';
  end if;

  -- Narrow score heartbeats may arrive before an older full-state packet.
  if p_wave < v_self.wave then
    update public.multiplayer_players
    set score = greatest(score, p_score),
        last_seen_at = v_now, updated_at = v_now
    where match_id = p_match_id and user_id = v_uid;
    update public.multiplayer_matches set last_activity_at = v_now
    where id = p_match_id;
    return public.get_1v1_state(p_match_id);
  end if;

  -- A duplicate completion cannot reopen an intermission after that wave began.
  if p_status = 'intermission' and p_wave <= v_match.current_wave then
    update public.multiplayer_players
    set score = greatest(score, p_score),
        last_seen_at = v_now, updated_at = v_now
    where match_id = p_match_id and user_id = v_uid;
    return public.get_1v1_state(p_match_id);
  end if;

  -- Do not let a late playing heartbeat cancel either a global countdown or a
  -- player's local ready state while another living player reaches the barrier.
  if p_status = 'playing' and (
       (v_match.status = 'intermission' and v_match.intermission_ends_at > v_now)
       or (v_match.status = 'playing' and v_self.status = 'intermission')
     ) then
    update public.multiplayer_players
    set score = greatest(score, p_score),
        last_seen_at = v_now, updated_at = v_now
    where match_id = p_match_id and user_id = v_uid;
    return public.get_1v1_state(p_match_id);
  end if;

  v_completed_wave := greatest(0, p_wave - 1);
  if v_match.map_key <> 'grove'
     and v_completed_wave > v_self.last_rewarded_wave then
    select rules.wave_point_reward into v_standard_wave_reward
    from app_private.one_v_one_map_rules rules
    where rules.map_key = v_match.map_key;
    v_wave_reward :=
      (v_completed_wave - v_self.last_rewarded_wave) * v_standard_wave_reward;
  end if;

  update public.multiplayer_players
  set hearts = p_hearts,
      wave = greatest(wave, p_wave),
      score = greatest(score, p_score),
      obstacle_points = obstacle_points + v_wave_reward,
      last_rewarded_wave = case
        when v_match.map_key = 'grove' then last_rewarded_wave
        else greatest(last_rewarded_wave, v_completed_wave)
      end,
      status = case
        when p_hearts = 0 or p_status = 'eliminated' then 'eliminated'
        else p_status
      end,
      last_seen_at = v_now,
      updated_at = v_now
  where match_id = p_match_id and user_id = v_uid;

  if p_status = 'intermission' then
    update public.multiplayer_attacks
    set delivered_at = v_now
    where match_id = p_match_id
      and target_user_id = v_uid
      and delivered_at is null
      and spawn_wave < p_wave;
  end if;

  if p_hearts = 0 or p_status = 'eliminated' then
    perform app_private.mark_1v1_eliminated(p_match_id, v_uid, v_now);
    v_finalized := app_private.finalize_1v1_after_second_death(
      p_match_id, v_now
    );
    if not v_finalized then
      -- If the survivor already reached the wave barrier, begin their solo
      -- intermission now instead of leaving them permanently waiting.
      select
        count(*) filter (
          where status not in ('eliminated', 'left', 'finished')
        ),
        count(*) filter (where status = 'intermission'),
        min(wave) filter (
          where status not in ('eliminated', 'left', 'finished')
        ),
        max(wave) filter (
          where status not in ('eliminated', 'left', 'finished')
        )
      into v_active_players, v_ready_players,
           v_ready_min_wave, v_ready_max_wave
      from public.multiplayer_players
      where match_id = p_match_id;
      if v_active_players > 0
         and v_ready_players = v_active_players
         and v_ready_min_wave = v_ready_max_wave then
        if v_match.map_key = 'grove' then
          v_finalized := app_private.settle_grove_wave(
            p_match_id, greatest(1, v_ready_max_wave - 1), v_now
          );
        end if;
        if not v_finalized then
          update public.multiplayer_matches
          set status = 'intermission',
              current_wave = v_ready_max_wave,
              winner_user_id = null,
              intermission_ends_at = v_now + interval '10 seconds',
              last_activity_at = v_now
          where id = p_match_id;
        end if;
      else
        update public.multiplayer_matches
        set status = 'playing',
            winner_user_id = null,
            intermission_ends_at = null,
            last_activity_at = v_now
        where id = p_match_id;
      end if;
    end if;
    return public.get_1v1_state(p_match_id);
  end if;

  if p_status = 'intermission' then
    select
      count(*) filter (
        where status not in ('eliminated', 'left', 'finished')
      ),
      count(*) filter (where status = 'intermission'),
      min(wave) filter (
        where status not in ('eliminated', 'left', 'finished')
      ),
      max(wave) filter (
        where status not in ('eliminated', 'left', 'finished')
      )
    into v_active_players, v_ready_players,
         v_ready_min_wave, v_ready_max_wave
    from public.multiplayer_players
    where match_id = p_match_id;

    if v_active_players > 0
       and v_ready_players = v_active_players
       and v_ready_min_wave = v_ready_max_wave then
      if v_match.map_key = 'grove' then
        v_finalized := app_private.settle_grove_wave(
          p_match_id, greatest(1, v_ready_max_wave - 1), v_now
        );
      end if;
      if not v_finalized then
        update public.multiplayer_matches
        set status = 'intermission',
            current_wave = v_ready_max_wave,
            intermission_ends_at = case
              when status = 'intermission' and intermission_ends_at > v_now
                then intermission_ends_at
              else v_now + interval '10 seconds'
            end,
            last_activity_at = v_now
        where id = p_match_id;
      end if;
    else
      update public.multiplayer_matches set last_activity_at = v_now
      where id = p_match_id;
    end if;
  elsif p_status = 'playing' then
    if v_match.status = 'intermission' then
      update public.multiplayer_players
      set status = 'playing', updated_at = v_now
      where match_id = p_match_id and status = 'intermission';
      update public.multiplayer_matches
      set status = 'playing', intermission_ends_at = null,
          last_activity_at = v_now
      where id = p_match_id;
    elsif v_match.status = 'countdown' then
      update public.multiplayer_matches
      set status = 'playing', last_activity_at = v_now
      where id = p_match_id;
    else
      update public.multiplayer_matches set last_activity_at = v_now
      where id = p_match_id;
    end if;
  end if;

  return public.get_1v1_state(p_match_id);
end;
$$;

-- Receipt-backed attack-coin pickup.  The existing anti-forgery timing/wave
-- envelope is retained, and the selected map supplies the 5/6/7-point value.
create or replace function public.award_1v1_points(
  p_match_id uuid,
  p_source text,
  p_amount integer,
  p_pickup_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_source text := lower(trim(p_source));
  v_pickup_id text := trim(p_pickup_id);
  v_match public.multiplayer_matches;
  v_self public.multiplayer_players;
  v_inserted_id text;
  v_awarded numeric := 0;
  v_balance_before numeric := 0;
  v_coin_reward numeric;
  v_now timestamptz;
  v_active_seconds bigint;
  v_verified_wave integer;
  v_last_heartbeat timestamptz;
  v_heartbeat_active boolean;
  v_time_allowance bigint;
  v_wave_allowance bigint;
  v_allowed bigint;
  v_claimed bigint;
  v_recent_claims bigint;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  if v_source not in ('coin', 'melon') or p_amount <> 1 then
    raise exception 'Coins must be awarded one pickup at a time';
  end if;
  if v_pickup_id is null or length(v_pickup_id) not between 1 and 160 then
    raise exception 'A valid coin pickup id is required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 1));

  select * into v_match from public.multiplayer_matches
  where id = p_match_id for update;
  select * into v_self from public.multiplayer_players
  where match_id = p_match_id and user_id = v_uid for update;
  if v_match.id is null or v_self.user_id is null then
    raise exception '1v1 match not found';
  end if;
  v_balance_before := v_self.obstacle_points;
  select rules.coin_point_reward into v_coin_reward
  from app_private.one_v_one_map_rules rules
  where rules.map_key = v_match.map_key;

  if exists (
    select 1 from public.multiplayer_point_events event
    where event.match_id = p_match_id and event.user_id = v_uid
      and event.pickup_id = v_pickup_id
  ) then
    return jsonb_build_object(
      'match_id', p_match_id, 'map_key', v_match.map_key,
      'source', 'coin', 'pickup_id', v_pickup_id,
      'duplicate', true, 'awarded', 0,
      'points_per_coin', v_coin_reward,
      'obstacle_points', v_self.obstacle_points,
      'melons_collected', v_self.melons_collected,
      'coins_collected', v_self.melons_collected,
      'mushrooms_collected', v_self.mushrooms_collected
    );
  end if;
  if v_match.started_at <= now() - interval '6 hours' then
    raise exception '1v1 match is too old for new coin receipts';
  end if;
  if v_match.status <> 'playing' or v_self.status <> 'playing' then
    raise exception 'Coins can only be collected during active 1v1 play';
  end if;

  select activity.active_seconds, activity.verified_wave,
         activity.last_heartbeat_at, activity.heartbeat_active
  into v_active_seconds, v_verified_wave, v_last_heartbeat,
       v_heartbeat_active
  from public.player_progression_1v1_activity activity
  where activity.match_id = p_match_id and activity.user_id = v_uid
  for update;
  if not found then raise exception 'Coins require active 1v1 play'; end if;
  v_now := clock_timestamp();
  if not coalesce(v_heartbeat_active, false)
     or v_last_heartbeat is null
     or v_last_heartbeat < v_now - interval '8 seconds' then
    raise exception 'Coins require active 1v1 play';
  end if;

  v_active_seconds := least(
    21600::bigint,
    greatest(0::bigint, coalesce(v_active_seconds, 0))
  );
  v_verified_wave := least(
    100000,
    greatest(1, coalesce(v_verified_wave, 1))
  );
  v_time_allowance := 2
    + floor(v_active_seconds::numeric / 0.75)::bigint;
  v_wave_allowance := 2 + v_verified_wave::bigint * 60;
  v_allowed := least(v_time_allowance, v_wave_allowance);
  select count(*) into v_claimed
  from public.multiplayer_point_events event
  where event.match_id = p_match_id and event.user_id = v_uid;
  select v_claimed + count(*) into v_claimed
  from public.multiplayer_mushroom_events event
  where event.match_id = p_match_id and event.user_id = v_uid;
  select v_claimed + count(*) into v_claimed
  from public.player_progression_events event
  where event.user_id = v_uid and event.source = 'gem'
    and event.metadata->>'context_id' = p_match_id::text;
  if v_claimed >= v_allowed then
    raise exception 'Pickup allowance reached';
  end if;

  select count(*) into v_recent_claims
  from public.multiplayer_point_events event
  where event.user_id = v_uid
    and event.created_at > v_now - interval '1 second';
  select v_recent_claims + count(*) into v_recent_claims
  from public.multiplayer_mushroom_events event
  where event.user_id = v_uid
    and event.created_at > v_now - interval '1 second';
  select v_recent_claims + count(*) into v_recent_claims
  from public.player_progression_events event
  where event.user_id = v_uid and event.source = 'gem'
    and event.metadata->>'context_id' = p_match_id::text
    and event.created_at > v_now - interval '1 second';
  if v_recent_claims >= 3 then
    raise exception 'Pickups arrived too quickly';
  end if;

  insert into public.multiplayer_point_events(
    match_id, user_id, pickup_id, source, points_awarded
  ) values (p_match_id, v_uid, v_pickup_id, 'coin', v_coin_reward)
  on conflict (match_id, user_id, pickup_id) do nothing
  returning pickup_id into v_inserted_id;
  if v_inserted_id is not null then
    v_awarded := v_coin_reward;
    update public.multiplayer_players
    set obstacle_points = obstacle_points + v_coin_reward,
        melons_collected = melons_collected + 1,
        last_melon_at = v_now,
        last_seen_at = v_now,
        updated_at = v_now
    where match_id = p_match_id and user_id = v_uid;
    update public.multiplayer_matches set last_activity_at = v_now
    where id = p_match_id;
  end if;

  select * into v_self from public.multiplayer_players
  where match_id = p_match_id and user_id = v_uid;
  if v_inserted_id is not null then
    v_awarded := greatest(0, v_self.obstacle_points - v_balance_before);
  end if;
  return jsonb_build_object(
    'match_id', p_match_id, 'map_key', v_match.map_key,
    'source', 'coin', 'pickup_id', v_pickup_id,
    'duplicate', v_inserted_id is null, 'awarded', v_awarded,
    'points_per_coin', case when v_inserted_id is null
      then v_coin_reward else v_awarded end,
    'obstacle_points', v_self.obstacle_points,
    'melons_collected', v_self.melons_collected,
    'coins_collected', v_self.melons_collected,
    'mushrooms_collected', v_self.mushrooms_collected,
    'pickup_allowance', v_allowed,
    'coin_allowance', v_allowed
  );
end;
$$;

-- Legacy signature remains present for database compatibility.  It is not
-- client-callable because coin idempotence is impossible without a pickup id.
-- Its wave branch remains useful to trusted old jobs and uses map rewards.
create or replace function public.award_1v1_points(
  p_match_id uuid,
  p_source text,
  p_amount integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_source text := lower(trim(p_source));
  v_match public.multiplayer_matches;
  v_self public.multiplayer_players;
  v_reward numeric := 0;
  v_each numeric := 0;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  select * into v_match from public.multiplayer_matches
  where id = p_match_id for update;
  select * into v_self from public.multiplayer_players
  where match_id = p_match_id and user_id = v_uid for update;
  if v_match.id is null or v_self.user_id is null then
    raise exception '1v1 match not found';
  end if;
  if v_source in ('coin', 'melon') then
    raise exception 'A stable pickup id is required for 1v1 coins';
  elsif v_source <> 'wave' then
    raise exception 'Point source must be coin or wave';
  end if;
  if v_match.status not in ('playing', 'intermission')
     or p_amount < 1 or p_amount > v_self.wave then
    raise exception 'Invalid completed wave';
  end if;
  if v_match.map_key <> 'grove' and p_amount > v_self.last_rewarded_wave then
    select rules.wave_point_reward into v_each
    from app_private.one_v_one_map_rules rules
    where rules.map_key = v_match.map_key;
    v_reward := (p_amount - v_self.last_rewarded_wave) * v_each;
    update public.multiplayer_players
    set obstacle_points = obstacle_points + v_reward,
        last_rewarded_wave = p_amount,
        last_seen_at = now(), updated_at = now()
    where match_id = p_match_id and user_id = v_uid;
  end if;
  select * into v_self from public.multiplayer_players
  where match_id = p_match_id and user_id = v_uid;
  return jsonb_build_object(
    'match_id', p_match_id, 'map_key', v_match.map_key,
    'source', 'wave', 'awarded', v_reward,
    'deferred', v_match.map_key = 'grove',
    'obstacle_points', v_self.obstacle_points,
    'coins_collected', v_self.melons_collected,
    'mushrooms_collected', v_self.mushrooms_collected
  );
end;
$$;

create or replace function public.award_1v1_mushroom(
  p_match_id uuid,
  p_wave integer,
  p_pickup_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_pickup_id text := trim(p_pickup_id);
  v_match public.multiplayer_matches;
  v_self public.multiplayer_players;
  v_inserted text;
  v_now timestamptz;
  v_active_seconds bigint;
  v_verified_wave integer;
  v_last_heartbeat timestamptz;
  v_heartbeat_active boolean;
  v_time_allowance bigint;
  v_wave_allowance bigint;
  v_allowed bigint;
  v_claimed bigint;
  v_recent_claims bigint;
  v_wave_mushrooms integer;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  if p_wave is null or p_wave < 1 then raise exception 'Invalid mushroom wave'; end if;
  if v_pickup_id is null or length(v_pickup_id) not between 1 and 160 then
    raise exception 'A valid mushroom pickup id is required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 1));

  select * into v_match from public.multiplayer_matches
  where id = p_match_id for update;
  select * into v_self from public.multiplayer_players
  where match_id = p_match_id and user_id = v_uid for update;
  if v_match.id is null or v_self.user_id is null then
    raise exception '1v1 match not found';
  end if;

  if exists (
    select 1 from public.multiplayer_mushroom_events event
    where event.match_id = p_match_id and event.user_id = v_uid
      and event.pickup_id = v_pickup_id
  ) then
    select count(*)::integer into v_wave_mushrooms
    from public.multiplayer_mushroom_events event
    where event.match_id = p_match_id and event.user_id = v_uid
      and event.wave = p_wave;
    return jsonb_build_object(
      'match_id', p_match_id, 'map_key', v_match.map_key,
      'pickup_id', v_pickup_id, 'duplicate', true,
      'awarded_score', 0, 'score', v_self.score,
      'mushrooms_collected', v_self.mushrooms_collected,
      'wave_mushrooms', v_wave_mushrooms,
      'current_wave_mushrooms', v_wave_mushrooms
    );
  end if;
  if v_match.map_key <> 'grove' then
    raise exception 'Mushrooms are only available on Grove';
  end if;
  if v_match.started_at <= now() - interval '6 hours' then
    raise exception '1v1 match is too old for new mushroom receipts';
  end if;
  if v_match.status <> 'playing' or v_self.status <> 'playing' then
    raise exception 'Mushrooms can only be collected during active 1v1 play';
  end if;
  if p_wave <> v_self.wave or p_wave <> v_match.current_wave then
    raise exception 'Mushroom wave does not match active play';
  end if;

  select activity.active_seconds, activity.verified_wave,
         activity.last_heartbeat_at, activity.heartbeat_active
  into v_active_seconds, v_verified_wave, v_last_heartbeat,
       v_heartbeat_active
  from public.player_progression_1v1_activity activity
  where activity.match_id = p_match_id and activity.user_id = v_uid
  for update;
  if not found then raise exception 'Mushrooms require active 1v1 play'; end if;
  v_now := clock_timestamp();
  if not coalesce(v_heartbeat_active, false)
     or v_last_heartbeat is null
     or v_last_heartbeat < v_now - interval '8 seconds' then
    raise exception 'Mushrooms require active 1v1 play';
  end if;

  v_active_seconds := least(
    21600::bigint,
    greatest(0::bigint, coalesce(v_active_seconds, 0))
  );
  v_verified_wave := least(
    100000,
    greatest(1, coalesce(v_verified_wave, 1))
  );
  if p_wave > v_verified_wave then
    raise exception 'Mushroom wave is not server-verified';
  end if;
  v_time_allowance := 2
    + floor(v_active_seconds::numeric / 0.75)::bigint;
  v_wave_allowance := 2 + v_verified_wave::bigint * 60;
  v_allowed := least(v_time_allowance, v_wave_allowance);
  select count(*) into v_claimed
  from public.multiplayer_point_events event
  where event.match_id = p_match_id and event.user_id = v_uid;
  select v_claimed + count(*) into v_claimed
  from public.multiplayer_mushroom_events event
  where event.match_id = p_match_id and event.user_id = v_uid;
  select v_claimed + count(*) into v_claimed
  from public.player_progression_events event
  where event.user_id = v_uid and event.source = 'gem'
    and event.metadata->>'context_id' = p_match_id::text;
  if v_claimed >= v_allowed then raise exception 'Pickup allowance reached'; end if;

  select count(*) into v_recent_claims
  from public.multiplayer_point_events event
  where event.user_id = v_uid
    and event.created_at > v_now - interval '1 second';
  select v_recent_claims + count(*) into v_recent_claims
  from public.multiplayer_mushroom_events event
  where event.user_id = v_uid
    and event.created_at > v_now - interval '1 second';
  select v_recent_claims + count(*) into v_recent_claims
  from public.player_progression_events event
  where event.user_id = v_uid and event.source = 'gem'
    and event.metadata->>'context_id' = p_match_id::text
    and event.created_at > v_now - interval '1 second';
  if v_recent_claims >= 3 then raise exception 'Pickups arrived too quickly'; end if;

  insert into public.multiplayer_mushroom_events(
    match_id, user_id, pickup_id, wave, score_awarded, created_at
  ) values (p_match_id, v_uid, v_pickup_id, p_wave, 120, v_now)
  on conflict (match_id, user_id, pickup_id) do nothing
  returning pickup_id into v_inserted;
  if v_inserted is not null then
    update public.multiplayer_players
    set score = score + 120,
        mushrooms_collected = mushrooms_collected + 1,
        last_seen_at = v_now,
        updated_at = v_now
    where match_id = p_match_id and user_id = v_uid;
    update public.multiplayer_matches set last_activity_at = v_now
    where id = p_match_id;
  end if;

  select * into v_self from public.multiplayer_players
  where match_id = p_match_id and user_id = v_uid;
  select count(*)::integer into v_wave_mushrooms
  from public.multiplayer_mushroom_events event
  where event.match_id = p_match_id and event.user_id = v_uid
    and event.wave = p_wave;
  return jsonb_build_object(
    'match_id', p_match_id, 'map_key', v_match.map_key,
    'pickup_id', v_pickup_id, 'duplicate', v_inserted is null,
    'awarded_score', case when v_inserted is null then 0 else 120 end,
    'score', v_self.score,
    'mushrooms_collected', v_self.mushrooms_collected,
    'wave_mushrooms', v_wave_mushrooms,
    'current_wave_mushrooms', v_wave_mushrooms,
    'pickup_allowance', v_allowed
  );
end;
$$;

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
  v_cost integer;
  v_match public.multiplayer_matches;
  v_self public.multiplayer_players;
  v_target public.multiplayer_players;
  v_allowed text[];
  v_remaining numeric;
  v_attack_id uuid;
  v_placement record;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  if v_type = 'spikes' then v_type := 'spike'; end if;
  v_cost := case v_type
    when 'log' then 6
    when 'barrel' then 6
    when 'snowflake' then 7
    when 'current' then 7
    when 'spike' then 8
    when 'car' then 8
    when 'rock' then 8
    else null
  end;
  if v_cost is null then raise exception 'Unknown obstacle type'; end if;
  if p_cost is not null and p_cost <> v_cost then
    raise exception 'Incorrect obstacle cost';
  end if;

  select * into v_match from public.multiplayer_matches
  where id = p_match_id for update;
  select * into v_self from public.multiplayer_players
  where match_id = p_match_id and user_id = v_uid for update;
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

  select rules.allowed_attacks into v_allowed
  from app_private.one_v_one_map_rules rules
  where rules.map_key = v_match.map_key;
  if not (v_type = any(v_allowed)) then
    raise exception '% is not available on %', v_type, v_match.map_key;
  end if;

  select * into v_target from public.multiplayer_players
  where match_id = p_match_id and user_id <> v_uid limit 1;
  if v_target.user_id is null then raise exception '1v1 opponent not found'; end if;
  if v_target.status in ('eliminated', 'left', 'finished') then
    raise exception 'The opponent is no longer accepting attacks';
  end if;

  select * into v_placement
  from app_private.next_1v1_attack_placement(
    p_match_id, v_uid, v_target.user_id, v_type
  );

  update public.multiplayer_players
  set obstacle_points = obstacle_points - v_cost,
      last_seen_at = now(), updated_at = now()
  where match_id = p_match_id and user_id = v_uid
    and status = 'intermission' and obstacle_points >= v_cost
  returning obstacle_points into v_remaining;
  if v_remaining is null then raise exception 'Not enough obstacle points'; end if;

  insert into public.multiplayer_attacks(
    match_id, sender_user_id, target_user_id,
    obstacle_type, point_cost, spawn_wave, source,
    lane_index, lane_group, lane_position, escape_lane_index,
    wall_parity, wall_lane_index, wall_size
  ) values (
    p_match_id, v_uid, v_target.user_id,
    v_type, v_cost, v_match.current_wave, 'purchased',
    v_placement.lane_index, v_placement.lane_group,
    v_placement.lane_position, v_placement.escape_lane_index,
    v_placement.wall_parity, v_placement.wall_lane_index,
    v_placement.wall_size
  ) returning id into v_attack_id;
  update public.multiplayer_matches set last_activity_at = now()
  where id = p_match_id;

  return jsonb_build_object(
    'id', v_attack_id,
    'match_id', p_match_id,
    'map_key', v_match.map_key,
    'target_user_id', v_target.user_id,
    'obstacle_type', v_type,
    'point_cost', v_cost,
    'spawn_wave', v_match.current_wave,
    'source', 'purchased',
    'lane_index', v_placement.lane_index,
    'lane_group', v_placement.lane_group,
    'lane_position', v_placement.lane_position,
    'escape_lane_index', v_placement.escape_lane_index,
    'wall_parity', v_placement.wall_parity,
    'wall_lane_index', v_placement.wall_lane_index,
    'wall_size', v_placement.wall_size,
    'remaining_points', v_remaining,
    'available_attacks', to_jsonb(v_allowed)
  );
end;
$$;

-- Arm Pitch's Katana before its local 0.4-second guard begins.  Keeping the
-- activation server-side prevents a stale/reloaded client from bypassing the
-- six-second cooldown.  A new wave still resets the cooldown.
create or replace function public.activate_1v1_katana(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_match public.multiplayer_matches;
  v_self public.multiplayer_players;
  v_now timestamptz := clock_timestamp();
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  select * into v_match from public.multiplayer_matches match
  where match.id = p_match_id for update;
  select * into v_self from public.multiplayer_players player
  where player.match_id = p_match_id and player.user_id = v_uid for update;
  if v_match.id is null or v_self.user_id is null then
    raise exception '1v1 match not found';
  end if;
  if v_match.map_key <> 'pitch' then
    raise exception 'Katana activation is only available on Pitch';
  end if;
  if v_match.status <> 'playing' or v_self.status <> 'playing' then
    raise exception 'Katana can only be used during active play';
  end if;
  if v_self.katana_broken then raise exception 'The katana is broken'; end if;
  if v_self.last_katana_wave = v_self.wave
     and v_self.last_katana_at > v_now - interval '6 seconds' then
    raise exception 'Katana is cooling down';
  end if;

  update public.multiplayer_players player
  set last_katana_at = v_now,
      last_katana_wave = v_self.wave,
      last_seen_at = v_now,
      updated_at = v_now
  where player.match_id = p_match_id and player.user_id = v_uid;
  update public.multiplayer_matches match
  set last_activity_at = v_now where match.id = p_match_id;

  return jsonb_build_object(
    'match_id', p_match_id,
    'activated_at', v_now,
    'active_until', v_now + interval '0.4 seconds',
    'katana_broken', false,
    'katana_cooldown_ends_at', v_now + interval '6 seconds',
    'katana_cooldown_until', v_now + interval '6 seconds'
  );
end;
$$;

-- Pitch katana collisions use a client-generated stable token because natural
-- obstacles have no multiplayer attack UUID. The token is scoped to account
-- and match. The server first requires a successful activation. A short
-- transport allowance lets a collision reported at the end of the 0.4-second
-- client guard arrive without being rejected. Rocks permanently break the
-- katana and never send an attack.
create or replace function public.reflect_1v1_attack(
  p_match_id uuid,
  p_reflection_id text,
  p_obstacle_type text,
  p_source_attack_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_reflection_id text := trim(p_reflection_id);
  v_type text := lower(trim(p_obstacle_type));
  v_match public.multiplayer_matches;
  v_self public.multiplayer_players;
  v_target public.multiplayer_players;
  v_existing public.multiplayer_katana_events;
  v_existing_attack public.multiplayer_attacks;
  v_source_attack public.multiplayer_attacks;
  v_attack_id uuid;
  v_activation_reflections integer := 0;
  v_placement record;
  v_now timestamptz := clock_timestamp();
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  if v_reflection_id is null
     or length(v_reflection_id) not between 1 and 160 then
    raise exception 'A valid katana reflection id is required';
  end if;
  if v_type = 'spikes' then v_type := 'spike'; end if;
  if v_type not in ('barrel', 'log', 'car', 'snowflake', 'spike', 'rock') then
    raise exception 'That obstacle cannot interact with the Pitch katana';
  end if;

  select * into v_match from public.multiplayer_matches
  where id = p_match_id for update;
  select * into v_self from public.multiplayer_players
  where match_id = p_match_id and user_id = v_uid for update;
  if v_match.id is null or v_self.user_id is null then
    raise exception '1v1 match not found';
  end if;

  select * into v_existing from public.multiplayer_katana_events event
  where event.match_id = p_match_id and event.user_id = v_uid
    and event.reflection_id = v_reflection_id;
  if v_existing.reflection_id is not null then
    if v_existing.attack_id is not null then
      select * into v_existing_attack from public.multiplayer_attacks attack
      where attack.id = v_existing.attack_id;
    end if;
    return jsonb_build_object(
      'match_id', p_match_id,
      'reflection_id', v_reflection_id,
      'duplicate', true,
      'outcome', v_existing.outcome,
      'attack_id', v_existing.attack_id,
      'source_attack_id', v_existing.source_attack_id,
      'obstacle_type', v_existing.obstacle_type,
      'lane_index', v_existing_attack.lane_index,
      'lane_group', v_existing_attack.lane_group,
      'lane_position', v_existing_attack.lane_position,
      'wall_parity', v_existing_attack.wall_parity,
      'wall_lane_index', v_existing_attack.wall_lane_index,
      'wall_size', v_existing_attack.wall_size,
      'spawn_wave', v_existing.wave,
      'katana_broken', v_existing.outcome = 'broken' or v_self.katana_broken,
      'katana_cooldown_ends_at', case
        when v_existing.outcome = 'broken' then null
        else v_self.last_katana_at + interval '6 seconds'
      end,
      'katana_cooldown_until', case
        when v_existing.outcome = 'broken' then null
        else v_self.last_katana_at + interval '6 seconds'
      end
    );
  end if;

  if v_match.map_key <> 'pitch' then
    raise exception 'Katana reflection is only available on Pitch';
  end if;
  if v_match.status <> 'playing' or v_self.status <> 'playing' then
    raise exception 'Katana can only be used during active play';
  end if;
  if v_self.katana_broken then raise exception 'The katana is broken'; end if;
  if v_self.last_katana_wave is distinct from v_self.wave
     or v_self.last_katana_at is null
     or v_self.last_katana_at < v_now - interval '1 second' then
    raise exception 'Katana is not active';
  end if;
  select count(*)::integer into v_activation_reflections
  from public.multiplayer_katana_events event
  where event.match_id = p_match_id and event.user_id = v_uid
    and event.wave = v_self.wave
    and event.created_at >= v_self.last_katana_at;
  if v_activation_reflections >= 8 then
    raise exception 'Katana reflection limit reached';
  end if;

  if p_source_attack_id is not null then
    select * into v_source_attack
    from public.multiplayer_attacks attack
    where attack.id = p_source_attack_id
      and attack.match_id = p_match_id
      and attack.target_user_id = v_uid
      and attack.obstacle_type = v_type
      and attack.delivered_at is null
    for update;
    if v_source_attack.id is null then
      raise exception 'Pending reflected attack not found';
    end if;
  end if;

  if v_type = 'rock' then
    insert into public.multiplayer_katana_events(
      match_id, user_id, reflection_id, wave, obstacle_type, outcome,
      source_attack_id, created_at
    ) values (
      p_match_id, v_uid, v_reflection_id, v_self.wave, v_type, 'broken',
      p_source_attack_id, v_now
    );
    if p_source_attack_id is not null then
      update public.multiplayer_attacks
      set delivered_at = v_now where id = p_source_attack_id;
    end if;
    update public.multiplayer_players
    set katana_broken = true,
        last_katana_at = v_now,
        last_katana_wave = v_self.wave,
        last_seen_at = v_now,
        updated_at = v_now
    where match_id = p_match_id and user_id = v_uid;
    update public.multiplayer_matches set last_activity_at = v_now
    where id = p_match_id;
    return jsonb_build_object(
      'match_id', p_match_id,
      'reflection_id', v_reflection_id,
      'duplicate', false,
      'outcome', 'broken',
      'attack_id', null,
      'source_attack_id', p_source_attack_id,
      'obstacle_type', v_type,
      'lane_index', null,
      'lane_group', null,
      'lane_position', null,
      'spawn_wave', v_self.wave,
      'katana_broken', true,
      'katana_cooldown_ends_at', null,
      'katana_cooldown_until', null
    );
  end if;

  select * into v_target from public.multiplayer_players
  where match_id = p_match_id and user_id <> v_uid limit 1;
  if v_target.user_id is null
     or v_target.status in ('eliminated', 'left', 'finished') then
    raise exception 'The opponent is no longer accepting reflected attacks';
  end if;

  select * into v_placement
  from app_private.next_1v1_attack_placement(
    p_match_id, v_uid, v_target.user_id, v_type
  );
  insert into public.multiplayer_katana_events(
    match_id, user_id, reflection_id, wave, obstacle_type, outcome,
    source_attack_id, created_at
  ) values (
    p_match_id, v_uid, v_reflection_id, v_self.wave, v_type, 'reflected',
    p_source_attack_id, v_now
  );
  insert into public.multiplayer_attacks(
    match_id, sender_user_id, target_user_id,
    obstacle_type, point_cost, spawn_wave, source,
    lane_index, lane_group, lane_position, escape_lane_index,
    wall_parity, wall_lane_index, wall_size, created_at
  ) values (
    p_match_id, v_uid, v_target.user_id,
    v_type, 0, v_self.wave, 'katana',
    v_placement.lane_index, v_placement.lane_group,
    v_placement.lane_position, v_placement.escape_lane_index,
    v_placement.wall_parity, v_placement.wall_lane_index,
    v_placement.wall_size, v_now
  ) returning id into v_attack_id;
  if p_source_attack_id is not null then
    update public.multiplayer_attacks
    set delivered_at = v_now where id = p_source_attack_id;
  end if;
  update public.multiplayer_katana_events
  set attack_id = v_attack_id
  where match_id = p_match_id and user_id = v_uid
    and reflection_id = v_reflection_id;
  update public.multiplayer_players
  set last_seen_at = v_now,
      updated_at = v_now
  where match_id = p_match_id and user_id = v_uid;
  update public.multiplayer_matches set last_activity_at = v_now
  where id = p_match_id;

  return jsonb_build_object(
    'match_id', p_match_id,
    'reflection_id', v_reflection_id,
    'duplicate', false,
    'outcome', 'reflected',
    'attack_id', v_attack_id,
    'source_attack_id', p_source_attack_id,
    'obstacle_type', v_type,
    'lane_index', v_placement.lane_index,
    'lane_group', v_placement.lane_group,
    'lane_position', v_placement.lane_position,
    'wall_parity', v_placement.wall_parity,
    'wall_lane_index', v_placement.wall_lane_index,
    'wall_size', v_placement.wall_size,
    'spawn_wave', v_self.wave,
    'katana_broken', false,
    'katana_cooldown_ends_at', v_self.last_katana_at + interval '6 seconds',
    'katana_cooldown_until', v_self.last_katana_at + interval '6 seconds'
  );
end;
$$;

-- Natural obstacles have no multiplayer_attacks UUID, so the stable
-- three-argument contract delegates with no source attack.  When the client
-- is reflecting a server-sent attack it should call the four-argument form;
-- that form atomically consumes the incoming row and prevents redelivery.
create or replace function public.reflect_1v1_attack(
  p_match_id uuid,
  p_reflection_id text,
  p_obstacle_type text
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.reflect_1v1_attack(
    p_match_id, p_reflection_id, p_obstacle_type, null::uuid
  );
$$;

-- Preserve the old explicit-finish signature.  An already eliminated player
-- cannot use it to truncate the survivor's run; a living caller still forfeits.
create or replace function public.finish_1v1(p_match_id uuid)
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
  v_deaths integer;
  v_now timestamptz := clock_timestamp();
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  select * into v_match from public.multiplayer_matches
  where id = p_match_id for update;
  select * into v_self from public.multiplayer_players
  where match_id = p_match_id and user_id = v_uid for update;
  select * into v_opponent from public.multiplayer_players
  where match_id = p_match_id and user_id <> v_uid limit 1 for update;
  if v_match.id is null or v_self.user_id is null then
    raise exception '1v1 match not found';
  end if;

  if v_match.status = 'finished' then
    return public.get_1v1_state(p_match_id) || jsonb_build_object(
      'match_id', p_match_id,
      'status', 'finished',
      'winner_user_id', v_match.winner_user_id
    );
  elsif v_match.status = 'cancelled' then
    return jsonb_build_object(
      'match_id', p_match_id, 'status', 'cancelled',
      'winner_user_id', null, 'outcome', 'cancelled'
    );
  end if;

  select count(*) into v_deaths
  from public.multiplayer_players player
  where player.match_id = p_match_id
    and (player.eliminated_at is not null or player.status = 'eliminated');
  if v_deaths >= 2 then
    perform app_private.finalize_1v1_after_second_death(p_match_id, v_now);
    return public.get_1v1_state(p_match_id) || jsonb_build_object(
      'match_id', p_match_id, 'status', 'finished'
    );
  end if;

  if v_self.status = 'eliminated' or v_self.eliminated_at is not null then
    return public.get_1v1_state(p_match_id) || jsonb_build_object(
      'match_id', p_match_id, 'status', v_match.status,
      'winner_user_id', null, 'outcome', 'pending'
    );
  end if;

  -- A living explicit finisher forfeits.  Forfeits intentionally bypass the
  -- two-natural-death score comparison and remain compatible with old clients.
  update public.multiplayer_players player
  set status = case
        when player.user_id = v_uid then 'left'
        when player.status = 'eliminated' then 'eliminated'
        else 'finished'
      end,
      last_seen_at = case
        when player.user_id = v_uid then v_now else player.last_seen_at
      end,
      updated_at = v_now
  where player.match_id = p_match_id;
  update public.multiplayer_matches
  set status = 'finished',
      winner_user_id = v_opponent.user_id,
      finished_at = v_now,
      last_activity_at = v_now,
      intermission_ends_at = null
  where id = p_match_id;
  return public.get_1v1_state(p_match_id) || jsonb_build_object(
    'match_id', p_match_id, 'status', 'finished',
    'winner_user_id', v_opponent.user_id, 'outcome', 'loss'
  );
end;
$$;

-- Queue cancellation and active-match departure keep the legacy no-argument
-- client contract.  Active matches always pass through finish_1v1: living
-- callers forfeit, while an already eliminated caller simply detaches and the
-- survivor's score run remains active until their own death.
create or replace function public.leave_1v1()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_match_id uuid;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;

  delete from public.multiplayer_queue where user_id = v_uid;
  select player.match_id into v_match_id
  from public.multiplayer_players player
  join public.multiplayer_matches match on match.id = player.match_id
  where player.user_id = v_uid
    and match.status in ('countdown', 'playing', 'intermission')
  order by match.created_at desc
  limit 1
  for update of match;

  if v_match_id is null then
    return jsonb_build_object('match_id', null, 'status', 'left_queue');
  end if;
  return public.finish_1v1(v_match_id);
end;
$$;

comment on function public.get_1v1_map_catalog() is
  'Authenticated catalog for the eight server-owned online 1v1 map rules.';
comment on function public.set_1v1_map_priorities(text[]) is
  'Replaces the caller two-map 1v1 vote atomically; both selected maps have equal weight.';
comment on function public.get_1v1_map_priorities() is
  'Returns the caller two equal 1v1 map votes and the public map catalog.';
comment on function public.update_1v1_position(uuid, integer) is
  'Reports the caller zero-based lane for safe server attack-lane planning.';
comment on function public.award_1v1_mushroom(uuid, integer, text) is
  'Idempotent Grove mushroom receipt; each accepted pickup adds 120 server score.';
comment on function public.activate_1v1_katana(uuid) is
  'Server-authoritative Pitch katana activation and cooldown gate.';
comment on function public.reflect_1v1_attack(uuid, text, text) is
  'Idempotent Pitch katana collision for a natural obstacle.';
comment on function public.reflect_1v1_attack(uuid, text, text, uuid) is
  'Idempotent Pitch katana collision that also consumes a server-sent attack.';
comment on function public.activate_1v1_zenith_time_stop(uuid, bigint) is
  'Server-authoritative one-use Zenith Time Stop; validates the latest monotonic client score before applying the bounded 15,000-point reward.';

revoke all on function public.get_1v1_map_catalog()
  from public, anon, authenticated;
revoke all on function public.get_1v1_map_priorities()
  from public, anon, authenticated;
revoke all on function public.set_1v1_map_priorities(text[])
  from public, anon, authenticated;
revoke all on function public.get_1v1_state(uuid)
  from public, anon, authenticated;
revoke all on function public.sync_1v1_score(uuid, bigint)
  from public, anon, authenticated;
revoke all on function public.activate_1v1_zenith_time_stop(uuid, bigint)
  from public, anon, authenticated;
revoke all on function public.join_1v1_queue(text)
  from public, anon, authenticated;
revoke all on function public.join_1v1_queue()
  from public, anon, authenticated;
revoke all on function public.update_1v1_position(uuid, integer)
  from public, anon, authenticated;
revoke all on function public.update_1v1_state(
  uuid, numeric, integer, bigint, text
) from public, anon, authenticated;
revoke all on function public.award_1v1_points(uuid, text, integer, text)
  from public, anon, authenticated;
revoke all on function public.award_1v1_points(uuid, text, integer)
  from public, anon, authenticated;
revoke all on function public.award_1v1_mushroom(uuid, integer, text)
  from public, anon, authenticated;
revoke all on function public.send_1v1_attack(uuid, text, integer)
  from public, anon, authenticated;
revoke all on function public.activate_1v1_katana(uuid)
  from public, anon, authenticated;
revoke all on function public.reflect_1v1_attack(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.reflect_1v1_attack(uuid, text, text, uuid)
  from public, anon, authenticated;
revoke all on function public.finish_1v1(uuid)
  from public, anon, authenticated;
revoke all on function public.leave_1v1()
  from public, anon, authenticated;

grant execute on function public.get_1v1_map_catalog() to authenticated;
grant execute on function public.get_1v1_map_priorities() to authenticated;
grant execute on function public.set_1v1_map_priorities(text[]) to authenticated;
grant execute on function public.get_1v1_state(uuid) to authenticated;
grant execute on function public.sync_1v1_score(uuid, bigint)
  to authenticated;
grant execute on function public.activate_1v1_zenith_time_stop(uuid, bigint)
  to authenticated;
grant execute on function public.join_1v1_queue(text) to authenticated;
grant execute on function public.join_1v1_queue() to authenticated;
grant execute on function public.update_1v1_position(uuid, integer)
  to authenticated;
grant execute on function public.update_1v1_state(
  uuid, numeric, integer, bigint, text
) to authenticated;
-- Multi-device 07 retires the single-pickup RPC. If its batch RPC is already
-- installed, preserve that secure intermission-only surface on rerun.
do $$
begin
  if to_regprocedure(
       'public.sync_1v1_intermission_coins(uuid,text[])'
     ) is not null then
    execute 'grant execute on function public.sync_1v1_intermission_coins(uuid,text[])
      to authenticated';
  end if;
end;
$$;
grant execute on function public.award_1v1_mushroom(uuid, integer, text)
  to authenticated;
grant execute on function public.send_1v1_attack(uuid, text, integer)
  to authenticated;
grant execute on function public.activate_1v1_katana(uuid)
  to authenticated;
grant execute on function public.reflect_1v1_attack(uuid, text, text)
  to authenticated;
grant execute on function public.reflect_1v1_attack(uuid, text, text, uuid)
  to authenticated;
grant execute on function public.finish_1v1(uuid) to authenticated;
grant execute on function public.leave_1v1() to authenticated;

-- Explicit probability/availability tables later in the design are treated as
-- authoritative where early prose says Alley/Skyway have no Snowflake: both
-- maps retain their stated natural Snowflake weight and purchasable Snowflake.
notify pgrst, 'reload schema';
commit;

-- Visible rerun/contract checks.  Every column should return true (or 8/100).
select
  (
    select count(*) from app_private.one_v_one_map_rules
  ) = 8 as eight_maps_installed,
  not exists (
    select 1
    from app_private.one_v_one_map_rules rules
    where (
      select coalesce(sum(weight.value::integer), 0)
      from jsonb_each_text(rules.natural_spawn_weights) weight
    ) <> 100
  ) as every_spawn_table_totals_100,
  (
    select coin_point_reward = 6 and wave_point_reward = 8
    from app_private.one_v_one_map_rules where map_key = 'classic'
  ) as classic_economy_correct,
  (
    select coin_point_reward = 5 and wave_point_reward = 0
    from app_private.one_v_one_map_rules where map_key = 'grove'
  ) as grove_conditional_economy_correct,
  (
    select bool_and(data_type = 'numeric')
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'multiplayer_grove_wave_results'
      and column_name in ('player_one_points', 'player_two_points')
  ) as grove_point_receipts_allow_fractions,
  exists (
    select 1
    from pg_constraint constraint_row
    where constraint_row.conrelid =
          'public.multiplayer_point_events'::regclass
      and constraint_row.conname =
          'multiplayer_point_events_points_awarded_check'
      and position(
        '1000000' in pg_get_constraintdef(constraint_row.oid)
      ) > 0
  ) as point_receipts_allow_character_modifiers,
  position(
    $$when v_key = 'medic_patch' then 4$$ in pg_get_functiondef(
      to_regprocedure(
        'app_private.one_v_one_character_snapshot(uuid,text)'
      )
    )
  ) > 0 as medic_patch_max_hp_four,
  position(
    $$half-heart steps$$ in pg_get_functiondef(to_regprocedure(
      'public.update_1v1_state(uuid,numeric,integer,bigint,text)'
    ))
  ) = 0 as exact_hidden_hp_is_accepted,
  position(
    $$when 'current' then 7$$ in pg_get_functiondef(to_regprocedure(
      'public.send_1v1_attack(uuid,text,integer)'
    ))
  ) > 0 as current_costs_seven,
  position(
    $$v_method := 'votes_overlap'$$ in pg_get_functiondef(to_regprocedure(
      'app_private.choose_1v1_map(uuid,uuid)'
    ))
  ) > 0 as shared_vote_pool_installed,
  position(
    $$v_method := 'votes_union'$$ in pg_get_functiondef(to_regprocedure(
      'app_private.choose_1v1_map(uuid,uuid)'
    ))
  ) > 0 as disjoint_four_vote_pool_installed,
  position(
    $$v_roll$$ in pg_get_functiondef(to_regprocedure(
      'app_private.choose_1v1_map(uuid,uuid)'
    ))
  ) = 0 as fixed_map_weighting_removed,
  position(
    $$cardinality(p_map_order) <> 2$$ in pg_get_functiondef(
      to_regprocedure('public.set_1v1_map_priorities(text[])')
    )
  ) > 0 as setter_requires_exactly_two_votes,
  position(
    $$player.score + 280$$ in pg_get_functiondef(to_regprocedure(
      'app_private.finalize_1v1_after_second_death(uuid,timestamp with time zone)'
    ))
  ) > 0 as second_death_gets_280_once,
  position(
    $$else null$$ in pg_get_functiondef(to_regprocedure(
      'app_private.finalize_1v1_after_second_death(uuid,timestamp with time zone)'
    ))
  ) > 0 as tied_scores_draw,
  position(
    $$can no longer update their 1v1 score$$ in pg_get_functiondef(
      to_regprocedure('public.sync_1v1_score(uuid,bigint)')
    )
  ) > 0 as eliminated_score_updates_blocked,
  position(
    $$public.finish_1v1(v_match_id)$$ in pg_get_functiondef(
      to_regprocedure('public.leave_1v1()')
    )
  ) > 0 as active_leave_uses_protected_finish,
  position(
    $$v_result_one := 0.5$$ in pg_get_functiondef(to_regprocedure(
      'app_private.apply_ranked_result_to_active_season()'
    ))
  ) > 0 as ranked_draw_actual_score_half,
  position(
    $$v_lane_count - 1$$ in pg_get_functiondef(to_regprocedure(
      'app_private.next_1v1_attack_placement(uuid,uuid,uuid,text)'
    ))
  ) > 0 as attack_groups_never_fill_every_lane,
  not has_table_privilege(
    'authenticated', 'public.player_1v1_map_priorities', 'SELECT'
  ) and not has_table_privilege(
    'authenticated', 'public.multiplayer_mushroom_events', 'SELECT'
  ) and not has_table_privilege(
    'authenticated', 'public.multiplayer_katana_events', 'SELECT'
  ) as new_private_tables_are_rpc_only,
  not has_function_privilege(
    'authenticated','public.award_1v1_points(uuid,text,integer,text)','EXECUTE'
  ) and not has_function_privilege(
    'authenticated',
    'public.award_1v1_points(uuid,text,integer)',
    'EXECUTE'
  ) as single_pickup_coin_rpcs_are_retired,
  has_function_privilege(
    'authenticated', 'public.reflect_1v1_attack(uuid,text,text)', 'EXECUTE'
  ) and has_function_privilege(
    'authenticated',
    'public.reflect_1v1_attack(uuid,text,text,uuid)', 'EXECUTE'
  ) and not has_function_privilege(
    'anon', 'public.reflect_1v1_attack(uuid,text,text)', 'EXECUTE'
  ) and has_function_privilege(
    'authenticated', 'public.activate_1v1_katana(uuid)', 'EXECUTE'
  ) and not has_function_privilege(
    'anon', 'public.activate_1v1_katana(uuid)', 'EXECUTE'
  ) and position(
    $$Katana is not active$$ in pg_get_functiondef(
      to_regprocedure('public.reflect_1v1_attack(uuid,text,text,uuid)')
    )
  ) > 0 and position(
    $$interval '1 second'$$ in pg_get_functiondef(
      to_regprocedure('public.reflect_1v1_attack(uuid,text,text,uuid)')
    )
  ) > 0 as pitch_reflection_permissions_secure,
  has_function_privilege(
    'authenticated',
    'public.activate_1v1_zenith_time_stop(uuid,bigint)',
    'EXECUTE'
  ) and not has_function_privilege(
    'anon',
    'public.activate_1v1_zenith_time_stop(uuid,bigint)',
    'EXECUTE'
  ) and position(
    $$v_self.character_key <> 'runner_zenith'$$ in pg_get_functiondef(
      to_regprocedure('public.activate_1v1_zenith_time_stop(uuid,bigint)')
    )
  ) > 0 and position(
    $$greatest(player.score, p_score) + 15000$$ in pg_get_functiondef(
      to_regprocedure('public.activate_1v1_zenith_time_stop(uuid,bigint)')
    )
  ) > 0 and position(
    $$p_score < v_self.score$$ in pg_get_functiondef(
      to_regprocedure('public.activate_1v1_zenith_time_stop(uuid,bigint)')
    )
  ) > 0 and position(
    $$zenith_time_stop_used then 15000$$ in pg_get_functiondef(
      to_regprocedure('app_private.enforce_1v1_score_ceiling()')
    )
  ) > 0 and to_regprocedure(
    'public.activate_1v1_zenith_time_stop(uuid)'
  ) is null as zenith_time_stop_permissions_secure,
  position(
    $$zenith_time_stop_until$$ in pg_get_functiondef(
      to_regprocedure('public.get_1v1_state(uuid)')
    )
  ) > 0 as zenith_time_stop_restores_after_reconnect;
