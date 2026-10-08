-- Run after the migration, inside its transaction for a reversible dry run.
do $$ declare actual numeric;k text;begin
  if app_private.can_equip_weapon(null,'runner_ace',true) then raise exception 'Flair equip remained active';end if;
  for k in select item_key from public.extraction_catalog where item_type='character' loop
    if app_private.independent_weapon_score_bonus(k)<>0 then raise exception 'Flair bonus remained active';end if;
  end loop;
  actual:=app_private.one_v_one_attack_point_multiplier('runner_ace',1,3,3,2,5,null,now(),now());
  if actual<>1.10 then raise exception 'Ace passive changed or retained a flair bonus: %',actual;end if;
  actual:=app_private.one_v_one_attack_point_multiplier('runner_pacer',1,3,3,2,5,null,now(),now());
  if actual<>5 then raise exception 'Pacer passive changed: %',actual;end if;
  actual:=app_private.one_v_one_attack_point_multiplier('runner_velocity',1,3,3,2,5,statement_timestamp()-interval '50 seconds',now(),now());
  if actual<>2 then raise exception 'Velocity charge changed or retained a flair bonus: %',actual;end if;
  if app_private.one_v_one_attack_point_multiplier(null,null,'runner_ace',1,3,3,2,5,null,now(),now())<>1.10 then raise exception 'Match reward retained a flair bonus';end if;
  if exists(select 1 from pg_trigger where tgname='snapshot_independent_weapon' and not tgisinternal) then raise exception 'Flair snapshot remained active';end if;
  if has_function_privilege('authenticated','public.set_player_weapon(text)','execute')
    or has_function_privilege('anonymous','public.set_player_weapon(text)','execute')
    or has_function_privilege('authenticated','app_private.independent_weapon_score_bonus(text)','execute') then raise exception 'Retired equipment endpoint remained callable';end if;
  if not has_function_privilege('authenticated','public.get_1v1_state(uuid)','execute')
    or has_function_privilege('anonymous','public.get_1v1_state(uuid)','execute') then raise exception 'Match authorization changed';end if;
  if not(select relrowsecurity from pg_class where oid='public.player_loadouts'::regclass)
    or not(select relrowsecurity from pg_class where oid='public.player_stats'::regclass) then raise exception 'Account security changed';end if;
  if pg_get_functiondef('public.get_1v1_state(uuid)'::regprocedure) like '%jsonb_build_object(''weapon_key''%' then raise exception 'Flair state wrapper remained';end if;
end $$;
select true as flairs_disabled,true as character_passives_preserved,true as map_weapons_preserved,true as accounts_preserved;
