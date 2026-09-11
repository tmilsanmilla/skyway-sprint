-- Multi-device 01 -- intermission coin sync, ranked kit safety, and balance.
--
-- Forward-only and rerunnable. Attack-coin pickup ids are collected by the
-- browser during a wave, then claimed atomically only after that player has
-- entered intermission. Exact fractional point multipliers remain server-owned.

begin;

do $$
begin
  if to_regclass('public.multiplayer_matches') is null
     or to_regclass('public.multiplayer_players') is null
     or to_regclass('public.multiplayer_point_events') is null
     or to_regclass('public.player_progression_1v1_activity') is null
     or to_regclass('public.extraction_catalog') is null
     or to_regprocedure(
       'public.award_1v1_points(uuid,text,integer,text)'
     ) is null
     or to_regprocedure(
       'app_private.apply_ranked_result_to_active_season()'
     ) is null then
    raise exception
      'Run Player 01 Stats, Multi-device 01, and Leaderboard 03 first';
  end if;
end;
$$;

-- One batch is serialized with every other receipt write for this account.
-- Existing receipt ids are harmless retries; only unseen ids consume the
-- verified activity/wave allowance. There is deliberately no per-second gate:
-- the entire wave is supposed to arrive together during intermission.
create or replace function public.sync_1v1_intermission_coins(
  p_match_id uuid,
  p_pickup_ids text[]
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
  v_map_key text;
  v_coin_reward numeric := 2;
  v_active_seconds bigint;
  v_verified_wave integer;
  v_time_allowance bigint;
  v_wave_allowance bigint;
  v_allowed bigint;
  v_claimed bigint := 0;
  v_requested integer := 0;
  v_new_requested integer := 0;
  v_inserted integer := 0;
  v_nominal_award numeric := 0;
  v_balance_before numeric := 0;
  v_balance_after numeric := 0;
  v_now timestamptz := clock_timestamp();
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  if p_match_id is null or p_pickup_ids is null then
    raise exception 'Match and coin pickup ids are required';
  end if;
  if cardinality(p_pickup_ids) > 1000 then
    raise exception 'At most 1000 coin pickups may be synced at once';
  end if;
  if exists (
    select 1 from unnest(p_pickup_ids) item(pickup_id)
    where item.pickup_id is null
       or length(btrim(item.pickup_id)) not between 1 and 160
  ) then
    raise exception 'Every coin pickup id must contain 1 to 160 characters';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 1));
  select * into v_match
  from public.multiplayer_matches match_row
  where match_row.id = p_match_id
  for update;
  select * into v_self
  from public.multiplayer_players player
  where player.match_id = p_match_id and player.user_id = v_uid
  for update;
  if v_match.id is null or v_self.user_id is null then
    raise exception '1v1 match not found';
  end if;
  if v_self.status <> 'intermission'
     or v_match.status <> 'intermission'
     or v_match.intermission_ends_at is null
     or v_match.intermission_ends_at <= v_now then
    raise exception
      'Attack coins can only sync during the shared 10-second intermission';
  end if;
  if v_match.started_at <= now() - interval '6 hours' then
    raise exception '1v1 match is too old for new coin receipts';
  end if;

  v_map_key := coalesce(nullif(to_jsonb(v_match)->>'map_key', ''), 'classic');
  if to_regclass('app_private.one_v_one_map_rules') is not null then
    execute 'select coin_point_reward::numeric
      from app_private.one_v_one_map_rules where map_key=$1'
    into v_coin_reward using v_map_key;
    v_coin_reward := coalesce(v_coin_reward, 2);
  end if;

  select activity.active_seconds, activity.verified_wave
  into v_active_seconds, v_verified_wave
  from public.player_progression_1v1_activity activity
  where activity.match_id = p_match_id and activity.user_id = v_uid
  for update;
  if not found then
    raise exception 'Attack coins require verified 1v1 activity';
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
  if to_regclass('public.multiplayer_mushroom_events') is not null then
    execute 'select $1 + count(*)
      from public.multiplayer_mushroom_events
      where match_id=$2 and user_id=$3'
    into v_claimed using v_claimed, p_match_id, v_uid;
  end if;
  select v_claimed + count(*) into v_claimed
  from public.player_progression_events event
  where event.user_id = v_uid and event.source = 'gem'
    and event.metadata->>'context_id' = p_match_id::text;

  with requested as (
    select distinct btrim(item.pickup_id) as pickup_id
    from unnest(p_pickup_ids) item(pickup_id)
  )
  select count(*)::integer,
         count(*) filter (where receipt.pickup_id is null)::integer
  into v_requested, v_new_requested
  from requested
  left join public.multiplayer_point_events receipt
    on receipt.match_id = p_match_id
   and receipt.user_id = v_uid
   and receipt.pickup_id = requested.pickup_id;

  -- A retry containing only previously accepted ids must always be able to
  -- return the authoritative balance, even if later receipts used the rest of
  -- the allowance after the original response was lost.
  if v_new_requested > 0 and v_claimed + v_new_requested > v_allowed then
    raise exception 'Coin pickup allowance reached';
  end if;
  v_balance_before := v_self.obstacle_points;

  with requested as (
    select distinct btrim(item.pickup_id) as pickup_id
    from unnest(p_pickup_ids) item(pickup_id)
  ), inserted as (
    insert into public.multiplayer_point_events(
      match_id, user_id, pickup_id, source, points_awarded
    )
    select p_match_id, v_uid, requested.pickup_id, 'coin', v_coin_reward
    from requested
    on conflict (match_id, user_id, pickup_id) do nothing
    returning points_awarded
  )
  select count(*)::integer into v_inserted from inserted;

  if v_inserted > 0 then
    v_nominal_award := v_inserted * v_coin_reward;
    update public.multiplayer_players player
    set obstacle_points = player.obstacle_points + v_nominal_award,
        melons_collected = player.melons_collected + v_inserted,
        last_melon_at = v_now,
        last_seen_at = v_now,
        updated_at = v_now
    where player.match_id = p_match_id and player.user_id = v_uid;
    update public.multiplayer_matches match_row
    set last_activity_at = v_now
    where match_row.id = p_match_id;
  end if;

  select player.obstacle_points into v_balance_after
  from public.multiplayer_players player
  where player.match_id = p_match_id and player.user_id = v_uid;
  return jsonb_build_object(
    'match_id', p_match_id,
    'map_key', v_map_key,
    'phase', 'intermission',
    'requested', v_requested,
    'accepted', v_inserted,
    'duplicates', greatest(0, v_requested - v_inserted),
    'awarded', greatest(0, v_balance_after - v_balance_before),
    'points_per_coin', case when v_inserted > 0
      then round((v_balance_after - v_balance_before) / v_inserted, 4)
      else v_coin_reward
    end,
    'obstacle_points', v_balance_after,
    'coins_collected', v_self.melons_collected + v_inserted,
    'pickup_allowance', v_allowed,
    'coin_allowance', v_allowed
  );
