-- Multi-device 02 Coins + Loadout Fix
-- Coins replace melons as the 1v1 pickup currency. This migration also repairs
-- the named arguments exposed by the set_loadout RPC.

-- Heart, wave, and score snapshots are sent from each device. Advancing a wave
-- automatically awards three obstacle points per completed wave exactly once.
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
  v_opponent_id uuid;
  v_completed_wave integer;
  v_wave_reward integer := 0;
begin
  if v_uid is null then
    raise exception 'Sign in required';
  end if;
  if p_hearts < 0 or p_hearts > 5 or mod(p_hearts, 0.5) <> 0 then
    raise exception 'Hearts must be between 0 and 5 in half-heart steps';
  end if;
  if p_wave < 1 or p_score < 0 then
    raise exception 'Invalid 1v1 state';
  end if;
  if p_status not in ('playing', 'intermission', 'eliminated') then
    raise exception 'Invalid player status';
  end if;

  select * into v_match
  from public.multiplayer_matches
  where id = p_match_id
  for update;
  select * into v_self
  from public.multiplayer_players
  where match_id = p_match_id and user_id = v_uid
  for update;

  if v_match.id is null or v_self.user_id is null then
    raise exception '1v1 match not found';
  end if;
  if v_match.status not in ('countdown', 'playing', 'intermission') then
    raise exception 'This 1v1 match has ended';
  end if;
  if p_wave < v_self.wave or p_wave > v_self.wave + 1 then
    raise exception 'Wave can only advance one at a time';
  end if;
  if p_score < v_self.score then
    raise exception 'Score cannot decrease';
  end if;

  v_completed_wave := greatest(0, p_wave - 1);
  if v_completed_wave > v_self.last_rewarded_wave then
    v_wave_reward := (v_completed_wave - v_self.last_rewarded_wave) * 3;
  end if;

  if p_status = 'playing'
     and v_match.status = 'intermission'
     and v_match.intermission_ends_at > now() then
    raise exception 'The 15-second intermission is still active';
  end if;

  update public.multiplayer_players
  set hearts = p_hearts,
      wave = p_wave,
      score = p_score,
      obstacle_points = obstacle_points + v_wave_reward,
      last_rewarded_wave = greatest(last_rewarded_wave, v_completed_wave),
      status = case when p_hearts = 0 then 'eliminated' else p_status end,
      last_seen_at = now(),
      updated_at = now()
  where match_id = p_match_id and user_id = v_uid;

  if p_hearts = 0 or p_status = 'eliminated' then
    select user_id into v_opponent_id
    from public.multiplayer_players
    where match_id = p_match_id and user_id <> v_uid
    limit 1;

    update public.multiplayer_players
    set status = case when user_id = v_uid then 'eliminated' else 'finished' end,
        updated_at = now()
    where match_id = p_match_id;

    update public.multiplayer_matches
    set status = 'finished',
        winner_user_id = v_opponent_id,
        finished_at = now(),
        last_activity_at = now(),
        intermission_ends_at = null
    where id = p_match_id;
  elsif p_status = 'intermission' then
    update public.multiplayer_matches
    set status = 'intermission',
        current_wave = greatest(current_wave, p_wave),
        intermission_ends_at = case
          when status = 'intermission' and intermission_ends_at > now()
            then intermission_ends_at
          else now() + interval '15 seconds'
        end,
        last_activity_at = now()
    where id = p_match_id;
  else
    update public.multiplayer_matches
    set status = 'playing',
        current_wave = greatest(current_wave, p_wave),
        intermission_ends_at = null,
        last_activity_at = now()
    where id = p_match_id;
  end if;

  return public.get_1v1_state(p_match_id);
end;
$$;

-- A coin is worth two obstacle points. "melon" remains accepted so that an
-- already-open client cannot lose a pickup while the new version deploys.
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
  v_self public.multiplayer_players;
  v_match_status text;
  v_source text := lower(trim(p_source));
  v_awarded integer := 0;
begin
  if v_uid is null then
    raise exception 'Sign in required';
  end if;

  select m.status into v_match_status
  from public.multiplayer_matches m
  where m.id = p_match_id
  for update;
  select * into v_self
  from public.multiplayer_players
  where match_id = p_match_id and user_id = v_uid
  for update;

  if v_self.user_id is null or v_match_status not in ('countdown', 'playing', 'intermission') then
    raise exception 'Active 1v1 match not found';
  end if;

  if v_source in ('coin', 'melon') then
    if p_amount <> 1 then
      raise exception 'Coins must be awarded one pickup at a time';
    end if;
    if v_self.last_melon_at is not null
       and v_self.last_melon_at > now() - interval '100 milliseconds' then
      raise exception 'Coin pickup arrived too quickly';
    end if;
    v_awarded := 2;
    update public.multiplayer_players
    set obstacle_points = obstacle_points + v_awarded,
        -- Retain the existing column as a backwards-compatible pickup counter.
        melons_collected = melons_collected + 1,
        last_melon_at = now(),
        last_seen_at = now(),
        updated_at = now()
    where match_id = p_match_id and user_id = v_uid;
  elsif v_source = 'wave' then
    if p_amount < 1 or p_amount > v_self.wave then
      raise exception 'Invalid completed wave';
    end if;
    if p_amount > v_self.last_rewarded_wave then
      v_awarded := (p_amount - v_self.last_rewarded_wave) * 3;
      update public.multiplayer_players
      set obstacle_points = obstacle_points + v_awarded,
          last_rewarded_wave = p_amount,
          last_seen_at = now(),
          updated_at = now()
      where match_id = p_match_id and user_id = v_uid;
    end if;
  else
    raise exception 'Point source must be coin or wave';
  end if;

  update public.multiplayer_matches
  set last_activity_at = now()
  where id = p_match_id;

  select * into v_self
  from public.multiplayer_players
  where match_id = p_match_id and user_id = v_uid;

  return jsonb_build_object(
    'match_id', p_match_id,
    'source', case when v_source = 'melon' then 'coin' else v_source end,
    'awarded', v_awarded,
    'obstacle_points', v_self.obstacle_points,
    -- Kept for clients deployed before this migration.
    'melons_collected', v_self.melons_collected,
    'coins_collected', v_self.melons_collected
  );
