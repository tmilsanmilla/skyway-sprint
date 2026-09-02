-- Multi-device 01 1v1s
-- Dedicated, account-based 1v1 matchmaking and Realtime match state.

create table if not exists public.multiplayer_queue (
  user_id uuid primary key references auth.users(id) on delete cascade,
  queued_at timestamptz not null default now()
);

create table if not exists public.multiplayer_matches (
  id uuid primary key default gen_random_uuid(),
  host_user_id uuid not null references auth.users(id) on delete cascade,
  guest_user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'countdown'
    check (status in ('countdown', 'playing', 'intermission', 'finished', 'cancelled')),
  current_wave integer not null default 1 check (current_wave >= 1),
  intermission_ends_at timestamptz,
  winner_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  last_activity_at timestamptz not null default now(),
  constraint multiplayer_matches_two_players check (host_user_id <> guest_user_id)
);

create table if not exists public.multiplayer_players (
  match_id uuid not null references public.multiplayer_matches(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  slot smallint not null check (slot in (1, 2)),
  username text not null,
  hearts numeric(4,1) not null default 3 check (hearts >= 0 and hearts <= 5),
  wave integer not null default 1 check (wave >= 1),
  score bigint not null default 0 check (score >= 0),
  obstacle_points integer not null default 0 check (obstacle_points >= 0),
  melons_collected integer not null default 0 check (melons_collected >= 0),
  last_rewarded_wave integer not null default 0 check (last_rewarded_wave >= 0),
  status text not null default 'playing'
    check (status in ('playing', 'intermission', 'eliminated', 'left', 'finished')),
  last_melon_at timestamptz,
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (match_id, user_id),
  unique (match_id, slot)
);

create table if not exists public.multiplayer_attacks (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.multiplayer_matches(id) on delete cascade,
  sender_user_id uuid not null references auth.users(id) on delete cascade,
  target_user_id uuid not null references auth.users(id) on delete cascade,
  obstacle_type text not null
    check (obstacle_type in ('barrel', 'log', 'car', 'snowflake', 'spike', 'rock')),
  point_cost integer not null check (point_cost between 1 and 3),
  spawn_wave integer not null check (spawn_wave >= 1),
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  constraint multiplayer_attacks_two_players check (sender_user_id <> target_user_id)
);

create index if not exists multiplayer_queue_queued_at_idx
  on public.multiplayer_queue (queued_at);
create index if not exists multiplayer_matches_status_activity_idx
  on public.multiplayer_matches (status, last_activity_at);
create index if not exists multiplayer_players_user_status_idx
  on public.multiplayer_players (user_id, status);
create index if not exists multiplayer_attacks_target_pending_idx
  on public.multiplayer_attacks (target_user_id, created_at)
  where delivered_at is null;
create index if not exists multiplayer_attacks_match_created_idx
  on public.multiplayer_attacks (match_id, created_at);

alter table public.multiplayer_queue enable row level security;
alter table public.multiplayer_matches enable row level security;
alter table public.multiplayer_players enable row level security;
alter table public.multiplayer_attacks enable row level security;

revoke all on table public.multiplayer_queue from anon, authenticated;
revoke all on table public.multiplayer_matches from anon, authenticated;
revoke all on table public.multiplayer_players from anon, authenticated;
revoke all on table public.multiplayer_attacks from anon, authenticated;

-- RLS uses this definer helper to avoid a self-referential player-table policy.
create or replace function public.is_1v1_participant(p_match_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.multiplayer_players p
    where p.match_id = p_match_id and p.user_id = auth.uid()
  );
$$;

revoke all on function public.is_1v1_participant(uuid) from public;
grant execute on function public.is_1v1_participant(uuid) to authenticated;

drop policy if exists "Participants read their 1v1 matches" on public.multiplayer_matches;
create policy "Participants read their 1v1 matches"
on public.multiplayer_matches for select to authenticated
using ((select public.is_1v1_participant(id)));

drop policy if exists "Participants read 1v1 players" on public.multiplayer_players;
create policy "Participants read 1v1 players"
on public.multiplayer_players for select to authenticated
using ((select public.is_1v1_participant(match_id)));

drop policy if exists "Participants read 1v1 attacks" on public.multiplayer_attacks;
create policy "Participants read 1v1 attacks"
on public.multiplayer_attacks for select to authenticated
using ((select public.is_1v1_participant(match_id)));

grant select on table public.multiplayer_matches to authenticated;
grant select on table public.multiplayer_players to authenticated;
grant select on table public.multiplayer_attacks to authenticated;

-- Returns the complete private state needed when a client reconnects or misses
-- a Realtime event. Email addresses and unrelated players are never returned.
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
begin
  if v_uid is null then
    raise exception 'Sign in required';
  end if;

  select * into v_match
  from public.multiplayer_matches
  where id = p_match_id;

  select * into v_self
  from public.multiplayer_players
  where match_id = p_match_id and user_id = v_uid;

  if v_match.id is null or v_self.user_id is null then
    raise exception '1v1 match not found';
  end if;

  select * into v_opponent
  from public.multiplayer_players
  where match_id = p_match_id and user_id <> v_uid
  limit 1;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', a.id,
        'obstacle_type', a.obstacle_type,
        'point_cost', a.point_cost,
        'spawn_wave', a.spawn_wave,
        'created_at', a.created_at
      ) order by a.created_at
    ),
    '[]'::jsonb
  ) into v_attacks
  from public.multiplayer_attacks a
  where a.match_id = p_match_id
    and a.target_user_id = v_uid
    and a.delivered_at is null;

  return jsonb_build_object(
    'match', jsonb_build_object(
      'id', v_match.id,
      'status', v_match.status,
      'current_wave', v_match.current_wave,
      'intermission_ends_at', v_match.intermission_ends_at,
      'winner_user_id', v_match.winner_user_id,
      'started_at', v_match.started_at,
      'finished_at', v_match.finished_at
    ),
    'self', jsonb_build_object(
      'user_id', v_self.user_id,
      'username', v_self.username,
      'hearts', v_self.hearts,
      'wave', v_self.wave,
      'score', v_self.score,
      'obstacle_points', v_self.obstacle_points,
      'melons_collected', v_self.melons_collected,
      'status', v_self.status
    ),
    'opponent', jsonb_build_object(
      'user_id', v_opponent.user_id,
      'username', v_opponent.username,
      'hearts', v_opponent.hearts,
      'wave', v_opponent.wave,
      'score', v_opponent.score,
      'obstacle_points', v_opponent.obstacle_points,
      'status', v_opponent.status
    ),
    'pending_attacks', v_attacks
  );
