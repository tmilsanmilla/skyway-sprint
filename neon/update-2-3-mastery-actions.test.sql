-- LOCAL-ONLY fixtures; never paste/run on Neon, including as a rollback audit.
begin;
do $local_only$
begin
 if current_database()<>'skyway_mastery_fixture' or inet_server_addr() is not null
  or current_setting('skyway.local_mastery_fixture',true) is distinct from 'skyway-mastery-disposable-v1'
  or to_regclass('app_private.local_test_fixture_marker') is null then raise exception 'LOCAL-ONLY mastery action test refused';end if;
 if (select count(*) from public.player_stats)<>2 or not exists(select 1 from app_private.local_test_fixture_marker where marker='skyway-mastery-disposable-v1') then raise exception 'LOCAL-ONLY actor/marker mismatch';end if;
end $local_only$;
do $actions$
declare u uuid:='11111111-1111-4111-8111-111111111111';v uuid:='22222222-2222-4222-8222-222222222222';
 mid uuid:='33333333-3333-4333-8333-333333333333';other_mid uuid:='44444444-4444-4444-8444-444444444444';
 rid uuid:='55555555-5555-4555-8555-555555555555';aid uuid;tap uuid;sid uuid;r jsonb;before_gems bigint;token uuid;batch jsonb;
