-- QOL Armory: formula prices, server-owned map availability and paid-purchase caps.
-- Requires qol-maps.sql. Existing Comet/Gambit bonuses remain in their delegates.
begin;
create table if not exists app_private.armory_purchases(
 match_id uuid not null references public.multiplayer_matches(id) on delete cascade,
 user_id uuid not null,wave integer not null,kind text not null,
 quantity integer not null,primary key(match_id,user_id,wave,kind));
alter table app_private.armory_purchases drop constraint if exists armory_purchases_quantity_check;
alter table app_private.armory_purchases add constraint armory_purchases_quantity_check
 check(quantity>0 and (kind='snowflake' or quantity<=4));
alter table app_private.armory_purchases enable row level security;
revoke all on app_private.armory_purchases from public,anon,anonymous,authenticated;

create or replace function app_private.armory_purchase_counts(mid uuid,u uuid,w integer)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_object_agg(kind,quantity),'{}') from app_private.armory_purchases
 where match_id=mid and user_id=u and wave=w;
$$;

-- A snowflake is uncapped, so formula prices are not capped at the former 8.
-- Preserve all source rules: only supported paid/returned sources may cost >0.
alter table public.multiplayer_attacks drop constraint multiplayer_attacks_point_cost_check;
alter table public.multiplayer_attacks add constraint multiplayer_attacks_point_cost_check check(point_cost>=0);
alter table public.multiplayer_attacks drop constraint multiplayer_attacks_source_cost_check;
alter table public.multiplayer_attacks add constraint multiplayer_attacks_source_cost_check check(
 (source='purchased' and point_cost>=1) or
 (source in('katana','comet_bonus','gambit_bonus') and point_cost=0) or
 (source='heatfeast_return' and point_cost>=0));

do $migration$
declare d text;needle text;replacement text;new_case text;old_case text;
begin
 if to_regprocedure('app_private.send_1v1_attack_qol_base(uuid,text,integer)') is null then
  d:=pg_get_functiondef('public.send_1v1_attack(uuid,text,integer)'::regprocedure);
  needle:='FUNCTION public.send_1v1_attack(';
  if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 or
   position('app_private.send_1v1_attack_without_gambit(' in d)=0 or position('if v_uid is null' in d)=0 then
   raise exception 'Unexpected Gambit sender wrapper';end if;
  execute replace(d,needle,'FUNCTION app_private.send_1v1_attack_qol_base(');
 end if;
 d:=pg_get_functiondef('app_private.send_1v1_attack_without_gambit(uuid,text,integer)'::regprocedure);
 new_case:=$new$v_base_cost := case v_type
    when 'snowflake' then 11
    when 'log' then 13
    when 'spike' then 14
    when 'car' then 14
    when 'rock' then 15
    when 'barrel' then 13
    when 'current' then 13
    else null
  end;$new$;
 old_case:=$old$v_base_cost := case v_type
    when 'snowflake' then 4
    when 'log' then 4
    when 'spike' then 5
    when 'rock' then 5
    when 'barrel' then 6
    when 'current' then 8
    else null
  end;$old$;
 replacement:=$new$-- QOL price formula: p is every prior paid obstacle purchase this wave.
  v_base_cost := v_base_cost + case when v_type='snowflake' and v_match.map_key='skyway' then 1 else 0 end
    +2*coalesce((select sum(quantity) from app_private.armory_purchases
       where match_id=p_match_id and user_id=v_uid and wave=v_match.current_wave),0);
  v_cost := v_base_cost;$new$;
 if position(new_case in d)=0 then
  if (length(d)-length(replace(d,old_case,'')))/length(old_case)<>1 or
   (length(d)-length(replace(d,'v_cost := v_base_cost;','')))/length('v_cost := v_base_cost;')<>1 or
   position('QOL price formula' in d)>0 then raise exception 'Unexpected Armory sender definition';end if;
  d:=replace(replace(d,old_case,new_case),'v_cost := v_base_cost;',replacement);
  execute d;
 elsif position(replacement in d)=0 or position(old_case in d)>0 then raise exception 'Incomplete refreshed Armory sender';
 end if;
 if position('if v_uid is null' in d)=0 or position('v_self.user_id is null' in d)=0 or
  position('v_self.status <> ''intermission''' in d)=0 or position('v_type = any(v_allowed)' in d)=0 or
  position('player.obstacle_points >= v_cost' in d)=0 then raise exception 'Armory security guard mismatch';end if;
 if to_regprocedure('app_private.get_1v1_state_qol_base(uuid)') is null then
  d:=pg_get_functiondef('public.get_1v1_state(uuid)'::regprocedure);
  needle:='FUNCTION public.get_1v1_state(';
  if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 or
   position('auth.uid()' in d)=0 or position('Match not found' in d)=0 then raise exception 'Unexpected state reader';end if;
  execute replace(d,needle,'FUNCTION app_private.get_1v1_state_qol_base(');
 end if;