end;
$$;

-- Serialized matchmaking prevents a player from being claimed by two devices.
create or replace function public.join_1v1_queue()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_username text;
  v_opponent_id uuid;
  v_opponent_username text;
  v_match_id uuid;
  v_status text;
begin
  if v_uid is null then
    raise exception 'Sign in required';
  end if;

  select username into v_username
  from public.player_profiles
  where user_id = v_uid;
  if v_username is null then
    raise exception 'Choose a username before entering 1v1';
  end if;

  perform pg_advisory_xact_lock(917240115);

  delete from public.multiplayer_queue
  where queued_at < now() - interval '2 minutes';

  select p.match_id, m.status into v_match_id, v_status
  from public.multiplayer_players p
  join public.multiplayer_matches m on m.id = p.match_id
  where p.user_id = v_uid
    and m.status in ('countdown', 'playing', 'intermission')
  order by m.created_at desc
  limit 1;

  if v_match_id is not null then
    select username into v_opponent_username
    from public.multiplayer_players
    where match_id = v_match_id and user_id <> v_uid
    limit 1;
    return jsonb_build_object(
      'match_id', v_match_id,
      'status', v_status,
      'opponent_username', v_opponent_username
    );
  end if;

  select q.user_id, p.username into v_opponent_id, v_opponent_username
  from public.multiplayer_queue q
  join public.player_profiles p on p.user_id = q.user_id
  where q.user_id <> v_uid
    and not exists (
      select 1
      from public.multiplayer_players mp
      join public.multiplayer_matches mm on mm.id = mp.match_id
      where mp.user_id = q.user_id
        and mm.status in ('countdown', 'playing', 'intermission')
    )
  order by q.queued_at
  limit 1
  for update of q skip locked;

  if v_opponent_id is null then
    insert into public.multiplayer_queue(user_id, queued_at)
    values (v_uid, now())
    on conflict (user_id) do nothing;
    return jsonb_build_object(
      'match_id', null,
      'status', 'waiting',
      'opponent_username', null
    );
  end if;

  insert into public.multiplayer_matches(host_user_id, guest_user_id)
  values (v_opponent_id, v_uid)
  returning id into v_match_id;

  insert into public.multiplayer_players(match_id, user_id, slot, username)
  values
    (v_match_id, v_opponent_id, 1, v_opponent_username),
    (v_match_id, v_uid, 2, v_username);

  delete from public.multiplayer_queue
  where user_id in (v_uid, v_opponent_id);

  return jsonb_build_object(
    'match_id', v_match_id,
    'status', 'countdown',
    'opponent_username', v_opponent_username
  );
end;
$$;

-- Leaving a live match is a forfeit; leaving while waiting only clears the queue.
create or replace function public.leave_1v1()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_match_id uuid;
  v_opponent_id uuid;
