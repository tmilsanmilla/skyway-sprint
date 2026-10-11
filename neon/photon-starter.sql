-- Photon Fury: Magician is the only included character.
-- Keep balances, receipts, definitions and explicitly earned unlocks intact.
begin;
create or replace function app_private.owns_photon_character(p_user_id uuid,p_character_key text)
returns boolean language sql stable set search_path='' as $$
  select p_user_id is not null and p_character_key is not null
    and exists(select 1 from app_private.photon_character_rules(p_character_key))
    and (p_character_key='photon_magician' or exists(
      select 1 from public.player_unlocks where user_id=p_user_id
        and item_type='character' and item_key=p_character_key
    ));
$$;
revoke all on function app_private.owns_photon_character(uuid,text) from public,anon,anonymous,authenticated;

create or replace function public.get_photon_fury_profile()
returns jsonb language sql security definer set search_path='' as $$
  select jsonb_build_object(
    'unlocked',p.unlocked_at is not null,'photons',coalesce(p.photons,0),
    'character_keys',(select coalesce(jsonb_agg(character_key),'[]'::jsonb)
      from app_private.photon_character_rules(null)
      where p.unlocked_at is not null and app_private.owns_photon_character(u,character_key)),
    'selected_character_key',case when app_private.owns_photon_character(u,p.selected_character_key)
      then p.selected_character_key else 'photon_magician' end
  ) from app_private.photon_user() u left join public.player_photon_fury p on p.user_id=u;
$$;

create or replace function public.equip_photon_character(p_character_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare k text:=p_character_key;u uuid:=app_private.photon_user();
begin
  if not app_private.owns_photon_character(u,k) then raise exception 'Character locked';end if;
  update public.player_photon_fury set selected_character_key=k where user_id=u and unlocked_at is not null;
  if not found then raise exception 'Mode locked';end if;
  return public.get_photon_fury_profile();
end $$;

create or replace function public.begin_photon_character_run(p_character_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare k text:=p_character_key;u uuid:=app_private.photon_user();c record;p jsonb;
begin
  if not app_private.owns_photon_character(u,k) then raise exception 'Character locked';end if;
  select * into c from app_private.photon_character_rules(k);
  p:=public.begin_photon_fury_run();
  update app_private.photon_fury_runs set character_key=c.character_key,
    saber_cooldown_seconds=c.cooldown_seconds,bonus_point_seconds=c.bonus_point_seconds,
    point_multiplier=case when k='photon_burner' then 2 else 1 end
    where id=(p->>'run_id')::uuid and user_id=u;
  return p||jsonb_build_object('character_key',c.character_key);
end $$;
-- CREATE OR REPLACE preserves the existing guarded RPCs' permissions.
notify pgrst,'reload schema';
commit;
