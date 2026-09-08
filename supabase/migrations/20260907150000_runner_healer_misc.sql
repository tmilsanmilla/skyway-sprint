-- RUNNER + HEALER MISC
-- Hidden totals, server-owned 1v1 point multipliers, and the finished
-- Runner/Healer ability catalog. Tank proposals are intentionally untouched.

begin;

do $$
begin
  if to_regclass('public.multiplayer_players') is null
     or to_regclass('public.multiplayer_point_events') is null
     or to_regclass('public.extraction_catalog') is null
     or not exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'multiplayer_players'
         and column_name = 'character_key'
     ) then
    raise exception 'Run Player 01 Stats and MAPS MISC first';
  end if;
end;
$$;

-- Health and attack points retain their real fractional values. The browser
-- alone rounds health up to a visible half-heart and attack points down to a
-- visible integer.
alter table public.multiplayer_players
  drop constraint if exists multiplayer_players_hearts_check,
  drop constraint if exists multiplayer_players_max_hearts_check,
  drop constraint if exists multiplayer_players_hearts_within_character_max_check,
  drop constraint if exists multiplayer_players_obstacle_points_check;

alter table public.multiplayer_point_events
  drop constraint if exists multiplayer_point_events_points_awarded_check;

-- Skip type changes once installed so reruns do not collide with the triggers
-- created later in this query.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='multiplayer_players'
      and column_name in ('hearts','max_hearts')
      and (numeric_precision<>12 or numeric_scale<>4)
  ) then
    execute 'alter table public.multiplayer_players
      alter column hearts type numeric(12,4) using hearts::numeric(12,4),
      alter column max_hearts type numeric(12,4) using max_hearts::numeric(12,4)';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='multiplayer_players'
      and column_name='obstacle_points'
      and (data_type<>'numeric' or numeric_precision<>16 or numeric_scale<>4)
  ) then
    execute 'alter table public.multiplayer_players
      alter column obstacle_points type numeric(16,4)
      using obstacle_points::numeric(16,4)';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='multiplayer_point_events'
      and column_name='points_awarded'
      and (data_type<>'numeric' or numeric_precision<>16 or numeric_scale<>4)
  ) then
    execute 'alter table public.multiplayer_point_events
      alter column points_awarded type numeric(16,4)
      using points_awarded::numeric(16,4)';
  end if;
end;
$$;

alter table public.multiplayer_players
  add column if not exists last_damage_at timestamptz,
  add column if not exists wave_started_at timestamptz not null default now(),
  add column if not exists run_started_at timestamptz not null default now();

alter table public.multiplayer_players
  add constraint multiplayer_players_hearts_check
    check (hearts between 0 and 12) not valid,
  add constraint multiplayer_players_max_hearts_check
    check (max_hearts between 1 and 12) not valid,
  add constraint multiplayer_players_hearts_within_character_max_check
    check (hearts <= max_hearts) not valid,
  add constraint multiplayer_players_obstacle_points_check
    check (obstacle_points between 0 and 1000000000) not valid;

alter table public.multiplayer_point_events
  add constraint multiplayer_point_events_points_awarded_check
    check (points_awarded > 0 and points_awarded <= 1000000) not valid;

alter table public.multiplayer_players
  validate constraint multiplayer_players_hearts_check;
alter table public.multiplayer_players
  validate constraint multiplayer_players_max_hearts_check;
alter table public.multiplayer_players
  validate constraint multiplayer_players_hearts_within_character_max_check;
alter table public.multiplayer_players
  validate constraint multiplayer_players_obstacle_points_check;
alter table public.multiplayer_point_events
  validate constraint multiplayer_point_events_points_awarded_check;

-- Keep the full finished ability text in the database so the browser and any
-- later client can share one canonical description. No Tank row is updated.
alter table public.extraction_catalog
  add column if not exists passive_ability text,
  add column if not exists weapon_effect text;