end;
$$;

comment on function public.sync_1v1_intermission_coins(uuid, text[]) is
  'Atomically claims one wave of idempotent attack-coin receipts only during the shared 10-second intermission and returns the exact fractional balance.';

-- The old single-pickup RPC is intentionally no longer client-callable. This
-- prevents a browser from claiming coins before or after intermission.
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
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  raise exception
    'Use sync_1v1_intermission_coins during intermission for attack coins';
end;
$$;

comment on function public.award_1v1_points(uuid, text, integer, text) is
  'Retired single-pickup endpoint. Clients must batch attack coins during intermission.';

revoke all on function public.award_1v1_points(uuid, text, integer, text)
  from public, anon, authenticated;
do $$
begin
  if to_regprocedure('public.award_1v1_points(uuid,text,integer)') is not null then
    execute 'revoke all on function public.award_1v1_points(uuid,text,integer)
      from public,anon,authenticated';
  end if;
end;
$$;
revoke all on function public.sync_1v1_intermission_coins(uuid, text[])
  from public, anon, authenticated;
grant execute on function public.sync_1v1_intermission_coins(uuid, text[])
  to authenticated;

-- Direct catalog purchases use the requested rarity price. Extraction-box
-- prices and duplicate refunds are unchanged.
create or replace function app_private.direct_catalog_price(p_rarity text)
returns integer
language sql
immutable
strict
set search_path = ''
as $$
  select case lower(p_rarity)
    when 'common' then 5
    when 'uncommon' then 10
    when 'rare' then 15
    when 'epic' then 25
    when 'legendary' then 175
    when 'mythic' then 2000
    else null
  end;
$$;
revoke all on function app_private.direct_catalog_price(text)
  from public, anon, authenticated;

-- Ranked refuses mythic kits at both the queue boundary and the immutable
-- match snapshot boundary. Casual remains unrestricted.
create or replace function app_private.reject_ranked_mythic_queue()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rarity text;
begin
  if coalesce(to_jsonb(new)->>'mode', 'casual') <> 'ranked' then
    return new;
  end if;
  select catalog.rarity into v_rarity
  from public.player_loadouts loadout
  join public.extraction_catalog catalog
    on catalog.item_key = loadout.character_key
   and catalog.item_type = 'character'
   and catalog.active
  join public.player_unlocks unlock
    on unlock.user_id = loadout.user_id
   and unlock.item_key = loadout.character_key
   and unlock.item_type = 'character'
  where loadout.user_id = new.user_id;
  if v_rarity = 'mythic' then
    raise exception 'Mythic characters cannot enter Ranked 1v1';
  end if;
  return new;
