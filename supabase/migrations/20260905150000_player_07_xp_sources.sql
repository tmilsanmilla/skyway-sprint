-- Player 07 XP Sources
-- Adds receipt-backed XP for completed waves and active playtime while keeping
-- the existing gem, coin, score, and rising per-level XP requirements.

begin;

alter table public.player_progression_runs
  add column if not exists active_seconds bigint not null default 0,
  add column if not exists verified_wave integer not null default 1,
  add column if not exists last_heartbeat_at timestamptz,
  add column if not exists heartbeat_active boolean not null default false;
alter table public.player_progression_runs
  drop constraint if exists player_progression_runs_active_seconds_check,
  drop constraint if exists player_progression_runs_verified_wave_check;
alter table public.player_progression_runs
  add constraint player_progression_runs_active_seconds_check
    check (active_seconds between 0 and 21600) not valid,
  add constraint player_progression_runs_verified_wave_check
    check (verified_wave between 1 and 100000) not valid;
alter table public.player_progression_runs
  validate constraint player_progression_runs_active_seconds_check;
alter table public.player_progression_runs
  validate constraint player_progression_runs_verified_wave_check;

create table if not exists public.player_progression_1v1_activity (
  match_id uuid not null references public.multiplayer_matches(id)
    on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  active_seconds bigint not null default 0
    check (active_seconds between 0 and 21600),
  verified_wave integer not null default 1
    check (verified_wave between 1 and 100000),
  last_heartbeat_at timestamptz,
  heartbeat_active boolean not null default false,
  primary key (match_id, user_id)
);
alter table public.player_progression_1v1_activity
  add column if not exists active_seconds bigint not null default 0,
  add column if not exists verified_wave integer not null default 1,
  add column if not exists last_heartbeat_at timestamptz,
  add column if not exists heartbeat_active boolean not null default false;
update public.player_progression_1v1_activity
set active_seconds = least(
      21600::bigint, greatest(0::bigint, coalesce(active_seconds, 0))
    ),
    verified_wave = least(
      100000, greatest(1, coalesce(verified_wave, 1))
    ),
    heartbeat_active = coalesce(heartbeat_active, false);
alter table public.player_progression_1v1_activity
  alter column active_seconds set default 0,
  alter column active_seconds set not null,
  alter column verified_wave set default 1,
  alter column verified_wave set not null,
  alter column heartbeat_active set default false,
  alter column heartbeat_active set not null;
alter table public.player_progression_1v1_activity
  drop constraint if exists player_progression_1v1_activity_active_seconds_check,
  drop constraint if exists player_progression_1v1_activity_verified_wave_check;
alter table public.player_progression_1v1_activity
  add constraint player_progression_1v1_activity_active_seconds_check
    check (active_seconds between 0 and 21600) not valid,
  add constraint player_progression_1v1_activity_verified_wave_check
    check (verified_wave between 1 and 100000) not valid;
alter table public.player_progression_1v1_activity
  validate constraint player_progression_1v1_activity_active_seconds_check;
alter table public.player_progression_1v1_activity
  validate constraint player_progression_1v1_activity_verified_wave_check;
create unique index if not exists player_progression_1v1_activity_identity_idx
  on public.player_progression_1v1_activity(match_id, user_id);
alter table public.player_progression_1v1_activity enable row level security;
revoke all on table public.player_progression_1v1_activity
  from public, anon, authenticated;

-- Every intentional start receives a fresh receipt. Any abandoned open receipt
-- is closed without XP so menu/background time cannot leak into a later run.
create or replace function public.start_progression_run()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_run_id uuid;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));
  update public.player_progression_runs
  set completed_at = now(), claimed_score = 0, credited_score = 0
  where user_id = v_uid and completed_at is null;
  insert into public.player_progression_runs(
    user_id, active_seconds, verified_wave, last_heartbeat_at,
    heartbeat_active
  ) values (v_uid, 0, 1, clock_timestamp(), false)
  returning run_id into v_run_id;
  return v_run_id;
end;
$$;

