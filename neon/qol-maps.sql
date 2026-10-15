-- QOL Maps: all ten current maps; legacy Alley retained only for historical matches.
begin;
-- Match keys retain Alley for historical rows. New map lists never offer it.
alter table app_private.one_v_one_map_rules drop constraint if exists one_v_one_map_rules_map_key_check;
alter table app_private.one_v_one_map_rules add constraint one_v_one_map_rules_map_key_check check(map_key in('classic','alley','ruins','desert','skyway','pitch','volcano','factory','grove','meadow','terminal'));
alter table public.multiplayer_matches drop constraint if exists multiplayer_matches_map_key_check;
alter table public.multiplayer_matches add constraint multiplayer_matches_map_key_check check(map_key in('classic','alley','ruins','desert','skyway','pitch','volcano','factory','grove','meadow','terminal'));
alter table public.player_1v1_map_priorities drop constraint if exists player_1v1_map_priorities_map_key_check;
alter table public.player_1v1_map_priorities add constraint player_1v1_map_priorities_map_key_check check(map_key in('classic','alley','ruins','desert','skyway','pitch','volcano','factory','grove','meadow','terminal'));
do $$ declare c record;begin
 for c in select conname from pg_constraint where conrelid='app_private.one_v_one_map_rules'::regclass and contype='c'
  and pg_get_constraintdef(oid) like '%cardinality(allowed_attacks)%' loop
  execute format('alter table app_private.one_v_one_map_rules drop constraint %I',c.conname);
 end loop;
end $$;
alter table app_private.one_v_one_map_rules add constraint one_v_one_map_rules_allowed_attacks_check check(cardinality(allowed_attacks)>0 or map_key='terminal');
alter table app_private.one_v_one_map_rules drop constraint if exists one_v_one_map_rules_coin_point_reward_check;
alter table app_private.one_v_one_map_rules add constraint one_v_one_map_rules_coin_point_reward_check check(coin_point_reward between 0 and 20 and (coin_point_reward>0 or map_key='terminal'));
insert into app_private.one_v_one_map_rules(map_key,sort_order,display_name,lane_count,obstacle_scaling,healing_enabled,coin_point_reward,wave_point_reward,allowed_attacks,allowed_character_classes,forced_character_key,natural_spawn_weights,gameplay_rules)
select 'ruins',11,'Ruins',4,'same_total',true,7,7,array['log','barrel','spike','rock','car'],array['runner','tank','trickster','misc'],null,'{}'::jsonb,'{}'::jsonb where not exists(select 1 from app_private.one_v_one_map_rules where map_key='ruins');
update app_private.one_v_one_map_rules m set lane_count=v.lanes,natural_spawn_weights=v.weights,allowed_attacks=v.attacks,allowed_character_classes=v.classes,coin_point_reward=v.coins,wave_point_reward=v.wave,
gameplay_rules=m.gameplay_rules||v.rules from(values
('classic',5,'{"log":25,"spike":25,"barrel":20,"rock":25,"snowflake":5}'::jsonb,array['log','barrel','snowflake','spike','rock','car']::text[],array['runner','medic','tank','trickster','misc']::text[],6,8,'{"hp_multiplier":1,"hp_bonus":0,"healing_multiplier":1,"frozen_turn_delay_seconds":0.25,"snowflake_enabled":true}'::jsonb),
('ruins',4,'{"log":10,"spike":20,"barrel":40,"rock":30}'::jsonb,array['log','barrel','spike','rock','car']::text[],array['runner','tank','trickster','misc']::text[],7,7,'{"hp_multiplier":1,"hp_bonus":-1,"healing_multiplier":1,"frozen_turn_delay_seconds":0.25,"snowflake_enabled":false}'::jsonb),
('desert',7,'{"log":5,"spike":20,"barrel":30,"rock":35,"snowflake":10}'::jsonb,array['log','barrel','snowflake','spike','rock','car']::text[],array['runner','trickster']::text[],5,5,'{"hp_multiplier":1,"hp_bonus":0,"healing_multiplier":0,"frozen_turn_delay_seconds":0.25,"snowflake_enabled":true}'::jsonb),
('skyway',6,'{"spike":10,"barrel":20,"rock":5,"snowflake":20,"current":20,"car":25}'::jsonb,array['log','snowflake','current','spike','car','rock']::text[],array['runner','medic','tank','misc']::text[],5,5,'{"hp_multiplier":1,"hp_bonus":0,"healing_multiplier":1,"frozen_turn_delay_seconds":0.3,"snowflake_enabled":true}'::jsonb),
('pitch',6,'{"log":25,"spike":25,"barrel":15,"rock":25,"snowflake":10}'::jsonb,array['log','barrel','snowflake','spike','rock','car']::text[],array['runner','medic','tank','trickster','misc']::text[],6,6,'{"hp_multiplier":1,"hp_bonus":0,"healing_multiplier":1,"frozen_turn_delay_seconds":0.25,"snowflake_enabled":true}'::jsonb),
('volcano',7,'{"log":25,"spike":10,"rock":50,"car":5,"vortex":10}'::jsonb,array['log','spike','car','rock']::text[],array['runner']::text[],5,5,'{"hp_multiplier":1,"hp_bonus":0,"healing_multiplier":1,"frozen_turn_delay_seconds":0.25,"snowflake_enabled":false}'::jsonb),
('factory',4,'{"spike":40,"barrel":25,"car":35}'::jsonb,array['log','barrel','spike','rock','car']::text[],array['runner','medic','tank','trickster','misc']::text[],5,5,'{"hp_multiplier":1,"hp_bonus":0,"healing_multiplier":1,"total_obstacle_multiplier":0.88,"frozen_turn_delay_seconds":0.25,"snowflake_enabled":false}'::jsonb),
('grove',5,'{"log":50,"spike":20,"barrel":10,"rock":15,"snowflake":5}'::jsonb,array['log','barrel','snowflake','spike','rock','car']::text[],array['runner','medic','tank','trickster','misc']::text[],5,0,'{"hp_multiplier":1,"hp_bonus":1,"healing_multiplier":1,"frozen_turn_delay_seconds":0.25,"snowflake_enabled":true}'::jsonb),
('meadow',6,'{"log":30,"barrel":15,"rock":25,"snowflake":15,"vortex":15}'::jsonb,array['log','barrel','snowflake','spike','rock','car']::text[],array['runner','medic','tank','trickster','misc']::text[],3,4,'{"hp_multiplier":1,"hp_bonus":0,"healing_multiplier":1,"frozen_turn_delay_seconds":0.25,"snowflake_enabled":true}'::jsonb),
('terminal',5,'{"barrel":30,"spike":40,"rock":5,"car":25}'::jsonb,array[]::text[],array['runner']::text[],0,0,'{"hp_multiplier":1,"hp_bonus":1,"healing_multiplier":0.5,"frozen_turn_delay_seconds":0.25,"snowflake_enabled":false}'::jsonb)
)v(key,lanes,weights,attacks,classes,coins,wave,rules) where m.map_key=v.key;
update app_private.one_v_one_map_rules set healing_enabled=map_key<>'desert',
 forced_character_key=case when map_key in('volcano','terminal') then 'runner_ace' else null end
 where map_key<>'alley';