end;
$$;

create or replace function app_private.reject_ranked_mythic_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mode text;
  v_rarity text;
begin
  select match_row.mode into v_mode
  from public.multiplayer_matches match_row
  where match_row.id = new.match_id;
  if v_mode <> 'ranked' then return new; end if;
  select catalog.rarity into v_rarity
  from public.extraction_catalog catalog
  where catalog.item_key = new.character_key
    and catalog.item_type = 'character' and catalog.active;
  if v_rarity = 'mythic' then
    raise exception 'Mythic characters cannot enter Ranked 1v1';
  end if;
  return new;
end;
$$;

create or replace function app_private.reject_ranked_mythic_match_mode()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.mode = 'ranked' and exists (
    select 1
    from public.multiplayer_players player
    join public.extraction_catalog catalog
      on catalog.item_key = player.character_key
     and catalog.item_type = 'character'
    where player.match_id = new.id and catalog.rarity = 'mythic'
  ) then
    raise exception 'Mythic characters cannot enter Ranked 1v1';
  end if;
  return new;
end;
$$;

create or replace function app_private.evict_ranked_mythic_loadout()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.extraction_catalog catalog
    where catalog.item_key = new.character_key
      and catalog.item_type = 'character'
      and catalog.active and catalog.rarity = 'mythic'
  ) then
    delete from public.multiplayer_queue queue
    where queue.user_id = new.user_id
      and coalesce(to_jsonb(queue)->>'mode', 'casual') = 'ranked';
  end if;
  return new;
end;
$$;

revoke all on function app_private.reject_ranked_mythic_queue()
  from public, anon, authenticated;
revoke all on function app_private.reject_ranked_mythic_snapshot()
  from public, anon, authenticated;
revoke all on function app_private.reject_ranked_mythic_match_mode()
  from public, anon, authenticated;
revoke all on function app_private.evict_ranked_mythic_loadout()
  from public, anon, authenticated;
drop trigger if exists reject_ranked_mythic_queue on public.multiplayer_queue;
create trigger reject_ranked_mythic_queue
before insert or update on public.multiplayer_queue
for each row execute function app_private.reject_ranked_mythic_queue();
drop trigger if exists reject_ranked_mythic_snapshot
  on public.multiplayer_players;
create trigger reject_ranked_mythic_snapshot
before insert or update of character_key on public.multiplayer_players
for each row execute function app_private.reject_ranked_mythic_snapshot();
drop trigger if exists reject_ranked_mythic_match_mode
  on public.multiplayer_matches;
create trigger reject_ranked_mythic_match_mode
before update of mode on public.multiplayer_matches
for each row execute function app_private.reject_ranked_mythic_match_mode();
drop trigger if exists evict_ranked_mythic_loadout on public.player_loadouts;
create trigger evict_ranked_mythic_loadout
after insert or update of character_key on public.player_loadouts
for each row execute function app_private.evict_ranked_mythic_loadout();

-- Remove stale ranked queue rows created before this gate. No match or account
-- data is deleted.
delete from public.multiplayer_queue queue
where coalesce(to_jsonb(queue)->>'mode', 'casual') = 'ranked'
  and exists (
    select 1
    from public.player_loadouts loadout
    join public.extraction_catalog catalog
      on catalog.item_key = loadout.character_key
     and catalog.item_type = 'character'
    where loadout.user_id = queue.user_id and catalog.rarity = 'mythic'
  );

