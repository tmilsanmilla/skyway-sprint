-- Ruins pumpkin outcomes persist per participant/wave, including refreshes.
-- This is a bounded client pickup receipt, like existing coin/contact receipts;
-- it is not a claim of server-simulated natural-object collision verification.
begin;
alter table public.multiplayer_players
 add column if not exists ruins_pumpkins_missed smallint not null default 0 check(ruins_pumpkins_missed between 0 and 3),
 add column if not exists ruins_pumpkin_last_wave integer not null default 0 check(ruins_pumpkin_last_wave>=0);
create table if not exists app_private.ruins_pumpkin_receipts(
 match_id uuid not null,user_id uuid not null,wave integer not null check(wave between 1 and 100000),collected boolean not null,
 primary key(match_id,user_id,wave),
 foreign key(match_id,user_id) references public.multiplayer_players(match_id,user_id) on delete cascade);
alter table app_private.ruins_pumpkin_receipts enable row level security;
revoke all on app_private.ruins_pumpkin_receipts from public,anon,anonymous,authenticated;

create or replace function app_private.apply_ruins_pumpkin(mid uuid,u uuid,w integer,did_collect boolean)
returns void language plpgsql security definer set search_path='' as $$
declare m public.multiplayer_matches;p public.multiplayer_players;missed integer;previous boolean;t timestamptz:=clock_timestamp();
begin
 select * into m from public.multiplayer_matches where id=mid for update;
 select * into p from public.multiplayer_players where match_id=mid and user_id=u for update;
 if m.map_key is distinct from 'ruins' or p.user_id is null then raise exception 'Ruins participant required';end if;
 select collected into previous from app_private.ruins_pumpkin_receipts where match_id=mid and user_id=u and wave=w;
 if found then
  if previous is distinct from did_collect then raise exception 'Pumpkin outcome already recorded';end if;
  return;
 end if;
 if w<>p.ruins_pumpkin_last_wave+1 then raise exception 'Pumpkin outcomes must be settled in wave order';end if;
 missed:=case when did_collect then 0 else least(3,p.ruins_pumpkins_missed+1) end;
 insert into app_private.ruins_pumpkin_receipts values(mid,u,w,did_collect);
 update public.multiplayer_players set ruins_pumpkin_last_wave=w,ruins_pumpkins_missed=missed,
  hearts=case when missed=3 then 0 else hearts end,updated_at=t where match_id=mid and user_id=u;
 if missed=3 then
  perform app_private.mark_1v1_eliminated(mid,u,t);
  perform app_private.finalize_1v1_after_second_death(mid,t);
 end if;
end $$;

create or replace function app_private.settle_ruins_completed_pumpkins(mid uuid)
returns void language plpgsql security definer set search_path='' as $$
declare m public.multiplayer_matches;p record;w integer;completed integer;
begin
 select * into m from public.multiplayer_matches where id=mid for update;
 -- The full shared intermission is a grace period for in-flight pickup receipts.
 if m.map_key is distinct from 'ruins' or m.status<>'playing' then return;end if;
 for p in select * from public.multiplayer_players where match_id=mid and status in('playing','intermission') order by slot loop
  completed:=least(m.current_wave-1,p.wave-1);
  for w in p.ruins_pumpkin_last_wave+1..completed loop
   perform app_private.apply_ruins_pumpkin(mid,p.user_id,w,false);
   exit when (select ruins_pumpkins_missed from public.multiplayer_players where match_id=mid and user_id=p.user_id)=3;
  end loop;
 end loop;
end $$;

create or replace function public.record_1v1_ruins_pumpkin(p_match_id uuid,p_wave integer,p_collected boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();m public.multiplayer_matches;p public.multiplayer_players;w integer;previous boolean;
begin
 if u is null then raise exception 'Sign in required';end if;
 select * into m from public.multiplayer_matches where id=p_match_id for update;
 select * into p from public.multiplayer_players where match_id=p_match_id and user_id=u for update;
 if m.map_key is distinct from 'ruins' or p.user_id is null then raise exception 'Ruins participant required';end if;
 if p_wave is null or p_wave not between 1 and 100000 or p_collected is null then raise exception 'Invalid pumpkin outcome';end if;
 select collected into previous from app_private.ruins_pumpkin_receipts where match_id=p_match_id and user_id=u and wave=p_wave;
 if found then
  if previous is distinct from p_collected then raise exception 'Pumpkin outcome already recorded';end if;
  return public.get_1v1_state(p_match_id);
 end if;
 if app_private.has_active_ban(u,'account',null) then raise exception 'This account is banned';end if;
 if m.status not in('playing','intermission') or p.status not in('playing','intermission') then raise exception 'Active Ruins game required';end if;
 if p_wave>p.wave or p_wave>m.current_wave or p_wave<greatest(1,p.wave-1) then raise exception 'Pumpkin receipt is outside the current wave';end if;
 for w in p.ruins_pumpkin_last_wave+1..p_wave-1 loop
  perform app_private.apply_ruins_pumpkin(p_match_id,u,w,false);
  if (select ruins_pumpkins_missed from public.multiplayer_players where match_id=p_match_id and user_id=u)=3 then return public.get_1v1_state(p_match_id);end if;
 end loop;
 perform app_private.apply_ruins_pumpkin(p_match_id,u,p_wave,p_collected);
 return public.get_1v1_state(p_match_id);
end $$;

do $migration$
declare d text;needle text;replacement text;
begin
 d:=pg_get_functiondef('public.get_1v1_state(uuid)'::regprocedure);
 needle:='p:=app_private.get_1v1_state_qol_base(p_match_id);';
 replacement:='perform app_private.settle_ruins_completed_pumpkins(p_match_id); '||needle;
 if position(replacement in d)=0 then
  if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'Unexpected Ruins state delegate';end if;
  d:=replace(d,needle,replacement);
 end if;
 needle:='''purchase_counts'',app_private.armory_purchase_counts(p_match_id,u,w),';
 replacement:=needle||E'\n  ''ruins_pumpkins_missed'',(select ruins_pumpkins_missed from public.multiplayer_players where match_id=p_match_id and user_id=u),\n  ''ruins_pumpkin_last_wave'',(select ruins_pumpkin_last_wave from public.multiplayer_players where match_id=p_match_id and user_id=u),';
 if position('''ruins_pumpkins_missed'',(select ruins_pumpkins_missed from public.multiplayer_players where match_id=p_match_id and user_id=u)' in d)=0 or
  position('''ruins_pumpkin_last_wave'',(select ruins_pumpkin_last_wave from public.multiplayer_players where match_id=p_match_id and user_id=u)' in d)=0 then
  if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 or position('''ruins_pumpkins_missed''' in d)>0 then raise exception 'Unexpected Ruins state fields';end if;
  d:=replace(d,needle,replacement);
 end if;
 execute d;
end $migration$;
revoke all on function app_private.apply_ruins_pumpkin(uuid,uuid,integer,boolean),app_private.settle_ruins_completed_pumpkins(uuid)
 from public,anon,anonymous,authenticated;
revoke all on function public.record_1v1_ruins_pumpkin(uuid,integer,boolean) from public,anon,anonymous;
grant execute on function public.record_1v1_ruins_pumpkin(uuid,integer,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