update app_private.one_v_one_map_rules set gameplay_rules=gameplay_rules||'{"mythics_banned":true,"random_character_bans":10,"pumpkin_miss_limit":3}'::jsonb where map_key='ruins';
update app_private.one_v_one_map_rules set gameplay_rules=jsonb_set(gameplay_rules,'{current,speed_relative_to_barrel}','0.9975') where map_key='skyway';
update app_private.one_v_one_map_rules set gameplay_rules=gameplay_rules||'{"melon_score_multiplier":1.5,"attack_coin_replacement_melon_multiplier":1.4,"healing_multiplier":0.5}'::jsonb where map_key='terminal';
update app_private.one_v_one_map_rules set gameplay_rules=gameplay_rules||'{"vortex_damage":1,"vortex_speed_factor":0.86,"vortex_gravity_seconds":0.5}'::jsonb where map_key='volcano';
create table if not exists app_private.ruins_character_bans(match_id uuid not null references public.multiplayer_matches(id) on delete cascade,character_key text not null,primary key(match_id,character_key));
alter table app_private.ruins_character_bans enable row level security;
revoke all on app_private.ruins_character_bans from public,anon,anonymous,authenticated;
create or replace function app_private.prepare_ruins_bans(mid uuid) returns void language plpgsql security definer set search_path='' as $$
declare map text;existing integer;
begin
 select map_key into map from public.multiplayer_matches where id=mid for update;
 if map is distinct from 'ruins' then return;end if;
 select count(*) into existing from app_private.ruins_character_bans where match_id=mid;
 if existing=10 then return;elsif existing<>0 then raise exception 'Incomplete Ruins bans';end if;
 insert into app_private.ruins_character_bans select mid,item_key from public.extraction_catalog
 where active and item_type='character' and character_class<>'medic' and rarity<>'mythic'
 and item_key not in('runner_ace','medic_patch','tank_bulwark','trickster_rogue') and item_key not like 'photon_%' order by random() limit 10;
 if (select count(*) from app_private.ruins_character_bans where match_id=mid)<>10 then raise exception 'Missing Ruins character pool';end if;
