-- Player 08 Reported Economy + Progression
--
-- Rerunnable forward migration for the September 7 player reports:
--   * Endless-only XP is score^2 / 4 plus 100,000 per collected gem.
--   * Levels start at zero and level L starts at 5,000,000 * L * (L + 1).
--   * Ranked unlocks at level 20 (2.1B cumulative XP).
--   * A Normal pull costs 3 gems and a ten-pull costs 30 gems. Duplicates
--     refund 1/1/1/1/2/3 gems from Common through Mythic.
--   * Any unowned active catalog item can be bought directly at the reported
--     rarity price through a server-owned RPC.
--   * Endless gem pickups award a hitless-wave streak of 1, 2, 3, ... gems.
--   * Default player, obstacle, and environment visuals can be re-equipped.
--
-- This migration does not update map rules or any Tank catalog/rule row.

begin;

do $$
begin
  if to_regclass('public.player_stats') is null
     or to_regclass('public.player_progression_events') is null
     or to_regclass('public.player_progression_runs') is null
     or to_regclass('public.player_unlocks') is null
     or to_regclass('public.player_loadouts') is null
     or to_regclass('public.extraction_catalog') is null
     or to_regclass('public.extraction_transactions') is null
     or to_regprocedure('public.extract_items(integer,text)') is null
     or to_regprocedure('public.claim_player_gem(uuid,text)') is null
     or to_regprocedure(
       'public.award_completed_run_v2(uuid,bigint,text)'
     ) is null then
    raise exception 'Run the current Player 01, Player 07, and Leaderboard 02 migrations first';
  end if;
end
$$;

-- Prove this migration leaves every Tank catalog row and every map rule
-- byte-for-byte unchanged.
create temporary table player_08_preserved_tank_rows(
  item_key text primary key,
  row_data jsonb not null
) on commit drop;
insert into player_08_preserved_tank_rows(item_key,row_data)
select catalog.item_key,to_jsonb(catalog)
from public.extraction_catalog catalog
where catalog.item_type='character' and catalog.character_class='tank';

create temporary table player_08_preserved_map_rows(
  map_key text primary key,
  row_data jsonb not null
) on commit drop;
do $player_08_snapshot_maps$
begin
  if to_regclass('app_private.one_v_one_map_rules') is not null then
    execute $sql$
      insert into player_08_preserved_map_rows(map_key,row_data)
      select map_key,to_jsonb(rules)
      from app_private.one_v_one_map_rules rules
    $sql$;
  end if;
end
$player_08_snapshot_maps$;

-- XP receipts are retained even when a source awards zero XP. This preserves
-- exact pickup idempotency while removing gem and 1v1 XP sources.
alter table public.player_progression_events
  drop constraint if exists player_progression_events_xp_awarded_check;
alter table public.player_progression_events
  add constraint player_progression_events_xp_awarded_check
  check(xp_awarded>=0) not valid;
alter table public.player_progression_events
  validate constraint player_progression_events_xp_awarded_check;

alter table public.player_stats
  alter column level set default 0;
alter table public.player_stats
  drop constraint if exists player_stats_level_check;
alter table public.player_stats
  add constraint player_stats_level_check check(level>=0) not valid;
alter table public.player_stats validate constraint player_stats_level_check;

create or replace function app_private.cumulative_xp_for_level(
  p_level integer
)
returns bigint
language sql
immutable
strict
set search_path=''
as $$
  select case
    when p_level<=0 then 0::bigint
    else (
      5000000::numeric*p_level::numeric*(p_level::numeric+1)
    )::bigint
  end;
$$;

-- The UI's xp_required value is the amount needed within the current level,
-- not a cumulative threshold.
create or replace function app_private.xp_required_for_level(
  p_level integer
)
returns bigint
language sql
immutable
strict
set search_path=''
as $$
  select 10000000::bigint*(greatest(p_level,0)::bigint+1);
$$;

create or replace function app_private.level_for_lifetime_xp(
  p_lifetime_xp bigint
)
returns integer
language sql
immutable
strict
set search_path=''
as $$
  select floor(
    (
      sqrt(
        1::numeric
        +4::numeric*greatest(p_lifetime_xp,0)::numeric/5000000::numeric
      )-1::numeric
    )/2::numeric
  )::integer;
$$;

