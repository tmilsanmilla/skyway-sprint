-- Player 01 Stats — complete account stats, inventory, character kits, and loadouts.
-- Rerunnable current-state query. It intentionally preserves the current
-- extract_items, admin, leaderboard, and historical compensation functions.

begin;

do $$
begin
  if to_regclass('public.extraction_transactions') is null
     or to_regprocedure('public.extract_items(integer,text)') is null
     or to_regclass('public.multiplayer_matches') is null
     or to_regclass('public.multiplayer_players') is null
     or to_regclass('public.multiplayer_point_events') is null
     or not exists(
       select 1 from information_schema.columns
       where table_schema='public' and table_name='multiplayer_matches'
         and column_name='mode'
     ) then
    raise exception 'Current extraction or multiplayer setup is missing. Run Leaderboard 02, Multi-device 01, and Leaderboard 03 first.';
  end if;
end
$$;

-- Permanent account stats. Players read this table directly but mutate it only
-- through narrow SECURITY DEFINER RPCs.
create table if not exists public.player_stats (
  user_id uuid primary key references auth.users(id) on delete cascade,
  total_gems bigint not null default 0,
  high_score bigint not null default 0,
  level integer not null default 1,
  xp_in_level bigint not null default 0,
  lifetime_xp bigint not null default 0,
  completed_runs bigint not null default 0,
  last_gem_claim_at timestamptz,
  updated_at timestamptz not null default now()
);

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='player_stats'
      and column_name='total_coins'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='player_stats'
      and column_name='total_gems'
  ) then
    alter table public.player_stats rename column total_coins to total_gems;
  end if;
end
$$;

alter table public.player_stats
  add column if not exists total_gems bigint not null default 0,
  add column if not exists high_score bigint not null default 0,
  add column if not exists level integer not null default 1,
  add column if not exists xp_in_level bigint not null default 0,
  add column if not exists lifetime_xp bigint not null default 0,
  add column if not exists completed_runs bigint not null default 0,
  add column if not exists last_gem_claim_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();
alter table public.player_stats
  drop constraint if exists player_stats_total_gems_check,
  drop constraint if exists player_stats_high_score_check,
  drop constraint if exists player_stats_level_check,
  drop constraint if exists player_stats_xp_in_level_check,
  drop constraint if exists player_stats_lifetime_xp_check,
  drop constraint if exists player_stats_completed_runs_check;
alter table public.player_stats
  add constraint player_stats_total_gems_check check (total_gems >= 0) not valid,
  add constraint player_stats_high_score_check check (high_score >= 0) not valid,
  add constraint player_stats_level_check check (level >= 1) not valid,
  add constraint player_stats_xp_in_level_check check (xp_in_level >= 0) not valid,
  add constraint player_stats_lifetime_xp_check check (lifetime_xp >= 0) not valid,
  add constraint player_stats_completed_runs_check check (completed_runs >= 0) not valid;
alter table public.player_stats validate constraint player_stats_total_gems_check;
alter table public.player_stats validate constraint player_stats_high_score_check;
alter table public.player_stats validate constraint player_stats_level_check;
alter table public.player_stats validate constraint player_stats_xp_in_level_check;
alter table public.player_stats validate constraint player_stats_lifetime_xp_check;
alter table public.player_stats validate constraint player_stats_completed_runs_check;
alter table public.player_stats enable row level security;
revoke all on table public.player_stats from public, anon, authenticated;
grant select on table public.player_stats to authenticated;
drop policy if exists "Players read their own stats" on public.player_stats;
drop policy if exists "Players create their own stats" on public.player_stats;
drop policy if exists "Players update their own stats" on public.player_stats;
create policy "Players read their own stats" on public.player_stats
  for select to authenticated using ((select auth.uid()) = user_id);

-- Permanent XP uses a private receipt ledger. XP needed for the next level is
-- 100 + 25 for every level already reached; overflow carries to the next level.
create table if not exists public.player_progression_events(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null check(source in ('run','gem','coin')),
  source_key text not null check(length(source_key) between 1 and 200),
  xp_awarded bigint not null check(xp_awarded>0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(user_id,source,source_key)
);
create table if not exists public.player_progression_runs(
  run_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  claimed_score bigint,
  credited_score bigint,
  check(claimed_score is null or claimed_score>=0),
  check(credited_score is null or credited_score>=0)
);
create index if not exists player_progression_events_user_created_idx
  on public.player_progression_events(user_id,created_at desc);
create index if not exists player_progression_gem_context_idx
  on public.player_progression_events(
    user_id,(metadata->>'context_id'),created_at desc
  ) where source='gem';
create index if not exists player_progression_runs_user_started_idx
  on public.player_progression_runs(user_id,started_at desc);
with duplicate_open_runs as (
  select run_id,row_number() over(
    partition by user_id order by started_at desc,run_id desc
  ) as open_order from public.player_progression_runs
  where completed_at is null
)
update public.player_progression_runs run
set completed_at=now(),claimed_score=0,credited_score=0
from duplicate_open_runs duplicate
where run.run_id=duplicate.run_id and duplicate.open_order>1;
create unique index if not exists player_progression_runs_one_open_idx
  on public.player_progression_runs(user_id) where completed_at is null;
alter table public.player_progression_events enable row level security;
alter table public.player_progression_runs enable row level security;
revoke all on table public.player_progression_events
  from public,anon,authenticated;
revoke all on table public.player_progression_runs
  from public,anon,authenticated;

create or replace function app_private.xp_required_for_level(p_level integer)
returns bigint language sql immutable strict set search_path='' as $$
  select 100::bigint+greatest(0,p_level-1)::bigint*25::bigint;
$$;
create or replace function app_private.apply_player_xp(
  p_user_id uuid,p_amount bigint,p_completed_run boolean default false
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_level integer; v_xp bigint; v_lifetime bigint; v_runs bigint;
  v_required bigint; v_progress_total numeric; v_levels_completed bigint;
  v_level_start numeric;
begin
  if p_user_id is null or p_amount is null or p_amount<0
     or p_amount>1000000 then
    raise exception 'Invalid XP award';
  end if;
  insert into public.player_stats(user_id,total_gems,high_score,updated_at)
  values(p_user_id,0,0,now()) on conflict(user_id) do nothing;
  select level,xp_in_level,lifetime_xp,completed_runs
  into v_level,v_xp,v_lifetime,v_runs
  from public.player_stats where user_id=p_user_id for update;
  v_progress_total:=(greatest(v_level,1)-1)::numeric*100
    +(greatest(v_level,1)-1)::numeric
      *(greatest(v_level,1)-2)::numeric*25/2
    +greatest(v_xp,0)::numeric+p_amount::numeric;
  v_levels_completed:=greatest(0,
    floor((sqrt(30625::numeric+200*v_progress_total)-175)/50))::bigint;
  if v_levels_completed>2147483646 then
    raise exception 'Account level exceeds the supported range';
  end if;
  v_level:=v_levels_completed::integer+1;
  v_level_start:=v_levels_completed::numeric*100
    +v_levels_completed::numeric*(v_levels_completed-1)::numeric*25/2;
  v_xp:=floor(v_progress_total-v_level_start)::bigint;
  if v_lifetime>9223372036854775807::bigint-p_amount then
    raise exception 'Lifetime XP exceeds the supported range';
  end if;
  v_lifetime:=v_lifetime+p_amount;
  v_runs:=v_runs+case when p_completed_run then 1 else 0 end;
  v_required:=app_private.xp_required_for_level(v_level);
  update public.player_stats set level=v_level,xp_in_level=v_xp,
    lifetime_xp=v_lifetime,completed_runs=v_runs,updated_at=now()
  where user_id=p_user_id;
  return jsonb_build_object(
    'level',v_level,'xp',v_xp,'xp_required',v_required,
    'lifetime_xp',v_lifetime,'completed_runs',v_runs,
    'ranked_unlocked',v_level>=25,'xp_awarded',p_amount
  );
end;
$$;

create or replace function public.get_player_progression()
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=auth.uid(); v_stats public.player_stats%rowtype;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  insert into public.player_stats(user_id,total_gems,high_score,updated_at)
  values(v_uid,0,0,now()) on conflict(user_id) do nothing;
  select * into v_stats from public.player_stats where user_id=v_uid;
  return jsonb_build_object(
    'level',v_stats.level,'xp',v_stats.xp_in_level,
    'xp_required',app_private.xp_required_for_level(v_stats.level),
    'lifetime_xp',v_stats.lifetime_xp,
    'completed_runs',v_stats.completed_runs,
    'ranked_unlocked',v_stats.level>=25
  );
end;
$$;

create or replace function public.start_progression_run()
returns uuid language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=auth.uid(); v_run_id uuid;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text,0));
  update public.player_progression_runs set completed_at=now(),
    claimed_score=0,credited_score=0
  where user_id=v_uid and completed_at is null
    and started_at<now()-interval '6 hours';
  select run.run_id into v_run_id from public.player_progression_runs run
  where run.user_id=v_uid and run.completed_at is null
  order by run.started_at desc limit 1;
  if v_run_id is not null then return v_run_id; end if;
  insert into public.player_progression_runs(user_id)
  values(v_uid) returning run_id into v_run_id;
  return v_run_id;
