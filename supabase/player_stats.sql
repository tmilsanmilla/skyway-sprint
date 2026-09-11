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
     or to_regclass('public.admin_users') is null
     or to_regprocedure('app_private.has_active_ban(uuid,text,uuid)') is null
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
  level integer not null default 0,
  xp_in_level bigint not null default 0,
  lifetime_xp bigint not null default 0,
  completed_runs bigint not null default 0,
  admin_test_mode_enabled boolean not null default false,
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
  add column if not exists level integer not null default 0,
  add column if not exists xp_in_level bigint not null default 0,
  add column if not exists lifetime_xp bigint not null default 0,
  add column if not exists completed_runs bigint not null default 0,
  add column if not exists admin_test_mode_enabled boolean not null default false,
  add column if not exists last_gem_claim_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();
alter table public.player_stats
  alter column level set default 0,
  drop constraint if exists player_stats_total_gems_check,
  drop constraint if exists player_stats_high_score_check,
  drop constraint if exists player_stats_level_check,
  drop constraint if exists player_stats_xp_in_level_check,
  drop constraint if exists player_stats_lifetime_xp_check,
  drop constraint if exists player_stats_completed_runs_check;
alter table public.player_stats
  add constraint player_stats_total_gems_check check (total_gems >= 0) not valid,
  add constraint player_stats_high_score_check check (high_score >= 0) not valid,
  add constraint player_stats_level_check check (level >= 0) not valid,
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

-- Permanent XP uses a private receipt ledger. Level L starts at cumulative
-- 5,000,000*L*(L+1) XP, level zero needs 10M XP, and overflow carries.
create table if not exists public.player_progression_events(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null check(source in ('run','gem','coin')),
  source_key text not null check(length(source_key) between 1 and 200),
  xp_awarded bigint not null check(xp_awarded>=0),
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
  active_seconds bigint not null default 0,
  verified_wave integer not null default 1,
  last_heartbeat_at timestamptz,
  heartbeat_active boolean not null default false,
  check(claimed_score is null or claimed_score>=0),
  check(credited_score is null or credited_score>=0)
);
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
    check(active_seconds between 0 and 21600) not valid,
  add constraint player_progression_runs_verified_wave_check
    check(verified_wave between 1 and 100000) not valid;
alter table public.player_progression_runs
  validate constraint player_progression_runs_active_seconds_check;
alter table public.player_progression_runs
  validate constraint player_progression_runs_verified_wave_check;
create table if not exists public.player_progression_1v1_activity(
  match_id uuid not null references public.multiplayer_matches(id)
    on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  active_seconds bigint not null default 0
    check(active_seconds between 0 and 21600),
  verified_wave integer not null default 1
    check(verified_wave between 1 and 100000),
  last_heartbeat_at timestamptz,
  heartbeat_active boolean not null default false,
  primary key(match_id,user_id)
);
alter table public.player_progression_1v1_activity
  add column if not exists active_seconds bigint not null default 0,
  add column if not exists verified_wave integer not null default 1,
  add column if not exists last_heartbeat_at timestamptz,
  add column if not exists heartbeat_active boolean not null default false;
update public.player_progression_1v1_activity
set active_seconds=least(21600::bigint,greatest(0::bigint,
      coalesce(active_seconds,0))),
    verified_wave=least(100000,greatest(1,coalesce(verified_wave,1))),
    heartbeat_active=coalesce(heartbeat_active,false);
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
    check(active_seconds between 0 and 21600) not valid,
  add constraint player_progression_1v1_activity_verified_wave_check
    check(verified_wave between 1 and 100000) not valid;
alter table public.player_progression_1v1_activity
  validate constraint player_progression_1v1_activity_active_seconds_check;
alter table public.player_progression_1v1_activity
  validate constraint player_progression_1v1_activity_verified_wave_check;
create unique index if not exists player_progression_1v1_activity_identity_idx
  on public.player_progression_1v1_activity(match_id,user_id);
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
alter table public.player_progression_1v1_activity enable row level security;
revoke all on table public.player_progression_events
  from public,anon,authenticated;
revoke all on table public.player_progression_runs
  from public,anon,authenticated;
revoke all on table public.player_progression_1v1_activity
  from public,anon,authenticated;

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
      10000000::numeric*p_level::numeric*(p_level::numeric+1)
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
  select 20000000::bigint*(greatest(p_level,0)::bigint+1);
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
        +4::numeric*greatest(p_lifetime_xp,0)::numeric/10000000::numeric
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