begin
 perform set_config('skyway.test_uid',u::text,true);
 insert into public.player_unlocks(user_id,item_key,item_type,rarity) values(u,'trickster_smoke','character','rare'),(u,'tank_guard','character','rare');
 insert into public.multiplayer_matches(id,status,started_at) values(mid,'playing',clock_timestamp()),(other_mid,'playing',clock_timestamp());
 insert into public.multiplayer_players(match_id,user_id,character_key,status,hearts,wave) values(mid,u,'trickster_smoke','playing',3,1),(mid,v,'runner_ace','playing',3,1),(other_mid,v,'runner_ace','playing',3,1);
 insert into public.player_progression_1v1_activity(match_id,user_id,active_seconds,last_heartbeat_at,heartbeat_active,verified_wave) values(mid,u,100,clock_timestamp(),true,1),(mid,v,100,clock_timestamp(),true,1);
 begin perform public.get_mastery_smoke_effect(other_mid);raise exception 'Unrelated match accepted';exception when others then if sqlerrm<>'Owned 1v1 match required' then raise;end if;end;
 aid:=gen_random_uuid();r:=public.begin_mastery_smoke_charge(mid,aid);
 begin perform public.use_mastery_smoke(mid,3,aid);raise exception 'Instant held attack accepted';exception when others then if sqlerrm<>'Hold E for the full Smoke charge time during active play' then raise;end if;end;
 begin perform public.use_mastery_smoke(mid,5,aid);raise exception 'Unmastered strong attack accepted';exception when others then if sqlerrm<>'Complete and enable Smoke mastery for stronger hold attacks' then raise;end if;end;
 update app_private.mastery_smoke_state set charge_started_at=clock_timestamp()-interval '3 seconds' where match_id=mid and user_id=u;
 begin perform public.use_mastery_smoke(mid,3,aid);raise exception 'Paused hold accepted';exception when others then if sqlerrm<>'Hold E for the full Smoke charge time during active play' then raise;end if;end;
 update public.player_progression_1v1_activity set active_seconds=103 where match_id=mid and user_id=u;
 r:=public.use_mastery_smoke(mid,3,aid);
 if r->>'strength'<>'mild' or r->>'bombs_remaining' is not null or (r->>'duration')::integer<>10 then raise exception 'Basic Smoke throw incorrect';end if;
 if abs(extract(epoch from (r->>'cooldown_until')::timestamptz-clock_timestamp())-12)>.5 then raise exception 'Basic Smoke cooldown incorrect';end if;
 r:=public.use_mastery_smoke(mid,3,aid);if (r->>'duplicate')::boolean is not true or (select count(*) from app_private.mastery_smoke_actions)<>1 then raise exception 'Smoke replay spent twice';end if;
 begin perform public.use_mastery_smoke(mid,0,aid);raise exception 'Action ID substitution accepted';exception when others then if sqlerrm<>'Smoke action ID was already used for a different action' then raise;end if;end;
 begin perform public.use_mastery_smoke(mid,0,gen_random_uuid());raise exception 'Smoke cooldown ignored';exception when others then if sqlerrm<>'Smoke is cooling down' then raise;end if;end;
 perform set_config('skyway.test_uid',v::text,true);r:=public.get_mastery_smoke_effect(mid);if r->>'strength'<>'mild' then raise exception 'Opponent smoke hydration missing';end if;
 begin perform public.use_mastery_smoke(mid,0,gen_random_uuid());raise exception 'Non-Smoke player activated';exception when others then if sqlerrm<>'Use your unlocked Smoke character' then raise;end if;end;
 perform set_config('skyway.test_uid',u::text,true);
 insert into app_private.player_mastery_quests(user_id,character_key,quest,mastered,mastery_enabled,flair_rewrite_enabled) values(u,'trickster_smoke',3,true,true,true),(u,'tank_guard',3,true,true,true);
 update app_private.mastery_smoke_state set cooldown_until=clock_timestamp()-interval '1 second' where match_id=mid and user_id=u;
 tap:=gen_random_uuid();r:=public.use_mastery_smoke(mid,0,tap);if (r->>'bombs_remaining')::integer<>2 then raise exception 'Mastered tap did not spend one';end if;
 if abs(extract(epoch from (r->>'cooldown_until')::timestamptz-clock_timestamp())-5)>.5 then raise exception 'Mastered tap cooldown incorrect';end if;
 update app_private.mastery_smoke_state set cooldown_until=clock_timestamp()-interval '1 second' where match_id=mid and user_id=u;
 aid:=gen_random_uuid();perform public.begin_mastery_smoke_charge(mid,aid);
 update app_private.mastery_smoke_state set charge_started_at=clock_timestamp()-interval '5 seconds' where match_id=mid and user_id=u;
 update public.player_progression_1v1_activity set active_seconds=108 where match_id=mid and user_id=u;
 r:=public.use_mastery_smoke(mid,5,aid);if (r->>'bombs_remaining')::integer<>0 or r->>'strength'<>'grey' or (r->>'self_heavy')::boolean is not true then raise exception 'Shared smoke bomb budget incorrect';end if;
 update app_private.mastery_smoke_state set cooldown_until=clock_timestamp()-interval '1 second' where match_id=mid and user_id=u;
 begin perform public.use_mastery_smoke(mid,0,gen_random_uuid());raise exception 'Fourth smoke bomb accepted';exception when others then if sqlerrm<>'All three smoke bombs were used this wave' then raise;end if;end;
 update public.multiplayer_players set wave=2 where match_id=mid and user_id=u;
 r:=public.get_mastery_smoke_effect(mid);if (r->>'own_bombs_remaining')::integer<>3 then raise exception 'New wave bomb budget did not reset';end if;
 r:=public.use_mastery_smoke(mid,0,gen_random_uuid());
 update app_private.mastery_smoke_state set cooldown_until=clock_timestamp()-interval '1 second' where match_id=mid and user_id=u;
 aid:=gen_random_uuid();perform public.begin_mastery_smoke_charge(mid,aid);
 update app_private.mastery_smoke_state set charge_started_at=clock_timestamp()-interval '10 seconds' where match_id=mid and user_id=u;
 update public.player_progression_1v1_activity set active_seconds=118 where match_id=mid and user_id=u;
 r:=public.use_mastery_smoke(mid,10,aid);if (r->>'bombs_remaining')::integer<>0 or r->>'strength'<>'heavy-grey' then raise exception 'Full hold did not spend all remaining bombs';end if;
 insert into app_private.mastery_sessions(user_id,context_id,context_type,character_key,flair_character) values(u,mid,'1v1','trickster_smoke','trickster_smoke');
 perform set_config('skyway.test_uid',v::text,true);r:=public.get_mastery_smoke_effect(mid);if (r->>'flair_top')::numeric<>.4 then raise exception 'Paired Smoke flair missing';end if;
 update public.multiplayer_players set character_key='runner_ace' where match_id=mid and user_id=u;r:=public.get_mastery_smoke_effect(mid);if (r->>'flair_top')::numeric<>.2 then raise exception 'Cross-character Smoke flair missing';end if;
 perform set_config('skyway.test_uid',u::text,true);update public.multiplayer_players set character_key='trickster_smoke' where match_id=mid and user_id=u;
 update public.multiplayer_matches set status='intermission' where id=mid;
 begin perform public.begin_mastery_smoke_charge(mid,gen_random_uuid());raise exception 'Intermission smoke accepted';exception when others then if sqlerrm<>'Smoke requires active 1v1 play' then raise;end if;end;
 update public.multiplayer_matches set status='playing' where id=mid;
 update app_private.mastery_sessions set finished_at=clock_timestamp() where user_id=u and finished_at is null;
 insert into public.player_progression_runs(run_id,user_id,active_seconds,verified_wave,last_heartbeat_at,heartbeat_active) values(rid,u,300,2,clock_timestamp(),true);
 insert into public.player_loadouts(user_id,character_key) values(u,'tank_guard') on conflict(user_id) do update set character_key='tank_guard';
 r:=public.begin_mastery_session(rid,'endless','tank_guard');sid:=(r->>'session_id')::uuid;
 select total_gems into before_gems from public.player_stats where user_id=u;
 begin perform public.claim_mastery_blue_gem(rid,'blue-one');raise exception 'Blue reward outside Guard mode';exception when others then if sqlerrm<>'Active Guard mode required for a blue Gem' then raise;end if;end;
 perform public.set_mastery_guard_mode(rid,true);
 insert into public.player_endless_gem_streaks(run_id,user_id,wave,streak) values(rid,u,2,2);
 r:=public.claim_mastery_blue_gem(rid,'blue-one');if (r->>'gems_awarded')::integer<>4 or (r->>'guard_blue_tier')::integer<>4 then raise exception 'Blue Gem did not jump x2 to x4';end if;
 r:=public.claim_mastery_blue_gem(rid,'blue-one');if (r->>'is_new')::boolean is not false or (select guard_blue_gems from app_private.mastery_sessions where id=sid)<>1 then raise exception 'Blue retry spent twice';end if;
 r:=public.claim_mastery_blue_gem(rid,'blue-two');if (r->>'gems_awarded')::integer<>6 or (r->>'guard_blue_tier')::integer<>6 then raise exception 'Blue plateau jump incorrect';end if;
 begin perform public.claim_mastery_blue_gem(rid,'blue-three');raise exception 'Third blue Gem accepted';exception when others then if sqlerrm<>'Only two blue objects can appear per wave' then raise;end if;end;
 if (select total_gems from public.player_stats where user_id=u)<>before_gems+10 then raise exception 'Blue receipt overpaid';end if;
 update public.player_progression_runs set verified_wave=3 where run_id=rid;
 r:=public.claim_mastery_blue_gem(rid,'blue-new-wave');if (r->>'gems_awarded')::integer<>8 then raise exception 'Blue per-wave reset incorrect';end if;
 if (select count(*) from public.player_progression_events where user_id=u and metadata->>'context_id'=rid::text)<>3 then raise exception 'Blue Gems are not one physical receipt each';end if;
 -- Dash healing must consume one fresh server-recorded block receipt. No
 -- public state/half-heart validation is relaxed for other characters.
 update app_private.mastery_sessions set finished_at=clock_timestamp() where user_id=u and finished_at is null;
 update public.multiplayer_players set character_key='runner_dash',hearts=1.3475,max_hearts=3 where match_id=mid and user_id=u;
 insert into public.player_unlocks(user_id,item_key,item_type,rarity) values(u,'runner_dash','character','common');
 insert into app_private.player_mastery_quests(user_id,character_key,quest,mastered,mastery_enabled) values(u,'runner_dash',3,true,true);
 r:=public.begin_mastery_session(mid,'1v1','runner_dash');sid:=(r->>'session_id')::uuid;
 update app_private.mastery_sessions set started_at=clock_timestamp()-interval '10 seconds' where id=sid;
 token:=gen_random_uuid();
 begin perform public.apply_mastery_heal(mid,token,'dash-green');raise exception 'Unrecorded heal accepted';exception when others then if sqlerrm<>'A verified mastery block receipt is required' then raise;end if;end;
 batch:=jsonb_build_array(jsonb_build_object('seq',1,'at',1,'type','dash'),jsonb_build_object('seq',2,'at',1.2,'type','block','source','dash','green',true,'event_id',token));
 perform public.credit_mastery_events(sid,batch);
 r:=public.apply_mastery_heal(mid,token,'dash-green');if (r->>'hearts')::numeric<>2.3475 or (r->>'healed')::numeric<>1 then raise exception 'Fractional Dash heal incorrect';end if;
 r:=public.apply_mastery_heal(mid,token,'dash-green');if (r->>'duplicate')::boolean is not true or (r->>'hearts')::numeric<>2.3475 then raise exception 'Heal replay duplicated reward';end if;
 update public.multiplayer_players set hearts=1.1125 where match_id=mid and user_id=u;
 r:=public.apply_mastery_heal(mid,token,'dash-green');if (r->>'hearts')::numeric<>1.1125 then raise exception 'Heal replay resurrected later lost HP';end if;
 perform set_config('skyway.test_uid',v::text,true);
 begin perform public.apply_mastery_heal(mid,token,'dash-green');raise exception 'Cross-account heal token accepted';exception when others then if sqlerrm<>'A verified mastery block receipt is required' then raise;end if;end;
 perform set_config('skyway.test_uid',u::text,true);
 token:=gen_random_uuid();perform public.credit_mastery_events(sid,jsonb_build_array(jsonb_build_object('seq',3,'at',1.3,'type','block','source','dash','green',true,'event_id',token)));
 update app_private.mastery_heal_tokens set created_at=clock_timestamp()-interval '9 seconds' where event_id=token;
 begin perform public.apply_mastery_heal(mid,token,'dash-green');raise exception 'Expired heal accepted';exception when others then if sqlerrm<>'Mastery heal receipt expired' then raise;end if;end;
 token:=gen_random_uuid();perform public.credit_mastery_events(sid,jsonb_build_array(jsonb_build_object('seq',4,'at',1.4,'type','block','source','dash','green',true,'event_id',token)));
 update app_private.player_mastery_quests set mastery_enabled=false where user_id=u and character_key='runner_dash';
 begin perform public.apply_mastery_heal(mid,token,'dash-green');raise exception 'Disabled mastery heal accepted';exception when others then if sqlerrm<>'Active owned Dash mastery play is required' then raise;end if;end;
 update app_private.player_mastery_quests set mastery_enabled=true where user_id=u and character_key='runner_dash';
 delete from public.player_unlocks where user_id=u and item_key='runner_dash';
 begin perform public.apply_mastery_heal(mid,token,'dash-green');raise exception 'Unowned mastery heal accepted';exception when others then if sqlerrm<>'Mastery healing is not available in this match' then raise;end if;end;
 -- Salve's used heals remain per run across a fresh begin/read, not per page.
 update app_private.mastery_sessions set finished_at=clock_timestamp() where user_id=u and finished_at is null;
 insert into public.player_unlocks(user_id,item_key,item_type,rarity) values(u,'medic_salve','character','uncommon');
 update public.player_loadouts set character_key='medic_salve' where user_id=u;
 r:=public.begin_mastery_session(rid,'endless','medic_salve');sid:=(r->>'session_id')::uuid;
 update app_private.mastery_sessions set started_at=clock_timestamp()-interval '10 minutes' where id=sid;
 if public.get_mastery_salve_uses(rid)<>0 then raise exception 'Fresh Salve run did not start at zero uses';end if;
 batch:='[{"seq":1,"at":1,"type":"salve-heal"},{"seq":2,"at":11,"type":"salve-heal"}]';
 perform public.credit_mastery_events(sid,batch);perform public.credit_mastery_events(sid,batch);
 if public.get_mastery_salve_uses(rid)<>2 then raise exception 'Salve uses did not persist or replay double-counted';end if;
 begin perform public.credit_mastery_events(sid,'[{"seq":3,"at":21,"type":"salve-heal"}]');raise exception 'Third unmastered Salve heal accepted';exception when others then if sqlerrm<>'Salve has used all special heals for this run' then raise;end if;end;
 insert into app_private.player_mastery_quests(user_id,character_key,quest,mastered,mastery_enabled) values(u,'medic_salve',3,true,true);
 perform public.credit_mastery_events(sid,'[{"seq":3,"at":21,"type":"salve-heal"}]');
 r:=public.begin_mastery_session(rid,'endless','medic_salve');
 if (r->>'session_id')::uuid<>sid or (r->>'last_seq')::integer<>3 or (r->>'last_at')::numeric<>21 or public.get_mastery_salve_uses(rid)<>3 then raise exception 'Restored mastered Salve run reset uses/cursor';end if;
 begin perform public.credit_mastery_events(sid,'[{"seq":4,"at":31,"type":"salve-heal"}]');raise exception 'Fourth mastered Salve heal accepted';exception when others then if sqlerrm<>'Salve has used all special heals for this run' then raise;end if;end;
 perform set_config('skyway.test_uid',v::text,true);
 begin perform public.get_mastery_salve_uses(rid);raise exception 'Cross-account Salve uses exposed';exception when others then if sqlerrm<>'Owned active Salve run required' then raise;end if;end;
 perform set_config('skyway.test_uid','',true);
 begin perform public.get_mastery_smoke_effect(mid);raise exception 'Guest Smoke access accepted';exception when others then if sqlerrm<>'Sign in required' then raise;end if;end;