with finished_abilities(
  item_key, rarity, weapon_name, passive_ability, weapon_effect
) as (
  values
    ('runner_ace','common','Baton',
      'Earns 10% more score.',
      'Adds 3% distance score.'),
    ('runner_dash','common','Jet Baton',
      'Moves 6% faster and earns 6% more score; its E dash grants a 1-second speed burst and a brief shield.',
      'Adds 3% distance score.'),
    ('runner_stride','common','Pace Blades',
      'Every third lane change grants a 0.25-second dodge shield.',
      'Adds 3% distance score.'),
    ('tank_glacier','rare','Frost Shield',
      'Ignores snowflake freeze effects.',
      'Adds 5% distance score.'),
    ('runner_courier','uncommon','Parcel Staff',
      'A gem or attack coin grants 25% more score for 4 seconds.',
      'Adds 4% distance score.'),
    ('runner_tempo','uncommon','Rhythm Rod',
      'Odd waves are 15% faster with 15% more score; even waves are 15% slower with 15% less score.',
      'Adds 4% distance score.'),
    ('tank_reactor','rare','Core Maul',
      'Missing health gradually grants up to 40% more speed and 30% more score.',
      'Adds 5% distance score.'),
    ('runner_vector','rare','Arrow Lance',
      'Earns 12% more score in an outside lane and blocks the first outside-lane hit each wave.',
      'Adds 5% distance score.'),
    ('runner_blitz','rare','Volt Cleats',
      'Can dash and destroy the first non-rock obstacle ahead. Cooldown: 10 seconds.',
      'Adds 5% distance score.'),
    ('medic_halo','epic','Sun Staff',
      'At full health earns 15% more score; three hitless waves store a revive to 1 HP.',
      'Adds 6% distance score.'),
    ('runner_orbit','epic','Ring Blades',
      'Can wrap between outside lanes every 3 seconds.',
      'Adds 6% distance score.'),
    ('runner_relay','epic','Circuit Baton',
      'Every two completed waves overcharges a heart; losing it clears the closest obstacle in every lane.',
      'Adds 6% distance score.'),
    ('runner_horizon','legendary','Skyline Disc',
      'Previews upcoming obstacle counts; in 1v1 it reveals opponent purchases.',
      'Adds 7% distance score.'),
    ('runner_velocity','legendary','Turbo Spear',
      'Each hitless second grants 1% speed and 2% score, up to 100% speed and 200% score; a hit resets it.',
      'Adds 5% base speed and 10% score.'),
    ('runner_pacer','mythic','Relay Rod',
      'Starts each wave with 3x speed and 5x score for 15 seconds; once per run can continue after death as an owned non-Runner.',
      'Adds 10 score after every lane change.'),
    ('runner_zenith','mythic','Apex Relay',
      'Gains Runner abilities at waves 5, 7, 9, 10, and 12; at wave 15 can stop time for 10 seconds, heal fully, add 15000 score, then permanently slow obstacles 25%.',
      'Adds 8% distance score.'),
    ('medic_patch','common','Med Staff',
      'Heals 1.5 HP after each wave but cannot exceed 4 HP.',
      'Adds 3% distance score.'),
    ('medic_bloom','common','Bloom Wand',
      'The first gem each wave heals 0.5 HP.',
      'Adds 3% distance score.'),
    ('medic_remedy','common','Tonic Bell',
      'The first snowflake each wave heals 1 HP.',
      'Adds 3% distance score.'),
    ('medic_salve','common','Remedy Brush',
      'At 1 HP or less, completing a wave heals 1.5 HP.',
      'Adds 3% distance score.'),
    ('medic_reserve','uncommon','Field Pack',
      'Completing a wave at full HP stores 0.5 HP that can be used manually.',
      'Adds 4% distance score.'),
    ('medic_sprout','uncommon','Seed Scepter',
      'Once per wave can seed a non-barrel obstacle so it deals 0.5 less damage for two waves; up to two seeds.',
      'Adds 4% distance score.'),
    ('medic_mender','rare','Clock Needle',
      'Twenty hitless seconds heals 0.5 HP once per wave.',
      'Adds 5% distance score.'),
    ('medic_pulse','rare','Pulse Syringe',
      'On lethal damage, a 10-second timed-key challenge can revive for 1 HP at 10 hits, 2 HP at 20, or full HP at 30.',
      'Adds 5% distance score.'),
    ('medic_tonic','rare','Vital Flask',
      'Gems become ingredients; brew one 1, 2, or 3 HP potion for 5, 10, or 15 ingredients and use it manually. Wave healing is 0.5 HP.',
      'Adds 5% distance score.'),
    ('medic_suture','epic','Pulse Thread',
      'Can reach 5 HP. Restores to full every third wave; otherwise heals 1 HP only every second wave.',
      'Adds 6% distance score.'),
    ('medic_beacon','epic','Rescue Lamp',
      'Can reach 5.5 HP. At 1 HP, glows, disables spikes, and slows all obstacles by 50%.',
      'Adds 6% distance score.'),
    ('medic_lifeline','legendary','Rescue Hook',
      'Once per run, lethal damage restores maximum HP and makes that obstacle harmless; can pause and choose another lane three times.',
      'Activates the three-use lane Rescue Hook.'),
    ('medic_seraph','legendary','Halo Staff',
      'A hit can teleport to an empty lane; chance starts at 100% and drops 5% per activation. At 0%, Divine Recovery activates.',
      'Each gem has a 10% chance to heal 1 HP.'),
    ('tank_atlas','legendary','World Maul',
      'Keeps its healing passive, cannot fall below 1 HP, and must change lanes before the sky-crush timer expires.',
      'Halves obstacle damage for 2 seconds after changing lanes.'),
    ('medic_revive','legendary','Phoenix Feather',
      'Lethal damage leaves 0.5 HP and starts permanent flight: logs and spikes miss, speed and score rise 50%, and healing is disabled.',
      'After taking a hit, destroys the first obstacle of every later wave.'),
    ('medic_oracle','mythic','Fate Sensor',
      'Chooses a prophecy each wave; successes grant its reward and 5% permanent score, while failure costs 1 HP.',
      'Each wave, the first hit deals 0, the second half damage, and later hits full damage.' )
)
update public.extraction_catalog catalog
set rarity = ability.rarity,
    weapon_name = ability.weapon_name,
    passive_ability = ability.passive_ability,
    weapon_effect = ability.weapon_effect
