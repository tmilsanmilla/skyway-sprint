-- Update 2.3 · preserve fractional HP, Remedy's explicit max, and receipt-bound
-- Dash mastery healing. This does NOT remove the normal mid-wave heal guard.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $remedy$
declare d text;before_text text:=E'    when v_key=''medic_beacon'' then 5.5';after_text text:=E'    when v_key=''medic_remedy'' then 3.5\n    when v_key=''medic_beacon'' then 5.5';
begin
 d:=pg_get_functiondef('app_private.character_selection_snapshot(uuid,text,text)'::regprocedure);
 if position(after_text in d)=0 then
  if (length(d)-length(replace(d,before_text,'')))/length(before_text)<>1
   or position('v_base_start:=case' in d)=0 or position('else 3' in d)=0 then raise exception 'Current character health snapshot changed; review Remedy patch';end if;
  execute replace(d,before_text,after_text);
 end if;
end $remedy$;
-- These private functions calculate character bonuses, not physical HP.
-- Only their local conditional inputs use half-heart bands; the stored heart
-- values and the existing damage/full-state functions remain untouched.
do $conditions$
declare signature text;d text;needle text:=E'\nbegin\n';replacement text:=E'\nbegin\n  -- Update 2.3 conditional health bands only.\n  p_hearts:=app_private.rounded_health_for_conditions(p_hearts);\n  p_max_hearts:=app_private.rounded_health_for_conditions(p_max_hearts);\n';
begin
 foreach signature in array array[
  'app_private.one_v_one_attack_point_multiplier(text,integer,numeric,numeric,integer,integer,timestamp with time zone,timestamp with time zone)',
  'app_private.one_v_one_attack_point_multiplier(text,integer,numeric,numeric,integer,integer,timestamp with time zone,timestamp with time zone,timestamp with time zone)'
 ] loop
  if to_regprocedure(signature) is null then continue;end if;
  d:=pg_get_functiondef(to_regprocedure(signature));
  if position('Update 2.3 conditional health bands only.' in d)>0 then continue;end if;
  if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 or position('v_missing_ratio' in d)=0 then raise exception 'Character health condition function changed: %',signature;end if;
  execute replace(d,needle,replacement);
 end loop;
end $conditions$;

create or replace function public.apply_mastery_heal(p_match_id uuid,p_event_id uuid,p_kind text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=app_private.photon_user();p public.multiplayer_players;m public.multiplayer_matches;t app_private.mastery_heal_tokens;h numeric;
begin
 if p_event_id is null or p_kind is distinct from 'dash-green' then raise exception 'Choose an eligible mastery heal event';end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text,23));
 select * into m from public.multiplayer_matches where id=p_match_id for update;
 select * into p from public.multiplayer_players where match_id=p_match_id and user_id=u for update;
 if m.id is null or p.user_id is null then raise exception 'Owned 1v1 match required';end if;
 select * into t from app_private.mastery_heal_tokens where match_id=p_match_id and user_id=u and event_id=p_event_id and kind=p_kind for update;
 if t.event_id is null then raise exception 'A verified mastery block receipt is required';end if;
 if t.consumed_at is not null then return jsonb_build_object('hearts',p.hearts,'duplicate',true);end if;
 if t.created_at<clock_timestamp()-interval '8 seconds' then raise exception 'Mastery heal receipt expired';end if;
 if m.status<>'playing' or m.finished_at is not null or p.status<>'playing' or p.hearts<=0 or p.test_mode or p.character_key<>'runner_dash'
  or not app_private.mastery_owns_character(u,'runner_dash') or m.map_key='desert' then raise exception 'Mastery healing is not available in this match';end if;
 if not exists(select 1 from app_private.player_mastery_quests where user_id=u and character_key='runner_dash' and mastered and mastery_enabled)
  or not exists(select 1 from app_private.mastery_sessions where id=t.session_id and user_id=u and context_id=p_match_id and context_type='1v1' and character_key='runner_dash' and finished_at is null)
  or not exists(select 1 from public.player_progression_1v1_activity where match_id=p_match_id and user_id=u and heartbeat_active and last_heartbeat_at>=clock_timestamp()-interval '8 seconds') then raise exception 'Active owned Dash mastery play is required';end if;
 h:=least(p.max_hearts,p.hearts+1);
 update public.multiplayer_players set hearts=h,last_seen_at=clock_timestamp(),updated_at=clock_timestamp() where match_id=p_match_id and user_id=u;
 update app_private.mastery_heal_tokens set consumed_at=clock_timestamp(),hearts_after=h where match_id=p_match_id and user_id=u and event_id=p_event_id;
 return jsonb_build_object('hearts',h,'duplicate',false,'healed',h-p.hearts);
end $$;
create or replace function public.get_mastery_salve_uses(p_context_id uuid)
returns integer language plpgsql stable security definer set search_path='' as $$
declare u uuid:=app_private.photon_user();n integer;
begin
 select least(3,coalesce((event_counts->>'salve-heal')::integer,0)) into n from app_private.mastery_sessions
 where user_id=u and context_id=p_context_id and context_type in('endless','1v1') and character_key='medic_salve' and finished_at is null;
 if n is null or not app_private.mastery_owns_character(u,'medic_salve') then raise exception 'Owned active Salve run required';end if;
 return n;
end $$;
revoke all on function public.apply_mastery_heal(uuid,uuid,text),public.get_mastery_salve_uses(uuid) from public,anon,anonymous;
grant execute on function public.apply_mastery_heal(uuid,uuid,text),public.get_mastery_salve_uses(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
