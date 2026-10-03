-- Multi-device 02 1v1: Meadow, Terminal, and Grove lane correction.
-- Additive upgrade; retains existing players, inventory, and match history.
begin;

do $$
declare c record; f text;
begin
  for c in select conrelid::regclass as rel, conname from pg_constraint
    where contype='c' and conrelid in ('app_private.one_v_one_map_rules'::regclass,'public.player_1v1_map_priorities'::regclass,'public.multiplayer_matches'::regclass)
      and pg_get_constraintdef(oid) like '%map_key%' and pg_get_constraintdef(oid) like '%grove%'
  loop execute format('alter table %s drop constraint %I',c.rel,c.conname); end loop;
  for f in select pg_get_functiondef(oid) from pg_proc
    where oid in ('public.set_1v1_map_priorities(text[])'::regprocedure,'app_private.choose_1v1_map(uuid,uuid)'::regprocedure)
  loop
    execute replace(replace(f,'''factory'', ''grove''','''factory'', ''grove'', ''meadow'', ''terminal'''),'''factory'',''grove''','''factory'',''grove'',''meadow'',''terminal''');
  end loop;
end $$;
alter table app_private.one_v_one_map_rules add constraint one_v_one_map_rules_map_key_check
  check(map_key in ('classic','alley','desert','skyway','pitch','volcano','factory','grove','meadow','terminal'));
alter table public.player_1v1_map_priorities add constraint player_1v1_map_priorities_map_key_check
  check(map_key in ('classic','alley','desert','skyway','pitch','volcano','factory','grove','meadow','terminal'));
alter table public.multiplayer_matches add constraint multiplayer_matches_map_key_check
  check(map_key in ('classic','alley','desert','skyway','pitch','volcano','factory','grove','meadow','terminal'));

update app_private.one_v_one_map_rules set lane_count=5 where map_key='grove';
insert into app_private.one_v_one_map_rules(map_key,sort_order,display_name,lane_count,obstacle_scaling,healing_enabled,coin_point_reward,wave_point_reward,allowed_attacks,allowed_character_classes,forced_character_key,natural_spawn_weights,gameplay_rules)
values
('meadow',9,'Meadow',6,'normal',true,6,8,array['snowflake','log','spike','rock','barrel','current'],array['runner','medic','tank','trickster','misc'],null,
 '{"log":25,"spike":25,"barrel":10,"rock":15,"snowflake":10,"vortex":15}',
 '{"hp_multiplier":1,"hp_bonus":0,"bonus_lane_score_multiplier":1.4,"bonus_lane_damage_multiplier":2,"frozen_turn_delay_seconds":0.4,"vortex_damage":1,"vortex_speed_factor":0.86,"vortex_gravity_seconds":0.5}'),
('terminal',10,'Terminal',5,'normal',true,6,8,array['snowflake','log','spike','rock','barrel','current'],array['runner'],'runner_ace',
 '{"log":25,"spike":40,"barrel":10,"rock":15,"snowflake":10}',
 '{"hp_multiplier":1,"hp_bonus":1,"forced_character_key":"runner_ace","shared_course":true,"spike_damage":2,"spike_lane_score_multiplier":1.4,"edge_wraps_per_wave":1,"sword_durability":4,"sword_cooldown_seconds":3,"sword_hit_damage":1,"sword_miss_damage":0.5}')
on conflict(map_key) do update set lane_count=excluded.lane_count,allowed_character_classes=excluded.allowed_character_classes,forced_character_key=excluded.forced_character_key,natural_spawn_weights=excluded.natural_spawn_weights,gameplay_rules=excluded.gameplay_rules;

alter table public.multiplayer_players
  add column if not exists sword_durability smallint not null default 4 check(sword_durability between 0 and 4),
  add column if not exists sword_cooldown_until timestamptz,
  add column if not exists sword_damage_total numeric not null default 0,
  add column if not exists terminal_wrap_wave integer not null default 0;