-- Finished Tank, Trickster, and Misc descriptions. These rows document the
-- actual ability contracts without pretending that metadata alone implements
-- stateful minigames. Explicit rarity/weapon changes are synchronized below.
with ability_updates(
  item_key, rarity, passive_ability, weapon_effect, weapon_score_bonus
) as (values
  ('tank_bulwark','common','Ignores the first hit each wave and takes 20% less damage from every source.','Tower Shield adds 3% distance score.',.03),
  ('runner_vault','common','Vaults over spikes and logs without taking damage.','Spring Pole adds 3% distance score.',.03),
  ('tank_guard','common','Takes 30% less damage from every source and earns 10% less score.','Iron Buckler adds 3% distance score.',.03),
  ('tank_brace','uncommon','Takes 50% more damage from every source but takes no spike damage.','Spike Buckler adds 15% distance score.',.15),
  ('tank_ironclad','uncommon','Takes 50% more damage from every source but takes no log damage.','Plate Hammer adds 4% distance score.',.04),
  ('medic_mercy','rare','The first hit each wave deals 50% less damage; after each protected hit there is a 25% chance protection continues, and a failed roll ends it for that wave.','Injector adds 5% distance score.',.05),
  ('tank_hammer','rare','Takes 10% less damage. Press E to destroy the first non-rock obstacle in the current lane and both neighboring lanes; at an edge, destroy two in the only neighboring lane.','War Hammer powers Hammer but cannot destroy rocks.',0),
  ('tank_anchor','rare','Press E to lock lane movement and take 75% less damage for 5 seconds, then movement unlocks.','Ground Hook adds 5% distance score.',.05),
  ('tank_warden','rare','Can reach 4 HP, takes 25% less damage, and can click or tap a spike to darken and deactivate it.','Lock Shield adds 5% distance score.',.05),
  ('tank_bastion','epic','Each second in one lane stores 5% damage reduction for the next hit, up to 100% after 20 seconds; taking a hit resets it.','Fortress Shield adds 6% distance score.',.06),
  ('tank_rampart','epic','Takes 20% less damage at 2 HP, 30% less at 1.5 HP, 40% less at 1 HP, and 50% less at 0.5 HP.','Siege Wall adds 6% distance score.',.06),
  ('trickster_jester','epic','Each wave randomly gains a positive effect (first hit ignored, 50% damage reduction, or barrel immunity), a neutral 1-100% score-and-hazard-speed boost, or a negative effect (first hit doubled, 50% more damage, or double barrel damage).','Card Fan adds 6% distance score.',.06),
  ('tank_citadel','epic','At wave start ignores 1-3 obstacles, equal to consecutive flawless waves and capped at 3.','Rampart Axe adds 6% distance score.',.06),
  ('tank_sentinel','legendary','Each wave analyzes the obstacle type that dealt the most damage this run: it glows blue, deals 75% less damage, and its first hit that wave is ignored.','Press E with Steel Spear to slow barrels by 75% for 15 seconds.',0),
  ('tank_colossus','legendary','Can reach 10 HP and heals 2 HP only after a flawless wave. Each HP above 3 grants 5% score and slows hazards 5%; rocks deal 1.5 at 5 HP, 1 at 7 HP, and 0 at 10 HP.','Titan Maul reduces all damage 35% and rock damage 50%.',0),
  ('trickster_phantom','mythic','Ignores the first kind of each damaging obstacle each wave. Night waves double score, add 50% speed, ignore two of each obstacle kind, and cancel snowflakes; Bloodmoons make two red obstacle kinds harmless and healing; LORDSDOWN combines the best effects at 10 HP and death transforms Phantom into a 6-HP Lord with capped 50% hit negation and Eviscerate. Temporary night HP returns to 3.','Moon Scythe grants 5 seconds of invincibility at the start of every night wave.',0),
  ('trickster_smoke','common','Every 20 seconds press E to teleport to a currently safe lane; in 1v1 hold E for 3 seconds to obscure the top of the opponent lane with smoke.','Smoke Bombs add 3% distance score.',.03),
  ('runner_drift','uncommon','Lane changes no more than 0.5 seconds apart stack 15% score and equal hazard speed up to 200%; a hit resets it. In Ranked, E adds 0.1-second opponent input delay for 5 seconds and stacks with freeze.','Slipstream Shoes add 4% distance score.',.04),
  ('runner_spark','uncommon','Every collected gem permanently adds 1% score for the run. In 1v1, a 15-coin Sparked Gem damages its collector for 1 HP and heals Spark for 0.5 HP.','Prism Baton adds 4% distance score.',.04),
  ('tank_plow','uncommon','Keeps Plow''s current obstacle-breaking ability; in 1v1, 20 attack coins can set a false HP total visible only to the opponent.','Ram Shield adds 4% distance score.',.04),
  ('trickster_rogue','common','One graze per 5 seconds fills Shadow: at 2, E grants 0.45 seconds invincibility without lane changes; at 5, E clears the screen; at 10, E grants 5 seconds invincibility without lane changes.','Daggers add 4% distance score.',.04),
  ('trickster_clockwork','uncommon','Hazards start 10% slower and slow another 0.5% per second, capped at 60%; in 1v1 the opponent''s sent hazards accelerate inversely.','Time Cards add 4% distance score.',.04),
  ('trickster_flicker','rare','Once per wave press E to turn the closest obstacle in every lane into a gem, melon, or attack coin; in 1v1 it also swaps all opponent obstacles.','Blink Knives add 5% distance score.',.05),
  ('runner_flare','epic','Every 30 seconds press E to place a 15-second flare that burns logs, barrels, and snowflakes; every 10 burns reduces cooldown 5 seconds to a 15-second minimum, and burned hazards are sent to the opponent.','Signal Spear adds 6% distance score.',.06),
  ('trickster_pickpocket','rare','Doubles every source of score and gems. Once per 1v1 wave, E steals the ceiling of 10% of opponent attack coins, at least 1; no steal occurs when both players use Pickpocket.','Coin Dagger adds 5% distance score.',.05),
  ('trickster_switch','rare','At 50 cumulative lane changes gain 10% score; at 100, lane changes grant delayed 0.25-second invincibility; at 1000 in 1v1, spend 50 attack coins to secretly remap opponent purchases.','Twin Coins add 5% distance score.',.05),
  ('trickster_gambit','legendary','Draws five cards per wave into a 10-card hand and pauses while managing it. Poker hands grant escalating one-wave and permanent HP, score, defense, revive, coin-steal, and 1v1 doubled-attack rewards, from High Card through Royal Flush.','Loaded Cards enable the poker-hand rewards.',0),
  ('medic_vial','epic','Gem collection costs 1 HP and wave end heals to full. Once per 1v1, E changes obstacle allegiance for 30 seconds: hazards heal by type, melons damage and subtract score, currents pull, and gems damage both players; Endless applies the allegiance effect to Vial.','Tonic Flask adds 6% distance score.',.06),
  ('trickster_mirage','epic','Once per 1v1 wave, E enters the opponent field for 5 seconds invulnerably; sharing their lane every 0.5 seconds deals 1 HP, then Mirage takes 1 HP when it ends.','Prism Fans add 6% distance score.',.06),
  ('runner_comet','legendary','In 1v1 intermission, obstacle prices are halved and quantities doubled; E can remove natural incoming hazards at fixed costs. Shared HEATFEAST stores spent coins and unlocks coin, damage, tax, removal, sending, and split-attack bonuses as it is consumed.','Star Spear multiplies attack-coin income by 1.5.',0),
  ('trickster_hex','mythic','On even waves, E enters a 15-second Void Realm to collect Damnation without advancing the wave. Thresholds unlock score, Current, Souls, damage reduction, Hades, god revives, throne invincibility, opponent Void effects, and doubled opponent damage.','Press R to throw Void Chakram, deleting one obstacle and tripling it toward the opponent in 1v1.',0),
  ('trickster_echo','mythic','Completes ordered Mirror quests for six shards and selected non-mythic passives. The Knowing unlocks an 8-HP mirror phase with 80% reduction, reflected damage, shard-powered score, Mirror Realm healing, and a final reflective phase; Endless removes opponent-targeted effects.','Repeat Knives channel the Mirror quests and realm.',0),
  ('runner_scout','common','Keeps Scout''s current ability. Every 50 seconds, E starts a timed input; success makes the next snowflake heal 0.5 HP.','Twin Blades add 3% distance score.',.03),
  ('tank_drag','common','Keeps Drag''s passive. Once per wave, E leaves a chain; pressing E again pulls Drag back to that lane with invincibility during the pull.','Chain Hook adds 3% distance score.',.03),
  ('misc_nomad','common','Lethal damage has a 50% chance to leave 0.5 HP and permanently slow all obstacles 20%.','Trail Hook adds 3% distance score.',.03),
  ('misc_tinker','common','Clicking each spike once grants Inspiration; at 3 Inspiration, E launches a handmade spike that destroys the first projectile it meets.','Gear Wrench adds 3% distance score.',.03),
  ('runner_ranger','uncommon','Every 30 seconds, E zips to an on-screen 1v1 coin, gem, or melon; melons award double score.','Pixel Bow adds 4% distance score.',.04),
  ('misc_broker','uncommon','Stores gems, coins, and melons in separate funds that move +1-50% on a 60% roll or -1-50% on a 40% roll each wave; death pays out gems and melon score, while coins can be claimed manually.','Coin Cane adds 4% distance score.',.04),
  ('misc_prospector','uncommon','Warns five seconds before each gem and highlights its future lane.','Gem Pick adds 4% distance score.',.04),
  ('misc_lantern','uncommon','Press E to freeze every obstacle for 2 seconds.','Glow Rod adds 4% distance score.',.04),
  ('runner_fortune','rare','Adds gem spawn chance equal to gems collected this run, capped at 100%.','Lucky Compass adds 5% distance score.',.05),
  ('misc_scribe','rare','At wave end chooses one hazard and caps its next-wave spawns at wave divided by 10, minimum 1.','Rune Quill adds 5% distance score.',.05),
  ('misc_weaver','rare','After five snowflakes, E weaves permanent snowflake immunity; afterward every second snowflake heals 0.5 HP, capped at 1 HP per wave.','Thread Blades add 5% distance score.',.05),
  ('trickster_wildcard','epic','Draws from a 54-card deck each wave: numbers grant rank x 5% score, face cards grant defense, Aces grant 60% score and defense, and Jokers ignore five hits; exhausting the deck permanently activates Ace and Joker.','Dice Fans add 6% distance score.',.06),
  ('misc_mimic','epic','In 1v1 copies the opponent''s non-mythic character; in Endless selects two passives of Rare rarity or lower.','Copy Mask adds 6% distance score.',.06),
  ('misc_catalyst','epic','Pickups two lanes away move 50% slower while pickups in the same or neighboring lane move 50% faster; E collects every pickup on screen.','Flux Vial adds 6% distance score.',.06),
  ('misc_harvester','legendary','At 10 collected gems, melons, or individual attack coins unlocks separate 30-second E abilities to deflect, harvest, or plant a stealing fake coin; reaching 50 of a resource greatly upgrades its matching ability.','Crescent Sickle enables Harvester progression.',0),
  ('misc_muse','mythic','Caps the field at five obstacles and once pauses for a 30-second rhythm challenge. Accuracy tiers unlock permanent score, slow, defense, healing music, notes, Disco Unleash, perfect revives, escalating replay challenges, and an 8-HP finale.','Dream Harp powers Muse Mix and rhythm abilities.',0),
  ('tank_atlas','legendary','Can reach 7 HP and can fall below 1 normally. Every obstacle hit shortens Sky Crush by 0.5 seconds, to a 1-second minimum.','World Maul halves obstacle damage for 2 seconds after changing lanes.',0)
)
update public.extraction_catalog catalog
set rarity = ability.rarity,
    passive_ability = ability.passive_ability,
    weapon_effect = ability.weapon_effect,
    weapon_score_bonus = ability.weapon_score_bonus