end;
$$;

-- All purchasable attacks now cost either two or three obstacle points.
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
  v_target_id uuid;
  v_remaining integer;
  v_attack_id uuid;
begin
  if v_uid is null then
    raise exception 'Sign in required';
  end if;
  if v_type = 'spikes' then v_type := 'spike'; end if;
  v_cost := case v_type
    when 'barrel' then 2
    when 'log' then 2
    when 'car' then 3
    when 'snowflake' then 3
    when 'spike' then 3
    when 'rock' then 3
    else null
  end;
  if v_cost is null then
    raise exception 'Unknown obstacle type';
  end if;
  if p_cost is not null and p_cost <> v_cost then
    raise exception 'Incorrect obstacle cost';
  end if;

  select * into v_match
  from public.multiplayer_matches
  where id = p_match_id
  for update;

  if v_match.id is null or not exists (
    select 1 from public.multiplayer_players
    where match_id = p_match_id and user_id = v_uid
  ) then
    raise exception '1v1 match not found';
  end if;
  if v_match.status <> 'intermission'
     or v_match.intermission_ends_at is null
     or v_match.intermission_ends_at <= now() then
    raise exception 'Attacks can only be bought during the 15-second intermission';
  end if;

  select user_id into v_target_id
  from public.multiplayer_players
  where match_id = p_match_id and user_id <> v_uid
  limit 1;

  update public.multiplayer_players
  set obstacle_points = obstacle_points - v_cost,
      last_seen_at = now(),
      updated_at = now()
  where match_id = p_match_id
    and user_id = v_uid
    and status in ('playing', 'intermission')
    and obstacle_points >= v_cost
  returning obstacle_points into v_remaining;

  if v_remaining is null then
    raise exception 'Not enough obstacle points';
  end if;

  insert into public.multiplayer_attacks(
    match_id, sender_user_id, target_user_id,
    obstacle_type, point_cost, spawn_wave
  ) values (
    p_match_id, v_uid, v_target_id,
    v_type, v_cost, v_match.current_wave
  ) returning id into v_attack_id;

  update public.multiplayer_matches
  set last_activity_at = now()
  where id = p_match_id;

  return jsonb_build_object(
    'id', v_attack_id,
    'match_id', p_match_id,
    'target_user_id', v_target_id,
    'obstacle_type', v_type,
    'point_cost', v_cost,
    'spawn_wave', v_match.current_wave,
    'remaining_points', v_remaining
  );
end;
$$;

-- PostgreSQL does not allow CREATE OR REPLACE to rename input arguments. Drop
-- the old text/text signature and recreate it with the names sent by clients.
drop function if exists public.set_loadout(text, text);

create function public.set_loadout(p_slot text, p_item text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_slot text := lower(trim(p_slot));
  v_item text := trim(p_item);
begin
  if v_uid is null then
    raise exception 'Sign in required';
  end if;
  if v_slot not in ('class', 'player', 'obstacle', 'environment') then
    raise exception 'Invalid loadout slot';
  end if;
  if v_item is null or v_item = '' then
    raise exception 'Invalid loadout item';
  end if;

  -- Runner is the only built-in item. Every extracted class or cosmetic must
  -- belong to the signed-in account and match the requested slot.
  if not (v_slot = 'class' and v_item = 'runner')
     and not exists (
       select 1
       from public.player_unlocks u
       where u.user_id = v_uid
         and u.item_key = v_item
         and u.item_type = v_slot
     ) then
    raise exception 'Item is not unlocked for this slot';
  end if;

  insert into public.player_loadouts(user_id)
  values (v_uid)
  on conflict (user_id) do nothing;

  update public.player_loadouts
  set class_key = case when v_slot = 'class' then v_item else class_key end,
      player_cosmetic = case when v_slot = 'player' then v_item else player_cosmetic end,
      obstacle_cosmetic = case when v_slot = 'obstacle' then v_item else obstacle_cosmetic end,
      environment_cosmetic = case when v_slot = 'environment' then v_item else environment_cosmetic end,
      updated_at = now()
  where user_id = v_uid;
end;
$$;

revoke all on function public.update_1v1_state(uuid, numeric, integer, bigint, text) from public, anon;
revoke all on function public.award_1v1_points(uuid, text, integer) from public, anon;
revoke all on function public.send_1v1_attack(uuid, text, integer) from public, anon;
revoke all on function public.set_loadout(text, text) from public, anon;

grant execute on function public.update_1v1_state(uuid, numeric, integer, bigint, text) to authenticated;
grant execute on function public.award_1v1_points(uuid, text, integer) to authenticated;
grant execute on function public.send_1v1_attack(uuid, text, integer) to authenticated;
grant execute on function public.set_loadout(text, text) to authenticated;

notify pgrst, 'reload schema';