end $actions$;
do $permissions$
declare f text;t text;
begin
 foreach f in array array['public.begin_mastery_smoke_charge(uuid,uuid)','public.use_mastery_smoke(uuid,integer,uuid)','public.get_mastery_smoke_effect(uuid)','public.set_mastery_guard_mode(uuid,boolean)','public.claim_mastery_blue_gem(uuid,text)','public.apply_mastery_heal(uuid,uuid,text)','public.get_mastery_salve_uses(uuid)'] loop
  if not has_function_privilege('authenticated',f,'execute') or has_function_privilege('anon',f,'execute') or has_function_privilege('anonymous',f,'execute') then raise exception 'Action RPC permission mismatch: %',f;end if;
 end loop;
 foreach t in array array['app_private.mastery_smoke_state','app_private.mastery_smoke_actions','app_private.mastery_heal_tokens'] loop
  if has_table_privilege('authenticated',t,'select,insert,update,delete') then raise exception 'Direct action table exposed';end if;
 end loop;
 if has_function_privilege('authenticated','app_private.mastery_smoke_actor(uuid)','execute') then raise exception 'Private Smoke actor helper exposed';end if;
end $permissions$;
select 'PASS: server-clock Smoke charge/budget/replay/ownership, blue-Gem atomic streak receipts, single-use Dash heal receipts/fractions and durable Salve use caps' result;
rollback;