from ability_updates ability
where catalog.item_key = ability.item_key
  and catalog.item_type = 'character';

-- Ownership snapshots follow the authoritative catalog rarity without
-- granting any new item.
update public.player_unlocks unlock
set rarity = catalog.rarity
from public.extraction_catalog catalog
where catalog.item_key = unlock.item_key
  and catalog.item_type = unlock.item_type
  and unlock.rarity is distinct from catalog.rarity;

-- Rarity changes in this same migration can make an already queued kit mythic.
delete from public.multiplayer_queue queue
where coalesce(to_jsonb(queue)->>'mode', 'casual') = 'ranked'
  and exists (
    select 1
    from public.player_loadouts loadout
    join public.extraction_catalog catalog
      on catalog.item_key = loadout.character_key
     and catalog.item_type = 'character'
    where loadout.user_id = queue.user_id and catalog.rarity = 'mythic'
  );

-- Existing score modifiers also multiply positive 1v1 attack-coin awards.
-- This extends the existing server helper only where the attached rules expose
-- a value derivable from the already-snapshotted player row.
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
  v_character_class text := 'runner';
begin
  select coalesce(catalog.weapon_score_bonus, 0), catalog.character_class
  into v_weapon_bonus, v_character_class
  from public.extraction_catalog catalog
  where catalog.item_key = p_character_key
    and catalog.item_type = 'character' and catalog.active;
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
      when statement_timestamp() < coalesce(
        p_wave_started_at, statement_timestamp()
      ) + interval '15 seconds' then 5 else 1 end
    when 'runner_zenith' then
      (1 + least(0.60, greatest(0, p_wave - 1) * 0.02))
      * case when p_wave >= 7 and p_hearts >= p_max_hearts
          then 1.15 else 1 end
      * case when p_wave >= 12 then 1.10 * 1.06 else 1 end
    when 'tank_guard' then 0.90
    when 'tank_colossus' then 1 + greatest(0, p_hearts - 3) * 0.05
    when 'trickster_phantom' then case
      when mod(greatest(1, p_wave), 2) = 0 then 2 else 1 end
    when 'trickster_pickpocket' then 2
    when 'runner_comet' then 1.5
    else 1
  end;
  -- Tricksters earn the same 15% base score modifier in 1v1 attack coins.
  if v_character_class = 'trickster' then
    v_multiplier := v_multiplier * 1.15;
  end if;
  if p_character_key = 'runner_velocity' then
    v_hitless_seconds := least(100, greatest(0,
      extract(epoch from statement_timestamp() - coalesce(
        p_last_damage_at, p_run_started_at, statement_timestamp()
      ))));
    v_multiplier := 1 + v_hitless_seconds * 0.02;
  end if;
  v_weapon_bonus := case p_character_key
    when 'runner_velocity' then 0.10
    when 'runner_pacer' then 0
    when 'medic_lifeline' then 0
    when 'medic_seraph' then 0
    when 'tank_atlas' then 0
    when 'medic_revive' then 0
    when 'medic_oracle' then 0
    when 'tank_hammer' then 0
    when 'tank_sentinel' then 0
    when 'tank_colossus' then 0
    when 'trickster_phantom' then 0
    when 'trickster_gambit' then 0
    when 'runner_comet' then 0
    when 'trickster_hex' then 0
    when 'trickster_echo' then 0
    when 'misc_harvester' then 0
    when 'misc_muse' then 0
    else v_weapon_bonus
  end;
  return greatest(0.1, round(v_multiplier * (1 + v_weapon_bonus), 4));
