-- Extraction Shop MISC · Update 18 · Skyway only; Photon Fury is unchanged.
-- Coordinated Update 18/19 release; rerunnable without resetting player data.
-- Apply with the matching Update 18 game client. Old box identifiers fail closed.
begin;
create or replace function app_private.booster_box_rules(k text)
returns table(cost integer,min_level integer,profiles text[]) language sql immutable set search_path='' as $$
  select b.cost,b.min_level,b.profiles from (values
    ('normal',11,0,array['normal','normal','normal','normal','normal','normal','normal','normal','normal','normal']),
    ('rare',19,10,array['normal','normal','normal','normal','normal','normal','normal','rare','rare','bonus','bonus']),
    ('legendary',27,20,array['normal','normal','normal','normal','normal','rare','rare','rare','bonus','bonus','bonus','legendary'])
  ) b(kind,cost,min_level,profiles) where b.kind=k;
$$;
create or replace function app_private.booster_pull_rules(k text)
returns table(character_percent integer,weights integer[]) language sql immutable set search_path='' as $$
  select p.character_percent,p.weights from (values
    ('normal',6,array[42,32,15,9,2,0]),('bonus',10,array[32,27,17,14,10,0]),
    ('rare',17,array[27,24,19,16,14,0]),('legendary',19,array[22,21,20,19,17,1])
  ) p(kind,character_percent,weights) where p.kind=k;
$$;
create or replace function app_private.booster_roll(k text,c double precision,r double precision)
returns table(category text,rarity text) language plpgsql immutable set search_path='' as $$
declare p record;i integer;ceiling integer:=0;names text[]:=array['common','uncommon','rare','epic','legendary','mythic'];
begin
  if not coalesce(c>=0 and c<1 and r>=0 and r<1,false) then raise exception 'Invalid extraction roll';end if;
  select * into p from app_private.booster_pull_rules(k);
  if p.character_percent is null then raise exception 'Invalid pull profile';end if;
  category:=case when c*100<p.character_percent then 'character' else 'cosmetic' end;
  for i in 1..6 loop
    ceiling:=ceiling+p.weights[i];
    if r*100<ceiling then rarity:=names[i];return next;return;end if;
  end loop;
  raise exception 'Invalid pull weights';
end $$;
create or replace function app_private.duplicate_gem_refund(p_rarity text)
returns integer language sql immutable set search_path='' as $$select 0$$;
-- Retire the rarity-only price lookup: item type is now required.
create or replace function app_private.direct_catalog_price(p_rarity text)
returns integer language sql immutable set search_path='' as $$select null::integer$$;
create or replace function app_private.direct_catalog_price(p_rarity text,p_item_type text)
returns integer language sql immutable set search_path='' as $$
  select case when p_item_type='character' then
    case p_rarity when 'common' then 10 when 'uncommon' then 15 when 'rare' then 25 end
    when p_item_type in('player','obstacle','environment') then
    case p_rarity when 'common' then 2 when 'uncommon' then 3 when 'rare' then 5 end end;
$$;
create or replace function public.extract_items(pull_count integer,box_type text default 'regular')
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();k text:=lower(trim(box_type));b record;d record;item record;g bigint;l integer;
  n integer;i integer;total integer;inserted integer;results jsonb:='[]';