from finished_abilities ability
where catalog.item_key = ability.item_key
  and catalog.item_type = 'character'
  and catalog.character_class in ('runner', 'medic');

update public.player_unlocks unlock
set rarity = catalog.rarity
from public.extraction_catalog catalog
where unlock.item_key = catalog.item_key
  and unlock.item_type = 'character'
  and catalog.item_type = 'character'
  and catalog.character_class in ('runner', 'medic')
  and unlock.rarity is distinct from catalog.rarity;

-- These weapons replace the generic rarity score bonus with their actual
-- in-game effect. Turbo Spear is the one exception: its explicit score bonus
-- is 10%, matching the client.
update public.extraction_catalog
set weapon_score_bonus = case item_key
  when 'runner_velocity' then 0.10
  else 0
end
where item_key in (
  'runner_velocity', 'runner_pacer', 'medic_lifeline', 'medic_seraph',
  'tank_atlas', 'medic_revive', 'medic_oracle'
)
and item_type = 'character'
and character_class in ('runner', 'medic');

-- Timestamp exact damage and wave boundaries without trusting the client.
create or replace function app_private.track_1v1_hidden_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.hearts < old.hearts then
    new.last_damage_at := clock_timestamp();
  end if;
  if new.wave > old.wave then
    new.wave_started_at := clock_timestamp();
  end if;
  return new;
end;
$$;

revoke all on function app_private.track_1v1_hidden_state()
  from public, anon, authenticated;

drop trigger if exists track_1v1_hidden_state on public.multiplayer_players;
create trigger track_1v1_hidden_state
before update of hearts, wave on public.multiplayer_players
for each row execute function app_private.track_1v1_hidden_state();

