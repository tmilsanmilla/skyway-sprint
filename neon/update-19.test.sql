-- Run after Update 19 definitions inside BEGIN ... ROLLBACK only.
-- Temporary clones substitute test identity; production auth and grants stay intact.
create function pg_temp.test_uid() returns uuid language sql as $$select nullif(current_setting('skyway.test_uid',true),'')::uuid$$;
do $$declare signature text;f text;begin
 foreach signature in array array[
  'app_private.get_1v1_state_before_new_maps(uuid)',
  'app_private.get_1v1_state_before_character_pick(uuid)',
  'public.get_1v1_state(uuid)','public.ban_1v1_map(uuid,text)',
  'public.choose_1v1_character(uuid,text)','public.join_1v1_queue(text)',
  'public.update_1v1_state(uuid,numeric,integer,bigint,text)'] loop
  f:=pg_get_functiondef(signature::regprocedure);
  f:=replace(f,'auth.uid()','pg_temp.test_uid()');
  f:=replace(f,'app_private.get_1v1_state_before_new_maps','pg_temp.get_1v1_state_before_new_maps');
  f:=replace(f,'app_private.get_1v1_state_before_character_pick','pg_temp.get_1v1_state_before_character_pick');
  f:=replace(f,'public.get_1v1_state','pg_temp.get_1v1_state');
  f:=replace(f,'public.ban_1v1_map','pg_temp.ban_1v1_map');
  f:=replace(f,'public.choose_1v1_character','pg_temp.choose_1v1_character');
  f:=replace(f,'public.join_1v1_queue','pg_temp.join_1v1_queue');
  f:=replace(f,'public.update_1v1_state','pg_temp.update_1v1_state');
  f:=replace(f,'app_private.rotating_mode_19(now())','current_setting(''skyway.test_mode'')');
  f:=replace(f,'q.user_id<>u and q.mode=k','q.user_id<>u and q.user_id=current_setting(''skyway.test_other'')::uuid and q.mode=k');
  execute f;
 end loop;
