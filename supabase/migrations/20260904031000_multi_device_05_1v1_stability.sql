-- Multi-device 05 — 1v1 stability, character HP snapshots, and coin receipts
-- This is the canonical live 1v1 repair. It accepts every real half-heart
-- value used by the game, prevents stale score/phase writes from wedging a
-- match, waits for both players before starting intermission, and makes the
-- new four-argument coin RPC idempotent.

begin;

alter table public.multiplayer_players
  add column if not exists character_key text,
  add column if not exists character_class text,
  add column if not exists max_hearts numeric(4,1);

-- Snapshot each current player's server-owned equipped character. Existing
-- active matches are repaired before the new NOT NULL constraints are added.
update public.multiplayer_players player
set character_key=coalesce(loadout.character_key,'runner_ace')
from public.player_loadouts loadout
where loadout.user_id=player.user_id
  and player.character_key is null;

update public.multiplayer_players player
set character_class=catalog.character_class
from public.extraction_catalog catalog
where player.character_class is null
  and catalog.item_key=player.character_key
  and catalog.item_type='character';

update public.multiplayer_players player
set character_class=coalesce(loadout.class_key,'runner')
from public.player_loadouts loadout
where loadout.user_id=player.user_id and player.character_class is null;

update public.multiplayer_players
set character_key=coalesce(character_key,'runner_ace'),
    character_class=coalesce(character_class,'runner')
where character_key is null or character_class is null;

update public.multiplayer_players
set max_hearts=case
      when character_key in ('medic_oracle','tank_atlas') then 6
      when character_key in ('medic_seraph','medic_beacon','tank_colossus') then 5.5
      when character_key='tank_guard' then 4.5
      when character_key='tank_hammer' or character_class='medic' then 5
      when character_class='tank' then 4
      when character_class='trickster' then 2
      else 3
    end
where max_hearts is null;

alter table public.multiplayer_players
  drop constraint if exists multiplayer_players_hearts_check,
  drop constraint if exists multiplayer_players_max_hearts_check,
  drop constraint if exists multiplayer_players_hearts_within_character_max_check,
  drop constraint if exists multiplayer_players_character_class_check;

update public.multiplayer_players
set hearts=round(least(6,greatest(0,hearts),max_hearts)*2)/2;

alter table public.multiplayer_players
  alter column character_key set default 'runner_ace',
  alter column character_key set not null,
  alter column character_class set default 'runner',
  alter column character_class set not null,
  alter column max_hearts set default 3,
  alter column max_hearts set not null,
  add constraint multiplayer_players_character_class_check
    check(character_class in ('runner','medic','tank','trickster','misc')) not valid,
  add constraint multiplayer_players_max_hearts_check
    check(max_hearts between 1 and 6 and mod(max_hearts,0.5)=0) not valid,
  add constraint multiplayer_players_hearts_check
    check(hearts between 0 and 6 and mod(hearts,0.5)=0) not valid,
  add constraint multiplayer_players_hearts_within_character_max_check
    check(hearts<=max_hearts) not valid;

alter table public.multiplayer_players
  validate constraint multiplayer_players_character_class_check;
alter table public.multiplayer_players
  validate constraint multiplayer_players_max_hearts_check;
alter table public.multiplayer_players
  validate constraint multiplayer_players_hearts_check;
alter table public.multiplayer_players
  validate constraint multiplayer_players_hearts_within_character_max_check;

create table if not exists public.multiplayer_point_events(
  match_id uuid not null,
  user_id uuid not null,
  pickup_id text not null,
  source text not null check(source in ('coin')),
  points_awarded integer not null check(points_awarded=2),
  created_at timestamptz not null default now(),
  primary key(match_id,user_id,pickup_id),
  foreign key(match_id,user_id)
    references public.multiplayer_players(match_id,user_id) on delete cascade,
  check(length(pickup_id) between 1 and 160)
);
create index if not exists multiplayer_point_events_created_at_idx
  on public.multiplayer_point_events(created_at);