create table if not exists app_private.terminal_course_clocks(
  match_id uuid not null references public.multiplayer_matches(id) on delete cascade,
  wave integer not null,
  starts_at timestamptz not null,
  primary key(match_id,wave)
);
create table if not exists app_private.terminal_contact_receipts(
  match_id uuid not null references public.multiplayer_matches(id) on delete cascade,
  user_id uuid not null,
  wave integer not null, item_id text not null,
  primary key(match_id,user_id,wave,item_id),
  foreign key(match_id,user_id) references public.multiplayer_players(match_id,user_id) on delete cascade
);
revoke all on app_private.terminal_course_clocks,app_private.terminal_contact_receipts from public,anon,authenticated;

-- Preserve the current character rules, including all previous balance updates.
do $$ declare f text; begin
  if to_regprocedure('app_private.character_snapshot_before_terminal(uuid,text)') is null then
    f:=pg_get_functiondef('app_private.one_v_one_character_snapshot(uuid,text)'::regprocedure);
    execute replace(f,'FUNCTION app_private.one_v_one_character_snapshot(','FUNCTION app_private.character_snapshot_before_terminal(');
  end if;
  if to_regprocedure('app_private.get_1v1_state_before_new_maps(uuid)') is null then
    f:=pg_get_functiondef('public.get_1v1_state(uuid)'::regprocedure);
    execute replace(f,'FUNCTION public.get_1v1_state(','FUNCTION app_private.get_1v1_state_before_new_maps(');
  end if;
end $$;
revoke all on function app_private.character_snapshot_before_terminal(uuid,text),app_private.get_1v1_state_before_new_maps(uuid) from public,anon,authenticated;
create or replace function app_private.one_v_one_character_snapshot(p_user_id uuid,p_map_key text)
returns table(character_key text,character_class text,max_hearts numeric,starting_hearts numeric)
language plpgsql stable security definer set search_path='' as $$
begin
  if p_map_key='terminal' then return query select 'runner_ace'::text,'runner'::text,4::numeric,4::numeric;
  else return query select * from app_private.character_snapshot_before_terminal(p_user_id,p_map_key); end if;
end $$;
revoke all on function app_private.one_v_one_character_snapshot(uuid,text) from public,anon,authenticated;

create or replace function app_private.one_v_one_wave_rules(p_match_id uuid,p_wave integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare m text; lanes integer; lane integer; starts timestamptz;
begin
  select match.map_key,rules.lane_count into m,lanes from public.multiplayer_matches match join app_private.one_v_one_map_rules rules on rules.map_key=match.map_key where match.id=p_match_id;
  lane:=mod(abs(hashtextextended(p_match_id::text||':'||p_wave::text,71)::numeric),lanes)::integer;
  if m='factory' then return jsonb_build_object('wave',p_wave,'conveyor_lane_index',lane,'conveyor_speed_multiplier',case when mod(abs(hashtextextended(p_match_id::text||':'||p_wave::text,97)::numeric),2)=0 then 2 else .5 end); end if;
  if m='meadow' then return jsonb_build_object('wave',p_wave,'bonus_lane_index',lane); end if;
  if m='terminal' then
    select starts_at into starts from app_private.terminal_course_clocks where match_id=p_match_id and wave=p_wave;
    return jsonb_build_object('wave',p_wave,'course_starts_at',starts,'course_seed',p_match_id::text);
  end if;
  return jsonb_build_object('wave',p_wave);
end $$;
revoke all on function app_private.one_v_one_wave_rules(uuid,integer) from public,anon,authenticated;

create or replace function public.get_1v1_state(p_match_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare payload jsonb; m public.multiplayer_matches; a public.multiplayer_players; b public.multiplayer_players; starts timestamptz; attacks jsonb;
begin
  -- The preserved function checks identity and match membership first.
  payload:=app_private.get_1v1_state_before_new_maps(p_match_id);
  select * into m from public.multiplayer_matches where id=p_match_id;
  if m.map_key<>'terminal' then return payload; end if;
  select * into a from public.multiplayer_players where match_id=p_match_id and user_id=auth.uid();
  select * into b from public.multiplayer_players where match_id=p_match_id and user_id<>auth.uid() limit 1;
  select greatest(coalesce(m.started_at,clock_timestamp()),coalesce(max(wave_started_at),m.started_at,clock_timestamp())) into starts from public.multiplayer_players where match_id=p_match_id;
  if m.status='playing' then
    insert into app_private.terminal_course_clocks values(p_match_id,m.current_wave,starts) on conflict do nothing;
  end if;
  -- Every purchased hazard belongs to the same course for both rivals.
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'obstacle_type',obstacle_type,'lane_index',lane_index,'lane_group',lane_group,'lane_position',lane_position,'spawn_wave',spawn_wave) order by created_at,id),'[]'::jsonb)
    into attacks from public.multiplayer_attacks where match_id=p_match_id and spawn_wave=m.current_wave;
  return payload || jsonb_build_object('wave_rules',app_private.one_v_one_wave_rules(p_match_id,m.current_wave),'shared_attacks',attacks,
    'self',(payload->'self')||jsonb_build_object('sword_durability',a.sword_durability,'sword_cooldown_until',a.sword_cooldown_until,'sword_damage_total',a.sword_damage_total,'terminal_wrap_wave',a.terminal_wrap_wave),
    'opponent',(payload->'opponent')||jsonb_build_object('sword_durability',b.sword_durability,'sword_cooldown_until',b.sword_cooldown_until));
