-- Update 2.3 · own-match Smoke actions. Apply after masteries.
-- No target UUID, client-selected balance, or caller timestamp is accepted.
-- Hold duration uses the server clock; a repeated action ID cannot spend again.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create table if not exists app_private.mastery_smoke_state(
 match_id uuid not null references public.multiplayer_matches(id) on delete cascade,
 user_id uuid not null references public.player_stats(user_id) on delete cascade,
 wave integer not null check(wave>0),bombs_used integer not null default 0 check(bombs_used between 0 and 3),
 cooldown_until timestamptz,charge_action_id uuid,charge_started_at timestamptz,charge_active_seconds bigint,
 primary key(match_id,user_id)
);
create table if not exists app_private.mastery_smoke_actions(
 match_id uuid not null references public.multiplayer_matches(id) on delete cascade,
 user_id uuid not null references public.player_stats(user_id) on delete cascade,
 action_id uuid not null,wave integer not null,hold_seconds integer not null check(hold_seconds in(0,3,5,10)),
 strength text check(strength in('mild','grey','heavy-grey')),active_until timestamptz,
 reply jsonb not null,created_at timestamptz not null default clock_timestamp(),
 primary key(match_id,user_id,action_id)
);
alter table app_private.mastery_smoke_state enable row level security;
alter table app_private.mastery_smoke_actions enable row level security;
revoke all on app_private.mastery_smoke_state,app_private.mastery_smoke_actions from public,anon,anonymous,authenticated;

create or replace function app_private.mastery_smoke_actor(p_match_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=app_private.photon_user();p public.multiplayer_players;m public.multiplayer_matches;mastered boolean;seconds bigint;
begin
 select * into m from public.multiplayer_matches where id=p_match_id for share;
 select * into p from public.multiplayer_players where match_id=p_match_id and user_id=u for share;
 if m.id is null or p.user_id is null then raise exception 'Owned 1v1 match required';end if;
 if m.status<>'playing' or m.finished_at is not null or p.status<>'playing' or p.hearts<=0 or m.started_at<clock_timestamp()-interval '6 hours' then raise exception 'Smoke requires active 1v1 play';end if;
 if p.character_key<>'trickster_smoke' or p.test_mode or not app_private.mastery_owns_character(u,p.character_key) then raise exception 'Use your unlocked Smoke character';end if;
 select a.active_seconds into seconds from public.player_progression_1v1_activity a where a.match_id=p_match_id and a.user_id=u and a.heartbeat_active and a.last_heartbeat_at>=clock_timestamp()-interval '8 seconds';
 if seconds is null then raise exception 'Smoke requires recent active play';end if;
 select coalesce(bool_or(q.mastered and q.mastery_enabled),false) into mastered from app_private.player_mastery_quests q where q.user_id=u and q.character_key='trickster_smoke';
 return jsonb_build_object('user_id',u,'wave',p.wave,'mastered',mastered,'active_seconds',seconds);
end $$;

create or replace function public.begin_mastery_smoke_charge(p_match_id uuid,p_action_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=app_private.photon_user();a jsonb;s app_private.mastery_smoke_state;r app_private.mastery_smoke_actions;
begin
 if p_action_id is null then raise exception 'Smoke action ID required';end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text,23));
 a:=app_private.mastery_smoke_actor(p_match_id);
 select * into r from app_private.mastery_smoke_actions where match_id=p_match_id and user_id=u and action_id=p_action_id;
 if found then return r.reply||jsonb_build_object('already_used',true);end if;
 insert into app_private.mastery_smoke_state(match_id,user_id,wave) values(p_match_id,u,(a->>'wave')::integer) on conflict do nothing;
 select * into s from app_private.mastery_smoke_state where match_id=p_match_id and user_id=u for update;
 if s.wave<>(a->>'wave')::integer then s.wave:=(a->>'wave')::integer;s.bombs_used:=0;s.charge_action_id:=null;s.charge_started_at:=null;end if;
 if s.cooldown_until>clock_timestamp() then raise exception 'Smoke is cooling down';end if;
 if (a->>'mastered')::boolean and s.bombs_used>=3 then raise exception 'All three smoke bombs were used this wave';end if;
 if s.charge_action_id is distinct from p_action_id then s.charge_action_id:=p_action_id;s.charge_started_at:=clock_timestamp();s.charge_active_seconds:=(a->>'active_seconds')::bigint;end if;
 update app_private.mastery_smoke_state set wave=s.wave,bombs_used=s.bombs_used,charge_action_id=s.charge_action_id,charge_started_at=s.charge_started_at,charge_active_seconds=s.charge_active_seconds where match_id=p_match_id and user_id=u;
 return jsonb_build_object('action_id',p_action_id,'charge_started_at',s.charge_started_at,'bombs_remaining',case when (a->>'mastered')::boolean then 3-s.bombs_used else null end);