end;
$$;
revoke all on function app_private.one_v_one_attack_point_multiplier(
  text, integer, numeric, numeric, integer, integer, timestamptz,
  timestamptz, timestamptz
) from public, anon, authenticated;

-- Spark's cumulative gem modifier is derived only from immutable, server-
-- accepted gem receipts for this exact match. The overload keeps the original
-- helper available to older server code while the two award triggers use the
-- receipt-aware version.
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
  end if;
  return greatest(0.1, round(v_multiplier, 4));
end;
$$;
revoke all on function app_private.one_v_one_attack_point_multiplier(
  uuid, uuid, text, integer, numeric, numeric, integer, integer, timestamptz,
  timestamptz, timestamptz
) from public, anon, authenticated;

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
  from public.multiplayer_matches match_row
  left join app_private.one_v_one_map_rules rules
    on rules.map_key = match_row.map_key
  where match_row.id = new.match_id;
  new.points_awarded := round(new.points_awarded *
    app_private.one_v_one_attack_point_multiplier(
      new.match_id, new.user_id, v_player.character_key, v_player.wave,
      v_player.hearts, v_player.max_hearts,
      coalesce(v_player.lane_index, 0), v_lane_count,
      v_player.last_damage_at, v_player.wave_started_at,
      v_player.run_started_at
    ), 4);
  return new;
