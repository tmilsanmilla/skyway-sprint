-- QOL Map settlement: Meadow bonus-lane receipts; Terminal has no attack currency.
begin;
do $migration$
declare d text;needle text;replacement text;
begin
 d:=pg_get_functiondef('public.sync_1v1_intermission_coins(uuid,text[])'::regprocedure);
 if position('QOL Meadow lane receipt' in d)=0 then
  needle:='v_map_key := coalesce(nullif(to_jsonb(v_match)->>''map_key'', ''''), ''classic'');';
  if position(needle in d)=0 or position('v_nominal_award := v_inserted * v_coin_reward;' in d)=0 then raise exception 'Unexpected coin settlement';end if;
  d:=replace(d,needle,needle||$guard$
  -- QOL Meadow lane receipt: strip lane suffix for idempotency.
  if v_map_key='terminal' then raise exception 'Terminal does not use attack coins';end if;
  if v_map_key='meadow' and exists(select 1 from unnest(p_pickup_ids) item(pickup_id)
    where btrim(item.pickup_id) like '%:lane:%' and btrim(item.pickup_id) !~ '^.+:lane:[0-5]$') then
    raise exception 'Invalid Meadow coin lane receipt';
  end if;
  if v_map_key='meadow' and exists(select 1 from unnest(p_pickup_ids) item(pickup_id)
    group by regexp_replace(btrim(item.pickup_id),':lane:[0-9]+$','')
    having count(distinct btrim(item.pickup_id))>1) then
    raise exception 'Conflicting Meadow coin lane receipts';
  end if;
$guard$);
  d:=replace(d,'select distinct btrim(item.pickup_id) as pickup_id',
   'select distinct regexp_replace(btrim(item.pickup_id),'':lane:[0-9]+$'','''') as pickup_id');
  needle:=E'with requested as (\n    select distinct regexp_replace(btrim(item.pickup_id),'':lane:[0-9]+$'','''') as pickup_id\n    from unnest(p_pickup_ids) item(pickup_id)\n  ), inserted as (';
  replacement:=E'with requested as (\n    select distinct on(regexp_replace(btrim(item.pickup_id),'':lane:[0-9]+$'',''''))\n     regexp_replace(btrim(item.pickup_id),'':lane:[0-9]+$'','''') as pickup_id,\n     case when btrim(item.pickup_id) ~ '':lane:[0-9]+$'' then substring(btrim(item.pickup_id) from '':lane:([0-9]+)$'')::integer else -1 end as lane\n    from unnest(p_pickup_ids) item(pickup_id)\n    order by regexp_replace(btrim(item.pickup_id),'':lane:[0-9]+$'',''''),item.pickup_id\n  ), inserted as (';
  if position(needle in d)=0 then raise exception 'Unexpected coin receipt CTE';end if;d:=replace(d,needle,replacement);
  d:=replace(d,'requested.pickup_id, ''coin'', v_coin_reward',
   'requested.pickup_id, ''coin'', case when v_map_key=''meadow'' and requested.lane=(app_private.one_v_one_wave_rules(p_match_id,greatest(1,v_match.current_wave-1))->>''bonus_lane_index'')::integer then 7 else v_coin_reward end');
  d:=replace(d,'select count(*)::integer into v_inserted from inserted;',
   'select count(*)::integer,coalesce(sum(points_awarded),0) into v_inserted,v_nominal_award from inserted;');
  execute replace(d,'v_nominal_award := v_inserted * v_coin_reward;','-- The receipt sum preserves mixed bonus/ordinary lane awards.');
 end if;
 d:=pg_get_functiondef('public.sync_1v1_intermission_coins(uuid,text[])'::regprocedure);
 if position('requested.lane=(app_private.one_v_one_wave_rules(p_match_id,greatest(1,v_match.current_wave-1))->>''bonus_lane_index'')::integer then 7 else v_coin_reward end' in d)=0
  or position('coalesce(sum(points_awarded),0) into v_inserted,v_nominal_award' in d)=0
  or position('Invalid Meadow coin lane receipt' in d)=0
  or position('if v_uid is null then raise exception ''Sign in required''' in d)=0
  or position('Attack coins can only sync during the shared 10-second intermission' in d)=0 then
  raise exception 'Incomplete or unrecognized coin settlement guards';
 end if;
 d:=pg_get_functiondef('public.update_1v1_terminal_state(uuid,numeric,integer,bigint,text,numeric)'::regprocedure);
 needle:='a.hearts+case when p_wave>a.wave then 1 else 0 end';
 if position(needle in d)>0 then execute replace(d,needle,'a.hearts+case when p_wave>a.wave then 0.5 else 0 end');
 elsif position('a.hearts+case when p_wave>a.wave then 0.5 else 0 end' in d)=0 then raise exception 'Unexpected Terminal healing guard';end if;
end $migration$;
notify pgrst,'reload schema';
revoke all on function public.sync_1v1_intermission_coins(uuid,text[]) from public,anon,anonymous;
grant execute on function public.sync_1v1_intermission_coins(uuid,text[]) to authenticated;
commit;
