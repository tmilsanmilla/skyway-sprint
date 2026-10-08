-- Inventory Flairs Removed MISC · no account, character, cosmetic, or match data is deleted.
begin;
-- Old clients cannot equip flairs. Keep the retired signature for a clear error.
create or replace function public.set_player_weapon(p_weapon_key text)
returns void language plpgsql security definer set search_path='' as $$
begin raise exception 'Inventory flairs have been removed'; end $$;
revoke all on function public.set_player_weapon(text) from public,anon,anonymous,authenticated;
create or replace function app_private.can_equip_weapon(u uuid,k text,allow_test boolean default false)
returns boolean language sql stable set search_path='' as $$ select false $$;
create or replace function app_private.independent_weapon_score_bonus(k text)
returns numeric language sql immutable set search_path='' as $$ select 0::numeric $$;
revoke all on function app_private.can_equip_weapon(uuid,text,boolean),
  app_private.independent_weapon_score_bonus(text) from public,anon,anonymous,authenticated;
-- Keep existing selection columns solely for compatibility; they grant nothing.
drop trigger if exists snapshot_independent_weapon on public.multiplayer_players;

create or replace function app_private.one_v_one_attack_point_multiplier(
  p_character_key text,p_wave integer,p_hearts numeric,p_max_hearts numeric,
  p_lane_index integer,p_lane_count integer,p_last_damage_at timestamptz,
  p_wave_started_at timestamptz,p_run_started_at timestamptz
) returns numeric language plpgsql security definer set search_path='' as $$
declare v_multiplier numeric:=1;v_missing_ratio numeric:=0;v_hitless_seconds numeric:=0;v_character_class text:='runner';
begin
  select catalog.character_class into v_character_class from public.extraction_catalog catalog
    where catalog.item_key=p_character_key and catalog.item_type='character' and catalog.active;
  if p_max_hearts>0 then v_missing_ratio:=greatest(0,least(1,(p_max_hearts-p_hearts)/p_max_hearts));end if;
  v_multiplier:=case p_character_key
    when 'runner_ace' then 1.10 when 'runner_dash' then 1.06 when 'runner_courier' then 1.25
    when 'runner_tempo' then case when mod(greatest(1,p_wave),2)=1 then 1.15 else .85 end
    when 'tank_reactor' then 1+.30*v_missing_ratio
    when 'runner_vector' then case when p_lane_index in(0,greatest(0,p_lane_count-1)) then 1.12 else 1 end
    when 'medic_halo' then case when p_hearts>=p_max_hearts then 1.15 else 1 end
    when 'runner_velocity' then 1
    when 'runner_pacer' then case when statement_timestamp()<coalesce(p_wave_started_at,statement_timestamp())+interval '15 seconds' then 5 else 1 end
    when 'runner_zenith' then (1+least(.60,greatest(0,p_wave-1)*.02))
      *case when p_wave>=7 and p_hearts>=p_max_hearts then 1.15 else 1 end
      *case when p_wave>=12 then 1.10*1.06 else 1 end
    when 'tank_guard' then .90 when 'tank_colossus' then 1+greatest(0,p_hearts-3)*.05
    when 'trickster_phantom' then case when mod(greatest(1,p_wave),2)=0 then 2 else 1 end
    when 'trickster_pickpocket' then 2 when 'runner_comet' then 1.5 else 1 end;
  if v_character_class='trickster' then v_multiplier:=v_multiplier*1.15;end if;
  if p_character_key='runner_velocity' then
    v_hitless_seconds:=least(100,greatest(0,extract(epoch from statement_timestamp()-coalesce(p_last_damage_at,p_run_started_at,statement_timestamp()))));
    v_multiplier:=1+v_hitless_seconds*.02;
  end if;
  return greatest(.1,round(v_multiplier,4));
end $$;
-- All existing character modifiers remain; the retired flair factor is absent.
create or replace function app_private.one_v_one_attack_point_multiplier(
  p_match_id uuid,p_user_id uuid,p_character_key text,p_wave integer,
  p_hearts numeric,p_max_hearts numeric,p_lane_index integer,p_lane_count integer,
  p_last_damage_at timestamptz,p_wave_started_at timestamptz,p_run_started_at timestamptz
) returns numeric language plpgsql volatile security definer set search_path='' as $$
declare v numeric;gems bigint:=0;
begin
  v:=app_private.one_v_one_attack_point_multiplier(p_character_key,p_wave,p_hearts,p_max_hearts,p_lane_index,p_lane_count,p_last_damage_at,p_wave_started_at,p_run_started_at);
  if p_character_key='runner_spark' then
    select count(*) into gems from public.player_progression_events where user_id=p_user_id and source='gem' and metadata->>'context_id'=p_match_id::text;
    v:=v*(1+gems*.01);
  end if;
  return greatest(.1,round(v,4));
end $$;
revoke all on function app_private.one_v_one_attack_point_multiplier(text,integer,numeric,numeric,integer,integer,timestamptz,timestamptz,timestamptz),
  app_private.one_v_one_attack_point_multiplier(uuid,uuid,text,integer,numeric,numeric,integer,integer,timestamptz,timestamptz,timestamptz)
  from public,anon,anonymous,authenticated;
-- Remove only the equipment wrapper; keep the original authorized state reader.
do $$ declare f text; begin
  if to_regprocedure('app_private.get_1v1_state_before_independent_weapons(uuid)') is not null then
    f:=pg_get_functiondef('app_private.get_1v1_state_before_independent_weapons(uuid)'::regprocedure);
    execute replace(f,'FUNCTION app_private.get_1v1_state_before_independent_weapons(','FUNCTION public.get_1v1_state(');
  end if;
end $$;
revoke all on function public.get_1v1_state(uuid) from public,anon,anonymous;
grant execute on function public.get_1v1_state(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