begin
  if v_uid is null then
    raise exception 'Sign in required';
  end if;

  delete from public.multiplayer_queue where user_id = v_uid;

  select p.match_id into v_match_id
  from public.multiplayer_players p
  join public.multiplayer_matches m on m.id = p.match_id
  where p.user_id = v_uid
    and m.status in ('countdown', 'playing', 'intermission')
  order by m.created_at desc
  limit 1
  for update of m;

  if v_match_id is null then
    return jsonb_build_object('match_id', null, 'status', 'left_queue');
  end if;

  select user_id into v_opponent_id
  from public.multiplayer_players
  where match_id = v_match_id and user_id <> v_uid
  limit 1;

  update public.multiplayer_players
  set status = case when user_id = v_uid then 'left' else 'finished' end,
      last_seen_at = case when user_id = v_uid then now() else last_seen_at end,
      updated_at = now()
  where match_id = v_match_id;

  update public.multiplayer_matches
  set status = 'finished',
      winner_user_id = v_opponent_id,
      finished_at = now(),
      last_activity_at = now(),
      intermission_ends_at = null
  where id = v_match_id;

  return jsonb_build_object(
    'match_id', v_match_id,
    'status', 'finished',
    'winner_user_id', v_opponent_id,
    'outcome', 'loss'
  );
end;
$$;

-- Heart, wave, and score snapshots are sent from each device. Values can only
-- move forward (except hearts), and advancing a wave automatically awards the
-- five obstacle points for each completed wave exactly once.
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
    v_wave_reward := (v_completed_wave - v_self.last_rewarded_wave) * 5;
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

-- A melon is worth two obstacle points. A completed wave is worth five and is
-- de-duplicated with last_rewarded_wave, including after reconnects.
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

  if lower(p_source) = 'melon' then
    if p_amount <> 1 then
      raise exception 'Melons must be awarded one pickup at a time';
    end if;
    if v_self.last_melon_at is not null
       and v_self.last_melon_at > now() - interval '100 milliseconds' then
      raise exception 'Melon pickup arrived too quickly';
    end if;
    v_awarded := 2;
    update public.multiplayer_players
    set obstacle_points = obstacle_points + v_awarded,
        melons_collected = melons_collected + 1,
        last_melon_at = now(),
        last_seen_at = now(),
        updated_at = now()
    where match_id = p_match_id and user_id = v_uid;
  elsif lower(p_source) = 'wave' then
    if p_amount < 1 or p_amount > v_self.wave then
      raise exception 'Invalid completed wave';
    end if;
    if p_amount > v_self.last_rewarded_wave then
      v_awarded := (p_amount - v_self.last_rewarded_wave) * 5;
      update public.multiplayer_players
      set obstacle_points = obstacle_points + v_awarded,
          last_rewarded_wave = p_amount,
          last_seen_at = now(),
          updated_at = now()
      where match_id = p_match_id and user_id = v_uid;
    end if;
  else
    raise exception 'Point source must be melon or wave';
  end if;

  update public.multiplayer_matches
  set last_activity_at = now()
  where id = p_match_id;

  select * into v_self
  from public.multiplayer_players
  where match_id = p_match_id and user_id = v_uid;

  return jsonb_build_object(
    'match_id', p_match_id,
    'source', lower(p_source),
    'awarded', v_awarded,
    'obstacle_points', v_self.obstacle_points,
    'melons_collected', v_self.melons_collected
  );
end;
$$;

-- Point cost is derived in the database. Supplying a mismatched client cost is
-- rejected, so a modified browser cannot buy expensive attacks for one point.
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
    when 'barrel' then 1
    when 'log' then 1
    when 'car' then 2
    when 'snowflake' then 2
    when 'spike' then 2
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

