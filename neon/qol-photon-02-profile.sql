-- Photon QOL 02: own-account collection and loadout; keep existing RPC permissions.
begin;
create or replace function public.get_photon_fury_profile()
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=app_private.photon_user();p public.player_photon_fury;c text;w text;
begin
 select * into p from public.player_photon_fury where user_id=u;
 c:=case when app_private.owns_photon_character(u,p.selected_character_key) then p.selected_character_key else 'photon_magician' end;
 w:=case when exists(select 1 from app_private.photon_weapon_rules(p.selected_weapon_key))
  and app_private.photon_weapon_compatible(p.selected_weapon_key,c) and (p.selected_weapon_key='lightsaber' or exists(
   select 1 from app_private.photon_unlocks where user_id=u and kind='weapon' and item_key='photon_weapon_'||p.selected_weapon_key))
  then p.selected_weapon_key else 'lightsaber' end;
 return jsonb_build_object('unlocked',p.unlocked_at is not null,'photons',coalesce(p.photons,0),
  'character_keys',(select coalesce(jsonb_agg(character_key),'[]'::jsonb) from app_private.photon_character_rules(null)
   where p.unlocked_at is not null and app_private.owns_photon_character(u,character_key)),
  'selected_character_key',c,'selected_weapon_key',w,'selected_theme_key',coalesce(p.selected_theme_key,'default'),
  'skin_choices',coalesce(p.skin_choices,'{}'::jsonb),'box_nonce',p.box_nonce,
  'skin_keys',(select coalesce(jsonb_agg(item_key),'[]'::jsonb) from app_private.photon_unlocks where user_id=u and kind='skin'),
  'theme_keys',(select coalesce(jsonb_agg(item_key),'[]'::jsonb) from app_private.photon_unlocks where user_id=u and kind='theme'),
  'weapon_keys',(select coalesce(jsonb_agg(replace(item_key,'photon_weapon_','')),'[]'::jsonb) from app_private.photon_unlocks where user_id=u and kind='weapon'));
end $$;
create or replace function public.equip_photon_character(p_character_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=app_private.photon_user();k text:=lower(trim(p_character_key));p public.player_photon_fury;item record;target text;
begin
 select * into p from public.player_photon_fury where user_id=u for update;
 if p.unlocked_at is null then raise exception 'Mode locked';end if;
 if k like 'weapon:%' then
  target:=substr(k,8);
  if not exists(select 1 from app_private.photon_weapon_rules(target)) or (target<>'lightsaber' and not exists(
    select 1 from app_private.photon_unlocks where user_id=u and kind='weapon' and item_key='photon_weapon_'||target))
    then raise exception 'Weapon locked';end if;
  if not app_private.photon_weapon_compatible(target,p.selected_character_key) then raise exception 'Weapon is incompatible with Bear or Magnet';end if;
  update public.player_photon_fury set selected_weapon_key=target where user_id=u;
 elsif k like 'skin:default:%' then
  target:=substr(k,14);
  if not app_private.owns_photon_character(u,target) then raise exception 'Character locked';end if;
  update public.player_photon_fury set skin_choices=skin_choices-target where user_id=u;
 elsif k like 'skin:%' then
  target:=substr(k,6);select * into item from app_private.photon_qol_catalog() where item_key=target and kind='skin';
  if item.item_key is null or not app_private.owns_photon_character(u,item.character_key) or not exists(
    select 1 from app_private.photon_unlocks where user_id=u and item_key=target and kind='skin') then raise exception 'Skin or character locked';end if;
  update public.player_photon_fury set skin_choices=jsonb_set(skin_choices,array[item.character_key],to_jsonb(target),true) where user_id=u;
 elsif k like 'theme:%' then
  target:=substr(k,7);
  if target<>'default' and not exists(select 1 from app_private.photon_unlocks where user_id=u and item_key=target and kind='theme')
    then raise exception 'Theme locked';end if;
  update public.player_photon_fury set selected_theme_key=target where user_id=u;
 else
  if not app_private.owns_photon_character(u,k) then raise exception 'Character locked';end if;
  update public.player_photon_fury set selected_character_key=k,
   selected_weapon_key=case when app_private.photon_weapon_compatible(selected_weapon_key,k) then selected_weapon_key else 'lightsaber' end where user_id=u;
 end if;
 return public.get_photon_fury_profile();
end $$;
create or replace function app_private.purchase_photon_weapon(p_item_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=app_private.photon_user();k text:=replace(p_item_key,'photon_weapon_','');p public.player_photon_fury;s public.player_stats;w record;n integer;
begin
 select * into w from app_private.photon_weapon_rules(k);
 if w.weapon_key is null or k='lightsaber' then raise exception 'Choose a purchasable Photon weapon';end if;
 select * into s from public.player_stats where user_id=u for update;
 select * into p from public.player_photon_fury where user_id=u for update;
 if p.unlocked_at is null then raise exception 'Mode locked';end if;
 if exists(select 1 from app_private.photon_unlocks where user_id=u and item_key=p_item_key and kind='weapon') then
  return jsonb_build_object('already_owned',true,'cost',0,'gems',s.total_gems,'profile',public.get_photon_fury_profile());end if;
 if s.level<35 then raise exception 'Photon weapon purchases require level 35';end if;
 if s.total_gems<w.gem_price or p.photons<w.photon_price then raise exception 'Not enough Photons or Gems';end if;
 insert into app_private.photon_unlocks(user_id,item_key,kind) values(u,p_item_key,'weapon');
 get diagnostics n=row_count;
 if n<>1 then raise exception 'Could not confirm weapon ownership';end if;
 update public.player_stats set total_gems=total_gems-w.gem_price,updated_at=clock_timestamp() where user_id=u returning * into s;
 update public.player_photon_fury set photons=photons-w.photon_price where user_id=u;
 return jsonb_build_object('already_owned',false,'gems',s.total_gems,'profile',public.get_photon_fury_profile());
end $$;
revoke all on function app_private.purchase_photon_weapon(text) from public,anon,anonymous,authenticated;
revoke all on function public.get_photon_fury_profile(),public.equip_photon_character(text) from public,anon,anonymous;
grant execute on function public.get_photon_fury_profile(),public.equip_photon_character(text) to authenticated;
notify pgrst,'reload schema';
commit;
