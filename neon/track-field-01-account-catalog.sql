-- Track and Field: exact installed-source deltas; preserve account IDs and history.

begin;

set local lock_timeout='3s';

do $guard$ begin if (select md5(prosrc) from pg_proc where oid='app_private.pixel_native_admission(uuid)'::regprocedure) not in('fe0e9d3d5be925eaddeaef3276f4a925','c3fb695205c820707021c5100a0b3ae8')then raise exception 'Track and Field source drift: app_private.pixel_native_admission(uuid)';end if;end $guard$;

CREATE OR REPLACE FUNCTION app_private.pixel_native_admission(p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select p_user_id is not null and exists(select 1 from neon_auth."user" u where u.id=p_user_id
   and(not coalesce(u.banned,false) or(u."banExpires" is not null and u."banExpires"<clock_timestamp())))

$function$
;

do $guard$ begin if (select md5(prosrc) from pg_proc where oid='app_private.pixel_runtime_admitted()'::regprocedure) not in('5fe40eee00cf203aed79b8e67560582a','8ae71ab44c4495a341ced33bf9648ced')then raise exception 'Track and Field source drift: app_private.pixel_runtime_admitted()';end if;end $guard$;

CREATE OR REPLACE FUNCTION app_private.pixel_runtime_admitted()
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare claims jsonb:=auth.jwt();u uuid:=auth.uid();stamp numeric:=extract(epoch from clock_timestamp());cv numeric;
begin
 if u is null or jsonb_typeof(claims)<>'object' or claims->>'sub' is distinct from u::text then return false;end if;
 if claims->>'iss'='https://ep-tiny-tooth-ax0800jo.neonauth.c-4.us-east-2.aws.neon.tech' then
   if claims?'skyway_auth' or claims?'pixel_subject' or claims?'pixel_session_hash' or claims?'pixel_credential_version' then return false;end if;
   return app_private.pixel_native_admission(u);
 end if;
 return false;
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end $function$
;

do $guard$ begin if (select md5(prosrc) from pg_proc where oid='app_private.require_pixel_runtime()'::regprocedure) not in('eb0319b8c0b3a49bf87f41e0b16db86b','e3ed93e9f786923cb405bb4c6db80938')then raise exception 'Track and Field source drift: app_private.require_pixel_runtime()';end if;end $guard$;

CREATE OR REPLACE FUNCTION app_private.require_pixel_runtime()
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if not app_private.pixel_runtime_admitted() then
  raise exception 'Sign in again with Skyway to continue' using errcode='42501';
 end if;
end $function$
;

update app_private.six_class_catalog set rarity='epic'where item_key='runner_flare';

update app_private.six_class_catalog set character_class='trickster',rarity='rare'where item_key='trickster_jester';

update public.extraction_catalog set rarity='epic'where item_key='runner_flare';

update public.extraction_catalog set character_class='trickster',rarity='rare'where item_key='trickster_jester';

update public.player_unlocks set rarity=case item_key when 'runner_flare'then 'epic'else 'rare'end where item_key in('runner_flare','trickster_jester');

update public.player_loadouts set class_key='trickster'where character_key='trickster_jester';

insert into public.extraction_catalog(item_key,display_name,item_type,rarity,extractable,active)values('azure_map','Azure','environment','common',true,true)on conflict(item_key)do update set display_name=excluded.display_name;

do $copy$ begin if to_regprocedure('app_private.photon_qol_catalog_pre_track_field()')is null then execute $definition$CREATE OR REPLACE FUNCTION app_private.photon_qol_catalog_pre_track_field()
 RETURNS TABLE(item_key text, display_name text, kind text, character_key text, rarity text)
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 select * from app_private.photon_qol_catalog_pre_20261017()
 union all select c.item_key||'_'||s.tier,c.display_name||case s.tier when 'ascendant' then ' Starforged' else ' Eternity' end,
 'skin',c.item_key,s.tier from app_private.photon_qol_catalog_pre_20261017() c
 cross join(values('ascendant'),('immortal')) s(tier) where c.kind='character'
 union all select key,name,'theme',null,rarity from(values
 ('photon_theme_arcade','Arcade Atrium','common'),('photon_theme_tidal','Tidal Generator','uncommon'),
 ('photon_theme_blossom','Ion Blossom','rare'),('photon_theme_eclipse','Eclipse Observatory','epic'),
 ('photon_theme_aurora','Aurora Palace','legendary'),('photon_theme_infinity','Infinity Spire','mythic'),
 ('photon_theme_elysium','Elysium Gate','mythic')) themes(key,name,rarity);
$function$
$definition$;end if;end $copy$;

do $guard$ begin if (select md5(prosrc) from pg_proc where oid='app_private.photon_qol_catalog()'::regprocedure) not in('a2348732dfd957f98674b21c0cc6c3e2','a105622a6f248cdcaf266360678bc35a')then raise exception 'Track and Field source drift: app_private.photon_qol_catalog()';end if;end $guard$;

CREATE OR REPLACE FUNCTION app_private.photon_qol_catalog()
RETURNS TABLE(item_key text,display_name text,kind text,character_key text,rarity text)
LANGUAGE sql IMMUTABLE SET search_path='' AS $function$
 select *from app_private.photon_qol_catalog_pre_track_field()
 union all select *from(values
('photon_magician_simplistic','Magician First Light','skin','photon_magician','simplistic'),
('photon_magician_intermediate_2','Magician Backstage Circuit','skin','photon_magician','intermediate'),
('photon_magician_pro_2','Magician Backstage Vanguard','skin','photon_magician','pro'),
('photon_magician_ascendant_2','Magician Backstage Constellation','skin','photon_magician','ascendant'),
('photon_magician_divine_2','Magician Backstage Sanctum','skin','photon_magician','divine'),
('photon_magician_immortal_2','Magician Backstage Infinity','skin','photon_magician','immortal'),
('photon_tick_simplistic','Tick First Light','skin','photon_tick','simplistic'),
('photon_tick_intermediate_2','Tick Pendulum Circuit','skin','photon_tick','intermediate'),
('photon_tick_pro_2','Tick Pendulum Vanguard','skin','photon_tick','pro'),
('photon_tick_ascendant_2','Tick Pendulum Constellation','skin','photon_tick','ascendant'),
('photon_tick_divine_2','Tick Pendulum Sanctum','skin','photon_tick','divine'),
('photon_tick_immortal_2','Tick Pendulum Infinity','skin','photon_tick','immortal'),
('photon_trumpet_simplistic','Trumpet First Light','skin','photon_trumpet','simplistic'),
('photon_trumpet_intermediate_2','Trumpet Procession Circuit','skin','photon_trumpet','intermediate'),
('photon_trumpet_pro_2','Trumpet Procession Vanguard','skin','photon_trumpet','pro'),
('photon_trumpet_ascendant_2','Trumpet Procession Constellation','skin','photon_trumpet','ascendant'),
('photon_trumpet_divine_2','Trumpet Procession Sanctum','skin','photon_trumpet','divine'),
('photon_trumpet_immortal_2','Trumpet Procession Infinity','skin','photon_trumpet','immortal'),
('photon_saxophone_simplistic','Saxophone First Light','skin','photon_saxophone','simplistic'),
('photon_saxophone_intermediate_2','Saxophone Afterhours Circuit','skin','photon_saxophone','intermediate'),
('photon_saxophone_pro_2','Saxophone Afterhours Vanguard','skin','photon_saxophone','pro'),
('photon_saxophone_ascendant_2','Saxophone Afterhours Constellation','skin','photon_saxophone','ascendant'),
('photon_saxophone_divine_2','Saxophone Afterhours Sanctum','skin','photon_saxophone','divine'),
('photon_saxophone_immortal_2','Saxophone Afterhours Infinity','skin','photon_saxophone','immortal'),
('photon_wizard_simplistic','Wizard First Light','skin','photon_wizard','simplistic'),
('photon_wizard_intermediate_2','Wizard Wayfinder Circuit','skin','photon_wizard','intermediate'),
('photon_wizard_pro_2','Wizard Wayfinder Vanguard','skin','photon_wizard','pro'),
('photon_wizard_ascendant_2','Wizard Wayfinder Constellation','skin','photon_wizard','ascendant'),
('photon_wizard_divine_2','Wizard Wayfinder Sanctum','skin','photon_wizard','divine'),
('photon_wizard_immortal_2','Wizard Wayfinder Infinity','skin','photon_wizard','immortal'),
('photon_nuclear_simplistic','Nuclear First Light','skin','photon_nuclear','simplistic'),
('photon_nuclear_intermediate_2','Nuclear Containment Circuit','skin','photon_nuclear','intermediate'),
('photon_nuclear_pro_2','Nuclear Containment Vanguard','skin','photon_nuclear','pro'),
('photon_nuclear_ascendant_2','Nuclear Containment Constellation','skin','photon_nuclear','ascendant'),
('photon_nuclear_divine_2','Nuclear Containment Sanctum','skin','photon_nuclear','divine'),
('photon_nuclear_immortal_2','Nuclear Containment Infinity','skin','photon_nuclear','immortal'),
('photon_burner_simplistic','Burner First Light','skin','photon_burner','simplistic'),
('photon_burner_intermediate_2','Burner Cinderwake Circuit','skin','photon_burner','intermediate'),
('photon_burner_pro_2','Burner Cinderwake Vanguard','skin','photon_burner','pro'),
('photon_burner_ascendant_2','Burner Cinderwake Constellation','skin','photon_burner','ascendant'),
('photon_burner_divine_2','Burner Cinderwake Sanctum','skin','photon_burner','divine'),
('photon_burner_immortal_2','Burner Cinderwake Infinity','skin','photon_burner','immortal'),
('photon_bull_simplistic','Bull First Light','skin','photon_bull','simplistic'),
('photon_bull_intermediate_2','Bull Ironbound Circuit','skin','photon_bull','intermediate'),
('photon_bull_pro_2','Bull Ironbound Vanguard','skin','photon_bull','pro'),
('photon_bull_ascendant_2','Bull Ironbound Constellation','skin','photon_bull','ascendant'),
('photon_bull_divine_2','Bull Ironbound Sanctum','skin','photon_bull','divine'),
('photon_bull_immortal_2','Bull Ironbound Infinity','skin','photon_bull','immortal'),
('photon_bluff_simplistic','Bluff First Light','skin','photon_bluff','simplistic'),
('photon_bluff_intermediate_2','Bluff Refraction Circuit','skin','photon_bluff','intermediate'),
('photon_bluff_pro_2','Bluff Refraction Vanguard','skin','photon_bluff','pro'),
('photon_bluff_ascendant_2','Bluff Refraction Constellation','skin','photon_bluff','ascendant'),
('photon_bluff_divine_2','Bluff Refraction Sanctum','skin','photon_bluff','divine'),
('photon_bluff_immortal_2','Bluff Refraction Infinity','skin','photon_bluff','immortal'),
('photon_magnet_simplistic','Magnet First Light','skin','photon_magnet','simplistic'),
('photon_magnet_intermediate_2','Magnet Northstar Circuit','skin','photon_magnet','intermediate'),
('photon_magnet_pro_2','Magnet Northstar Vanguard','skin','photon_magnet','pro'),
('photon_magnet_ascendant_2','Magnet Northstar Constellation','skin','photon_magnet','ascendant'),
('photon_magnet_divine_2','Magnet Northstar Sanctum','skin','photon_magnet','divine'),
('photon_magnet_immortal_2','Magnet Northstar Infinity','skin','photon_magnet','immortal'),
('photon_bear_simplistic','Bear First Light','skin','photon_bear','simplistic'),
('photon_bear_intermediate_2','Bear Winterwatch Circuit','skin','photon_bear','intermediate'),
('photon_bear_pro_2','Bear Winterwatch Vanguard','skin','photon_bear','pro'),
('photon_bear_ascendant_2','Bear Winterwatch Constellation','skin','photon_bear','ascendant'),
('photon_bear_divine_2','Bear Winterwatch Sanctum','skin','photon_bear','divine'),
('photon_bear_immortal_2','Bear Winterwatch Infinity','skin','photon_bear','immortal'),
('photon_wrench_simplistic','Wrench First Light','skin','photon_wrench','simplistic'),
('photon_wrench_intermediate_2','Wrench Blueprint Circuit','skin','photon_wrench','intermediate'),
('photon_wrench_pro_2','Wrench Blueprint Vanguard','skin','photon_wrench','pro'),
('photon_wrench_ascendant_2','Wrench Blueprint Constellation','skin','photon_wrench','ascendant'),
('photon_wrench_divine_2','Wrench Blueprint Sanctum','skin','photon_wrench','divine'),
('photon_wrench_immortal_2','Wrench Blueprint Infinity','skin','photon_wrench','immortal'),
('photon_bell_simplistic','Bell First Light','skin','photon_bell','simplistic'),
('photon_bell_intermediate_2','Bell Eveningstar Circuit','skin','photon_bell','intermediate'),
('photon_bell_pro_2','Bell Eveningstar Vanguard','skin','photon_bell','pro'),
('photon_bell_ascendant_2','Bell Eveningstar Constellation','skin','photon_bell','ascendant'),
('photon_bell_divine_2','Bell Eveningstar Sanctum','skin','photon_bell','divine'),
('photon_bell_immortal_2','Bell Eveningstar Infinity','skin','photon_bell','immortal'),
('photon_static_simplistic','Static First Light','skin','photon_static','simplistic'),
('photon_static_intermediate_2','Static Stormglass Circuit','skin','photon_static','intermediate'),
('photon_static_pro_2','Static Stormglass Vanguard','skin','photon_static','pro'),
('photon_static_ascendant_2','Static Stormglass Constellation','skin','photon_static','ascendant'),
('photon_static_divine_2','Static Stormglass Sanctum','skin','photon_static','divine'),
('photon_static_immortal_2','Static Stormglass Infinity','skin','photon_static','immortal'),
('photon_oyster_simplistic','Oyster First Light','skin','photon_oyster','simplistic'),
('photon_oyster_intermediate_2','Oyster Moonreef Circuit','skin','photon_oyster','intermediate'),
('photon_oyster_pro_2','Oyster Moonreef Vanguard','skin','photon_oyster','pro'),
('photon_oyster_ascendant_2','Oyster Moonreef Constellation','skin','photon_oyster','ascendant'),
('photon_oyster_divine_2','Oyster Moonreef Sanctum','skin','photon_oyster','divine'),
('photon_oyster_immortal_2','Oyster Moonreef Infinity','skin','photon_oyster','immortal'),
('photon_spade_simplistic','Spade First Light','skin','photon_spade','simplistic'),
('photon_spade_intermediate_2','Spade Nightdeal Circuit','skin','photon_spade','intermediate'),
('photon_spade_pro_2','Spade Nightdeal Vanguard','skin','photon_spade','pro'),
('photon_spade_ascendant_2','Spade Nightdeal Constellation','skin','photon_spade','ascendant'),
('photon_spade_divine_2','Spade Nightdeal Sanctum','skin','photon_spade','divine'),
('photon_spade_immortal_2','Spade Nightdeal Infinity','skin','photon_spade','immortal'),
('photon_theme_switchyard','Switchyard Nine','theme',null::text,'common'),
('photon_theme_harbor','Starlight Harbor','theme',null::text,'common'),
('photon_theme_tram','Moon Tram Depot','theme',null::text,'common'),
('photon_theme_market','Night Market','theme',null::text,'common'),
('photon_theme_relay_deck','Relay Deck','theme',null::text,'common'),
('photon_theme_orchard','Plasma Orchard','theme',null::text,'uncommon'),
('photon_theme_greenhouse','Orbital Greenhouse','theme',null::text,'uncommon'),
('photon_theme_foundry','Violet Foundry','theme',null::text,'uncommon'),
('photon_theme_reservoir','Ion Reservoir','theme',null::text,'uncommon'),
('photon_theme_courtyard','Satellite Courtyard','theme',null::text,'uncommon'),
('photon_theme_spectrum','Spectrum Causeway','theme',null::text,'rare'),
('photon_theme_hollow','Crystal Hollow','theme',null::text,'rare'),
('photon_theme_turbine','Aurora Turbine','theme',null::text,'rare'),
('photon_theme_vault','Magnetic Vault','theme',null::text,'rare'),
('photon_theme_catwalk','Lunar Catwalk','theme',null::text,'rare'),
('photon_theme_tesseract','Tesseract Hall','theme',null::text,'epic'),
('photon_theme_supercell','Supercell Lab','theme',null::text,'epic'),
('photon_theme_geode','Living Geode','theme',null::text,'epic'),
('photon_theme_spire','Thunder Spire','theme',null::text,'epic'),
('photon_theme_equinox','Equinox Pavilion','theme',null::text,'epic'),
('photon_theme_solstice','Solstice Crown','theme',null::text,'legendary'),
('photon_theme_meridian','Celestial Meridian','theme',null::text,'legendary'),
('photon_theme_heliosphere','Heliosphere','theme',null::text,'legendary'),
('photon_theme_parallax','Parallax Palace','theme',null::text,'legendary'),
('photon_theme_firmament','Glass Firmament','theme',null::text,'legendary'),
('photon_theme_eventide','Eventide Nexus','theme',null::text,'mythic'),
('photon_theme_genesis','Genesis Well','theme',null::text,'mythic'),
('photon_theme_omnidrome','Omnidrome','theme',null::text,'mythic'),
('photon_theme_eternity','Eternity Fold','theme',null::text,'mythic'),
('photon_theme_zenith','Zenith Beyond','theme',null::text,'mythic'))addons(item_key,display_name,kind,character_key,rarity);
$function$;

revoke all on function app_private.photon_qol_catalog_pre_track_field()from public,anon,anonymous,authenticated;

do $guard$ begin if (select md5(prosrc) from pg_proc where oid='app_private.photon_skin_pick(boolean)'::regprocedure) not in('0f134ac2cd12d86079f234dd2b06b192','8cc3dfe16f4675d33ea82896e2a51a88')then raise exception 'Track and Field source drift: app_private.photon_skin_pick(boolean)';end if;end $guard$;

CREATE OR REPLACE FUNCTION app_private.photon_skin_pick(intermediate_only boolean DEFAULT false)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare c text;t text;begin
 select character_key into c from app_private.photon_character_rules(null) order by random() limit 1;
 t:=case when intermediate_only then 'simplistic' else app_private.photon_weighted_pick(array['simplistic','intermediate','pro','ascendant','divine','immortal'],array[2,52,34,8,3,1]) end;
 return(select item_key from app_private.photon_qol_catalog()where kind='skin'and character_key=c and rarity=t order by random()limit 1);
end $function$
;

do $guard$ begin if (select md5(prosrc) from pg_proc where oid='app_private.open_photon_box(uuid)'::regprocedure) not in('97dc758cfa9757e5f0cb1fd10998872c','3773fc6cec1f37c262d0d7150530eaa0')then raise exception 'Track and Field source drift: app_private.open_photon_box(uuid)';end if;end $guard$;

CREATE OR REPLACE FUNCTION app_private.open_photon_box(p_nonce uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare u uuid:=app_private.photon_user();p public.player_photon_fury;s public.player_stats;
 keys text[]:='{}';parts text[]:='{}';categories text[];cat text;key text;v_rarity text;r double precision;
 bonus_count integer;skin_count integer;i integer;j integer;item record;inserted integer;refund integer;refund_total integer:=0;gem_bonus integer:=0;stardust_bonus integer:=0;results jsonb:='[]';result jsonb;
begin
 select * into s from public.player_stats where user_id=u for update;
 select * into p from public.player_photon_fury where user_id=u for update;
 if p.unlocked_at is null then raise exception 'Mode locked';end if;
 if p_nonce=p.last_box_nonce then return p.last_box_result||jsonb_build_object('profile',public.get_photon_fury_profile(),'gems',s.total_gems,'already_completed',true);end if;
 if p_nonce is null or p_nonce is distinct from p.box_nonce then raise exception 'Refresh the Photon collection before opening another box';end if;
 if p.photons<200 then raise exception 'Not enough Photons';end if;
 keys:=array_append(keys,app_private.photon_weighted_pick(array['photon_tick','photon_trumpet','photon_saxophone'],array[48,29,23]));parts:=array_append(parts,'A');
 if random()<.35 then bonus_count:=2;skin_count:=1;else bonus_count:=1;skin_count:=2;end if;
 select array_agg(category) into categories from(select category from unnest(array['rush','strategic','wild']) category order by random() limit bonus_count) c;
 foreach cat in array categories loop
  key:=case cat when 'rush' then app_private.photon_weighted_pick(array['photon_bull','photon_nuclear','photon_burner'],array[41,33,26])
   when 'strategic' then app_private.photon_weighted_pick(array['photon_wrench','photon_bear','photon_magnet'],array[57,32,11])
   else app_private.photon_weighted_pick(array['photon_oyster','photon_static','photon_spade','skin'],array[26,18,11,45]) end;
  if key='skin' then key:=app_private.photon_skin_pick();end if;
  keys:=array_append(keys,key);parts:=array_append(parts,'B');
 end loop;
 for i in 1..skin_count loop keys:=array_append(keys,app_private.photon_skin_pick());parts:=array_append(parts,'B');end loop;
 r:=random();
 if r<.71 then
  for i in 1..2 loop
   v_rarity:=app_private.photon_weighted_pick(array['common','uncommon','rare','epic','legendary','mythic'],array[4000,3000,1520,1120,330,30]);
   select catalog.item_key into key from app_private.photon_qol_catalog() catalog where catalog.kind='theme' and catalog.rarity=v_rarity order by random() limit 1;
   keys:=array_append(keys,key);parts:=array_append(parts,'C');
  end loop;
 elsif r<.98 then
  keys:=array_append(keys,app_private.photon_skin_pick(true));parts:=array_append(parts,'C');
 else stardust_bonus:=85;results:=results||jsonb_build_array(jsonb_build_object('part','C','kind','stardust','key','stardust_85','amount',85,'is_new',true,'duplicate_gems',0));end if;
 for j in 1..cardinality(keys) loop
  select * into item from app_private.photon_qol_catalog() where item_key=keys[j];
  if item.item_key is null or item.kind not in('character','skin','theme') then raise exception 'Missing Photon catalog item';end if;
  if item.kind='character' and app_private.owns_photon_character(u,item.item_key) then inserted:=0;
  else
   insert into app_private.photon_unlocks(user_id,item_key,kind) values(u,item.item_key,item.kind) on conflict(user_id,item_key) do nothing;
   get diagnostics inserted=row_count;
   -- Update 2.3 first-acquisition skin selection.
   if inserted=1 and item.kind='skin' then update public.player_photon_fury set skin_choices=jsonb_set(skin_choices,array[item.character_key],to_jsonb(item.item_key),true) where user_id=u;end if;
  end if;
  refund:=case when inserted=1 then 0 else 10 end;refund_total:=refund_total+refund;
  results:=results||jsonb_build_array(jsonb_build_object('part',parts[j],'kind',item.kind,'key',item.item_key,'is_new',inserted=1,'duplicate_gems',refund));
 end loop;
 update public.player_stats set total_gems=total_gems+refund_total+gem_bonus,stardust=stardust+stardust_bonus,updated_at=clock_timestamp() where user_id=u returning * into s;
 result:=jsonb_build_object('results',results,'gems',s.total_gems,'duplicate_gems',refund_total,'gem_bonus',gem_bonus,'stardust_awarded',stardust_bonus,'stardust',s.stardust,'cost',200);
 update public.player_photon_fury set photons=photons-200,last_box_nonce=p_nonce,last_box_result=result,box_nonce=gen_random_uuid() where user_id=u;
 return result||jsonb_build_object('profile',public.get_photon_fury_profile());
end $function$
;

do $guard$ begin if (select md5(prosrc) from pg_proc where oid='app_private.booster_box_rules(text)'::regprocedure) not in('92285017f68115c5c3ee17e137547dea','7b630877cec51b87cd15cc7286acf9f3')then raise exception 'Track and Field source drift: app_private.booster_box_rules(text)';end if;end $guard$;

CREATE OR REPLACE FUNCTION app_private.booster_box_rules(k text)
 RETURNS TABLE(cost integer, min_level integer, profiles text[])
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select b.cost,b.min_level,b.profiles from (values
    ('normal',11,0,array['normal','normal','normal','normal','normal','normal','normal','normal','normal','normal','normal','normal','normal','normal']),
    ('rare',19,10,array['normal','normal','normal','normal','normal','normal','normal','normal','normal','normal','normal','normal','bonus','bonus','rare','rare']),
    ('legendary',27,20,array['normal','normal','normal','normal','normal','normal','normal','normal','normal','normal','bonus','bonus','bonus','rare','rare','rare','legendary','legendary'])
  ) b(kind,cost,min_level,profiles) where b.kind=k;
$function$
;

do $guard$ begin if (select md5(prosrc) from pg_proc where oid='unlock_photon_race()'::regprocedure) not in('55e3b84a03b596c973e603f5c5d1ef67','3243bc3d01b7d3be84864ea8d1274af8')then raise exception 'Track and Field source drift: unlock_photon_race()';end if;end $guard$;

CREATE OR REPLACE FUNCTION public.unlock_photon_race()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 perform app_private.require_pixel_runtime();
 <<owned_race>>declare u uuid:=app_private.photon_user();balance bigint;dust bigint;missing integer;
 begin
  if app_private.is_admin_test_user(u)then raise exception 'Leave Test Mode before buying Photon Race';end if;
  perform pg_advisory_xact_lock(hashtextextended(u::text||':photon-race',0));
  select photons into balance from public.player_photon_fury where user_id=u and unlocked_at is not null for update;
  if balance is null then raise exception 'Unlock Photon Fury first';end if;
  if exists(select 1 from app_private.photon_race_entitlements where user_id=u)then return jsonb_build_object('unlocked',true,'photons',balance,'stardust',(select stardust from public.player_stats where user_id=u));end if;
  if not exists(select 1 from public.player_stats where user_id=u and level>=50)then raise exception 'Photon Race requires level 50';end if;
  select count(*)into missing from unnest(array['photon_trumpet','photon_saxophone','photon_nuclear','photon_burner','photon_bull','photon_magnet','photon_bear','photon_wrench','photon_static','photon_oyster','photon_spade','photon_tick'])k
   where not exists(select 1 from app_private.photon_unlocks where user_id=u and kind='character' and item_key=k);
  if missing<>0 then raise exception 'Unlock all 16 Photon characters first';end if;
  select stardust into dust from public.player_stats where user_id=u for update;
  if balance<1000 or dust<1000 then raise exception 'Photon Race costs 1000 photons and 1000 stardust';end if;
  update public.player_stats set stardust=stardust-1000 where user_id=u returning stardust into dust;
  update public.player_photon_fury set photons=photons-1000 where user_id=u returning photons into balance;
  insert into app_private.photon_race_entitlements(user_id)values(u);
  return jsonb_build_object('unlocked',true,'photons',balance,'stardust',(select stardust from public.player_stats where user_id=u));
 end;
end $function$
;

do $guard$ begin if (select md5(prosrc) from pg_proc where oid='app_private.admin_player_command_v23_core(text,uuid,text,text,text,bigint,text[],uuid,bigint,boolean,bigint,text,text)'::regprocedure) not in('04a03a35b6c603378e637fc55ed36a9b','6a22b6992e68678cf7696cfaa1c0c03e')then raise exception 'Track and Field source drift: app_private.admin_player_command_v23_core(text,uuid,text,text,text,bigint,text[],uuid,bigint,boolean,bigint,text,text)';end if;end $guard$;

CREATE OR REPLACE FUNCTION app_private.admin_player_command_v23_core(p_action text, p_target_user_id uuid, p_item_kind text DEFAULT NULL::text, p_item_key text DEFAULT NULL::text, p_stat_key text DEFAULT NULL::text, p_value bigint DEFAULT NULL::bigint, p_ban_scopes text[] DEFAULT NULL::text[], p_device_id uuid DEFAULT NULL::uuid, p_duration_seconds bigint DEFAULT NULL::bigint, p_permanent boolean DEFAULT false, p_ban_id bigint DEFAULT NULL::bigint, p_reason text DEFAULT NULL::text, p_command_text text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid:=auth.uid(); action text:=lower(trim(coalesce(p_action,'')));
  stat text:=lower(trim(coalesce(p_stat_key,''))); v_kind text:=lower(trim(coalesce(p_item_kind,'')));
  name text:=lower(trim(coalesce(p_item_key,''))); actor_email text;
  target_profile public.player_photon_fury; wallet public.player_stats; item record; character record;
  result jsonb; request jsonb; changed integer:=0; closed_sessions integer:=0; error_text text; error_state text; old_allowed boolean;
begin
  if actor is null or not public.is_main_admin() then
    raise exception 'Only main admins can run player commands' using errcode='42501';
  end if;
  select lower(u.email) into actor_email from neon_auth."user" u where u.id::text=actor::text;
  if actor_email is null then raise exception 'Signed-in admin account not found' using errcode='42501'; end if;
  if char_length(coalesce(p_command_text,''))>1000 then raise exception 'Command is too long'; end if;
  if action<>'rptc' and (p_target_user_id is null or not exists(
    select 1 from neon_auth."user" u where u.id::text=p_target_user_id::text)) then
    raise exception 'Player not found' using errcode='P0002';
  end if;
  request:=jsonb_build_object('item_kind',v_kind,'item_name',name,'stat_key',stat,'value',p_value);
  begin
    if action not in('check','set','rpta','rptb','rptc','photon_grant','photon_revoke','grant','revoke') then
      raise exception 'Unknown Update 2.3 command';
    end if;
    if p_ban_scopes is not null or p_device_id is not null or p_duration_seconds is not null
      or coalesce(p_permanent,false) or p_ban_id is not null then
      raise exception 'Unexpected command arguments';
    end if;

    -- Update 2.3 mastery management follow-up: main-admin check and the
    -- current public anti-game wrapper above this core remain unchanged.
    if action in('grant','revoke') then
      if v_kind<>'mastery' or stat<>'' or p_value is not null or app_private.mastery_price(name) is null then
        raise exception 'Choose an exact character mastery';
      end if;
      perform pg_advisory_xact_lock(hashtextextended(p_target_user_id::text,23));
      if action='grant' then
        if not app_private.mastery_owns_character(p_target_user_id,name) then
          raise exception 'This player must own the character first; grant the character separately';
        end if;
        insert into app_private.player_mastery_quests(user_id,character_key,quest,mastered,mastery_enabled,flair_rewrite_enabled,mastered_at)
        values(p_target_user_id,name,3,true,true,true,clock_timestamp())
        on conflict(user_id,character_key) do update set quest=3,mastered=true,mastery_enabled=true,flair_rewrite_enabled=true,
          mastered_at=coalesce(app_private.player_mastery_quests.mastered_at,excluded.mastered_at)
        where not app_private.player_mastery_quests.mastered;
        get diagnostics changed=row_count;
        update app_private.player_mastery_preferences set active_character=null where user_id=p_target_user_id and active_character=name;
      else
        update app_private.player_mastery_quests set mastered=false,mastery_enabled=false,flair_rewrite_enabled=false
          where user_id=p_target_user_id and character_key=name and (mastered or mastery_enabled or flair_rewrite_enabled);
        get diagnostics changed=row_count;
        -- Invalidate prior completed trials too: their otherwise valid finish
        -- receipt must not undo a later revoke. Historical dates/results stay.
        update app_private.mastery_sessions set finished_at=coalesce(finished_at,clock_timestamp()),
          trial_failed=case when context_type='trial' and finished_at is null then true else trial_failed end,
          event_counts=case when context_type='trial' then event_counts||jsonb_build_object('admin_mastery_revoked',true) else event_counts end
          where user_id=p_target_user_id and character_key=name and (finished_at is null
            or context_type='trial' and event_counts->'admin_mastery_revoked' is distinct from 'true'::jsonb);
        get diagnostics closed_sessions=row_count;
      end if;
      result:=jsonb_build_object('ok',true,'item_kind','mastery','item_key',name,'mastered',action='grant',
        'changed',changed>0 or closed_sessions>0,'noop',changed=0 and closed_sessions=0,'closed_sessions',closed_sessions,
        'message',case when action='grant' then 'Character mastery unlocked.' else 'Character mastery revoked; purchased quests and progress were kept.' end);
    elsif action='rptc' then

      if p_target_user_id is not null or v_kind<>'' or name<>'' or stat<>'' or p_value is not null then
        raise exception '/rptc does not accept a player or value';
      end if;
      -- Only invoking /rptc does this; installation never clears real reports.
      delete from public.player_reports where status in('new','reviewing');
      get diagnostics changed=row_count;
      result:=jsonb_build_object('ok',true,'cleared_count',changed);
    elsif action in('rpta','rptb') then
      if v_kind<>'' or name<>'' or stat<>'' or p_value is not null then raise exception 'Unexpected report-control argument'; end if;
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('report-permission:'||p_target_user_id::text,0));
      old_allowed:=coalesce((select allowed from app_private.player_report_permissions where user_id=p_target_user_id),true);
      if old_allowed<>(action='rpta') then
        insert into app_private.player_report_permissions(user_id,allowed,updated_by)
        values(p_target_user_id,action='rpta',actor)
        on conflict(user_id) do update set allowed=excluded.allowed,updated_by=excluded.updated_by,updated_at=clock_timestamp();
        changed:=1;
      end if;
      result:=jsonb_build_object('ok',true,'reports_allowed',action='rpta','changed',changed=1,'noop',changed=0,
        'message',case when action='rpta' then 'Reports are allowed for this player.' else 'Reports are blocked for this player.' end);
    elsif action='check' then
      if stat not in('gems','photons','stardust') or name<>'' or v_kind<>'' or p_value is not null then
        raise exception 'Check accepts gems, photons, or stardust only';
      end if;
      if stat='photons' then
        select * into target_profile from public.player_photon_fury where user_id=p_target_user_id;
        result:=jsonb_build_object('ok',true,'stat_key',stat,'value',case when target_profile.unlocked_at is not null then target_profile.photons else null end);
      else
        select * into wallet from public.player_stats where user_id=p_target_user_id;
        if not found then raise exception 'Player stats not found'; end if;
        result:=jsonb_build_object('ok',true,'stat_key',stat,'value',case when stat='gems' then wallet.total_gems else wallet.stardust end);
      end if;
    elsif action='set' then
      if stat not in('photons','stardust') or name<>'' or v_kind<>'' then raise exception 'Choose photons or stardust'; end if;
      if p_value is null or p_value<0 or p_value>1000000000 then raise exception 'Balance must be a whole number between 0 and 1000000000'; end if;
      if stat='photons' then
        select * into target_profile from public.player_photon_fury where user_id=p_target_user_id for update;
        if target_profile.unlocked_at is null then
          result:=jsonb_build_object('ok',true,'noop',true,'message','Photon Fury is locked; nothing was changed.');
        else
          update public.player_photon_fury set photons=p_value where user_id=p_target_user_id;
          result:=jsonb_build_object('ok',true,'stat_key',stat,'value',p_value);
        end if;
      else
        update public.player_stats set stardust=p_value,updated_at=clock_timestamp() where user_id=p_target_user_id;
        if not found then raise exception 'Player stats not found'; end if;
        result:=jsonb_build_object('ok',true,'stat_key',stat,'value',p_value);
      end if;
    else
      if v_kind not in('photon_character','photon_skin','photon_theme') or p_value is not null or name='' then
        raise exception 'Choose an exact Photon character, skin, or theme';
      end if;
      select * into target_profile from public.player_photon_fury where user_id=p_target_user_id for update;
      if target_profile.unlocked_at is null then
        result:=jsonb_build_object('ok',true,'noop',true,'message','Photon Fury is locked; nothing was changed.');
      else
        if v_kind='photon_skin' then
          if name not in('simplistic','intermediate','intermediate_2','pro','pro_2','ascendant','ascendant_2','divine','divine_2','immortal','immortal_2') then raise exception 'Unknown Photon skin tier'; end if;
          select * into character from app_private.photon_qol_catalog() c where c.kind='character'
            and (lower(c.item_key)=stat or lower(c.display_name)=stat);
          if character.item_key is null then raise exception 'Unknown Photon character'; end if;
          select * into item from app_private.photon_qol_catalog() c where c.kind='skin'
            and c.character_key=character.item_key and c.item_key=character.item_key||'_'||name;
        else
          if stat<>'' then raise exception 'Unexpected Photon item argument'; end if;
          select * into item from app_private.photon_qol_catalog() c
            where c.kind=case v_kind when 'photon_character' then 'character' else 'theme' end
            and (lower(c.item_key)=name or lower(c.display_name)=name);
        end if;
        if item.item_key is null then raise exception 'Unknown Photon catalog item'; end if;
        if item.kind='character' and item.item_key in('photon_magician','photon_wizard','photon_bluff','photon_bell') then
          raise exception 'The four starter characters cannot be granted or revoked';
        end if;
        if action='photon_grant' then
          insert into app_private.photon_unlocks(user_id,item_key,kind) values(p_target_user_id,item.item_key,item.kind)
            on conflict(user_id,item_key) do nothing;
          get diagnostics changed=row_count;
        else
          delete from app_private.photon_unlocks where user_id=p_target_user_id and item_key=item.item_key and kind=item.kind;
          get diagnostics changed=row_count;
          if item.kind='character' then
            -- Imported explicit character ownership is also consulted by owns_photon_character.
            delete from public.player_unlocks where user_id=p_target_user_id and item_key=item.item_key and item_type='character';
            if found then changed:=1; end if;
            update public.player_photon_fury set selected_character_key='photon_magician'
              where user_id=p_target_user_id and selected_character_key=item.item_key;
          elsif item.kind='skin' then
            update public.player_photon_fury set skin_choices=skin_choices-item.character_key
              where user_id=p_target_user_id and skin_choices->>item.character_key=item.item_key;
          else
            update public.player_photon_fury set selected_theme_key='default'
              where user_id=p_target_user_id and selected_theme_key=item.item_key;
          end if;
        end if;
        result:=jsonb_build_object('ok',true,'item_key',item.item_key,'changed',changed>0,'noop',changed=0,'message','No ownership changes were needed.');
      end if;
    end if;
  exception when others then
    get stacked diagnostics error_text=message_text,error_state=returned_sqlstate;
    insert into public.admin_command_audit(actor_user_id,actor_email,target_user_id,action,command_text,request,result,succeeded,error_message)
    values(actor,actor_email,p_target_user_id,action,p_command_text,request,jsonb_build_object('sqlstate',error_state),false,left(error_text,1000));
    return jsonb_build_object('ok',false,'error',error_text);
  end;
  insert into public.admin_command_audit(actor_user_id,actor_email,target_user_id,action,command_text,request,result,succeeded)
    values(actor,actor_email,p_target_user_id,action,p_command_text,request,result,true);
  return result;
end $function$
;

create table if not exists app_private.track_field_migration_receipts(key text primary key,applied_at timestamptz not null default clock_timestamp(),recovery jsonb not null);
revoke all on app_private.track_field_migration_receipts from public,anon,anonymous,authenticated;
do $reset$ declare season integer;begin
 perform pg_advisory_xact_lock(hashtextextended('skyway-track-field-20261123',0));
 if not exists(select 1 from app_private.track_field_migration_receipts where key='ranked-photon-race-reset-v1')then
  lock table public.multiplayer_matches,app_private.photon_race_matches in share row exclusive mode;
  if exists(select 1 from public.multiplayer_matches where status in('waiting','playing','countdown'))or exists(select 1 from app_private.photon_race_matches where status in('waiting','playing'))then raise exception 'Finish active matches before Track and Field reset';end if;
  lock table public.ranked_1v1_seasons,public.player_ranked_1v1_stats,app_private.photon_race_entitlements,public.player_photon_fury in share row exclusive mode;
  insert into app_private.track_field_migration_receipts(key,recovery)select 'ranked-photon-race-reset-v1',jsonb_build_object(
   'ranked_seasons',(select coalesce(jsonb_agg(to_jsonb(s)),'[]')from public.ranked_1v1_seasons s),
   'ranked_stats',(select coalesce(jsonb_agg(to_jsonb(s)),'[]')from public.player_ranked_1v1_stats s),
   'race_entitlements',(select coalesce(jsonb_agg(to_jsonb(s)),'[]')from app_private.photon_race_entitlements s),
   'race_wallets',(select coalesce(jsonb_agg(jsonb_build_object('user_id',p.user_id,'photons',p.photons)),'[]')from public.player_photon_fury p join app_private.photon_race_entitlements e using(user_id)));
  update public.player_photon_fury p set photons=p.photons+1000 from app_private.photon_race_entitlements e where p.user_id=e.user_id;
  delete from app_private.photon_race_entitlements;
  select coalesce(max(id),0)+1 into season from public.ranked_1v1_seasons;
  update public.ranked_1v1_seasons set is_active=false,ends_at=coalesce(ends_at,clock_timestamp())where is_active;
  insert into public.ranked_1v1_seasons(id,name,starts_at,is_active)values(season,'Track and Field',clock_timestamp(),true);
  insert into public.player_ranked_1v1_stats(season_id,user_id,rating,matches_played,wins,losses,draws,current_streak,best_streak,best_wave,best_score,coins_collected,obstacle_points_spent)
   select season,user_id,1500,0,0,0,0,0,0,1,0,0,0 from public.player_stats;
 end if;
end $reset$;

notify pgrst,'reload schema';

commit;