end;
$$;
revoke all on function app_private.multiply_1v1_point_receipt()
  from public, anon, authenticated;

drop trigger if exists multiply_1v1_attack_point_award
  on public.multiplayer_players;
create trigger multiply_1v1_attack_point_award
before update of obstacle_points on public.multiplayer_players
for each row execute function app_private.multiply_1v1_attack_point_award();
drop trigger if exists multiply_1v1_point_receipt
  on public.multiplayer_point_events;
create trigger multiply_1v1_point_receipt
before insert on public.multiplayer_point_events
for each row execute function app_private.multiply_1v1_point_receipt();

-- Change every live second-death path and its score allowance from 75 to 280.
-- Function-definition replacement keeps this delta aligned with the newest
-- map implementation without restoring an older copy of those large RPCs.
do $second_death_280$
declare
  v_proc regprocedure;
  v_definition text;
begin
  foreach v_proc in array array[
    to_regprocedure('app_private.finalize_1v1_after_second_death(uuid,timestamptz)'),
    to_regprocedure('app_private.enforce_1v1_score_ceiling()'),
    to_regprocedure('public.get_1v1_state(uuid)')
  ]
  loop
    if v_proc is null then
      raise exception 'Required 1v1 second-death function is missing';
    end if;
    v_definition := pg_get_functiondef(v_proc);
    if v_proc::text like 'finalize_1v1_after_second_death%'
       or v_proc::text like 'app_private.finalize_1v1_after_second_death%' then
      v_definition := replace(v_definition, 'score + 75', 'score + 280');
      v_definition := replace(v_definition, 'score+75', 'score+280');
    elsif v_proc::text like 'enforce_1v1_score_ceiling%'
       or v_proc::text like 'app_private.enforce_1v1_score_ceiling%' then
      v_definition := replace(
        v_definition,
        'when v_second_death_bonus then 75 else 0 end',
        'when v_second_death_bonus then 280 else 0 end'
      );
      v_definition := replace(
        v_definition,
        'when new.second_death_bonus_awarded then 75 else 0 end',
        'when new.second_death_bonus_awarded then 280 else 0 end'
      );
      v_definition := replace(
        v_definition,
        'when v_second_death_bonus then 75 else 0',
        'when v_second_death_bonus then 280 else 0'
      );
      v_definition := replace(
        v_definition,
        'when new.second_death_bonus_awarded then 75 else 0',
        'when new.second_death_bonus_awarded then 280 else 0'
      );
    else
      v_definition := replace(
        v_definition,
        '''second_death_bonus_points'', 75',
        '''second_death_bonus_points'', 280'
      );
      v_definition := replace(
        v_definition,
        '''second_death_bonus_points'',75',
        '''second_death_bonus_points'',280'
      );
    end if;
    execute v_definition;
  end loop;