create or replace function public.acknowledge_1v1_attacks(
  p_match_id uuid,
  p_attack_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_count integer;
begin
  if v_uid is null then
    raise exception 'Sign in required';
  end if;
  if not exists (
    select 1 from public.multiplayer_players
    where match_id = p_match_id and user_id = v_uid
  ) then
    raise exception '1v1 match not found';
  end if;

  update public.multiplayer_attacks
  set delivered_at = now()
  where match_id = p_match_id
    and target_user_id = v_uid
    and id = any(coalesce(p_attack_ids, array[]::uuid[]))
    and delivered_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Calling finish while alive is a forfeit. If the opponent was already
-- eliminated, the caller is correctly recorded as the winner.
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
  v_winner_id uuid;
begin
  if v_uid is null then
    raise exception 'Sign in required';
  end if;

  select * into v_match
  from public.multiplayer_matches
  where id = p_match_id
  for update;
  select * into v_self
  from public.multiplayer_players
  where match_id = p_match_id and user_id = v_uid
  for update;
  select * into v_opponent
  from public.multiplayer_players
  where match_id = p_match_id and user_id <> v_uid
  limit 1
  for update;

  if v_match.id is null or v_self.user_id is null then
    raise exception '1v1 match not found';
  end if;
  if v_match.status in ('finished', 'cancelled') then
    return jsonb_build_object(
      'match_id', p_match_id,
      'status', v_match.status,
      'winner_user_id', v_match.winner_user_id,
      'outcome', case
        when v_match.winner_user_id = v_uid then 'win'
        when v_match.winner_user_id is null then 'draw'
        else 'loss'
      end
    );
  end if;

  v_winner_id := case
    when v_opponent.hearts <= 0 or v_opponent.status = 'eliminated' then v_uid
    else v_opponent.user_id
  end;

  update public.multiplayer_players
  set status = case
        when user_id = v_winner_id then 'finished'
        when hearts <= 0 then 'eliminated'
        else 'left'
      end,
      last_seen_at = case when user_id = v_uid then now() else last_seen_at end,
      updated_at = now()
  where match_id = p_match_id;

  update public.multiplayer_matches
  set status = 'finished',
      winner_user_id = v_winner_id,
      finished_at = now(),
      last_activity_at = now(),
      intermission_ends_at = null
  where id = p_match_id;

  return jsonb_build_object(
    'match_id', p_match_id,
    'status', 'finished',
    'winner_user_id', v_winner_id,
    'outcome', case when v_winner_id = v_uid then 'win' else 'loss' end
  );
end;
$$;

-- Safe for clients to call while searching. It clears abandoned queue entries,
-- closes inactive matches, and removes old ephemeral Realtime rows.
create or replace function public.cleanup_1v1_matches()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_queue_count integer;
  v_match_count integer;
  v_attack_count integer;
  v_history_count integer;
begin
  delete from public.multiplayer_queue
  where queued_at < now() - interval '2 minutes';
  get diagnostics v_queue_count = row_count;

  update public.multiplayer_matches m
  set status = 'cancelled',
      finished_at = now(),
      last_activity_at = now(),
      intermission_ends_at = null
  where m.status in ('countdown', 'playing', 'intermission')
    and m.last_activity_at < now() - interval '2 minutes';
  get diagnostics v_match_count = row_count;

  update public.multiplayer_players p
  set status = 'finished', updated_at = now()
  where p.match_id in (
    select id from public.multiplayer_matches
    where status = 'cancelled' and finished_at >= now() - interval '5 seconds'
  ) and p.status in ('playing', 'intermission');

  delete from public.multiplayer_attacks
  where created_at < now() - interval '24 hours';
  get diagnostics v_attack_count = row_count;

  delete from public.multiplayer_matches
  where status in ('finished', 'cancelled')
    and finished_at < now() - interval '7 days';
  get diagnostics v_history_count = row_count;

  return jsonb_build_object(
    'expired_queue_entries', v_queue_count,
    'cancelled_matches', v_match_count,
    'deleted_attacks', v_attack_count,
    'deleted_match_history', v_history_count
  );
end;
$$;

revoke all on function public.get_1v1_state(uuid) from public;
revoke all on function public.join_1v1_queue() from public;
revoke all on function public.leave_1v1() from public;
revoke all on function public.update_1v1_state(uuid, numeric, integer, bigint, text) from public;
revoke all on function public.award_1v1_points(uuid, text, integer) from public;
revoke all on function public.send_1v1_attack(uuid, text, integer) from public;
revoke all on function public.acknowledge_1v1_attacks(uuid, uuid[]) from public;
revoke all on function public.finish_1v1(uuid) from public;
revoke all on function public.cleanup_1v1_matches() from public;

grant execute on function public.get_1v1_state(uuid) to authenticated;
grant execute on function public.join_1v1_queue() to authenticated;
grant execute on function public.leave_1v1() to authenticated;
grant execute on function public.update_1v1_state(uuid, numeric, integer, bigint, text) to authenticated;
grant execute on function public.award_1v1_points(uuid, text, integer) to authenticated;
grant execute on function public.send_1v1_attack(uuid, text, integer) to authenticated;
grant execute on function public.acknowledge_1v1_attacks(uuid, uuid[]) to authenticated;
grant execute on function public.finish_1v1(uuid) to authenticated;
grant execute on function public.cleanup_1v1_matches() to authenticated;

-- Only these three match tables join Supabase Realtime. Queue data and all
-- single-player/account tables remain outside this multiplayer stream.
alter table public.multiplayer_matches replica identity full;
alter table public.multiplayer_players replica identity full;
alter table public.multiplayer_attacks replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'multiplayer_matches'
    ) then
      alter publication supabase_realtime add table public.multiplayer_matches;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'multiplayer_players'
    ) then
      alter publication supabase_realtime add table public.multiplayer_players;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'multiplayer_attacks'
    ) then
      alter publication supabase_realtime add table public.multiplayer_attacks;
    end if;
  end if;
end;
$$;