end $$;

create or replace function public.use_1v1_terminal_sword(p_match_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); m public.multiplayer_matches; a public.multiplayer_players; b public.multiplayer_players; t timestamptz:=clock_timestamp(); hit boolean;
begin
  if uid is null then raise exception 'Sign in required'; end if;
  select * into m from public.multiplayer_matches where id=p_match_id for update;
  perform 1 from public.multiplayer_players where match_id=p_match_id order by slot for update;
  select * into a from public.multiplayer_players where match_id=p_match_id and user_id=uid;
  select * into b from public.multiplayer_players where match_id=p_match_id and user_id<>uid limit 1;
  if a.user_id is null or b.user_id is null then raise exception 'Match not found'; end if;
  if m.map_key<>'terminal' or m.status<>'playing' or a.status<>'playing' or b.status<>'playing' then raise exception 'Sword requires both rivals in active Terminal play'; end if;
  if a.sword_durability=0 or a.sword_cooldown_until>t then raise exception 'Sword is broken or cooling down'; end if;
  hit:=a.lane_index=b.lane_index;
  update public.multiplayer_players set sword_cooldown_until=t+interval '3 seconds',sword_durability=sword_durability-case when hit then 0 else 1 end,
    hearts=greatest(0,hearts-case when hit then 0 else .5 end),sword_damage_total=sword_damage_total+case when hit then 0 else .5 end,last_seen_at=t,updated_at=t where match_id=p_match_id and user_id=uid;
  if hit then
    update public.multiplayer_players set hearts=greatest(0,hearts-1),sword_damage_total=sword_damage_total+1,sword_cooldown_until=greatest(coalesce(sword_cooldown_until,t),t+interval '3 seconds'),updated_at=t where match_id=p_match_id and user_id=b.user_id;
  end if;
  if exists(select 1 from public.multiplayer_players where match_id=p_match_id and user_id=uid and hearts=0) then perform app_private.mark_1v1_eliminated(p_match_id,uid,t); end if;
  if exists(select 1 from public.multiplayer_players where match_id=p_match_id and user_id=b.user_id and hearts=0) then perform app_private.mark_1v1_eliminated(p_match_id,b.user_id,t); end if;
  perform app_private.finalize_1v1_after_second_death(p_match_id,t);
  update public.multiplayer_matches set last_activity_at=t where id=p_match_id;
  return public.get_1v1_state(p_match_id)||jsonb_build_object('sword_hit',hit);
end $$;