alter table public.multiplayer_point_events enable row level security;
revoke all on table public.multiplayer_point_events
  from public,anon,authenticated;

comment on table public.multiplayer_point_events is
  'Private idempotency receipts for 1v1 track-coin pickups.';
comment on column public.multiplayer_players.max_hearts is
  'Server-owned maximum HP snapshotted from the equipped character when matchmaking creates the player row.';

create or replace function public.get_1v1_state(p_match_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();
  v_match public.multiplayer_matches;
  v_self public.multiplayer_players;
  v_opponent public.multiplayer_players;
  v_attacks jsonb;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;

  select * into v_match from public.multiplayer_matches where id=p_match_id;
  select * into v_self from public.multiplayer_players
  where match_id=p_match_id and user_id=v_uid;
  if v_match.id is null or v_self.user_id is null then
    raise exception '1v1 match not found';
  end if;
  select * into v_opponent from public.multiplayer_players
  where match_id=p_match_id and user_id<>v_uid limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',attack.id,'obstacle_type',attack.obstacle_type,
    'point_cost',attack.point_cost,'spawn_wave',attack.spawn_wave,
    'created_at',attack.created_at
  ) order by attack.created_at),'[]'::jsonb)
  into v_attacks
  from public.multiplayer_attacks attack
  where attack.match_id=p_match_id and attack.target_user_id=v_uid
    and attack.delivered_at is null;

  return jsonb_build_object(
    'match',jsonb_build_object(
      'id',v_match.id,'status',v_match.status,
      'current_wave',v_match.current_wave,
      'intermission_ends_at',v_match.intermission_ends_at,
      'winner_user_id',v_match.winner_user_id,
      'started_at',v_match.started_at,'finished_at',v_match.finished_at
    ),
    'self',jsonb_build_object(
      'user_id',v_self.user_id,'username',v_self.username,
      'character_key',v_self.character_key,
      'character_class',v_self.character_class,'max_hearts',v_self.max_hearts,
      'hearts',v_self.hearts,'wave',v_self.wave,'score',v_self.score,
      'obstacle_points',v_self.obstacle_points,
      'melons_collected',v_self.melons_collected,
      'coins_collected',v_self.melons_collected,'status',v_self.status
    ),
    'opponent',jsonb_build_object(
      'user_id',v_opponent.user_id,'username',v_opponent.username,
      'character_key',v_opponent.character_key,
      'character_class',v_opponent.character_class,
      'max_hearts',v_opponent.max_hearts,'hearts',v_opponent.hearts,
      'wave',v_opponent.wave,'score',v_opponent.score,
      'obstacle_points',v_opponent.obstacle_points,'status',v_opponent.status
    ),
    'pending_attacks',v_attacks
  );
end;
$$;