end $migration$;

create or replace function public.send_1v1_attack(p_match_id uuid,p_obstacle_type text,p_cost integer default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();m public.multiplayer_matches;k text:=lower(trim(p_obstacle_type));result jsonb;prior integer;
begin
 if u is null or not exists(select 1 from public.multiplayer_players where match_id=p_match_id and user_id=u) then raise exception 'Match not found';end if;
 if app_private.has_active_ban(u,'account',null) then raise exception 'This account is banned';end if;
 select * into m from public.multiplayer_matches where id=p_match_id for update;
 if k='spikes' then k:='spike';end if;
 if m.map_key='terminal' then raise exception 'Terminal has no attack purchases';end if;
 if not exists(select 1 from app_private.one_v_one_map_rules where map_key=m.map_key and k=any(allowed_attacks)) then raise exception 'Obstacle unavailable on this map';end if;
 select coalesce(quantity,0) into prior from app_private.armory_purchases where match_id=p_match_id and user_id=u and wave=m.current_wave and kind=k;
 prior:=coalesce(prior,0);
 if k<>'snowflake' and prior>=4 then raise exception 'Maximum four purchases of this obstacle per wave';end if;
 result:=app_private.send_1v1_attack_qol_base(p_match_id,k,p_cost);
 -- One paid purchase. Free Comet/Gambit copies neither increase p nor consume its cap.
 insert into app_private.armory_purchases values(p_match_id,u,m.current_wave,k,1)
 on conflict(match_id,user_id,wave,kind) do update set quantity=app_private.armory_purchases.quantity+1;
 return result||jsonb_build_object('purchase_counts',app_private.armory_purchase_counts(p_match_id,u,m.current_wave));
end $$;

create or replace function public.get_1v1_state(p_match_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();p jsonb;w integer;
begin
 if u is null or not exists(select 1 from public.multiplayer_players where match_id=p_match_id and user_id=u) then raise exception 'Match not found';end if;
 p:=app_private.get_1v1_state_qol_base(p_match_id);w:=(p->'match'->>'current_wave')::integer;
 return p||jsonb_build_object('self',(p->'self')||jsonb_build_object(
  'purchase_counts',app_private.armory_purchase_counts(p_match_id,u,w),
  'ruins_banned_characters',(select coalesce(jsonb_agg(character_key order by character_key),'[]') from app_private.ruins_character_bans where match_id=p_match_id)));
end $$;
revoke all on function app_private.armory_purchase_counts(uuid,uuid,integer),app_private.send_1v1_attack_qol_base(uuid,text,integer),app_private.get_1v1_state_qol_base(uuid)
 from public,anon,anonymous,authenticated;
revoke all on function public.send_1v1_attack(uuid,text,integer),public.get_1v1_state(uuid) from public,anon,anonymous;
grant execute on function public.send_1v1_attack(uuid,text,integer),public.get_1v1_state(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
