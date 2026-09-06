-- Player 06 Levels + Ranked 1v1
-- Permanent, account-scoped progression and an explicit Casual/Ranked split.
-- Casual matches never write Elo. Ranked matchmaking is locked until level 25.

begin;

alter table public.player_stats
  add column if not exists level integer not null default 1,
  add column if not exists xp_in_level bigint not null default 0,
  add column if not exists lifetime_xp bigint not null default 0,
  add column if not exists completed_runs bigint not null default 0,
  add column if not exists last_gem_claim_at timestamptz;

alter table public.player_stats
  drop constraint if exists player_stats_level_check,
  drop constraint if exists player_stats_xp_in_level_check,
  drop constraint if exists player_stats_lifetime_xp_check,
  drop constraint if exists player_stats_completed_runs_check;

alter table public.player_stats
  add constraint player_stats_level_check check (level >= 1) not valid,
  add constraint player_stats_xp_in_level_check check (xp_in_level >= 0) not valid,
  add constraint player_stats_lifetime_xp_check check (lifetime_xp >= 0) not valid,
  add constraint player_stats_completed_runs_check check (completed_runs >= 0) not valid;

alter table public.player_stats validate constraint player_stats_level_check;
alter table public.player_stats validate constraint player_stats_xp_in_level_check;
alter table public.player_stats validate constraint player_stats_lifetime_xp_check;
alter table public.player_stats validate constraint player_stats_completed_runs_check;

create table if not exists public.player_progression_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null check (source in ('run', 'gem', 'coin')),
  source_key text not null check (length(source_key) between 1 and 200),
  xp_awarded bigint not null check (xp_awarded > 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, source, source_key)
);

create table if not exists public.player_progression_runs (
  run_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  claimed_score bigint,
  credited_score bigint,
  check (claimed_score is null or claimed_score >= 0),
  check (credited_score is null or credited_score >= 0)
);

create index if not exists player_progression_events_user_created_idx
  on public.player_progression_events(user_id, created_at desc);
create index if not exists player_progression_gem_context_idx
  on public.player_progression_events(
    user_id, (metadata->>'context_id'), created_at desc
  ) where source = 'gem';
create index if not exists player_progression_runs_user_started_idx
  on public.player_progression_runs(user_id, started_at desc);
with duplicate_open_runs as (
  select run_id, row_number() over (
    partition by user_id order by started_at desc, run_id desc
  ) as open_order
  from public.player_progression_runs where completed_at is null
)
update public.player_progression_runs run
set completed_at = now(), claimed_score = 0, credited_score = 0
from duplicate_open_runs duplicate
where run.run_id = duplicate.run_id and duplicate.open_order > 1;
create unique index if not exists player_progression_runs_one_open_idx
  on public.player_progression_runs(user_id) where completed_at is null;

alter table public.player_progression_events enable row level security;
alter table public.player_progression_runs enable row level security;
revoke all on table public.player_progression_events
  from public, anon, authenticated;
revoke all on table public.player_progression_runs
  from public, anon, authenticated;

comment on table public.player_progression_events is
  'Private idempotency ledger for permanent account XP. Clients receive only aggregate progression through RPCs.';
comment on column public.player_stats.xp_in_level is
  'XP earned toward the next level; this resets to the remainder after each level-up.';

create or replace function app_private.xp_required_for_level(p_level integer)
returns bigint
language sql
immutable
strict
set search_path = ''
as $$
  select 100::bigint + greatest(0, p_level - 1)::bigint * 25::bigint;
$$;