-- Matchmaking now records each equipped kit and its legal HP ceiling. Starting
-- HP remains category-based: tanks 4, tricksters 2, and every other class 3.
create or replace function public.join_1v1_queue()
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();
  v_username text;
  v_opponent_id uuid;
  v_opponent_username text;
  v_match_id uuid;
  v_status text;
  v_character_key text;
  v_character_class text;
  v_max_hearts numeric(4,1);
  v_starting_hearts numeric(4,1);
  v_opponent_character_key text;
  v_opponent_character_class text;
  v_opponent_max_hearts numeric(4,1);
  v_opponent_starting_hearts numeric(4,1);
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  select username into v_username from public.player_profiles where user_id=v_uid;
  if v_username is null then
    raise exception 'Choose a username before entering 1v1';
  end if;

  perform pg_advisory_xact_lock(917240115);
  delete from public.multiplayer_queue
  where queued_at<now()-interval '2 minutes';

  select player.match_id,match.status into v_match_id,v_status
  from public.multiplayer_players player
  join public.multiplayer_matches match on match.id=player.match_id
  where player.user_id=v_uid
    and match.status in ('countdown','playing','intermission')
  order by match.created_at desc limit 1;
  if v_match_id is not null then
    select username into v_opponent_username
    from public.multiplayer_players
    where match_id=v_match_id and user_id<>v_uid limit 1;
    return jsonb_build_object('match_id',v_match_id,'status',v_status,
      'opponent_username',v_opponent_username);
  end if;

  select queue.user_id,profile.username
  into v_opponent_id,v_opponent_username
  from public.multiplayer_queue queue
  join public.player_profiles profile on profile.user_id=queue.user_id
  where queue.user_id<>v_uid and not exists(
    select 1 from public.multiplayer_players player
    join public.multiplayer_matches match on match.id=player.match_id
    where player.user_id=queue.user_id
      and match.status in ('countdown','playing','intermission')
  )
  order by queue.queued_at limit 1 for update of queue skip locked;

  if v_opponent_id is null then
    insert into public.multiplayer_queue(user_id,queued_at)
    values(v_uid,now()) on conflict(user_id) do nothing;
    return jsonb_build_object('match_id',null,'status','waiting',
      'opponent_username',null);
  end if;

  select coalesce(loadout.character_key,'runner_ace'),
         coalesce(catalog.character_class,loadout.class_key,'runner')
  into v_character_key,v_character_class
  from public.player_loadouts loadout
  left join public.extraction_catalog catalog
    on catalog.item_key=loadout.character_key and catalog.item_type='character'
  where loadout.user_id=v_uid;
  v_character_key:=coalesce(v_character_key,'runner_ace');
  v_character_class:=coalesce(v_character_class,'runner');

  select coalesce(loadout.character_key,'runner_ace'),
         coalesce(catalog.character_class,loadout.class_key,'runner')
  into v_opponent_character_key,v_opponent_character_class
  from public.player_loadouts loadout
  left join public.extraction_catalog catalog
    on catalog.item_key=loadout.character_key and catalog.item_type='character'
  where loadout.user_id=v_opponent_id;
  v_opponent_character_key:=coalesce(v_opponent_character_key,'runner_ace');
  v_opponent_character_class:=coalesce(v_opponent_character_class,'runner');

  v_max_hearts:=case
    when v_character_key in ('medic_oracle','tank_atlas') then 6
    when v_character_key in ('medic_seraph','medic_beacon','tank_colossus') then 5.5
    when v_character_key='tank_guard' then 4.5
    when v_character_key='tank_hammer' or v_character_class='medic' then 5
    when v_character_class='tank' then 4
    when v_character_class='trickster' then 2 else 3 end;
  v_starting_hearts:=case when v_character_class='tank' then 4
    when v_character_class='trickster' then 2 else 3 end;
  v_opponent_max_hearts:=case
    when v_opponent_character_key in ('medic_oracle','tank_atlas') then 6
    when v_opponent_character_key in
      ('medic_seraph','medic_beacon','tank_colossus') then 5.5
    when v_opponent_character_key='tank_guard' then 4.5
    when v_opponent_character_key='tank_hammer'
      or v_opponent_character_class='medic' then 5
    when v_opponent_character_class='tank' then 4
    when v_opponent_character_class='trickster' then 2 else 3 end;
  v_opponent_starting_hearts:=case
    when v_opponent_character_class='tank' then 4
    when v_opponent_character_class='trickster' then 2 else 3 end;

  insert into public.multiplayer_matches(host_user_id,guest_user_id)
  values(v_opponent_id,v_uid) returning id into v_match_id;
  insert into public.multiplayer_players(
    match_id,user_id,slot,username,character_key,character_class,max_hearts,hearts
  ) values
    (v_match_id,v_opponent_id,1,v_opponent_username,
     v_opponent_character_key,v_opponent_character_class,
     v_opponent_max_hearts,v_opponent_starting_hearts),
    (v_match_id,v_uid,2,v_username,v_character_key,v_character_class,
     v_max_hearts,v_starting_hearts);
  delete from public.multiplayer_queue where user_id in (v_uid,v_opponent_id);
  return jsonb_build_object('match_id',v_match_id,'status','countdown',
    'opponent_username',v_opponent_username);