end $$;

create or replace function public.use_mastery_smoke(p_match_id uuid,p_hold_seconds integer,p_action_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=app_private.photon_user();a jsonb;s app_private.mastery_smoke_state;r app_private.mastery_smoke_actions;
 n integer;cost integer;mastered boolean;strength text;cooldown numeric;reply jsonb;ends timestamptz;
begin
 if p_action_id is null or p_hold_seconds is null or p_hold_seconds not in(0,3,5,10) then raise exception 'Invalid Smoke action';end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text,23));
 -- Own membership is checked even for a retry. Completed actions can be read
 -- after the match ends, but cannot be replayed on another match or user.
 if not exists(select 1 from public.multiplayer_players where match_id=p_match_id and user_id=u) then raise exception 'Owned 1v1 match required';end if;
 select * into r from app_private.mastery_smoke_actions where match_id=p_match_id and user_id=u and action_id=p_action_id;
 if found then
  if r.hold_seconds<>p_hold_seconds then raise exception 'Smoke action ID was already used for a different action';end if;
  return r.reply||jsonb_build_object('duplicate',true);
 end if;
 a:=app_private.mastery_smoke_actor(p_match_id);mastered:=(a->>'mastered')::boolean;n:=(a->>'wave')::integer;
 if p_hold_seconds in(5,10) and not mastered then raise exception 'Complete and enable Smoke mastery for stronger hold attacks';end if;
 insert into app_private.mastery_smoke_state(match_id,user_id,wave) values(p_match_id,u,n) on conflict do nothing;
 select * into s from app_private.mastery_smoke_state where match_id=p_match_id and user_id=u for update;
 if s.wave<>n then s.wave:=n;s.bombs_used:=0;s.charge_action_id:=null;s.charge_started_at:=null;end if;
 if s.cooldown_until>clock_timestamp() then raise exception 'Smoke is cooling down';end if;
 if mastered and s.bombs_used>=3 then raise exception 'All three smoke bombs were used this wave';end if;
 if p_hold_seconds>0 then
  if s.charge_action_id is distinct from p_action_id or s.charge_started_at is null
   or extract(epoch from clock_timestamp()-s.charge_started_at)<p_hold_seconds-.25
   or coalesce((a->>'active_seconds')::bigint-s.charge_active_seconds,-1)<p_hold_seconds-1.5 then raise exception 'Hold E for the full Smoke charge time during active play';end if;
  if not exists(select 1 from public.multiplayer_players where match_id=p_match_id and user_id<>u and status='playing' and hearts>0) then raise exception 'Living opponent required';end if;
  cost:=case p_hold_seconds when 3 then 1 when 5 then 2 else 3-s.bombs_used end;
  strength:=case p_hold_seconds when 3 then 'mild' when 5 then 'grey' else 'heavy-grey' end;
  cooldown:=case when mastered then 20 else 12 end;ends:=clock_timestamp()+interval '10 seconds';
 else cost:=1;cooldown:=case when mastered then 5 else 12 end;end if;
 if mastered and s.bombs_used+cost>3 then raise exception 'Not enough smoke bombs remain this wave';end if;
 if mastered then s.bombs_used:=s.bombs_used+cost;end if;
 s.cooldown_until:=clock_timestamp()+make_interval(secs=>cooldown::double precision);
 reply:=jsonb_build_object('action_id',p_action_id,'strength',strength,'duration',case when strength is null then 0 else 10 end,
  'active_until',ends,'bombs_remaining',case when mastered then 3-s.bombs_used else null end,'cooldown_until',s.cooldown_until,
  'self_heavy',mastered and s.bombs_used=3,'wave',n,'duplicate',false);
 update app_private.mastery_smoke_state set wave=n,bombs_used=s.bombs_used,cooldown_until=s.cooldown_until,charge_action_id=null,charge_started_at=null,charge_active_seconds=null where match_id=p_match_id and user_id=u;
 insert into app_private.mastery_smoke_actions(match_id,user_id,action_id,wave,hold_seconds,strength,active_until,reply) values(p_match_id,u,p_action_id,n,p_hold_seconds,strength,ends,reply);
 return reply;
