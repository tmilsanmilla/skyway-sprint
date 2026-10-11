-- Exact live-function tests using session-local identity. Always rolls back.
begin;
do $$begin
  if not has_function_privilege('authenticated','public.set_loadout(text,text)','execute')
     or not has_function_privilege('authenticated','public.leave_1v1()','execute')
     or has_function_privilege('anon','public.set_loadout(text,text)','execute')
     or has_function_privilege('anon','public.leave_1v1()','execute') then
    raise exception 'Character/leave access repair is missing or grants guest access';
  end if;
end$$;
create function pg_temp.test_uid() returns uuid language sql as $$
  select nullif(current_setting('skyway.test_uid',true),'')::uuid;
$$;
do $$declare sig text;f text;begin
  foreach sig in array array['public.set_loadout(text,text)',
    'app_private.get_1v1_state_before_new_maps(uuid)',
    'app_private.get_1v1_state_before_character_pick(uuid)',
    'public.get_1v1_state(uuid)','public.choose_1v1_character(uuid,text)',
    'public.finish_1v1(uuid)','public.leave_1v1()'] loop
    f:=pg_get_functiondef(sig::regprocedure);
    f:=replace(f,'auth.uid()','pg_temp.test_uid()');
    f:=replace(f,'public.set_loadout','pg_temp.set_loadout');
    f:=replace(f,'app_private.get_1v1_state_before_new_maps','pg_temp.get_1v1_state_before_new_maps');
    f:=replace(f,'app_private.get_1v1_state_before_character_pick','pg_temp.get_1v1_state_before_character_pick');
    f:=replace(f,'public.get_1v1_state','pg_temp.get_1v1_state');
    f:=replace(f,'public.choose_1v1_character','pg_temp.choose_1v1_character');
    f:=replace(f,'public.finish_1v1','pg_temp.finish_1v1');
    f:=replace(f,'public.leave_1v1','pg_temp.leave_1v1');
    execute f;
  end loop;
