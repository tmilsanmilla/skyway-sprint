-- Match Setup MISC · Update 19. Ban 10s → announce 4s → character 15s.
begin;
create table if not exists app_private.match_setup_19(
 match_id uuid primary key references public.multiplayer_matches(id) on delete cascade,
 phase text not null check(phase in('ban','announce','character','done')),deadline timestamptz not null,
 rng_rarity text);
create table if not exists app_private.match_bans_19(
 match_id uuid references public.multiplayer_matches(id) on delete cascade,user_id uuid not null,map_key text not null,
 primary key(match_id,user_id));
alter table app_private.match_setup_19 enable row level security;
alter table app_private.match_bans_19 enable row level security;
revoke all on app_private.match_setup_19,app_private.match_bans_19 from public,anon,anonymous,authenticated;
alter table public.multiplayer_players add column if not exists character_confirmed boolean not null default false;
create or replace function app_private.advance_setup_19(mid uuid) returns void language plpgsql security definer set search_path='' as $$
declare m public.multiplayer_matches;s app_private.match_setup_19;chosen text;t timestamptz:=clock_timestamp();begin
 select * into m from public.multiplayer_matches where id=mid for update;
 select * into s from app_private.match_setup_19 where match_id=mid for update;
 if s.match_id is null or m.status<>'countdown' then return;end if;
 if s.phase='ban' and (t>=s.deadline or (select count(*) from app_private.match_bans_19 where match_id=mid)>=2) then
  select key into chosen from unnest(m.map_candidates) key where not exists(select 1 from app_private.match_bans_19 b where b.match_id=mid and b.map_key=key) order by random() limit 1;
  if chosen is null then raise exception 'No map remains';end if;
  update public.multiplayer_matches set map_key=chosen,map_selection_method='bans',last_activity_at=t where id=mid returning * into m;
  perform app_private.setup_19_health(mid);
  update app_private.match_setup_19 set phase='announce',deadline=t+interval '4 seconds' where match_id=mid returning * into s;
 end if;
 if s.phase='announce' and t>=s.deadline then
  if m.mode in('rng','hardcore_duel') or m.map_key in('volcano','terminal') then
   update app_private.match_setup_19 set phase='done',deadline=t where match_id=mid returning * into s;
  else
   update app_private.match_setup_19 set phase='character',deadline=t+interval '15 seconds' where match_id=mid returning * into s;
   update public.multiplayer_matches set character_selection_ends_at=s.deadline,last_activity_at=t where id=mid;
  end if;
 end if;
 if s.phase='character' and (t>=s.deadline or (select count(*) from public.multiplayer_players where match_id=mid and character_confirmed)>=2) then
  update app_private.match_setup_19 set phase='done',deadline=t where match_id=mid returning * into s;
 end if;
 if s.phase='done' then
  update public.multiplayer_matches set status='playing',character_selection_ends_at=null,started_at=t,last_activity_at=t where id=mid;
  update public.multiplayer_players set wave_started_at=t,run_started_at=t,last_seen_at=t where match_id=mid;
 end if;
