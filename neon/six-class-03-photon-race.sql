-- Additive Photon Race. No native identity, role, existing progress or ranking
-- data is reset. HP and the first-death result are calculated from the server
-- course and recorded server-arrival lane changes, never client-reported HP.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $race_function_sources$
declare f record;o oid;
begin
 for f in select * from(values ('app_private.photon_race_hash(text)','cd137edce51a526c522e34e9ffbad2f9'),('app_private.photon_race_course(uuid,integer,integer)','7fb34e5af4b0ccd5cbf2f48137a9f6ff'),('app_private.advance_photon_race(uuid)','805c3533a867a68255c39912852ba948'),('app_private.photon_race_view(uuid,uuid)','e8cdbf53938fb844ab1002d09f54232c'),('public.unlock_photon_race()','55e3b84a03b596c973e603f5c5d1ef67'),('public.get_photon_race_state(uuid)','a61ae962dbab07f23b5e3cf40bfc04d5'),('public.get_photon_race_profile()','aef35971ba5f092b11362e228d7251e9'),('public.join_photon_race()','72243c607394dbd8136a885d2305740f'),('public.step_photon_race(uuid,uuid,integer)','c2232881c0115db68ab81861e184a3f0'),('public.leave_photon_race(uuid)','662ab42111a60d1224d22bf2bc232232'))as x(signature,body_md5)loop
  o:=to_regprocedure(f.signature);
  if o is not null and(select md5(prosrc)from pg_proc where oid=o)is distinct from f.body_md5 then raise exception 'Unreviewed Photon Race function: %',f.signature;end if;
 end loop;
end $race_function_sources$;
do $guard$
declare n text;
begin
 foreach n in array array['photon_race_entitlements','photon_race_matches','photon_race_inputs','photon_race_contacts'] loop
  if to_regclass('app_private.'||n) is not null and obj_description(to_regclass('app_private.'||n),'pg_class') is distinct from 'skyway-six-class-photon-race-v1' then raise exception 'Unreviewed existing race relation: %',n;end if;
 end loop;
end $guard$;
create table if not exists app_private.photon_race_entitlements(user_id uuid primary key references public.player_stats(user_id),purchased_at timestamptz not null default clock_timestamp());
create table if not exists app_private.photon_race_matches(
 id uuid primary key default gen_random_uuid(),host_user_id uuid not null references public.player_stats(user_id),guest_user_id uuid references public.player_stats(user_id),
 status text not null default 'waiting' check(status in('waiting','playing','finished','cancelled')),host_hp integer not null default 40 check(host_hp between 0 and 40),guest_hp integer not null default 40 check(guest_hp between 0 and 40),
 created_at timestamptz not null default clock_timestamp(),started_at timestamptz,finished_at timestamptz,winner_user_id uuid references public.player_stats(user_id),processed_until numeric not null default 0,
 check(guest_user_id is distinct from host_user_id),check(status='waiting' or status='cancelled' or guest_user_id is not null));