create or replace function app_private.one_v_one_attack_point_multiplier(
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
  v_multiplier numeric := 1;
  v_missing_ratio numeric := 0;
  v_hitless_seconds numeric := 0;
  v_weapon_bonus numeric := 0;
begin
  select coalesce(catalog.weapon_score_bonus, 0)
  into v_weapon_bonus
  from public.extraction_catalog catalog
  where catalog.item_key = p_character_key
    and catalog.item_type = 'character'
    and catalog.active;

  if p_max_hearts > 0 then
    v_missing_ratio := greatest(0, least(1,
      (p_max_hearts - p_hearts) / p_max_hearts));
  end if;

  v_multiplier := case p_character_key
    when 'runner_ace' then 1.10
    when 'runner_dash' then 1.06
    when 'runner_courier' then 1.25
    when 'runner_tempo' then case when mod(greatest(1, p_wave), 2) = 1
      then 1.15 else 0.85 end
    when 'tank_reactor' then 1 + 0.30 * v_missing_ratio
    when 'runner_vector' then case
      when p_lane_index in (0, greatest(0, p_lane_count - 1)) then 1.12
      else 1 end
    when 'medic_halo' then case
      when p_hearts >= p_max_hearts then 1.15 else 1 end
    when 'runner_velocity' then 1
    when 'runner_pacer' then case
      when statement_timestamp() < coalesce(p_wave_started_at, statement_timestamp())
           + interval '15 seconds' then 5 else 1 end
    when 'runner_zenith' then
      (1 + least(0.60, greatest(0, p_wave - 1) * 0.02))
        * case when p_wave >= 7 and p_hearts >= p_max_hearts
            then 1.15 else 1 end
        * case when p_wave >= 12 then 1.10 * 1.06 else 1 end
    else 1
  end;

  if p_character_key = 'runner_velocity' then
    v_hitless_seconds := least(100, greatest(0,
      extract(epoch from statement_timestamp() - coalesce(
        p_last_damage_at, p_run_started_at, statement_timestamp()
      ))));
    v_multiplier := 1 + v_hitless_seconds * 0.02;
  end if;

  -- Unique weapons replace the catalog's generic rarity score bonus. Turbo
  -- Spear has its own 10% score bonus; the other unique weapons provide the
  -- explicit non-score effects documented above and in the game client.
  v_weapon_bonus := case p_character_key
    when 'runner_velocity' then 0.10
    when 'runner_pacer' then 0
    when 'medic_lifeline' then 0
    when 'medic_seraph' then 0
    when 'tank_atlas' then 0
    when 'medic_revive' then 0
    when 'medic_oracle' then 0
    else v_weapon_bonus
  end;

  return greatest(0.1, round(v_multiplier * (1 + v_weapon_bonus), 4));
end;
$$;

revoke all on function app_private.one_v_one_attack_point_multiplier(
  text, integer, numeric, numeric, integer, integer, timestamptz, timestamptz,
  timestamptz
) from public, anon, authenticated;

-- Every positive server-side attack-point award (coin, wave, or Grove result)
-- receives the same score modifier. Spending is never multiplied.
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
  if new.obstacle_points <= old.obstacle_points then
    return new;
  end if;

  select coalesce(rules.lane_count, 5)
  into v_lane_count
  from public.multiplayer_matches match
  left join app_private.one_v_one_map_rules rules
    on rules.map_key = match.map_key
  where match.id = new.match_id;

  v_multiplier := app_private.one_v_one_attack_point_multiplier(
    new.character_key,
    new.wave,
    new.hearts,
    new.max_hearts,
    coalesce(new.lane_index, 0),
    v_lane_count,
    new.last_damage_at,
    new.wave_started_at,
    new.run_started_at
  );
  new.obstacle_points := old.obstacle_points
    + (new.obstacle_points - old.obstacle_points) * v_multiplier;
  return new;
end;
$$;

revoke all on function app_private.multiply_1v1_attack_point_award()
  from public, anon, authenticated;

drop trigger if exists multiply_1v1_attack_point_award
  on public.multiplayer_players;
create trigger multiply_1v1_attack_point_award
before update of obstacle_points on public.multiplayer_players
for each row execute function app_private.multiply_1v1_attack_point_award();

-- Record the same real fractional amount in coin receipts. The award RPC's
-- player-row update is independently multiplied by the trigger above.
create or replace function app_private.multiply_1v1_point_receipt()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player public.multiplayer_players;
  v_lane_count integer := 5;
begin
  select * into v_player
  from public.multiplayer_players player
  where player.match_id = new.match_id and player.user_id = new.user_id;
  if v_player.user_id is null then return new; end if;

  select coalesce(rules.lane_count, 5)
  into v_lane_count
  from public.multiplayer_matches match
  left join app_private.one_v_one_map_rules rules
    on rules.map_key = match.map_key
  where match.id = new.match_id;

  new.points_awarded := round(new.points_awarded *
    app_private.one_v_one_attack_point_multiplier(
      v_player.character_key,
      v_player.wave,
      v_player.hearts,
      v_player.max_hearts,
      coalesce(v_player.lane_index, 0),
      v_lane_count,
      v_player.last_damage_at,
      v_player.wave_started_at,
      v_player.run_started_at
    ), 4);
  return new;
end;
$$;

revoke all on function app_private.multiply_1v1_point_receipt()
  from public, anon, authenticated;

drop trigger if exists multiply_1v1_point_receipt
  on public.multiplayer_point_events;
create trigger multiply_1v1_point_receipt
before insert on public.multiplayer_point_events
for each row execute function app_private.multiply_1v1_point_receipt();

comment on column public.multiplayer_players.hearts is
  'Exact hidden HP. Clients render it rounded upward to the nearest half-heart.';
comment on column public.multiplayer_players.obstacle_points is
  'Exact attack-point total. Clients render it rounded downward to an integer.';
comment on column public.extraction_catalog.passive_ability is
  'Canonical character passive or active-ability summary.';
comment on column public.extraction_catalog.weapon_effect is
  'Canonical effect of the named weapon bundled with a character.';

notify pgrst, 'reload schema';
commit;

select
  'RUNNER + HEALER MISC'::text as installed_query,
  (select count(*) from public.extraction_catalog
   where item_type = 'character' and character_class = 'runner'
     and passive_ability is not null) as runner_abilities,
  (select count(*) from public.extraction_catalog
   where item_type = 'character' and character_class = 'medic'
     and passive_ability is not null) as healer_abilities,
  data_type as attack_point_storage
from information_schema.columns
where table_schema = 'public' and table_name = 'multiplayer_players'
  and column_name = 'obstacle_points';