create or replace function app_private.apply_player_xp(
  p_user_id uuid,
  p_amount bigint,
  p_completed_run boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_level integer;
  v_xp bigint;
  v_lifetime bigint;
  v_runs bigint;
  v_required bigint;
  v_progress_total numeric;
  v_levels_completed bigint;
  v_level_start numeric;
begin
  if p_user_id is null or p_amount is null or p_amount < 0
     or p_amount > 1000000 then
    raise exception 'Invalid XP award';
  end if;

  insert into public.player_stats(user_id, total_gems, high_score, updated_at)
  values (p_user_id, 0, 0, now())
  on conflict (user_id) do nothing;

  select stats.level, stats.xp_in_level, stats.lifetime_xp,
         stats.completed_runs
  into v_level, v_xp, v_lifetime, v_runs
  from public.player_stats stats
  where stats.user_id = p_user_id
  for update;

  -- Thresholds form an arithmetic series. Solve the series directly instead
  -- of looping once per level, so even a corrupted input cannot hold locks in
  -- an unbounded loop.
  v_progress_total :=
    (greatest(v_level, 1) - 1)::numeric * 100
    + (greatest(v_level, 1) - 1)::numeric
      * (greatest(v_level, 1) - 2)::numeric * 25 / 2
    + greatest(v_xp, 0)::numeric + p_amount::numeric;
  v_levels_completed := greatest(
    0,
    floor((sqrt(30625::numeric + 200 * v_progress_total) - 175) / 50)
  )::bigint;
  if v_levels_completed > 2147483646 then
    raise exception 'Account level exceeds the supported range';
  end if;
  v_level := v_levels_completed::integer + 1;
  v_level_start := v_levels_completed::numeric * 100
    + v_levels_completed::numeric * (v_levels_completed - 1)::numeric * 25 / 2;
  v_xp := floor(v_progress_total - v_level_start)::bigint;
  if v_lifetime > 9223372036854775807::bigint - p_amount then
    raise exception 'Lifetime XP exceeds the supported range';
  end if;
  v_lifetime := v_lifetime + p_amount;
  v_runs := v_runs + case when p_completed_run then 1 else 0 end;
  v_required := app_private.xp_required_for_level(v_level);

  update public.player_stats stats
  set level = v_level,
      xp_in_level = v_xp,
      lifetime_xp = v_lifetime,
      completed_runs = v_runs,
      updated_at = now()
  where stats.user_id = p_user_id;

  return jsonb_build_object(
    'level', v_level,
    'xp', v_xp,
    'xp_required', v_required,
    'lifetime_xp', v_lifetime,
    'completed_runs', v_runs,
    'ranked_unlocked', v_level >= 25,
    'xp_awarded', p_amount
  );
end;
$$;

revoke all on function app_private.xp_required_for_level(integer)
  from public, anon, authenticated;
revoke all on function app_private.apply_player_xp(uuid, bigint, boolean)
  from public, anon, authenticated;

create or replace function public.get_player_progression()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_stats public.player_stats%rowtype;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;

  insert into public.player_stats(user_id, total_gems, high_score, updated_at)
  values (v_uid, 0, 0, now())
  on conflict (user_id) do nothing;

  select * into v_stats
  from public.player_stats stats
  where stats.user_id = v_uid;

  return jsonb_build_object(
    'level', v_stats.level,
    'xp', v_stats.xp_in_level,
    'xp_required', app_private.xp_required_for_level(v_stats.level),
    'lifetime_xp', v_stats.lifetime_xp,
    'completed_runs', v_stats.completed_runs,
    'ranked_unlocked', v_stats.level >= 25
  );
end;
$$;

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
  where user_id = v_uid and completed_at is null
    and started_at < now() - interval '6 hours';
  select run.run_id into v_run_id
  from public.player_progression_runs run
  where run.user_id = v_uid and run.completed_at is null
  order by run.started_at desc limit 1;
  if v_run_id is not null then return v_run_id; end if;
  insert into public.player_progression_runs(user_id)
  values (v_uid) returning run_id into v_run_id;
  return v_run_id;
end;
$$;

-- A finished run grants 30 XP plus 1 XP for every 100 server-accepted score.
-- Endless uses a server-issued run receipt and a deliberately generous score
-- velocity ceiling. Online 1v1 reads its score/mode from the finished match,
-- so a caller cannot label a Casual result as Ranked or invent its score.
create or replace function public.award_completed_run(
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
  v_progress jsonb;
  v_base_xp bigint := 30;
  v_duration_seconds numeric := 0;
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
    select run.started_at, run.completed_at, run.credited_score
    into v_started_at, v_completed_at, v_stored_score
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
      if v_duration_seconds < 5 then
        v_base_xp := 1;
        v_score := 0;
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
        -- The game remains client-authoritative, but score credit cannot exceed a
        -- generous real-time ceiling tied to this server-issued receipt.
        v_score := least(
          p_score,
          floor(v_duration_seconds * 2000)::bigint,
          50000000::bigint
        );
        update public.player_progression_runs
        set completed_at = now(), claimed_score = p_score, credited_score = v_score
        where run_id = p_run_id;
      end if;
    end if;
  else
    select match.status, match.mode, player.score,
           match.started_at, match.finished_at
    into v_match_status, v_match_mode, v_score,
         v_started_at, v_completed_at
    from public.multiplayer_matches match
    join public.multiplayer_players player
      on player.match_id = match.id and player.user_id = v_uid
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
    v_score := least(
      v_score,
      47000::bigint,
      5000::bigint + floor(v_duration_seconds * 5000)::bigint
    );
  end if;

  -- Only the server-accepted score above may advance the permanent high score.
  insert into public.player_stats(user_id, total_gems, high_score, updated_at)
  values (v_uid, 0, v_score, now())
  on conflict (user_id) do nothing;
  update public.player_stats stats
  set high_score = greatest(stats.high_score, v_score),
      updated_at = now()
  where stats.user_id = v_uid
  returning stats.high_score into v_high_score;

  if v_run_already_completed then
    return public.get_player_progression()
      || jsonb_build_object('xp_awarded', 0, 'high_score', v_high_score);
  end if;
  if v_recent_short_award then
    return public.get_player_progression()
      || jsonb_build_object(
        'xp_awarded', 0,
        'short_run_throttled', true,
        'high_score', v_high_score
      );
  end if;

  v_xp := v_base_xp + floor(v_score::numeric / 100)::bigint;

  insert into public.player_progression_events(
    user_id, source, source_key, xp_awarded, metadata
  ) values (
    v_uid, 'run', p_run_id::text, v_xp,
    jsonb_build_object(
      'claimed_score', p_score, 'credited_score', v_score, 'scope', v_scope,
      'duration_seconds', v_duration_seconds,
      'short_run', v_scope = 'endless' and v_duration_seconds < 5
    )
  )
  on conflict (user_id, source, source_key) do nothing
  returning id into v_inserted;

  if v_inserted is not null then
    v_progress := app_private.apply_player_xp(v_uid, v_xp, true);
    return v_progress || jsonb_build_object('high_score', v_high_score);
  end if;
  return public.get_player_progression()
    || jsonb_build_object('xp_awarded', 0, 'high_score', v_high_score);
end;
$$;

-- Retained only for controlled server compatibility. Authenticated clients no
-- longer receive EXECUTE; the receipt-backed claim_player_gem RPC below is the
-- supported path.
create or replace function public.increment_player_gems()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_total bigint;
  v_event_key text := gen_random_uuid()::text;
  v_last_claim timestamptz;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;

  insert into public.player_stats(user_id, total_gems, high_score, updated_at)
  values (v_uid, 0, 0, now())
  on conflict (user_id) do nothing;

  select stats.last_gem_claim_at into v_last_claim
  from public.player_stats stats where stats.user_id = v_uid for update;
  if v_last_claim is not null
     and v_last_claim > clock_timestamp() - interval '250 milliseconds' then
    raise exception 'Gem pickup arrived too quickly';
  end if;

  update public.player_stats stats
  set total_gems = stats.total_gems + 1,
      last_gem_claim_at = clock_timestamp(),
      updated_at = now()
  where stats.user_id = v_uid
  returning total_gems into v_total;

  insert into public.player_progression_events(
    user_id, source, source_key, xp_awarded
  ) values (v_uid, 'gem', v_event_key, 20);
  perform app_private.apply_player_xp(v_uid, 20, false);
  return v_total;
end;
$$;

-- Current clients bind each gem to a server-known run/match and stable pickup
-- id. The context allowance grows with real elapsed play/waves, so arbitrary
-- rapid RPC calls cannot mint unlimited gems or XP.
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
  v_started_at timestamptz;
  v_wave integer;
  v_context_type text;
  v_allowed bigint;
  v_claimed bigint;
  v_recent_claims bigint;
  v_elapsed_seconds numeric;
  v_inserted uuid;
  v_total bigint;
  v_progress jsonb;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  if p_context_id is null or v_pickup_id is null
     or length(v_pickup_id) not between 1 and 120 then
    raise exception 'Valid gem context and pickup ID are required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 1));
  insert into public.player_stats(user_id, total_gems, high_score, updated_at)
  values (v_uid, 0, 0, now()) on conflict (user_id) do nothing;
  perform stats.user_id from public.player_stats stats
  where stats.user_id = v_uid for update;

  -- Exact retries are successful even if the run crossed a phase boundary or
  -- its current allowance has since been consumed.
  if exists (
    select 1 from public.player_progression_events event
    where event.user_id = v_uid and event.source = 'gem'
      and event.source_key = p_context_id::text || ':' || v_pickup_id
  ) then
    select stats.total_gems into v_total
    from public.player_stats stats where stats.user_id = v_uid;
    return jsonb_build_object(
      'total_gems', coalesce(v_total, 0), 'is_new', false,
      'progression', public.get_player_progression()
    );
  end if;

  select run.started_at into v_started_at
  from public.player_progression_runs run
  where run.run_id = p_context_id and run.user_id = v_uid
    and run.completed_at is null
    and run.started_at > now() - interval '6 hours';
  if v_started_at is not null then
    v_context_type := 'endless';
    v_elapsed_seconds := greatest(
      0,
      extract(epoch from (clock_timestamp() - v_started_at))
    );
    v_allowed := 2 + floor(v_elapsed_seconds / 0.30)::bigint;
  else
    select match.started_at, player.wave into v_started_at, v_wave
    from public.multiplayer_matches match
    join public.multiplayer_players player
      on player.match_id = match.id and player.user_id = v_uid
    where match.id = p_context_id
      and match.status in ('countdown', 'playing', 'intermission')
      and match.started_at > now() - interval '6 hours';
    if v_wave is null then raise exception 'Gem context is not active'; end if;
    v_context_type := '1v1';
    v_elapsed_seconds := greatest(
      0,
      extract(epoch from (clock_timestamp() - v_started_at))
    );
    v_allowed := least(
      2 + floor(v_elapsed_seconds / 0.30)::bigint,
      2 + greatest(1, v_wave)::bigint * 90
    );
  end if;

  select count(*) into v_claimed
  from public.player_progression_events event
  where event.user_id = v_uid and event.source = 'gem'
    and event.metadata->>'context_id' = p_context_id::text;
  if v_context_type = '1v1' then
    select v_claimed + count(*) into v_claimed
    from public.multiplayer_point_events event
    where event.match_id = p_context_id and event.user_id = v_uid;
  end if;
  if v_claimed >= v_allowed then raise exception 'Gem claim limit reached'; end if;
  select count(*) into v_recent_claims
  from public.player_progression_events event
  where event.user_id = v_uid and event.source = 'gem'
    and event.metadata->>'context_id' = p_context_id::text
    and event.created_at > clock_timestamp() - interval '1 second';
  if v_context_type = '1v1' then
    select v_recent_claims + count(*) into v_recent_claims
    from public.multiplayer_point_events event
    where event.match_id = p_context_id and event.user_id = v_uid
      and event.created_at > clock_timestamp() - interval '1 second';
  end if;
  if v_recent_claims >= 4 then
    raise exception 'Gem pickups arrived too quickly';
  end if;

  insert into public.player_progression_events(
    user_id, source, source_key, xp_awarded, metadata
  ) values (
    v_uid, 'gem', p_context_id::text || ':' || v_pickup_id, 20,
    jsonb_build_object(
      'context_id', p_context_id, 'context_type', v_context_type,
      'pickup_id', v_pickup_id
    )
  ) on conflict (user_id, source, source_key) do nothing
  returning id into v_inserted;

  if v_inserted is not null then
    update public.player_stats
      set total_gems = total_gems + 1, updated_at = now()
      where user_id = v_uid
    returning total_gems into v_total;
    v_progress := app_private.apply_player_xp(v_uid, 20, false);
  else
    select stats.total_gems into v_total
    from public.player_stats stats where stats.user_id = v_uid;
    v_progress := public.get_player_progression();
  end if;
  return jsonb_build_object(
    'total_gems', coalesce(v_total, 0), 'is_new', v_inserted is not null,
    'progression', v_progress
  );
end;
$$;

create or replace function app_private.award_coin_progression()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted uuid;
begin
  insert into public.player_progression_events(
    user_id, source, source_key, xp_awarded,
    metadata
  ) values (
    new.user_id, 'coin', new.match_id::text || ':' || new.pickup_id, 3,
    jsonb_build_object('match_id', new.match_id, 'pickup_id', new.pickup_id)
  )
  on conflict (user_id, source, source_key) do nothing
  returning id into v_inserted;

  if v_inserted is not null then
    perform app_private.apply_player_xp(new.user_id, 3, false);
  end if;
  return new;
end;
$$;

-- Reject implausible client score snapshots before either state RPC can write
-- them. The generous real-time ceiling protects match finalization and Ranked
-- records without requiring the browser to be trusted as the score authority.
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
begin
  select match.started_at into v_started_at
  from public.multiplayer_matches match where match.id = new.match_id;
  if v_started_at is null then raise exception '1v1 match not found'; end if;
  v_elapsed_seconds := greatest(
    0,
    extract(epoch from (clock_timestamp() - v_started_at))
  );
  v_score_ceiling := least(
    10000000::bigint,
    10000::bigint + floor(v_elapsed_seconds * 25000)::bigint
  );
  if new.score < 0 or new.score > v_score_ceiling then
    raise exception '1v1 score exceeds the server play-time allowance';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_1v1_score_ceiling
  on public.multiplayer_players;
create trigger enforce_1v1_score_ceiling
before insert or update of score on public.multiplayer_players
for each row execute function app_private.enforce_1v1_score_ceiling();
revoke all on function app_private.enforce_1v1_score_ceiling()
  from public, anon, authenticated;

-- Override Multi-device 05's four-argument pickup endpoint with a receipt,
-- elapsed-time, wave, and short-window guarded version. A stable pickup ID is
-- still idempotent, while arbitrary unique IDs cannot be minted without bound.
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
  v_now timestamptz := clock_timestamp();
  v_elapsed_seconds numeric;
  v_elapsed_allowance bigint;
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
  where id = p_match_id
    and started_at > now() - interval '6 hours' for update;
  select * into v_self from public.multiplayer_players
  where match_id = p_match_id and user_id = v_uid for update;
  if v_match.id is null or v_self.user_id is null then
    raise exception '1v1 match not found';
  end if;

  if exists (
    select 1 from public.multiplayer_point_events event
    where event.match_id = p_match_id and event.user_id = v_uid
      and event.pickup_id = v_pickup_id
  ) then
    return jsonb_build_object(
      'match_id', p_match_id, 'source', 'coin',
      'pickup_id', v_pickup_id, 'duplicate', true, 'awarded', 0,
      'obstacle_points', v_self.obstacle_points,
      'melons_collected', v_self.melons_collected,
      'coins_collected', v_self.melons_collected
    );
  end if;
  if v_match.status <> 'playing' or v_self.status <> 'playing' then
    raise exception 'Coins can only be collected during active 1v1 play';
  end if;

  v_elapsed_seconds := greatest(
    0,
    extract(epoch from (v_now - v_match.started_at))
  );
  -- A lane can spawn at most one item every 330ms. The 300ms allowance and
  -- 90-pickup wave budget deliberately leave room for clock/network jitter.
  v_elapsed_allowance := 2 + floor(v_elapsed_seconds / 0.30)::bigint;
  v_wave_allowance := 2
    + greatest(v_match.current_wave, v_self.wave, 1)::bigint * 90;
  v_allowed := least(v_elapsed_allowance, v_wave_allowance);
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
  where event.match_id = p_match_id and event.user_id = v_uid
    and event.created_at > v_now - interval '1 second';
  select v_recent_claims + count(*) into v_recent_claims
  from public.player_progression_events event
  where event.user_id = v_uid and event.source = 'gem'
    and event.metadata->>'context_id' = p_match_id::text
    and event.created_at > v_now - interval '1 second';
  if v_recent_claims >= 4 then
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
    update public.multiplayer_matches set last_activity_at = v_now
    where id = p_match_id;
  end if;
  select * into v_self from public.multiplayer_players
  where match_id = p_match_id and user_id = v_uid;
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

comment on function public.award_1v1_points(uuid, text, integer, text) is
  'Idempotent 1v1 coin pickup claim constrained by server match time, wave, and recent accepted receipts.';

revoke all on function app_private.award_coin_progression()
  from public, anon, authenticated;

drop trigger if exists award_xp_for_1v1_coin
  on public.multiplayer_point_events;
create trigger award_xp_for_1v1_coin
after insert on public.multiplayer_point_events
for each row execute function app_private.award_coin_progression();

revoke all on function public.get_player_progression()
  from public, anon, authenticated;
revoke all on function public.start_progression_run()
  from public, anon, authenticated;
revoke all on function public.award_completed_run(uuid, bigint, text)
  from public, anon, authenticated;
revoke all on function public.increment_player_gems()
  from public, anon, authenticated;
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
  if to_regprocedure('public.save_player_high_score(bigint)') is not null then
    execute 'revoke all on function public.save_player_high_score(bigint) from public, anon, authenticated';
  end if;
end
$$;
grant execute on function public.get_player_progression() to authenticated;
grant execute on function public.start_progression_run() to authenticated;
grant execute on function public.award_completed_run(uuid, bigint, text)
  to authenticated;
grant execute on function public.claim_player_gem(uuid, text) to authenticated;
grant execute on function public.award_1v1_points(uuid, text, integer, text)
  to authenticated;

alter table public.multiplayer_queue
  add column if not exists mode text not null default 'casual';
alter table public.multiplayer_matches
  add column if not exists mode text not null default 'casual';

alter table public.multiplayer_queue
  drop constraint if exists multiplayer_queue_mode_check;
alter table public.multiplayer_matches
  drop constraint if exists multiplayer_matches_mode_check;
alter table public.multiplayer_queue
  add constraint multiplayer_queue_mode_check
    check (mode in ('casual', 'ranked')) not valid;
alter table public.multiplayer_matches
  add constraint multiplayer_matches_mode_check
    check (mode in ('casual', 'ranked')) not valid;
alter table public.multiplayer_queue validate constraint multiplayer_queue_mode_check;
alter table public.multiplayer_matches validate constraint multiplayer_matches_mode_check;

create index if not exists multiplayer_queue_mode_queued_idx
  on public.multiplayer_queue(mode, queued_at);

-- Mode-aware matchmaking only pairs Casual with Casual and Ranked with
-- Ranked. The level check is here on the server, so changing the browser UI
-- cannot bypass the level-25 requirement.
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

  select player.match_id, match.status, match.mode
  into v_match_id, v_status, v_match_mode
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
      'mode', v_match_mode, 'opponent_username', v_opponent_username
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
      'opponent_username', null
    );
  end if;

  select coalesce(loadout.character_key, 'runner_ace'),
         coalesce(catalog.character_class, loadout.class_key, 'runner')
  into v_character_key, v_character_class
  from public.player_loadouts loadout
  left join public.extraction_catalog catalog
    on catalog.item_key = loadout.character_key
   and catalog.item_type = 'character'
  where loadout.user_id = v_uid;
  v_character_key := coalesce(v_character_key, 'runner_ace');
  v_character_class := coalesce(v_character_class, 'runner');

  select coalesce(loadout.character_key, 'runner_ace'),
         coalesce(catalog.character_class, loadout.class_key, 'runner')
  into v_opponent_character_key, v_opponent_character_class
  from public.player_loadouts loadout
  left join public.extraction_catalog catalog
    on catalog.item_key = loadout.character_key
   and catalog.item_type = 'character'
  where loadout.user_id = v_opponent_id;
  v_opponent_character_key := coalesce(v_opponent_character_key, 'runner_ace');
  v_opponent_character_class := coalesce(v_opponent_character_class, 'runner');

  v_max_hearts := case
    when v_character_key in ('medic_oracle', 'tank_atlas') then 6
    when v_character_key in ('medic_seraph', 'medic_beacon', 'tank_colossus') then 5.5
    when v_character_key = 'tank_guard' then 4.5
    when v_character_key = 'tank_hammer' or v_character_class = 'medic' then 5
    when v_character_class = 'tank' then 4
    when v_character_class = 'trickster' then 2 else 3 end;
  v_starting_hearts := case
    when v_character_class = 'tank' then 4
    when v_character_class = 'trickster' then 2 else 3 end;
  v_opponent_max_hearts := case
    when v_opponent_character_key in ('medic_oracle', 'tank_atlas') then 6
    when v_opponent_character_key in
      ('medic_seraph', 'medic_beacon', 'tank_colossus') then 5.5
    when v_opponent_character_key = 'tank_guard' then 4.5
    when v_opponent_character_key = 'tank_hammer'
      or v_opponent_character_class = 'medic' then 5
    when v_opponent_character_class = 'tank' then 4
    when v_opponent_character_class = 'trickster' then 2 else 3 end;
  v_opponent_starting_hearts := case
    when v_opponent_character_class = 'tank' then 4
    when v_opponent_character_class = 'trickster' then 2 else 3 end;

  insert into public.multiplayer_matches(host_user_id, guest_user_id, mode)
  values (v_opponent_id, v_uid, v_mode) returning id into v_match_id;
  insert into public.multiplayer_players(
    match_id, user_id, slot, username, character_key, character_class,
    max_hearts, hearts
  ) values
    (v_match_id, v_opponent_id, 1, v_opponent_username,
     v_opponent_character_key, v_opponent_character_class,
     v_opponent_max_hearts, v_opponent_starting_hearts),
    (v_match_id, v_uid, 2, v_username,
     v_character_key, v_character_class, v_max_hearts, v_starting_hearts);
  delete from public.multiplayer_queue where user_id in (v_uid, v_opponent_id);
  return jsonb_build_object(
    'match_id', v_match_id, 'status', 'countdown', 'mode', v_mode,
    'opponent_username', v_opponent_username
  );
end;
$$;

-- Old clients continue to enter Casual. New clients always pass p_mode.
create or replace function public.join_1v1_queue()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.join_1v1_queue('casual');
$$;

-- Include the server-owned mode in reconnect snapshots.
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
    'id', attack.id, 'obstacle_type', attack.obstacle_type,
    'point_cost', attack.point_cost, 'spawn_wave', attack.spawn_wave,
    'created_at', attack.created_at
  ) order by attack.created_at), '[]'::jsonb)
  into v_attacks
  from public.multiplayer_attacks attack
  where attack.match_id = p_match_id and attack.target_user_id = v_uid
    and attack.delivered_at is null;

  return jsonb_build_object(
    'match', jsonb_build_object(
      'id', v_match.id, 'status', v_match.status, 'mode', v_match.mode,
      'current_wave', v_match.current_wave,
      'intermission_ends_at', v_match.intermission_ends_at,
      'winner_user_id', v_match.winner_user_id,
      'started_at', v_match.started_at, 'finished_at', v_match.finished_at
    ),
    'self', jsonb_build_object(
      'user_id', v_self.user_id, 'username', v_self.username,
      'character_key', v_self.character_key,
      'character_class', v_self.character_class,
      'max_hearts', v_self.max_hearts, 'hearts', v_self.hearts,
      'wave', v_self.wave, 'score', v_self.score,
      'obstacle_points', v_self.obstacle_points,
      'melons_collected', v_self.melons_collected,
      'coins_collected', v_self.melons_collected, 'status', v_self.status
    ),
    'opponent', jsonb_build_object(
      'user_id', v_opponent.user_id, 'username', v_opponent.username,
      'character_key', v_opponent.character_key,
      'character_class', v_opponent.character_class,
      'max_hearts', v_opponent.max_hearts, 'hearts', v_opponent.hearts,
      'wave', v_opponent.wave, 'score', v_opponent.score,
      'obstacle_points', v_opponent.obstacle_points,
      'status', v_opponent.status
    ),
    'pending_attacks', v_attacks
  );
