-- Cartographer's initial choice is locked. One Cartographer may replace the
-- arena; two cancel the override and keep their drawing mechanic. No inventory
-- ownership, accounts or persistent loadouts are changed.
begin;
set local lock_timeout='3s';
create table if not exists app_private.six_class_cartography(
 match_id uuid primary key references public.multiplayer_matches(id)on delete cascade,
 locked_users uuid[]not null default '{}',original_map text not null,picked_map text,
 deadline timestamptz not null,resolved boolean not null default false);
alter table app_private.six_class_cartography enable row level security;
revoke all on app_private.six_class_cartography from public,anon,anonymous,authenticated;
comment on table app_private.six_class_cartography is 'skyway-six-class-cartographer-v1';
create or replace function app_private.cartographer_override(u uuid,map text,k text)returns boolean language sql stable security definer set search_path=''as $$
 select k='runner_cartographer'and exists(select 1 from app_private.six_class_cartography c join public.multiplayer_matches m on m.id=c.match_id where u=any(c.locked_users)and c.resolved and m.map_key=map and m.status in('countdown','playing','intermission'));
$$;
create or replace function app_private.advance_cartography(mid uuid)returns void language plpgsql security definer set search_path=''as $$
declare c app_private.six_class_cartography;m public.multiplayer_matches;at_time timestamptz:=clock_timestamp();n integer;begin
 select *into c from app_private.six_class_cartography where match_id=mid for update;
 if c.match_id is null or c.resolved then return;end if;
 select *into m from public.multiplayer_matches where id=mid for update;
 if m.status<>'countdown'then return;end if;
 n:=cardinality(c.locked_users);
 if n=2 then update app_private.six_class_cartography set resolved=true,picked_map=null where match_id=mid;return;end if;
 if c.picked_map is not null and exists(select 1 from public.multiplayer_players p where p.match_id=mid and not(p.user_id=any(c.locked_users))and p.character_confirmed)then
  update app_private.six_class_cartography set resolved=true where match_id=mid;
  update public.multiplayer_matches set map_key=c.picked_map,map_selection_method='cartographer',character_selection_ends_at=at_time+interval '15 seconds',last_activity_at=at_time where id=mid;
  update public.multiplayer_players p set character_key=(select coalesce(rules.forced_character_key,(select catalog.item_key from app_private.six_class_catalog catalog where catalog.starter and catalog.character_class=any(rules.allowed_character_classes)order by(catalog.item_key='runner_ace')desc,catalog.item_key limit 1))from app_private.one_v_one_map_rules rules where rules.map_key=c.picked_map)
  where p.match_id=mid and not(p.user_id=any(c.locked_users))and not exists(select 1 from app_private.one_v_one_map_rules rules where rules.map_key=c.picked_map and p.character_class=any(rules.allowed_character_classes)and(rules.forced_character_key is null or rules.forced_character_key=p.character_key));
  perform app_private.prepare_ruins_bans(mid);
  perform app_private.setup_19_health(mid);
  update public.multiplayer_players set character_confirmed=(user_id=any(c.locked_users))where match_id=mid;
  update app_private.match_setup_19 set phase='character',deadline=at_time+interval '15 seconds'where match_id=mid;
 elsif at_time>=c.deadline then
  update app_private.six_class_cartography set resolved=true where match_id=mid;
 end if;
end $$;
create or replace function app_private.cartography_view(mid uuid,u uuid)returns jsonb language sql stable security definer set search_path=''as $$
 select jsonb_build_object('self_locked',u=any(locked_users),'both',cardinality(locked_users)=2,'can_choose',u=any(locked_users)and cardinality(locked_users)=1 and not resolved and deadline>clock_timestamp(),'deadline',deadline,'picked_map',picked_map,'resolved',resolved)
 from app_private.six_class_cartography where match_id=mid;