end $$;
do $$declare a uuid;b uuid;mid uuid;payload jsonb;other jsonb;key text;owned_before bigint;rejected boolean;chosen text;score_a bigint;score_b bigint;ratings_before bigint;recent bigint;season integer;j integer;finish_at timestamptz;begin
 select s.user_id into a from public.player_stats s join public.player_profiles p using(user_id)
 where not app_private.has_active_ban(s.user_id,'account',null) and not exists(select 1 from public.multiplayer_players mp join public.multiplayer_matches m on m.id=mp.match_id where mp.user_id=s.user_id and m.status in('countdown','playing','intermission')) order by s.user_id limit 1;
 select s.user_id into b from public.player_stats s join public.player_profiles p using(user_id)
 where s.user_id<>a and not app_private.has_active_ban(s.user_id,'account',null) and not exists(select 1 from public.multiplayer_players mp join public.multiplayer_matches m on m.id=mp.match_id where mp.user_id=s.user_id and m.status in('countdown','playing','intermission')) order by s.user_id limit 1;
 if a is null or b is null then raise exception 'Need two idle fixture accounts';end if;
 perform set_config('skyway.test_uid',a::text,true);perform set_config('skyway.test_other',b::text,true);perform set_config('skyway.test_mode','rng',true);
 update public.player_stats set level=25 where user_id in(a,b);
 insert into public.multiplayer_queue(user_id,queued_at,mode) values(b,now(),'casual') on conflict(user_id) do update set mode='casual',queued_at=now();
 payload:=pg_temp.join_1v1_queue('casual');mid:=(payload->>'match_id')::uuid;
 if mid is null or (select cardinality(map_candidates) from public.multiplayer_matches where id=mid)<>4 then raise exception 'Four candidate maps missing';end if;
 select map_candidates[1] into key from public.multiplayer_matches where id=mid;
 payload:=pg_temp.ban_1v1_map(mid,key);
 if payload->'match'->>'setup_phase'<>'ban' or payload->'match'->'revealed_bans'<>'null'::jsonb then raise exception 'Ban leaked or advanced with only one vote';end if;
 -- Old clients cannot skip setup using a gameplay update.
 payload:=pg_temp.update_1v1_state(mid,3,1,0,'playing');
 if payload->'match'->>'status'<>'countdown' then raise exception 'Gameplay update skipped bans';end if;
 perform set_config('skyway.test_uid',b::text,true);
 payload:=pg_temp.ban_1v1_map(mid,key);
 if payload->'match'->>'setup_phase'<>'announce' or payload->'match'->>'map_key'=key or jsonb_array_length(payload->'match'->'revealed_bans')<>2 then raise exception 'Early same-map ban resolution failed';end if;
 if (select extract(epoch from deadline-clock_timestamp()) from app_private.match_setup_19 where match_id=mid) not between 3 and 4.1 then raise exception 'Announcement is not four seconds';end if;
 -- Choose Classic to exercise the class picker without a forced-character map.
 update public.multiplayer_matches set map_key='classic' where id=mid;
 update app_private.match_setup_19 set deadline=clock_timestamp()-interval '1 second' where match_id=mid;
 payload:=pg_temp.get_1v1_state(mid);
 if payload->'match'->>'setup_phase'<>'character' then raise exception 'Character phase missing';end if;
 if (select extract(epoch from deadline-clock_timestamp()) from app_private.match_setup_19 where match_id=mid) not between 14 and 15.1 then raise exception 'Character selection is not fifteen seconds';end if;
 select c.item_key into key from public.extraction_catalog c where c.active and c.item_type='character' and not exists(select 1 from public.player_unlocks u where u.user_id=b and u.item_key=c.item_key) limit 1;
 if key is not null then
  rejected:=false;begin perform pg_temp.choose_1v1_character(mid,key);exception when others then rejected:=sqlerrm='You do not own this character';end;
  if not rejected then raise exception 'Unowned character was accepted';end if;
 end if;
 payload:=pg_temp.choose_1v1_character(mid,'runner_ace');
 if payload->'match'->>'status'<>'countdown' then raise exception 'Only one ready started the match';end if;
 perform set_config('skyway.test_uid',a::text,true);
 payload:=pg_temp.choose_1v1_character(mid,'runner_ace');
 if payload->'match'->>'status'<>'playing' then raise exception 'Both ready did not start immediately';end if;
 update public.multiplayer_matches set started_at=clock_timestamp()-interval '10 seconds' where id=mid;
 update public.multiplayer_players set status='eliminated',eliminated_at=clock_timestamp(),death_order=case when user_id=a then 1 else 2 end,score=case when user_id=a then 11363 else 10346 end where match_id=mid;
 perform app_private.finalize_1v1_after_second_death(mid,clock_timestamp());
 if (select winner_user_id from public.multiplayer_matches where id=mid)<>b or (select score from public.multiplayer_players where match_id=mid and user_id=b)<>11363 then raise exception 'Second-finisher bonus or tie winner wrong';end if;
 perform app_private.finalize_1v1_after_second_death(mid,clock_timestamp());
 if (select score from public.multiplayer_players where match_id=mid and user_id=b)<>11363 then raise exception 'Final bonus applied twice';end if;
 select count(*) into owned_before from public.player_unlocks where user_id in(a,b);
 insert into public.multiplayer_queue(user_id,queued_at,mode) values(b,now(),'rng') on conflict(user_id) do update set mode='rng',queued_at=now();
 payload:=pg_temp.join_1v1_queue('rng');mid:=(payload->>'match_id')::uuid;
 payload:=pg_temp.get_1v1_state(mid);
 if payload->'match'->>'setup_phase'<>'announce' or payload->'self'->>'character_class'=payload->'opponent'->>'character_class' then raise exception 'RNG setup or distinct classes failed';end if;
 if (select count(distinct c.rarity) from public.multiplayer_players p join public.extraction_catalog c on c.item_key=p.character_key where p.match_id=mid)<>1 then raise exception 'RNG rarities differ';end if;
 if (select count(*) from public.player_unlocks where user_id in(a,b))<>owned_before then raise exception 'RNG granted inventory';end if;
 if (select map_key from public.multiplayer_matches where id=mid) not in('classic','pitch','factory','meadow') then raise exception 'Invalid RNG map';end if;
 update public.multiplayer_matches set status='cancelled' where id=mid;
 perform set_config('skyway.test_mode','hardcore_duel',true);
 insert into public.multiplayer_queue(user_id,queued_at,mode) values(b,now(),'hardcore_duel') on conflict(user_id) do update set mode='hardcore_duel',queued_at=now();
 payload:=pg_temp.join_1v1_queue('hardcore_duel');mid:=(payload->>'match_id')::uuid;
 if exists(select 1 from public.multiplayer_matches m,unnest(m.map_candidates) k where m.id=mid and k in('desert','grove','alley','terminal')) then raise exception 'Hardcore forbidden map in pool';end if;
 if exists(select 1 from public.multiplayer_players where match_id=mid and (hearts<>1 or max_hearts<>1 or character_key<>'runner_ace')) then raise exception 'Hardcore health/Ace mismatch';end if;
 update app_private.match_setup_19 set deadline=clock_timestamp()-interval '1 second' where match_id=mid;
 perform app_private.advance_setup_19(mid);
 update app_private.match_setup_19 set deadline=clock_timestamp()-interval '1 second' where match_id=mid;
 perform app_private.advance_setup_19(mid);
 if (select status from public.multiplayer_matches where id=mid)<>'playing' then raise exception 'Hardcore did not skip character picker';end if;
 update public.multiplayer_players set hearts=.5 where match_id=mid and user_id=a;
 update public.multiplayer_players set hearts=1 where match_id=mid and user_id=a;
 if (select hearts from public.multiplayer_players where match_id=mid and user_id=a)<>.5 then raise exception 'Hardcore healed';end if;
 update public.multiplayer_players set status='eliminated',hearts=0,eliminated_at=clock_timestamp(),death_order=case when user_id=a then 1 else 2 end,score=1000 where match_id=mid;
 perform app_private.finalize_1v1_after_second_death(mid,clock_timestamp());
 if (select score from public.multiplayer_players where match_id=mid and user_id=a)<>2000 or (select score from public.multiplayer_players where match_id=mid and user_id=b)<>3100 then raise exception 'Hardcore final score order wrong';end if;
 if exists(select 1 from public.multiplayer_ranked_results where match_id=mid) then raise exception 'Hardcore changed Elo';end if;
 if has_table_privilege('authenticated','app_private.match_bans_19','select') or has_function_privilege('anon','public.ban_1v1_map(uuid,text)','execute') then raise exception 'Setup permissions exposed';end if;
 if app_private.ranked_k(0)<>150 or app_private.ranked_k(22)<>40 or app_private.ranked_k(23)<>37 then raise exception 'Ranked K boundaries wrong';end if;
 if position('ranked_recent_games' in pg_get_functiondef('app_private.apply_ranked_result_to_active_season()'::regprocedure))=0 then raise exception 'Season K not updated';end if;
 if app_private.is_admin_test_user(a) then raise exception 'Test Mode remains enabled';end if;
 -- Old results retain lifetime history but do not affect today's rolling K.
 select id into season from public.ranked_1v1_seasons where is_active order by starts_at desc limit 1;
 if season is null then raise exception 'Active ranked season missing';end if;
 select coalesce((select matches_played from public.player_ranked_1v1_stats where season_id=season and user_id=a),0) into ratings_before;
 recent:=app_private.ranked_recent_games(a,clock_timestamp(),gen_random_uuid());
 for j in 1..2 loop
  finish_at:=clock_timestamp()-case when j=1 then interval '29 days' else interval '1 second' end;
  insert into public.multiplayer_matches(host_user_id,guest_user_id,mode,map_key,map_candidates,status,winner_user_id,started_at,finished_at)
  values(a,b,'ranked','classic',array['classic'],'finished',a,finish_at-interval '30 seconds',finish_at) returning id into mid;
  insert into public.multiplayer_players(match_id,user_id,slot,username,character_key,character_class,max_hearts,hearts,status,death_order,eliminated_at)
  values(mid,a,1,'fixture one','runner_ace','runner',3,0,'eliminated',2,finish_at),(mid,b,2,'fixture two','runner_ace','runner',3,0,'eliminated',1,finish_at);
  perform app_private.record_1v1_ranked_result(mid);
  perform app_private.record_1v1_ranked_result(mid);
 end loop;
 if app_private.ranked_recent_games(a,clock_timestamp(),gen_random_uuid())<>recent+1 then raise exception '28-day window counted old or duplicated games';end if;
 if (select matches_played from public.player_ranked_1v1_stats where season_id=season and user_id=a)<>ratings_before+2 then raise exception 'Lifetime results were lost or counted twice';end if;
 if (select avg(rating) from public.player_ranked_1v1_stats where season_id=season and matches_played>0)<>1500 then raise exception 'Ranked mean drifted from 1500';end if;
 if exists(select 1 from unnest(array['runner','medic','tank','trickster','misc']) c,unnest(array['uncommon','rare','epic','legendary']) r where not exists(select 1 from public.extraction_catalog x where x.active and x.item_type='character' and x.character_class=c and x.rarity=r)) then raise exception 'Incomplete RNG class/rarity pool';end if;
end $$;
select 'PASS: bans, secret choices, timing, ownership, RNG, Hardcore, scoring, permissions and K' as update_19_checks;
