-- Game Modes MISC · Update 19.
begin;
create or replace function app_private.setup_19_health(mid uuid) returns void language plpgsql security definer set search_path='' as $$
declare m public.multiplayer_matches;p record;h record;begin
select * into m from public.multiplayer_matches where id=mid;
for p in select * from public.multiplayer_players where match_id=mid loop
if m.mode='hardcore_duel' then select 'runner_ace'::text character_key,'runner'::text character_class,1::numeric max_hearts,1::numeric starting_hearts into h;
elsif m.map_key='terminal' then select 'runner_ace'::text character_key,'runner'::text character_class,4::numeric max_hearts,4::numeric starting_hearts into h;
else select * into h from app_private.character_selection_snapshot(p.user_id,m.map_key,p.character_key);end if;
update public.multiplayer_players set character_key=h.character_key,character_class=h.character_class,max_hearts=h.max_hearts,hearts=h.starting_hearts,
lane_index=floor((select lane_count from app_private.one_v_one_map_rules where map_key=m.map_key)/2)::smallint where match_id=mid and user_id=p.user_id;
end loop;
end $$;
alter table public.multiplayer_matches drop constraint if exists multiplayer_matches_mode_check;
alter table public.multiplayer_matches add constraint multiplayer_matches_mode_check check(mode in('casual','ranked','rng','hardcore_duel'));
alter table public.multiplayer_queue drop constraint if exists multiplayer_queue_mode_check;
alter table public.multiplayer_queue add constraint multiplayer_queue_mode_check check(mode in('casual','ranked','rng','hardcore_duel'));
alter table public.multiplayer_matches drop constraint if exists multiplayer_matches_map_selection_method_check;
alter table public.multiplayer_matches add constraint multiplayer_matches_map_selection_method_check check(map_selection_method in('legacy_default','fixed','preferences','preferences_shared_last','votes_overlap','votes_union','bans','rng'));
create or replace function app_private.rotating_mode_19(t timestamptz) returns text language sql immutable set search_path='' as $$
select case when mod(floor(extract(epoch from t)/86400)::bigint,2)=0 then 'rng' else 'hardcore_duel' end;
$$;
create or replace function public.get_rotating_mode() returns jsonb language sql stable security definer set search_path='' as $$
select jsonb_build_object('active_mode',app_private.rotating_mode_19(now()),'next_rotation_at',date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'+interval '1 day','required_level',5);
$$;
create or replace function public.join_1v1_queue(p_mode text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();k text:=lower(trim(p_mode));name text;other uuid;other_name text;mid uuid;m public.multiplayer_matches;
pool text[];candidates text[];map text:='classic';v_rarity text;classes text[];r float8;ck text;class text;slot integer;uid uuid;
begin
if u is null then raise exception 'Sign in required';end if;
if k is null or k not in('casual','ranked','rng','hardcore_duel') then raise exception 'Unknown duel mode';end if;
if app_private.has_active_ban(u,'account',null) then raise exception 'This account is banned';end if;
perform pg_advisory_xact_lock(917240115);
select mm.* into m from public.multiplayer_matches mm join public.multiplayer_players p on p.match_id=mm.id
where p.user_id=u and mm.status in('countdown','playing','intermission') order by mm.created_at desc limit 1;
if m.id is not null then return jsonb_build_object('match_id',m.id,'status',m.status,'mode',m.mode,'map_key',m.map_key,
'opponent_username',(select username from public.multiplayer_players where match_id=m.id and user_id<>u limit 1));end if;
if k in('rng','hardcore_duel') and (coalesce((select level from public.player_stats where user_id=u),0)<5 or k<>app_private.rotating_mode_19(now())) then raise exception 'Reach level 5 and choose today''s active mode';end if;
if k='ranked' and (not exists(select 1 from app_private.ranked_requalification where user_id=u and qualified) or
coalesce((select level from public.player_stats where user_id=u),0)<25 or app_private.has_active_ban(u,'leaderboard',null)) then raise exception 'Ranked requires level 25, its unlock, and no score ban';end if;
select username into name from public.player_profiles where user_id=u;
if name is null then raise exception 'Choose a username before entering 1v1';end if;
delete from public.multiplayer_queue where queued_at<now()-interval '2 minutes';
select q.user_id,p.username into other,other_name from public.multiplayer_queue q join public.player_profiles p on p.user_id=q.user_id join public.player_stats st on st.user_id=q.user_id
where q.user_id<>u and q.mode=k and not app_private.has_active_ban(q.user_id,'account',null)
and (k not in('rng','hardcore_duel') or st.level>=5)
and (k<>'ranked' or (st.level>=25 and exists(select 1 from app_private.ranked_requalification where user_id=q.user_id and qualified) and not app_private.has_active_ban(q.user_id,'leaderboard',null)))
and not exists(select 1 from public.multiplayer_players mp join public.multiplayer_matches mm on mm.id=mp.match_id where mp.user_id=q.user_id and mm.status in('countdown','playing','intermission'))
order by q.queued_at limit 1 for update of q skip locked;
if other is null then
insert into public.multiplayer_queue values(u,now(),k) on conflict(user_id) do update set queued_at=excluded.queued_at,mode=excluded.mode;
return jsonb_build_object('match_id',null,'status','waiting','mode',k);
end if;
pool:=case when k='hardcore_duel' then array['classic','skyway','pitch','volcano','factory','meadow'] else array['classic','alley','desert','skyway','pitch','volcano','factory','grove','meadow','terminal'] end;
select array_agg(key) into candidates from (select key from unnest(pool) key order by random() limit 4) x;
if k='rng' then
r:=random();map:=case when r<.3 then 'classic' when r<.55 then 'pitch' when r<.8 then 'factory' else 'meadow' end;
r:=random();v_rarity:=case when r<.15 then 'uncommon' when r<.5 then 'rare' when r<.85 then 'epic' else 'legendary' end;
candidates:=array[map];
select array_agg(key) into classes from (select key from unnest(array['runner','medic','tank','trickster','misc']) key order by random()) x;
end if;
insert into public.multiplayer_matches(host_user_id,guest_user_id,mode,map_key,map_candidates,map_selection_method,character_selection_ends_at)
values(other,u,k,map,candidates,case when k='rng' then 'rng' else 'bans' end,null) returning id into mid;
for slot in 1..2 loop
uid:=case when slot=1 then other else u end;ck:='runner_ace';class:='runner';
if k='rng' then
class:=classes[slot];select item_key into ck from public.extraction_catalog where active and item_type='character' and character_class=class and rarity=v_rarity order by random() limit 1;
if ck is null then raise exception 'Missing RNG % % character pool',v_rarity,class;end if;
end if;
insert into public.multiplayer_players(match_id,user_id,slot,username,character_key,character_class,max_hearts,hearts,lane_index)
values(mid,uid,slot,case when slot=1 then other_name else name end,ck,class,3,3,2);
end loop;
insert into app_private.match_setup_19 values(mid,case when k='rng' then 'announce' else 'ban' end,clock_timestamp()+case when k='rng' then interval '4 seconds' else interval '10 seconds' end,v_rarity);
if k='rng' then perform app_private.setup_19_health(mid);end if;
delete from public.multiplayer_queue where user_id in(u,other);
return jsonb_build_object('match_id',mid,'status','countdown','mode',k,'map_key',map,'opponent_username',other_name);
end $$;

create or replace function app_private.reject_ranked_mythic_queue() returns trigger language plpgsql set search_path='' as $$begin return new;end$$;
create or replace function app_private.hardcore_duel_health_19() returns trigger language plpgsql security definer set search_path='' as $$
declare st text;begin
select status into st from public.multiplayer_matches where id=new.match_id and mode='hardcore_duel';
if st is not null then new.character_key:='runner_ace';new.character_class:='runner';new.max_hearts:=1;
new.hearts:=least(1,new.hearts);if tg_op='UPDATE' and st in('playing','intermission') then new.hearts:=least(old.hearts,new.hearts);end if;
end if;return new;
end $$;
drop trigger if exists zz_hardcore_duel_health_19 on public.multiplayer_players;
create trigger zz_hardcore_duel_health_19 before insert or update of hearts,max_hearts,character_key on public.multiplayer_players for each row execute function app_private.hardcore_duel_health_19();
revoke all on function app_private.setup_19_health(uuid),app_private.rotating_mode_19(timestamptz),app_private.hardcore_duel_health_19() from public,anon,anonymous,authenticated;
revoke all on function public.join_1v1_queue(text),public.get_rotating_mode() from public,anon,anonymous;
grant execute on function public.join_1v1_queue(text),public.get_rotating_mode() to authenticated;
notify pgrst,'reload schema';
commit;