$$;
-- NEW_FUNCTION_SOURCE_GUARD
do $guard$ begin if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and p.proname='select_cartographer_map_v1'and md5(p.prosrc)<>'03c6b2798159f99a42de68ceb7558e60')then raise exception 'Unexpected existing function: public.select_cartographer_map_v1';end if;end $guard$;
-- END_NEW_FUNCTION_SOURCE_GUARD
create or replace function public.select_cartographer_map_v1(p_match_id uuid,p_map_key text)returns jsonb language plpgsql security definer set search_path=''as $$
begin perform app_private.require_pixel_runtime();
 <<owned_map>>declare u uuid:=app_private.photon_user();c app_private.six_class_cartography;m public.multiplayer_matches;begin
 select *into m from public.multiplayer_matches where id=p_match_id for update;
 select *into c from app_private.six_class_cartography where match_id=p_match_id for update;
 if m.status is distinct from 'countdown'or c.match_id is null or not(u=any(c.locked_users))or cardinality(c.locked_users)<>1 or c.resolved or clock_timestamp()>=c.deadline then raise exception 'Original live Cartographer choice required';end if;
 if not exists(select 1 from app_private.one_v_one_map_rules where map_key=p_map_key)then raise exception 'Unknown arena';end if;
 update app_private.six_class_cartography set picked_map=p_map_key where match_id=p_match_id;
 perform app_private.advance_cartography(p_match_id);
 return public.get_1v1_state(p_match_id);
 end owned_map;