begin
  if u is null then raise exception 'Sign in required';end if;
  if app_private.has_active_ban(u,'account',null) then raise exception 'This account is banned';end if;
  if k in('regular','ten') then raise exception 'This shop requires the Update 18 game client';end if;
  select * into b from app_private.booster_box_rules(k);
  if b.cost is null then raise exception 'Choose Normal, Rare, or Legendary Box';end if;
  if pull_count is null or pull_count<1 or pull_count>100 then raise exception 'Choose 1 to 100 boxes';end if;
  insert into public.player_stats(user_id,total_gems,high_score,updated_at) values(u,0,0,now()) on conflict(user_id) do nothing;
  select total_gems,level into g,l from public.player_stats where user_id=u for update;
  if l<b.min_level then raise exception '% Box requires level %',initcap(k),b.min_level;end if;
  if g<pull_count*b.cost then raise exception 'Not enough gems';end if;
  for n in 1..pull_count loop
    for i in 1..cardinality(b.profiles) loop
      select * into d from app_private.booster_roll(b.profiles[i],random(),random());
      select c.* into item from public.extraction_catalog c
      where c.active and c.extractable and c.rarity=d.rarity and c.item_key not like 'photon_%'
        and ((d.category='character' and c.item_type='character')
          or(d.category='cosmetic' and c.item_type in('player','obstacle','environment')))
      order by random() limit 1;
      if item.item_key is null then raise exception 'Missing % % catalog pool',d.rarity,d.category;end if;
      insert into public.player_unlocks(user_id,item_key,item_type,rarity,unlocked_at)
        values(u,item.item_key,item.item_type,item.rarity,now()) on conflict(user_id,item_key) do nothing;
      get diagnostics inserted=row_count;
      results:=results||jsonb_build_array(jsonb_build_object('pull_number',(n-1)*cardinality(b.profiles)+i,
        'box_number',n,'item_in_box',i,'draw_profile',b.profiles[i],'item_key',item.item_key,
        'display_name',item.display_name,'item_type',item.item_type,'category',d.category,
        'character_class',item.character_class,'rarity',item.rarity,'is_new',inserted=1,'duplicate_refund',0));
    end loop;
  end loop;
  total:=pull_count*b.cost;
  update public.player_stats set total_gems=total_gems-total,updated_at=now() where user_id=u returning total_gems into g;
  return jsonb_build_object('box_type',k,'box_quantity',pull_count,'items_per_box',cardinality(b.profiles),
    'pull_count',jsonb_array_length(results),'item_count',jsonb_array_length(results),'box_cost',b.cost,
    'cost',total,'gross_cost',total,'net_cost',total,'refund',0,'duplicate_refund',0,'gems',g,'results',results);
end $$;
create or replace function public.purchase_catalog_item(p_item_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();item record;price integer;g bigint;owned boolean;
begin
  if u is null then raise exception 'Sign in required';end if;
  if app_private.has_active_ban(u,'account',null) then raise exception 'This account is banned';end if;
  select c.* into item from public.extraction_catalog c where c.item_key=lower(trim(p_item_key))
    and c.active and c.extractable and c.item_key not like 'photon_%';
  if item.item_key is null then raise exception 'Item is not available';end if;
  price:=app_private.direct_catalog_price(item.rarity,item.item_type);
  if price is null then raise exception 'Only Common, Uncommon, and Rare items can be directly unlocked';end if;
  insert into public.player_stats(user_id,total_gems,high_score,updated_at) values(u,0,0,now()) on conflict(user_id) do nothing;
  select total_gems into g from public.player_stats where user_id=u for update;
  owned:=exists(select 1 from public.player_unlocks where user_id=u and item_key=item.item_key);
  if not owned then
    if g<price then raise exception 'Not enough gems';end if;
    insert into public.player_unlocks(user_id,item_key,item_type,rarity,unlocked_at)
      values(u,item.item_key,item.item_type,item.rarity,now()) on conflict(user_id,item_key) do nothing;
    if found then
      update public.player_stats set total_gems=total_gems-price,updated_at=now() where user_id=u returning total_gems into g;
    else owned:=true;end if;
  end if;
  return jsonb_build_object('item_key',item.item_key,'display_name',item.display_name,'item_type',item.item_type,
    'rarity',item.rarity,'cost',case when owned then 0 else price end,'gems',g,'total_gems',g,'already_owned',owned,'is_new',not owned);
end $$;
revoke all on function app_private.booster_box_rules(text),app_private.booster_pull_rules(text),
  app_private.booster_roll(text,double precision,double precision),app_private.duplicate_gem_refund(text),
  app_private.direct_catalog_price(text),app_private.direct_catalog_price(text,text) from public,anon,anonymous,authenticated;
revoke all on function public.extract_items(integer,text),public.purchase_catalog_item(text) from public,anon,anonymous;
grant execute on function public.extract_items(integer,text),public.purchase_catalog_item(text) to authenticated;
notify pgrst,'reload schema';
commit;