end;
$$;

create or replace function public.update_1v1_state(
  p_match_id uuid,p_hearts numeric,p_wave integer,p_score bigint,
  p_status text default 'playing'
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();
  v_match public.multiplayer_matches;
  v_self public.multiplayer_players;
  v_opponent_id uuid;
  v_completed_wave integer;
  v_wave_reward integer:=0;
  v_ready_players integer:=0;
  v_ready_min_wave integer;
  v_ready_max_wave integer;
  v_now timestamptz:=clock_timestamp();
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  if p_wave is null or p_wave<1 or p_score is null or p_score<0 then
    raise exception 'Invalid 1v1 state';
  end if;
  if p_status not in ('playing','intermission','eliminated') then
    raise exception 'Invalid player status';
  end if;

  select * into v_match from public.multiplayer_matches
  where id=p_match_id for update;
  select * into v_self from public.multiplayer_players
  where match_id=p_match_id and user_id=v_uid for update;
  if v_match.id is null or v_self.user_id is null then
    raise exception '1v1 match not found';
  end if;
  if p_hearts is null or p_hearts<0 or p_hearts>v_self.max_hearts
     or mod(p_hearts,0.5)<>0 then
    raise exception 'Hearts must be between 0 and % in half-heart steps',
      v_self.max_hearts;
  end if;

  if v_match.status not in ('countdown','playing','intermission') then
    return public.get_1v1_state(p_match_id);
  end if;
  if p_wave>v_self.wave+1 then
    raise exception 'Wave can only advance one at a time';
  end if;

  -- A narrow score heartbeat may have arrived first. Older snapshots still
  -- refresh presence, but can never lower score, health, wave, or phase.
  if p_wave<v_self.wave then
    update public.multiplayer_players
    set score=greatest(score,p_score),last_seen_at=v_now,updated_at=v_now
    where match_id=p_match_id and user_id=v_uid;
    update public.multiplayer_matches set last_activity_at=v_now
    where id=p_match_id;
    return public.get_1v1_state(p_match_id);
  end if;

  -- A completion packet must move into the next wave. Once that wave has
  -- begun, a delayed duplicate cannot reopen its intermission.
  if p_status='intermission' and p_wave<=v_match.current_wave then
    update public.multiplayer_players
    set score=greatest(score,p_score),last_seen_at=v_now,updated_at=v_now
    where match_id=p_match_id and user_id=v_uid;
    return public.get_1v1_state(p_match_id);
  end if;

  -- During the global countdown, a late playing heartbeat is harmless. When
  -- only this player is waiting at the barrier, it also cannot cancel their
  -- ready state while the opponent finishes the wave.
  if p_status='playing' and (
       (v_match.status='intermission' and v_match.intermission_ends_at>v_now)
       or (v_match.status='playing' and v_self.status='intermission')
     ) then
    update public.multiplayer_players
    set score=greatest(score,p_score),last_seen_at=v_now,updated_at=v_now
    where match_id=p_match_id and user_id=v_uid;
    return public.get_1v1_state(p_match_id);
  end if;

  v_completed_wave:=greatest(0,p_wave-1);
  if v_completed_wave>v_self.last_rewarded_wave then
    v_wave_reward:=(v_completed_wave-v_self.last_rewarded_wave)*3;
  end if;

  update public.multiplayer_players
  set hearts=p_hearts,wave=greatest(wave,p_wave),
      score=greatest(score,p_score),
      obstacle_points=obstacle_points+v_wave_reward,
      last_rewarded_wave=greatest(last_rewarded_wave,v_completed_wave),
      status=case when p_hearts=0 or p_status='eliminated'
        then 'eliminated' else p_status end,
      last_seen_at=v_now,updated_at=v_now
  where match_id=p_match_id and user_id=v_uid;

  -- Reaching the next intermission proves that every paid hazard from an
  -- earlier wave was consumed. Preserve current-wave attacks for reconnect
  -- recovery, but never respawn an old attack if the client closes before its
  -- explicit acknowledgement reaches the server.
  if p_status='intermission' then
    update public.multiplayer_attacks
    set delivered_at=v_now
    where match_id=p_match_id
      and target_user_id=v_uid
      and delivered_at is null
      and spawn_wave<p_wave;
  end if;

  if p_hearts=0 or p_status='eliminated' then
    select user_id into v_opponent_id from public.multiplayer_players
    where match_id=p_match_id and user_id<>v_uid limit 1;
    update public.multiplayer_players
    set status=case when user_id=v_uid then 'eliminated' else 'finished' end,
        updated_at=v_now where match_id=p_match_id;
    update public.multiplayer_matches
    set status='finished',winner_user_id=v_opponent_id,finished_at=v_now,
        last_activity_at=v_now,intermission_ends_at=null
    where id=p_match_id;
  elsif p_status='intermission' then
    select count(*) filter(where status='intermission'),min(wave),max(wave)
    into v_ready_players,v_ready_min_wave,v_ready_max_wave
    from public.multiplayer_players where match_id=p_match_id;
    if v_ready_players=2 and v_ready_min_wave=v_ready_max_wave then
      update public.multiplayer_matches
      set status='intermission',current_wave=v_ready_max_wave,
          intermission_ends_at=case
            when status='intermission' and intermission_ends_at>v_now
              then intermission_ends_at
            else v_now+interval '10 seconds' end,
          last_activity_at=v_now
      where id=p_match_id;
    else
      update public.multiplayer_matches set last_activity_at=v_now
      where id=p_match_id;
    end if;
  elsif p_status='playing' then
    if v_match.status='intermission' then
      update public.multiplayer_players
      set status='playing',updated_at=v_now
      where match_id=p_match_id and status='intermission';
      update public.multiplayer_matches
      set status='playing',intermission_ends_at=null,last_activity_at=v_now
      where id=p_match_id;
    elsif v_match.status='countdown' then
      update public.multiplayer_matches
      set status='playing',last_activity_at=v_now
      where id=p_match_id;
    else
      update public.multiplayer_matches set last_activity_at=v_now
      where id=p_match_id;
    end if;
  end if;
  return public.get_1v1_state(p_match_id);
end;
$$;

-- New clients send one stable pickup id per spawned track coin. Replaying the
-- same RPC returns the authoritative balance without awarding points twice.
create or replace function public.award_1v1_points(
  p_match_id uuid,p_source text,p_amount integer,p_pickup_id text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();
  v_source text:=lower(trim(p_source));
  v_pickup_id text:=trim(p_pickup_id);
  v_match_status text;
  v_self public.multiplayer_players;
  v_inserted_id text;
  v_awarded integer:=0;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  if v_source not in ('coin','melon') or p_amount<>1 then
    raise exception 'Coins must be awarded one pickup at a time';
  end if;
  if v_pickup_id is null or length(v_pickup_id) not between 1 and 160 then
    raise exception 'A valid coin pickup id is required';
  end if;

  select status into v_match_status from public.multiplayer_matches
  where id=p_match_id for update;
  select * into v_self from public.multiplayer_players
  where match_id=p_match_id and user_id=v_uid for update;
  if v_self.user_id is null then
    raise exception '1v1 match not found';
  end if;

  -- A retry can arrive after the match moved into intermission or finished.
  -- Return the committed receipt and authoritative balance before applying the
  -- active-play rule that is required only for a brand-new pickup.
  if exists(
    select 1 from public.multiplayer_point_events event
    where event.match_id=p_match_id and event.user_id=v_uid
      and event.pickup_id=v_pickup_id
  ) then
    return jsonb_build_object(
      'match_id',p_match_id,'source','coin','pickup_id',v_pickup_id,
      'duplicate',true,'awarded',0,
      'obstacle_points',v_self.obstacle_points,
      'melons_collected',v_self.melons_collected,
      'coins_collected',v_self.melons_collected
    );
  end if;

  if v_match_status<>'playing' or v_self.status<>'playing' then
    raise exception 'Coins can only be collected during active 1v1 play';
  end if;

  insert into public.multiplayer_point_events(
    match_id,user_id,pickup_id,source,points_awarded
  ) values(p_match_id,v_uid,v_pickup_id,'coin',2)
  on conflict(match_id,user_id,pickup_id) do nothing
  returning pickup_id into v_inserted_id;
  if v_inserted_id is not null then
    v_awarded:=2;
    update public.multiplayer_players
    set obstacle_points=obstacle_points+2,
        melons_collected=melons_collected+1,last_melon_at=now(),
        last_seen_at=now(),updated_at=now()
    where match_id=p_match_id and user_id=v_uid;
    update public.multiplayer_matches set last_activity_at=now()
    where id=p_match_id;
  end if;

  select * into v_self from public.multiplayer_players
  where match_id=p_match_id and user_id=v_uid;
  return jsonb_build_object(
    'match_id',p_match_id,'source','coin','pickup_id',v_pickup_id,
    'duplicate',v_inserted_id is null,'awarded',v_awarded,
    'obstacle_points',v_self.obstacle_points,
    'melons_collected',v_self.melons_collected,
    'coins_collected',v_self.melons_collected
  );
end;
$$;

-- Keep current attack prices and the ten-second buying window in this same
-- canonical repair so rerunning it cannot restore older 1v1 rules.
create or replace function public.send_1v1_attack(
  p_match_id uuid,
  p_obstacle_type text,
  p_cost integer default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();
  v_type text:=lower(trim(p_obstacle_type));
  v_cost integer;
  v_match public.multiplayer_matches;
  v_target_id uuid;
  v_remaining integer;
  v_attack_id uuid;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  if v_type='spikes' then v_type:='spike'; end if;
  v_cost:=case v_type
    when 'barrel' then 2 when 'log' then 2 when 'car' then 3
    when 'snowflake' then 3 when 'spike' then 3 when 'rock' then 3
    else null end;
  if v_cost is null then raise exception 'Unknown obstacle type'; end if;
  if p_cost is not null and p_cost<>v_cost then
    raise exception 'Incorrect obstacle cost';
  end if;

  select * into v_match from public.multiplayer_matches
  where id=p_match_id for update;
  if v_match.id is null or not exists(
    select 1 from public.multiplayer_players
    where match_id=p_match_id and user_id=v_uid
  ) then raise exception '1v1 match not found'; end if;
  if v_match.status<>'intermission'
     or v_match.intermission_ends_at is null
     or v_match.intermission_ends_at<=now() then
    raise exception 'Attacks can only be bought during the 10-second intermission';
  end if;

  select user_id into v_target_id from public.multiplayer_players
  where match_id=p_match_id and user_id<>v_uid limit 1;
  update public.multiplayer_players
  set obstacle_points=obstacle_points-v_cost,last_seen_at=now(),updated_at=now()
  where match_id=p_match_id and user_id=v_uid
    and status='intermission' and obstacle_points>=v_cost
  returning obstacle_points into v_remaining;
  if v_remaining is null then raise exception 'Not enough obstacle points'; end if;

  insert into public.multiplayer_attacks(
    match_id,sender_user_id,target_user_id,obstacle_type,point_cost,spawn_wave
  ) values(
    p_match_id,v_uid,v_target_id,v_type,v_cost,v_match.current_wave
  ) returning id into v_attack_id;
  update public.multiplayer_matches set last_activity_at=now()
  where id=p_match_id;
  return jsonb_build_object(
    'id',v_attack_id,'match_id',p_match_id,'target_user_id',v_target_id,
    'obstacle_type',v_type,'point_cost',v_cost,
    'spawn_wave',v_match.current_wave,'remaining_points',v_remaining
  );
end;
$$;

-- Compatibility RPC for an already-open client. It no longer throws away a
-- legitimate close pickup with the old 100ms heuristic. New clients use the
-- four-argument receipt-backed RPC above.
create or replace function public.award_1v1_points(
  p_match_id uuid,p_source text,p_amount integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();
  v_source text:=lower(trim(p_source));
  v_match_status text;
  v_self public.multiplayer_players;
  v_awarded integer:=0;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  select status into v_match_status from public.multiplayer_matches
  where id=p_match_id for update;
  select * into v_self from public.multiplayer_players
  where match_id=p_match_id and user_id=v_uid for update;
  if v_self.user_id is null then raise exception '1v1 match not found'; end if;

  if v_source in ('coin','melon') then
    if p_amount<>1 then
      raise exception 'Coins must be awarded one pickup at a time';
    end if;
    if v_match_status<>'playing' or v_self.status<>'playing' then
      raise exception 'Coins can only be collected during active 1v1 play';
    end if;
    v_awarded:=2;
    update public.multiplayer_players
    set obstacle_points=obstacle_points+2,
        melons_collected=melons_collected+1,last_melon_at=now(),
        last_seen_at=now(),updated_at=now()
    where match_id=p_match_id and user_id=v_uid;
  elsif v_source='wave' then
    if v_match_status not in ('playing','intermission')
       or p_amount<1 or p_amount>v_self.wave then
      raise exception 'Invalid completed wave';
    end if;
    if p_amount>v_self.last_rewarded_wave then
      v_awarded:=(p_amount-v_self.last_rewarded_wave)*3;
      update public.multiplayer_players
      set obstacle_points=obstacle_points+v_awarded,
          last_rewarded_wave=p_amount,last_seen_at=now(),updated_at=now()
      where match_id=p_match_id and user_id=v_uid;
    end if;
  else
    raise exception 'Point source must be coin or wave';
  end if;
  update public.multiplayer_matches set last_activity_at=now()
  where id=p_match_id;
  select * into v_self from public.multiplayer_players
  where match_id=p_match_id and user_id=v_uid;
  return jsonb_build_object(
    'match_id',p_match_id,
    'source',case when v_source='melon' then 'coin' else v_source end,
    'awarded',v_awarded,'obstacle_points',v_self.obstacle_points,
    'melons_collected',v_self.melons_collected,
    'coins_collected',v_self.melons_collected
  );
end;
$$;

revoke all on function public.get_1v1_state(uuid)
  from public,anon,authenticated;
revoke all on function public.join_1v1_queue()
  from public,anon,authenticated;
revoke all on function public.update_1v1_state(uuid,numeric,integer,bigint,text)
  from public,anon,authenticated;
revoke all on function public.award_1v1_points(uuid,text,integer,text)
  from public,anon,authenticated;
revoke all on function public.award_1v1_points(uuid,text,integer)
  from public,anon,authenticated;
revoke all on function public.send_1v1_attack(uuid,text,integer)
  from public,anon,authenticated;
grant execute on function public.get_1v1_state(uuid) to authenticated;
grant execute on function public.join_1v1_queue() to authenticated;
grant execute on function public.update_1v1_state(uuid,numeric,integer,bigint,text)
  to authenticated;
grant execute on function public.award_1v1_points(uuid,text,integer,text)
  to authenticated;
grant execute on function public.award_1v1_points(uuid,text,integer)
  to authenticated;
grant execute on function public.send_1v1_attack(uuid,text,integer)
  to authenticated;

notify pgrst,'reload schema';
commit;

select
  (select pg_get_constraintdef(oid)
   from pg_constraint
   where conrelid='public.multiplayer_players'::regclass
     and conname='multiplayer_players_hearts_check') as hearts_constraint,
  to_regprocedure('public.award_1v1_points(uuid,text,integer,text)') is not null
    as idempotent_coin_rpc_installed,
  has_function_privilege(
    'authenticated','public.award_1v1_points(uuid,text,integer,text)','EXECUTE'
  ) and not has_function_privilege(
    'anon','public.award_1v1_points(uuid,text,integer,text)','EXECUTE'
  ) as coin_rpc_permissions_secure;