end $$;
revoke all on function app_private.cartographer_override(uuid,text,text),app_private.advance_cartography(uuid),app_private.cartography_view(uuid,uuid)from public,anon,anonymous,authenticated;
revoke all on function public.select_cartographer_map_v1(uuid,text)from public,anon,anonymous;
grant execute on function public.select_cartographer_map_v1(uuid,text)to authenticated;
-- Source-pinned existing setup/snapshot wrappers are appended below.
-- CARTOGRAPHER_SOURCE_PATCHES
do $guard$ declare h text;begin select md5(prosrc)into h from pg_proc where oid='app_private.character_selection_snapshot(uuid,text,text)'::regprocedure;if h not in('4c797bc10629174c4e11b5542d473eb6','cb7f1d6eb6269cf1738aca36cb51df7b')then raise exception 'Source drift: app_private.character_selection_snapshot(uuid,text,text)';end if;end $guard$;
CREATE OR REPLACE FUNCTION app_private.character_selection_snapshot(p_user_id uuid, p_map_key text, p_character_key text)
 RETURNS TABLE(character_key text, character_class text, max_hearts numeric, starting_hearts numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_key text;
  v_class text;
  v_test_mode boolean:=app_private.is_admin_test_user(p_user_id);
  v_allowed text[];
  v_forced text;
  v_base_max numeric;
  v_base_start numeric;
  v_multiplier numeric;
  v_bonus numeric;
begin
  select catalog.item_key,catalog.character_class into v_key,v_class from public.extraction_catalog catalog where catalog.item_key=p_character_key and catalog.item_type='character' and catalog.active;
  v_key:=coalesce(v_key,'runner_ace');
  v_class:=coalesce(v_class,'runner');

  select rules.allowed_character_classes,rules.forced_character_key,
         coalesce((rules.gameplay_rules->>'hp_multiplier')::numeric,1),
         coalesce((rules.gameplay_rules->>'hp_bonus')::numeric,0)
  into v_allowed,v_forced,v_multiplier,v_bonus
  from app_private.one_v_one_map_rules rules
  where rules.map_key=p_map_key;

  if not v_test_mode and not app_private.cartographer_override(p_user_id,p_map_key,v_key)then
    if v_forced is not null then
      v_key:=v_forced;
      v_class:='runner';
    elsif not (v_class=any(v_allowed)) then
      v_key:='runner_ace';
      v_class:='runner';
    end if;
  end if;

  select c.max_hp,c.starting_hp into v_base_max,v_base_start from app_private.six_class_catalog c where c.item_key=v_key;
  if v_base_max is null then raise exception 'Character health is unavailable';end if;

  return query select v_key,v_class,
    (v_base_max*v_multiplier+v_bonus)::numeric,
    (v_base_start*v_multiplier+v_bonus)::numeric;
end;
$function$;

do $guard$ declare h text;begin select md5(prosrc)into h from pg_proc where oid='app_private.character_snapshot_before_terminal(uuid,text)'::regprocedure;if h not in('876ed07f8b4fbbd410516590e9460651','db8ad8c4fce4e0344588fd5235ee376c')then raise exception 'Source drift: app_private.character_snapshot_before_terminal(uuid,text)';end if;end $guard$;
CREATE OR REPLACE FUNCTION app_private.character_snapshot_before_terminal(p_user_id uuid, p_map_key text)
 RETURNS TABLE(character_key text, character_class text, max_hearts numeric, starting_hearts numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_key text;
  v_class text;
  v_test_mode boolean:=app_private.is_admin_test_user(p_user_id);
  v_allowed text[];
  v_forced text;
  v_base_max numeric;
  v_base_start numeric;
  v_multiplier numeric;
  v_bonus numeric;
begin
  select loadout.character_key,catalog.character_class
  into v_key,v_class
  from public.player_loadouts loadout
  join public.extraction_catalog catalog
    on catalog.item_key=loadout.character_key
   and catalog.item_type='character' and catalog.active
  left join public.player_unlocks unlock
    on unlock.user_id=loadout.user_id
   and unlock.item_key=loadout.character_key
   and unlock.item_type='character'
  where loadout.user_id=p_user_id
    and (unlock.item_key is not null or v_test_mode);
  v_key:=coalesce(v_key,'runner_ace');
  v_class:=coalesce(v_class,'runner');

  select rules.allowed_character_classes,rules.forced_character_key,
         coalesce((rules.gameplay_rules->>'hp_multiplier')::numeric,1),
         coalesce((rules.gameplay_rules->>'hp_bonus')::numeric,0)
  into v_allowed,v_forced,v_multiplier,v_bonus
  from app_private.one_v_one_map_rules rules
  where rules.map_key=p_map_key;

  if not v_test_mode and not app_private.cartographer_override(p_user_id,p_map_key,v_key)then
    if v_forced is not null then
      v_key:=v_forced;
      v_class:='runner';
    elsif not (v_class=any(v_allowed)) then
      v_key:='runner_ace';
      v_class:='runner';
    end if;
  end if;

  select c.max_hp,c.starting_hp into v_base_max,v_base_start from app_private.six_class_catalog c where c.item_key=v_key;
  if v_base_max is null then raise exception 'Character health is unavailable';end if;

  return query select v_key,v_class,
    (v_base_max*v_multiplier+v_bonus)::numeric,
    (v_base_start*v_multiplier+v_bonus)::numeric;
end;
$function$;

do $guard$ declare h text;begin select md5(prosrc)into h from pg_proc where oid='app_private.advance_setup_19(uuid)'::regprocedure;if h not in('173ddb5f5e6ea70d52a44122fdc565f3','c9a4a6ca4aa52e37aa676452721b8032')then raise exception 'Source drift: app_private.advance_setup_19(uuid)';end if;end $guard$;
CREATE OR REPLACE FUNCTION app_private.advance_setup_19(mid uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare m public.multiplayer_matches;s app_private.match_setup_19;chosen text;t timestamptz:=clock_timestamp();begin
 select * into m from public.multiplayer_matches where id=mid for update;
 select * into s from app_private.match_setup_19 where match_id=mid for update;
 if s.match_id is null or m.status<>'countdown' then return;end if;
 if s.phase='ban' and (t>=s.deadline or (select count(*) from app_private.match_bans_19 where match_id=mid)>=2) then
  select key into chosen from unnest(m.map_candidates) key where not exists(select 1 from app_private.match_bans_19 b where b.match_id=mid and b.map_key=key) order by random() limit 1;
  if chosen is null then raise exception 'No map remains';end if;
  update public.multiplayer_matches set map_key=chosen,map_selection_method='bans',last_activity_at=t where id=mid returning * into m;
  perform app_private.prepare_ruins_bans(mid); perform app_private.setup_19_health(mid);
  update app_private.match_setup_19 set phase='announce',deadline=t+interval '4 seconds' where match_id=mid returning * into s;
 end if;
 if s.phase='announce' and t>=s.deadline then
  if m.mode in('rng','hardcore_duel','quicksand') or m.map_key in('volcano','terminal') then
   update app_private.match_setup_19 set phase='done',deadline=t where match_id=mid returning * into s;
  else
   update app_private.match_setup_19 set phase='character',deadline=t+interval '15 seconds' where match_id=mid returning * into s;
   update public.multiplayer_matches set character_selection_ends_at=s.deadline,last_activity_at=t where id=mid;
  end if;
 end if;
 if s.phase='character'then
  perform app_private.advance_cartography(mid);
  select *into s from app_private.match_setup_19 where match_id=mid;
  select *into m from public.multiplayer_matches where id=mid;
  if exists(select 1 from app_private.six_class_cartography where match_id=mid and not resolved)then return;end if;
 end if;
 if s.phase='character' and (t>=s.deadline or (select count(*) from public.multiplayer_players where match_id=mid and character_confirmed)>=2) then
  update app_private.match_setup_19 set phase='done',deadline=t where match_id=mid returning * into s;
 end if;
 if s.phase='done' then
  update public.multiplayer_matches set status='playing',character_selection_ends_at=null,started_at=t,last_activity_at=t where id=mid;
  update public.multiplayer_players set wave_started_at=t,run_started_at=t,last_seen_at=t where match_id=mid;
 end if;
end $function$
;

do $clone$ declare h text;begin select md5(prosrc)into h from pg_proc where oid='public.choose_1v1_character(uuid,text)'::regprocedure;if h not in('b99e10392fda090f23f122ea9d0c95df','334398d04bc53037e88db4e773dfeba2')then raise exception 'Original character selector drift';end if;if to_regprocedure('app_private.choose_1v1_character_before_cartographer(uuid,text)')is null then execute 'CREATE OR REPLACE FUNCTION app_private.choose_1v1_character_before_cartographer(p_match_id uuid, p_character_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $function$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare u uuid:=auth.uid();m public.multiplayer_matches;s app_private.match_setup_19;c public.extraction_catalog;h record;r app_private.one_v_one_map_rules;begin
 if u is null or not exists(select 1 from public.multiplayer_players where match_id=p_match_id and user_id=u) then raise exception ''Match not found'';end if;
 select * into m from public.multiplayer_matches where id=p_match_id for update;
 select * into s from app_private.match_setup_19 where match_id=p_match_id;
 if m.status<>''countdown'' or s.phase is distinct from ''character'' or clock_timestamp()>=s.deadline then raise exception ''Character selection has ended'';end if;
 if app_private.has_active_ban(u,''account'',null) then raise exception ''This account is banned'';end if;
 select * into c from public.extraction_catalog where item_key=p_character_key and item_type=''character'' and active;
 select * into r from app_private.one_v_one_map_rules where map_key=m.map_key;
 if c.item_key is null or not app_private.owns_six_class_character(u,c.item_key) then raise exception ''You do not own this character'';end if;
 if r.forced_character_key is not null or not(c.character_class=any(r.allowed_character_classes)) then raise exception ''Character is not allowed on this map'';end if;
 if not app_private.duel_character_allowed_23(m.mode,c.item_key) then raise exception ''Character is not allowed in this duel mode'';end if;
 -- QOL Ruins ownership restrictions
if m.map_key=''ruins'' and (c.rarity=''mythic'' or exists(select 1 from app_private.ruins_character_bans where match_id=p_match_id and character_key=c.item_key)) then raise exception ''Character is banned on Ruins for this match'';end if;
select * into h from app_private.character_selection_snapshot(u,m.map_key,c.item_key);
 update public.multiplayer_players set character_key=h.character_key,character_class=h.character_class,max_hearts=h.max_hearts,hearts=h.starting_hearts,character_confirmed=true,last_seen_at=clock_timestamp() where match_id=p_match_id and user_id=u;
 return public.get_1v1_state(p_match_id);
end;
end
$function$';end if;if(select md5(prosrc)from pg_proc where oid='app_private.choose_1v1_character_before_cartographer(uuid,text)'::regprocedure)<>'b99e10392fda090f23f122ea9d0c95df'then raise exception 'Private selector counterpart drift';end if;end $clone$;
revoke all on function app_private.choose_1v1_character_before_cartographer(uuid,text)from public,anon,anonymous,authenticated;
create or replace function public.choose_1v1_character(p_match_id uuid,p_character_key text)returns jsonb language plpgsql security definer set search_path=''as $$
begin perform app_private.require_pixel_runtime();
 <<original_choice>>declare u uuid:=app_private.photon_user();m public.multiplayer_matches;g app_private.six_class_cartography;s app_private.match_setup_19;begin
 select *into m from public.multiplayer_matches where id=p_match_id for update;
 select *into s from app_private.match_setup_19 where match_id=p_match_id;
 if m.status is distinct from 'countdown'or s.phase is distinct from 'character'or clock_timestamp()>=s.deadline or not exists(select 1 from public.multiplayer_players where match_id=p_match_id and user_id=u)then raise exception 'Original live character selection required';end if;
 select *into g from app_private.six_class_cartography where match_id=p_match_id for update;
 if u=any(g.locked_users)and p_character_key<>'runner_cartographer'then raise exception 'Cartographer remains locked for this match';end if;
 if p_character_key='runner_cartographer'and not coalesce(u=any(g.locked_users),false)then
  if coalesce(g.resolved,false)then raise exception 'The initial Cartographer decision is complete';end if;
  insert into app_private.six_class_cartography(match_id,locked_users,original_map,deadline)values(p_match_id,array[u],m.map_key,greatest(s.deadline,clock_timestamp()+interval '15 seconds'))
  on conflict(match_id)do update set locked_users=array_append(app_private.six_class_cartography.locked_users,u);
  update app_private.match_setup_19 set deadline=greatest(deadline,clock_timestamp()+interval '15 seconds')where match_id=p_match_id;
 end if;
 return app_private.choose_1v1_character_before_cartographer(p_match_id,p_character_key);
 end original_choice;
end $$;

do $guard$ declare h text;begin select md5(prosrc)into h from pg_proc where oid='app_private.six_class_network(uuid,uuid)'::regprocedure;if h not in('01033ac6c5324c25eac7104176134ad6','63f72676e9997a244b88f1b4bc2da4a4')then raise exception 'Source drift: app_private.six_class_network(uuid,uuid)';end if;end $guard$;
create or replace function app_private.six_class_network(mid uuid,u uuid)returns jsonb language plpgsql security definer set search_path=''as $$
declare c app_private.six_class_clocks;events jsonb;checkpoint jsonb;rival jsonb;begin
 perform app_private.ensure_six_class_match(mid,u);
 select *into c from app_private.six_class_clocks where match_id=mid;
 select p.checkpoint into checkpoint from app_private.six_class_players p where match_id=mid and user_id=u;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'action',action,'values',values,'due_at',due_at,'expires_at',expires_at)order by due_at,id),'[]')into events from app_private.six_class_events where match_id=mid and target_user_id=u and acknowledged_at is null and expires_at>=clock_timestamp();
 select jsonb_build_object('lane',p.lane_index,'items',coalesce((select jsonb_agg(jsonb_build_object('id',v->'id','kind',v->'kind','lane',v->'lane','y',v->'y'))from jsonb_array_elements(coalesce(s.checkpoint->'items','[]'))v),'[]'))into rival from public.multiplayer_players p join app_private.six_class_players s on s.match_id=p.match_id and s.user_id=p.user_id where p.match_id=mid and p.user_id<>u limit 1;
 return jsonb_build_object('rival',rival,'wave',c.wave,'wave_started_at',c.wave_started_at,'server_now',coalesce(c.paused_at,clock_timestamp()),'paused',c.paused_at is not null,'events',events,'checkpoint',checkpoint,'cartography',app_private.cartography_view(mid,u));
end $$;
notify pgrst,'reload schema';
commit;