end;
$second_death_280$;

-- Elo already uses the literal requested formula, prior-game K, and a locked
-- pool-wide recenter to 1500. These assertions prevent a later merge from
-- silently restoring an older rating function.
do $$
declare
  v_elo text := pg_get_functiondef(to_regprocedure(
    'app_private.apply_ranked_result_to_active_season()'
  ));
begin
  if position('/ 600' in v_elo) = 0
     or position('525::numeric / (v_one.matches_played + 10)' in v_elo) = 0
     or position('v_one.matches_played <= 27' in v_elo) = 0
     or position('v_center_offset := 1500 - v_average_rating' in v_elo) = 0 then
    raise exception 'Leaderboard 03 does not match the requested 1500 Elo formula';
  end if;
end;
$$;

-- Installation/security assertions.
do $$
begin
  if not has_function_privilege(
       'authenticated',
       'public.sync_1v1_intermission_coins(uuid,text[])',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.sync_1v1_intermission_coins(uuid,text[])',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.award_1v1_points(uuid,text,integer,text)',
       'EXECUTE'
     ) then
    raise exception 'Intermission coin RPC permissions are unsafe';
  end if;
  if app_private.direct_catalog_price('legendary') <> 175 then
    raise exception 'Legendary direct-purchase price was not updated';
  end if;
  if exists (
    select 1 from (values
      ('trickster_flicker','rare'),
      ('runner_flare','epic'),
      ('trickster_gambit','legendary'),
      ('trickster_hex','mythic')
    ) expected(item_key, rarity)
    left join public.extraction_catalog catalog using (item_key)
    where catalog.rarity is distinct from expected.rarity
  ) then
    raise exception 'Attached character rarity changes are incomplete';
  end if;
  if (select count(*) from public.extraction_catalog catalog
      where catalog.item_type = 'character' and catalog.active
        and catalog.passive_ability is not null
        and catalog.weapon_effect is not null) <> 80 then
    raise exception 'Character ability metadata is incomplete';
  end if;
  if exists (
    select 1
    from public.player_unlocks unlock
    join public.extraction_catalog catalog using (item_key)
    where unlock.item_type = catalog.item_type
      and unlock.rarity is distinct from catalog.rarity
  ) then
    raise exception 'Owned-item rarity metadata is out of sync';
  end if;
  if position('runner_spark' in pg_get_functiondef(to_regprocedure(
       'app_private.one_v_one_attack_point_multiplier(uuid,uuid,text,integer,numeric,numeric,integer,integer,timestamptz,timestamptz,timestamptz)'
     ))) = 0
     or position('v_character_class = ''trickster''' in pg_get_functiondef(
       to_regprocedure(
         'app_private.one_v_one_attack_point_multiplier(text,integer,numeric,numeric,integer,integer,timestamptz,timestamptz,timestamptz)'
       )
     )) = 0 then
    raise exception 'Server attack-point character modifiers are incomplete';
  end if;
  if position('score + 280' in pg_get_functiondef(to_regprocedure(
       'app_private.finalize_1v1_after_second_death(uuid,timestamptz)'
     ))) = 0
     or position('then 280 else 0 end' in pg_get_functiondef(to_regprocedure(
       'app_private.enforce_1v1_score_ceiling()'
     ))) = 0
     or position('''second_death_bonus_points'', 280' in pg_get_functiondef(
       to_regprocedure('public.get_1v1_state(uuid)')
     )) = 0 then
    raise exception 'The 280-point second-death bonus is incomplete';
  end if;
end;
$$;

notify pgrst, 'reload schema';
commit;

select
  to_regprocedure('public.sync_1v1_intermission_coins(uuid,text[])')
    is not null as intermission_coin_sync_installed,
  not has_function_privilege(
    'authenticated',
    'public.award_1v1_points(uuid,text,integer,text)',
    'EXECUTE'
  ) as live_coin_rpc_retired,
  app_private.direct_catalog_price('legendary')
    as legendary_direct_price,
  (select count(*) from public.extraction_catalog
   where item_type='character' and passive_ability is not null
     and weapon_effect is not null) as documented_characters;