end $$;
create or replace function public.get_1v1_state(p_match_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.multiplayer_matches;s app_private.match_setup_19;payload jsonb;own_ban text;revealed jsonb;begin
 if auth.uid() is null or not exists(select 1 from public.multiplayer_players where match_id=p_match_id and user_id=auth.uid()) then raise exception 'Match not found';end if;
 perform app_private.advance_setup_19(p_match_id);
 select * into m from public.multiplayer_matches where id=p_match_id for update;
 select * into s from app_private.match_setup_19 where match_id=p_match_id;
 if s.match_id is null and m.status='countdown' and clock_timestamp()>=m.character_selection_ends_at then
  update public.multiplayer_matches set status='playing',started_at=clock_timestamp() where id=p_match_id returning * into m;
  update public.multiplayer_players set wave_started_at=m.started_at,run_started_at=m.started_at where match_id=p_match_id;
 end if;
 payload:=app_private.get_1v1_state_before_character_pick(p_match_id);
 select map_key into own_ban from app_private.match_bans_19 where match_id=p_match_id and user_id=auth.uid();
 if s.phase<>'ban' then select jsonb_agg(map_key) into revealed from app_private.match_bans_19 where match_id=p_match_id;end if;
 return payload||jsonb_build_object('match',(payload->'match')||jsonb_build_object('character_selection_ends_at',m.character_selection_ends_at,
  'setup_phase',s.phase,'setup_deadline',s.deadline,'own_map_ban',own_ban,'revealed_bans',revealed,'rng_rarity',s.rng_rarity,
  'second_death_bonus_points',500,'second_death_multiplier',1.05),
  'self',(payload->'self')||jsonb_build_object('character_confirmed',(select character_confirmed from public.multiplayer_players where match_id=p_match_id and user_id=auth.uid())));
end $$;
create or replace function public.ban_1v1_map(p_match_id uuid,p_map_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.multiplayer_matches;s app_private.match_setup_19;u uuid:=auth.uid();begin
 if u is null or not exists(select 1 from public.multiplayer_players where match_id=p_match_id and user_id=u) then raise exception 'Match not found';end if;
 select * into m from public.multiplayer_matches where id=p_match_id for update;
 select * into s from app_private.match_setup_19 where match_id=p_match_id;
 if s.phase is distinct from 'ban' or m.status<>'countdown' or clock_timestamp()>=s.deadline then raise exception 'Map bans have ended';end if;
 if not(p_map_key=any(m.map_candidates)) then raise exception 'Choose one of these four maps';end if;
 insert into app_private.match_bans_19 values(p_match_id,u,p_map_key) on conflict(match_id,user_id) do update set map_key=excluded.map_key;
 return public.get_1v1_state(p_match_id);
end $$;
create or replace function public.choose_1v1_character(p_match_id uuid,p_character_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();m public.multiplayer_matches;s app_private.match_setup_19;c public.extraction_catalog;h record;r app_private.one_v_one_map_rules;begin
 if u is null or not exists(select 1 from public.multiplayer_players where match_id=p_match_id and user_id=u) then raise exception 'Match not found';end if;
 select * into m from public.multiplayer_matches where id=p_match_id for update;
 select * into s from app_private.match_setup_19 where match_id=p_match_id;
 if m.status<>'countdown' or s.phase is distinct from 'character' or clock_timestamp()>=s.deadline then raise exception 'Character selection has ended';end if;
 if app_private.has_active_ban(u,'account',null) then raise exception 'This account is banned';end if;
 select * into c from public.extraction_catalog where item_key=p_character_key and item_type='character' and active;
 select * into r from app_private.one_v_one_map_rules where map_key=m.map_key;
 if c.item_key is null or not exists(select 1 from public.player_unlocks where user_id=u and item_key=c.item_key and item_type='character') then raise exception 'You do not own this character';end if;
 if r.forced_character_key is not null or not(c.character_class=any(r.allowed_character_classes)) then raise exception 'Character is not allowed on this map';end if;
 if m.mode='ranked' and c.rarity='mythic' then raise exception 'Mythics are not allowed in Ranked';end if;
 select * into h from app_private.character_selection_snapshot(u,m.map_key,c.item_key);
 update public.multiplayer_players set character_key=h.character_key,character_class=h.character_class,max_hearts=h.max_hearts,hearts=h.starting_hearts,character_confirmed=true,last_seen_at=clock_timestamp() where match_id=p_match_id and user_id=u;
 return public.get_1v1_state(p_match_id);
end $$;
-- No gameplay update can skip a setup stage by submitting an old client status.
do $$ declare f text;begin
 f:=pg_get_functiondef('public.update_1v1_state(uuid,numeric,integer,bigint,text)'::regprocedure);
 f:=regexp_replace(f,'if exists\(select 1 from public.multiplayer_matches m where m.id=p_match_id and m.status=''countdown''.*?then return public.get_1v1_state\(p_match_id\); end if;',
  'if exists(select 1 from public.multiplayer_matches m where m.id=p_match_id and m.status=''countdown'') then return public.get_1v1_state(p_match_id); end if;','s');
 execute f;
end $$;
revoke all on function app_private.setup_19_health(uuid),app_private.advance_setup_19(uuid) from public,anon,anonymous,authenticated;
revoke all on function public.ban_1v1_map(uuid,text),public.choose_1v1_character(uuid,text),public.get_1v1_state(uuid) from public,anon,anonymous;
grant execute on function public.ban_1v1_map(uuid,text),public.choose_1v1_character(uuid,text),public.get_1v1_state(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
