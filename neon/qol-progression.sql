-- XP and Unlocks MISC · Map Refresh · 2026-10-14.
-- One approved XP-only reset. Keep accounts, Gems, inventory, scores, paid mode
-- unlocks, completed-run counts and the receipt IDs that prevent replay.
-- Apply after the installed progression / Update 19 definitions, never by
-- replaying historical reset migrations. Do not run this file for a dry run.
begin;
alter table public.player_stats add column if not exists progression_version integer not null default 20261014;
alter table public.player_stats alter column progression_version set default 20261014;
alter table public.player_stats alter column level set default 0;
alter table public.player_stats alter column xp_in_level set default 0;
alter table public.player_stats alter column lifetime_xp set default 0;
create table if not exists app_private.progression_resets(
 version integer primary key,applied_at timestamptz not null default clock_timestamp());
revoke all on app_private.progression_resets from public,anon,anonymous,authenticated;
do $$ begin
 perform pg_advisory_xact_lock(20261014);
 if not exists(select 1 from app_private.progression_resets where version=20261014) then
  -- Serialize the reset with XP, shop and unlock row locks. Receipt rows are
  -- retained, so a historical run or Gem claim cannot be submitted again.
  lock table public.player_progression_runs in access exclusive mode;
  lock table public.player_stats in share row exclusive mode;
  lock table public.player_progression_events in share row exclusive mode;
  update public.player_stats set level=0,xp_in_level=0,lifetime_xp=0,
   progression_version=20261014,updated_at=clock_timestamp();
  update public.player_progression_events set xp_awarded=0,metadata=metadata-'xp_breakdown'
   where xp_awarded<>0 or metadata?'xp_breakdown';
  -- This exact legacy table contains only obsolete XP recovery snapshots.
  -- Do not delete run receipts, ownership history or general account backups.
  drop table if exists app_private.progression_reset_backup;
  insert into app_private.progression_resets(version) values(20261014);
 end if;
end $$;

create or replace function app_private.cumulative_xp_for_level(p_level integer)
returns bigint language sql immutable strict set search_path='' as $$
 select (50::numeric*greatest(p_level,0)*greatest(p_level,0)+350::numeric*greatest(p_level,0))::bigint;
$$;
create or replace function app_private.xp_required_for_level(p_level integer)
returns bigint language sql immutable strict set search_path='' as $$
 select 400::bigint+100::bigint*greatest(p_level,0);
$$;
create or replace function app_private.level_for_lifetime_xp(p_lifetime_xp bigint)
returns integer language sql immutable strict set search_path='' as $$
 select greatest(0,floor((sqrt(122500::numeric+200::numeric*greatest(p_lifetime_xp,0))-350)/100))::integer;
$$;
create or replace function app_private.endless_run_xp_breakdown(p_score bigint,p_gem_count bigint)
returns jsonb language sql immutable strict set search_path='' as $$
 with awards as(select floor(power(greatest(p_score,0)::numeric/1100,2.2))::bigint as amount)
 select jsonb_build_object('score',amount,'gems',0,'gem_count',greatest(p_gem_count,0),'total',amount) from awards;
$$;
-- Physical Gem receipts retain their existing verified-wave bonus. Streak Gems
-- do not multiply the number of physical pickups, and 1v1 never grants XP.
create or replace function app_private.endless_verified_gem_xp(p_user_id uuid,p_run_id uuid)
returns bigint language sql stable strict set search_path='' as $$
 select coalesce(sum(case when coalesce(event.metadata->>'verified_wave','')~'^[0-9]{1,9}$'
  then greatest(1,(event.metadata->>'verified_wave')::bigint) else 1 end),0)::bigint
 from public.player_progression_events event
 where event.user_id=p_user_id and event.source='gem'
  and event.metadata->>'context_id'=p_run_id::text and event.metadata->>'context_type'='endless';