create or replace function public.sync_1v1_progression(
  p_match_id uuid,p_wave integer,p_active boolean
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_uid uuid:=auth.uid(); v_status text; v_player_status text;
  v_now timestamptz;
  v_last_heartbeat timestamptz; v_active_seconds bigint;
  v_verified_wave integer; v_was_active boolean;
  v_effective_active boolean; v_increment bigint; v_max_wave integer;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  if p_match_id is null then raise exception 'Match ID is required'; end if;
  if p_wave is null or p_wave<1 or p_wave>100000 then
    raise exception 'Invalid match wave';
  end if;
  if p_active is null then raise exception 'Match activity state is required'; end if;
  select match_row.status,player.status into v_status,v_player_status
  from public.multiplayer_matches match_row
  join public.multiplayer_players player
    on player.match_id=match_row.id and player.user_id=v_uid
  where match_row.id=p_match_id
    and match_row.status in('countdown','playing','intermission')
    and match_row.started_at>now()-interval '6 hours'
  for update of match_row;
  if v_status is null then raise exception 'Active 1v1 membership not found'; end if;
  insert into public.player_progression_1v1_activity(match_id,user_id)
  values(p_match_id,v_uid) on conflict(match_id,user_id) do nothing;
  select last_heartbeat_at,active_seconds,verified_wave,heartbeat_active
  into v_last_heartbeat,v_active_seconds,v_verified_wave,v_was_active
  from public.player_progression_1v1_activity
  where match_id=p_match_id and user_id=v_uid for update;
  v_now:=clock_timestamp();
  v_effective_active:=p_active and v_status='playing'
    and v_player_status='playing';
  v_increment:=case when v_was_active and v_status='playing'
    and v_player_status='playing'
    then least(6::bigint,greatest(0,floor(extract(epoch from(
      v_now-coalesce(v_last_heartbeat,v_now))))::bigint)) else 0 end;
  v_active_seconds:=least(21600::bigint,v_active_seconds+v_increment);
  v_max_wave:=least(100000,
    1+floor(v_active_seconds::numeric/15)::integer);
  v_verified_wave:=least(greatest(v_verified_wave,p_wave),
    v_verified_wave+1,v_max_wave);
  update public.player_progression_1v1_activity
  set active_seconds=v_active_seconds,verified_wave=v_verified_wave,
    last_heartbeat_at=v_now,heartbeat_active=v_effective_active
  where match_id=p_match_id and user_id=v_uid;
  return jsonb_build_object('active_seconds',v_active_seconds,
    'verified_wave',v_verified_wave,'active',v_effective_active);
end;
$$;

-- Capture the last short slice of active play at the authoritative player
-- phase transition. The client heartbeat that follows an intermission cannot
-- add intermission time because this transition also marks the receipt idle.
create or replace function app_private.flush_1v1_progression_on_phase_exit()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  v_now timestamptz; v_match_status text;
  v_last_heartbeat timestamptz; v_active_seconds bigint;
  v_verified_wave integer; v_heartbeat_active boolean;
  v_increment bigint:=0; v_max_wave integer;
begin
  if old.status is distinct from 'playing'
     or new.status is not distinct from 'playing' then return new; end if;
  select status into v_match_status from public.multiplayer_matches
  where id=old.match_id;
  select active_seconds,verified_wave,last_heartbeat_at,heartbeat_active
  into v_active_seconds,v_verified_wave,v_last_heartbeat,v_heartbeat_active
  from public.player_progression_1v1_activity
  where match_id=old.match_id and user_id=old.user_id for update;
  if not found then return new; end if;
  v_now:=clock_timestamp();
  if coalesce(v_heartbeat_active,false) and v_match_status='playing' then
    v_increment:=least(6::bigint,greatest(0::bigint,
      floor(extract(epoch from(
        v_now-coalesce(v_last_heartbeat,v_now))))::bigint));
  end if;
  v_active_seconds:=least(21600::bigint,
    greatest(0::bigint,coalesce(v_active_seconds,0))+v_increment);
  v_max_wave:=least(100000,
    1+floor(v_active_seconds::numeric/15)::integer);
  v_verified_wave:=least(
    greatest(coalesce(v_verified_wave,1),coalesce(new.wave,1)),
    coalesce(v_verified_wave,1)+1,v_max_wave);
  update public.player_progression_1v1_activity
  set active_seconds=v_active_seconds,verified_wave=v_verified_wave,
    last_heartbeat_at=v_now,heartbeat_active=false
  where match_id=old.match_id and user_id=old.user_id;
  return new;
end;
$$;
drop trigger if exists flush_1v1_progression_on_phase_exit
  on public.multiplayer_players;
create trigger flush_1v1_progression_on_phase_exit
before update of status on public.multiplayer_players
for each row when(
  old.status='playing' and new.status is distinct from 'playing'
) execute function app_private.flush_1v1_progression_on_phase_exit();

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
    'ranked_unlocked',v_stats.level>=20
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
  where user_id=v_uid and completed_at is null;
  insert into public.player_progression_runs(
    user_id,active_seconds,verified_wave,last_heartbeat_at,heartbeat_active
  ) values(v_uid,0,1,clock_timestamp(),false) returning run_id into v_run_id;
  return v_run_id;
end;
$$;

drop function if exists public.sync_progression_run(uuid,integer);
create or replace function public.sync_progression_run(
  p_run_id uuid,p_wave integer,p_active boolean
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_uid uuid:=auth.uid(); v_now timestamptz;
  v_last_heartbeat timestamptz; v_active_seconds bigint;
  v_verified_wave integer; v_was_active boolean;
  v_increment bigint; v_max_wave integer;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  if p_run_id is null then raise exception 'Run ID is required'; end if;
  if p_wave is null or p_wave<1 or p_wave>100000 then
    raise exception 'Invalid run wave';
  end if;
  if p_active is null then raise exception 'Run activity state is required'; end if;
  select last_heartbeat_at,active_seconds,verified_wave,heartbeat_active
  into v_last_heartbeat,v_active_seconds,v_verified_wave,v_was_active
  from public.player_progression_runs where run_id=p_run_id
    and user_id=v_uid and completed_at is null for update;
  if not found then raise exception 'Active run receipt not found'; end if;
  v_now:=clock_timestamp();
  v_increment:=case when v_was_active then least(6::bigint,greatest(0,
    floor(extract(epoch from(v_now-coalesce(v_last_heartbeat,v_now))))::bigint))
    else 0 end;
  v_active_seconds:=least(21600::bigint,v_active_seconds+v_increment);
  v_max_wave:=least(100000,
    1+floor(v_active_seconds::numeric/15)::integer);
  v_verified_wave:=least(greatest(v_verified_wave,p_wave),
    v_verified_wave+1,v_max_wave);
  update public.player_progression_runs set active_seconds=v_active_seconds,
    verified_wave=v_verified_wave,last_heartbeat_at=v_now,
    heartbeat_active=p_active
  where run_id=p_run_id;
  return jsonb_build_object('active_seconds',v_active_seconds,
    'verified_wave',v_verified_wave,'active',p_active);
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
  v_context_type text; v_match_status text; v_player_status text;
  v_active_seconds bigint; v_verified_wave integer;
  v_last_heartbeat timestamptz; v_heartbeat_active boolean;
  v_time_allowance bigint; v_wave_allowance bigint; v_allowed bigint;
  v_claimed bigint; v_recent_claims bigint; v_inserted uuid;
  v_total bigint; v_progress jsonb; v_now timestamptz;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  if p_context_id is null or v_pickup_id is null
     or length(v_pickup_id) not between 1 and 120 then
    raise exception 'Valid gem context and pickup ID are required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text,1));
  if exists(select 1 from public.player_progression_events event
    where event.user_id=v_uid and event.source='gem'
      and event.source_key=p_context_id::text||':'||v_pickup_id) then
    select total_gems into v_total from public.player_stats where user_id=v_uid;
    return jsonb_build_object('total_gems',coalesce(v_total,0),'is_new',false,
      'progression',public.get_player_progression());
  end if;
  select active_seconds,verified_wave,last_heartbeat_at,heartbeat_active
  into v_active_seconds,v_verified_wave,v_last_heartbeat,v_heartbeat_active
  from public.player_progression_runs
  where run_id=p_context_id and user_id=v_uid and completed_at is null
    and started_at>now()-interval '6 hours' for update;
  if found then
    v_now:=clock_timestamp();
    v_context_type:='endless';
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
    where match_id=p_context_id and user_id=v_uid for update;
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
  v_active_seconds:=least(21600::bigint,
    greatest(0::bigint,coalesce(v_active_seconds,0)));
  v_verified_wave:=least(100000,
    greatest(1,coalesce(v_verified_wave,1)));
  v_time_allowance:=2+
    floor(v_active_seconds::numeric/0.75)::bigint;
  v_wave_allowance:=2+v_verified_wave::bigint*60;
  v_allowed:=least(v_time_allowance,v_wave_allowance);
  insert into public.player_stats(user_id,total_gems,high_score,updated_at)
  values(v_uid,0,0,now()) on conflict(user_id) do nothing;
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
    and created_at>v_now-interval '1 second';
  if v_context_type='1v1' then
    select v_recent_claims+count(*) into v_recent_claims
    from public.multiplayer_point_events
    where user_id=v_uid
      and created_at>v_now-interval '1 second';
  end if;
  if v_recent_claims>=3 then raise exception 'Gem pickups arrived too quickly'; end if;
  insert into public.player_progression_events(
    user_id,source,source_key,xp_awarded,metadata
  ) values(
    v_uid,'gem',p_context_id::text||':'||v_pickup_id,20,
    jsonb_build_object('context_id',p_context_id,
      'context_type',v_context_type,'pickup_id',v_pickup_id,
      'verified_active_seconds',v_active_seconds,
      'verified_wave',v_verified_wave)
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
  v_mushroom_score bigint:=0; v_second_death_bonus boolean:=false;
  v_zenith_time_stop_used boolean:=false;
begin
  select started_at into v_started_at from public.multiplayer_matches
  where id=new.match_id;
  if v_started_at is null then raise exception '1v1 match not found'; end if;
  v_elapsed_seconds:=greatest(0,
    extract(epoch from(clock_timestamp()-v_started_at)));
  -- MAPS MISC owns mushroom receipts, Zenith's one-use score reward, and the
  -- second-death bonus. Keep those server-created points inside the ceiling
  -- when this merged query is rerun, while remaining safe on a database where
  -- MAPS MISC is not installed yet.
  if to_regclass('public.multiplayer_mushroom_events') is not null then
    execute 'select count(*)::bigint * 120
      from public.multiplayer_mushroom_events
      where match_id=$1 and user_id=$2'
    into v_mushroom_score using new.match_id,new.user_id;
  end if;
  v_second_death_bonus:=coalesce(
    (to_jsonb(new)->>'second_death_bonus_awarded')::boolean,false
  );
  -- Keep this merged Player 01 query rerunnable before or after MAPS MISC:
  -- reading through JSON avoids referencing a column that may not exist yet.
  v_zenith_time_stop_used:=coalesce(
    (to_jsonb(new)->>'zenith_time_stop_used')::boolean,false
  );
  v_score_ceiling:=least(10000000::bigint,
    10000::bigint+floor(v_elapsed_seconds*25000)::bigint)
    +coalesce(v_mushroom_score,0)
    +case when v_zenith_time_stop_used then 15000 else 0 end
    +case when v_second_death_bonus then 280 else 0 end;
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

-- Legacy single-pickup implementation retained for migration compatibility.
-- Client execute is revoked below; Multi-device 07 owns the current atomic
-- intermission batch RPC.
create or replace function public.award_1v1_points(
  p_match_id uuid,p_source text,p_amount integer,p_pickup_id text
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_uid uuid:=auth.uid(); v_source text:=lower(trim(p_source));
  v_pickup_id text:=trim(p_pickup_id); v_match public.multiplayer_matches;
  v_self public.multiplayer_players; v_inserted_id text; v_awarded numeric:=0;
  v_balance_before numeric:=0; v_coin_reward numeric:=2;
  v_map_key text:='classic';
  v_now timestamptz; v_active_seconds bigint; v_verified_wave integer;
  v_last_heartbeat timestamptz; v_heartbeat_active boolean;
  v_time_allowance bigint; v_wave_allowance bigint; v_allowed bigint;
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
  where id=p_match_id for update;
  select * into v_self from public.multiplayer_players
  where match_id=p_match_id and user_id=v_uid for update;
  if v_match.id is null or v_self.user_id is null then
    raise exception '1v1 match not found';
  end if;
  v_balance_before:=v_self.obstacle_points;
  v_map_key:=coalesce(nullif(to_jsonb(v_match)->>'map_key',''),'classic');
  -- Prefer the selected map's exact coin value once MAPS MISC exists. Dynamic
  -- SQL avoids a circular first-install dependency between Player 01 and maps.
  if to_regclass('app_private.one_v_one_map_rules') is not null then
    execute 'select coin_point_reward::numeric
      from app_private.one_v_one_map_rules where map_key=$1'
    into v_coin_reward using v_map_key;
    v_coin_reward:=coalesce(v_coin_reward,2);
  end if;
  if exists(select 1 from public.multiplayer_point_events event
    where event.match_id=p_match_id and event.user_id=v_uid
      and event.pickup_id=v_pickup_id) then
    return jsonb_build_object('match_id',p_match_id,'map_key',v_map_key,
      'source','coin',
      'pickup_id',v_pickup_id,'duplicate',true,'awarded',0,
      'points_per_coin',v_coin_reward,
      'obstacle_points',v_self.obstacle_points,
      'melons_collected',v_self.melons_collected,
      'coins_collected',v_self.melons_collected,
      'mushrooms_collected',coalesce(
        (to_jsonb(v_self)->>'mushrooms_collected')::integer,0));
  end if;
  if v_match.started_at<=now()-interval '6 hours' then
    raise exception '1v1 match is too old for new coin receipts';
  end if;
  if v_match.status<>'playing' or v_self.status<>'playing' then
    raise exception 'Coins can only be collected during active 1v1 play';
  end if;
  select active_seconds,verified_wave,last_heartbeat_at,heartbeat_active
  into v_active_seconds,v_verified_wave,v_last_heartbeat,v_heartbeat_active
  from public.player_progression_1v1_activity
  where match_id=p_match_id and user_id=v_uid for update;
  if not found then raise exception 'Coins require active 1v1 play'; end if;
  v_now:=clock_timestamp();
  if not coalesce(v_heartbeat_active,false)
     or v_last_heartbeat is null
     or v_last_heartbeat<v_now-interval '8 seconds' then
    raise exception 'Coins require active 1v1 play';
  end if;
  v_active_seconds:=least(21600::bigint,
    greatest(0::bigint,coalesce(v_active_seconds,0)));
  v_verified_wave:=least(100000,
    greatest(1,coalesce(v_verified_wave,1)));
  v_time_allowance:=2+
    floor(v_active_seconds::numeric/0.75)::bigint;
  v_wave_allowance:=2+v_verified_wave::bigint*60;
  v_allowed:=least(v_time_allowance,v_wave_allowance);
  select count(*) into v_claimed from public.multiplayer_point_events event
  where event.match_id=p_match_id and event.user_id=v_uid;
  select v_claimed+count(*) into v_claimed
  from public.player_progression_events
  where user_id=v_uid and source='gem'
    and metadata->>'context_id'=p_match_id::text;
  if v_claimed>=v_allowed then raise exception 'Coin pickup allowance reached'; end if;
  select count(*) into v_recent_claims from public.multiplayer_point_events event
  where event.user_id=v_uid
    and event.created_at>v_now-interval '1 second';
  select v_recent_claims+count(*) into v_recent_claims
  from public.player_progression_events
  where user_id=v_uid and source='gem'
    and created_at>v_now-interval '1 second';
  if v_recent_claims>=3 then raise exception 'Coin pickups arrived too quickly'; end if;
  insert into public.multiplayer_point_events(
    match_id,user_id,pickup_id,source,points_awarded
  ) values(p_match_id,v_uid,v_pickup_id,'coin',v_coin_reward)
  on conflict(match_id,user_id,pickup_id) do nothing
  returning pickup_id into v_inserted_id;
  if v_inserted_id is not null then
    update public.multiplayer_players
    set obstacle_points=obstacle_points+v_coin_reward,
      melons_collected=melons_collected+1,last_melon_at=v_now,
      last_seen_at=v_now,updated_at=v_now
    where match_id=p_match_id and user_id=v_uid;
    update public.multiplayer_matches set last_activity_at=v_now
    where id=p_match_id;
  end if;
  select * into v_self from public.multiplayer_players
  where match_id=p_match_id and user_id=v_uid;
  if v_inserted_id is not null then
    -- Runner/Healer MISC can multiply this award in a server trigger. Return
    -- the actual balance delta rather than the nominal map value.
    v_awarded:=greatest(0,v_self.obstacle_points-v_balance_before);
  end if;
  return jsonb_build_object('match_id',p_match_id,'map_key',v_map_key,
    'source','coin',
    'pickup_id',v_pickup_id,'duplicate',v_inserted_id is null,
    'awarded',v_awarded,
    'points_per_coin',case when v_inserted_id is null
      then v_coin_reward else v_awarded end,
    'obstacle_points',v_self.obstacle_points,
    'melons_collected',v_self.melons_collected,
    'coins_collected',v_self.melons_collected,
    'mushrooms_collected',coalesce(
      (to_jsonb(v_self)->>'mushrooms_collected')::integer,0),
    'pickup_allowance',v_allowed,'coin_allowance',v_allowed);
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

-- Gems and 1v1 coins award XP immediately through their receipt-backed pickup
-- functions above. A completed run adds finish, score, completed-wave, and
-- active-playtime XP without trusting a caller-calculated total.
create or replace function app_private.run_xp_breakdown(
  p_score bigint,p_completed_waves integer,p_active_seconds bigint,
  p_finish_xp bigint
)
returns jsonb language sql immutable strict set search_path='' as $$
  with awards as (
    select greatest(p_finish_xp,0)::bigint as finish_xp,
      least(
        floor(greatest(p_score,0)::numeric/250)::bigint,
        greatest(p_completed_waves,1)::bigint*10
      ) as score_xp,
      greatest(p_completed_waves,0)::bigint*10 as wave_xp,
      floor(greatest(p_active_seconds,0)::numeric/10)::bigint as playtime_xp
  )
  select jsonb_build_object(
    'finish',finish_xp,'score',score_xp,'waves',wave_xp,
    'playtime',playtime_xp,
    'total',finish_xp+score_xp+wave_xp+playtime_xp
  ) from awards;
$$;

drop function if exists public.award_completed_run_v2(
  uuid,bigint,text,integer,integer
);
create or replace function public.award_completed_run_v2(
  p_run_id uuid,p_score bigint,p_scope text
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_uid uuid:=auth.uid(); v_scope text:=lower(trim(p_scope)); v_xp bigint;
  v_inserted uuid; v_score bigint; v_started_at timestamptz;
  v_completed_at timestamptz; v_stored_score bigint; v_high_score bigint;
  v_match_mode text; v_match_status text; v_server_wave integer;
  v_verified_1v1_wave integer;
  v_completed_waves integer:=0; v_active_seconds bigint:=0;
  v_duration_seconds numeric:=0; v_finish_xp bigint:=10;
  v_breakdown jsonb; v_existing_breakdown jsonb; v_progress jsonb;
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
    select started_at,completed_at,credited_score,active_seconds,verified_wave
    into v_started_at,v_completed_at,v_stored_score,
      v_active_seconds,v_server_wave
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
      v_active_seconds:=least(greatest(coalesce(v_active_seconds,0),0),
        floor(v_duration_seconds)::bigint,21600::bigint);
      v_completed_waves:=greatest(coalesce(v_server_wave,1)-1,0);
      if v_active_seconds<10 then
        v_finish_xp:=1;
        v_score:=0; v_completed_waves:=0;
        select exists(
          select 1 from public.player_progression_events event
          where event.user_id=v_uid and event.source='run'
            and event.created_at>clock_timestamp()-interval '30 seconds'
            and event.metadata->>'short_run'='true'
        ) into v_recent_short_award;
        update public.player_progression_runs set completed_at=now(),
          claimed_score=p_score,credited_score=0 where run_id=p_run_id;
      else
        v_score:=least(p_score,floor(v_duration_seconds*2000)::bigint,
          50000000::bigint);
        update public.player_progression_runs set completed_at=now(),
          claimed_score=p_score,credited_score=v_score where run_id=p_run_id;
      end if;
    end if;
  else
    select match.status,match.mode,player.score,player.wave,
      match.started_at,match.finished_at,coalesce(activity.active_seconds,0),
      coalesce(activity.verified_wave,1)
    into v_match_status,v_match_mode,v_score,v_server_wave,
      v_started_at,v_completed_at,v_active_seconds,v_verified_1v1_wave
    from public.multiplayer_matches match
    join public.multiplayer_players player
      on player.match_id=match.id and player.user_id=v_uid
    left join public.player_progression_1v1_activity activity
      on activity.match_id=match.id and activity.user_id=v_uid
    where match.id=p_run_id;
    if v_match_status is null then raise exception '1v1 result not found'; end if;
    if v_match_status<>'finished' then raise exception '1v1 is not finished'; end if;
    if v_scope<>(v_match_mode||'_1v1') then
      raise exception '1v1 mode does not match the finished result';
    end if;
    v_duration_seconds:=greatest(0,
      extract(epoch from(coalesce(v_completed_at,now())-v_started_at)));
    v_completed_waves:=least(
      greatest(coalesce(v_server_wave,1)-1,0),
      greatest(coalesce(v_verified_1v1_wave,1)-1,0)
    );
    v_active_seconds:=least(21600::bigint,
      greatest(coalesce(v_active_seconds,0),0),floor(v_duration_seconds)::bigint);
    v_score:=least(greatest(coalesce(v_score,0),0),47000::bigint,
      5000::bigint+floor(v_duration_seconds*5000)::bigint);
  end if;
  insert into public.player_stats(user_id,total_gems,high_score,updated_at)
  values(v_uid,0,v_score,now()) on conflict(user_id) do nothing;
  update public.player_stats set high_score=greatest(high_score,v_score),
    updated_at=now() where user_id=v_uid returning high_score into v_high_score;
  if v_run_already_completed then
    select metadata->'xp_breakdown' into v_existing_breakdown
    from public.player_progression_events where user_id=v_uid
      and source='run' and source_key=p_run_id::text;
    return public.get_player_progression()||jsonb_build_object(
      'xp_awarded',0,'xp_breakdown',v_existing_breakdown,
      'high_score',v_high_score);
  end if;
  if v_recent_short_award then
    return public.get_player_progression()||jsonb_build_object(
      'xp_awarded',0,'short_run_throttled',true,'high_score',v_high_score);
  end if;
  v_breakdown:=app_private.run_xp_breakdown(
    v_score,v_completed_waves,v_active_seconds,v_finish_xp);
  v_xp:=(v_breakdown->>'total')::bigint;
  insert into public.player_progression_events(
    user_id,source,source_key,xp_awarded,metadata
  ) values(v_uid,'run',p_run_id::text,v_xp,jsonb_build_object(
    'claimed_score',p_score,'credited_score',v_score,'scope',v_scope,
    'duration_seconds',v_duration_seconds,'active_seconds',v_active_seconds,
    'completed_waves',v_completed_waves,'xp_breakdown',v_breakdown,
    'short_run',v_scope='endless' and v_active_seconds<10
  )) on conflict(user_id,source,source_key) do nothing returning id into v_inserted;
  if v_inserted is not null then
    v_progress:=app_private.apply_player_xp(v_uid,v_xp,true);
    return v_progress||jsonb_build_object(
      'xp_breakdown',v_breakdown,'high_score',v_high_score);
  end if;
  select metadata->'xp_breakdown' into v_existing_breakdown
  from public.player_progression_events where user_id=v_uid
    and source='run' and source_key=p_run_id::text;
  return public.get_player_progression()||jsonb_build_object(
    'xp_awarded',0,'xp_breakdown',v_existing_breakdown,
    'high_score',v_high_score);
end;
$$;

-- Preserve the deployed API name, but route it through the heartbeat-backed
-- calculation so an older client cannot bypass the current XP rules.
create or replace function public.award_completed_run(
  p_run_id uuid,p_score bigint,p_scope text
)
returns jsonb language sql security invoker set search_path='' as $$
  select public.award_completed_run_v2(p_run_id,p_score,p_scope);
$$;

-- Replace the 1v1 completion trigger with the same wave/playtime formula. The
-- match tables provide its wave and timing values, not the browser.
create or replace function app_private.award_finished_1v1_progression()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  v_player record; v_xp bigint; v_inserted uuid;
  v_duration_seconds numeric; v_active_seconds bigint;
  v_verified_wave integer; v_completed_waves integer; v_score_ceiling bigint;
  v_last_heartbeat timestamptz; v_heartbeat_active boolean;
  v_final_increment bigint; v_max_wave integer;
  v_credited_score bigint; v_breakdown jsonb;
begin
  if old.status is not distinct from new.status or new.status<>'finished' then
    return new;
  end if;
  v_duration_seconds:=greatest(0,
    extract(epoch from(coalesce(new.finished_at,now())-new.started_at)));
  v_score_ceiling:=least(47000::bigint,
    5000::bigint+floor(v_duration_seconds*5000)::bigint);
  for v_player in select player.user_id,player.score,player.wave
    from public.multiplayer_players player
    where player.match_id=new.id
  loop
    v_active_seconds:=0; v_verified_wave:=1;
    v_last_heartbeat:=null; v_heartbeat_active:=false;
    select active_seconds,verified_wave,last_heartbeat_at,heartbeat_active
    into v_active_seconds,v_verified_wave,v_last_heartbeat,v_heartbeat_active
    from public.player_progression_1v1_activity
    where match_id=new.id and user_id=v_player.user_id for update;
    v_final_increment:=case when coalesce(v_heartbeat_active,false) then
      least(6::bigint,greatest(0,floor(extract(epoch from(
        coalesce(new.finished_at,clock_timestamp())-
        coalesce(v_last_heartbeat,new.started_at))))::bigint)) else 0 end;
    v_active_seconds:=least(21600::bigint,
      greatest(coalesce(v_active_seconds,0),0)+v_final_increment,
      floor(v_duration_seconds)::bigint);
    v_max_wave:=least(100000,
      1+floor(v_active_seconds::numeric/15)::integer);
    v_verified_wave:=least(
      greatest(coalesce(v_verified_wave,1),coalesce(v_player.wave,1)),
      coalesce(v_verified_wave,1)+1,v_max_wave);
    update public.player_progression_1v1_activity
    set active_seconds=v_active_seconds,verified_wave=v_verified_wave,
      last_heartbeat_at=coalesce(new.finished_at,clock_timestamp()),
      heartbeat_active=false
    where match_id=new.id and user_id=v_player.user_id;
    v_completed_waves:=least(
      greatest(coalesce(v_player.wave,1)-1,0),
      greatest(coalesce(v_verified_wave,1)-1,0)
    );
    v_credited_score:=least(greatest(coalesce(v_player.score,0),0),
      v_score_ceiling);
    v_breakdown:=app_private.run_xp_breakdown(
      v_credited_score,v_completed_waves,v_active_seconds,10);
    v_xp:=(v_breakdown->>'total')::bigint;
    insert into public.player_progression_events(
      user_id,source,source_key,xp_awarded,metadata
    ) values(v_player.user_id,'run',new.id::text,v_xp,jsonb_build_object(
      'claimed_score',v_player.score,'credited_score',v_credited_score,
      'scope',new.mode||'_1v1','duration_seconds',v_duration_seconds,
      'active_seconds',v_active_seconds,'completed_waves',v_completed_waves,
      'xp_breakdown',v_breakdown
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

drop trigger if exists award_finished_1v1_progression
  on public.multiplayer_matches;
create trigger award_finished_1v1_progression
after update of status on public.multiplayer_matches
for each row execute function app_private.award_finished_1v1_progression();
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
  if to_regprocedure(
       'public.sync_1v1_intermission_coins(uuid,text[])'
     ) is not null then
    execute 'revoke all on function public.sync_1v1_intermission_coins(uuid,text[])
      from public,anon,authenticated';
  end if;
end
$$;
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
revoke all on function public.sync_progression_run(uuid,integer,boolean)
  from public,anon,authenticated;
revoke all on function public.sync_1v1_progression(uuid,integer,boolean)
  from public,anon,authenticated;
revoke all on function public.award_completed_run(uuid,bigint,text)
  from public,anon,authenticated;
revoke all on function public.award_completed_run_v2(
  uuid,bigint,text
) from public,anon,authenticated;
revoke all on function app_private.xp_required_for_level(integer)
  from public,anon,authenticated;
revoke all on function app_private.apply_player_xp(uuid,bigint,boolean)
  from public,anon,authenticated;
revoke all on function app_private.run_xp_breakdown(
  bigint,integer,bigint,bigint
) from public,anon,authenticated;
revoke all on function app_private.award_coin_progression()
  from public,anon,authenticated;
revoke all on function app_private.enforce_1v1_score_ceiling()
  from public,anon,authenticated;
revoke all on function app_private.award_finished_1v1_progression()
  from public,anon,authenticated;
revoke all on function app_private.flush_1v1_progression_on_phase_exit()
  from public,anon,authenticated;
revoke all on function public.save_player_high_score(bigint)
  from public,anon,authenticated;
grant execute on function public.claim_player_gem(uuid,text) to authenticated;
do $$
begin
  if to_regprocedure(
       'public.sync_1v1_intermission_coins(uuid,text[])'
     ) is not null then
    execute 'grant execute on function public.sync_1v1_intermission_coins(uuid,text[])
      to authenticated';
  end if;
end
$$;
grant execute on function public.get_player_progression() to authenticated;
grant execute on function public.start_progression_run() to authenticated;
grant execute on function public.sync_progression_run(uuid,integer,boolean)
  to authenticated;
grant execute on function public.sync_1v1_progression(uuid,integer,boolean)
  to authenticated;
grant execute on function public.award_completed_run(uuid,bigint,text)
  to authenticated;
grant execute on function public.award_completed_run_v2(
  uuid,bigint,text
) to authenticated;

-- Per-account ownership and equipped loadout.
create table if not exists public.player_unlocks (
  user_id uuid not null references auth.users(id) on delete cascade,
  item_key text not null,
  item_type text not null,
  rarity text not null,
  unlocked_at timestamptz not null default now(),
  ownership_proven_at timestamptz not null default clock_timestamp(),
  primary key(user_id,item_key)
);
alter table public.player_unlocks
  add column if not exists item_type text,
  add column if not exists rarity text,
  add column if not exists unlocked_at timestamptz not null default now(),
  add column if not exists ownership_proven_at timestamptz
    default clock_timestamp();
update public.player_unlocks
set ownership_proven_at=clock_timestamp()
where ownership_proven_at is null;
alter table public.player_unlocks
  alter column ownership_proven_at set default clock_timestamp(),
  alter column ownership_proven_at set not null;
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
  weapon_score_bonus numeric(6,4),
  passive_ability text,
  weapon_effect text
);
alter table public.extraction_catalog
  add column if not exists display_name text,
  add column if not exists item_type text,
  add column if not exists rarity text,
  add column if not exists character_class text,
  add column if not exists extractable boolean not null default true,
  add column if not exists active boolean not null default true,
  add column if not exists weapon_name text,
  add column if not exists weapon_score_bonus numeric(6,4),
  add column if not exists passive_ability text,
  add column if not exists weapon_effect text;
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
  ('tank_glacier','Glacier','rare','runner',true,'Frost Shield',.05),
  ('runner_courier','Courier','uncommon','runner',true,'Parcel Staff',.04),
  ('runner_tempo','Tempo','uncommon','runner',true,'Rhythm Rod',.04),
  ('tank_reactor','Reactor','rare','runner',true,'Core Maul',.05),
  ('runner_vector','Vector','rare','runner',true,'Arrow Lance',.05),
  ('runner_blitz','Blitz','rare','runner',true,'Volt Cleats',.05),
  ('medic_halo','Halo','epic','runner',true,'Sun Staff',.06),
  ('runner_orbit','Orbit','epic','runner',true,'Ring Blades',.06),
  ('runner_relay','Relay','epic','runner',true,'Circuit Baton',.06),
  ('runner_horizon','Horizon','legendary','runner',true,'Skyline Disc',.07),
  ('runner_velocity','Velocity','legendary','runner',true,'Turbo Spear',.10),
  ('runner_pacer','Pacer','mythic','runner',true,'Relay Rod',0),
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
  ('medic_lifeline','Lifeline','legendary','medic',true,'Rescue Hook',0),
  ('medic_seraph','Seraph','legendary','medic',true,'Halo Staff',0),
  ('tank_atlas','Atlas','legendary','medic',true,'World Maul',0),
  ('medic_revive','Revive','legendary','medic',true,'Phoenix Feather',0),
  ('medic_oracle','Oracle','mythic','medic',true,'Fate Sensor',0),
  -- TANK: less damage or more health without healer-style recovery.
  ('tank_bulwark','Bulwark','common','tank',false,'Tower Shield',.03),
  ('runner_vault','Vault','common','tank',true,'Spring Pole',.03),
  ('tank_guard','Guard','common','tank',true,'Iron Buckler',.03),
  ('tank_brace','Brace','uncommon','tank',true,'Spike Buckler',.15),
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
  ('trickster_rogue','Rogue','common','trickster',false,'Daggers',.04),
  ('trickster_clockwork','Clockwork','uncommon','trickster',true,'Time Cards',.04),
  ('trickster_flicker','Flicker','rare','trickster',true,'Blink Knives',.05),
  ('runner_flare','Flare','epic','trickster',true,'Signal Spear',.06),
  ('trickster_pickpocket','Pickpocket','rare','trickster',true,'Coin Dagger',.05),
  ('trickster_switch','Switch','rare','trickster',true,'Twin Coins',.05),
  ('trickster_gambit','Gambit','legendary','trickster',true,'Loaded Cards',0),
  ('medic_vial','Vial','epic','trickster',true,'Tonic Flask',.06),
  ('trickster_mirage','Mirage','epic','trickster',true,'Prism Fans',.06),
  ('runner_comet','Comet','legendary','trickster',true,'Star Spear',0),
  ('trickster_hex','Hex','mythic','trickster',true,'Void Chakram',0),
  ('trickster_echo','Echo','mythic','trickster',true,'Repeat Knives',0),
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
  ('misc_harvester','Harvester','legendary','misc',true,'Crescent Sickle',0),
  ('misc_muse','Muse','mythic','misc',true,'Dream Harp',0);

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

-- Finished Runner/Healer rules.
with finished_abilities(item_key,passive_ability,weapon_effect) as (values
  ('runner_ace','Earns 10% more score.','Adds 3% distance score.'),
  ('runner_dash','Moves 6% faster and earns 6% more score; its E dash grants a 1-second speed burst and a brief shield.','Adds 3% distance score.'),
  ('runner_stride','Every third lane change grants a 0.25-second dodge shield.','Adds 3% distance score.'),
  ('tank_glacier','Ignores snowflake freeze effects.','Adds 5% distance score.'),
  ('runner_courier','A gem or attack coin grants 25% more score for 4 seconds.','Adds 4% distance score.'),
  ('runner_tempo','Odd waves are 15% faster with 15% more score; even waves are 15% slower with 15% less score.','Adds 4% distance score.'),
  ('tank_reactor','Missing health gradually grants up to 40% more speed and 30% more score.','Adds 5% distance score.'),
  ('runner_vector','Earns 12% more score in an outside lane and blocks the first outside-lane hit each wave.','Adds 5% distance score.'),
  ('runner_blitz','Can dash and destroy the first non-rock obstacle ahead. Cooldown: 10 seconds.','Adds 5% distance score.'),
  ('medic_halo','At full health earns 15% more score; three hitless waves store a revive to 1 HP.','Adds 6% distance score.'),
  ('runner_orbit','Can wrap between outside lanes every 3 seconds.','Adds 6% distance score.'),
  ('runner_relay','Every two completed waves overcharges a heart; losing it clears the closest obstacle in every lane.','Adds 6% distance score.'),
  ('runner_horizon','Previews upcoming obstacle counts; in 1v1 it reveals opponent purchases.','Adds 7% distance score.'),
  ('runner_velocity','Each hitless second grants 1% speed and 2% score, up to 100% speed and 200% score; a hit resets it.','Adds 5% base speed and 10% score.'),
  ('runner_pacer','Starts each wave with 3x speed and 5x score for 15 seconds; once per run can continue after death as an owned non-Runner.','Adds 10 score after every lane change.'),
  ('runner_zenith','Gains Runner abilities at waves 5, 7, 9, 10, and 12; at wave 15 can stop time for 10 seconds, heal fully, add 15000 score, then permanently slow obstacles 25%.','Adds 8% distance score.'),
  ('medic_patch','Heals 1.5 HP after each wave but cannot exceed 4 HP.','Adds 3% distance score.'),
  ('medic_bloom','The first gem each wave heals 0.5 HP.','Adds 3% distance score.'),
  ('medic_remedy','The first snowflake each wave heals 1 HP.','Adds 3% distance score.'),
  ('medic_salve','At 1 HP or less, completing a wave heals 1.5 HP.','Adds 3% distance score.'),
  ('medic_reserve','Completing a wave at full HP stores 0.5 HP that can be used manually.','Adds 4% distance score.'),
  ('medic_sprout','Once per wave can seed a non-barrel obstacle so it deals 0.5 less damage for two waves; up to two seeds.','Adds 4% distance score.'),
  ('medic_mender','Twenty hitless seconds heals 0.5 HP once per wave.','Adds 5% distance score.'),
  ('medic_pulse','On lethal damage, a 10-second timed-key challenge can revive for 1 HP at 10 hits, 2 HP at 20, or full HP at 30.','Adds 5% distance score.'),
  ('medic_tonic','Gems become ingredients; brew one 1, 2, or 3 HP potion for 5, 10, or 15 ingredients and use it manually. Wave healing is 0.5 HP.','Adds 5% distance score.'),
  ('medic_suture','Can reach 5 HP. Restores to full every third wave; otherwise heals 1 HP only every second wave.','Adds 6% distance score.'),
  ('medic_beacon','Can reach 5.5 HP. At 1 HP, glows, disables spikes, and slows all obstacles by 50%.','Adds 6% distance score.'),
  ('medic_lifeline','Once per run, lethal damage restores maximum HP and makes that obstacle harmless; can pause and choose another lane three times.','Activates the three-use lane Rescue Hook.'),
  ('medic_seraph','A hit can teleport to an empty lane; chance starts at 100% and drops 5% per activation. At 0%, Divine Recovery activates.','Each gem has a 10% chance to heal 1 HP.'),
  ('tank_atlas','Starts at 4 HP, can reach 7 HP, and heals 1 HP after each wave. Every obstacle hit shortens Sky Crush by 0.5 seconds, to a 1-second minimum.','World Maul halves obstacle damage for 2 seconds after changing lanes.'),
  ('medic_revive','Lethal damage leaves 0.5 HP and starts permanent flight: logs and spikes miss, speed and score rise 50%, and healing is disabled.','After taking a hit, destroys the first obstacle of every later wave.'),
  ('medic_oracle','Chooses a prophecy each wave; successes grant its reward and 5% permanent score, while failure costs 1 HP.','Each wave, the first hit deals 0, the second half damage, and later hits full damage.')
)
update public.extraction_catalog catalog
set passive_ability=ability.passive_ability,
    weapon_effect=ability.weapon_effect
from finished_abilities ability
where catalog.item_key=ability.item_key
  and catalog.item_type='character'
  and catalog.character_class in ('runner','medic');

-- Finished Tank, Trickster, and Misc contracts from the attached balance pass.
with finished_abilities(
  item_key,rarity,passive_ability,weapon_effect,weapon_score_bonus
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
  ('trickster_gambit','legendary','Draws five visible cards each wave into a 10-card hand. Poker hands grant escalating one-wave and permanent HP, score, defense, revive, coin-steal, and 1v1 doubled-attack rewards, from High Card through Royal Flush.','Loaded Cards stay visible between waves and enable the poker-hand rewards.',0),
  ('medic_vial','epic','Gem collection costs 1 HP and wave end heals to full. Once per 1v1, E changes obstacle allegiance for 30 seconds: hazards heal by type, melons damage and subtract score, currents pull, and gems damage both players; Endless applies the allegiance effect to Vial.','Tonic Flask adds 6% distance score.',.06),
  ('trickster_mirage','epic','Once per 1v1 wave, E enters the opponent field for 5 seconds invulnerably; sharing their lane every 0.5 seconds deals 1 HP, then Mirage takes 1 HP when it ends.','Prism Fans add 6% distance score.',.06),
  ('runner_comet','legendary','In 1v1 intermission, obstacle prices are halved and quantities doubled; E can remove natural incoming hazards at fixed costs. Shared HEATFEAST stores spent coins and unlocks coin, damage, tax, removal, sending, and split-attack bonuses as it is consumed.','Star Spear multiplies attack-coin income by 1.5.',0),
  ('trickster_hex','mythic','On even waves, E enters a 15-second Void Realm and can collect at most 25 Damnation per visit without advancing the wave. Void Cut phases through danger for 0.5 seconds without destroying obstacles. Hades requires 20 correctly timed rune dodges before three misses.','Press R to throw Void Chakram with a 10-second cooldown, deleting one obstacle and tripling it toward the opponent in 1v1.',0),
  ('trickster_echo','mythic','Completes ordered Mirror quests for six shards and selected non-mythic passives. The Knowing unlocks an 8-HP mirror phase with 80% reduction, reflected damage, shard-powered score, Mirror Realm healing, and a final reflective phase; Mirror Realm lasts 10 seconds and closes automatically.','Repeat Knives channel the Mirror quests and the timed Mirror Realm.',0),
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
  ('misc_muse','mythic','Caps the field at five obstacles and once pauses for a 15-second rhythm challenge capped at 30 hits. Its separate Muse theme and accuracy tiers unlock permanent score, slow, defense, healing music, notes, Disco Unleash, perfect revives, escalating replay challenges, and an 8-HP finale.','Dream Harp powers the Muse-themed rhythm challenge and Muse Mix.',0),
  ('tank_atlas','legendary','Starts at 4 HP, can reach 7 HP, and heals 1 HP after each wave. Every obstacle hit shortens Sky Crush by 0.5 seconds, to a 1-second minimum.','World Maul halves obstacle damage for 2 seconds after changing lanes.',0)
)
update public.extraction_catalog catalog
set rarity=ability.rarity,
    passive_ability=ability.passive_ability,
    weapon_effect=ability.weapon_effect,
    weapon_score_bonus=ability.weapon_score_bonus
from finished_abilities ability
where catalog.item_key=ability.item_key
  and catalog.item_type='character';

-- Existing ownership follows the catalog rarity without granting new items.
update public.player_unlocks unlock
set rarity=catalog.rarity
from public.extraction_catalog catalog
where catalog.item_key=unlock.item_key
  and catalog.item_type=unlock.item_type
  and unlock.rarity is distinct from catalog.rarity;

-- Server-owned score modifiers apply equally to positive 1v1 attack-point
-- awards. Spark reads only receipt-backed gems for the exact match.
alter table public.multiplayer_players
  add column if not exists last_damage_at timestamptz,
  add column if not exists wave_started_at timestamptz not null default now(),
  add column if not exists run_started_at timestamptz not null default now();

create or replace function app_private.one_v_one_attack_point_multiplier(
  p_character_key text,p_wave integer,p_hearts numeric,p_max_hearts numeric,
  p_lane_index integer,p_lane_count integer,p_last_damage_at timestamptz,
  p_wave_started_at timestamptz,p_run_started_at timestamptz
)
returns numeric language plpgsql volatile security definer set search_path='' as $$
declare
  v_multiplier numeric:=1; v_missing_ratio numeric:=0;
  v_hitless_seconds numeric:=0; v_weapon_bonus numeric:=0;
  v_character_class text:='runner';
begin
  select coalesce(weapon_score_bonus,0),character_class
  into v_weapon_bonus,v_character_class
  from public.extraction_catalog
  where item_key=p_character_key and item_type='character' and active;
  if p_max_hearts>0 then
    v_missing_ratio:=greatest(0,least(1,(p_max_hearts-p_hearts)/p_max_hearts));
  end if;
  v_multiplier:=case p_character_key
    when 'runner_ace' then 1.10
    when 'runner_dash' then 1.06
    when 'runner_courier' then 1.25
    when 'runner_tempo' then case when mod(greatest(1,p_wave),2)=1
      then 1.15 else 0.85 end
    when 'tank_reactor' then 1+0.30*v_missing_ratio
    when 'runner_vector' then case
      when p_lane_index in(0,greatest(0,p_lane_count-1)) then 1.12 else 1 end
    when 'medic_halo' then case when p_hearts>=p_max_hearts then 1.15 else 1 end
    when 'runner_velocity' then 1
    when 'runner_pacer' then case when statement_timestamp()<coalesce(
      p_wave_started_at,statement_timestamp())+interval '15 seconds'
      then 5 else 1 end
    when 'runner_zenith' then
      (1+least(0.60,greatest(0,p_wave-1)*0.02))
      *case when p_wave>=7 and p_hearts>=p_max_hearts then 1.15 else 1 end
      *case when p_wave>=12 then 1.10*1.06 else 1 end
    when 'tank_guard' then 0.90
    when 'tank_colossus' then 1+greatest(0,p_hearts-3)*0.05
    when 'trickster_phantom' then case when mod(greatest(1,p_wave),2)=0
      then 2 else 1 end
    when 'trickster_pickpocket' then 2
    when 'runner_comet' then 1.5
    else 1
  end;
  if v_character_class='trickster' then
    v_multiplier:=v_multiplier*1.15;
  end if;
  if p_character_key='runner_velocity' then
    v_hitless_seconds:=least(100,greatest(0,extract(epoch from
      statement_timestamp()-coalesce(
        p_last_damage_at,p_run_started_at,statement_timestamp()
      ))));
    v_multiplier:=1+v_hitless_seconds*0.02;
  end if;
  v_weapon_bonus:=case p_character_key
    when 'runner_velocity' then .10
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
  return greatest(.1,round(v_multiplier*(1+v_weapon_bonus),4));
end;
$$;
revoke all on function app_private.one_v_one_attack_point_multiplier(
  text,integer,numeric,numeric,integer,integer,timestamptz,timestamptz,timestamptz
) from public,anon,authenticated;

create or replace function app_private.one_v_one_attack_point_multiplier(
  p_match_id uuid,p_user_id uuid,p_character_key text,p_wave integer,
  p_hearts numeric,p_max_hearts numeric,p_lane_index integer,
  p_lane_count integer,p_last_damage_at timestamptz,
  p_wave_started_at timestamptz,p_run_started_at timestamptz
)
returns numeric language plpgsql volatile security definer set search_path='' as $$
declare v_multiplier numeric; v_gems bigint:=0;
begin
  v_multiplier:=app_private.one_v_one_attack_point_multiplier(
    p_character_key,p_wave,p_hearts,p_max_hearts,p_lane_index,p_lane_count,
    p_last_damage_at,p_wave_started_at,p_run_started_at
  );
  if p_character_key='runner_spark' then
    select count(*) into v_gems
    from public.player_progression_events
    where user_id=p_user_id and source='gem'
      and metadata->>'context_id'=p_match_id::text;
    v_multiplier:=v_multiplier*(1+v_gems*.01);
  end if;
  return greatest(.1,round(v_multiplier,4));
end;
$$;
revoke all on function app_private.one_v_one_attack_point_multiplier(
  uuid,uuid,text,integer,numeric,numeric,integer,integer,timestamptz,
  timestamptz,timestamptz
) from public,anon,authenticated;

create or replace function app_private.multiply_1v1_attack_point_award()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_lane_count integer:=5; v_multiplier numeric:=1;
begin
  if new.obstacle_points<=old.obstacle_points then return new; end if;
  select coalesce(rules.lane_count,5) into v_lane_count
  from public.multiplayer_matches match_row
  left join app_private.one_v_one_map_rules rules on rules.map_key=match_row.map_key
  where match_row.id=new.match_id;
  v_multiplier:=app_private.one_v_one_attack_point_multiplier(
    new.match_id,new.user_id,new.character_key,new.wave,new.hearts,
    new.max_hearts,coalesce(new.lane_index,0),v_lane_count,
    new.last_damage_at,new.wave_started_at,new.run_started_at
  );
  new.obstacle_points:=old.obstacle_points
    +(new.obstacle_points-old.obstacle_points)*v_multiplier;
  return new;
end;
$$;
revoke all on function app_private.multiply_1v1_attack_point_award()
  from public,anon,authenticated;

create or replace function app_private.multiply_1v1_point_receipt()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_player public.multiplayer_players; v_lane_count integer:=5;
begin
  select * into v_player from public.multiplayer_players
  where match_id=new.match_id and user_id=new.user_id;
  if v_player.user_id is null then return new; end if;
  select coalesce(rules.lane_count,5) into v_lane_count
  from public.multiplayer_matches match_row
  left join app_private.one_v_one_map_rules rules on rules.map_key=match_row.map_key
  where match_row.id=new.match_id;
  new.points_awarded:=round(new.points_awarded*
    app_private.one_v_one_attack_point_multiplier(
      new.match_id,new.user_id,v_player.character_key,v_player.wave,
      v_player.hearts,v_player.max_hearts,coalesce(v_player.lane_index,0),
      v_lane_count,v_player.last_damage_at,v_player.wave_started_at,
      v_player.run_started_at
    ),4);
  return new;
end;
$$;
revoke all on function app_private.multiply_1v1_point_receipt()
  from public,anon,authenticated;
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
      and weapon_score_bonus>=0 and weapon_score_bonus<=1
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
  ('trickster_rogue','character','common')
) starter(item_key,item_type,rarity)
on conflict(user_id,item_key) do update
set item_type=excluded.item_type,rarity=excluded.rarity;
insert into public.player_loadouts(user_id,class_key,character_key,updated_at)
select id,'runner','runner_ace',now() from auth.users
on conflict(user_id) do nothing;

-- Keep future signups on the same four-starter rule. This function deliberately
-- names every granted row; neither the catalog nor a saved loadout is an
-- ownership source.
create or replace function public.provision_player_starters()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.player_stats(user_id,total_gems,high_score,updated_at)
  values(new.id,0,0,now()) on conflict(user_id) do nothing;

  insert into public.player_unlocks(
    user_id,item_key,item_type,rarity,unlocked_at
  )
  select new.id,starter.item_key,starter.item_type,starter.rarity,now()
  from (values
    ('runner','class','common'),('medic','class','common'),
    ('tank','class','common'),('trickster','class','common'),
    ('runner_ace','character','common'),
    ('medic_patch','character','common'),
    ('tank_bulwark','character','common'),
    ('trickster_rogue','character','common')
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
revoke all on function public.provision_player_starters()
  from public,anon,authenticated;
drop trigger if exists provision_player_starters_after_signup on auth.users;
create trigger provision_player_starters_after_signup
after insert on auth.users
for each row execute function public.provision_player_starters();

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

-- A global reset advances the ownership proof boundary without deleting shop
-- receipts or admin history. Proof created before the latest boundary remains
-- historical, but can no longer recreate a revoked character on a rerun.
create table if not exists app_private.character_ownership_resets(
  reset_key text primary key,
  reset_scope text not null,
  reset_at timestamptz not null,
  affected_users integer not null default 0,
  revoked_characters integer not null default 0,
  preserved_non_character_unlocks integer not null default 0,
  completed_at timestamptz
);
revoke all on table app_private.character_ownership_resets
  from public,anon,authenticated;

-- Freeze ownership writes while the proof snapshot and cleanup run. Both box
-- extraction and admin grants write player_unlocks before their receipt/audit
-- row, so this order lets an in-flight transaction finish and prevents a new
-- legitimate unlock from landing between verification and deletion.
lock table public.player_stats in share row exclusive mode;
lock table public.player_unlocks in share row exclusive mode;
lock table public.player_loadouts in share row exclusive mode;
lock table public.extraction_transactions in share row exclusive mode;
do $player_01_lock_admin_audit$
begin
  if to_regclass('public.admin_command_audit') is not null then
    execute 'lock table public.admin_command_audit in share row exclusive mode';
  end if;
end
$player_01_lock_admin_audit$;

create temporary table verified_character_ownership (
  user_id uuid not null,
  item_key text not null,
  source text not null,
  proof_at timestamptz not null,
  primary key(user_id,item_key)
) on commit drop;

insert into verified_character_ownership(user_id,item_key,source,proof_at)
select users.id,starter.item_key,'starter','infinity'::timestamptz
from auth.users users
cross join (values
  ('runner_ace'),('medic_patch'),('tank_bulwark'),('trickster_rogue')
) starter(item_key)
on conflict(user_id,item_key) do nothing;

insert into verified_character_ownership(user_id,item_key,source,proof_at)
select distinct on(receipt.user_id,receipt.item_key)
  receipt.user_id,receipt.item_key,
  case when receipt.box_type='direct'
    then 'direct_purchase' else 'extraction' end,
  receipt.created_at
from public.extraction_transactions receipt
join public.extraction_catalog catalog on catalog.item_key=receipt.item_key
  and catalog.item_type='character'
where receipt.item_type='character' and receipt.is_new
  and receipt.created_at>coalesce((
    select max(reset.reset_at)
    from app_private.character_ownership_resets reset
    where reset.reset_scope='global_characters'
  ),'-infinity'::timestamptz)
order by receipt.user_id,receipt.item_key,receipt.created_at desc,receipt.id desc
on conflict(user_id,item_key) do update
set source=excluded.source,proof_at=excluded.proof_at
where verified_character_ownership.source<>'starter'
  and excluded.proof_at>verified_character_ownership.proof_at;

-- The row's wall-clock proof closes the small transaction-start race where an
-- extraction can begin before a reset, wait on the reset lock, and insert its
-- legitimate unlock afterward with an older transaction-time receipt.
insert into verified_character_ownership(user_id,item_key,source,proof_at)
select unlock.user_id,unlock.item_key,'post_reset_unlock',
       unlock.ownership_proven_at
from public.player_unlocks unlock
join public.extraction_catalog catalog on catalog.item_key=unlock.item_key
  and catalog.item_type='character'
where unlock.item_type='character'
  and unlock.ownership_proven_at>coalesce((
    select max(reset.reset_at)
    from app_private.character_ownership_resets reset
    where reset.reset_scope='global_characters'
  ),'-infinity'::timestamptz)
on conflict(user_id,item_key) do update
set source=excluded.source,proof_at=excluded.proof_at
where verified_character_ownership.source<>'starter'
  and excluded.proof_at>verified_character_ownership.proof_at;

do $player_01_admin_proof$
begin
  if to_regclass('public.admin_command_audit') is not null then
    execute $sql$
      insert into verified_character_ownership(
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
        and audit.created_at>coalesce((
          select max(reset.reset_at)
          from app_private.character_ownership_resets reset
          where reset.reset_scope='global_characters'
        ),'-infinity'::timestamptz)
      order by audit.target_user_id,audit.result->>'item_key',
        audit.created_at desc,audit.id desc
      on conflict(user_id,item_key) do update
      set source=excluded.source,proof_at=excluded.proof_at
      where verified_character_ownership.source<>'starter'
        and excluded.proof_at>verified_character_ownership.proof_at
    $sql$;

    -- A later successful admin revoke cancels older paid/admin proof.
    -- This prevents a subsequent bad bulk backfill from resurrecting a
    -- deliberately revoked character.
    execute $sql$
      delete from verified_character_ownership proof
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
$player_01_admin_proof$;

-- Restore only ledger/audit-backed ownership that an earlier repair may have
-- removed. The equipped character and catalog membership alone never grant an
-- unlock.
insert into public.player_unlocks(
  user_id,item_key,item_type,rarity,unlocked_at
)
select proof.user_id,proof.item_key,'character',catalog.rarity,proof.proof_at
from verified_character_ownership proof
join public.extraction_catalog catalog on catalog.item_key=proof.item_key
  and catalog.item_type='character'
where proof.source<>'starter'
on conflict(user_id,item_key) do update
set item_type=excluded.item_type,rarity=excluded.rarity;

insert into app_private.player_unlock_quarantine(
  batch_key,user_id,item_key,item_type,rarity,original_unlocked_at,reason
)
select
  'player-01-character-ownership-repair-v2-2026-09-06',
  unlock.user_id,unlock.item_key,unlock.item_type,unlock.rarity,
  unlock.unlocked_at,
  'No starter, paid extraction, direct purchase, or admin-grant proof'
from public.player_unlocks unlock
join public.extraction_catalog catalog
  on catalog.item_key=unlock.item_key and catalog.item_type='character'
left join verified_character_ownership proof
  on proof.user_id=unlock.user_id and proof.item_key=unlock.item_key
where unlock.item_type='character' and proof.item_key is null
on conflict(batch_key,user_id,item_key) do nothing;

update public.player_loadouts loadout
set class_key=case coalesce((
      select catalog.character_class from public.extraction_catalog catalog
      where catalog.item_key=loadout.character_key
        and catalog.item_type='character'
    ),loadout.class_key)
      when 'medic' then 'medic'
      when 'tank' then 'tank'
      when 'trickster' then 'trickster'
      else 'runner'
    end,
    character_key=case coalesce((
      select catalog.character_class from public.extraction_catalog catalog
      where catalog.item_key=loadout.character_key
        and catalog.item_type='character'
    ),loadout.class_key)
      when 'medic' then 'medic_patch'
      when 'tank' then 'tank_bulwark'
      when 'trickster' then 'trickster_rogue'
      else 'runner_ace'
    end,
    updated_at=now()
where not exists (
  select 1 from verified_character_ownership proof
  where proof.user_id=loadout.user_id
    and proof.item_key=loadout.character_key
)
and not exists (
  select 1
  from public.admin_users admin
  join public.player_stats stats on stats.user_id=admin.user_id
  join public.extraction_catalog catalog
    on catalog.item_key=loadout.character_key
   and catalog.item_type='character' and catalog.active
  where admin.user_id=loadout.user_id
    and admin.role in('main','co_admin')
    and stats.admin_test_mode_enabled
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
  where item_key=new.character_key and item_type='character' and active;
  if v_character_class is null then
    raise exception 'Unknown loadout character';
  end if;
  if not exists(
    select 1 from public.player_unlocks unlock
    where unlock.user_id=new.user_id
      and unlock.item_key=new.character_key
      and unlock.item_type='character'
  ) then
    raise exception 'Loadout character is not owned';
  end if;
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
        exists(
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

-- Player 08 reported economy/progression rules. The exact same definitions
-- also live in the timestamped forward migration so this current-state query
-- and sequential migration installs converge.
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
      10000000::numeric*p_level::numeric*(p_level::numeric+1)
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
  select 20000000::bigint*(greatest(p_level,0)::bigint+1);
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
        +4::numeric*greatest(p_lifetime_xp,0)::numeric/10000000::numeric
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

-- Private hitless-run state. The chain carries between waves, caps internally
-- once it reaches the maximum reward, and is reset only by damage or a new run.
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

create or replace function app_private.endless_gem_streak_award(
  p_consecutive_pickups bigint
)
returns bigint
language sql
immutable
security invoker
set search_path=''
as $$
  select case
    when coalesce(p_consecutive_pickups,0)<=0 then 0
    when p_consecutive_pickups<=5 then p_consecutive_pickups
    when p_consecutive_pickups<=10 then 5
    when p_consecutive_pickups=11 then 6
    else 7
  end;
$$;
revoke all on function app_private.endless_gem_streak_award(bigint)
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

-- Compatibility signature retained. Endless pickups use a hitless-run reward
-- chain; 1v1 pickups remain one gem. No pickup grants XP immediately.
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
    select streak_row.streak
    into v_stored_streak
    from public.player_endless_gem_streaks streak_row
    where streak_row.run_id=p_context_id and streak_row.user_id=v_uid
    for update;
    if not found then
      select count(*)::bigint into v_stored_streak
      from public.player_progression_events event
      where event.user_id=v_uid and event.source='gem'
        and event.metadata->>'context_id'=p_context_id::text
        and event.metadata->>'context_type'='endless';
    end if;
    v_streak:=least(12,greatest(coalesce(v_stored_streak,0),0)+1);
    v_gems_awarded:=app_private.endless_gem_streak_award(v_streak);
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

  select coalesce(sum(
    case
      when coalesce(event.metadata->>'gems_awarded','')~'^[0-9]{1,18}$'
        then greatest(
          1::numeric,
          least(1000000::numeric,(event.metadata->>'gems_awarded')::numeric)
        )
      else 1::numeric
    end
  ),0)::bigint into v_gem_count
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
    coalesce(sum(
      case
        when coalesce(event.metadata->>'gems_awarded','')~'^[0-9]{1,18}$'
          then greatest(
            1::numeric,
            least(1000000::numeric,(event.metadata->>'gems_awarded')::numeric)
          )
        else 1::numeric
      end
    ),0)::bigint as gem_count
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

-- Recomputed accounts below the Level 20 gate cannot remain queued for
-- Ranked. Player 01 may run before the multiplayer tables are installed.
do $player_01_remove_ineligible_ranked_queue$
begin
  if to_regclass('public.multiplayer_queue') is not null then
    delete from public.multiplayer_queue queue
    using public.player_stats stats
    where queue.user_id=stats.user_id
      and lower(coalesce(queue.mode,'casual'))='ranked'
      and stats.level<20;
  end if;
end
$player_01_remove_ineligible_ranked_queue$;

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
    when 'legendary' then 175
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
set rarity='common'
where item_key='trickster_rogue'
  and item_type='character'
  and rarity is distinct from 'common';
update public.player_unlocks
set rarity='common'
where item_key='trickster_rogue'
  and item_type='character'
  and rarity is distinct from 'common';

insert into public.player_unlocks(
  user_id,item_key,item_type,rarity,unlocked_at
)
select users.id,starter.item_key,'character',starter.rarity,now()
from auth.users users
cross join(values
  ('runner_ace','common'),
  ('medic_patch','common'),
  ('tank_bulwark','common'),
  ('trickster_rogue','common')
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
    ('trickster_rogue','character','common')
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

-- The canonical provenance repair above already quarantined and removed only
-- character grants lacking starter, extraction/direct-purchase, or admin proof.
-- Do not repeat that locked destructive pass in this final-definition section.

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
  'Receipt-backed gem claim. Endless awards 1-5, holds at 5 for five pickups, then awards 6 and caps at 7 until damage; 1v1 awards one gem.';
comment on function public.reset_endless_gem_streak(uuid) is
  'Clears the caller''s current verified Endless gem streak after damage.';
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
     or app_private.cumulative_xp_for_level(1)<>20000000
     or app_private.cumulative_xp_for_level(2)<>60000000
     or app_private.cumulative_xp_for_level(20)<>4200000000
     or app_private.xp_required_for_level(0)<>20000000
     or app_private.xp_required_for_level(19)<>400000000 then
    raise exception 'Player 08 XP threshold formula is incorrect';
  end if;
  if (app_private.endless_run_xp_breakdown(8000,0)->>'total')::bigint
       <>16000000
     or (app_private.endless_run_xp_breakdown(8000,3)->>'total')::bigint
       <>16300000 then
    raise exception 'Player 08 Endless XP award formula is incorrect';
  end if;
  if array(
       select app_private.endless_gem_streak_award(pickup)
       from generate_series(1,14) pickup
       order by pickup
     )<>array[1,2,3,4,5,5,5,5,5,5,6,7,7,7]::bigint[] then
    raise exception 'Endless gem streak reward curve is incorrect';
  end if;
  if app_private.duplicate_gem_refund('common')<>1
     or app_private.duplicate_gem_refund('epic')<>1
     or app_private.duplicate_gem_refund('legendary')<>2
     or app_private.duplicate_gem_refund('mythic')<>3
     or app_private.direct_catalog_price('common')<>5
     or app_private.direct_catalog_price('uncommon')<>10
     or app_private.direct_catalog_price('rare')<>15
     or app_private.direct_catalog_price('epic')<>25
     or app_private.direct_catalog_price('legendary')<>175
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
    select 1 from public.extraction_catalog
    where item_key='trickster_rogue' and rarity<>'common'
  ) then raise exception 'Rogue must remain a Common starter'; end if;
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

comment on table public.player_stats is
  'Permanent signed-in gems, high score, level, and XP; client mutations use receipt-backed RPCs.';
comment on table public.player_unlocks is
  'Per-account ownership. One starter kit per gameplay class is included; all other kits and cosmetics require extraction, direct purchase, or an admin grant.';
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
      and kit.character_class<>'tank'
  )<>64 then
    raise exception 'Not all 64 non-Tank character kits were installed';
  end if;
  if exists(
    select 1 from preserved_tank_catalog_rows preserved
    left join public.extraction_catalog catalog using(item_key)
    where catalog.item_key is null
       or to_jsonb(catalog) is distinct from preserved.row_data
  ) then raise exception 'Player 01 attempted to modify a Tank character'; end if;
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
      and not exists(
        select 1
        from public.admin_users admin
        join public.player_stats stats on stats.user_id=admin.user_id
        join public.extraction_catalog test_catalog
          on test_catalog.item_key=loadout.character_key
         and test_catalog.item_type='character' and test_catalog.active
        where admin.user_id=loadout.user_id
          and admin.role in('main','co_admin')
          and stats.admin_test_mode_enabled
      )
  ) then raise exception 'A loadout uses an unowned character'; end if;
  if exists(
    select 1 from auth.users users
    cross join(values
      ('runner_ace'),('medic_patch'),('tank_bulwark'),('trickster_rogue')
    ) starter(item_key)
    left join public.player_unlocks unlock on unlock.user_id=users.id
      and unlock.item_key=starter.item_key and unlock.item_type='character'
    where unlock.item_key is null
  ) then raise exception 'A player is missing an included starter character'; end if;
  if to_regprocedure('public.provision_player_starters()') is null
     or has_function_privilege(
       'authenticated','public.provision_player_starters()','EXECUTE'
     )
     or has_function_privilege(
       'anon','public.provision_player_starters()','EXECUTE'
     )
     or not exists(
       select 1 from pg_trigger trigger_row
       where trigger_row.tgrelid='auth.users'::regclass
         and trigger_row.tgname='provision_player_starters_after_signup'
         and not trigger_row.tgisinternal
     ) then raise exception 'Safe signup starter provisioning is not installed'; end if;
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
  if (select count(*) from public.extraction_catalog
      where item_type='character' and active
        and passive_ability is not null
        and weapon_effect is not null)<>80 then
    raise exception 'Character ability metadata is incomplete';
  end if;
  if exists(
    select 1 from(values
      ('trickster_flicker','rare'),
      ('runner_flare','epic'),
      ('trickster_gambit','legendary'),
      ('trickster_hex','mythic')
    ) expected(item_key,rarity)
    left join public.extraction_catalog catalog using(item_key)
    where catalog.rarity is distinct from expected.rarity
  ) then raise exception 'Attached character rarities are incomplete'; end if;
  if to_regprocedure(
       'public.sync_1v1_intermission_coins(uuid,text[])'
     ) is not null and (
       not has_function_privilege(
         'authenticated',
         'public.sync_1v1_intermission_coins(uuid,text[])',
         'EXECUTE'
       )
       or has_function_privilege(
         'authenticated',
         'public.award_1v1_points(uuid,text,integer,text)',
         'EXECUTE'
       )
     ) then
    raise exception 'Intermission coin RPC permissions are unsafe';
  end if;
  if to_regclass('public.multiplayer_mushroom_events') is not null and (
       position('multiplayer_mushroom_events' in pg_get_functiondef(
         to_regprocedure('app_private.enforce_1v1_score_ceiling()')
       ))=0
       or position('second_death_bonus_awarded' in pg_get_functiondef(
         to_regprocedure('app_private.enforce_1v1_score_ceiling()')
       ))=0
       or position('zenith_time_stop_used' in pg_get_functiondef(
         to_regprocedure('app_private.enforce_1v1_score_ceiling()')
       ))=0
       or position('then 15000' in pg_get_functiondef(
         to_regprocedure('app_private.enforce_1v1_score_ceiling()')
       ))=0
     ) then
    raise exception 'Player 01 did not preserve MAPS MISC score bonuses';
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
     'player-01-character-ownership-repair-v2-2026-09-06')
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
    and to_regprocedure(
      'public.sync_progression_run(uuid,integer,boolean)'
    ) is not null
    and to_regprocedure(
      'public.sync_1v1_progression(uuid,integer,boolean)'
    ) is not null
    and to_regprocedure('public.award_completed_run(uuid,bigint,text)') is not null
    and to_regprocedure(
      'public.award_completed_run_v2(uuid,bigint,text)'
    ) is not null
    as progression_rpcs_installed,
  has_function_privilege(
    'authenticated',
    'public.award_completed_run_v2(uuid,bigint,text)',
    'EXECUTE'
  ) and not has_function_privilege(
    'anon',
    'public.award_completed_run_v2(uuid,bigint,text)',
    'EXECUTE'
  ) as xp_sources_rpc_secure,
  position('award_completed_run_v2' in pg_get_functiondef(
    to_regprocedure('public.award_completed_run(uuid,bigint,text)')
  ))>0 as legacy_run_rpc_uses_secure_xp,
  has_function_privilege(
    'authenticated','public.sync_progression_run(uuid,integer,boolean)','EXECUTE'
  ) and not has_function_privilege(
    'anon','public.sync_progression_run(uuid,integer,boolean)','EXECUTE'
  ) and to_regprocedure(
    'public.sync_progression_run(uuid,integer)'
  ) is null as progression_heartbeat_secure,
  has_function_privilege(
    'authenticated','public.sync_1v1_progression(uuid,integer,boolean)','EXECUTE'
  ) and not has_function_privilege(
    'anon','public.sync_1v1_progression(uuid,integer,boolean)','EXECUTE'
  ) as versus_progression_heartbeat_secure,
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
  coalesce(has_function_privilege(
    'authenticated',to_regprocedure(
      'public.sync_1v1_intermission_coins(uuid,text[])'), 'EXECUTE'
  ),false) and coalesce(not has_function_privilege(
    'anon',to_regprocedure(
      'public.sync_1v1_intermission_coins(uuid,text[])'), 'EXECUTE'
  ),true) and not has_function_privilege(
    'authenticated','public.award_1v1_points(uuid,text,integer,text)','EXECUTE'
  ) and coalesce(not has_function_privilege(
    'authenticated',to_regprocedure(
      'public.award_1v1_points(uuid,text,integer)'), 'EXECUTE'
  ),true) as intermission_coin_rpc_secure,
  coalesce(position('Coin pickup allowance reached' in pg_get_functiondef(
    to_regprocedure('public.sync_1v1_intermission_coins(uuid,text[])')
  ))>0,false) as coin_verified_envelope_installed,
  (to_regclass('app_private.one_v_one_map_rules') is null or (
    position('one_v_one_map_rules' in pg_get_functiondef(
      to_regprocedure('public.sync_1v1_intermission_coins(uuid,text[])')
    ))>0 and position('v_balance_before' in pg_get_functiondef(
      to_regprocedure('public.sync_1v1_intermission_coins(uuid,text[])')
    ))>0
  )) as map_coin_rewards_preserved,
  (to_regclass('public.multiplayer_mushroom_events') is null or (
    position('multiplayer_mushroom_events' in pg_get_functiondef(
      to_regprocedure('app_private.enforce_1v1_score_ceiling()')
    ))>0 and position('second_death_bonus_awarded' in pg_get_functiondef(
      to_regprocedure('app_private.enforce_1v1_score_ceiling()')
    ))>0 and position('zenith_time_stop_used' in pg_get_functiondef(
      to_regprocedure('app_private.enforce_1v1_score_ceiling()')
    ))>0 and position('then 15000' in pg_get_functiondef(
      to_regprocedure('app_private.enforce_1v1_score_ceiling()')
    ))>0
  )) as map_score_bonuses_preserved,
  (select count(*) from public.extraction_catalog
    where item_type='character' and active
      and passive_ability is not null
      and weapon_effect is not null)=80
    as character_metadata_complete,
  position('Gem pickups arrived too quickly' in pg_get_functiondef(
    to_regprocedure('public.claim_player_gem(uuid,text)')
  ))>0 as gem_spawn_envelope_installed,
  position('heartbeat_active' in pg_get_functiondef(
    to_regprocedure('public.claim_player_gem(uuid,text)')
  ))>0 and position('active_seconds' in pg_get_functiondef(
    to_regprocedure('public.claim_player_gem(uuid,text)')
  ))>0 and position('heartbeat_active' in pg_get_functiondef(
    to_regprocedure('public.award_1v1_points(uuid,text,integer,text)')
  ))>0 and position('active_seconds' in pg_get_functiondef(
    to_regprocedure('public.award_1v1_points(uuid,text,integer,text)')
  ))>0 as pickup_receipts_use_verified_activity,
  exists(select 1 from pg_trigger trigger_row
    where trigger_row.tgrelid='public.multiplayer_players'::regclass
      and trigger_row.tgname='flush_1v1_progression_on_phase_exit'
      and not trigger_row.tgisinternal) as versus_phase_exit_flush_installed,
  (app_private.endless_run_xp_breakdown(8000,0)->>'score')::bigint
    =16000000 as squared_score_xp_installed,
  (app_private.endless_run_xp_breakdown(0,3)->>'gems')::bigint
    =300000 as endless_gem_xp_installed,
  not exists(
    select 1 from pg_trigger trigger_row
    where trigger_row.tgname in(
      'award_xp_for_1v1_coin','award_finished_1v1_progression'
    ) and not trigger_row.tgisinternal
  ) as one_v_one_xp_disabled,
  app_private.xp_required_for_level(2)
    > app_private.xp_required_for_level(1)
    as higher_levels_require_more_xp,
  position('server play-time allowance' in pg_get_functiondef(
    to_regprocedure('app_private.enforce_1v1_score_ceiling()')
  ))>0 as score_write_ceiling_installed,
  app_private.cumulative_xp_for_level(20)=4200000000
    and app_private.xp_required_for_level(0)=20000000
    as reported_level_math_installed,
  not has_table_privilege(
    'authenticated','public.player_progression_events','SELECT'
  ) and not has_table_privilege(
    'authenticated','public.player_progression_runs','SELECT'
  ) and not has_table_privilege(
    'authenticated','public.player_progression_1v1_activity','SELECT'
  ) as progression_ledgers_private;
