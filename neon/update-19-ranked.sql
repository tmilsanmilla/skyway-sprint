-- Multi-device 03 Ranked · Update 19. No rating reset or historical deletion.
begin;
create or replace function app_private.ranked_recent_games(u uuid,t timestamptz,exclude_match uuid)
returns bigint language sql stable security definer set search_path='' as $$
 select count(*) from public.multiplayer_ranked_results r join public.multiplayer_matches m on m.id=r.match_id
 where m.mode='ranked' and r.match_id<>exclude_match and r.finished_at>=t-interval '28 days' and r.finished_at<=t
 and u in(r.player_one_user_id,r.player_two_user_id);
$$;
create or replace function app_private.ranked_k(p bigint) returns numeric language sql immutable set search_path='' as $$
 select case when p<=22 then 1200::numeric/(greatest(0,p)+8) else 37::numeric end;
$$;
-- Preserve the existing receipt, ordered locks, lifetime W/L history, and exact mean-1500 recenter.
do $$ declare f text;n text;begin
 foreach n in array array['app_private.apply_ranked_result_to_active_season()','app_private.record_1v1_ranked_result_unchecked(uuid)'] loop
  f:=pg_get_functiondef(n::regprocedure);
  if n like '%apply_ranked%' then
   f:=regexp_replace(f,'v_k_one := case.*?end;', 'v_k_one := app_private.ranked_k(app_private.ranked_recent_games(new.player_one_user_id,new.finished_at,new.match_id));','s');
   f:=regexp_replace(f,'v_k_two := case.*?end;', 'v_k_two := app_private.ranked_k(app_private.ranked_recent_games(new.player_two_user_id,new.finished_at,new.match_id));','s');
  else
   f:=replace(f,'/ 400','/ 600');
   f:=replace(f,'round(32 * (v_result_one - v_expected_one))','round(app_private.ranked_k(app_private.ranked_recent_games(v_player_one.user_id,coalesce(v_match.finished_at,now()),p_match_id)) * (v_result_one - v_expected_one))');
   f:=replace(f,'round(32 * (v_result_two - v_expected_two))','round(app_private.ranked_k(app_private.ranked_recent_games(v_player_two.user_id,coalesce(v_match.finished_at,now()),p_match_id)) * (v_result_two - v_expected_two))');
  end if;
  f:=replace(f,'v_result_one := 0.5; v_result_two := 0.5;', 'raise exception ''Ranked results require a winner'';');
  f:=replace(f,E'v_result_one := 0.5;\n    v_result_two := 0.5;', 'raise exception ''Ranked results require a winner'';');
  if position('ranked_recent_games' in f)=0 then raise exception 'Unexpected ranked function: %',n;end if;
  execute f;
 end loop;
end $$;
create or replace function app_private.finalize_1v1_after_second_death(p_match_id uuid,p_now timestamptz)
returns boolean language plpgsql security definer set search_path='' as $$
declare m public.multiplayer_matches;a public.multiplayer_players;b public.multiplayer_players;second_uid uuid;winner uuid;mult integer;
begin
 select * into m from public.multiplayer_matches where id=p_match_id for update;
 if m.id is null then raise exception '1v1 match not found';end if;
 if m.status='finished' then return true;end if;
 if (select count(*) from public.multiplayer_players where match_id=p_match_id and (eliminated_at is not null or status='eliminated'))<2 then return false;end if;
 select user_id into second_uid from public.multiplayer_players where match_id=p_match_id
 order by case when death_order=2 then 0 else 1 end,eliminated_at desc nulls last,user_id limit 1;
 mult:=case when m.mode='hardcore_duel' then 2 else 1 end;
 update public.multiplayer_players p set
  score=(case when user_id=second_uid and not second_death_bonus_awarded then round(score*1.05)::bigint+500 else score end)*mult,
  second_death_bonus_awarded=second_death_bonus_awarded or user_id=second_uid,updated_at=p_now where match_id=p_match_id;
 select * into a from public.multiplayer_players where match_id=p_match_id and slot=1;
 select * into b from public.multiplayer_players where match_id=p_match_id and slot=2;
 if a.user_id is null or b.user_id is null then raise exception '1v1 players not found';end if;
 winner:=case when a.score>b.score then a.user_id when b.score>a.score then b.user_id else second_uid end;
 update public.multiplayer_matches set status='finished',winner_user_id=winner,finished_at=coalesce(finished_at,p_now),last_activity_at=p_now,intermission_ends_at=null where id=p_match_id;
 return true;
end $$;
-- The allowance still uses elapsed server time, now accounting for the final bonus and Hardcore's final-only multiplier.
do $$ declare f text;begin
 f:=pg_get_functiondef('app_private.enforce_1v1_score_ceiling()'::regprocedure);
 f:=replace(f,'case when new.second_death_bonus_awarded then 280 else 0 end','0');
 if position('Hardcore final multiplier' in f)=0 then
  f:=replace(f,'if new.score < 0',E'-- Hardcore final multiplier\n  if new.second_death_bonus_awarded then v_score_ceiling:=ceil(v_score_ceiling*1.05)::bigint+500;end if;\n  if exists(select 1 from public.multiplayer_matches where id=new.match_id and mode=''hardcore_duel'') then v_score_ceiling:=v_score_ceiling*2;end if;\n  if new.score < 0');
 end if;
 execute f;
end $$;
revoke all on function app_private.ranked_recent_games(uuid,timestamptz,uuid),app_private.ranked_k(bigint),app_private.finalize_1v1_after_second_death(uuid,timestamptz) from public,anon,anonymous,authenticated;
notify pgrst,'reload schema';
commit;
