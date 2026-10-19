/** Actual installed bodies, isolated local role/identity fixtures. Not a live JWT test. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Client} from 'pg';
import {readUpdateSnapshot} from '../scripts/update-2-3-snapshot.mjs';
const host=process.env.ADMIN_TEST_PG_SOCKET;
if(!host?.startsWith('/private/tmp/skyway-admin-23.')||process.env.ADMIN_TEST_PG_DATABASE!=='admin_fixture')throw new Error('Isolated local Unix-socket fixture database required.');
const snapshot=readUpdateSnapshot(process.env.ADMIN_TEST_INSTALLED_SNAPSHOT);
const source=readFileSync(new URL('./update-2-3-duel-access.sql',import.meta.url),'utf8').replace(/^begin;\s*$/mi,'').replace(/^commit;\s*$/mi,'');
const signatures=[...source.matchAll(/\('(public\.[^']+)','[a-f0-9]{32}'\)/g)].map(m=>m[1]);
const db=new Client({host,port:55443,user:process.env.USER,database:'admin_fixture'});
const actor='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002',stranger='00000000-0000-4000-8000-000000000003',match='00000000-0000-4000-8000-000000000004';
let assertions=0;const q=(s,p)=>db.query(s,p);const one=async(s,p)=>Object.values((await q(s,p)).rows[0])[0];
const check=(a,b)=>{assert.deepEqual(a,b);assertions++;};
const reject=async(s,p,pattern)=>{await q('savepoint denied');let caught=false;try{await q(s,p);}catch(e){caught=true;assert.match(e.message,pattern);}await q('rollback to savepoint denied');await q('release savepoint denied');assert.ok(caught,s);assertions++;};
try{
 await db.connect();check(await one('select current_database()'),'admin_fixture');await q('begin');
 await q(`create schema auth;create schema app_private;create schema extensions;create role authenticated;create role anon;create role anonymous;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('duel.test_uid',true),'')::uuid$$;`);
 for(const table of snapshot.tables.filter(t=>['public','app_private'].includes(t.schema))){
  const columns=snapshot.columns.filter(c=>c.table_schema===table.schema&&c.table_name===table.name).sort((a,b)=>a.ordinal_position-b.ordinal_position);
  if(!columns.length)continue;
  const definitions=columns.map(c=>`"${c.column_name}" ${c.data_type==='ARRAY'?c.udt_name.slice(1)+'[]':c.data_type}`);
  await q(`create table "${table.schema}"."${table.name}"(${definitions.join(',')})`);
 }
 // The filtered metadata did not export these private table columns. Their
 // composite type is copied from the canonical Gambit migration, not its rows.
 await q(`create table if not exists app_private.multiplayer_gambit_state(match_id uuid,user_id uuid,deck_cycle integer,draw_pile text[],discard_pile text[],hand text[],last_draw_wave integer,updated_at timestamptz)`);
 const functions=snapshot.functions.filter(f=>signatures.includes('public.'+f.signature)||['send_1v1_attack_without_gambit','send_1v1_attack_qol_base'].includes(f.name));
 for(const f of functions.filter(f=>f.signature!=='reflect_1v1_attack(uuid,text,text)'))await q(f.definition);
 await q(functions.find(f=>f.signature==='reflect_1v1_attack(uuid,text,text)').definition);
 for(const f of functions)await q(`revoke all on function ${f.qualified_signature} from public,anon,anonymous,authenticated`);
 const beforeDefinitions=await q("select oid::regprocedure::text signature,pg_get_functiondef(oid) definition from pg_proc where pronamespace='public'::regnamespace order by oid");
 await q(source);await q(source);
 check((await q("select oid::regprocedure::text signature,pg_get_functiondef(oid) definition from pg_proc where pronamespace='public'::regnamespace order by oid")).rows,beforeDefinitions.rows);
 for(const signature of signatures){check(await one("select has_function_privilege('authenticated',$1,'EXECUTE')",[signature]),true);for(const role of ['anon','anonymous'])check(await one('select has_function_privilege($1,$2,\'EXECUTE\')',[role,signature]),false);}
 check(await one("select has_function_privilege('authenticated','app_private.send_1v1_attack_without_gambit(uuid,text,integer)','EXECUTE')"),false);
 await q("insert into public.multiplayer_matches(id,status,map_key,current_wave,last_activity_at) values($1,'playing','pitch',1,now())",[match]);
 await q("insert into public.multiplayer_players(match_id,user_id,score,status,slot,wave,hearts,max_hearts,katana_broken,last_katana_wave,last_katana_at) values($1,$2,0,'playing',1,1,3,3,false,1,clock_timestamp()),($1,$3,0,'playing',2,1,3,3,false,1,clock_timestamp())",[match,actor,other]);
 await q("select set_config('duel.test_uid',$1,true)",[actor]);await q('set local role authenticated');
 for(const score of [199,200,201,9999])check(Number(await one('select public.sync_1v1_score($1,$2)',[match,score])),score);
 await reject('select public.sync_1v1_score($1,200)',[match],/Score cannot decrease/);
 const katana=await one("select public.reflect_1v1_attack($1,'synthetic-rock-block','rock')",[match]);check(katana.outcome,'broken');check(katana.katana_broken,true);
 await q('reset role');check(Number(await one('select score from public.multiplayer_players where match_id=$1 and user_id=$2',[match,other])),0);
 await q("select set_config('duel.test_uid',$1,true)",[stranger]);await q('set local role authenticated');
 await reject('select public.sync_1v1_score($1,555)',[match],/match not found/);
 await reject("select public.reflect_1v1_attack($1,'stranger-rock','rock')",[match],/match not found/);
 await reject('select public.get_1v1_ability_state($1)',[match],/match not found/);
 await q('reset role');await q("select set_config('duel.test_uid','',true)");await q('set local role authenticated');
 await reject('select public.sync_1v1_score($1,555)',[match],/Sign in required/);
 await reject("select public.reflect_1v1_attack($1,'guest-rock','rock')",[match],/Sign in required/);
 await q('reset role');check(Number(await one('select score from public.multiplayer_players where match_id=$1 and user_id=$2',[match,actor])),9999);
 await q('set local role anon');await reject('select public.sync_1v1_score($1,555)',[match],/permission denied/);await q('reset role');
 // Wrong body must stop all grants rather than silently trusting a same-named function.
 await q("alter function public.sync_1v1_score(uuid,bigint) set search_path='public'");await reject(source,[],/changed\/missing body/);
 console.log(JSON.stringify({ok:true,assertions,entrypoints:signatures.length,exactInstalledBodies:true,localOnly:true,rolledBack:true,liveJwtProof:false}));
}finally{await db.query('rollback').catch(()=>{});await db.end();}