-- The browser sends only a heartbeat and its current wave. The server measures
-- time between heartbeats, caps gaps, and advances at most one plausible wave.
drop function if exists public.sync_progression_run(uuid, integer);
create or replace function public.sync_progression_run(
  p_run_id uuid,
  p_wave integer,
  p_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz;
  v_last_heartbeat timestamptz;
  v_active_seconds bigint;
  v_verified_wave integer;
  v_was_active boolean;
  v_increment bigint;
  v_max_wave integer;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  if p_run_id is null then raise exception 'Run ID is required'; end if;
  if p_wave is null or p_wave < 1 or p_wave > 100000 then
    raise exception 'Invalid run wave';
  end if;
  if p_active is null then raise exception 'Run activity state is required'; end if;
  select run.last_heartbeat_at, run.active_seconds, run.verified_wave,
         run.heartbeat_active
  into v_last_heartbeat, v_active_seconds, v_verified_wave, v_was_active
  from public.player_progression_runs run
  where run.run_id = p_run_id and run.user_id = v_uid
    and run.completed_at is null
  for update;
  if not found then raise exception 'Active run receipt not found'; end if;
  -- Read the clock only after taking the row lock so overlapping heartbeats
  -- can never move the stored timestamp backwards.
  v_now := clock_timestamp();
  v_increment := case when v_was_active then
    least(
      6::bigint,
      greatest(
        0,
        floor(extract(epoch from (v_now - coalesce(v_last_heartbeat, v_now))))
          ::bigint
      )
    )
  else 0 end;
  v_active_seconds := least(21600::bigint, v_active_seconds + v_increment);
  v_max_wave := least(
    100000,
    1 + floor(v_active_seconds::numeric / 15)::integer
  );
  v_verified_wave := least(
    greatest(v_verified_wave, p_wave),
    v_verified_wave + 1,
    v_max_wave
  );
  update public.player_progression_runs
  set active_seconds = v_active_seconds,
      verified_wave = v_verified_wave,
      last_heartbeat_at = v_now,
      heartbeat_active = p_active
  where run_id = p_run_id;
  return jsonb_build_object(
    'active_seconds', v_active_seconds,
    'verified_wave', v_verified_wave,
    'active', p_active
  );
end;
$$;

-- 1v1 playtime and waves need their own receipt because the match row is
-- shared. Only time observed while the server says the match is playing is
-- credited; countdowns, intermissions, hidden tabs, and pauses do not count.
create or replace function public.sync_1v1_progression(
  p_match_id uuid,
  p_wave integer,
  p_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_status text;
  v_player_status text;
  v_now timestamptz;
  v_last_heartbeat timestamptz;
  v_active_seconds bigint;
  v_verified_wave integer;
  v_was_active boolean;
  v_effective_active boolean;
  v_increment bigint;
  v_max_wave integer;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  if p_match_id is null then raise exception 'Match ID is required'; end if;
  if p_wave is null or p_wave < 1 or p_wave > 100000 then
    raise exception 'Invalid match wave';
  end if;
  if p_active is null then raise exception 'Match activity state is required'; end if;

  select match_row.status, player.status into v_status, v_player_status
  from public.multiplayer_matches match_row
  join public.multiplayer_players player
    on player.match_id = match_row.id and player.user_id = v_uid
  where match_row.id = p_match_id
    and match_row.status in ('countdown', 'playing', 'intermission')
    and match_row.started_at > now() - interval '6 hours'
  for update of match_row;
  if v_status is null then raise exception 'Active 1v1 membership not found'; end if;

  insert into public.player_progression_1v1_activity(match_id, user_id)
  values (p_match_id, v_uid)
  on conflict (match_id, user_id) do nothing;
  select activity.last_heartbeat_at, activity.active_seconds,
         activity.verified_wave, activity.heartbeat_active
  into v_last_heartbeat, v_active_seconds, v_verified_wave, v_was_active
  from public.player_progression_1v1_activity activity
  where activity.match_id = p_match_id and activity.user_id = v_uid
  for update;

  v_now := clock_timestamp();
  v_effective_active := p_active and v_status = 'playing'
    and v_player_status = 'playing';
  v_increment := case when v_was_active and v_status = 'playing'
    and v_player_status = 'playing' then
    least(
      6::bigint,
      greatest(
        0,
        floor(extract(epoch from (v_now - coalesce(v_last_heartbeat, v_now))))
          ::bigint
      )
    )
  else 0 end;
  v_active_seconds := least(21600::bigint, v_active_seconds + v_increment);
  v_max_wave := least(
    100000,
    1 + floor(v_active_seconds::numeric / 15)::integer
  );
  v_verified_wave := least(
    greatest(v_verified_wave, p_wave),
    v_verified_wave + 1,
    v_max_wave
  );
  update public.player_progression_1v1_activity
  set active_seconds = v_active_seconds,
      verified_wave = v_verified_wave,
      last_heartbeat_at = v_now,
      heartbeat_active = v_effective_active
  where match_id = p_match_id and user_id = v_uid;
  return jsonb_build_object(
    'active_seconds', v_active_seconds,
    'verified_wave', v_verified_wave,
    'active', v_effective_active
  );
end;
$$;

-- Capture the final short slice at the server-authoritative player phase
-- transition. Marking the receipt idle here prevents the intermission itself
-- from becoming playtime XP if the browser's false heartbeat arrives later.
create or replace function app_private.flush_1v1_progression_on_phase_exit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz;
  v_match_status text;
  v_last_heartbeat timestamptz;
  v_active_seconds bigint;
  v_verified_wave integer;
  v_heartbeat_active boolean;
  v_increment bigint := 0;
  v_max_wave integer;
begin
  if old.status is distinct from 'playing'
     or new.status is not distinct from 'playing' then
    return new;
  end if;
  select match_row.status into v_match_status
  from public.multiplayer_matches match_row
  where match_row.id = old.match_id;
  select activity.active_seconds, activity.verified_wave,
         activity.last_heartbeat_at, activity.heartbeat_active
  into v_active_seconds, v_verified_wave, v_last_heartbeat,
       v_heartbeat_active
  from public.player_progression_1v1_activity activity
  where activity.match_id = old.match_id and activity.user_id = old.user_id
  for update;
  if not found then return new; end if;
  v_now := clock_timestamp();
  if coalesce(v_heartbeat_active, false) and v_match_status = 'playing' then
    v_increment := least(
      6::bigint,
      greatest(
        0::bigint,
        floor(extract(epoch from (
          v_now - coalesce(v_last_heartbeat, v_now)
        )))::bigint
      )
    );
  end if;
  v_active_seconds := least(
    21600::bigint,
    greatest(0::bigint, coalesce(v_active_seconds, 0)) + v_increment
  );
  v_max_wave := least(
    100000,
    1 + floor(v_active_seconds::numeric / 15)::integer
  );
  v_verified_wave := least(
    greatest(coalesce(v_verified_wave, 1), coalesce(new.wave, 1)),
    coalesce(v_verified_wave, 1) + 1,
    v_max_wave
  );
  update public.player_progression_1v1_activity
  set active_seconds = v_active_seconds,
      verified_wave = v_verified_wave,
      last_heartbeat_at = v_now,
      heartbeat_active = false
  where match_id = old.match_id and user_id = old.user_id;
  return new;
end;
$$;

drop trigger if exists flush_1v1_progression_on_phase_exit
  on public.multiplayer_players;
create trigger flush_1v1_progression_on_phase_exit
before update of status on public.multiplayer_players
for each row
when (old.status = 'playing' and new.status is distinct from 'playing')
execute function app_private.flush_1v1_progression_on_phase_exit();

revoke all on function public.start_progression_run()
  from public, anon, authenticated;
revoke all on function public.sync_progression_run(uuid, integer, boolean)
  from public, anon, authenticated;
revoke all on function public.sync_1v1_progression(uuid, integer, boolean)
  from public, anon, authenticated;
revoke all on function app_private.flush_1v1_progression_on_phase_exit()
  from public, anon, authenticated;
grant execute on function public.start_progression_run() to authenticated;
grant execute on function public.sync_progression_run(uuid, integer, boolean)
  to authenticated;
grant execute on function public.sync_1v1_progression(uuid, integer, boolean)
  to authenticated;

-- Gem receipts are accepted only while a recent server-measured activity
-- heartbeat exists. User-generated pickup IDs are bounded by verified active
-- seconds and verified waves, not by the age of a browser-provided context.
create or replace function public.claim_player_gem(
  p_context_id uuid,
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
  v_context_type text;
  v_match_status text;
  v_player_status text;
  v_active_seconds bigint;
  v_verified_wave integer;
  v_last_heartbeat timestamptz;
  v_heartbeat_active boolean;
  v_time_allowance bigint;
  v_wave_allowance bigint;
  v_allowed bigint;
  v_claimed bigint;
  v_recent_claims bigint;
  v_inserted uuid;
  v_total bigint;
  v_progress jsonb;
  v_now timestamptz;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  if p_context_id is null or v_pickup_id is null
     or length(v_pickup_id) not between 1 and 120 then
    raise exception 'Valid gem context and pickup ID are required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 1));

  -- Do this before checking live state so a network retry remains idempotent
  -- even if the wave ended after the original receipt committed.
  if exists (
    select 1 from public.player_progression_events event
    where event.user_id = v_uid and event.source = 'gem'
      and event.source_key = p_context_id::text || ':' || v_pickup_id
  ) then
    select stats.total_gems into v_total from public.player_stats stats
    where stats.user_id = v_uid;
    return jsonb_build_object(
      'total_gems', coalesce(v_total, 0), 'is_new', false,
      'progression', public.get_player_progression()
    );
  end if;

  select run.active_seconds, run.verified_wave, run.last_heartbeat_at,
         run.heartbeat_active
  into v_active_seconds, v_verified_wave, v_last_heartbeat,
       v_heartbeat_active
  from public.player_progression_runs run
  where run.run_id = p_context_id and run.user_id = v_uid
    and run.completed_at is null
    and run.started_at > now() - interval '6 hours'
  for update;
  if found then
    v_now := clock_timestamp();
    v_context_type := 'endless';
    if not coalesce(v_heartbeat_active, false)
       or v_last_heartbeat is null
       or v_last_heartbeat < v_now - interval '8 seconds' then
      raise exception 'Gem collection requires active play';
    end if;
  else
    select match_row.status, player.status
    into v_match_status, v_player_status
    from public.multiplayer_matches match_row
    join public.multiplayer_players player
      on player.match_id = match_row.id and player.user_id = v_uid
    where match_row.id = p_context_id
      and match_row.started_at > now() - interval '6 hours'
    for update of match_row, player;
    if not found or v_match_status <> 'playing'
       or v_player_status <> 'playing' then
      raise exception 'Gem context is not active';
    end if;
    select activity.active_seconds, activity.verified_wave,
           activity.last_heartbeat_at, activity.heartbeat_active
    into v_active_seconds, v_verified_wave, v_last_heartbeat,
         v_heartbeat_active
    from public.player_progression_1v1_activity activity
    where activity.match_id = p_context_id and activity.user_id = v_uid
    for update;
    if not found then
      raise exception 'Gem collection requires active 1v1 play';
    end if;
    v_now := clock_timestamp();
    if not coalesce(v_heartbeat_active, false)
       or v_last_heartbeat is null
       or v_last_heartbeat < v_now - interval '8 seconds' then
      raise exception 'Gem collection requires active 1v1 play';
    end if;
    v_context_type := '1v1';
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
  insert into public.player_stats(user_id, total_gems, high_score, updated_at)
  values (v_uid, 0, 0, now()) on conflict (user_id) do nothing;

  select count(*) into v_claimed
  from public.player_progression_events event
  where event.user_id = v_uid and event.source = 'gem'
    and event.metadata->>'context_id' = p_context_id::text;
  if v_context_type = '1v1' then
    select v_claimed + count(*) into v_claimed
    from public.multiplayer_point_events event
    where event.match_id = p_context_id and event.user_id = v_uid;
  end if;
  if v_claimed >= v_allowed then
    raise exception 'Gem claim limit reached';
  end if;

  select count(*) into v_recent_claims
  from public.player_progression_events event
  where event.user_id = v_uid and event.source = 'gem'
    and event.created_at > v_now - interval '1 second';
  if v_context_type = '1v1' then
    select v_recent_claims + count(*) into v_recent_claims
    from public.multiplayer_point_events event
    where event.user_id = v_uid
      and event.created_at > v_now - interval '1 second';
  end if;
  if v_recent_claims >= 3 then
    raise exception 'Gem pickups arrived too quickly';
  end if;

  insert into public.player_progression_events(
    user_id, source, source_key, xp_awarded, metadata
  ) values (
    v_uid, 'gem', p_context_id::text || ':' || v_pickup_id, 20,
    jsonb_build_object(
      'context_id', p_context_id, 'context_type', v_context_type,
      'pickup_id', v_pickup_id,
      'verified_active_seconds', v_active_seconds,
      'verified_wave', v_verified_wave
    )
  ) on conflict (user_id, source, source_key) do nothing
  returning id into v_inserted;
  if v_inserted is not null then
    update public.player_stats
    set total_gems = total_gems + 1, updated_at = now()
    where user_id = v_uid returning total_gems into v_total;
    v_progress := app_private.apply_player_xp(v_uid, 20, false);
  else
    select stats.total_gems into v_total from public.player_stats stats
    where stats.user_id = v_uid;
    v_progress := public.get_player_progression();
  end if;
  return jsonb_build_object(
    'total_gems', coalesce(v_total, 0),
    'is_new', v_inserted is not null,
    'progression', v_progress
  );
end;
$$;

-- 1v1 coin receipts use the same private activity ledger and share their
-- allowance with 1v1 gem receipts. This prevents fabricated IDs from earning
-- unlimited coins or trigger-awarded XP during countdowns/intermissions.
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
  v_awarded integer := 0;
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

  -- Exact retries are safe after the active phase ends and never award twice.
  if exists (
    select 1 from public.multiplayer_point_events event
    where event.match_id = p_match_id and event.user_id = v_uid
      and event.pickup_id = v_pickup_id
  ) then
    select * into v_self from public.multiplayer_players player
    where player.match_id = p_match_id and player.user_id = v_uid;
    if v_self.user_id is null then raise exception '1v1 player not found'; end if;
    return jsonb_build_object(
      'match_id', p_match_id, 'source', 'coin',
      'pickup_id', v_pickup_id, 'duplicate', true, 'awarded', 0,
      'obstacle_points', v_self.obstacle_points,
      'melons_collected', v_self.melons_collected,
      'coins_collected', v_self.melons_collected
    );
  end if;

  select * into v_match from public.multiplayer_matches match_row
  where match_row.id = p_match_id
    and match_row.started_at > now() - interval '6 hours'
  for update;
  select * into v_self from public.multiplayer_players player
  where player.match_id = p_match_id and player.user_id = v_uid
  for update;
  if v_match.id is null or v_self.user_id is null then
    raise exception '1v1 match not found';
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
  from public.player_progression_events event
  where event.user_id = v_uid and event.source = 'gem'
    and event.metadata->>'context_id' = p_match_id::text;
  if v_claimed >= v_allowed then
    raise exception 'Coin pickup allowance reached';
  end if;

  select count(*) into v_recent_claims
  from public.multiplayer_point_events event
  where event.user_id = v_uid
    and event.created_at > v_now - interval '1 second';
  select v_recent_claims + count(*) into v_recent_claims
  from public.player_progression_events event
  where event.user_id = v_uid and event.source = 'gem'
    and event.created_at > v_now - interval '1 second';
  if v_recent_claims >= 3 then
    raise exception 'Coin pickups arrived too quickly';
  end if;

  insert into public.multiplayer_point_events(
    match_id, user_id, pickup_id, source, points_awarded
  ) values (p_match_id, v_uid, v_pickup_id, 'coin', 2)
  on conflict (match_id, user_id, pickup_id) do nothing
  returning pickup_id into v_inserted_id;
  if v_inserted_id is not null then
    v_awarded := 2;
    update public.multiplayer_players
    set obstacle_points = obstacle_points + 2,
        melons_collected = melons_collected + 1,
        last_melon_at = v_now, last_seen_at = v_now, updated_at = v_now
    where match_id = p_match_id and user_id = v_uid;
    update public.multiplayer_matches
    set last_activity_at = v_now where id = p_match_id;
  end if;
  select * into v_self from public.multiplayer_players player
  where player.match_id = p_match_id and player.user_id = v_uid;
  return jsonb_build_object(
    'match_id', p_match_id, 'source', 'coin',
    'pickup_id', v_pickup_id, 'duplicate', v_inserted_id is null,
    'awarded', v_awarded, 'obstacle_points', v_self.obstacle_points,
    'melons_collected', v_self.melons_collected,
    'coins_collected', v_self.melons_collected,
    'coin_allowance', v_allowed
  );
end;
$$;

revoke all on function public.claim_player_gem(uuid, text)
  from public, anon, authenticated;
revoke all on function public.award_1v1_points(uuid, text, integer, text)
  from public, anon, authenticated;
do $$
begin
  if to_regprocedure(
    'public.award_1v1_points(uuid,text,integer)'
  ) is not null then
    execute 'revoke all on function public.award_1v1_points(uuid, text, integer) from public, anon, authenticated';
  end if;
end
$$;
grant execute on function public.claim_player_gem(uuid, text)
  to authenticated;
grant execute on function public.award_1v1_points(uuid, text, integer, text)
  to authenticated;

create or replace function app_private.run_xp_breakdown(
  p_score bigint,
  p_completed_waves integer,
  p_active_seconds bigint,
  p_finish_xp bigint
)
returns jsonb
language sql
immutable
strict
set search_path = ''
as $$
  with awards as (
    select
      greatest(p_finish_xp, 0)::bigint as finish_xp,
      least(
        floor(greatest(p_score, 0)::numeric / 250)::bigint,
        greatest(p_completed_waves, 1)::bigint * 10
      ) as score_xp,
      greatest(p_completed_waves, 0)::bigint * 10 as wave_xp,
      floor(greatest(p_active_seconds, 0)::numeric / 10)::bigint
        as playtime_xp
  )
  select jsonb_build_object(
    'finish', finish_xp,
    'score', score_xp,
    'waves', wave_xp,
    'playtime', playtime_xp,
    'total', finish_xp + score_xp + wave_xp + playtime_xp
  )
  from awards;
$$;

revoke all on function app_private.run_xp_breakdown(
  bigint, integer, bigint, bigint
) from public, anon, authenticated;

-- Versioned separately so the currently deployed three-argument client keeps
-- working until its matching UI build is deployed. The server never accepts a
-- caller-calculated XP total.
drop function if exists public.award_completed_run_v2(
  uuid, bigint, text, integer, integer
);
create or replace function public.award_completed_run_v2(
  p_run_id uuid,
  p_score bigint,
  p_scope text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_scope text := lower(trim(p_scope));
  v_xp bigint;
  v_inserted uuid;
  v_score bigint;
  v_started_at timestamptz;
  v_completed_at timestamptz;
  v_stored_score bigint;
  v_high_score bigint;
  v_match_mode text;
  v_match_status text;
  v_server_wave integer;
  v_verified_1v1_wave integer;
  v_completed_waves integer := 0;
  v_active_seconds bigint := 0;
  v_duration_seconds numeric := 0;
  v_finish_xp bigint := 10;
  v_breakdown jsonb;
  v_existing_breakdown jsonb;
  v_progress jsonb;
  v_recent_short_award boolean := false;
  v_run_already_completed boolean := false;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  if p_run_id is null then raise exception 'Run ID is required'; end if;
  if p_score is null or p_score < 0 or p_score > 1000000000 then
    raise exception 'Invalid run score';
  end if;
  if v_scope not in ('endless', 'casual_1v1', 'ranked_1v1') then
    raise exception 'Invalid run type';
  end if;

  if v_scope = 'endless' then
    select run.started_at, run.completed_at, run.credited_score,
           run.active_seconds, run.verified_wave
    into v_started_at, v_completed_at, v_stored_score,
         v_active_seconds, v_server_wave
    from public.player_progression_runs run
    where run.run_id = p_run_id and run.user_id = v_uid
    for update;
    if v_started_at is null then raise exception 'Run receipt not found'; end if;
    if v_completed_at is not null then
      v_duration_seconds := greatest(
        0,
        extract(epoch from (v_completed_at - v_started_at))
      );
      v_score := least(
        greatest(coalesce(v_stored_score, 0), 0),
        50000000::bigint
      );
      v_run_already_completed := true;
    else
      v_duration_seconds := greatest(
        0,
        extract(epoch from (clock_timestamp() - v_started_at))
      );
      v_active_seconds := least(
        greatest(coalesce(v_active_seconds, 0), 0),
        floor(v_duration_seconds)::bigint,
        21600::bigint
      );
      v_completed_waves := greatest(coalesce(v_server_wave, 1) - 1, 0);
      if v_active_seconds < 10 then
        v_finish_xp := 1;
        v_score := 0;
        v_completed_waves := 0;
        select exists (
          select 1
          from public.player_progression_events event
          where event.user_id = v_uid
            and event.source = 'run'
            and event.created_at > clock_timestamp() - interval '30 seconds'
            and event.metadata->>'short_run' = 'true'
        ) into v_recent_short_award;
        update public.player_progression_runs
        set completed_at = now(), claimed_score = p_score, credited_score = 0
        where run_id = p_run_id;
      else
        v_score := least(
          p_score,
          floor(v_duration_seconds * 2000)::bigint,
          50000000::bigint
        );
        update public.player_progression_runs
        set completed_at = now(), claimed_score = p_score,
            credited_score = v_score
        where run_id = p_run_id;
      end if;
    end if;
  else
    select match.status, match.mode, player.score, player.wave,
           match.started_at, match.finished_at,
           coalesce(activity.active_seconds, 0),
           coalesce(activity.verified_wave, 1)
    into v_match_status, v_match_mode, v_score, v_server_wave,
         v_started_at, v_completed_at, v_active_seconds,
         v_verified_1v1_wave
    from public.multiplayer_matches match
    join public.multiplayer_players player
      on player.match_id = match.id and player.user_id = v_uid
    left join public.player_progression_1v1_activity activity
      on activity.match_id = match.id and activity.user_id = v_uid
    where match.id = p_run_id;
    if v_match_status is null then raise exception '1v1 result not found'; end if;
    if v_match_status <> 'finished' then raise exception '1v1 is not finished'; end if;
    if v_scope <> (v_match_mode || '_1v1') then
      raise exception '1v1 mode does not match the finished result';
    end if;
    v_duration_seconds := greatest(
      0,
      extract(epoch from (coalesce(v_completed_at, now()) - v_started_at))
    );
    v_completed_waves := least(
      greatest(coalesce(v_server_wave, 1) - 1, 0),
      greatest(coalesce(v_verified_1v1_wave, 1) - 1, 0)
    );
    v_active_seconds := least(
      21600::bigint,
      greatest(coalesce(v_active_seconds, 0), 0),
      floor(v_duration_seconds)::bigint
    );
    v_score := least(
      greatest(coalesce(v_score, 0), 0),
      47000::bigint,
      5000::bigint + floor(v_duration_seconds * 5000)::bigint
    );
  end if;

  insert into public.player_stats(user_id, total_gems, high_score, updated_at)
  values (v_uid, 0, v_score, now())
  on conflict (user_id) do nothing;
  update public.player_stats stats
  set high_score = greatest(stats.high_score, v_score),
      updated_at = now()
  where stats.user_id = v_uid
  returning stats.high_score into v_high_score;

  if v_run_already_completed then
    select event.metadata->'xp_breakdown'
    into v_existing_breakdown
    from public.player_progression_events event
    where event.user_id = v_uid and event.source = 'run'
      and event.source_key = p_run_id::text;
    return public.get_player_progression()
      || jsonb_build_object(
        'xp_awarded', 0,
        'xp_breakdown', v_existing_breakdown,
        'high_score', v_high_score
      );
  end if;
  if v_recent_short_award then
    return public.get_player_progression()
      || jsonb_build_object(
        'xp_awarded', 0,
        'short_run_throttled', true,
        'high_score', v_high_score
      );
  end if;

  v_breakdown := app_private.run_xp_breakdown(
    v_score, v_completed_waves, v_active_seconds, v_finish_xp
  );
  v_xp := (v_breakdown->>'total')::bigint;

  insert into public.player_progression_events(
    user_id, source, source_key, xp_awarded, metadata
  ) values (
    v_uid, 'run', p_run_id::text, v_xp,
    jsonb_build_object(
      'claimed_score', p_score,
      'credited_score', v_score,
      'scope', v_scope,
      'duration_seconds', v_duration_seconds,
      'active_seconds', v_active_seconds,
      'completed_waves', v_completed_waves,
      'xp_breakdown', v_breakdown,
      'short_run', v_scope = 'endless' and v_active_seconds < 10
    )
  )
  on conflict (user_id, source, source_key) do nothing
  returning id into v_inserted;

  if v_inserted is not null then
    v_progress := app_private.apply_player_xp(v_uid, v_xp, true);
    return v_progress
      || jsonb_build_object(
        'xp_breakdown', v_breakdown,
        'high_score', v_high_score
      );
  end if;

  select event.metadata->'xp_breakdown'
  into v_existing_breakdown
  from public.player_progression_events event
  where event.user_id = v_uid and event.source = 'run'
    and event.source_key = p_run_id::text;
  return public.get_player_progression()
    || jsonb_build_object(
      'xp_awarded', 0,
      'xp_breakdown', v_existing_breakdown,
      'high_score', v_high_score
    );
end;
$$;

-- Keep older deployed clients compatible without leaving the former,
-- wall-clock-only XP calculation callable as a bypass.
create or replace function public.award_completed_run(
  p_run_id uuid,
  p_score bigint,
  p_scope text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select public.award_completed_run_v2(p_run_id, p_score, p_scope);
$$;

revoke all on function public.award_completed_run_v2(
  uuid, bigint, text
) from public, anon, authenticated;
revoke all on function public.award_completed_run(
  uuid, bigint, text
) from public, anon, authenticated;
grant execute on function public.award_completed_run_v2(
  uuid, bigint, text
) to authenticated;
grant execute on function public.award_completed_run(
  uuid, bigint, text
) to authenticated;

-- Online 1v1 completion is server-triggered so both players earn their run XP
-- even when one closes the page before the final client refresh.
create or replace function app_private.award_finished_1v1_progression()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player record;
  v_xp bigint;
  v_inserted uuid;
  v_duration_seconds numeric;
  v_active_seconds bigint;
  v_verified_wave integer;
  v_last_heartbeat timestamptz;
  v_heartbeat_active boolean;
  v_final_increment bigint;
  v_max_wave integer;
  v_completed_waves integer;
  v_score_ceiling bigint;
  v_credited_score bigint;
  v_breakdown jsonb;
begin
  if old.status is not distinct from new.status or new.status <> 'finished' then
    return new;
  end if;
  v_duration_seconds := greatest(
    0,
    extract(epoch from (coalesce(new.finished_at, now()) - new.started_at))
  );
  v_score_ceiling := least(
    47000::bigint,
    5000::bigint + floor(v_duration_seconds * 5000)::bigint
  );
  for v_player in
    select player.user_id, player.score, player.wave
    from public.multiplayer_players player
    where player.match_id = new.id
  loop
    v_active_seconds := 0;
    v_verified_wave := 1;
    v_last_heartbeat := null;
    v_heartbeat_active := false;
    select activity.active_seconds, activity.verified_wave,
           activity.last_heartbeat_at, activity.heartbeat_active
    into v_active_seconds, v_verified_wave, v_last_heartbeat,
         v_heartbeat_active
    from public.player_progression_1v1_activity activity
    where activity.match_id = new.id
      and activity.user_id = v_player.user_id
    for update;
    v_final_increment := case
      when coalesce(v_heartbeat_active, false) then least(
        6::bigint,
        greatest(
          0,
          floor(extract(epoch from (
            coalesce(new.finished_at, clock_timestamp())
              - coalesce(v_last_heartbeat, new.started_at)
          )))::bigint
        )
      )
      else 0
    end;
    v_active_seconds := least(
      21600::bigint,
      greatest(coalesce(v_active_seconds, 0), 0) + v_final_increment,
      floor(v_duration_seconds)::bigint
    );
    v_max_wave := least(
      100000,
      1 + floor(v_active_seconds::numeric / 15)::integer
    );
    v_verified_wave := least(
      greatest(coalesce(v_verified_wave, 1), coalesce(v_player.wave, 1)),
      coalesce(v_verified_wave, 1) + 1,
      v_max_wave
    );
    update public.player_progression_1v1_activity
    set active_seconds = v_active_seconds,
        verified_wave = v_verified_wave,
        last_heartbeat_at = coalesce(new.finished_at, clock_timestamp()),
        heartbeat_active = false
    where match_id = new.id and user_id = v_player.user_id;
    v_completed_waves := least(
      greatest(coalesce(v_player.wave, 1) - 1, 0),
      greatest(coalesce(v_verified_wave, 1) - 1, 0)
    );
    v_credited_score := least(
      greatest(coalesce(v_player.score, 0), 0),
      v_score_ceiling
    );
    v_breakdown := app_private.run_xp_breakdown(
      v_credited_score, v_completed_waves, v_active_seconds, 10
    );
    v_xp := (v_breakdown->>'total')::bigint;
    insert into public.player_progression_events(
      user_id, source, source_key, xp_awarded, metadata
    ) values (
      v_player.user_id, 'run', new.id::text, v_xp,
      jsonb_build_object(
        'claimed_score', v_player.score,
        'credited_score', v_credited_score,
        'scope', new.mode || '_1v1',
        'duration_seconds', v_duration_seconds,
        'active_seconds', v_active_seconds,
        'completed_waves', v_completed_waves,
        'xp_breakdown', v_breakdown
      )
    ) on conflict (user_id, source, source_key) do nothing
    returning id into v_inserted;
    if v_inserted is not null then
      perform app_private.apply_player_xp(v_player.user_id, v_xp, true);
    end if;
    v_inserted := null;
  end loop;
  return new;
end;
$$;

drop trigger if exists award_finished_1v1_progression
  on public.multiplayer_matches;
create trigger award_finished_1v1_progression
after update of status on public.multiplayer_matches
for each row execute function app_private.award_finished_1v1_progression();
revoke all on function app_private.award_finished_1v1_progression()
  from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;

select
  to_regprocedure(
    'public.award_completed_run_v2(uuid,bigint,text)'
  ) is not null as xp_sources_rpc_installed,
  has_function_privilege(
    'authenticated',
    'public.award_completed_run_v2(uuid,bigint,text)',
    'EXECUTE'
  ) and not has_function_privilege(
    'anon',
    'public.award_completed_run_v2(uuid,bigint,text)',
    'EXECUTE'
  ) as xp_sources_rpc_secure,
  position(
    'award_completed_run_v2' in pg_get_functiondef(
      to_regprocedure('public.award_completed_run(uuid,bigint,text)')
    )
  ) > 0 as legacy_run_rpc_uses_secure_xp,
  app_private.xp_required_for_level(2)
    > app_private.xp_required_for_level(1)
    as higher_levels_require_more_xp,
  position(
    'completed_waves' in pg_get_functiondef(
      to_regprocedure(
        'public.award_completed_run_v2(uuid,bigint,text)'
      )
    )
  ) > 0 as wave_xp_installed,
  position(
    'active_seconds' in pg_get_functiondef(
      to_regprocedure(
        'public.award_completed_run_v2(uuid,bigint,text)'
      )
    )
  ) > 0 as playtime_xp_installed,
  has_function_privilege(
    'authenticated',
    'public.sync_progression_run(uuid,integer,boolean)', 'EXECUTE'
  ) and not has_function_privilege(
    'anon', 'public.sync_progression_run(uuid,integer,boolean)', 'EXECUTE'
  ) and to_regprocedure(
    'public.sync_progression_run(uuid,integer)'
  ) is null as progression_heartbeat_secure,
  has_function_privilege(
    'authenticated',
    'public.sync_1v1_progression(uuid,integer,boolean)', 'EXECUTE'
  ) and not has_function_privilege(
    'anon', 'public.sync_1v1_progression(uuid,integer,boolean)', 'EXECUTE'
  ) as versus_progression_heartbeat_secure,
  has_function_privilege(
    'authenticated',
    'public.award_1v1_points(uuid,text,integer,text)', 'EXECUTE'
  ) and not has_function_privilege(
    'anon',
    'public.award_1v1_points(uuid,text,integer,text)', 'EXECUTE'
  ) and coalesce(not has_function_privilege(
    'authenticated',
    to_regprocedure('public.award_1v1_points(uuid,text,integer)'),
    'EXECUTE'
  ), true) as receipt_only_coin_rpc,
  position(
    'heartbeat_active' in pg_get_functiondef(
      to_regprocedure('public.claim_player_gem(uuid,text)')
    )
  ) > 0 and position(
    'active_seconds' in pg_get_functiondef(
      to_regprocedure('public.claim_player_gem(uuid,text)')
    )
  ) > 0 and position(
    'heartbeat_active' in pg_get_functiondef(
      to_regprocedure(
        'public.award_1v1_points(uuid,text,integer,text)'
      )
    )
  ) > 0 and position(
    'active_seconds' in pg_get_functiondef(
      to_regprocedure(
        'public.award_1v1_points(uuid,text,integer,text)'
      )
    )
  ) > 0 as pickup_xp_uses_verified_activity,
  exists (
    select 1 from pg_trigger trigger_row
    where trigger_row.tgrelid = 'public.multiplayer_players'::regclass
      and trigger_row.tgname = 'flush_1v1_progression_on_phase_exit'
      and not trigger_row.tgisinternal
  ) as versus_phase_exit_flush_installed,
  not has_table_privilege(
    'authenticated', 'public.player_progression_1v1_activity', 'SELECT'
  ) as versus_progression_ledger_private;
