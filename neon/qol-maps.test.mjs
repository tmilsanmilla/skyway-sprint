/** Isolated PostgreSQL fixture. Never accepts a production connection string.
 * Snapshot contains only installed definitions/columns/constraints, no player rows.
 * PG17 preserves captured checks/uniques; production foreign-key/auth-extension
 * integration remains a separately verified live boundary.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const socket=process.env.QOL_SQL_TEST_SOCKET;
if(!socket || !/^\/private\/tmp\/skyway-map-sql\.[A-Za-z0-9]+$/.test(socket))
 throw new Error('Explicit disposable local-only map SQL socket required');
const database=process.env.QOL_SQL_TEST_DATABASE??'map_test';
if(!/^map_test(?:_[a-z0-9_]+)?$/.test(database)) throw new Error('Disposable map database name required');
const snapshot=JSON.parse(await readFile(new URL('../../../outputs/map-refresh-installed-definitions.json',import.meta.url),'utf8'));
const root=new URL('../',import.meta.url);
const q=x=>'"'+x.replaceAll('"','""')+'"';
const admin=new pg.Client({host:socket,port:55439,user:'lucas',database:'postgres'});
await admin.connect();
if((await admin.query('select 1 from pg_database where datname=$1',[database])).rowCount)
 throw new Error('Fixture database already exists; choose a fresh map_test_ name');
await admin.query(`create database ${q(database)}`);await admin.end();
const db=new pg.Client({host:socket,port:55439,user:'lucas',database});await db.connect();
const query=(text,args)=>db.query(text,args);
const one=async(text,args)=>(await query(text,args)).rows[0];
try {
 await query(`create schema auth;create schema app_private;
 do $$begin if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;
 if not exists(select 1 from pg_roles where rolname='anonymous') then create role anonymous;end if;end$$;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 set check_function_bodies=off;`);
 const groups=Map.groupBy(snapshot.columns,c=>`${c.table_schema}.${c.table_name}`);
 for(const [table,cols] of groups) {
  cols.sort((a,b)=>a.ordinal_position-b.ordinal_position);
  await query(`create table ${table.split('.').map(q).join('.')}(${cols.map(c=>
   `${q(c.column_name)} ${c.data_type==='ARRAY'?q(c.udt_name.slice(1))+'[]':q(c.udt_name)}${c.column_default?' default '+c.column_default:''}${c.is_nullable==='NO'?' not null':''}`
  ).join(',')})`);
 }
 for(const c of snapshot.constraints.filter(c=>groups.has(`${c.schema}.${c.table_name}`)&&/^(CHECK|UNIQUE|PRIMARY KEY)/.test(c.definition)))
  await query(`alter table ${q(c.schema)}.${q(c.table_name)} add constraint ${q(c.conname)} ${c.definition}`);
 await query(`create table app_private.match_setup_19(match_id uuid primary key,phase text,deadline timestamptz,rng_rarity text);
 create table app_private.match_bans_19(match_id uuid,user_id uuid,map_key text,primary key(match_id,user_id));
 create table app_private.multiplayer_gambit_rewards(match_id uuid,user_id uuid,wave integer,best_hand text);
 create table app_private.terminal_course_clocks(match_id uuid,wave integer,starts_at timestamptz,primary key(match_id,wave));
 create table app_private.terminal_contact_receipts(match_id uuid,user_id uuid,wave integer,item_id text,primary key(match_id,user_id,wave,item_id));`);
 const names=new Set(['character_selection_snapshot','send_1v1_attack_without_gambit','send_1v1_attack','join_1v1_queue','choose_1v1_character','get_1v1_map_catalog','get_1v1_state','sync_1v1_intermission_coins','use_1v1_terminal_sword','update_1v1_terminal_state','update_1v1_position','advance_setup_19','setup_19_health','one_v_one_wave_rules','get_1v1_state_before_new_maps','set_1v1_map_priorities','get_1v1_leaderboard','get_leaderboard','is_leaderboard_visible']);
 for(const f of snapshot.functions.filter(f=>names.has(f.name))) await query(f.definition);
 for(const name of ['advance_setup_19','setup_19_health','one_v_one_wave_rules'])
  assert.ok(snapshot.functions.some(f=>f.name===name),`Snapshot missing ${name}`);
 // Only fixture delegates are mocked; patched outer functions retain the actual
 // installed source. No auth, row-ownership or phase guard is removed.
 await query(`create table app_private.fixture_bans(user_id uuid,scope text);
 create function app_private.has_active_ban(uuid,text,text) returns boolean language sql stable as $$select exists(select 1 from app_private.fixture_bans where user_id=$1 and scope=$2)$$;
 create function app_private.is_admin_test_user(uuid) returns boolean language sql as $$select false$$;
 create function app_private.one_v_one_heatfeast_json(uuid,uuid,integer) returns jsonb language sql as $$select '{}'::jsonb$$;
 create function app_private.one_v_one_map_rules_json(text) returns jsonb language sql as $$select to_jsonb(m) from app_private.one_v_one_map_rules m where map_key=$1$$;
 create function app_private.get_1v1_state_before_character_pick(uuid) returns jsonb language sql as $$select jsonb_build_object('match',to_jsonb(m),'self',to_jsonb(p)) from public.multiplayer_matches m join public.multiplayer_players p on p.match_id=m.id where m.id=$1 and p.user_id=auth.uid()$$;
 create function app_private.next_1v1_attack_placement(uuid,uuid,uuid,text) returns table(lane_index integer,lane_group integer,lane_position integer,escape_lane_index integer,wall_parity integer,wall_lane_index integer,wall_size integer) language sql as $$select 0,1,0,1,0,0,1$$;
 create function app_private.mark_1v1_eliminated(uuid,uuid,timestamptz) returns void language sql as $$update public.multiplayer_players set status='eliminated',hearts=0 where match_id=$1 and user_id=$2$$;
 create function app_private.finalize_1v1_after_second_death(uuid,timestamptz) returns void language sql as $$select$$;
 create function app_private.update_position_before_terminal(uuid,integer) returns jsonb language plpgsql as $$begin update public.multiplayer_players set lane_index=$2 where match_id=$1 and user_id=auth.uid();return public.get_1v1_state($1);end$$;`);
 const mapIds=['classic','alley','desert','skyway','pitch','volcano','factory','grove','meadow','terminal'];
 for(let i=0;i<mapIds.length;i++) await query(`insert into app_private.one_v_one_map_rules values($1,$2,$3,5,'normal',true,6,8,array['log'],array['runner'],null,'{}','{}')`,[mapIds[i],i+1,mapIds[i]]);
 const files=['neon/qol-maps.sql','neon/qol-armory.sql','neon/qol-map-settlement.sql','neon/qol-terminal-facing.sql','neon/qol-ruins-pumpkins.sql','neon/map-refresh-leaderboards.sql'];
 for(const file of files) await query(await readFile(new URL(file,root),'utf8'));
 // Each independent leaf migration must also be safe to rerun after composition.
 for(const file of files.slice(2)) await query(await readFile(new URL(file,root),'utf8'));
 for(const file of files) await query(await readFile(new URL(file,root),'utf8'));
 console.log('Map migration install + idempotent second application passed against captured installed definitions');
 const maps=(await one('select public.get_1v1_map_catalog() value')).value;
 assert.equal(maps.length,10);assert.ok(!maps.some(m=>m.map_key==='alley'));
 assert.equal((await one("select count(*)::integer n from app_private.one_v_one_map_rules where map_key='alley'")).n,1);
 for(const m of maps) assert.equal(Object.values(m.natural_spawn_weights).reduce((a,b)=>a+b,0),100,m.map_key);
 assert.deepEqual(maps.find(m=>m.map_key==='terminal').allowed_attacks,[]);
 assert.deepEqual(maps.find(m=>m.map_key==='skyway').natural_spawn_weights,{spike:10,barrel:20,rock:5,snowflake:20,current:20,car:25});
 assert.equal(maps.find(m=>m.map_key==='meadow').coin_point_reward,3);
 await query('begin');
 await query(await readFile(new URL('neon/qol-map-runtime.test.sql',root),'utf8'));
 await query('rollback');
 console.log('Map runtime fixture and rollback checks passed');
 const original=(await one("select pg_get_functiondef('app_private.send_1v1_attack_without_gambit(uuid,text,integer)'::regprocedure) d")).d;
 await query('begin');
 await query(original.replace('when \'snowflake\' then 11','when \'snowflake\' then 99'));
 await assert.rejects(query(await readFile(new URL('neon/qol-armory.sql',root),'utf8')),/Unexpected Armory sender definition/);
 await query('rollback');
 assert.equal((await one("select pg_get_functiondef('app_private.send_1v1_attack_without_gambit(uuid,text,integer)'::regprocedure) d")).d,original);
 console.log('Unknown modified sender definition fails closed and transaction rolls back');
} finally {
 await db.end();
 const cleanup=new pg.Client({host:socket,port:55439,user:'lucas',database:'postgres'});
 await cleanup.connect();
 await cleanup.query(`drop database ${q(database)}`);
 await cleanup.end();
}
