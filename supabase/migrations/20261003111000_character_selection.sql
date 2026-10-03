-- Multi-device 02 1v1 · ten-second, map-validated character selection.
begin;
alter table public.multiplayer_matches add column if not exists character_selection_ends_at timestamptz;
alter table public.multiplayer_matches alter column character_selection_ends_at set default (clock_timestamp()+interval '10 seconds');
-- Keep a private copy of the existing map/health rules, without changing loadouts.
do $$ declare f text; begin
  if to_regprocedure('app_private.character_selection_snapshot(uuid,text,text)') is null then
    f:=pg_get_functiondef('app_private.character_snapshot_before_terminal(uuid,text)'::regprocedure);
    f:=replace(f,'FUNCTION app_private.character_snapshot_before_terminal(p_user_id uuid, p_map_key text)','FUNCTION app_private.character_selection_snapshot(p_user_id uuid, p_map_key text, p_character_key text)');
    f:=regexp_replace(f,'  select loadout.character_key,catalog.character_class.*?v_key:=coalesce',
      '  select catalog.item_key,catalog.character_class into v_key,v_class from public.extraction_catalog catalog where catalog.item_key=p_character_key and catalog.item_type=''character'' and catalog.active;' || chr(10) || '  v_key:=coalesce','s');
    execute f;
  end if;
  if to_regprocedure('app_private.get_1v1_state_before_character_pick(uuid)') is null then
    f:=pg_get_functiondef('public.get_1v1_state(uuid)'::regprocedure);
    execute replace(f,'FUNCTION public.get_1v1_state(','FUNCTION app_private.get_1v1_state_before_character_pick(');
  end if;
end $$;
revoke all on function app_private.character_selection_snapshot(uuid,text,text),app_private.get_1v1_state_before_character_pick(uuid) from public,anon,authenticated;
create or replace function public.choose_1v1_character(p_match_id uuid,p_character_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); m public.multiplayer_matches; c public.extraction_catalog; r app_private.one_v_one_map_rules; hp record; test boolean;
begin
  if u is null then raise exception 'Sign in required'; end if;
  select * into m from public.multiplayer_matches where id=p_match_id for update;
  if not exists(select 1 from public.multiplayer_players where match_id=p_match_id and user_id=u) then raise exception 'Match not found'; end if;
  if m.status<>'countdown' or m.character_selection_ends_at is null or clock_timestamp()>=m.character_selection_ends_at then raise exception 'Character selection has ended'; end if;
  if app_private.has_active_ban(u,'account',null) then raise exception 'This account is banned'; end if;
  select * into c from public.extraction_catalog where item_key=p_character_key and item_type='character' and active;
  if c.item_key is null then raise exception 'Unknown character'; end if;
  select * into r from app_private.one_v_one_map_rules where map_key=m.map_key;
  select test_mode into test from public.multiplayer_players where match_id=p_match_id and user_id=u;
  test:=coalesce(test,false) and app_private.is_admin_test_user(u);
  if not test and not exists(select 1 from public.player_unlocks where user_id=u and item_key=c.item_key and item_type='character') then raise exception 'You do not own this character'; end if;
  if r.forced_character_key is not null and c.item_key<>r.forced_character_key then raise exception 'This map requires %',r.forced_character_key; end if;
  if not (c.character_class=any(r.allowed_character_classes)) then raise exception 'This class is not permitted on this map'; end if;
  if m.mode='ranked' and c.rarity='mythic' then raise exception 'Mythic characters are not permitted in Ranked'; end if;
  if m.map_key='terminal' then select 'runner_ace'::text character_key,'runner'::text character_class,4::numeric max_hearts,4::numeric starting_hearts into hp;
  else select * into hp from app_private.character_selection_snapshot(u,m.map_key,c.item_key); end if;
  update public.multiplayer_players set character_key=hp.character_key,character_class=hp.character_class,max_hearts=hp.max_hearts,hearts=hp.starting_hearts,last_seen_at=clock_timestamp(),updated_at=clock_timestamp() where match_id=p_match_id and user_id=u;
  return public.get_1v1_state(p_match_id);
end $$;
create or replace function public.get_1v1_state(p_match_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.multiplayer_matches; payload jsonb;
begin
  if auth.uid() is null or not exists(select 1 from public.multiplayer_players where match_id=p_match_id and user_id=auth.uid()) then raise exception 'Match not found'; end if;
  select * into m from public.multiplayer_matches where id=p_match_id for update;
  if m.status='countdown' and m.character_selection_ends_at is not null and clock_timestamp()>=m.character_selection_ends_at then
    update public.multiplayer_matches set status='playing',started_at=clock_timestamp(),last_activity_at=clock_timestamp() where id=p_match_id returning * into m;
    update public.multiplayer_players set wave_started_at=m.started_at,run_started_at=m.started_at,last_seen_at=m.started_at where match_id=p_match_id;
  end if;
  payload:=app_private.get_1v1_state_before_character_pick(p_match_id);
  return jsonb_set(payload,'{match}',(payload->'match')||jsonb_build_object('character_selection_ends_at',m.character_selection_ends_at));
end $$;
-- Old clients cannot skip the selection clock by submitting a playing heartbeat.
do $$ declare f text; begin
  f:=pg_get_functiondef('public.update_1v1_state(uuid,numeric,integer,bigint,text)'::regprocedure);
  if position('character_selection_ends_at' in f)=0 then
    f:=replace(f,'begin' || chr(10),'begin' || chr(10) || '  if exists(select 1 from public.multiplayer_matches m where m.id=p_match_id and m.status=''countdown'' and m.character_selection_ends_at>clock_timestamp()) then return public.get_1v1_state(p_match_id); end if;' || chr(10));
    execute f;
  end if;
  f:=pg_get_functiondef('public.update_1v1_terminal_state(uuid,numeric,integer,bigint,text,numeric)'::regprocedure);
  if position('character_selection_ends_at' in f)=0 then
    f:=replace(f,'begin' || chr(10),'begin' || chr(10) || '  if exists(select 1 from public.multiplayer_matches m where m.id=p_match_id and m.status=''countdown'' and m.character_selection_ends_at>clock_timestamp()) then return public.get_1v1_state(p_match_id); end if;' || chr(10));
    execute f;
  end if;
end $$;
revoke all on function public.choose_1v1_character(uuid,text),public.get_1v1_state(uuid) from public,anon;
grant execute on function public.choose_1v1_character(uuid,text),public.get_1v1_state(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