end$$;
do $$declare a uuid;b uuid;c uuid;mid uuid;key text;locked_key text;look text;payload jsonb;other_loadout jsonb;begin
  select s.user_id into a from public.player_stats s join public.player_profiles p using(user_id)
    where not app_private.has_active_ban(s.user_id,'account',null)
    and not exists(select 1 from public.multiplayer_players mp join public.multiplayer_matches m on m.id=mp.match_id
      where mp.user_id=s.user_id and m.status in('countdown','playing','intermission')) order by s.user_id limit 1;
  select s.user_id into b from public.player_stats s join public.player_profiles p using(user_id)
    where s.user_id<>a and not app_private.has_active_ban(s.user_id,'account',null)
    and not exists(select 1 from public.multiplayer_players mp join public.multiplayer_matches m on m.id=mp.match_id
      where mp.user_id=s.user_id and m.status in('countdown','playing','intermission')) order by s.user_id limit 1;
  if a is null or b is null then raise exception 'Two idle fixture accounts required';end if;
  select user_id into c from public.player_stats where user_id not in(a,b) order by user_id limit 1;
  if c is null then raise exception 'Outside-account fixture required';end if;
  select to_jsonb(l) into other_loadout from public.player_loadouts l where user_id=b;
  perform set_config('skyway.test_uid',a::text,true);
  perform pg_temp.set_loadout('character','medic_patch');
  if not exists(select 1 from public.player_loadouts where user_id=a and character_key='medic_patch' and class_key='medic') then
    raise exception 'Cross-class starter equip failed';end if;
  perform pg_temp.set_loadout('character','tank_bulwark');
  if not exists(select 1 from public.player_loadouts where user_id=a and character_key='tank_bulwark' and class_key='tank') then
    raise exception 'Tank starter equip failed';end if;
  select c.item_key into key from public.extraction_catalog c join public.player_unlocks u using(item_key,item_type)
    where u.user_id=a and c.active and c.item_type='character' and c.character_class='runner' order by c.item_key limit 1;
  if key is null then raise exception 'Owned runner required';end if;
  perform pg_temp.set_loadout('character',key);
  if not exists(select 1 from public.player_loadouts where user_id=a and character_key=key and class_key='runner') then
    raise exception 'Runner equip did not persist';end if;
  select c.item_key into locked_key from public.extraction_catalog c where c.active and c.item_type='character'
    and not exists(select 1 from public.player_unlocks u where u.user_id=a and u.item_key=c.item_key and u.item_type='character') limit 1;
  if locked_key is null then raise exception 'Locked-character fixture required';end if;
  begin perform pg_temp.set_loadout('character',locked_key);raise exception 'Locked character accepted';
    exception when others then if sqlerrm<>'Character is not unlocked' then raise;end if;end;
  select item_key into look from public.player_unlocks where user_id=a and item_type='player' limit 1;
  if look is not null then
    perform pg_temp.set_loadout('player',look);
    if not exists(select 1 from public.player_loadouts where user_id=a and player_cosmetic=look) then raise exception 'Owned cosmetic equip failed';end if;
  end if;
  perform pg_temp.set_loadout('player','');
  if exists(select 1 from public.player_loadouts where user_id=a and player_cosmetic is not null) then raise exception 'Default look reset failed';end if;
  if (select to_jsonb(l) from public.player_loadouts l where user_id=b) is distinct from other_loadout then raise exception 'Another account loadout changed';end if;
  perform set_config('skyway.test_uid','',true);
  begin perform pg_temp.set_loadout('character',key);raise exception 'Guest equip accepted';
    exception when others then if sqlerrm<>'Sign in required' then raise;end if;end;
  -- A separate temporary duel exercises the real selection + hydration chain.
  insert into public.multiplayer_matches(host_user_id,guest_user_id,mode,map_key,map_candidates,status,character_selection_ends_at)
    values(a,b,'casual','classic',array['classic'],'countdown',clock_timestamp()+interval '15 seconds') returning id into mid;
  insert into public.multiplayer_players(match_id,user_id,slot,username,character_key,character_class,max_hearts,hearts)
    values(mid,a,1,'selection fixture one','runner_ace','runner',3,3),(mid,b,2,'selection fixture two','runner_ace','runner',3,3);
  insert into app_private.match_setup_19(match_id,phase,deadline) values(mid,'character',clock_timestamp()+interval '15 seconds');
  perform set_config('skyway.test_uid',a::text,true);
  payload:=pg_temp.choose_1v1_character(mid,'medic_patch');
  if payload->'self'->>'character_key'<>'medic_patch' or (payload->'self'->>'character_confirmed')::boolean is not true then
    raise exception '1v1 healer choice did not hydrate';end if;
  if payload->'match'->>'status'<>'countdown' then raise exception 'Only one choice started the match';end if;
  perform set_config('skyway.test_uid',b::text,true);
  payload:=pg_temp.choose_1v1_character(mid,'tank_bulwark');
  if payload->'self'->>'character_key'<>'tank_bulwark' or payload->'match'->>'status'<>'playing' then
    raise exception '1v1 tank choice/start failed';end if;
  if not exists(select 1 from public.player_loadouts where user_id=a and character_key=key) then raise exception 'Duel overwrote Endless loadout';end if;
  -- Outsiders cannot end another account's match.
  perform set_config('skyway.test_uid',c::text,true);
  begin perform pg_temp.finish_1v1(mid);raise exception 'Outsider ended match';
    exception when others then if sqlerrm<>'1v1 match not found' then raise;end if;end;
  perform set_config('skyway.test_uid',a::text,true);
  payload:=pg_temp.leave_1v1();
  if not exists(select 1 from public.multiplayer_matches where id=mid and status='finished' and winner_user_id=b)
     or not exists(select 1 from public.multiplayer_players where match_id=mid and user_id=a and status='left') then
    raise exception 'Leaving active duel failed to forfeit';end if;
  -- Queue cancellation only removes the caller; repeat leave is safe.
  insert into public.multiplayer_queue(user_id) values(a),(b) on conflict(user_id) do nothing;
  payload:=pg_temp.leave_1v1();
  if payload->>'status'<>'left_queue' or exists(select 1 from public.multiplayer_queue where user_id=a)
     or not exists(select 1 from public.multiplayer_queue where user_id=b) then
    raise exception 'Queue cancellation changed the rival or failed';end if;
  perform pg_temp.leave_1v1();
  perform set_config('skyway.test_uid','',true);
  begin perform pg_temp.leave_1v1();raise exception 'Guest leave accepted';
    exception when others then if sqlerrm<>'Sign in required' then raise;end if;end;
end$$;
select 'PASS: owned character changes, separate 1v1 choices, forfeit, queue cancellation, repeat leave and account isolation' result;
rollback;