create or replace function public.update_1v1_terminal_state(p_match_id uuid,p_hearts numeric,p_wave integer,p_score bigint,p_status text,p_sword_damage_seen numeric)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.multiplayer_players; effective numeric; m public.multiplayer_matches;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select * into m from public.multiplayer_matches where id=p_match_id for update;
  select * into a from public.multiplayer_players where match_id=p_match_id and user_id=auth.uid() for update;
  if a.user_id is null or m.map_key<>'terminal' then raise exception 'Terminal match not found'; end if;
  if p_sword_damage_seen is null or p_sword_damage_seen<0 or p_sword_damage_seen>a.sword_damage_total or p_hearts is null or p_hearts<0 or p_hearts>4 then raise exception 'Invalid Terminal health state'; end if;
  effective:=greatest(0,p_hearts-(a.sword_damage_total-p_sword_damage_seen));
  effective:=least(effective,a.hearts+case when p_wave>a.wave then 1 else 0 end,4);
  return public.update_1v1_state(p_match_id,effective,p_wave,p_score,case when effective=0 then 'eliminated' else p_status end);
end $$;

create or replace function public.record_1v1_terminal_contact(p_match_id uuid,p_item_id text,p_kind text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.multiplayer_players; m public.multiplayer_matches;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select * into m from public.multiplayer_matches where id=p_match_id for update;
  select * into a from public.multiplayer_players where match_id=p_match_id and user_id=auth.uid() for update;
  if a.user_id is null or m.map_key<>'terminal' or m.status<>'playing' or a.status<>'playing' then raise exception 'Active Terminal match required'; end if;
  if p_kind not in ('rock','spikes') or p_item_id is null or p_item_id !~ '^-[0-9]{1,15}$' then raise exception 'Invalid contact'; end if;
  if (select count(*) from app_private.terminal_contact_receipts where match_id=p_match_id and user_id=a.user_id and wave=a.wave)>=100 then raise exception 'Contact limit reached'; end if;
  insert into app_private.terminal_contact_receipts values(p_match_id,a.user_id,a.wave,p_item_id) on conflict do nothing;
  if found then update public.multiplayer_players set sword_durability=greatest(0,sword_durability-1) where match_id=p_match_id and user_id=a.user_id; end if;
  return public.get_1v1_state(p_match_id);
end $$;

-- Terminal wraps use the existing movement endpoint, so normal moves and Q are
-- serialized through the same participant locks.
do $$ declare f text; begin
  if to_regprocedure('app_private.update_position_before_terminal(uuid,integer)') is null then
    f:=pg_get_functiondef('public.update_1v1_position(uuid,integer)'::regprocedure);
    execute replace(f,'FUNCTION public.update_1v1_position(','FUNCTION app_private.update_position_before_terminal(');
  end if;
end $$;
revoke all on function app_private.update_position_before_terminal(uuid,integer) from public,anon,authenticated;
create or replace function public.update_1v1_position(p_match_id uuid,p_lane_index integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.multiplayer_matches; a public.multiplayer_players;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select * into m from public.multiplayer_matches where id=p_match_id for update;
  select * into a from public.multiplayer_players where match_id=p_match_id and user_id=auth.uid() for update;
  if a.user_id is null then raise exception 'Match not found'; end if;
  if m.map_key='terminal' and abs(p_lane_index-a.lane_index)>1 then
    if m.status<>'playing' or a.status<>'playing' or not ((a.lane_index=0 and p_lane_index=4) or (a.lane_index=4 and p_lane_index=0)) or a.terminal_wrap_wave=a.wave then raise exception 'One edge wrap per wave is available'; end if;
    update public.multiplayer_players set terminal_wrap_wave=a.wave where match_id=p_match_id and user_id=a.user_id;
  end if;
  return app_private.update_position_before_terminal(p_match_id,p_lane_index);
end $$;

revoke all on function public.use_1v1_terminal_sword(uuid),public.update_1v1_terminal_state(uuid,numeric,integer,bigint,text,numeric),public.record_1v1_terminal_contact(uuid,text,text) from public,anon,authenticated;
grant execute on function public.use_1v1_terminal_sword(uuid),public.update_1v1_terminal_state(uuid,numeric,integer,bigint,text,numeric),public.record_1v1_terminal_contact(uuid,text,text) to authenticated;
-- Existing match functions enforce auth.uid() and participant membership.
grant execute on function public.get_1v1_state(uuid),public.update_1v1_state(uuid,numeric,integer,bigint,text),public.update_1v1_position(uuid,integer),public.set_1v1_map_priorities(text[]),public.get_1v1_map_priorities(),public.get_1v1_map_catalog(),public.activate_1v1_katana(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
