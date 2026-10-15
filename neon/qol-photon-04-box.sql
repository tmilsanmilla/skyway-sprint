-- Photon QOL 04: server rolls, atomic currencies, bounded retry receipt (no pull-history table).
begin;
create or replace function app_private.photon_weighted_pick(keys text[],weights integer[])
returns text language plpgsql volatile set search_path='' as $$
declare total integer;roll double precision;ceiling integer:=0;i integer;
begin
 if cardinality(keys)<>cardinality(weights) or cardinality(keys)<1 then raise exception 'Invalid pool';end if;
 select sum(w) into total from unnest(weights) w;roll:=random()*total;
 for i in 1..cardinality(keys) loop ceiling:=ceiling+weights[i];if roll<ceiling then return keys[i];end if;end loop;
 raise exception 'Invalid weights';
end $$;
create or replace function app_private.photon_skin_pick(intermediate_only boolean default false)
returns text language plpgsql volatile set search_path='' as $$
declare c text;t text;
begin
 select character_key into c from app_private.photon_character_rules(null) order by random() limit 1;
 t:=case when intermediate_only then 'intermediate' else app_private.photon_weighted_pick(array['intermediate','pro','divine'],array[55,40,5]) end;
 return c||'_'||t;
end $$;
create or replace function app_private.open_photon_box(p_nonce uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=app_private.photon_user();p public.player_photon_fury;s public.player_stats;
 keys text[]:='{}';parts text[]:='{}';categories text[];cat text;key text;v_rarity text;r double precision;
 bonus_count integer;skin_count integer;i integer;j integer;item record;inserted integer;refund integer;refund_total integer:=0;gem_bonus integer:=0;results jsonb:='[]';result jsonb;
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
 if r<.65 then
  for i in 1..2 loop
   v_rarity:=app_private.photon_weighted_pick(array['common','uncommon','rare','epic','legendary','mythic'],array[4000,3000,1510,1140,330,20]);
   select catalog.item_key into key from app_private.photon_qol_catalog() catalog where catalog.kind='theme' and catalog.rarity=v_rarity order by random() limit 1;
   keys:=array_append(keys,key);parts:=array_append(parts,'C');
  end loop;
 elsif r<.80 then
  gem_bonus:=20;results:=results||jsonb_build_array(jsonb_build_object('part','C','kind','gems','key','gems_20','amount',20,'is_new',true,'duplicate_gems',0));
 else keys:=array_append(keys,app_private.photon_skin_pick(true));parts:=array_append(parts,'C');end if;
 for j in 1..cardinality(keys) loop
  select * into item from app_private.photon_qol_catalog() where item_key=keys[j];
  if item.item_key is null or item.kind not in('character','skin','theme') then raise exception 'Missing Photon catalog item';end if;
  if item.kind='character' and app_private.owns_photon_character(u,item.item_key) then inserted:=0;
  else
   insert into app_private.photon_unlocks(user_id,item_key,kind) values(u,item.item_key,item.kind) on conflict(user_id,item_key) do nothing;
   get diagnostics inserted=row_count;
  end if;
  refund:=case when inserted=1 then 0 when item.kind='skin' and parts[j]='B' then 10 else 5 end;refund_total:=refund_total+refund;
  results:=results||jsonb_build_array(jsonb_build_object('part',parts[j],'kind',item.kind,'key',item.item_key,'is_new',inserted=1,'duplicate_gems',refund));
 end loop;
 update public.player_stats set total_gems=total_gems+refund_total+gem_bonus,updated_at=clock_timestamp() where user_id=u returning * into s;
 result:=jsonb_build_object('results',results,'gems',s.total_gems,'duplicate_gems',refund_total,'gem_bonus',gem_bonus,'cost',200);
 update public.player_photon_fury set photons=photons-200,last_box_nonce=p_nonce,last_box_result=result,box_nonce=gen_random_uuid() where user_id=u;
 return result||jsonb_build_object('profile',public.get_photon_fury_profile());
end $$;
revoke all on function app_private.photon_weighted_pick(text[],integer[]),app_private.photon_skin_pick(boolean),app_private.open_photon_box(uuid)
 from public,anon,anonymous,authenticated;
commit;
