-- Disposable-schema fixture only. Harness surrounds this file with BEGIN/ROLLBACK.
create function pg_temp.check_it(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Fixture failed: %',label;end if;end $$;
do $fixture$
declare a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();stranger uuid:=gen_random_uuid();mid uuid;
 payload jsonb;old_points numeric;expected_points numeric;bonus integer;normal_lane integer;i integer;before_bans jsonb;rejected boolean;
begin
 insert into public.multiplayer_matches(host_user_id,guest_user_id,map_key,status,current_wave,started_at,intermission_ends_at)
 values(a,b,'classic','intermission',2,clock_timestamp()-interval '30 seconds',clock_timestamp()+interval '10 seconds') returning id into mid;
 insert into public.multiplayer_players(match_id,user_id,slot,username,status,wave,obstacle_points,lane_index)
 values(mid,a,1,'fixture-a','intermission',2,10000,2),(mid,b,2,'fixture-b','intermission',2,10000,1);
 perform set_config('test.uid',a::text,true);
 payload:=public.send_1v1_attack(mid,'rock',15);
 perform pg_temp.check_it((payload->>'point_cost')::integer=15,'first rock costs15');
 payload:=public.send_1v1_attack(mid,'snowflake',13);
 perform pg_temp.check_it((payload->>'point_cost')::integer=13,'cross-type purchase increases snowflake by2');
 for i in 1..5 loop perform public.send_1v1_attack(mid,'snowflake',null);end loop;
 perform pg_temp.check_it((select quantity=6 from app_private.armory_purchases where match_id=mid and user_id=a and kind='snowflake'),'snowflakes are uncapped');
 for i in 1..3 loop perform public.send_1v1_attack(mid,'rock',null);end loop;
 select obstacle_points into old_points from public.multiplayer_players where match_id=mid and user_id=a;
 rejected:=false;begin perform public.send_1v1_attack(mid,'rock',null);exception when others then rejected:=sqlerrm like 'Maximum four%';end;
 perform pg_temp.check_it(rejected,'fifth rock rejected');
 perform pg_temp.check_it((select obstacle_points=old_points from public.multiplayer_players where match_id=mid and user_id=a),'rejected purchase does not spend coins');
 update public.multiplayer_matches set map_key='skyway',current_wave=3 where id=mid;
 update public.multiplayer_players set wave=3 where match_id=mid;
 payload:=public.send_1v1_attack(mid,'snowflake',12);
 perform pg_temp.check_it((payload->>'point_cost')::integer=12,'Skyway snowflake starts12 eachnewwave');
 rejected:=false;begin perform public.send_1v1_attack(mid,'barrel',null);exception when others then rejected:=sqlerrm='Obstacle unavailable on this map';end;
 perform pg_temp.check_it(rejected,'Skyway cannot buy barrels despite natural barrels');
 perform set_config('test.uid',stranger::text,true);
 rejected:=false;begin perform public.send_1v1_attack(mid,'log',null);exception when others then rejected:=sqlerrm='Match not found';end;
 perform pg_temp.check_it(rejected,'nonmember cannot buy or view another match');
 perform set_config('test.uid',a::text,true);

 update public.multiplayer_matches set map_key='meadow',current_wave=2 where id=mid;
 update public.multiplayer_players set wave=2,obstacle_points=0 where match_id=mid;
 insert into public.player_progression_1v1_activity(match_id,user_id,active_seconds,verified_wave) values(mid,a,100,2);
 bonus:=(app_private.one_v_one_wave_rules(mid,1)->>'bonus_lane_index')::integer;normal_lane:=(bonus+1)%6;
 payload:=public.sync_1v1_intermission_coins(mid,array['fixture-coin-a:lane:'||bonus,'fixture-coin-b:lane:'||normal_lane]);
 perform pg_temp.check_it((payload->>'awarded')::numeric=10,'Meadow mixed7/3 point coins');
 payload:=public.sync_1v1_intermission_coins(mid,array['fixture-coin-a:lane:'||normal_lane,'fixture-coin-b:lane:'||bonus]);
 perform pg_temp.check_it((payload->>'awarded')::numeric=0,'lane suffix cannot bypass stable pickup idempotency');
 rejected:=false;begin perform public.sync_1v1_intermission_coins(mid,array['fixture-new:lane:9']);exception when others then rejected:=sqlerrm='Invalid Meadow coin lane receipt';end;
 perform pg_temp.check_it(rejected,'out-of-range bonus lane rejected');
 rejected:=false;begin perform public.sync_1v1_intermission_coins(mid,array['fixture-new:lane:1','fixture-new:lane:2']);exception when others then rejected:=sqlerrm='Conflicting Meadow coin lane receipts';end;
 perform pg_temp.check_it(rejected,'conflicting same-id lane claims rejected');
 perform pg_temp.check_it(has_function_privilege('authenticated','public.sync_1v1_intermission_coins(uuid,text[])','execute') and not has_function_privilege('anon','public.sync_1v1_intermission_coins(uuid,text[])','execute'),'coin sync signed-in-only execution restored');

 update public.multiplayer_matches set map_key='terminal' where id=mid;
 rejected:=false;begin perform public.send_1v1_attack(mid,'log',null);exception when others then rejected:=sqlerrm='Terminal has no attack purchases';end;
 perform pg_temp.check_it(rejected,'Terminal armory closed');
 rejected:=false;begin perform public.sync_1v1_intermission_coins(mid,array['terminal-coin']);exception when others then rejected:=sqlerrm='Terminal does not use attack coins';end;
 perform pg_temp.check_it(rejected,'Terminal cannot collect attack currency');
 update public.multiplayer_matches set status='playing',current_wave=1 where id=mid;
 update public.multiplayer_players set status='playing',wave=1,hearts=3,lane_index=case when user_id=a then 2 else 1 end where match_id=mid;
 perform public.set_1v1_terminal_facing(mid,-1);
 rejected:=false;begin perform public.update_1v1_position(mid,3);exception when others then rejected:=sqlerrm='Face forward or toward that lane before moving';end;
 perform pg_temp.check_it(rejected,'left-facing cannot move right');
 payload:=public.use_1v1_terminal_sword(mid);
 perform pg_temp.check_it((payload->>'sword_hit')::boolean,'left-facing sword hits rival in adjacent left lane');
 perform pg_temp.check_it((select hearts=2 from public.multiplayer_players where match_id=mid and user_id=b),'directional sword damages rival');
 perform pg_temp.check_it((select sword_durability=4 from public.multiplayer_players where match_id=mid and user_id=a),'successful hit does not spend durability');
 perform public.set_1v1_terminal_facing(mid,0);perform public.update_1v1_position(mid,3);
 perform pg_temp.check_it((select lane_index=3 from public.multiplayer_players where match_id=mid and user_id=a),'forward-facing permits either direction');

 -- Ruins choices are stored once per match, not separately per player/device.
 update public.multiplayer_matches set map_key='ruins',current_wave=1 where id=mid;
 update public.multiplayer_players set wave=1,lane_index=1,hearts=3 where match_id=mid;
 for i in 1..16 loop
  insert into public.extraction_catalog(item_key,display_name,item_type,rarity,character_class,active)
  values('runner_fixture_'||i,'Fixture runner '||i,'character','rare','runner',true);
 end loop;
 insert into public.extraction_catalog(item_key,display_name,item_type,rarity,character_class,active) values
 ('runner_ace','Ace','character','common','runner',true),('tank_bulwark','Bulwark','character','common','tank',true),
 ('trickster_rogue','Rogue','character','common','trickster',true),('medic_patch','Patch','character','common','medic',true),
 ('medic_fixture','Medic','character','rare','medic',true),('runner_mythic_fixture','Mythic','character','mythic','runner',true);
 perform app_private.prepare_ruins_bans(mid);
 select jsonb_agg(character_key order by character_key) into before_bans from app_private.ruins_character_bans where match_id=mid;
 perform app_private.prepare_ruins_bans(mid);
 perform pg_temp.check_it((select count(*)=10 and jsonb_agg(character_key order by character_key)=before_bans from app_private.ruins_character_bans where match_id=mid),'Ruins bans persist on replay');
 perform pg_temp.check_it(not exists(select 1 from app_private.ruins_character_bans r join public.extraction_catalog c on c.item_key=r.character_key where match_id=mid and (c.rarity='mythic' or c.character_class='medic' or c.item_key in('runner_ace','tank_bulwark','trickster_rogue'))),'Ruins excludes mythics/healers/starters from random pool');
 payload:=public.record_1v1_ruins_pumpkin(mid,1,false);
 perform pg_temp.check_it((payload->'self'->>'ruins_pumpkins_missed')::integer=1,'first miss persisted');
 payload:=public.record_1v1_ruins_pumpkin(mid,1,false);
 perform pg_temp.check_it((payload->'self'->>'ruins_pumpkins_missed')::integer=1,'miss retry idempotent');
 rejected:=false;begin perform public.record_1v1_ruins_pumpkin(mid,1,true);exception when others then rejected:=sqlerrm='Pumpkin outcome already recorded';end;
 perform pg_temp.check_it(rejected,'cannot reverse finalized miss');
 update public.multiplayer_matches set current_wave=2 where id=mid;update public.multiplayer_players set wave=2 where match_id=mid;
 perform public.record_1v1_ruins_pumpkin(mid,2,true);
 perform pg_temp.check_it((select ruins_pumpkins_missed=0 from public.multiplayer_players where match_id=mid and user_id=a),'collect resets missed chain');
 for i in 3..5 loop
  update public.multiplayer_matches set current_wave=i where id=mid;update public.multiplayer_players set wave=i where match_id=mid;
  perform public.record_1v1_ruins_pumpkin(mid,i,false);
 end loop;
 perform pg_temp.check_it((select hearts=0 and status='eliminated' and ruins_pumpkins_missed=3 from public.multiplayer_players where match_id=mid and user_id=a),'three misses eliminate server-side');
 perform pg_temp.check_it(not has_function_privilege('anon','public.record_1v1_ruins_pumpkin(uuid,integer,boolean)','execute'),'guest cannot invoke pickup RPC');
 perform pg_temp.check_it(not has_function_privilege('authenticated','app_private.prepare_ruins_bans(uuid)','execute'),'players cannot reroll bans');
 perform pg_temp.check_it(has_function_privilege('authenticated','public.set_1v1_terminal_facing(uuid,integer)','execute'),'signedin facing permission');
 perform pg_temp.check_it((select relrowsecurity from pg_class where oid='app_private.ruins_pumpkin_receipts'::regclass),'private pumpkin receipts RLS enabled');

 -- Real installed leaderboard readers, with only ban membership mocked locally.
 insert into public.player_profiles(user_id,username) values(a,'fixture_a'),(b,'fixture_b'),(stranger,'fixture_hidden');
 insert into public.player_stats(user_id,high_score) values(a,100),(b,200),(stranger,999999);
 insert into app_private.fixture_bans values(stranger,'leaderboard');
 insert into public.ranked_1v1_seasons(id,name,is_active) values(777,'Fixture season',true);
 insert into public.player_ranked_1v1_stats(season_id,user_id,rating,matches_played,wins,losses)
 values(777,a,1500,10,6,4),(777,b,1700,10,7,3),(777,stranger,9999,10,10,0);
 perform set_config('test.uid',a::text,true);
 perform pg_temp.check_it((select count(*)=2 from public.get_leaderboard()),'endless leaderboard sample count excludes banned player');
 perform pg_temp.check_it((select username='fixture_b' from public.get_leaderboard() where rank=1),'endless score ordering');
 perform pg_temp.check_it((select count(*)=2 from public.get_1v1_leaderboard(50,0)),'ranked leaderboard sample count excludes banned player');
 perform pg_temp.check_it((select is_self from public.get_1v1_leaderboard(50,0) where username='fixture_a'),'ranked is_self tied to authenticated caller');
 rejected:=false;begin perform public.get_1v1_leaderboard(101,0);exception when others then rejected:=sqlerrm='Leaderboard limit must be between 1 and 100';end;
 perform pg_temp.check_it(rejected,'ranked reader keeps bounded limits');
 perform set_config('test.uid','',true);
 perform pg_temp.check_it((select count(*)=0 from public.get_leaderboard()),'endless reader returns no rows without signed identity');
 rejected:=false;begin perform public.get_1v1_leaderboard(50,0);exception when others then rejected:=sqlerrm='Sign in required';end;
 perform pg_temp.check_it(rejected,'ranked reader requires signed identity');
 perform pg_temp.check_it(has_function_privilege('authenticated','public.get_leaderboard()','execute') and has_function_privilege('authenticated','public.get_1v1_leaderboard(integer,integer)','execute'),'only existing signed-in leaderboard reads restored');
 perform pg_temp.check_it(not has_function_privilege('anon','public.get_leaderboard()','execute') and not has_function_privilege('anonymous','public.get_1v1_leaderboard(integer,integer)','execute'),'no anonymous leaderboard execution');
 perform pg_temp.check_it((select high_score=999999 from public.player_stats where user_id=stranger),'reader did not rewrite banned score');
end $fixture$;
