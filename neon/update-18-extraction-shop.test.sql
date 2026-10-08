-- Run after the Update 18 definitions, in the SAME rollback-only transaction.
-- Fixtures use two existing IDs, but no balance, inventory, or account change survives.
do $$ declare f text;s text;begin
  foreach s in array array['public.extract_items(integer,text)','public.purchase_catalog_item(text)'] loop
    f:=pg_get_functiondef(s::regprocedure);
    f:=replace(f,'FUNCTION public.extract_items(','FUNCTION pg_temp.test_extract(');
    f:=replace(f,'FUNCTION public.purchase_catalog_item(','FUNCTION pg_temp.test_purchase(');
    f:=replace(f,'auth.uid()','nullif(current_setting(''skyway.test_uid'',true),'''')::uuid');
    execute f;
  end loop;
end $$;
do $$
#variable_conflict use_variable
declare a uuid;b uuid;before_b jsonb;photons_before text;p jsonb;profile text;kind text;rules record;draw record;
  i integer;j integer;characters integer;counts integer[];rarities text[]:=array['common','uncommon','rare','epic','legendary','mythic'];
  cost integer;g bigint;rejected boolean;item record;qty integer;item_type text;rarity text;
begin
  select user_id into a from public.player_stats where not app_private.has_active_ban(user_id,'account',null) order by user_id limit 1;
  select user_id into b from public.player_stats where user_id<>a order by user_id limit 1;
  if a is null or b is null then raise exception 'Two account fixtures required';end if;
  select to_jsonb(s) into before_b from public.player_stats s where user_id=b;
  select md5(coalesce(jsonb_agg(to_jsonb(pf) order by pf.user_id)::text,'')) into photons_before from public.player_photon_fury pf;
  perform set_config('skyway.test_uid',a::text,true);
  foreach profile in array array['normal','bonus','rare','legendary'] loop
    select * into rules from app_private.booster_pull_rules(profile);
    counts:=array[0,0,0,0,0,0];characters:=0;
    for i in 0..99 loop
      select * into draw from app_private.booster_roll(profile,.5,(i+.5)/100);
      j:=array_position(rarities,draw.rarity);counts[j]:=counts[j]+1;
      select * into draw from app_private.booster_roll(profile,(i+.5)/100,.5);
      characters:=characters+case when draw.category='character' then 1 else 0 end;
    end loop;
    if counts<>rules.weights or characters<>rules.character_percent then raise exception 'Odds mismatch for %',profile;end if;
  end loop;
  if (select rarity from app_private.booster_roll('legendary',.01,.999))<>'mythic' then raise exception 'Mythic unavailable';end if;
  -- Own the full Skyway pool in this transaction to force every draw to be a duplicate.
  insert into public.player_unlocks(user_id,item_key,item_type,rarity,unlocked_at)
    select a,item_key,c.item_type,c.rarity,now() from public.extraction_catalog c
    where active and extractable and c.item_key not like 'photon_%' on conflict(user_id,item_key) do nothing;
  update public.player_stats set level=9,total_gems=5000 where user_id=a;
  p:=pg_temp.test_extract(100,'normal');
  if (p->>'cost')::integer<>1100 or (p->>'gems')::bigint<>3900 or jsonb_array_length(p->'results')<>1000
    or (p->>'refund')::integer<>0 then raise exception 'Normal box batch price/count/refund mismatch';end if;
  if exists(select 1 from jsonb_array_elements(p->'results') r where r->>'rarity'='mythic' or r->>'draw_profile'<>'normal' or (r->>'is_new')::boolean or (r->>'duplicate_refund')::integer<>0) then raise exception 'Normal batch rerolled duplicates or yielded mythics';end if;
  rejected:=false;
  begin perform pg_temp.test_extract(1,'rare');exception when others then rejected:=sqlerrm='Rare Box requires level 10';end;
  if not rejected then raise exception 'Level 9 bought Rare';end if;
  update public.player_stats set level=10 where user_id=a;
  p:=pg_temp.test_extract(1,'rare');
  if (p->>'cost')::integer<>19 or jsonb_array_length(p->'results')<>11 then raise exception 'Rare price/count mismatch';end if;
  foreach profile in array array['normal','rare','bonus'] loop
    select count(*) into i from jsonb_array_elements(p->'results') r where r->>'draw_profile'=profile;
    if i<>(case profile when 'normal' then 7 else 2 end) then raise exception 'Rare pull mix mismatch';end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(p->'results') r where r->>'rarity'='mythic') then raise exception 'Rare yielded Mythic';end if;
  update public.player_stats set level=19 where user_id=a;
  rejected:=false;
  begin perform pg_temp.test_extract(1,'legendary');exception when others then rejected:=sqlerrm='Legendary Box requires level 20';end;
  if not rejected then raise exception 'Level 19 bought Legendary';end if;
  update public.player_stats set level=20 where user_id=a;
  p:=pg_temp.test_extract(1,'legendary');
  if (p->>'cost')::integer<>27 or jsonb_array_length(p->'results')<>12 then raise exception 'Legendary price/count mismatch';end if;
  foreach profile in array array['normal','rare','bonus','legendary'] loop
    select count(*) into i from jsonb_array_elements(p->'results') r where r->>'draw_profile'=profile;
    if i<>(case profile when 'normal' then 5 when 'legendary' then 1 else 3 end) then raise exception 'Legendary pull mix mismatch';end if;
  end loop;
  foreach kind in array array['regular','ten','invalid'] loop
    rejected:=false;begin perform pg_temp.test_extract(1,kind);exception when others then rejected:=true;end;
    if not rejected then raise exception 'Legacy/invalid box accepted';end if;
  end loop;
  foreach qty in array array[0,-1,101,null] loop
    rejected:=false;begin perform pg_temp.test_extract(qty,'normal');exception when others then rejected:=true;end;
    if not rejected then raise exception 'Invalid quantity accepted';end if;
  end loop;
  update public.player_stats set total_gems=10 where user_id=a;
  rejected:=false;begin perform pg_temp.test_extract(1,'normal');exception when others then rejected:=sqlerrm='Not enough gems';end;
  if not rejected or (select total_gems from public.player_stats where user_id=a)<>10 then raise exception 'Unaffordable box changed balance';end if;
  -- Temporarily remove one owned item per price cell, then test new and repeat purchases.
  foreach rarity in array array['common','uncommon','rare'] loop
    foreach item_type in array array['character','player','obstacle','environment'] loop
      select c.* into item from public.extraction_catalog c where c.active and c.extractable and c.rarity=rarity and c.item_type=item_type order by item_key limit 1;
      cost:=app_private.direct_catalog_price(rarity,item_type);
      delete from public.player_unlocks where user_id=a and item_key=item.item_key;
      update public.player_stats set total_gems=1000 where user_id=a;
      p:=pg_temp.test_purchase(item.item_key);
      if (p->>'cost')::integer<>cost or (p->>'gems')::bigint<>1000-cost or (p->>'already_owned')::boolean then raise exception 'Direct purchase price mismatch';end if;
      p:=pg_temp.test_purchase(item.item_key);
      if (p->>'cost')::integer<>0 or (p->>'gems')::bigint<>1000-cost or not (p->>'already_owned')::boolean then raise exception 'Repeat purchase charged twice';end if;
    end loop;
  end loop;
  foreach rarity in array array['epic','legendary','mythic'] loop
    select c.* into item from public.extraction_catalog c where c.active and c.extractable and c.rarity=rarity order by item_key limit 1;
    rejected:=false;begin perform pg_temp.test_purchase(item.item_key);exception when others then rejected:=sqlerrm='Only Common, Uncommon, and Rare items can be directly unlocked';end;
    if not rejected then raise exception 'High rarity direct purchase accepted';end if;
  end loop;
  if (select to_jsonb(s) from public.player_stats s where user_id=b) is distinct from before_b then raise exception 'Other account stats changed';end if;
  if (select md5(coalesce(jsonb_agg(to_jsonb(pf) order by pf.user_id)::text,'')) from public.player_photon_fury pf)<>photons_before then raise exception 'Photon data changed';end if;
  perform set_config('skyway.test_uid','',true);
  rejected:=false;begin perform pg_temp.test_extract(1,'normal');exception when others then rejected:=sqlerrm='Sign in required';end;
  if not rejected then raise exception 'Anonymous extraction accepted';end if;
  if has_function_privilege('anon','public.extract_items(integer,text)','EXECUTE')
    or has_function_privilege('anonymous','public.purchase_catalog_item(text)','EXECUTE')
    or has_function_privilege('authenticated','app_private.booster_roll(text,double precision,double precision)','EXECUTE')
    or not has_function_privilege('authenticated','public.extract_items(integer,text)','EXECUTE') then raise exception 'Unsafe shop permissions';end if;
end $$;
select 'PASS: all odds, prices, level gates, 100-box duplicates without refunds, direct purchases, repeat charges, account isolation, Photon unchanged, private permissions' as result;
