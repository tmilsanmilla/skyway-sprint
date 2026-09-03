-- Multi-device 04 Ten-second Intermission
-- Shortens each online 1v1 wave intermission from 15 seconds to 10 seconds.

begin;

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
    raise exception 'The 10-second intermission is still active';
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
          else now() + interval '10 seconds'
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
    raise exception 'Attacks can only be bought during the 10-second intermission';
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

revoke all on function public.update_1v1_state(uuid, numeric, integer, bigint, text) from public, anon;
revoke all on function public.send_1v1_attack(uuid, text, integer) from public, anon;
grant execute on function public.update_1v1_state(uuid, numeric, integer, bigint, text) to authenticated;
grant execute on function public.send_1v1_attack(uuid, text, integer) to authenticated;

notify pgrst, 'reload schema';

commit;
