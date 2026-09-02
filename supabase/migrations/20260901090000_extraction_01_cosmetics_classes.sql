-- Extraction 01 Cosmetics + Classes
create table if not exists public.player_unlocks (
  user_id uuid not null references auth.users(id) on delete cascade,
  item_key text not null,
  item_type text not null check (item_type in ('class','player','obstacle','environment')),
  rarity text not null check (rarity in ('common','rare','epic','legendary')),
  unlocked_at timestamptz not null default now(),
  primary key (user_id,item_key)
);
create table if not exists public.player_loadouts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  class_key text not null default 'runner',
  player_cosmetic text,
  obstacle_cosmetic text,
  environment_cosmetic text,
  updated_at timestamptz not null default now()
);
alter table public.player_unlocks enable row level security;
alter table public.player_loadouts enable row level security;
create policy "Players read own unlocks" on public.player_unlocks for select to authenticated using (auth.uid()=user_id);
create policy "Players read own loadout" on public.player_loadouts for select to authenticated using (auth.uid()=user_id);
grant select on public.player_unlocks,public.player_loadouts to authenticated;

create or replace function public.extract_items(pull_count integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare i integer; roll float; rarity text; picked text; kind text; results jsonb='[]'::jsonb; cost integer;
begin
  if auth.uid() is null or pull_count not in (1,10) then raise exception 'Invalid extraction'; end if;
  cost:=pull_count*2;
  update player_stats set total_gems=total_gems-cost,updated_at=now() where user_id=auth.uid() and total_gems>=cost;
  if not found then raise exception 'Not enough gems'; end if;
  for i in 1..pull_count loop
    roll:=random();
    if pull_count=10 and i=10 then rarity:=case when roll<.75 then 'rare' when roll<.90 then 'epic' else 'legendary' end;
    else rarity:=case when roll<.50 then 'common' when roll<.75 then 'rare' when roll<.90 then 'epic' else 'legendary' end; end if;
    if rarity='legendary' and random()<.55 then
      kind:='class'; picked:=(array['medic','tank','trickster'])[1+floor(random()*3)::int];
    elsif rarity='common' then kind:='player'; picked:=(array['red_runner','blue_runner','gold_runner'])[1+floor(random()*3)::int];
    elsif rarity='rare' then kind:='obstacle'; picked:=(array['ice_obstacles','neon_obstacles','rust_obstacles'])[1+floor(random()*3)::int];
    elsif rarity='epic' then kind:='environment'; picked:=(array['cave_map','sunset_map','snow_map'])[1+floor(random()*3)::int];
    else kind:='player'; picked:='void_runner'; end if;
    insert into player_unlocks values(auth.uid(),picked,kind,rarity,now()) on conflict do nothing;
    results:=results||jsonb_build_array(jsonb_build_object('item_key',picked,'item_type',kind,'rarity',rarity));
  end loop;
  return jsonb_build_object('results',results,'gems',(select total_gems from player_stats where user_id=auth.uid()));
end $$;

create or replace function public.set_loadout(slot text,item text)
returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if item<>'runner' and not exists(select 1 from player_unlocks where user_id=auth.uid() and item_key=item and item_type=slot) then raise exception 'Item is not unlocked'; end if;
  insert into player_loadouts(user_id) values(auth.uid()) on conflict do nothing;
  if slot='class' then update player_loadouts set class_key=item,updated_at=now() where user_id=auth.uid();
  elsif slot='player' then update player_loadouts set player_cosmetic=item,updated_at=now() where user_id=auth.uid();
  elsif slot='obstacle' then update player_loadouts set obstacle_cosmetic=item,updated_at=now() where user_id=auth.uid();
  elsif slot='environment' then update player_loadouts set environment_cosmetic=item,updated_at=now() where user_id=auth.uid();
  else raise exception 'Invalid slot'; end if;
end $$;
revoke all on function public.extract_items(integer),public.set_loadout(text,text) from public;
grant execute on function public.extract_items(integer),public.set_loadout(text,text) to authenticated;