end;
$$;

create or replace function public.award_completed_run(
  p_run_id uuid,p_score bigint,p_scope text
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_uid uuid:=auth.uid(); v_scope text:=lower(trim(p_scope)); v_xp bigint;
  v_inserted uuid; v_score bigint; v_started_at timestamptz;
  v_completed_at timestamptz; v_stored_score bigint; v_high_score bigint;
  v_match_mode text; v_match_status text; v_progress jsonb;
  v_base_xp bigint:=30; v_duration_seconds numeric:=0;
  v_recent_short_award boolean:=false;
  v_run_already_completed boolean:=false;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  if p_run_id is null then raise exception 'Run ID is required'; end if;
  if p_score is null or p_score<0 or p_score>1000000000 then
    raise exception 'Invalid run score';
  end if;
  if v_scope not in ('endless','casual_1v1','ranked_1v1') then
    raise exception 'Invalid run type';
  end if;
  if v_scope='endless' then
    select started_at,completed_at,credited_score
    into v_started_at,v_completed_at,v_stored_score
    from public.player_progression_runs
    where run_id=p_run_id and user_id=v_uid for update;
    if v_started_at is null then raise exception 'Run receipt not found'; end if;
    if v_completed_at is not null then
      v_duration_seconds:=greatest(0,
        extract(epoch from(v_completed_at-v_started_at)));
      v_score:=least(greatest(coalesce(v_stored_score,0),0),
        50000000::bigint);
      v_run_already_completed:=true;
    else
      v_duration_seconds:=greatest(0,
        extract(epoch from(clock_timestamp()-v_started_at)));
      if v_duration_seconds<5 then
        v_base_xp:=1;
        v_score:=0;
        select exists(
          select 1 from public.player_progression_events event
          where event.user_id=v_uid and event.source='run'
            and event.created_at>clock_timestamp()-interval '30 seconds'
            and event.metadata->>'short_run'='true'
        ) into v_recent_short_award;
        update public.player_progression_runs set completed_at=now(),
          claimed_score=p_score,credited_score=0 where run_id=p_run_id;
      else
        v_score:=least(p_score,
          floor(v_duration_seconds*2000)::bigint,50000000::bigint);
        update public.player_progression_runs set completed_at=now(),
          claimed_score=p_score,credited_score=v_score where run_id=p_run_id;
      end if;
    end if;
  else
    select match.status,match.mode,player.score,match.started_at,match.finished_at
    into v_match_status,v_match_mode,v_score,v_started_at,v_completed_at
    from public.multiplayer_matches match
    join public.multiplayer_players player
      on player.match_id=match.id and player.user_id=v_uid
    where match.id=p_run_id;
    if v_match_status is null then raise exception '1v1 result not found'; end if;
    if v_match_status<>'finished' then raise exception '1v1 is not finished'; end if;
    if v_scope<>(v_match_mode||'_1v1') then
      raise exception '1v1 mode does not match the finished result';
    end if;
    v_duration_seconds:=greatest(0,
      extract(epoch from(coalesce(v_completed_at,now())-v_started_at)));
    v_score:=least(v_score,47000::bigint,
      5000::bigint+floor(v_duration_seconds*5000)::bigint);
  end if;

  -- Only the server-accepted score above may advance the permanent high score.
  insert into public.player_stats(user_id,total_gems,high_score,updated_at)
  values(v_uid,0,v_score,now()) on conflict(user_id) do nothing;
  update public.player_stats
  set high_score=greatest(high_score,v_score),updated_at=now()
  where user_id=v_uid returning high_score into v_high_score;

  if v_run_already_completed then
    return public.get_player_progression()||jsonb_build_object(
      'xp_awarded',0,'high_score',v_high_score);
  end if;
  if v_recent_short_award then
    return public.get_player_progression()||jsonb_build_object(
      'xp_awarded',0,'short_run_throttled',true,
      'high_score',v_high_score);
  end if;

  v_xp:=v_base_xp+floor(v_score::numeric/100)::bigint;
  insert into public.player_progression_events(
    user_id,source,source_key,xp_awarded,metadata
  ) values(v_uid,'run',p_run_id::text,v_xp,jsonb_build_object(
    'claimed_score',p_score,'credited_score',v_score,'scope',v_scope,
    'duration_seconds',v_duration_seconds,
    'short_run',v_scope='endless' and v_duration_seconds<5
  )) on conflict(user_id,source,source_key) do nothing returning id into v_inserted;
  if v_inserted is not null then
    v_progress:=app_private.apply_player_xp(v_uid,v_xp,true);
    return v_progress||jsonb_build_object('high_score',v_high_score);
  end if;
  return public.get_player_progression()||jsonb_build_object(
    'xp_awarded',0,'high_score',v_high_score);
end;
$$;

create or replace function public.increment_player_gems()
returns bigint language plpgsql security definer set search_path='' as $$
declare
  v_uid uuid:=auth.uid(); v_total bigint; v_last_claim timestamptz;
  v_event_key text:=gen_random_uuid()::text;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  insert into public.player_stats(user_id,total_gems,high_score,updated_at)
  values(v_uid,0,0,now()) on conflict(user_id) do nothing;
  select last_gem_claim_at into v_last_claim from public.player_stats
  where user_id=v_uid for update;
  if v_last_claim is not null
     and v_last_claim>clock_timestamp()-interval '250 milliseconds' then
    raise exception 'Gem pickup arrived too quickly';
  end if;
  update public.player_stats set total_gems=total_gems+1,
    last_gem_claim_at=clock_timestamp(),updated_at=now()
  where user_id=v_uid returning total_gems into v_total;
  insert into public.player_progression_events(
    user_id,source,source_key,xp_awarded
  ) values(v_uid,'gem',v_event_key,20);
  perform app_private.apply_player_xp(v_uid,20,false);
  return v_total;
end;
$$;

create or replace function public.claim_player_gem(
  p_context_id uuid,p_pickup_id text
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_uid uuid:=auth.uid(); v_pickup_id text:=trim(p_pickup_id);
  v_started_at timestamptz; v_wave integer; v_context_type text;
  v_allowed bigint; v_claimed bigint; v_recent_claims bigint;
  v_elapsed_seconds numeric; v_inserted uuid; v_total bigint; v_progress jsonb;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  if p_context_id is null or v_pickup_id is null
     or length(v_pickup_id) not between 1 and 120 then
    raise exception 'Valid gem context and pickup ID are required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text,1));
  insert into public.player_stats(user_id,total_gems,high_score,updated_at)
  values(v_uid,0,0,now()) on conflict(user_id) do nothing;
  perform user_id from public.player_stats where user_id=v_uid for update;
  if exists(select 1 from public.player_progression_events event
    where event.user_id=v_uid and event.source='gem'
      and event.source_key=p_context_id::text||':'||v_pickup_id) then
    select total_gems into v_total from public.player_stats where user_id=v_uid;
    return jsonb_build_object('total_gems',coalesce(v_total,0),'is_new',false,
      'progression',public.get_player_progression());
  end if;
  select started_at into v_started_at from public.player_progression_runs
  where run_id=p_context_id and user_id=v_uid and completed_at is null
    and started_at>now()-interval '6 hours';
  if v_started_at is not null then
    v_context_type:='endless';
    v_elapsed_seconds:=greatest(0,
      extract(epoch from(clock_timestamp()-v_started_at)));
    v_allowed:=2+floor(v_elapsed_seconds/0.30)::bigint;
  else
    select match.started_at,player.wave into v_started_at,v_wave
    from public.multiplayer_matches match
    join public.multiplayer_players player
      on player.match_id=match.id and player.user_id=v_uid
    where match.id=p_context_id
      and match.status in ('countdown','playing','intermission')
      and match.started_at>now()-interval '6 hours';
    if v_wave is null then raise exception 'Gem context is not active'; end if;
    v_context_type:='1v1';
    v_elapsed_seconds:=greatest(0,
      extract(epoch from(clock_timestamp()-v_started_at)));
    v_allowed:=least(2+floor(v_elapsed_seconds/0.30)::bigint,
      2+greatest(1,v_wave)::bigint*90);
  end if;
  select count(*) into v_claimed from public.player_progression_events
  where user_id=v_uid and source='gem'
    and metadata->>'context_id'=p_context_id::text;
  if v_context_type='1v1' then
    select v_claimed+count(*) into v_claimed
    from public.multiplayer_point_events
    where match_id=p_context_id and user_id=v_uid;
  end if;
  if v_claimed>=v_allowed then raise exception 'Gem claim limit reached'; end if;
  select count(*) into v_recent_claims from public.player_progression_events
  where user_id=v_uid and source='gem'
    and metadata->>'context_id'=p_context_id::text
    and created_at>clock_timestamp()-interval '1 second';
  if v_context_type='1v1' then
    select v_recent_claims+count(*) into v_recent_claims
    from public.multiplayer_point_events
    where match_id=p_context_id and user_id=v_uid
      and created_at>clock_timestamp()-interval '1 second';
  end if;
  if v_recent_claims>=4 then raise exception 'Gem pickups arrived too quickly'; end if;
  insert into public.player_progression_events(
    user_id,source,source_key,xp_awarded,metadata
  ) values(
    v_uid,'gem',p_context_id::text||':'||v_pickup_id,20,
    jsonb_build_object('context_id',p_context_id,
      'context_type',v_context_type,'pickup_id',v_pickup_id)
  ) on conflict(user_id,source,source_key) do nothing returning id into v_inserted;
  if v_inserted is not null then
    update public.player_stats set total_gems=total_gems+1,updated_at=now()
    where user_id=v_uid returning total_gems into v_total;
    v_progress:=app_private.apply_player_xp(v_uid,20,false);
  else
    select total_gems into v_total from public.player_stats where user_id=v_uid;
    v_progress:=public.get_player_progression();
  end if;
  return jsonb_build_object('total_gems',coalesce(v_total,0),
    'is_new',v_inserted is not null,'progression',v_progress);
end;
$$;

create or replace function app_private.award_coin_progression()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_inserted uuid;
begin
  insert into public.player_progression_events(
    user_id,source,source_key,xp_awarded,metadata
  ) values(
    new.user_id,'coin',new.match_id::text||':'||new.pickup_id,3,
    jsonb_build_object('match_id',new.match_id,'pickup_id',new.pickup_id)
  ) on conflict(user_id,source,source_key) do nothing
  returning id into v_inserted;
  if v_inserted is not null then
    perform app_private.apply_player_xp(new.user_id,3,false);
  end if;
  return new;
end;
$$;

create or replace function app_private.enforce_1v1_score_ceiling()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  v_started_at timestamptz; v_elapsed_seconds numeric; v_score_ceiling bigint;
begin
  select started_at into v_started_at from public.multiplayer_matches
  where id=new.match_id;
  if v_started_at is null then raise exception '1v1 match not found'; end if;
  v_elapsed_seconds:=greatest(0,
    extract(epoch from(clock_timestamp()-v_started_at)));
  v_score_ceiling:=least(10000000::bigint,
    10000::bigint+floor(v_elapsed_seconds*25000)::bigint);
  if new.score<0 or new.score>v_score_ceiling then
    raise exception '1v1 score exceeds the server play-time allowance';
  end if;
  return new;
end;
$$;
drop trigger if exists enforce_1v1_score_ceiling on public.multiplayer_players;
create trigger enforce_1v1_score_ceiling
before insert or update of score on public.multiplayer_players
for each row execute function app_private.enforce_1v1_score_ceiling();

-- Current receipt-only 1v1 coin claim. Server time, wave, and recent receipt
-- counts cap unique IDs while exact retries remain idempotent.
create or replace function public.award_1v1_points(
  p_match_id uuid,p_source text,p_amount integer,p_pickup_id text
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_uid uuid:=auth.uid(); v_source text:=lower(trim(p_source));
  v_pickup_id text:=trim(p_pickup_id); v_match public.multiplayer_matches;
  v_self public.multiplayer_players; v_inserted_id text; v_awarded integer:=0;
  v_now timestamptz:=clock_timestamp(); v_elapsed_seconds numeric;
  v_elapsed_allowance bigint; v_wave_allowance bigint; v_allowed bigint;
  v_claimed bigint; v_recent_claims bigint;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  if v_source not in ('coin','melon') or p_amount<>1 then
    raise exception 'Coins must be awarded one pickup at a time';
  end if;
  if v_pickup_id is null or length(v_pickup_id) not between 1 and 160 then
    raise exception 'A valid coin pickup id is required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text,1));
  select * into v_match from public.multiplayer_matches
  where id=p_match_id and started_at>now()-interval '6 hours' for update;
  select * into v_self from public.multiplayer_players
  where match_id=p_match_id and user_id=v_uid for update;
  if v_match.id is null or v_self.user_id is null then
    raise exception '1v1 match not found';
  end if;
  if exists(select 1 from public.multiplayer_point_events event
    where event.match_id=p_match_id and event.user_id=v_uid
      and event.pickup_id=v_pickup_id) then
    return jsonb_build_object('match_id',p_match_id,'source','coin',
      'pickup_id',v_pickup_id,'duplicate',true,'awarded',0,
      'obstacle_points',v_self.obstacle_points,
      'melons_collected',v_self.melons_collected,
      'coins_collected',v_self.melons_collected);
  end if;
  if v_match.status<>'playing' or v_self.status<>'playing' then
    raise exception 'Coins can only be collected during active 1v1 play';
  end if;
  v_elapsed_seconds:=greatest(0,extract(epoch from(v_now-v_match.started_at)));
  v_elapsed_allowance:=2+floor(v_elapsed_seconds/0.30)::bigint;
  v_wave_allowance:=2+greatest(v_match.current_wave,v_self.wave,1)::bigint*90;
  v_allowed:=least(v_elapsed_allowance,v_wave_allowance);
  select count(*) into v_claimed from public.multiplayer_point_events event
  where event.match_id=p_match_id and event.user_id=v_uid;
  select v_claimed+count(*) into v_claimed
  from public.player_progression_events
  where user_id=v_uid and source='gem'
    and metadata->>'context_id'=p_match_id::text;
  if v_claimed>=v_allowed then raise exception 'Coin pickup allowance reached'; end if;
  select count(*) into v_recent_claims from public.multiplayer_point_events event
  where event.match_id=p_match_id and event.user_id=v_uid
    and event.created_at>v_now-interval '1 second';
  select v_recent_claims+count(*) into v_recent_claims
  from public.player_progression_events
  where user_id=v_uid and source='gem'
    and metadata->>'context_id'=p_match_id::text
    and created_at>v_now-interval '1 second';
  if v_recent_claims>=4 then raise exception 'Coin pickups arrived too quickly'; end if;
  insert into public.multiplayer_point_events(
    match_id,user_id,pickup_id,source,points_awarded
  ) values(p_match_id,v_uid,v_pickup_id,'coin',2)
  on conflict(match_id,user_id,pickup_id) do nothing
  returning pickup_id into v_inserted_id;
  if v_inserted_id is not null then
    v_awarded:=2;
    update public.multiplayer_players set obstacle_points=obstacle_points+2,
      melons_collected=melons_collected+1,last_melon_at=v_now,
      last_seen_at=v_now,updated_at=v_now
    where match_id=p_match_id and user_id=v_uid;
    update public.multiplayer_matches set last_activity_at=v_now
    where id=p_match_id;
  end if;
  select * into v_self from public.multiplayer_players
  where match_id=p_match_id and user_id=v_uid;
  return jsonb_build_object('match_id',p_match_id,'source','coin',
    'pickup_id',v_pickup_id,'duplicate',v_inserted_id is null,
    'awarded',v_awarded,'obstacle_points',v_self.obstacle_points,
    'melons_collected',v_self.melons_collected,
    'coins_collected',v_self.melons_collected,'coin_allowance',v_allowed);
end;
$$;

create or replace function app_private.award_finished_1v1_progression()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  v_player record; v_xp bigint; v_inserted uuid;
  v_duration_seconds numeric; v_score_ceiling bigint; v_credited_score bigint;
begin
  if old.status is not distinct from new.status or new.status<>'finished' then
    return new;
  end if;
  v_duration_seconds:=greatest(0,
    extract(epoch from(coalesce(new.finished_at,now())-new.started_at)));
  v_score_ceiling:=least(47000::bigint,
    5000::bigint+floor(v_duration_seconds*5000)::bigint);
  for v_player in select user_id,score from public.multiplayer_players
    where match_id=new.id
  loop
    v_credited_score:=least(greatest(v_player.score,0),v_score_ceiling);
    v_xp:=30+floor(v_credited_score::numeric/100)::bigint;
    insert into public.player_progression_events(
      user_id,source,source_key,xp_awarded,metadata
    ) values(v_player.user_id,'run',new.id::text,v_xp,jsonb_build_object(
      'claimed_score',v_player.score,'credited_score',v_credited_score,
      'scope',new.mode||'_1v1'
    )) on conflict(user_id,source,source_key) do nothing
    returning id into v_inserted;
    if v_inserted is not null then
      perform app_private.apply_player_xp(v_player.user_id,v_xp,true);
    end if;
    v_inserted:=null;
  end loop;
  return new;
end;
$$;

do $$
begin
  if to_regclass('public.multiplayer_point_events') is not null then
    execute 'drop trigger if exists award_xp_for_1v1_coin on public.multiplayer_point_events';
    execute 'create trigger award_xp_for_1v1_coin after insert on public.multiplayer_point_events for each row execute function app_private.award_coin_progression()';
  end if;
  if exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='multiplayer_matches'
      and column_name='mode'
  ) then
    execute 'drop trigger if exists award_finished_1v1_progression on public.multiplayer_matches';
    execute 'create trigger award_finished_1v1_progression after update of status on public.multiplayer_matches for each row execute function app_private.award_finished_1v1_progression()';
  end if;
end
$$;
create or replace function public.save_player_high_score(new_score bigint)
returns bigint language sql security definer set search_path='' as $$
  insert into public.player_stats(user_id,total_gems,high_score,updated_at)
  values ((select auth.uid()),0,greatest(new_score,0),now())
  on conflict (user_id) do update
    set high_score=greatest(public.player_stats.high_score,excluded.high_score),
        updated_at=now()
  returning high_score;
$$;
revoke all on function public.increment_player_gems()
  from public,anon,authenticated;
revoke all on function public.claim_player_gem(uuid,text)
  from public,anon,authenticated;
revoke all on function public.award_1v1_points(uuid,text,integer,text)
  from public,anon,authenticated;
do $$
begin
  if to_regprocedure('public.award_1v1_points(uuid,text,integer)') is not null then
    execute 'revoke all on function public.award_1v1_points(uuid, text, integer) from public, anon, authenticated';
  end if;
end
$$;
revoke all on function public.get_player_progression()
  from public,anon,authenticated;
revoke all on function public.start_progression_run()
  from public,anon,authenticated;
revoke all on function public.award_completed_run(uuid,bigint,text)
  from public,anon,authenticated;
revoke all on function app_private.xp_required_for_level(integer)
  from public,anon,authenticated;
revoke all on function app_private.apply_player_xp(uuid,bigint,boolean)
  from public,anon,authenticated;
revoke all on function app_private.award_coin_progression()
  from public,anon,authenticated;
revoke all on function app_private.enforce_1v1_score_ceiling()
  from public,anon,authenticated;
revoke all on function app_private.award_finished_1v1_progression()
  from public,anon,authenticated;
revoke all on function public.save_player_high_score(bigint)
  from public,anon,authenticated;
grant execute on function public.claim_player_gem(uuid,text) to authenticated;
grant execute on function public.award_1v1_points(uuid,text,integer,text)
  to authenticated;
grant execute on function public.get_player_progression() to authenticated;
grant execute on function public.start_progression_run() to authenticated;
grant execute on function public.award_completed_run(uuid,bigint,text)
  to authenticated;

-- Per-account ownership and equipped loadout.
create table if not exists public.player_unlocks (
  user_id uuid not null references auth.users(id) on delete cascade,
  item_key text not null,
  item_type text not null,
  rarity text not null,
  unlocked_at timestamptz not null default now(),
  primary key(user_id,item_key)
);
alter table public.player_unlocks
  add column if not exists item_type text,
  add column if not exists rarity text,
  add column if not exists unlocked_at timestamptz not null default now();
alter table public.player_unlocks
  drop constraint if exists player_unlocks_item_type_check,
  drop constraint if exists player_unlocks_rarity_check;
alter table public.player_unlocks
  add constraint player_unlocks_item_type_check
    check(item_type in ('class','character','player','obstacle','environment')) not valid,
  add constraint player_unlocks_rarity_check
    check(rarity in ('common','uncommon','rare','epic','legendary','mythic')) not valid;
alter table public.player_unlocks validate constraint player_unlocks_item_type_check;
alter table public.player_unlocks validate constraint player_unlocks_rarity_check;
create unique index if not exists player_unlocks_user_item_uidx
  on public.player_unlocks(user_id,item_key);
create index if not exists player_unlocks_user_type_idx
  on public.player_unlocks(user_id,item_type,unlocked_at);

create table if not exists public.player_loadouts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  class_key text not null default 'runner',
  character_key text not null default 'runner_ace',
  player_cosmetic text,
  obstacle_cosmetic text,
  environment_cosmetic text,
  updated_at timestamptz not null default now()
);
alter table public.player_loadouts
  add column if not exists class_key text not null default 'runner',
  add column if not exists character_key text not null default 'runner_ace',
  add column if not exists player_cosmetic text,
  add column if not exists obstacle_cosmetic text,
  add column if not exists environment_cosmetic text,
  add column if not exists updated_at timestamptz not null default now();
alter table public.player_loadouts
  drop constraint if exists player_loadouts_class_key_check,
  drop constraint if exists player_loadouts_character_key_check;

alter table public.player_unlocks enable row level security;
alter table public.player_loadouts enable row level security;
revoke all on table public.player_unlocks from public,anon,authenticated;
revoke all on table public.player_loadouts from public,anon,authenticated;
grant select on table public.player_unlocks to authenticated;
grant select on table public.player_loadouts to authenticated;
drop policy if exists "Players read own unlocks" on public.player_unlocks;
create policy "Players read own unlocks" on public.player_unlocks
  for select to authenticated using ((select auth.uid())=user_id);
drop policy if exists "Players read own loadout" on public.player_loadouts;
create policy "Players read own loadout" on public.player_loadouts
  for select to authenticated using ((select auth.uid())=user_id);

-- Server-owned catalog. A character row is one atomic character + weapon kit.
create table if not exists public.extraction_catalog (
  item_key text primary key,
  display_name text not null,
  item_type text not null,
  rarity text not null,
  character_class text,
  extractable boolean not null default true,
  active boolean not null default true,
  weapon_name text,
  weapon_score_bonus numeric(6,4)
);
alter table public.extraction_catalog
  add column if not exists display_name text,
  add column if not exists item_type text,
  add column if not exists rarity text,
  add column if not exists character_class text,
  add column if not exists extractable boolean not null default true,
  add column if not exists active boolean not null default true,
  add column if not exists weapon_name text,
  add column if not exists weapon_score_bonus numeric(6,4);
alter table public.extraction_catalog
  drop constraint if exists extraction_catalog_item_type_check,
  drop constraint if exists extraction_catalog_rarity_check,
  drop constraint if exists extraction_catalog_character_class_check,
  drop constraint if exists extraction_catalog_character_kit_check;

create temporary table canonical_character_kits(
  item_key text primary key,
  display_name text not null,
  rarity text not null,
  character_class text not null,
  extractable boolean not null,
  weapon_name text not null,
  weapon_score_bonus numeric(6,4) not null
) on commit drop;
insert into canonical_character_kits values
  -- RUNNER: movement or score.
  ('runner_ace','Ace','common','runner',false,'Baton',.03),
  ('runner_dash','Dash','common','runner',true,'Jet Baton',.03),
  ('runner_stride','Stride','common','runner',true,'Pace Blades',.03),
  ('tank_glacier','Glacier','uncommon','runner',true,'Frost Shield',.04),
  ('runner_courier','Courier','uncommon','runner',true,'Parcel Staff',.04),
  ('runner_tempo','Tempo','uncommon','runner',true,'Rhythm Rod',.04),
  ('tank_reactor','Reactor','rare','runner',true,'Core Maul',.05),
  ('runner_vector','Vector','rare','runner',true,'Arrow Lance',.05),
  ('runner_blitz','Blitz','rare','runner',true,'Volt Cleats',.05),
  ('medic_halo','Halo','epic','runner',true,'Sun Staff',.06),
  ('runner_orbit','Orbit','epic','runner',true,'Ring Blades',.06),
  ('runner_relay','Relay','epic','runner',true,'Circuit Baton',.06),
  ('runner_horizon','Horizon','epic','runner',true,'Skyline Disc',.06),
  ('runner_velocity','Velocity','legendary','runner',true,'Turbo Spear',.07),
  ('runner_pacer','Pacer','mythic','runner',true,'Relay Rod',.08),
  ('runner_zenith','Zenith','mythic','runner',true,'Apex Relay',.08),
  -- HEALER (internal key medic): special healing or HP.
  ('medic_patch','Patch','common','medic',false,'Med Staff',.03),
  ('medic_bloom','Bloom','common','medic',true,'Bloom Wand',.03),
  ('medic_remedy','Remedy','common','medic',true,'Tonic Bell',.03),
  ('medic_salve','Salve','common','medic',true,'Remedy Brush',.03),
  ('medic_reserve','Reserve','uncommon','medic',true,'Field Pack',.04),
  ('medic_sprout','Sprout','uncommon','medic',true,'Seed Scepter',.04),
  ('medic_mender','Mender','rare','medic',true,'Clock Needle',.05),
  ('medic_pulse','Pulse','rare','medic',true,'Pulse Syringe',.05),
  ('medic_tonic','Tonic','rare','medic',true,'Vital Flask',.05),
  ('medic_suture','Suture','epic','medic',true,'Pulse Thread',.06),
  ('medic_beacon','Beacon','epic','medic',true,'Rescue Lamp',.06),
  ('medic_lifeline','Lifeline','legendary','medic',true,'Rescue Hook',.07),
  ('medic_seraph','Seraph','legendary','medic',true,'Halo Staff',.07),
  ('tank_atlas','Atlas','legendary','medic',true,'World Maul',.07),
  ('medic_revive','Revive','legendary','medic',true,'Phoenix Needle',.07),
  ('medic_oracle','Oracle','mythic','medic',true,'Fate Censer',.08),
  -- TANK: less damage or more health without healer-style recovery.
  ('tank_bulwark','Bulwark','common','tank',false,'Tower Shield',.03),
  ('runner_vault','Vault','common','tank',true,'Spring Pole',.03),
  ('tank_guard','Guard','common','tank',true,'Iron Buckler',.03),
  ('tank_brace','Brace','uncommon','tank',true,'Spike Buckler',.04),
  ('tank_ironclad','Ironclad','uncommon','tank',true,'Plate Hammer',.04),
  ('medic_mercy','Mercy','rare','tank',true,'Injector',.05),
  ('tank_hammer','Hammer','rare','tank',true,'War Hammer',.05),
  ('tank_anchor','Anchor','rare','tank',true,'Ground Hook',.05),
  ('tank_warden','Warden','rare','tank',true,'Lock Shield',.05),
  ('tank_bastion','Bastion','epic','tank',true,'Fortress Shield',.06),
  ('tank_rampart','Rampart','epic','tank',true,'Siege Wall',.06),
  ('trickster_jester','Jester','epic','tank',true,'Card Fan',.06),
  ('tank_citadel','Citadel','epic','tank',true,'Rampart Axe',.06),
  ('tank_sentinel','Sentinel','legendary','tank',true,'Steel Spear',.07),
  ('tank_colossus','Colossus','legendary','tank',true,'Titan Maul',.07),
  ('trickster_phantom','Phantom','mythic','tank',true,'Moon Scythe',.08),
  -- TRICKSTER: a special action triggers invincibility or another benefit.
  ('trickster_smoke','Smoke','common','trickster',true,'Smoke Bombs',.03),
  ('runner_drift','Drift','uncommon','trickster',true,'Slipstream Shoes',.04),
  ('runner_spark','Spark','uncommon','trickster',true,'Prism Baton',.04),
  ('tank_plow','Plow','uncommon','trickster',true,'Ram Shield',.04),
  ('trickster_rogue','Rogue','uncommon','trickster',false,'Daggers',.04),
  ('trickster_clockwork','Clockwork','uncommon','trickster',true,'Time Cards',.04),
  ('trickster_flicker','Flicker','uncommon','trickster',true,'Blink Knives',.04),
  ('runner_flare','Flare','rare','trickster',true,'Signal Spear',.05),
  ('trickster_pickpocket','Pickpocket','rare','trickster',true,'Coin Dagger',.05),
  ('trickster_switch','Switch','rare','trickster',true,'Twin Coins',.05),
  ('trickster_gambit','Gambit','rare','trickster',true,'Loaded Cards',.05),
  ('medic_vial','Vial','epic','trickster',true,'Tonic Flask',.06),
  ('trickster_mirage','Mirage','epic','trickster',true,'Prism Fans',.06),
  ('runner_comet','Comet','legendary','trickster',true,'Star Spear',.07),
  ('trickster_hex','Hex','legendary','trickster',true,'Void Chakram',.07),
  ('trickster_echo','Echo','mythic','trickster',true,'Repeat Knives',.08),
  -- MISC: everything outside the four defined roles.
  ('runner_scout','Scout','common','misc',true,'Twin Blades',.03),
  ('tank_drag','Drag','common','misc',true,'Chain Hook',.03),
  ('misc_nomad','Nomad','common','misc',true,'Trail Hook',.03),
  ('misc_tinker','Tinker','common','misc',true,'Gear Wrench',.03),
  ('runner_ranger','Ranger','uncommon','misc',true,'Pixel Bow',.04),
  ('misc_broker','Broker','uncommon','misc',true,'Coin Cane',.04),
  ('misc_prospector','Prospector','uncommon','misc',true,'Gem Pick',.04),
  ('misc_lantern','Lantern','uncommon','misc',true,'Glow Rod',.04),
  ('runner_fortune','Fortune','rare','misc',true,'Lucky Compass',.05),
  ('misc_scribe','Scribe','rare','misc',true,'Rune Quill',.05),
  ('misc_weaver','Weaver','rare','misc',true,'Thread Blades',.05),
  ('trickster_wildcard','Wildcard','epic','misc',true,'Dice Fans',.06),
  ('misc_mimic','Mimic','epic','misc',true,'Copy Mask',.06),
  ('misc_catalyst','Catalyst','epic','misc',true,'Flux Vial',.06),
  ('misc_harvester','Harvester','legendary','misc',true,'Crescent Sickle',.07),
  ('misc_muse','Muse','mythic','misc',true,'Dream Harp',.08);

insert into public.extraction_catalog(
  item_key,display_name,item_type,rarity,character_class,extractable,active,
  weapon_name,weapon_score_bonus
)
select item_key,display_name,'character',rarity,character_class,extractable,true,
       weapon_name,weapon_score_bonus
from canonical_character_kits
on conflict(item_key) do update set
  display_name=excluded.display_name,item_type=excluded.item_type,
  rarity=excluded.rarity,character_class=excluded.character_class,
  extractable=excluded.extractable,active=excluded.active,
  weapon_name=excluded.weapon_name,
  weapon_score_bonus=excluded.weapon_score_bonus;

create temporary table canonical_visual_cosmetics(
  item_key text primary key,
  display_name text not null,
  item_type text not null,
  rarity text not null
) on commit drop;
insert into canonical_visual_cosmetics values
  ('red_runner','Red Runner','player','common'),
  ('blue_runner','Blue Runner','player','common'),
  ('gold_runner','Gold Runner','player','common'),
  ('monochrome_runner','Monochrome Runner','player','common'),
  ('pixel_cap','Pixel Cap','player','uncommon'),
  ('mint_scarf','Mint Scarf','player','uncommon'),
  ('forest_cloak','Forest Cloak','player','uncommon'),
  ('comet_cape','Comet Cape','player','rare'),
  ('royal_runner','Royal Runner','player','epic'),
  ('glitch_runner','Glitch Runner','player','epic'),
  ('void_runner','Void Runner','player','legendary'),
  ('starforged_runner','Starforged Runner','player','legendary'),
  ('solar_knight','Solar Knight','player','legendary'),
  ('celestial_runner','Celestial Runner','player','mythic'),
  ('cardboard_obstacles','Cardboard Obstacles','obstacle','common'),
  ('candy_obstacles','Candy Obstacles','obstacle','common'),
  ('copper_obstacles','Copper Obstacles','obstacle','uncommon'),
  ('moss_obstacles','Moss Obstacles','obstacle','uncommon'),
  ('ice_obstacles','Ice Obstacles','obstacle','rare'),
  ('neon_obstacles','Neon Obstacles','obstacle','rare'),
  ('rust_obstacles','Rust Obstacles','obstacle','rare'),
  ('hologram_obstacles','Hologram Obstacles','obstacle','epic'),
  ('magma_obstacles','Magma Obstacles','obstacle','epic'),
  ('dragon_obstacles','Dragon Obstacles','obstacle','legendary'),
  ('prism_obstacles','Prism Obstacles','obstacle','legendary'),
  ('cosmic_obstacles','Cosmic Obstacles','obstacle','mythic'),
  ('meadow_map','Meadow Map','environment','common'),
  ('city_map','City Map','environment','common'),
  ('rain_map','Rain Map','environment','uncommon'),
  ('desert_map','Desert Map','environment','uncommon'),
  ('ocean_map','Ocean Map','environment','rare'),
  ('autumn_map','Autumn Map','environment','rare'),
  ('cave_map','Dark Caves','environment','epic'),
  ('sunset_map','Sunset Map','environment','epic'),
  ('snow_map','Snow Map','environment','epic'),
  ('aurora_map','Aurora Map','environment','legendary'),
  ('volcano_map','Volcano Map','environment','legendary'),
  ('starlight_map','Starlight Map','environment','mythic'),
  ('arcade_map','Arcade Map','environment','mythic');

insert into public.extraction_catalog(
  item_key,display_name,item_type,rarity,character_class,extractable,active,
  weapon_name,weapon_score_bonus
)
select item_key,display_name,item_type,rarity,null,true,true,null,null
from canonical_visual_cosmetics
on conflict(item_key) do update set
  display_name=excluded.display_name,item_type=excluded.item_type,
  rarity=excluded.rarity,character_class=null,extractable=true,active=true,
  weapon_name=null,weapon_score_bonus=null;

alter table public.extraction_catalog
  alter column display_name set not null,
  alter column item_type set not null,
  alter column rarity set not null,
  alter column extractable set not null,
  alter column active set not null;
alter table public.extraction_catalog
  add constraint extraction_catalog_item_type_check
    check(item_type in ('character','player','obstacle','environment')) not valid,
  add constraint extraction_catalog_rarity_check
    check(rarity in ('common','uncommon','rare','epic','legendary','mythic')) not valid,
  add constraint extraction_catalog_character_class_check check(
    (item_type='character' and character_class in
      ('runner','medic','tank','trickster','misc'))
    or (item_type<>'character' and character_class is null)
  ) not valid,
  add constraint extraction_catalog_character_kit_check check(
    (
      item_type='character' and nullif(trim(weapon_name),'') is not null
      and weapon_score_bonus>0 and weapon_score_bonus<=1
    )
    or (
      item_type<>'character'
      and weapon_name is null and weapon_score_bonus is null
    )
  ) not valid;
alter table public.extraction_catalog validate constraint extraction_catalog_item_type_check;
alter table public.extraction_catalog validate constraint extraction_catalog_rarity_check;
alter table public.extraction_catalog validate constraint extraction_catalog_character_class_check;
alter table public.extraction_catalog validate constraint extraction_catalog_character_kit_check;
alter table public.extraction_catalog enable row level security;
revoke all on table public.extraction_catalog from public,anon,authenticated;
grant select on table public.extraction_catalog to authenticated;
drop policy if exists "Authenticated players read extraction catalog"
  on public.extraction_catalog;
create policy "Authenticated players read extraction catalog"
  on public.extraction_catalog for select to authenticated using(active);

-- Provision missing account rows and the four included starter kits. No paid
-- or nonstarter item is granted by this backfill.
insert into public.player_stats(user_id,total_gems,high_score,updated_at)
select id,0,0,now() from auth.users on conflict(user_id) do nothing;
insert into public.player_unlocks(user_id,item_key,item_type,rarity,unlocked_at)
select users.id,starter.item_key,starter.item_type,starter.rarity,now()
from auth.users users
cross join (values
  ('runner','class','common'),('medic','class','common'),
  ('tank','class','common'),('trickster','class','common'),
  ('runner_ace','character','common'),('medic_patch','character','common'),
  ('tank_bulwark','character','common'),
  ('trickster_rogue','character','uncommon')
) starter(item_key,item_type,rarity)
on conflict(user_id,item_key) do update
set item_type=excluded.item_type,rarity=excluded.rarity;
insert into public.player_loadouts(user_id,class_key,character_key,updated_at)
select id,'runner','runner_ace',now() from auth.users
on conflict(user_id) do nothing;

-- Repair metadata without granting unrelated ownership.
update public.player_unlocks unlock
set item_type=catalog.item_type,rarity=catalog.rarity
from public.extraction_catalog catalog
where catalog.item_key=unlock.item_key;

-- Only starters, receipt-backed extractions, and successful admin grants are
-- valid character ownership. Historical setup once bulk-granted variants to
-- class owners; quarantine those rows before removing them so the repair is
-- auditable and reversible by the database owner.
create table if not exists app_private.player_unlock_quarantine (
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

create temporary table verified_character_ownership (
  user_id uuid not null,
  item_key text not null,
  source text not null,
  primary key(user_id,item_key)
) on commit drop;

insert into verified_character_ownership(user_id,item_key,source)
select users.id,starter.item_key,'starter'
from auth.users users
cross join (values
  ('runner_ace'),('medic_patch'),('tank_bulwark'),('trickster_rogue')
) starter(item_key)
on conflict(user_id,item_key) do nothing;

insert into verified_character_ownership(user_id,item_key,source)
select distinct receipt.user_id,receipt.item_key,'extraction'
from public.extraction_transactions receipt
join public.extraction_catalog catalog
  on catalog.item_key=receipt.item_key and catalog.item_type='character'
where receipt.item_type='character' and receipt.is_new
on conflict(user_id,item_key) do nothing;

do $player_01_admin_proof$
begin
  if to_regclass('public.admin_command_audit') is not null then
    execute $sql$
      insert into verified_character_ownership(user_id,item_key,source)
      select distinct audit.target_user_id,audit.result->>'item_key','admin_grant'
      from public.admin_command_audit audit
      join public.extraction_catalog catalog
        on catalog.item_key=audit.result->>'item_key'
       and catalog.item_type='character'
      where audit.succeeded and audit.action='grant'
        and audit.target_user_id is not null
        and audit.result->>'item_type'='character'
        and audit.result->>'granted'='true'
      on conflict(user_id,item_key) do nothing
    $sql$;
  end if;
end
$player_01_admin_proof$;

insert into app_private.player_unlock_quarantine(
  batch_key,user_id,item_key,item_type,rarity,original_unlocked_at,reason
)
select
  'player-01-unproven-character-repair-2026-09-05',
  unlock.user_id,unlock.item_key,unlock.item_type,unlock.rarity,
  unlock.unlocked_at,'No starter, extraction, or admin-grant proof'
from public.player_unlocks unlock
join public.extraction_catalog catalog
  on catalog.item_key=unlock.item_key and catalog.item_type='character'
left join verified_character_ownership proof
  on proof.user_id=unlock.user_id and proof.item_key=unlock.item_key
where unlock.item_type='character' and proof.item_key is null
on conflict(batch_key,user_id,item_key) do nothing;

update public.player_loadouts loadout
set class_key='runner',character_key='runner_ace',updated_at=now()
where not exists (
  select 1 from verified_character_ownership proof
  where proof.user_id=loadout.user_id
    and proof.item_key=loadout.character_key
);

delete from public.player_unlocks unlock
using public.extraction_catalog catalog
where catalog.item_key=unlock.item_key and catalog.item_type='character'
  and unlock.item_type='character'
  and not exists (
    select 1 from verified_character_ownership proof
    where proof.user_id=unlock.user_id and proof.item_key=unlock.item_key
  );

-- Keep every remaining loadout category synchronized with its verified kit.
update public.player_loadouts loadout
set class_key=catalog.character_class,updated_at=now()
from public.extraction_catalog catalog
where catalog.item_key=loadout.character_key
  and catalog.item_type='character'
  and loadout.class_key is distinct from catalog.character_class;

alter table public.player_loadouts
  add constraint player_loadouts_class_key_check
    check(class_key in ('runner','medic','tank','trickster','misc')) not valid;
do $$
declare v_character_keys text;
begin
  select string_agg(quote_literal(item_key),',' order by item_key)
  into v_character_keys
  from canonical_character_kits;
  execute 'alter table public.player_loadouts ' ||
    'add constraint player_loadouts_character_key_check ' ||
    'check(character_key in (' || v_character_keys || ')) not valid';
end
$$;
alter table public.player_loadouts validate constraint player_loadouts_class_key_check;
alter table public.player_loadouts validate constraint player_loadouts_character_key_check;

create or replace function public.sync_player_loadout_character_class()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_character_class text;
begin
  select character_class into v_character_class
  from public.extraction_catalog
  where item_key=new.character_key and item_type='character';
  if v_character_class is null then raise exception 'Unknown loadout character'; end if;
  new.class_key:=v_character_class;
  return new;
end;
$$;
drop trigger if exists sync_player_loadout_character_class on public.player_loadouts;
create trigger sync_player_loadout_character_class
before insert or update of class_key,character_key on public.player_loadouts
for each row execute function public.sync_player_loadout_character_class();
revoke all on function public.sync_player_loadout_character_class()
  from public,anon,authenticated;

-- Catalog-driven loadout selection supports stable historical key names.
create or replace function public.set_loadout(p_slot text,p_item text)
returns void language plpgsql security definer set search_path='' as $$
declare
  v_uid uuid:=auth.uid();
  v_slot text:=lower(trim(p_slot));
  v_item text:=lower(trim(p_item));
  v_required_class text;
  v_current_class text;
  v_current_character text;
  v_next_character text;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  if v_slot not in ('class','character','player','obstacle','environment') then
    raise exception 'Invalid loadout slot';
  end if;
  if v_item is null or v_item='' then raise exception 'Invalid loadout item'; end if;

  insert into public.player_loadouts(user_id) values(v_uid)
  on conflict(user_id) do nothing;
  select class_key,character_key into v_current_class,v_current_character
  from public.player_loadouts where user_id=v_uid for update;

  if v_slot='class' then
    if v_item not in ('runner','medic','tank','trickster','misc') then
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

    if v_item='runner' then
      if v_current_class='runner' and (
        v_current_character='runner_ace' or exists(
          select 1 from public.player_unlocks unlock
          join public.extraction_catalog catalog
            on catalog.item_key=unlock.item_key
           and catalog.item_type='character'
           and catalog.character_class='runner'
          where unlock.user_id=v_uid and unlock.item_type='character'
            and unlock.item_key=v_current_character
        )
      ) then v_next_character:=v_current_character;
      else v_next_character:='runner_ace';
      end if;
    else
      if v_current_class=v_item and exists(
        select 1 from public.player_unlocks unlock
        join public.extraction_catalog catalog
          on catalog.item_key=unlock.item_key
         and catalog.item_type='character'
         and catalog.character_class=v_item
        where unlock.user_id=v_uid and unlock.item_type='character'
          and unlock.item_key=v_current_character
      ) then v_next_character:=v_current_character;
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
    set character_key=v_item,updated_at=now() where user_id=v_uid;
    return;
  end if;

  if not exists(
    select 1 from public.player_unlocks
    where user_id=v_uid and item_key=v_item and item_type=v_slot
  ) then raise exception 'Item is not unlocked for this slot'; end if;
  update public.player_loadouts set
    player_cosmetic=case when v_slot='player' then v_item else player_cosmetic end,
    obstacle_cosmetic=case when v_slot='obstacle' then v_item else obstacle_cosmetic end,
    environment_cosmetic=case when v_slot='environment' then v_item else environment_cosmetic end,
    updated_at=now()
  where user_id=v_uid;
end;
$$;
revoke all on function public.set_loadout(text,text)
  from public,anon,authenticated;
grant execute on function public.set_loadout(text,text) to authenticated;

-- Preserve the current extraction implementation while restoring only its
-- intended caller privilege.
revoke all on function public.extract_items(integer,text)
  from public,anon,authenticated;
grant execute on function public.extract_items(integer,text) to authenticated;

comment on table public.player_stats is
  'Permanent signed-in gems, high score, level, and XP; client mutations use receipt-backed RPCs.';
comment on table public.player_unlocks is
  'Per-account ownership. Four starter kits are included; all other kits and cosmetics require extraction or an admin grant.';
comment on table public.player_loadouts is
  'Per-account equipped category, character kit, and visual cosmetics.';
comment on table public.extraction_catalog is
  'Server-owned extraction pool. A character row atomically unlocks its visual, named weapon, passive, and weapon score bonus.';
comment on column public.extraction_catalog.weapon_name is
  'Named weapon bundled with its character; never extracted separately.';
comment on column public.extraction_catalog.weapon_score_bonus is
  'Additional distance-score fraction; 0.03 means +3 percent.';

-- Fail atomically if the canonical install is incomplete.
do $$
begin
  if (select count(*) from canonical_character_kits)<>80
     or (select count(*) from canonical_visual_cosmetics)<>39 then
    raise exception 'Canonical Player 01 catalog definition is incomplete';
  end if;
  if (
    select count(*) from canonical_character_kits kit
    join public.extraction_catalog catalog using(item_key)
    where catalog.item_type='character' and catalog.active
      and catalog.character_class=kit.character_class
      and catalog.weapon_name=kit.weapon_name
      and catalog.weapon_score_bonus=kit.weapon_score_bonus
  )<>80 then raise exception 'Not all 80 character kits were installed'; end if;
  if (
    select count(*) from canonical_character_kits kit
    join public.extraction_catalog catalog using(item_key)
    where catalog.extractable
  )<>76 then raise exception 'Expected exactly 76 extractable character kits'; end if;
  if (select count(*) from public.extraction_catalog
      where item_type='character' and active)<>80
     or (select count(*) from public.extraction_catalog
         where item_type='character' and active and extractable)<>76 then
    raise exception 'Live catalog must contain 80 active and 76 extractable character kits';
  end if;
  if exists(
    select 1
    from (
      select character_class,count(*) as kit_count
      from canonical_character_kits
      group by character_class
    ) category_counts
    where character_class not in ('runner','medic','tank','trickster','misc')
       or kit_count<>16
  ) then raise exception 'Expected exactly 16 character kits in every category'; end if;
  if exists(
    select 1
    from (
      select character_class,count(*) as kit_count
      from public.extraction_catalog
      where item_type='character' and active
      group by character_class
    ) category_counts
    where character_class not in ('runner','medic','tank','trickster','misc')
       or kit_count<>16
  ) then raise exception 'Live catalog must contain 16 active kits in every category'; end if;
  if exists(
    select 1 from public.player_loadouts loadout
    left join public.extraction_catalog catalog
      on catalog.item_key=loadout.character_key
     and catalog.item_type='character'
    where catalog.item_key is null
       or loadout.class_key is distinct from catalog.character_class
  ) then raise exception 'A loadout category does not match its character'; end if;
  if exists(
    select 1 from public.player_unlocks unlock
    join public.extraction_catalog catalog
      on catalog.item_key=unlock.item_key and catalog.item_type='character'
    left join verified_character_ownership proof
      on proof.user_id=unlock.user_id and proof.item_key=unlock.item_key
    where unlock.item_type='character' and proof.item_key is null
  ) then raise exception 'An unverified character unlock remains'; end if;
  if exists(
    select 1 from public.player_loadouts loadout
    left join public.player_unlocks unlock
      on unlock.user_id=loadout.user_id
     and unlock.item_key=loadout.character_key
     and unlock.item_type='character'
    where unlock.item_key is null
  ) then raise exception 'A loadout uses an unowned character'; end if;
  if to_regprocedure('public.extract_items(integer)') is not null then
    raise exception 'Obsolete one-argument extract_items is installed';
  end if;
  if not has_function_privilege(
    'authenticated','public.extract_items(integer,text)','EXECUTE'
  ) or has_function_privilege(
    'anon','public.extract_items(integer,text)','EXECUTE'
  ) then
    raise exception 'Extraction RPC privileges are not secure';
  end if;
  if has_table_privilege('authenticated','public.player_stats','INSERT')
     or has_table_privilege('authenticated','public.player_stats','UPDATE')
     or has_table_privilege('authenticated','public.player_stats','DELETE') then
    raise exception 'Direct authenticated stat writes are still enabled';
  end if;
  if has_table_privilege('authenticated','public.player_unlocks','INSERT')
     or has_table_privilege('authenticated','public.player_unlocks','UPDATE')
     or has_table_privilege('authenticated','public.player_unlocks','DELETE') then
    raise exception 'Direct authenticated unlock writes are still enabled';
  end if;
  if has_function_privilege(
    'authenticated','public.save_player_high_score(bigint)','EXECUTE'
  ) then
    raise exception 'Direct client high-score saving is still enabled';
  end if;
end
$$;

notify pgrst,'reload schema';
commit;

-- One read-only result row appears in the SQL editor after a successful run.
select
  (select count(*) from public.extraction_catalog
    where item_type='character' and active) as active_character_kits,
  (select count(*) from public.extraction_catalog
    where item_type='character' and active and extractable)
    as extractable_character_kits,
  (select count(*) from public.extraction_catalog
    where item_type='character' and active
      and weapon_name is not null and weapon_score_bonus is not null)
    as weaponized_character_kits,
  (select count(*) from public.extraction_catalog
    where item_type in ('player','obstacle','environment') and active)
    as active_visual_cosmetics,
  (select jsonb_object_agg(character_class,item_count order by character_class)
   from (
     select character_class,count(*) as item_count
     from public.extraction_catalog
     where item_type='character' and active
     group by character_class
   ) counts) as characters_by_category,
  (select count(*) from public.player_loadouts loadout
   left join public.extraction_catalog catalog
     on catalog.item_key=loadout.character_key
    and catalog.item_type='character'
   where catalog.item_key is null
      or loadout.class_key is distinct from catalog.character_class)
    as invalid_loadouts,
  (select count(*) from public.player_unlocks unlock
   join public.extraction_catalog catalog using(item_key)
   where unlock.item_type is distinct from catalog.item_type
      or unlock.rarity is distinct from catalog.rarity)
    as unlock_metadata_mismatches,
  (select count(*)
   from app_private.player_unlock_quarantine quarantine
   where quarantine.batch_key=
     'player-01-unproven-character-repair-2026-09-05')
    as quarantined_unproven_character_unlocks,
  (select count(*) from public.player_loadouts loadout
   left join public.player_unlocks unlock
     on unlock.user_id=loadout.user_id
    and unlock.item_key=loadout.character_key
    and unlock.item_type='character'
   where unlock.item_key is null) as unowned_character_loadouts,
  not has_table_privilege('authenticated','public.player_stats','INSERT')
    and not has_table_privilege('authenticated','public.player_stats','UPDATE')
    and not has_table_privilege('authenticated','public.player_stats','DELETE')
    as direct_stat_writes_blocked,
  not has_table_privilege('authenticated','public.player_unlocks','INSERT')
    and not has_table_privilege('authenticated','public.player_unlocks','UPDATE')
    and not has_table_privilege('authenticated','public.player_unlocks','DELETE')
    as direct_unlock_writes_blocked,
  to_regprocedure('public.extract_items(integer)') is null
    and to_regprocedure('public.extract_items(integer,text)') is not null
    as current_extraction_rpc_preserved,
  has_function_privilege(
    'authenticated','public.extract_items(integer,text)','EXECUTE'
  ) and not has_function_privilege(
    'anon','public.extract_items(integer,text)','EXECUTE'
  ) as extraction_rpc_permissions_secure,
  to_regprocedure('public.get_player_progression()') is not null
    and to_regprocedure('public.start_progression_run()') is not null
    and to_regprocedure('public.award_completed_run(uuid,bigint,text)') is not null
    as progression_rpcs_installed,
  not has_function_privilege(
    'authenticated','public.save_player_high_score(bigint)','EXECUTE'
  ) and not has_function_privilege(
    'anon','public.save_player_high_score(bigint)','EXECUTE'
  ) as direct_high_score_saving_blocked,
  has_function_privilege(
    'authenticated','public.claim_player_gem(uuid,text)','EXECUTE'
  ) and not has_function_privilege(
    'anon','public.claim_player_gem(uuid,text)','EXECUTE'
  ) and not has_function_privilege(
    'authenticated','public.increment_player_gems()','EXECUTE'
  ) as receipt_backed_gem_claims_only,
  has_function_privilege(
    'authenticated','public.award_1v1_points(uuid,text,integer,text)','EXECUTE'
  ) and not has_function_privilege(
    'anon','public.award_1v1_points(uuid,text,integer,text)','EXECUTE'
  ) and coalesce(not has_function_privilege(
    'authenticated',to_regprocedure(
      'public.award_1v1_points(uuid,text,integer)'), 'EXECUTE'
  ),true) as receipt_only_coin_rpc,
  position('Coin pickup allowance reached' in pg_get_functiondef(
    to_regprocedure('public.award_1v1_points(uuid,text,integer,text)')
  ))>0 as coin_rate_limits_installed,
  position('Gem pickups arrived too quickly' in pg_get_functiondef(
    to_regprocedure('public.claim_player_gem(uuid,text)')
  ))>0 as gem_spawn_envelope_installed,
  position('short_run_throttled' in pg_get_functiondef(
    to_regprocedure('public.award_completed_run(uuid,bigint,text)')
  ))>0 as rapid_short_run_xp_throttled,
  position('server play-time allowance' in pg_get_functiondef(
    to_regprocedure('app_private.enforce_1v1_score_ceiling()')
  ))>0 as score_write_ceiling_installed,
  position('sqrt(30625' in pg_get_functiondef(
    to_regprocedure('app_private.apply_player_xp(uuid,bigint,boolean)')
  ))>0 as bounded_xp_math_installed,
  not has_table_privilege(
    'authenticated','public.player_progression_events','SELECT'
  ) and not has_table_privilege(
    'authenticated','public.player_progression_runs','SELECT'
  ) as progression_ledgers_private;
