-- XP and Unlocks MISC · Update 17: whole XP, score-only Endless, independent unlocks.
-- One-time XP erase explicitly approved by the owner. Keep non-XP data and anti-replay IDs.
begin;
alter table public.player_stats add column if not exists progression_version integer not null default 20261008;
alter table public.player_stats alter column progression_version set default 20261008;
alter table public.player_stats alter column level set default 0;
alter table public.player_stats alter column xp_in_level set default 0;
alter table public.player_stats alter column lifetime_xp set default 0;
create table if not exists app_private.progression_resets(version integer primary key,applied_at timestamptz not null default clock_timestamp());
revoke all on app_private.progression_resets from public,anon,anonymous,authenticated;
do $$ begin
  perform pg_advisory_xact_lock(20261008);
  if not exists(select 1 from app_private.progression_resets where version=20261008) then
    update public.player_stats set level=0,xp_in_level=0,lifetime_xp=0,progression_version=20261008,updated_at=clock_timestamp();
    update public.player_progression_events set xp_awarded=0,metadata=metadata-'xp_breakdown'
      where xp_awarded<>0 or metadata?'xp_breakdown';
    drop table if exists app_private.progression_reset_backup;
    insert into app_private.progression_resets(version) values(20261008);
  end if;
end $$;
create or replace function app_private.cumulative_xp_for_level(p_level integer) returns bigint language sql immutable strict set search_path='' as $$
  select (50::numeric*greatest(p_level,0)*greatest(p_level,0)+150::numeric*greatest(p_level,0))::bigint;
$$;
create or replace function app_private.xp_required_for_level(p_level integer) returns bigint language sql immutable strict set search_path='' as $$
  select 200::bigint+100::bigint*greatest(p_level,0);
$$;
create or replace function app_private.level_for_lifetime_xp(p_lifetime_xp bigint) returns integer language sql immutable strict set search_path='' as $$
  select greatest(0,floor((sqrt(22500::numeric+200::numeric*greatest(p_lifetime_xp,0))-150)/100))::integer;
$$;
create or replace function app_private.endless_run_xp_breakdown(p_score bigint,p_gem_count bigint) returns jsonb language sql immutable strict set search_path='' as $$
  with awards as(select floor(power(greatest(p_score,0)::numeric,2.2)/3000000)::bigint as amount)
  select jsonb_build_object('score',amount,'gems',0,'gem_count',greatest(p_gem_count,0),'total',amount) from awards;
$$;
create or replace function public.get_player_progression() returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();s public.player_stats;paid boolean;
begin
  if u is null then raise exception 'Sign in required';end if;
  insert into public.player_stats(user_id,total_gems,high_score,updated_at) values(u,0,0,now()) on conflict(user_id) do nothing;
  select * into s from public.player_stats where user_id=u;
  paid:=exists(select 1 from app_private.ranked_requalification where user_id=u and qualified);
  return jsonb_build_object('level',s.level,'xp',s.xp_in_level,'xp_required',app_private.xp_required_for_level(s.level),
    'lifetime_xp',s.lifetime_xp,'completed_runs',s.completed_runs,'ranked_purchased',paid,'ranked_unlocked',s.level>=25 and paid,'progression_version',s.progression_version);
end $$;
create or replace function app_private.apply_player_xp(p_user_id uuid,p_amount bigint,p_completed_run boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare l integer;x bigint;t bigint;r bigint;v integer;paid boolean;
begin
  if p_user_id is null or p_amount is null or p_amount<0 or p_amount>700000000000000::bigint then raise exception 'Invalid XP award';end if;
  insert into public.player_stats(user_id,total_gems,high_score,updated_at) values(p_user_id,0,0,now()) on conflict(user_id) do nothing;
  select lifetime_xp,completed_runs,progression_version into t,r,v from public.player_stats where user_id=p_user_id for update;
  if t>9223372036854775807::bigint-p_amount then raise exception 'Lifetime XP exceeds the supported range';end if;
  t:=t+p_amount;l:=app_private.level_for_lifetime_xp(t);x:=t-app_private.cumulative_xp_for_level(l);r:=r+case when p_completed_run then 1 else 0 end;
  update public.player_stats set level=l,xp_in_level=x,lifetime_xp=t,completed_runs=r,updated_at=now() where user_id=p_user_id;
  paid:=exists(select 1 from app_private.ranked_requalification where user_id=p_user_id and qualified);
  return jsonb_build_object('level',l,'xp',x,'xp_required',app_private.xp_required_for_level(l),'lifetime_xp',t,
    'completed_runs',r,'ranked_purchased',paid,'ranked_unlocked',l>=25 and paid,'progression_version',v,'xp_awarded',p_amount);
end $$;
create or replace function public.unlock_ranked_1v1() returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();s public.player_stats;paid boolean;
begin
  if u is null then raise exception 'Sign in required';end if;
  if app_private.has_active_ban(u,'account',null) or app_private.has_active_ban(u,'leaderboard',null) then raise exception 'This account cannot unlock Ranked';end if;
  if app_private.is_admin_test_user(u) then raise exception 'Turn off Test Mode to unlock Ranked';end if;
  select * into s from public.player_stats where user_id=u for update;
  if s.user_id is null or s.level<25 then raise exception 'Ranked requires level 25';end if;
  paid:=exists(select 1 from app_private.ranked_requalification where user_id=u and qualified);
  if not paid then
    if s.total_gems<100 then raise exception 'You need 100 Gems';end if;
    update public.player_stats set total_gems=total_gems-100,updated_at=now() where user_id=u returning * into s;
    insert into app_private.ranked_requalification(user_id,qualified,qualified_at) values(u,true,clock_timestamp())
      on conflict(user_id) do update set qualified=true,qualified_at=excluded.qualified_at;
  end if;
  return public.get_player_progression()||jsonb_build_object('total_gems',s.total_gems);
end $$;
-- Preserve the current map voting, snapshots, ownership, bans, and queue locks.
do $$ declare f text;begin
  f:=pg_get_functiondef('public.join_1v1_queue(text)'::regprocedure);
  if position('stats.level >= 20' in f)>0 then
    if position('v_level < 20' in f)=0 or position('ranked_requalification' in f)=0 then raise exception 'Unexpected Ranked queue definition';end if;
    f:=replace(f,'v_level < 20','v_level < 25');
    f:=replace(f,'stats.level >= 20','stats.level >= 25 and exists(select 1 from app_private.ranked_requalification entitlement where entitlement.user_id=queue.user_id and entitlement.qualified)');
    f:=replace(f,'Ranked 1v1 unlocks at level 20','Ranked 1v1 unlocks at level 25');
    f:=replace(f,'Ranked is locked after the rating reset','Unlock Ranked for 100 Gems at level 25');
    execute f;
  elsif position('v_level < 25' in f)=0 or position('entitlement.qualified' in f)=0 then raise exception 'Unexpected Ranked queue definition';
  end if;
end $$;
revoke all on function app_private.cumulative_xp_for_level(integer),app_private.xp_required_for_level(integer),
  app_private.level_for_lifetime_xp(bigint),app_private.endless_run_xp_breakdown(bigint,bigint),app_private.apply_player_xp(uuid,bigint,boolean)
  from public,anon,anonymous,authenticated;
revoke all on function public.get_player_progression(),public.unlock_ranked_1v1() from public,anon,anonymous;
grant execute on function public.get_player_progression(),public.unlock_ranked_1v1() to authenticated;
notify pgrst,'reload schema';
commit;