end $$;
revoke all on function app_private.prepare_ruins_bans(uuid) from public,anon,anonymous,authenticated;
do $migration$
declare d text;needle text;replacement text;
begin
 d:=pg_get_functiondef('public.get_1v1_map_catalog()'::regprocedure);
 needle:='from app_private.one_v_one_map_rules rules;';
 replacement:='from app_private.one_v_one_map_rules rules where rules.map_key<>''alley'';';
 if position(replacement in d)=0 then
  if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'Unexpected map catalog';end if;
  execute replace(d,needle,replacement);
 end if;
 d:=pg_get_functiondef('public.set_1v1_map_priorities(text[])'::regprocedure);
 if position('''ruins''' in d)=0 then
  if (length(d)-length(replace(d,'''alley''','')))/length('''alley''')<>1 then raise exception 'Unexpected legacy map preference validation';end if;
  execute replace(d,'''alley''','''ruins''');
 elsif position('''alley''' in d)>0 then raise exception 'Unexpected mixed map preferences';end if;
 d:=pg_get_functiondef('public.join_1v1_queue(text)'::regprocedure);
 if position('QOL Map Refresh pool' in d)=0 then
  needle:='pool:=case when k=''hardcore_duel'' then array[''classic'',''skyway'',''pitch'',''volcano'',''factory'',''meadow''] else array[''classic'',''alley'',''desert'',''skyway'',''pitch'',''volcano'',''factory'',''grove'',''meadow'',''terminal''] end;';
  replacement:='-- QOL Map Refresh pool: Unknown is incomplete and unavailable.'||E'\n'||'pool:=case when k=''hardcore_duel'' then array[''classic'',''ruins'',''desert'',''skyway'',''pitch'',''factory'',''meadow''] else array[''classic'',''ruins'',''desert'',''skyway'',''pitch'',''volcano'',''factory'',''grove'',''meadow'',''terminal''] end;';
  if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'Unexpected queue rules';end if;execute replace(d,needle,replacement);
 elsif position('''unknown''' in d)>0 or position('''alley''' in d)>0 or
  position('pool:=case when k=''hardcore_duel'' then array[''classic'',''ruins'',''desert'',''skyway'',''pitch'',''factory'',''meadow''] else array[''classic'',''ruins'',''desert'',''skyway'',''pitch'',''volcano'',''factory'',''grove'',''meadow'',''terminal''] end;' in d)=0
  then raise exception 'Unexpected refreshed queue rules';
 end if;
 d:=pg_get_functiondef('app_private.advance_setup_19(uuid)'::regprocedure);
 if position('perform app_private.prepare_ruins_bans(mid);' in d)=0 then
  needle:='perform app_private.setup_19_health(mid);';
  if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'Unexpected map setup';end if;
  execute replace(d,needle,'perform app_private.prepare_ruins_bans(mid); '||needle);
 end if;
 d:=pg_get_functiondef('public.choose_1v1_character(uuid,text)'::regprocedure);
 if position('QOL Ruins ownership restrictions' in d)=0 then
  needle:='select * into h from app_private.character_selection_snapshot(u,m.map_key,c.item_key);';
  replacement:='-- QOL Ruins ownership restrictions'||E'\n'||'if m.map_key=''ruins'' and (c.rarity=''mythic'' or exists(select 1 from app_private.ruins_character_bans where match_id=p_match_id and character_key=c.item_key)) then raise exception ''Character is banned on Ruins for this match'';end if;'||E'\n'||needle;
  if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'Unexpected character choice';end if;execute replace(d,needle,replacement);
 end if;
 -- A marker alone is not successful installation: verify the actual guards.
 d:=pg_get_functiondef('public.choose_1v1_character(uuid,text)'::regprocedure);
 if position('c.rarity=''mythic'' or exists(select 1 from app_private.ruins_character_bans where match_id=p_match_id and character_key=c.item_key)' in d)=0
  or position('if u is null or not exists' in d)=0 or position('You do not own this character' in d)=0 then
  raise exception 'Incomplete Ruins character guard';end if;
 d:=pg_get_functiondef('app_private.advance_setup_19(uuid)'::regprocedure);
 if position('perform app_private.prepare_ruins_bans(mid); perform app_private.setup_19_health(mid);' in d)=0 then
  raise exception 'Incomplete Ruins match setup';end if;
end $migration$;
notify pgrst,'reload schema';
commit;