end $$;

create or replace function public.get_mastery_smoke_effect(p_match_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u uuid:=app_private.photon_user();p public.multiplayer_players;o public.multiplayer_players;m public.multiplayer_matches;
 s app_private.mastery_smoke_state;e app_private.mastery_smoke_actions;top numeric:=0;mastered boolean:=false;
begin
 select * into m from public.multiplayer_matches where id=p_match_id;
 select * into p from public.multiplayer_players where match_id=p_match_id and user_id=u;
 if m.id is null or p.user_id is null then raise exception 'Owned 1v1 match required';end if;
 select * into o from public.multiplayer_players where match_id=p_match_id and user_id<>u limit 1;
 if m.status='playing' and m.finished_at is null and p.status='playing' then
  select * into e from app_private.mastery_smoke_actions where match_id=p_match_id and user_id=o.user_id and active_until>clock_timestamp() order by created_at desc limit 1;
  if exists(select 1 from app_private.mastery_sessions ms join app_private.player_mastery_quests q on q.user_id=ms.user_id and q.character_key='trickster_smoke'
   where ms.user_id=o.user_id and ms.context_id=p_match_id and ms.context_type='1v1' and ms.finished_at is null and ms.flair_character='trickster_smoke'
    and q.mastered and q.flair_rewrite_enabled and app_private.mastery_owns_character(o.user_id,'trickster_smoke')) then
   top:=case when o.character_key='trickster_smoke' then .4 else .2 end;
  end if;
 end if;
 select coalesce(bool_or(q.mastered and q.mastery_enabled),false) into mastered from app_private.player_mastery_quests q where q.user_id=u and q.character_key='trickster_smoke';
 select * into s from app_private.mastery_smoke_state where match_id=p_match_id and user_id=u;
 return jsonb_build_object('strength',e.strength,'active_until',e.active_until,'flair_top',top,
  'own_bombs_remaining',case when p.character_key='trickster_smoke' and mastered then 3-case when s.wave=p.wave then coalesce(s.bombs_used,0) else 0 end else null end,
  'own_cooldown_until',s.cooldown_until,'self_heavy',p.character_key='trickster_smoke' and mastered and s.wave=p.wave and s.bombs_used=3);
end $$;
revoke all on function app_private.mastery_smoke_actor(uuid) from public,anon,anonymous,authenticated;
revoke all on function public.begin_mastery_smoke_charge(uuid,uuid),public.use_mastery_smoke(uuid,integer,uuid),public.get_mastery_smoke_effect(uuid) from public,anon,anonymous;
grant execute on function public.begin_mastery_smoke_charge(uuid,uuid),public.use_mastery_smoke(uuid,integer,uuid),public.get_mastery_smoke_effect(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