$$;
create or replace function public.get_player_progression()
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();s public.player_stats;paid boolean;
begin
 if u is null then raise exception 'Sign in required';end if;
 insert into public.player_stats(user_id,total_gems,high_score,updated_at)
  values(u,0,0,now()) on conflict(user_id) do nothing;
 select * into s from public.player_stats where user_id=u;
 paid:=exists(select 1 from app_private.ranked_requalification where user_id=u and qualified);
 return jsonb_build_object('level',s.level,'xp',s.xp_in_level,
  'xp_required',app_private.xp_required_for_level(s.level),'lifetime_xp',s.lifetime_xp,
  'completed_runs',s.completed_runs,'casual_unlocked',s.level>=5,
  'ranked_purchased',paid,'ranked_unlocked',paid,'progression_version',s.progression_version);
end $$;
create or replace function app_private.apply_player_xp(p_user_id uuid,p_amount bigint,p_completed_run boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare l integer;x bigint;t bigint;r bigint;v integer;paid boolean;
begin
 if p_user_id is null or p_amount is null or p_amount<0 or p_amount>700000000000000::bigint then
  raise exception 'Invalid XP award';end if;
 insert into public.player_stats(user_id,total_gems,high_score,updated_at)
  values(p_user_id,0,0,now()) on conflict(user_id) do nothing;
 select lifetime_xp,completed_runs,progression_version into t,r,v
  from public.player_stats where user_id=p_user_id for update;
 if t>9223372036854775807::bigint-p_amount then raise exception 'Lifetime XP exceeds the supported range';end if;
 t:=t+p_amount;l:=app_private.level_for_lifetime_xp(t);
 x:=t-app_private.cumulative_xp_for_level(l);r:=r+case when p_completed_run then 1 else 0 end;
 update public.player_stats set level=l,xp_in_level=x,lifetime_xp=t,completed_runs=r,updated_at=now()
  where user_id=p_user_id;
 paid:=exists(select 1 from app_private.ranked_requalification where user_id=p_user_id and qualified);
 return jsonb_build_object('level',l,'xp',x,'xp_required',app_private.xp_required_for_level(l),
  'lifetime_xp',t,'completed_runs',r,'casual_unlocked',l>=5,
  'ranked_purchased',paid,'ranked_unlocked',paid,'progression_version',v,'xp_awarded',p_amount);
end $$;
create or replace function public.unlock_ranked_1v1()
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();s public.player_stats;paid boolean;
begin
 if u is null then raise exception 'Sign in required';end if;
 if app_private.has_active_ban(u,'account',null) or app_private.has_active_ban(u,'leaderboard',null) then
  raise exception 'This account cannot unlock Ranked';end if;
 if app_private.is_admin_test_user(u) then raise exception 'Turn off Test Mode to unlock Ranked';end if;
 select * into s from public.player_stats where user_id=u for update;
 paid:=exists(select 1 from app_private.ranked_requalification where user_id=u and qualified);
 if not paid then
  if s.user_id is null or s.level<25 then raise exception 'Ranked requires level 25';end if;
  if s.total_gems<100 then raise exception 'You need 100 Gems';end if;
  update public.player_stats set total_gems=total_gems-100,updated_at=now() where user_id=u returning * into s;
  insert into app_private.ranked_requalification(user_id,qualified,qualified_at)
   values(u,true,clock_timestamp()) on conflict(user_id) do update set qualified=true,qualified_at=excluded.qualified_at;
 end if;
 return public.get_player_progression()||jsonb_build_object('total_gems',s.total_gems);
end $$;
create or replace function public.unlock_photon_fury()
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=app_private.photon_user();s public.player_stats;p public.player_photon_fury;
begin
 select * into s from public.player_stats where user_id=u for update;
 insert into public.player_photon_fury(user_id) values(u) on conflict do nothing;
 select * into p from public.player_photon_fury where user_id=u for update;
 if p.unlocked_at is null then
  if coalesce(s.level,0)<15 then raise exception 'Requires level 15';end if;
  if coalesce(s.total_gems,0)<225 then raise exception 'You need 225 Gems';end if;
  update public.player_stats set total_gems=total_gems-225,updated_at=clock_timestamp()
   where user_id=u returning * into s;
  update public.player_photon_fury set unlocked_at=clock_timestamp() where user_id=u;
 end if;
 return jsonb_build_object('unlocked',true,'total_gems',s.total_gems);
end $$;

-- Preserve the installed completion validation and anti-replay implementation.
-- Fail closed on an unexpected definition instead of replacing it with an old
-- snapshot. A run started before this reset may still save its score, not XP.
do $$ declare d text;needle text:=E'  v_xp:=(v_breakdown->>''total'')::bigint;';replacement text;
begin
 d:=pg_get_functiondef('app_private.award_completed_run_v2_live(uuid,bigint,text)'::regprocedure);
 if position('Map Refresh XP 20261014' in d)=0 then
  if position(needle in d)=0 or position('where run_id=p_run_id and user_id=v_uid' in d)=0
   or position('for update' in lower(d))=0 or position('v_completed_at is not null' in d)=0
   then raise exception 'Unexpected completed-run function; no change made';end if;
  replacement:=E'  -- Map Refresh XP 20261014: score plus existing verified Gem bonus.\n'
   ||E'  v_breakdown:=app_private.endless_run_xp_breakdown(v_score,v_gem_count);\n'
   ||E'  v_breakdown:=v_breakdown||jsonb_build_object(\'gems\',app_private.endless_verified_gem_xp(v_uid,p_run_id));\n'
   ||E'  v_breakdown:=v_breakdown||jsonb_build_object(\'total\',(v_breakdown->>\'score\')::bigint+(v_breakdown->>\'gems\')::bigint);\n'
   ||needle||E'\n  -- Reset fence 20261014.\n'
   ||E'  if v_started_at < (select applied_at from app_private.progression_resets where version=20261014) then\n'
   ||E'    v_xp:=0;v_breakdown:=jsonb_build_object(\'score\',0,\'gems\',0,\'gem_count\',v_gem_count,\'total\',0);\n  end if;';
  execute replace(d,needle,replacement);
 end if;
end $$;
-- Apply the new Casual gate to BOTH entrants, retaining every installed map,
-- queue lock, ban, ownership, active-match and Ranked entitlement check.
do $$ declare d text;needle text;begin
 d:=pg_get_functiondef('public.join_1v1_queue(text)'::regprocedure);
 if position('Map Refresh Casual level 5' in d)=0 then
  needle:=E'if k in(''rng'',''hardcore_duel'') and';
  if position(needle in d)=0 or position('and (k not in(''rng'',''hardcore_duel'') or st.level>=5)' in d)=0
   then raise exception 'Unexpected queue definition; no change made';end if;
  d:=replace(d,needle,E'-- Map Refresh Casual level 5.\nif k=''casual'' and coalesce((select level from public.player_stats where user_id=u),0)<5 then raise exception ''Casual 1v1 requires level 5'';end if;\n'||needle);
  d:=replace(d,'and (k not in(''rng'',''hardcore_duel'') or st.level>=5)',
   'and (k not in(''casual'',''rng'',''hardcore_duel'') or st.level>=5)');
  -- Paid Ranked owners keep access through the XP reset, with no second fee.
  d:=replace(d,E'coalesce((select level from public.player_stats where user_id=u),0)<25 or ', '');
  d:=replace(d,'st.level>=25 and exists(select 1 from app_private.ranked_requalification',
   'exists(select 1 from app_private.ranked_requalification');
  execute d;
 end if;
end $$;
revoke all on function app_private.cumulative_xp_for_level(integer),app_private.xp_required_for_level(integer),
 app_private.level_for_lifetime_xp(bigint),app_private.endless_run_xp_breakdown(bigint,bigint),
 app_private.endless_verified_gem_xp(uuid,uuid),app_private.apply_player_xp(uuid,bigint,boolean)
 from public,anon,anonymous,authenticated;
revoke all on function public.get_player_progression(),public.unlock_ranked_1v1(),public.unlock_photon_fury()
 from public,anon,anonymous;
grant execute on function public.get_player_progression(),public.unlock_ranked_1v1(),public.unlock_photon_fury() to authenticated;
notify pgrst,'reload schema';
commit;