create index if not exists photon_race_waiting_idx on app_private.photon_race_matches(created_at)where status='waiting';
create index if not exists photon_race_host_idx on app_private.photon_race_matches(host_user_id,status);
create index if not exists photon_race_guest_idx on app_private.photon_race_matches(guest_user_id,status);
create table if not exists app_private.photon_race_inputs(match_id uuid not null references app_private.photon_race_matches(id),user_id uuid not null references public.player_stats(user_id),command_id uuid not null,at timestamptz not null default clock_timestamp(),lane smallint not null check(lane between 0 and 3),primary key(match_id,user_id,command_id));
create index if not exists photon_race_input_time_idx on app_private.photon_race_inputs(match_id,user_id,at desc);
create table if not exists app_private.photon_race_contacts(match_id uuid not null references app_private.photon_race_matches(id),slot smallint not null check(slot in(1,2)),item_index integer not null check(item_index>=0),at numeric not null,lane smallint not null check(lane between 0 and 3),contact boolean not null,primary key(match_id,slot,item_index));
comment on table app_private.photon_race_entitlements is 'skyway-six-class-photon-race-v1';
comment on table app_private.photon_race_matches is 'skyway-six-class-photon-race-v1';
comment on table app_private.photon_race_inputs is 'skyway-six-class-photon-race-v1';
comment on table app_private.photon_race_contacts is 'skyway-six-class-photon-race-v1';
alter table app_private.photon_race_entitlements enable row level security;
alter table app_private.photon_race_matches enable row level security;
alter table app_private.photon_race_inputs enable row level security;
alter table app_private.photon_race_contacts enable row level security;
revoke all on app_private.photon_race_entitlements,app_private.photon_race_matches,app_private.photon_race_inputs,app_private.photon_race_contacts from public,anon,anonymous,authenticated;
create or replace function app_private.photon_race_hash(p_text text)returns bigint language plpgsql immutable strict set search_path='' as $$
declare h bigint:=2166136261;i integer;
begin for i in 1..length(p_text)loop h:=mod((h # ascii(substr(p_text,i,1))::bigint)*16777619,4294967296);end loop;return h;end $$;
create or replace function app_private.photon_race_course(p_match uuid,p_slot integer,p_index integer)returns jsonb language plpgsql immutable strict set search_path='' as $$
declare h bigint;roll integer;k text;s numeric;a numeric;
begin
 if p_slot not in(1,2)or p_index<0 then raise exception 'Invalid race course';end if;
 h:=app_private.photon_race_hash(p_match::text||':'||p_slot::text||':'||p_index::text);roll:=mod(h,100);
 k:=case when roll<10 then 'rock' when roll<20 then 'needle' when roll<38 then 'car' when roll<48 then 'log' when roll<74 then 'spike' else 'barrel' end;
 s:=1.2096*case k when 'rock' then .35 when 'car' then 1.25 when 'log' then .72 when 'barrel' then 1.5 else 1 end;
 a:=p_index*(.65/sqrt(3::numeric));
 return jsonb_build_object('id',p_index,'kind',k,'lane',mod(h/100,4),'at',a,'speed',s,'contactAt',a+.85/s);
end $$;
create or replace function app_private.advance_photon_race(p_match uuid)returns void language plpgsql security definer set search_path='' as $$
declare m app_private.photon_race_matches;now_at timestamptz:=clock_timestamp();to_at numeric;from_index integer;to_index integer;e record;uid uuid;lane_at integer;h integer;dead_at timestamptz;dead_seconds numeric;
begin
 select * into m from app_private.photon_race_matches where id=p_match for update;
 if m.id is null or m.status<>'playing' or now_at<m.started_at then return;end if;
 -- Catch up in bounded chunks after a disconnected client. Nothing is skipped.
 to_at:=least(extract(epoch from now_at-m.started_at),m.processed_until+60);
 from_index:=greatest(0,floor((m.processed_until-4)/(.65/sqrt(3::numeric)))::integer);
 to_index:=ceil(to_at/(.65/sqrt(3::numeric)))::integer;
 for e in
  select slot,item_index,course,(course->>'contactAt')::numeric as hit_at from(
   select slot,item_index,app_private.photon_race_course(m.id,slot,item_index)course
   from generate_series(1,2)slot cross join generate_series(from_index,to_index)item_index
  )q where (course->>'contactAt')::numeric>m.processed_until and (course->>'contactAt')::numeric<=to_at
   and not exists(select 1 from app_private.photon_race_contacts c where c.match_id=m.id and c.slot=q.slot and c.item_index=q.item_index)
  order by hit_at,slot,item_index
 loop
  if dead_seconds is not null and e.hit_at>dead_seconds then exit;end if;
  uid:=case e.slot when 1 then m.host_user_id else m.guest_user_id end;
  select i.lane into lane_at from app_private.photon_race_inputs i where i.match_id=m.id and i.user_id=uid and i.at<=m.started_at+e.hit_at*interval '1 second' order by i.at desc,i.command_id limit 1;
  lane_at:=coalesce(lane_at,1);
  insert into app_private.photon_race_contacts(match_id,slot,item_index,at,lane,contact)values(m.id,e.slot,e.item_index,e.hit_at,lane_at,lane_at=(e.course->>'lane')::integer);
  if lane_at<>(e.course->>'lane')::integer then continue;end if;
  h:=case e.slot when 1 then m.host_hp else m.guest_hp end;
  h:=case when e.course->>'kind'='needle' then least(40,h+1)else greatest(0,h-1)end;
  if e.slot=1 then m.host_hp:=h;else m.guest_hp:=h;end if;
  if h=0 then
   if dead_seconds is null then dead_seconds:=e.hit_at;dead_at:=m.started_at+e.hit_at*interval '1 second';m.winner_user_id:=uid;
   else m.winner_user_id:=null;end if;
  end if;
 end loop;
 update app_private.photon_race_matches set host_hp=m.host_hp,guest_hp=m.guest_hp,
  status=case when dead_seconds is not null then 'finished'else status end,
  finished_at=case when dead_seconds is not null then dead_at else finished_at end,
  winner_user_id=m.winner_user_id,processed_until=coalesce(dead_seconds,to_at) where id=m.id;

end $$;
create or replace function app_private.photon_race_view(p_match uuid,p_user uuid)returns jsonb language plpgsql stable security definer set search_path='' as $$
declare m app_private.photon_race_matches;slot integer;ln integer;
begin
 select * into m from app_private.photon_race_matches where id=p_match;
 if m.id is null or p_user not in(m.host_user_id,coalesce(m.guest_user_id,m.host_user_id)) then raise exception 'Owned race required';end if;
 slot:=case when p_user=m.host_user_id then 1 else 2 end;
 select lane into ln from app_private.photon_race_inputs where match_id=m.id and user_id=p_user order by at desc,command_id limit 1;
 return jsonb_build_object('id',m.id,'status',m.status,'slot',slot,'startsAt',m.started_at,'serverNow',clock_timestamp(),'selfHp',case slot when 1 then m.host_hp else m.guest_hp end,'rivalHp',case slot when 1 then m.guest_hp else m.host_hp end,'lane',coalesce(ln,1),'winner',case when m.status<>'finished' or m.winner_user_id is null then null else m.winner_user_id=p_user end,'finishedAt',m.finished_at,'unlocked',exists(select 1 from app_private.photon_race_entitlements where user_id=p_user),'photons',coalesce((select photons from public.player_photon_fury where user_id=p_user),0));
end $$;
create or replace function public.unlock_photon_race()returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform app_private.require_pixel_runtime();
 <<owned_race>>declare u uuid:=app_private.photon_user();balance bigint;missing integer;
 begin
  if app_private.is_admin_test_user(u)then raise exception 'Leave Test Mode before buying Photon Race';end if;
  perform pg_advisory_xact_lock(hashtextextended(u::text||':photon-race',0));
  select photons into balance from public.player_photon_fury where user_id=u and unlocked_at is not null for update;
  if balance is null then raise exception 'Unlock Photon Fury first';end if;
  if exists(select 1 from app_private.photon_race_entitlements where user_id=u)then return jsonb_build_object('unlocked',true,'photons',balance);end if;
  if not exists(select 1 from public.player_stats where user_id=u and level>=50)then raise exception 'Photon Race requires level 50';end if;
  select count(*)into missing from unnest(array['photon_trumpet','photon_saxophone','photon_nuclear','photon_burner','photon_bull','photon_magnet','photon_bear','photon_wrench','photon_static','photon_oyster','photon_spade','photon_tick'])k
   where not exists(select 1 from app_private.photon_unlocks where user_id=u and kind='character' and item_key=k);
  if missing<>0 then raise exception 'Unlock all 16 Photon characters first';end if;
  if balance<1000 then raise exception 'Photon Race costs 1000 photons';end if;
  update public.player_photon_fury set photons=photons-1000 where user_id=u returning photons into balance;
  insert into app_private.photon_race_entitlements(user_id)values(u);
  return jsonb_build_object('unlocked',true,'photons',balance);
 end;
end $$;
create or replace function public.get_photon_race_state(p_match_id uuid)returns jsonb language plpgsql security definer set search_path='' as $$
begin perform app_private.require_pixel_runtime();
 <<owned_race>>declare u uuid:=app_private.photon_user();begin
  if not exists(select 1 from app_private.photon_race_matches where id=p_match_id and (host_user_id=u or guest_user_id=u))then raise exception 'Owned race required';end if;
  perform app_private.advance_photon_race(p_match_id);return app_private.photon_race_view(p_match_id,u);
 end;
end $$;
create or replace function public.get_photon_race_profile()returns jsonb language plpgsql security definer set search_path='' as $$
begin perform app_private.require_pixel_runtime();
 <<owned_race>>declare u uuid:=app_private.photon_user();m uuid;begin
  select id into m from app_private.photon_race_matches where (host_user_id=u or guest_user_id=u)and status in('waiting','playing')order by created_at desc limit 1;
  return jsonb_build_object('unlocked',exists(select 1 from app_private.photon_race_entitlements where user_id=u),'photons',(select photons from public.player_photon_fury where user_id=u),'race',case when m is null then null else public.get_photon_race_state(m)end);
 end;
end $$;
create or replace function public.join_photon_race()returns jsonb language plpgsql security definer set search_path='' as $$
begin perform app_private.require_pixel_runtime();
 <<owned_race>>declare u uuid:=app_private.photon_user();m app_private.photon_race_matches;begin
  if not exists(select 1 from app_private.photon_race_entitlements where user_id=u)then raise exception 'Unlock Photon Race first';end if;
  if app_private.is_admin_test_user(u)then raise exception 'Leave Test Mode before racing';end if;
  perform pg_advisory_xact_lock(hashtextextended('skyway-photon-race-queue-v1',0));
  select * into m from app_private.photon_race_matches where (host_user_id=u or guest_user_id=u)and status in('waiting','playing')order by created_at limit 1 for update;
  if m.id is not null then return public.get_photon_race_state(m.id);end if;
  select * into m from app_private.photon_race_matches where status='waiting' and host_user_id<>u order by created_at,id limit 1 for update;
  if m.id is null then insert into app_private.photon_race_matches(host_user_id)values(u)returning * into m;
  else update app_private.photon_race_matches set guest_user_id=u,status='playing',started_at=clock_timestamp()+interval '3 seconds',processed_until=0 where id=m.id returning * into m;end if;
  return app_private.photon_race_view(m.id,u);
 end;
end $$;
create or replace function public.step_photon_race(p_match_id uuid,p_command_id uuid,p_direction integer)returns jsonb language plpgsql security definer set search_path='' as $$
begin perform app_private.require_pixel_runtime();
 <<owned_race>>declare u uuid:=app_private.photon_user();m app_private.photon_race_matches;last_input app_private.photon_race_inputs;ln integer;begin
  if p_command_id is null or p_direction is null or p_direction not in(-1,1)then raise exception 'Invalid race move';end if;
  select * into m from app_private.photon_race_matches where id=p_match_id and (host_user_id=u or guest_user_id=u)for update;
  if m.id is null then raise exception 'Owned race required';end if;
  if exists(select 1 from app_private.photon_race_inputs where match_id=m.id and user_id=u and command_id=p_command_id)then return app_private.photon_race_view(m.id,u);end if;
  perform app_private.advance_photon_race(m.id);
  select * into m from app_private.photon_race_matches where id=m.id;
  if m.status<>'playing' or clock_timestamp()<m.started_at then return app_private.photon_race_view(m.id,u);end if;
  select * into last_input from app_private.photon_race_inputs where match_id=m.id and user_id=u order by at desc,command_id limit 1;
  if last_input.at>clock_timestamp()-interval '.1 second'then raise exception 'Race turn is recovering';end if;
  ln:=greatest(0,least(3,coalesce(last_input.lane,1)+p_direction));
  insert into app_private.photon_race_inputs(match_id,user_id,command_id,lane)values(m.id,u,p_command_id,ln);
  return app_private.photon_race_view(m.id,u);
 end;
end $$;
create or replace function public.leave_photon_race(p_match_id uuid)returns jsonb language plpgsql security definer set search_path='' as $$
begin perform app_private.require_pixel_runtime();
 <<owned_race>>declare u uuid:=app_private.photon_user();m app_private.photon_race_matches;begin
  select * into m from app_private.photon_race_matches where id=p_match_id and (host_user_id=u or guest_user_id=u)for update;
  if m.id is null then raise exception 'Owned race required';end if;
  perform app_private.advance_photon_race(m.id);select * into m from app_private.photon_race_matches where id=m.id;
  if m.status='waiting'then update app_private.photon_race_matches set status='cancelled',finished_at=clock_timestamp()where id=m.id;
  elsif m.status='playing'then update app_private.photon_race_matches set status='finished',finished_at=clock_timestamp(),winner_user_id=case when host_user_id=u then guest_user_id else host_user_id end where id=m.id;end if;
  return app_private.photon_race_view(m.id,u);
 end;
end $$;
revoke all on function app_private.photon_race_hash(text),app_private.photon_race_course(uuid,integer,integer),app_private.advance_photon_race(uuid),app_private.photon_race_view(uuid,uuid) from public,anon,anonymous,authenticated;
revoke all on function public.unlock_photon_race(),public.get_photon_race_profile(),public.get_photon_race_state(uuid),public.join_photon_race(),public.step_photon_race(uuid,uuid,integer),public.leave_photon_race(uuid) from public,anon,anonymous;
grant execute on function public.unlock_photon_race(),public.get_photon_race_profile(),public.get_photon_race_state(uuid),public.join_photon_race(),public.step_photon_race(uuid,uuid,integer),public.leave_photon_race(uuid) to authenticated;
commit;