create or replace function app_private.apply_player_xp(
  p_user_id uuid,
  p_amount bigint,
  p_completed_run boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_level integer;
  v_xp bigint;
  v_lifetime bigint;
  v_runs bigint;
  v_level_start bigint;
begin
  if p_user_id is null or p_amount is null or p_amount<0
     or p_amount>700000000000000::bigint then
    raise exception 'Invalid XP award';
  end if;

  insert into public.player_stats(user_id,total_gems,high_score,updated_at)
  values(p_user_id,0,0,now())
  on conflict(user_id) do nothing;

  select lifetime_xp,completed_runs
  into v_lifetime,v_runs
  from public.player_stats
  where user_id=p_user_id
  for update;

  if v_lifetime>9223372036854775807::bigint-p_amount then
    raise exception 'Lifetime XP exceeds the supported range';
  end if;
  v_lifetime:=v_lifetime+p_amount;
  v_level:=app_private.level_for_lifetime_xp(v_lifetime);
  v_level_start:=app_private.cumulative_xp_for_level(v_level);
  v_xp:=v_lifetime-v_level_start;
  v_runs:=v_runs+case when p_completed_run then 1 else 0 end;

  update public.player_stats
  set level=v_level,
      xp_in_level=v_xp,
      lifetime_xp=v_lifetime,
      completed_runs=v_runs,
      updated_at=now()
  where user_id=p_user_id;

  return jsonb_build_object(
    'level',v_level,
    'xp',v_xp,
    'xp_required',app_private.xp_required_for_level(v_level),
    'lifetime_xp',v_lifetime,
    'completed_runs',v_runs,
    'ranked_unlocked',v_level>=20,
    'xp_awarded',p_amount
  );
end;
$$;

create or replace function public.get_player_progression()
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();
  v_stats public.player_stats%rowtype;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  insert into public.player_stats(user_id,total_gems,high_score,updated_at)
  values(v_uid,0,0,now()) on conflict(user_id) do nothing;
  select * into v_stats from public.player_stats where user_id=v_uid;
  return jsonb_build_object(
    'level',v_stats.level,
    'xp',v_stats.xp_in_level,
    'xp_required',app_private.xp_required_for_level(v_stats.level),
    'lifetime_xp',v_stats.lifetime_xp,
    'completed_runs',v_stats.completed_runs,
    'ranked_unlocked',v_stats.level>=20
  );
end;
$$;

-- Private, per-run hitless-wave state. A wave change is also detected from
-- the server-verified progression receipt, so a forgotten client reset cannot
-- carry a streak between waves.
create table if not exists public.player_endless_gem_streaks(
  run_id uuid primary key references public.player_progression_runs(run_id)
    on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  wave integer not null check(wave between 1 and 100000),
  streak bigint not null default 0 check(streak>=0),
  updated_at timestamptz not null default now()
);
create index if not exists player_endless_gem_streaks_user_idx
  on public.player_endless_gem_streaks(user_id,updated_at desc);
alter table public.player_endless_gem_streaks enable row level security;
revoke all on table public.player_endless_gem_streaks
  from public,anon,authenticated;

create or replace function public.reset_endless_gem_streak(
  p_run_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();
  v_wave integer;
  v_last_heartbeat timestamptz;
  v_active boolean;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  if p_run_id is null then raise exception 'Run ID is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text,1));

  select verified_wave,last_heartbeat_at,heartbeat_active
  into v_wave,v_last_heartbeat,v_active
  from public.player_progression_runs
  where run_id=p_run_id and user_id=v_uid
    and completed_at is null
    and started_at>now()-interval '6 hours'
  for update;
  if not found then raise exception 'Active Endless run not found'; end if;
  if not coalesce(v_active,false)
     or v_last_heartbeat is null
     or v_last_heartbeat<clock_timestamp()-interval '8 seconds' then
    raise exception 'Streak reset requires active Endless play';
  end if;

  insert into public.player_endless_gem_streaks(
    run_id,user_id,wave,streak,updated_at
  ) values(p_run_id,v_uid,v_wave,0,now())
  on conflict(run_id) do update
  set user_id=excluded.user_id,
      wave=excluded.wave,
      streak=0,
      updated_at=now()
  where public.player_endless_gem_streaks.user_id=excluded.user_id;

  return jsonb_build_object(
    'run_id',p_run_id,
    'wave',v_wave,
    'streak',0,
    'reset',true
  );
end;
$$;

-- Compatibility signature retained. Endless pickups use the hitless-wave
-- currency streak; 1v1 pickups remain one gem. No pickup grants XP.
create or replace function public.claim_player_gem(
  p_context_id uuid,
  p_pickup_id text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();
  v_pickup_id text:=trim(p_pickup_id);
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
  v_now timestamptz;
  v_stored_metadata jsonb;
  v_stored_wave integer;
  v_stored_streak bigint;
  v_streak bigint:=1;
  v_gems_awarded bigint:=1;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  if p_context_id is null or v_pickup_id is null
     or length(v_pickup_id) not between 1 and 120 then
    raise exception 'Valid gem context and pickup ID are required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text,1));

  select event.metadata
  into v_stored_metadata
  from public.player_progression_events event
  where event.user_id=v_uid and event.source='gem'
    and event.source_key=p_context_id::text||':'||v_pickup_id;
  if found then
    select total_gems into v_total
    from public.player_stats where user_id=v_uid;
    return jsonb_build_object(
      'total_gems',coalesce(v_total,0),
      'gems_awarded',coalesce(
        (v_stored_metadata->>'gems_awarded')::bigint,1
      ),
      'streak',coalesce((v_stored_metadata->>'streak')::bigint,1),
      'streak_wave',coalesce(
        (v_stored_metadata->>'streak_wave')::integer,
        (v_stored_metadata->>'verified_wave')::integer
      ),
      'is_new',false,
      'progression',public.get_player_progression()
    );
  end if;

  select active_seconds,verified_wave,last_heartbeat_at,heartbeat_active
  into v_active_seconds,v_verified_wave,v_last_heartbeat,v_heartbeat_active
  from public.player_progression_runs
  where run_id=p_context_id and user_id=v_uid and completed_at is null
    and started_at>now()-interval '6 hours'
  for update;
  if found then
    v_context_type:='endless';
    v_now:=clock_timestamp();
    if not coalesce(v_heartbeat_active,false)
       or v_last_heartbeat is null
       or v_last_heartbeat<v_now-interval '8 seconds' then
      raise exception 'Gem collection requires active play';
    end if;
  else
    select match_row.status,player.status
    into v_match_status,v_player_status
    from public.multiplayer_matches match_row
    join public.multiplayer_players player
      on player.match_id=match_row.id and player.user_id=v_uid
    where match_row.id=p_context_id
      and match_row.started_at>now()-interval '6 hours'
    for update of match_row,player;
    if not found or v_match_status<>'playing'
       or v_player_status<>'playing' then
      raise exception 'Gem context is not active';
    end if;
    select active_seconds,verified_wave,last_heartbeat_at,heartbeat_active
    into v_active_seconds,v_verified_wave,v_last_heartbeat,v_heartbeat_active
    from public.player_progression_1v1_activity
    where match_id=p_context_id and user_id=v_uid
    for update;
    if not found then
      raise exception 'Gem collection requires active 1v1 play';
    end if;
    v_now:=clock_timestamp();
    if not coalesce(v_heartbeat_active,false)
       or v_last_heartbeat is null
       or v_last_heartbeat<v_now-interval '8 seconds' then
      raise exception 'Gem collection requires active 1v1 play';
    end if;
    v_context_type:='1v1';
  end if;

  v_active_seconds:=least(
    21600::bigint,greatest(0::bigint,coalesce(v_active_seconds,0))
  );
  v_verified_wave:=least(100000,greatest(1,coalesce(v_verified_wave,1)));
  v_time_allowance:=2+floor(v_active_seconds::numeric/0.75)::bigint;
  v_wave_allowance:=2+v_verified_wave::bigint*60;
  v_allowed:=least(v_time_allowance,v_wave_allowance);

  insert into public.player_stats(user_id,total_gems,high_score,updated_at)
  values(v_uid,0,0,now()) on conflict(user_id) do nothing;

  select count(*) into v_claimed
  from public.player_progression_events
  where user_id=v_uid and source='gem'
    and metadata->>'context_id'=p_context_id::text;
  if v_context_type='1v1' then
    select v_claimed+count(*) into v_claimed
    from public.multiplayer_point_events
    where match_id=p_context_id and user_id=v_uid;
  end if;
  if v_claimed>=v_allowed then raise exception 'Gem claim limit reached'; end if;

  select count(*) into v_recent_claims
  from public.player_progression_events
  where user_id=v_uid and source='gem'
    and created_at>v_now-interval '1 second';
  if v_context_type='1v1' then
    select v_recent_claims+count(*) into v_recent_claims
    from public.multiplayer_point_events
    where user_id=v_uid and created_at>v_now-interval '1 second';
  end if;
  if v_recent_claims>=3 then
    raise exception 'Gem pickups arrived too quickly';
  end if;

  if v_context_type='endless' then
    select streak_row.wave,streak_row.streak
    into v_stored_wave,v_stored_streak
    from public.player_endless_gem_streaks streak_row
    where streak_row.run_id=p_context_id and streak_row.user_id=v_uid
    for update;
    if not found then
      select count(*)::bigint into v_stored_streak
      from public.player_progression_events event
      where event.user_id=v_uid and event.source='gem'
        and event.metadata->>'context_id'=p_context_id::text
        and event.metadata->>'context_type'='endless'
        and coalesce(
          (event.metadata->>'streak_wave')::integer,
          (event.metadata->>'verified_wave')::integer
        )=v_verified_wave;
      v_stored_wave:=v_verified_wave;
    end if;
    v_streak:=case when v_stored_wave=v_verified_wave
      then greatest(coalesce(v_stored_streak,0),0)+1 else 1 end;
    v_gems_awarded:=v_streak;
  else
    v_streak:=1;
    v_gems_awarded:=1;
  end if;

  insert into public.player_progression_events(
    user_id,source,source_key,xp_awarded,metadata
  ) values(
    v_uid,'gem',p_context_id::text||':'||v_pickup_id,0,
    jsonb_build_object(
      'context_id',p_context_id,
      'context_type',v_context_type,
      'pickup_id',v_pickup_id,
      'verified_active_seconds',v_active_seconds,
      'verified_wave',v_verified_wave,
      'streak_wave',v_verified_wave,
      'streak',v_streak,
      'gems_awarded',v_gems_awarded
    )
  ) on conflict(user_id,source,source_key) do nothing
  returning id into v_inserted;

  if v_inserted is null then
    select event.metadata into v_stored_metadata
    from public.player_progression_events event
    where event.user_id=v_uid and event.source='gem'
      and event.source_key=p_context_id::text||':'||v_pickup_id;
    select total_gems into v_total
    from public.player_stats where user_id=v_uid;
    return jsonb_build_object(
      'total_gems',coalesce(v_total,0),
      'gems_awarded',coalesce(
        (v_stored_metadata->>'gems_awarded')::bigint,1
      ),
      'streak',coalesce((v_stored_metadata->>'streak')::bigint,1),
      'streak_wave',coalesce(
        (v_stored_metadata->>'streak_wave')::integer,
        (v_stored_metadata->>'verified_wave')::integer
      ),
      'is_new',false,
      'progression',public.get_player_progression()
    );
  end if;

  if v_context_type='endless' then
    insert into public.player_endless_gem_streaks(
      run_id,user_id,wave,streak,updated_at
    ) values(p_context_id,v_uid,v_verified_wave,v_streak,now())
    on conflict(run_id) do update
    set user_id=excluded.user_id,
        wave=excluded.wave,
        streak=excluded.streak,
        updated_at=now()
    where public.player_endless_gem_streaks.user_id=excluded.user_id;
  end if;

  update public.player_stats
  set total_gems=total_gems+v_gems_awarded,
      updated_at=now()
  where user_id=v_uid
  returning total_gems into v_total;

  return jsonb_build_object(
    'total_gems',v_total,
    'gems_awarded',v_gems_awarded,
    'streak',v_streak,
    'streak_wave',v_verified_wave,
    'is_new',true,
    'progression',public.get_player_progression()
  );
end;
$$;

-- The legacy no-receipt helper remains uncallable by browser roles and no
-- longer contains a hidden XP source if invoked by trusted maintenance code.
create or replace function public.increment_player_gems()
returns bigint
language plpgsql
security definer
set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();
  v_total bigint;
  v_last_claim timestamptz;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  insert into public.player_stats(user_id,total_gems,high_score,updated_at)
  values(v_uid,0,0,now()) on conflict(user_id) do nothing;
  select last_gem_claim_at into v_last_claim
  from public.player_stats where user_id=v_uid for update;
  if v_last_claim is not null
     and v_last_claim>clock_timestamp()-interval '250 milliseconds' then
    raise exception 'Gem pickup arrived too quickly';
  end if;
  update public.player_stats
  set total_gems=total_gems+1,
      last_gem_claim_at=clock_timestamp(),
      updated_at=now()
  where user_id=v_uid
  returning total_gems into v_total;
  return v_total;
end;
$$;

create or replace function app_private.endless_run_xp_breakdown(
  p_score bigint,
  p_gem_count bigint
)
returns jsonb
language sql
immutable
strict
set search_path=''
as $$
  with awards as(
    select floor(
      greatest(p_score,0)::numeric*greatest(p_score,0)::numeric/4::numeric
    )::bigint as score_xp,
    greatest(p_gem_count,0)*100000::bigint as gem_xp
  )
  select jsonb_build_object(
    'score',score_xp,
    'gems',gem_xp,
    'gem_count',greatest(p_gem_count,0),
    'total',score_xp+gem_xp
  ) from awards;
$$;

-- Existing API signature retained. Only Endless produces XP. The accepted
-- score is capped by verified active play; gem XP is counted from unique,
-- receipt-backed Endless pickups rather than a browser-supplied count.
create or replace function public.award_completed_run_v2(
  p_run_id uuid,
  p_score bigint,
  p_scope text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();
  v_scope text:=lower(trim(p_scope));
  v_inserted uuid;
  v_score bigint;
  v_started_at timestamptz;
  v_completed_at timestamptz;
  v_stored_score bigint;
  v_high_score bigint;
  v_active_seconds bigint;
  v_last_heartbeat timestamptz;
  v_heartbeat_active boolean;
  v_final_increment bigint:=0;
  v_gem_count bigint:=0;
  v_xp bigint;
  v_breakdown jsonb;
  v_existing_breakdown jsonb;
  v_progress jsonb;
  v_match_status text;
  v_match_mode text;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  if p_run_id is null then raise exception 'Run ID is required'; end if;
  if p_score is null or p_score<0 or p_score>1000000000 then
    raise exception 'Invalid run score';
  end if;
  if v_scope not in('endless','casual_1v1','ranked_1v1') then
    raise exception 'Invalid run type';
  end if;

  if v_scope<>'endless' then
    select match_row.status,match_row.mode
    into v_match_status,v_match_mode
    from public.multiplayer_matches match_row
    join public.multiplayer_players player
      on player.match_id=match_row.id and player.user_id=v_uid
    where match_row.id=p_run_id;
    if v_match_status is null then raise exception '1v1 result not found'; end if;
    if v_match_status<>'finished' then raise exception '1v1 is not finished'; end if;
    if v_scope<>(v_match_mode||'_1v1') then
      raise exception '1v1 mode does not match the finished result';
    end if;
    select high_score into v_high_score
    from public.player_stats where user_id=v_uid;
    return public.get_player_progression()||jsonb_build_object(
      'xp_awarded',0,
      'xp_breakdown',jsonb_build_object(
        'score',0,'gems',0,'gem_count',0,'total',0
      ),
      'high_score',coalesce(v_high_score,0)
    );
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_uid::text,0));
  select started_at,completed_at,credited_score,active_seconds,
         last_heartbeat_at,heartbeat_active
  into v_started_at,v_completed_at,v_stored_score,v_active_seconds,
       v_last_heartbeat,v_heartbeat_active
  from public.player_progression_runs
  where run_id=p_run_id and user_id=v_uid
  for update;
  if v_started_at is null then raise exception 'Run receipt not found'; end if;

  if v_completed_at is not null then
    select metadata->'xp_breakdown'
    into v_existing_breakdown
    from public.player_progression_events
    where user_id=v_uid and source='run'
      and source_key=p_run_id::text;
    select high_score into v_high_score
    from public.player_stats where user_id=v_uid;
    return public.get_player_progression()||jsonb_build_object(
      'xp_awarded',0,
      'xp_breakdown',v_existing_breakdown,
      'high_score',coalesce(v_high_score,0)
    );
  end if;

  if coalesce(v_heartbeat_active,false) then
    v_final_increment:=least(
      6::bigint,
      greatest(
        0::bigint,
        floor(extract(epoch from(
          clock_timestamp()-coalesce(v_last_heartbeat,clock_timestamp())
        )))::bigint
      )
    );
  end if;
  v_active_seconds:=least(
    21600::bigint,
    greatest(coalesce(v_active_seconds,0),0)+v_final_increment,
    greatest(
      0::bigint,
      floor(extract(epoch from(clock_timestamp()-v_started_at)))::bigint
    )
  );
  v_score:=least(
    p_score,
    v_active_seconds*2000::bigint,
    50000000::bigint
  );

  update public.player_progression_runs
  set completed_at=now(),
      claimed_score=p_score,
      credited_score=v_score,
      active_seconds=v_active_seconds,
      heartbeat_active=false
  where run_id=p_run_id;

  select count(*)::bigint into v_gem_count
  from public.player_progression_events event
  where event.user_id=v_uid and event.source='gem'
    and event.metadata->>'context_id'=p_run_id::text
    and event.metadata->>'context_type'='endless';

  v_breakdown:=app_private.endless_run_xp_breakdown(v_score,v_gem_count);
  v_xp:=(v_breakdown->>'total')::bigint;

  insert into public.player_stats(user_id,total_gems,high_score,updated_at)
  values(v_uid,0,v_score,now()) on conflict(user_id) do nothing;
  update public.player_stats
  set high_score=greatest(high_score,v_score),updated_at=now()
  where user_id=v_uid
  returning high_score into v_high_score;

  insert into public.player_progression_events(
    user_id,source,source_key,xp_awarded,metadata
  ) values(
    v_uid,'run',p_run_id::text,v_xp,
    jsonb_build_object(
      'claimed_score',p_score,
      'credited_score',v_score,
      'scope','endless',
      'active_seconds',v_active_seconds,
      'gem_count',v_gem_count,
      'xp_breakdown',v_breakdown
    )
  ) on conflict(user_id,source,source_key) do nothing
  returning id into v_inserted;

  if v_inserted is not null then
    v_progress:=app_private.apply_player_xp(v_uid,v_xp,true);
    return v_progress||jsonb_build_object(
      'xp_breakdown',v_breakdown,
      'high_score',v_high_score
    );
  end if;

  select metadata->'xp_breakdown' into v_existing_breakdown
  from public.player_progression_events
  where user_id=v_uid and source='run'
    and source_key=p_run_id::text;
  return public.get_player_progression()||jsonb_build_object(
    'xp_awarded',0,
    'xp_breakdown',v_existing_breakdown,
    'high_score',v_high_score
  );
end;
$$;

create or replace function public.award_completed_run(
  p_run_id uuid,
  p_score bigint,
  p_scope text
)
returns jsonb
language sql
security invoker
set search_path=''
as $$
  select public.award_completed_run_v2(p_run_id,p_score,p_scope);
$$;

-- Remove every 1v1 XP path. The activity heartbeat remains because secure
-- pickup validation still uses it.
drop trigger if exists award_xp_for_1v1_coin
  on public.multiplayer_point_events;
drop trigger if exists award_finished_1v1_progression
  on public.multiplayer_matches;

-- Recalculate the receipt ledger and permanent totals so rerunning this file
-- is idempotent and previously awarded gem/coin/1v1 XP does not survive the
-- corrected source rules.
with endless_gems as(
  select event.user_id,event.metadata->>'context_id' as context_id,
         count(*)::bigint as gem_count
  from public.player_progression_events event
  where event.source='gem'
    and event.metadata->>'context_type'='endless'
    and nullif(event.metadata->>'context_id','') is not null
  group by event.user_id,event.metadata->>'context_id'
), recalculated as(
  select event.id,
    least(
      case
        when coalesce(event.metadata->>'credited_score','')~'^[0-9]{1,18}$'
          then (event.metadata->>'credited_score')::numeric
        when coalesce(event.metadata->>'claimed_score','')~'^[0-9]{1,18}$'
          then (event.metadata->>'claimed_score')::numeric
        else 0::numeric
      end,
      50000000::numeric
    ) as credited_score,
    coalesce(endless_gems.gem_count,0) as gem_count
  from public.player_progression_events event
  left join endless_gems
    on endless_gems.user_id=event.user_id
   and endless_gems.context_id=event.source_key
  where event.source='run' and event.metadata->>'scope'='endless'
), breakdowns as(
  select recalculated.id,
    app_private.endless_run_xp_breakdown(
      recalculated.credited_score::bigint,recalculated.gem_count
    ) as breakdown
  from recalculated
)
update public.player_progression_events event
set xp_awarded=(breakdowns.breakdown->>'total')::bigint,
    metadata=event.metadata||jsonb_build_object(
      'credited_score',(
        select recalculated.credited_score::bigint
        from recalculated where recalculated.id=event.id
      ),
      'gem_count',(
        select recalculated.gem_count
        from recalculated where recalculated.id=event.id
      ),
      'xp_breakdown',breakdowns.breakdown
    )
from breakdowns
where event.id=breakdowns.id;

update public.player_progression_events
set xp_awarded=0
where source in('gem','coin')
   or (source='run' and coalesce(metadata->>'scope','')<>'endless');

with corrected as(
  select stats.user_id,
    coalesce(sum(event.xp_awarded),0)::bigint as lifetime_xp,
    count(*) filter(
      where event.source='run' and event.metadata->>'scope'='endless'
    )::bigint as completed_runs
  from public.player_stats stats
  left join public.player_progression_events event
    on event.user_id=stats.user_id
  group by stats.user_id
), leveled as(
  select corrected.*,
    app_private.level_for_lifetime_xp(corrected.lifetime_xp) as level
  from corrected
)
update public.player_stats stats
set lifetime_xp=leveled.lifetime_xp,
    level=leveled.level,
    xp_in_level=leveled.lifetime_xp
      -app_private.cumulative_xp_for_level(leveled.level),
    completed_runs=leveled.completed_runs,
    updated_at=now()
from leveled
where stats.user_id=leveled.user_id
  and (
    stats.lifetime_xp is distinct from leveled.lifetime_xp
    or stats.level is distinct from leveled.level
    or stats.xp_in_level is distinct from (
      leveled.lifetime_xp
      -app_private.cumulative_xp_for_level(leveled.level)
    )
    or stats.completed_runs is distinct from leveled.completed_runs
  );

-- Shop ledger extensions. gem_cost remains the gross paid price per item;
-- refund_amount records the duplicate credit, so historical receipts need no
-- rewrite and direct purchases share the same ownership proof ledger.
alter table public.extraction_transactions
  drop constraint if exists extraction_transactions_box_type_check,
  drop constraint if exists extraction_transactions_refund_amount_check;
alter table public.extraction_transactions
  add column if not exists refund_amount integer not null default 0;
alter table public.extraction_transactions
  add constraint extraction_transactions_box_type_check
    check(box_type in('regular','legendary','direct')) not valid,
  add constraint extraction_transactions_refund_amount_check
    check(refund_amount>=0 and refund_amount<=gem_cost) not valid;
alter table public.extraction_transactions
  validate constraint extraction_transactions_box_type_check;
alter table public.extraction_transactions
  validate constraint extraction_transactions_refund_amount_check;

create or replace function app_private.duplicate_gem_refund(
  p_rarity text
)
returns integer
language sql
immutable
strict
set search_path=''
as $$
  select case lower(p_rarity)
    when 'legendary' then 2
    when 'mythic' then 3
    when 'common' then 1
    when 'uncommon' then 1
    when 'rare' then 1
    when 'epic' then 1
    else null
  end;
$$;

create or replace function app_private.direct_catalog_price(
  p_rarity text
)
returns integer
language sql
immutable
strict
set search_path=''
as $$
  select case lower(p_rarity)
    when 'common' then 5
    when 'uncommon' then 10
    when 'rare' then 15
    when 'epic' then 25
    when 'legendary' then 300
    when 'mythic' then 2000
    else null
  end;
$$;

drop function if exists public.extract_items(integer);
create or replace function public.extract_items(
  pull_count integer,
  box_type text default 'regular'
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();
  v_box text:=lower(trim(coalesce(box_type,'')));
  v_item_cost constant integer:=3;
  v_max_box_quantity constant integer:=100;
  v_items_per_box integer;
  v_box_cost integer;
  v_total_pulls integer;
  v_gross_cost bigint;
  v_balance_before bigint;
  v_gems bigint;
  v_pull integer;
  v_draw_profile text;
  v_category text;
  v_rarity text;
  v_item_key text;
  v_item_type text;
  v_display_name text;
  v_character_class text;
  v_is_new boolean;
  v_inserted integer;
  v_refund integer;
  v_total_refund bigint:=0;
  v_results jsonb:='[]'::jsonb;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  if v_box='legendary' then
    raise exception 'Standalone Legendary Boxes are no longer available';
  end if;
  if v_box not in('regular','ten') then
    raise exception 'Box type must be regular or ten';
  end if;
  if pull_count is null or pull_count<1 then
    raise exception 'Choose at least 1 box';
  end if;
  if pull_count>v_max_box_quantity then
    raise exception 'Choose no more than % boxes at once',v_max_box_quantity;
  end if;

  v_items_per_box:=case when v_box='ten' then 10 else 1 end;
  v_box_cost:=v_items_per_box*v_item_cost;
  v_total_pulls:=pull_count*v_items_per_box;
  v_gross_cost:=v_total_pulls::bigint*v_item_cost::bigint;

  insert into public.player_stats(user_id,total_gems,high_score,updated_at)
  values(v_uid,0,0,now()) on conflict(user_id) do nothing;
  select total_gems into v_gems
  from public.player_stats where user_id=v_uid for update;
  if v_gems<v_gross_cost then raise exception 'Not enough gems'; end if;

  for v_pull in 1..v_total_pulls loop
    v_balance_before:=v_gems;
    v_gems:=v_gems-v_item_cost;
    v_draw_profile:=case when mod(v_pull,10)=0
      then 'legendary' else 'regular' end;
    v_rarity:=null;
    v_item_key:=null;
    v_item_type:=null;
    v_display_name:=null;
    v_character_class:=null;

    v_category:=case
      when random()<case when v_draw_profile='legendary'
        then 0.20 else 0.05 end
      then 'character' else 'cosmetic' end;
    if not exists(
      select 1 from public.extraction_catalog catalog
      where catalog.active and catalog.extractable
        and (
          (v_category='character' and catalog.item_type='character')
          or (v_category='cosmetic' and catalog.item_type<>'character')
        )
    ) then
      v_category:=case when v_category='character'
        then 'cosmetic' else 'character' end;
    end if;

    with weights(rarity,weight,sort_order) as(values
      ('common',case when v_draw_profile='legendary'
        then 3.00 else 45.75 end::numeric,1),
      ('uncommon',case when v_draw_profile='legendary'
        then 12.00 else 30.20 end::numeric,2),
      ('rare',case when v_draw_profile='legendary'
        then 40.30 else 15.40 end::numeric,3),
      ('epic',case when v_draw_profile='legendary'
        then 41.50 else 8.00 end::numeric,4),
      ('legendary',case when v_draw_profile='legendary'
        then 3.00 else 1.00 end::numeric,5),
      ('mythic',case when v_draw_profile='legendary'
        then 0.20 else 0.01 end::numeric,6)
    ), available as(
      select weights.rarity,weights.weight,weights.sort_order
      from weights
      where exists(
        select 1 from public.extraction_catalog catalog
        where catalog.active and catalog.extractable
          and catalog.rarity=weights.rarity
          and (
            (v_category='character' and catalog.item_type='character')
            or (v_category='cosmetic' and catalog.item_type<>'character')
          )
      )
    ), total as(
      select sum(available.weight) as weight from available
    ), draw as(
      select random()*total.weight::double precision as value from total
    ), cumulative as(
      select available.rarity,available.sort_order,
        sum(available.weight) over(order by available.sort_order)
          ::double precision as ceiling
      from available
    )
    select cumulative.rarity into v_rarity
    from cumulative cross join draw
    where draw.value<cumulative.ceiling
    order by cumulative.sort_order limit 1;
    if v_rarity is null then
      raise exception 'No extraction item is available for this box';
    end if;

    select catalog.item_key,catalog.item_type,catalog.display_name,
           catalog.character_class
    into v_item_key,v_item_type,v_display_name,v_character_class
    from public.extraction_catalog catalog
    where catalog.active and catalog.extractable
      and catalog.rarity=v_rarity
      and (
        (v_category='character' and catalog.item_type='character')
        or (v_category='cosmetic' and catalog.item_type<>'character')
      )
    order by random() limit 1;
    if v_item_key is null then
      raise exception 'No extraction item is available for this rarity';
    end if;

    insert into public.player_unlocks(
      user_id,item_key,item_type,rarity,unlocked_at
    ) values(v_uid,v_item_key,v_item_type,v_rarity,now())
    on conflict(user_id,item_key) do nothing;
    get diagnostics v_inserted=row_count;
    v_is_new:=v_inserted=1;
    v_refund:=case when v_is_new then 0
      else app_private.duplicate_gem_refund(v_rarity) end;
    v_total_refund:=v_total_refund+v_refund;
    v_gems:=v_gems+v_refund;

    insert into public.extraction_transactions(
      user_id,box_type,gem_cost,refund_amount,balance_before,balance_after,
      item_key,item_type,rarity,is_new
    ) values(
      v_uid,v_draw_profile,v_item_cost,v_refund,
      v_balance_before,v_gems,v_item_key,v_item_type,v_rarity,v_is_new
    );

    v_results:=v_results||jsonb_build_array(jsonb_build_object(
      'pull_number',v_pull,
      'box_number',((v_pull-1)/v_items_per_box)+1,
      'item_in_box',mod(v_pull-1,v_items_per_box)+1,
      'draw_profile',v_draw_profile,
      'item_key',v_item_key,
      'display_name',v_display_name,
      'item_type',v_item_type,
      'category',v_category,
      'character_class',v_character_class,
      'rarity',v_rarity,
      'is_new',v_is_new,
      'duplicate_refund',v_refund
    ));
  end loop;

  update public.player_stats
  set total_gems=v_gems,updated_at=now()
  where user_id=v_uid;

  return jsonb_build_object(
    'box_type',v_box,
    'box_quantity',pull_count,
    'items_per_box',v_items_per_box,
    'pull_count',v_total_pulls,
    'item_count',v_total_pulls,
    'item_cost',v_item_cost,
    'box_cost',v_box_cost,
    'cost',v_gross_cost,
    'gross_cost',v_gross_cost,
    'duplicate_refund',v_total_refund,
    'refund',v_total_refund,
    'net_cost',v_gross_cost-v_total_refund,
    'max_box_quantity',v_max_box_quantity,
    'max_items_per_request',v_max_box_quantity*10,
    'max_affordable_box_quantity',least(
      v_max_box_quantity::bigint,v_gems/v_box_cost::bigint
    ),
    'gems',v_gems,
    'results',v_results
  );
end;
$$;

create or replace function public.purchase_catalog_item(
  p_item_key text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();
  v_item_key text:=lower(trim(p_item_key));
  v_item_type text;
  v_display_name text;
  v_rarity text;
  v_character_class text;
  v_cost integer;
  v_balance_before bigint;
  v_gems bigint;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  if v_item_key is null or v_item_key='' then
    raise exception 'Item key is required';
  end if;

  select item_type,display_name,rarity,character_class
  into v_item_type,v_display_name,v_rarity,v_character_class
  from public.extraction_catalog
  where item_key=v_item_key and active and extractable;
  if v_item_type is null then raise exception 'Item is not available'; end if;
  v_cost:=app_private.direct_catalog_price(v_rarity);
  if v_cost is null then raise exception 'Item rarity has no direct price'; end if;

  insert into public.player_stats(user_id,total_gems,high_score,updated_at)
  values(v_uid,0,0,now()) on conflict(user_id) do nothing;
  select total_gems into v_gems
  from public.player_stats where user_id=v_uid for update;

  if exists(
    select 1 from public.player_unlocks
    where user_id=v_uid and item_key=v_item_key
  ) then
    return jsonb_build_object(
      'item_key',v_item_key,
      'display_name',v_display_name,
      'item_type',v_item_type,
      'character_class',v_character_class,
      'rarity',v_rarity,
      'direct_price',v_cost,
      'cost',0,
      'gems',v_gems,
      'total_gems',v_gems,
      'is_new',false,
      'already_owned',true
    );
  end if;
  if v_gems<v_cost then raise exception 'Not enough gems'; end if;
  v_balance_before:=v_gems;

  insert into public.player_unlocks(
    user_id,item_key,item_type,rarity,unlocked_at
  ) values(v_uid,v_item_key,v_item_type,v_rarity,now());
  update public.player_stats
  set total_gems=total_gems-v_cost,updated_at=now()
  where user_id=v_uid returning total_gems into v_gems;
  insert into public.extraction_transactions(
    user_id,box_type,gem_cost,refund_amount,balance_before,balance_after,
    item_key,item_type,rarity,is_new
  ) values(
    v_uid,'direct',v_cost,0,v_balance_before,v_gems,
    v_item_key,v_item_type,v_rarity,true
  );

  return jsonb_build_object(
    'item_key',v_item_key,
    'display_name',v_display_name,
    'item_type',v_item_type,
    'character_class',v_character_class,
    'rarity',v_rarity,
    'direct_price',v_cost,
    'cost',v_cost,
    'gems',v_gems,
    'total_gems',v_gems,
    'is_new',true,
    'already_owned',false
  );
end;
$$;

-- Explicit starter provisioning: one default kit in each of the four gameplay
-- classes. Existing earned items are never deleted or inferred from loadouts.
update public.extraction_catalog
set rarity='uncommon'
where item_key='trickster_rogue'
  and item_type='character'
  and rarity is distinct from 'uncommon';
update public.player_unlocks
set rarity='uncommon'
where item_key='trickster_rogue'
  and item_type='character'
  and rarity is distinct from 'uncommon';

insert into public.player_unlocks(
  user_id,item_key,item_type,rarity,unlocked_at
)
select users.id,starter.item_key,'character',starter.rarity,now()
from auth.users users
cross join(values
  ('runner_ace','common'),
  ('medic_patch','common'),
  ('tank_bulwark','common'),
  ('trickster_rogue','uncommon')
) starter(item_key,rarity)
on conflict(user_id,item_key) do update
set item_type='character',rarity=excluded.rarity;

create or replace function public.provision_player_starters()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  insert into public.player_stats(user_id,total_gems,high_score,updated_at)
  values(new.id,0,0,now()) on conflict(user_id) do nothing;
  insert into public.player_unlocks(
    user_id,item_key,item_type,rarity,unlocked_at
  )
  select new.id,starter.item_key,starter.item_type,starter.rarity,now()
  from(values
    ('runner','class','common'),
    ('medic','class','common'),
    ('tank','class','common'),
    ('trickster','class','common'),
    ('runner_ace','character','common'),
    ('medic_patch','character','common'),
    ('tank_bulwark','character','common'),
    ('trickster_rogue','character','uncommon')
  ) starter(item_key,item_type,rarity)
  on conflict(user_id,item_key) do update
  set item_type=excluded.item_type,rarity=excluded.rarity;
  insert into public.player_loadouts(
    user_id,class_key,character_key,updated_at
  ) values(new.id,'runner','runner_ace',now())
  on conflict(user_id) do nothing;
  return new;
end;
$$;
drop trigger if exists provision_player_starters_after_signup on auth.users;
create trigger provision_player_starters_after_signup
after insert on auth.users
for each row execute function public.provision_player_starters();

-- Repair only character rows that have no authoritative ownership source.
-- Paid pulls, direct purchases, successful admin grants, and the four explicit
-- starters are positive proof. A later successful admin revoke supersedes an
-- earlier paid/admin proof. Nothing is inferred from catalog membership or a
-- saved loadout, which were the sources of the accidental bulk grants.
create table if not exists app_private.player_unlock_quarantine(
  batch_key text not null,
  user_id uuid not null,
  item_key text not null,
  item_type text not null,
  rarity text not null,
  original_unlocked_at timestamptz not null,
  quarantined_at timestamptz not null default now(),
  reason text not null,
  primary key(batch_key,user_id,item_key)
);
revoke all on table app_private.player_unlock_quarantine
  from public,anon,authenticated;

lock table public.player_unlocks in share row exclusive mode;
lock table public.player_loadouts in share row exclusive mode;
lock table public.extraction_transactions in share row exclusive mode;
do $player_08_lock_admin_audit$
begin
  if to_regclass('public.admin_command_audit') is not null then
    execute 'lock table public.admin_command_audit in share row exclusive mode';
  end if;
end
$player_08_lock_admin_audit$;

create temporary table player_08_verified_character_ownership(
  user_id uuid not null,
  item_key text not null,
  source text not null,
  proof_at timestamptz not null,
  primary key(user_id,item_key)
) on commit drop;

insert into player_08_verified_character_ownership(
  user_id,item_key,source,proof_at
)
select users.id,starter.item_key,'starter','infinity'::timestamptz
from auth.users users
cross join(values
  ('runner_ace'),('medic_patch'),('tank_bulwark'),('trickster_rogue')
) starter(item_key);

insert into player_08_verified_character_ownership(
  user_id,item_key,source,proof_at
)
select distinct on(receipt.user_id,receipt.item_key)
  receipt.user_id,
  receipt.item_key,
  case when receipt.box_type='direct'
    then 'direct_purchase' else 'extraction' end,
  receipt.created_at
from public.extraction_transactions receipt
join public.extraction_catalog catalog
  on catalog.item_key=receipt.item_key and catalog.item_type='character'
where receipt.item_type='character' and receipt.is_new
order by receipt.user_id,receipt.item_key,receipt.created_at desc,receipt.id desc
on conflict(user_id,item_key) do update
set source=excluded.source,proof_at=excluded.proof_at
where player_08_verified_character_ownership.source<>'starter'
  and excluded.proof_at>player_08_verified_character_ownership.proof_at;

do $player_08_admin_proof$
begin
  if to_regclass('public.admin_command_audit') is not null then
    execute $sql$
      insert into player_08_verified_character_ownership(
        user_id,item_key,source,proof_at
      )
      select distinct on(audit.target_user_id,audit.result->>'item_key')
        audit.target_user_id,audit.result->>'item_key','admin_grant',
        audit.created_at
      from public.admin_command_audit audit
      join public.extraction_catalog catalog
        on catalog.item_key=audit.result->>'item_key'
       and catalog.item_type='character'
      where audit.succeeded and audit.action='grant'
        and audit.target_user_id is not null
        and audit.result->>'item_type'='character'
        and audit.result->>'granted'='true'
      order by audit.target_user_id,audit.result->>'item_key',
        audit.created_at desc,audit.id desc
      on conflict(user_id,item_key) do update
      set source=excluded.source,proof_at=excluded.proof_at
      where player_08_verified_character_ownership.source<>'starter'
        and excluded.proof_at>
          player_08_verified_character_ownership.proof_at
    $sql$;
    execute $sql$
      delete from player_08_verified_character_ownership proof
      using public.admin_command_audit audit
      where proof.source<>'starter'
        and audit.succeeded and audit.action='revoke'
        and audit.target_user_id=proof.user_id
        and audit.result->>'item_key'=proof.item_key
        and audit.result->>'item_type'='character'
        and audit.result->>'revoked'='true'
        and audit.created_at>=proof.proof_at
    $sql$;
  end if;
end
$player_08_admin_proof$;

-- Restore a proven row if an older bulk-cleanup migration removed it.
insert into public.player_unlocks(
  user_id,item_key,item_type,rarity,unlocked_at
)
select proof.user_id,proof.item_key,'character',catalog.rarity,proof.proof_at
from player_08_verified_character_ownership proof
join public.extraction_catalog catalog
  on catalog.item_key=proof.item_key and catalog.item_type='character'
where proof.source<>'starter'
on conflict(user_id,item_key) do update
set item_type=excluded.item_type,rarity=excluded.rarity;

insert into app_private.player_unlock_quarantine(
  batch_key,user_id,item_key,item_type,rarity,original_unlocked_at,reason
)
select 'player-08-single-default-repair-v1-2026-09-08',
  unlock.user_id,unlock.item_key,unlock.item_type,unlock.rarity,
  unlock.unlocked_at,
  'No starter, paid extraction, direct purchase, or admin-grant proof'
from public.player_unlocks unlock
join public.extraction_catalog catalog
  on catalog.item_key=unlock.item_key and catalog.item_type='character'
left join player_08_verified_character_ownership proof
  on proof.user_id=unlock.user_id and proof.item_key=unlock.item_key
where unlock.item_type='character' and proof.item_key is null
on conflict(batch_key,user_id,item_key) do nothing;

-- Move an invalid equipped row to its one class default before deleting the
-- unsupported ownership. This update never changes an equipped proven item.
update public.player_loadouts loadout
set class_key=case coalesce((
      select catalog.character_class
      from public.extraction_catalog catalog
      where catalog.item_key=loadout.character_key
        and catalog.item_type='character'
    ),loadout.class_key)
      when 'medic' then 'medic'
      when 'tank' then 'tank'
      when 'trickster' then 'trickster'
      else 'runner'
    end,
    character_key=case coalesce((
      select catalog.character_class
      from public.extraction_catalog catalog
      where catalog.item_key=loadout.character_key
        and catalog.item_type='character'
    ),loadout.class_key)
      when 'medic' then 'medic_patch'
      when 'tank' then 'tank_bulwark'
      when 'trickster' then 'trickster_rogue'
      else 'runner_ace'
    end,
    updated_at=now()
where not exists(
  select 1 from player_08_verified_character_ownership proof
  where proof.user_id=loadout.user_id
    and proof.item_key=loadout.character_key
);

delete from public.player_unlocks unlock
using public.extraction_catalog catalog
where catalog.item_key=unlock.item_key
  and catalog.item_type='character'
  and unlock.item_type='character'
  and not exists(
    select 1 from player_08_verified_character_ownership proof
    where proof.user_id=unlock.user_id and proof.item_key=unlock.item_key
  );

update public.player_loadouts loadout
set class_key=catalog.character_class,updated_at=now()
from public.extraction_catalog catalog
where catalog.item_key=loadout.character_key
  and catalog.item_type='character'
  and loadout.class_key is distinct from catalog.character_class;

-- NULL, empty text, "default", and "none" are server-supported sentinels for
-- restoring built-in visuals. Character and class selection remains owned and
-- catalog-driven.
create or replace function public.set_loadout(
  p_slot text,
  p_item text
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();
  v_slot text:=lower(trim(p_slot));
  v_item text:=lower(trim(coalesce(p_item,'')));
  v_required_class text;
  v_current_class text;
  v_current_character text;
  v_next_character text;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  if v_slot not in('class','character','player','obstacle','environment') then
    raise exception 'Invalid loadout slot';
  end if;
  if v_slot in('player','obstacle','environment')
     and v_item in('','default','none') then
    insert into public.player_loadouts(user_id)
    values(v_uid) on conflict(user_id) do nothing;
    update public.player_loadouts
    set player_cosmetic=case when v_slot='player'
          then null else player_cosmetic end,
        obstacle_cosmetic=case when v_slot='obstacle'
          then null else obstacle_cosmetic end,
        environment_cosmetic=case when v_slot='environment'
          then null else environment_cosmetic end,
        updated_at=now()
    where user_id=v_uid;
    return;
  end if;
  if v_item='' then raise exception 'Invalid loadout item'; end if;

  insert into public.player_loadouts(user_id)
  values(v_uid) on conflict(user_id) do nothing;
  select class_key,character_key
  into v_current_class,v_current_character
  from public.player_loadouts where user_id=v_uid for update;

  if v_slot='class' then
    if v_item not in('runner','medic','tank','trickster','misc') then
      raise exception 'Invalid class';
    end if;
    if v_item<>'runner'
       and not exists(
         select 1 from public.player_unlocks
         where user_id=v_uid and item_type='class' and item_key=v_item
       )
       and not exists(
         select 1 from public.player_unlocks unlock
         join public.extraction_catalog catalog
           on catalog.item_key=unlock.item_key
          and catalog.item_type='character'
          and catalog.character_class=v_item
         where unlock.user_id=v_uid and unlock.item_type='character'
       ) then
      raise exception 'Class is not unlocked';
    end if;
    if v_current_class=v_item and exists(
      select 1 from public.player_unlocks unlock
      join public.extraction_catalog catalog
        on catalog.item_key=unlock.item_key
       and catalog.item_type='character'
       and catalog.character_class=v_item
      where unlock.user_id=v_uid and unlock.item_type='character'
        and unlock.item_key=v_current_character
    ) then
      v_next_character:=v_current_character;
    else
      select unlock.item_key into v_next_character
      from public.player_unlocks unlock
      join public.extraction_catalog catalog
        on catalog.item_key=unlock.item_key
       and catalog.item_type='character'
       and catalog.character_class=v_item
      where unlock.user_id=v_uid and unlock.item_type='character'
      order by unlock.unlocked_at,unlock.item_key limit 1;
    end if;
    if v_next_character is null then
      raise exception 'No owned character is available for this class';
    end if;
    update public.player_loadouts
    set class_key=v_item,character_key=v_next_character,updated_at=now()
    where user_id=v_uid;
    return;
  end if;

  if v_slot='character' then
    select character_class into v_required_class
    from public.extraction_catalog
    where item_key=v_item and item_type='character' and active;
    if v_required_class is null then raise exception 'Invalid character'; end if;
    if not exists(
      select 1 from public.player_unlocks
      where user_id=v_uid and item_key=v_item and item_type='character'
    ) then raise exception 'Character is not unlocked'; end if;
    if v_current_class<>v_required_class then
      raise exception 'Character does not belong to the selected class';
    end if;
    update public.player_loadouts
    set character_key=v_item,updated_at=now()
    where user_id=v_uid;
    return;
  end if;

  if not exists(
    select 1 from public.player_unlocks
    where user_id=v_uid and item_key=v_item and item_type=v_slot
  ) then raise exception 'Item is not unlocked for this slot'; end if;
  update public.player_loadouts
  set player_cosmetic=case when v_slot='player'
        then v_item else player_cosmetic end,
      obstacle_cosmetic=case when v_slot='obstacle'
        then v_item else obstacle_cosmetic end,
      environment_cosmetic=case when v_slot='environment'
        then v_item else environment_cosmetic end,
      updated_at=now()
  where user_id=v_uid;
end;
$$;

-- Keep the latest map-aware matchmaking implementation byte-for-byte except
-- for the ranked level gate. Dynamic replacement avoids copying or drifting
-- any map selection, HP snapshot, or ELO behavior.
do $player_08_ranked_gate$
declare
  v_definition text;
begin
  if to_regprocedure('public.join_1v1_queue(text)') is not null then
    v_definition:=pg_get_functiondef(
      to_regprocedure('public.join_1v1_queue(text)')
    );
    v_definition:=replace(
      v_definition,'coalesce(stats.level, 1)','coalesce(stats.level, 0)'
    );
    v_definition:=replace(v_definition,'coalesce(v_level, 1)',
      'coalesce(v_level, 0)');
    v_definition:=replace(v_definition,'v_level < 25','v_level < 20');
    v_definition:=replace(
      v_definition,'stats.level >= 25','stats.level >= 20'
    );
    v_definition:=replace(
      v_definition,'Ranked 1v1 unlocks at level 25',
      'Ranked 1v1 unlocks at level 20'
    );
    execute v_definition;
  end if;
end
$player_08_ranked_gate$;

-- Harden all new and replaced entry points. Private helpers and ledgers have
-- no browser privileges; browser mutation remains RPC-only.
revoke all on function app_private.cumulative_xp_for_level(integer)
  from public,anon,authenticated;
revoke all on function app_private.xp_required_for_level(integer)
  from public,anon,authenticated;
revoke all on function app_private.level_for_lifetime_xp(bigint)
  from public,anon,authenticated;
revoke all on function app_private.apply_player_xp(uuid,bigint,boolean)
  from public,anon,authenticated;
revoke all on function app_private.endless_run_xp_breakdown(bigint,bigint)
  from public,anon,authenticated;
revoke all on function app_private.duplicate_gem_refund(text)
  from public,anon,authenticated;
revoke all on function app_private.direct_catalog_price(text)
  from public,anon,authenticated;
revoke all on function public.increment_player_gems()
  from public,anon,authenticated;
revoke all on function public.get_player_progression()
  from public,anon,authenticated;
revoke all on function public.claim_player_gem(uuid,text)
  from public,anon,authenticated;
revoke all on function public.reset_endless_gem_streak(uuid)
  from public,anon,authenticated;
revoke all on function public.award_completed_run(uuid,bigint,text)
  from public,anon,authenticated;
revoke all on function public.award_completed_run_v2(uuid,bigint,text)
  from public,anon,authenticated;
revoke all on function public.extract_items(integer,text)
  from public,anon,authenticated;
revoke all on function public.purchase_catalog_item(text)
  from public,anon,authenticated;
revoke all on function public.set_loadout(text,text)
  from public,anon,authenticated;
revoke all on function public.provision_player_starters()
  from public,anon,authenticated;

grant execute on function public.get_player_progression()
  to authenticated;
grant execute on function public.claim_player_gem(uuid,text)
  to authenticated;
grant execute on function public.reset_endless_gem_streak(uuid)
  to authenticated;
grant execute on function public.award_completed_run(uuid,bigint,text)
  to authenticated;
grant execute on function public.award_completed_run_v2(uuid,bigint,text)
  to authenticated;
grant execute on function public.extract_items(integer,text)
  to authenticated;
grant execute on function public.purchase_catalog_item(text)
  to authenticated;
grant execute on function public.set_loadout(text,text)
  to authenticated;

comment on function public.claim_player_gem(uuid,text) is
  'Receipt-backed gem claim. Endless awards the hitless-wave 1,2,3... gem streak; 1v1 awards one gem; neither awards XP immediately.';
comment on function public.reset_endless_gem_streak(uuid) is
  'Clears the caller''s current verified Endless wave gem streak after a hit.';
comment on function public.extract_items(integer,text) is
  'Atomic QTY 1-100 Normal/ten-box extraction at 3 gems per item, with rarity-based duplicate refunds.';
comment on function public.purchase_catalog_item(text) is
  'Atomically buys one chosen, unowned active catalog item at its server-owned rarity price.';
comment on column public.extraction_transactions.refund_amount is
  'Gem credit returned by this paid pull when it rolled an already-owned item.';

-- Fail atomically if formulas, privileges, ownership defaults, or preserved
-- map/Tank state drift from the requested rules.
do $$
begin
  if app_private.cumulative_xp_for_level(0)<>0
     or app_private.cumulative_xp_for_level(1)<>10000000
     or app_private.cumulative_xp_for_level(2)<>30000000
     or app_private.cumulative_xp_for_level(20)<>2100000000
     or app_private.xp_required_for_level(0)<>10000000
     or app_private.xp_required_for_level(19)<>200000000 then
    raise exception 'Player 08 XP threshold formula is incorrect';
  end if;
  if (app_private.endless_run_xp_breakdown(8000,0)->>'total')::bigint
       <>16000000
     or (app_private.endless_run_xp_breakdown(8000,3)->>'total')::bigint
       <>16300000 then
    raise exception 'Player 08 Endless XP award formula is incorrect';
  end if;
  if app_private.duplicate_gem_refund('common')<>1
     or app_private.duplicate_gem_refund('epic')<>1
     or app_private.duplicate_gem_refund('legendary')<>2
     or app_private.duplicate_gem_refund('mythic')<>3
     or app_private.direct_catalog_price('common')<>5
     or app_private.direct_catalog_price('uncommon')<>10
     or app_private.direct_catalog_price('rare')<>15
     or app_private.direct_catalog_price('epic')<>25
     or app_private.direct_catalog_price('legendary')<>300
     or app_private.direct_catalog_price('mythic')<>2000 then
    raise exception 'Player 08 shop prices are incorrect';
  end if;
  if exists(
    select 1 from player_08_preserved_tank_rows preserved
    left join public.extraction_catalog catalog using(item_key)
    where catalog.item_key is null
       or to_jsonb(catalog) is distinct from preserved.row_data
  ) then raise exception 'Player 08 attempted to modify Tank catalog data'; end if;
  if exists(
    select 1 from player_08_preserved_map_rows preserved
    left join app_private.one_v_one_map_rules rules using(map_key)
    where rules.map_key is null
       or to_jsonb(rules) is distinct from preserved.row_data
  ) then raise exception 'Player 08 attempted to modify map rules'; end if;
  if exists(
    select 1 from auth.users users
    cross join(values
      ('runner_ace'),('medic_patch'),('tank_bulwark'),('trickster_rogue')
    ) starter(item_key)
    left join public.player_unlocks unlock
      on unlock.user_id=users.id and unlock.item_key=starter.item_key
     and unlock.item_type='character'
    where unlock.item_key is null
  ) then raise exception 'A player is missing one of the four class defaults'; end if;
  if exists(
    select 1 from public.player_unlocks unlock
    join public.extraction_catalog catalog
      on catalog.item_key=unlock.item_key and catalog.item_type='character'
    left join player_08_verified_character_ownership proof
      on proof.user_id=unlock.user_id and proof.item_key=unlock.item_key
    where unlock.item_type='character' and proof.item_key is null
  ) then raise exception 'An unproven automatic character grant remains'; end if;
  if exists(
    select 1 from public.player_loadouts loadout
    left join public.player_unlocks unlock
      on unlock.user_id=loadout.user_id
     and unlock.item_key=loadout.character_key
     and unlock.item_type='character'
    where unlock.item_key is null
  ) then raise exception 'A loadout uses an unowned character'; end if;
  if exists(
    select 1 from public.extraction_catalog
    where item_key='trickster_rogue' and rarity<>'uncommon'
  ) then raise exception 'Rogue must remain an Uncommon starter'; end if;
  if exists(
    select 1 from pg_trigger trigger_row
    where trigger_row.tgname in(
      'award_xp_for_1v1_coin','award_finished_1v1_progression'
    ) and not trigger_row.tgisinternal
  ) then raise exception 'A 1v1 XP trigger is still installed'; end if;
  if to_regprocedure('public.join_1v1_queue(text)') is not null
     and (
       position('v_level < 20' in pg_get_functiondef(
         to_regprocedure('public.join_1v1_queue(text)')
       ))=0
       or position('stats.level >= 20' in pg_get_functiondef(
         to_regprocedure('public.join_1v1_queue(text)')
       ))=0
     ) then raise exception 'Ranked 1v1 is not gated at level 20'; end if;
  if has_table_privilege(
       'authenticated','public.player_endless_gem_streaks','SELECT'
     )
     or has_table_privilege(
       'authenticated','public.player_endless_gem_streaks','INSERT'
     )
     or has_table_privilege(
       'authenticated','public.player_endless_gem_streaks','UPDATE'
     )
     or has_table_privilege(
       'authenticated','public.player_endless_gem_streaks','DELETE'
     ) then raise exception 'Gem streak state is exposed to browser writes'; end if;
  if not has_function_privilege(
       'authenticated','public.reset_endless_gem_streak(uuid)','EXECUTE'
     )
     or has_function_privilege(
       'anon','public.reset_endless_gem_streak(uuid)','EXECUTE'
     )
     or not has_function_privilege(
       'authenticated','public.purchase_catalog_item(text)','EXECUTE'
     )
     or has_function_privilege(
       'anon','public.purchase_catalog_item(text)','EXECUTE'
     ) then raise exception 'Player 08 RPC privileges are not secure'; end if;
end
$$;

notify pgrst,'reload schema';
commit;

select
  app_private.cumulative_xp_for_level(20) as ranked_cumulative_xp,
  app_private.xp_required_for_level(0) as level_zero_xp_required,
  (app_private.endless_run_xp_breakdown(8000,3)->>'total')::bigint
    as sample_8000_score_three_gem_xp,
  app_private.duplicate_gem_refund('mythic') as mythic_duplicate_refund,
  app_private.direct_catalog_price('mythic') as mythic_direct_price,
  not exists(
    select 1 from pg_trigger trigger_row
    where trigger_row.tgname in(
      'award_xp_for_1v1_coin','award_finished_1v1_progression'
    ) and not trigger_row.tgisinternal
  ) as one_v_one_xp_disabled,
  not has_table_privilege(
    'authenticated','public.player_endless_gem_streaks','UPDATE'
  ) as streak_state_private;