end;
$$;

-- Completing an online match awards both participants from the server's final
-- score snapshot, including a player who disconnects before their UI refreshes.
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
  v_score_ceiling bigint;
  v_credited_score bigint;
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
    select player.user_id, player.score
    from public.multiplayer_players player where player.match_id = new.id
  loop
    v_credited_score := least(greatest(v_player.score, 0), v_score_ceiling);
    v_xp := 30 + floor(v_credited_score::numeric / 100)::bigint;
    insert into public.player_progression_events(
      user_id, source, source_key, xp_awarded, metadata
    ) values (
      v_player.user_id, 'run', new.id::text, v_xp,
      jsonb_build_object(
        'claimed_score', v_player.score, 'credited_score', v_credited_score,
        'scope', new.mode || '_1v1'
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

-- Preserve the legacy all-match Elo tables as an archive. Ranked launches in
-- a clean, season-aware store so old Casual results never affect displayed
-- rating and no historical rows need to be deleted.
create table if not exists public.ranked_1v1_seasons (
  id integer primary key,
  name text not null unique,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  is_active boolean not null default false,
  check (ends_at is null or ends_at > starts_at)
);
create unique index if not exists ranked_1v1_one_active_season_idx
  on public.ranked_1v1_seasons(is_active) where is_active;
insert into public.ranked_1v1_seasons(id, name, is_active)
values (1, 'Season 1', true)
on conflict (id) do nothing;

create table if not exists public.player_ranked_1v1_stats (
  season_id integer not null references public.ranked_1v1_seasons(id),
  user_id uuid not null references auth.users(id) on delete cascade,
  rating integer not null default 1000 check (rating >= 100),
  matches_played bigint not null default 0 check (matches_played >= 0),
  wins bigint not null default 0 check (wins >= 0),
  losses bigint not null default 0 check (losses >= 0),
  draws bigint not null default 0 check (draws >= 0),
  current_streak bigint not null default 0 check (current_streak >= 0),
  best_streak bigint not null default 0 check (best_streak >= 0),
  best_wave integer not null default 1 check (best_wave >= 1),
  best_score bigint not null default 0 check (best_score >= 0),
  coins_collected bigint not null default 0 check (coins_collected >= 0),
  obstacle_points_spent bigint not null default 0
    check (obstacle_points_spent >= 0),
  updated_at timestamptz not null default now(),
  primary key (season_id, user_id),
  check (matches_played = wins + losses + draws),
  check (best_streak >= current_streak)
);

create table if not exists public.ranked_1v1_results (
  season_id integer not null references public.ranked_1v1_seasons(id),
  match_id uuid not null,
  player_one_user_id uuid references auth.users(id) on delete set null,
  player_two_user_id uuid references auth.users(id) on delete set null,
  winner_user_id uuid references auth.users(id) on delete set null,
  player_one_rating_before integer not null,
  player_two_rating_before integer not null,
  player_one_rating_after integer not null,
  player_two_rating_after integer not null,
  recorded_at timestamptz not null default now(),
  primary key (season_id, match_id)
);

create index if not exists player_ranked_1v1_stats_rank_idx
  on public.player_ranked_1v1_stats(
    season_id, rating desc, wins desc, best_wave desc, best_score desc
  );
alter table public.ranked_1v1_seasons enable row level security;
alter table public.player_ranked_1v1_stats enable row level security;
alter table public.ranked_1v1_results enable row level security;
revoke all on table public.ranked_1v1_seasons
  from public, anon, authenticated;
revoke all on table public.player_ranked_1v1_stats
  from public, anon, authenticated;
revoke all on table public.ranked_1v1_results
  from public, anon, authenticated;

-- Even if an older leaderboard migration is accidentally rerun, it cannot
-- insert a Casual match into the legacy result table and then mutate rating.
create or replace function app_private.reject_casual_ranked_result()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mode text;
begin
  select match.mode into v_mode
  from public.multiplayer_matches match where match.id = new.match_id;
  if v_mode is distinct from 'ranked' then return null; end if;
  return new;
end;
$$;

drop trigger if exists reject_casual_ranked_result
  on public.multiplayer_ranked_results;
create trigger reject_casual_ranked_result
before insert on public.multiplayer_ranked_results
for each row execute function app_private.reject_casual_ranked_result();

-- A new, validated legacy result feeds the clean active season exactly once.
create or replace function app_private.apply_ranked_result_to_active_season()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_season_id integer;
  v_one public.player_ranked_1v1_stats%rowtype;
  v_two public.player_ranked_1v1_stats%rowtype;
  v_result_one numeric;
  v_result_two numeric;
  v_expected_one numeric;
  v_expected_two numeric;
  v_rating_one integer;
  v_rating_two integer;
  v_inserted uuid;
begin
  select season.id into v_season_id
  from public.ranked_1v1_seasons season
  where season.is_active and season.starts_at <= new.recorded_at
    and (season.ends_at is null or season.ends_at > new.recorded_at)
  order by season.starts_at desc limit 1;
  if v_season_id is null
     or new.player_one_user_id is null
     or new.player_two_user_id is null then
    return new;
  end if;

  insert into public.player_ranked_1v1_stats(season_id, user_id)
  values
    (v_season_id, new.player_one_user_id),
    (v_season_id, new.player_two_user_id)
  on conflict (season_id, user_id) do nothing;

  perform stats.user_id
  from public.player_ranked_1v1_stats stats
  where stats.season_id = v_season_id
    and stats.user_id in (new.player_one_user_id, new.player_two_user_id)
  order by stats.user_id for update;

  select * into v_one from public.player_ranked_1v1_stats stats
  where stats.season_id = v_season_id
    and stats.user_id = new.player_one_user_id;
  select * into v_two from public.player_ranked_1v1_stats stats
  where stats.season_id = v_season_id
    and stats.user_id = new.player_two_user_id;

  if new.winner_user_id = new.player_one_user_id then
    v_result_one := 1; v_result_two := 0;
  elsif new.winner_user_id = new.player_two_user_id then
    v_result_one := 0; v_result_two := 1;
  else
    v_result_one := 0.5; v_result_two := 0.5;
  end if;
  v_expected_one := 1 / (
    1 + power(10::numeric, (v_two.rating - v_one.rating)::numeric / 400)
  );
  v_expected_two := 1 / (
    1 + power(10::numeric, (v_one.rating - v_two.rating)::numeric / 400)
  );
  v_rating_one := greatest(
    100, v_one.rating + round(32 * (v_result_one - v_expected_one))::integer
  );
  v_rating_two := greatest(
    100, v_two.rating + round(32 * (v_result_two - v_expected_two))::integer
  );

  insert into public.ranked_1v1_results(
    season_id, match_id, player_one_user_id, player_two_user_id,
    winner_user_id, player_one_rating_before, player_two_rating_before,
    player_one_rating_after, player_two_rating_after
  ) values (
    v_season_id, new.match_id, new.player_one_user_id,
    new.player_two_user_id, new.winner_user_id, v_one.rating, v_two.rating,
    v_rating_one, v_rating_two
  )
  on conflict (season_id, match_id) do nothing
  returning match_id into v_inserted;
  if v_inserted is null then return new; end if;

  update public.player_ranked_1v1_stats stats
  set rating = v_rating_one,
      matches_played = stats.matches_played + 1,
      wins = stats.wins + case when v_result_one = 1 then 1 else 0 end,
      losses = stats.losses + case when v_result_one = 0 then 1 else 0 end,
      draws = stats.draws + case when v_result_one = 0.5 then 1 else 0 end,
      current_streak = case when v_result_one = 1
        then stats.current_streak + 1 else 0 end,
      best_streak = greatest(stats.best_streak, case when v_result_one = 1
        then stats.current_streak + 1 else 0 end),
      best_wave = greatest(stats.best_wave, new.player_one_wave),
      best_score = greatest(stats.best_score, new.player_one_score),
      coins_collected = stats.coins_collected + new.player_one_coins,
      obstacle_points_spent = stats.obstacle_points_spent
        + new.player_one_obstacle_points_spent,
      updated_at = now()
  where stats.season_id = v_season_id
    and stats.user_id = new.player_one_user_id;

  update public.player_ranked_1v1_stats stats
  set rating = v_rating_two,
      matches_played = stats.matches_played + 1,
      wins = stats.wins + case when v_result_two = 1 then 1 else 0 end,
      losses = stats.losses + case when v_result_two = 0 then 1 else 0 end,
      draws = stats.draws + case when v_result_two = 0.5 then 1 else 0 end,
      current_streak = case when v_result_two = 1
        then stats.current_streak + 1 else 0 end,
      best_streak = greatest(stats.best_streak, case when v_result_two = 1
        then stats.current_streak + 1 else 0 end),
      best_wave = greatest(stats.best_wave, new.player_two_wave),
      best_score = greatest(stats.best_score, new.player_two_score),
      coins_collected = stats.coins_collected + new.player_two_coins,
      obstacle_points_spent = stats.obstacle_points_spent
        + new.player_two_obstacle_points_spent,
      updated_at = now()
  where stats.season_id = v_season_id
    and stats.user_id = new.player_two_user_id;
  return new;
end;
$$;

drop trigger if exists apply_ranked_result_to_active_season
  on public.multiplayer_ranked_results;
create trigger apply_ranked_result_to_active_season
after insert on public.multiplayer_ranked_results
for each row execute function app_private.apply_ranked_result_to_active_season();

revoke all on function app_private.reject_casual_ranked_result()
  from public, anon, authenticated;
revoke all on function app_private.apply_ranked_result_to_active_season()
  from public, anon, authenticated;

-- Put the original Elo recorder behind a mode-checking private wrapper. This
-- protects against any future internal caller invoking the recorder directly,
-- not just the normal completion trigger.
do $$
begin
  if to_regprocedure(
    'app_private.record_1v1_ranked_result_unchecked(uuid)'
  ) is null then
    if to_regprocedure('app_private.record_1v1_ranked_result(uuid)') is null then
      raise exception 'Install Leaderboard 02 before Player 06 Levels';
    end if;
    alter function app_private.record_1v1_ranked_result(uuid)
      rename to record_1v1_ranked_result_unchecked;
  end if;
end;
$$;

create or replace function app_private.record_1v1_ranked_result(p_match_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mode text;
begin
  select match.mode into v_mode
  from public.multiplayer_matches match where match.id = p_match_id;
  if v_mode is distinct from 'ranked' then return false; end if;
  return app_private.record_1v1_ranked_result_unchecked(p_match_id);
end;
$$;

revoke all on function app_private.record_1v1_ranked_result(uuid)
  from public, anon, authenticated;
revoke all on function app_private.record_1v1_ranked_result_unchecked(uuid)
  from public, anon, authenticated;

-- Only explicitly Ranked matches enter the durable Elo history. Casual match
-- rows remain available to normal live cleanup but never affect rating.
create or replace function app_private.capture_finished_1v1_for_leaderboard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.mode = 'ranked' then
    perform app_private.record_1v1_ranked_result(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists capture_finished_1v1_for_leaderboard
  on public.multiplayer_matches;
create trigger capture_finished_1v1_for_leaderboard
after update of status on public.multiplayer_matches
for each row
when (old.status is distinct from new.status and new.status = 'finished')
execute function app_private.capture_finished_1v1_for_leaderboard();

create or replace function public.get_1v1_leaderboard(
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  rank bigint,
  username text,
  rating integer,
  provisional boolean,
  matches_played bigint,
  wins bigint,
  losses bigint,
  draws bigint,
  win_rate numeric,
  current_streak bigint,
  best_streak bigint,
  best_wave integer,
  best_score bigint,
  coins_collected bigint,
  obstacle_points_spent bigint,
  is_self boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_season_id integer;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'Leaderboard limit must be between 1 and 100';
  end if;
  if p_offset is null or p_offset < 0 or p_offset > 10000 then
    raise exception 'Leaderboard offset must be between 0 and 10000';
  end if;
  select season.id into v_season_id
  from public.ranked_1v1_seasons season
  where season.is_active order by season.starts_at desc limit 1;

  return query
  with eligible as (
    select
      stats.user_id, profile.username, stats.rating, stats.matches_played,
      stats.wins, stats.losses, stats.draws,
      round(stats.wins::numeric * 100 / nullif(stats.matches_played, 0), 1)
        as win_rate,
      stats.current_streak, stats.best_streak, stats.best_wave,
      stats.best_score, stats.coins_collected, stats.obstacle_points_spent
    from public.player_ranked_1v1_stats stats
    join public.player_profiles profile on profile.user_id = stats.user_id
    where stats.season_id = v_season_id and stats.matches_played > 0
      and not app_private.has_active_ban(stats.user_id, 'account', null)
      and not app_private.has_active_ban(stats.user_id, 'leaderboard', null)
  ), ranked as (
    select row_number() over (
      order by eligible.rating desc, eligible.wins desc,
        eligible.win_rate desc, eligible.best_wave desc,
        eligible.best_score desc, lower(eligible.username), eligible.user_id
    ) as rank, eligible.* from eligible
  )
  select ranked.rank, ranked.username, ranked.rating,
    ranked.matches_played < 10, ranked.matches_played, ranked.wins,
    ranked.losses, ranked.draws, ranked.win_rate, ranked.current_streak,
    ranked.best_streak, ranked.best_wave, ranked.best_score,
    ranked.coins_collected, ranked.obstacle_points_spent,
    ranked.user_id = v_uid
  from ranked order by ranked.rank limit p_limit offset p_offset;
end;
$$;

revoke all on function public.join_1v1_queue(text)
  from public, anon, authenticated;
revoke all on function public.join_1v1_queue()
  from public, anon, authenticated;
revoke all on function public.get_1v1_state(uuid)
  from public, anon, authenticated;
revoke all on function public.get_1v1_leaderboard(integer, integer)
  from public, anon, authenticated;
revoke all on function app_private.capture_finished_1v1_for_leaderboard()
  from public, anon, authenticated;
grant execute on function public.join_1v1_queue(text) to authenticated;
grant execute on function public.join_1v1_queue() to authenticated;
grant execute on function public.get_1v1_state(uuid) to authenticated;
grant execute on function public.get_1v1_leaderboard(integer, integer)
  to authenticated;

notify pgrst, 'reload schema';
commit;

-- Visible rerun checks.
select
  to_regprocedure('public.get_player_progression()') is not null
    as progression_rpc_installed,
  to_regprocedure('public.award_completed_run(uuid,bigint,text)') is not null
    as run_xp_rpc_installed,
  coalesce(not has_function_privilege(
    'authenticated', to_regprocedure(
      'public.save_player_high_score(bigint)'
    ), 'EXECUTE'
  ), true) and coalesce(not has_function_privilege(
    'anon', to_regprocedure(
      'public.save_player_high_score(bigint)'
    ), 'EXECUTE'
  ), true) as direct_high_score_saving_blocked,
  has_function_privilege(
    'authenticated', 'public.claim_player_gem(uuid,text)', 'EXECUTE'
  ) and not has_function_privilege(
    'authenticated', 'public.increment_player_gems()', 'EXECUTE'
  ) as receipt_backed_gems_installed,
  has_function_privilege(
    'authenticated',
    'public.award_1v1_points(uuid,text,integer,text)', 'EXECUTE'
  ) and not has_function_privilege(
    'anon', 'public.award_1v1_points(uuid,text,integer,text)', 'EXECUTE'
  ) and coalesce(not has_function_privilege(
    'authenticated',
    to_regprocedure('public.award_1v1_points(uuid,text,integer)'), 'EXECUTE'
  ), true) as receipt_only_coin_rpc,
  position(
    'Coin pickup allowance reached' in pg_get_functiondef(
      to_regprocedure('public.award_1v1_points(uuid,text,integer,text)')
    )
  ) > 0 as coin_rate_limits_installed,
  position(
    'Gem pickups arrived too quickly' in pg_get_functiondef(
      to_regprocedure('public.claim_player_gem(uuid,text)')
    )
  ) > 0 as gem_spawn_envelope_installed,
  position(
    'short_run_throttled' in pg_get_functiondef(
      to_regprocedure('public.award_completed_run(uuid,bigint,text)')
    )
  ) > 0 as rapid_short_run_xp_throttled,
  to_regprocedure('public.join_1v1_queue(text)') is not null
    as mode_matchmaking_installed,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'multiplayer_matches'
      and column_name = 'mode'
  ) as match_mode_installed,
  to_regclass('public.player_ranked_1v1_stats') is not null
    and to_regclass('public.ranked_1v1_results') is not null
    as clean_ranked_season_installed,
  exists (
    select 1
    from pg_trigger trigger_row
    join pg_class relation on relation.oid = trigger_row.tgrelid
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'multiplayer_matches'
      and trigger_row.tgname = 'capture_finished_1v1_for_leaderboard'
      and trigger_row.tgfoid = to_regprocedure(
        'app_private.capture_finished_1v1_for_leaderboard()'
      )
      and trigger_row.tgenabled <> 'D'
      and not trigger_row.tgisinternal
  ) as ranked_capture_trigger_enabled,
  position(
    'server play-time allowance' in pg_get_functiondef(
      to_regprocedure('app_private.enforce_1v1_score_ceiling()')
    )
  ) > 0 as score_write_ceiling_installed,
  position(
    'sqrt(30625' in pg_get_functiondef(
      to_regprocedure('app_private.apply_player_xp(uuid,bigint,boolean)')
    )
  ) > 0 as bounded_xp_math_installed,
  not has_table_privilege(
    'authenticated', 'public.player_progression_events', 'SELECT'
  ) as progression_ledger_private;
