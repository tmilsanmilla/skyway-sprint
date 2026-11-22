import assert from "node:assert/strict";
import fs from "node:fs";
import {pathToFileURL} from "node:url";
import {photonRaceItem,photonRaceHash,parsePhotonRace,photonRaceContact,photonRaceEligibility} from "../app/photon-race-rules.ts";
import {PHOTON_CHARACTERS,PHOTON_STARTERS} from "../app/photon-fury-rules.ts";
const modulePath=process.env.SKYWAY_TEST_PGLITE_MODULE;assert.ok(modulePath?.startsWith("/")&&modulePath.endsWith("/@electric-sql/pglite/dist/index.js"));
const {PGlite}=await import(pathToFileURL(modulePath).href),db=new PGlite();
const u="11111111-1111-4111-8111-111111111111",v="22222222-2222-4222-8222-222222222222",x="33333333-3333-4333-8333-333333333333";
let checks=0;const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};const value=async(sql,args)=>Object.values((await db.query(sql,args)).rows[0])[0];
const uid=id=>value("select set_config('test.uid',$1,false)",[id]);
try{
 await db.exec(`create schema app_private;create schema auth;create role anon;create role anonymous;create role authenticated;
 create function auth.uid()returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create function app_private.photon_user()returns uuid language plpgsql as $$declare u uuid:=auth.uid();begin if u is null then raise exception 'Sign in required';end if;if current_setting('test.banned',true)='true'then raise exception 'Account unavailable';end if;return u;end$$;
 create function app_private.require_pixel_runtime()returns void language plpgsql as $$begin if current_setting('test.runtime',true)='off'then raise exception 'Runtime closed';end if;end$$;
 create function app_private.is_admin_test_user(uuid)returns boolean language sql as $$select current_setting('test.mode',true)='on'$$;
 create table public.player_stats(user_id uuid primary key,level integer,total_gems bigint default 7,stardust bigint default 9);
 create table public.player_photon_fury(user_id uuid primary key,unlocked_at timestamptz,photons bigint);
 create table app_private.photon_unlocks(user_id uuid,item_key text,kind text,primary key(user_id,item_key));
 create table public.player_ranked_1v1_stats(user_id uuid primary key,rating numeric, matches_played integer);
 insert into public.player_stats(user_id,level)values('${u}',49),('${v}',50),('${x}',50);
 insert into public.player_photon_fury values('${u}',clock_timestamp(),1500),('${v}',clock_timestamp(),2000),('${x}',clock_timestamp(),2000);
 insert into public.player_ranked_1v1_stats values('${u}',1500,23),('${v}',1600,30);
 `);
 const sql=fs.readFileSync(new URL("./six-class-03-photon-race.sql",import.meta.url),"utf8");await db.exec(sql);await db.exec(sql);checks+=2;
 await uid(u);
 await assert.rejects(value("select public.unlock_photon_race()"),/level 50/);checks++;
 await db.exec("update public.player_stats set level=50");
 await assert.rejects(value("select public.unlock_photon_race()"),/all 16/);checks++;
 const paid=Object.keys(PHOTON_CHARACTERS).filter(key=>!PHOTON_STARTERS.includes(key));eq(paid.length,12);
 for(const id of [u,v])for(const key of paid)await db.query("insert into app_private.photon_unlocks values($1,$2,'character')",[id,key]);
 eq(photonRaceEligibility(50,Object.keys(PHOTON_CHARACTERS),1500).characters,true);
 const unlocked=await value("select public.unlock_photon_race()");eq(unlocked.photons,500);
 eq((await value("select public.unlock_photon_race()")).photons,500);
 eq(Number(await value("select total_gems from public.player_stats where user_id=$1",[u])),7);
 eq(Number(await value("select stardust from public.player_stats where user_id=$1",[u])),9);
 const first=parsePhotonRace(await value("select public.join_photon_race()"));eq(first.status,"waiting");eq(first.selfHp,40);eq((await value("select public.join_photon_race()")).id,first.id);
 await uid(v);await value("select public.unlock_photon_race()");const joined=parsePhotonRace(await value("select public.join_photon_race()"));eq(joined.id,first.id);eq(joined.status,"playing");eq(joined.slot,2);
 eq(Number(await value("select count(*)::integer from app_private.photon_race_matches")),1);
 for(let slot=1;slot<=2;slot++)for(let index=0;index<80;index++){
  const js=photonRaceItem(first.id,slot,index),sql=await value("select app_private.photon_race_course($1,$2,$3)",[first.id,slot,index]);
  eq(sql.kind,js.kind);eq(sql.lane,js.lane);assert.ok(Math.abs(Number(sql.contactAt)-js.contactAt)<1e-10);checks++;
 }
 eq(Number(await value("select app_private.photon_race_hash('seed:2:100')")),photonRaceHash("seed:2:100"));
 const cmd="44444444-4444-4444-8444-444444444444";
 await value("select public.step_photon_race($1,$2,1)",[first.id,cmd]);eq(Number(await value("select count(*)::integer from app_private.photon_race_inputs")),0);
 await db.query("update app_private.photon_race_matches set started_at=clock_timestamp()-interval '.01 second'where id=$1",[first.id]);
 await value("select public.step_photon_race($1,$2,1)",[first.id,cmd]);
 await value("select public.step_photon_race($1,$2,1)",[first.id,cmd]);eq(Number(await value("select count(*)::integer from app_private.photon_race_inputs")),1);
 await assert.rejects(value("select public.step_photon_race($1,gen_random_uuid(),0)",[first.id]),/Invalid race move/);checks++;
 await uid(x);await assert.rejects(value("select public.get_photon_race_state($1)",[first.id]),/Owned race/);checks++;
 await assert.rejects(value("select public.step_photon_race($1,gen_random_uuid(),1)",[first.id]),/Owned race/);checks++;
 // Put the exact synthetic server fixture immediately before one real course
 // contact. The public endpoint accepts no HP or outcome argument.
 let hazard;for(let i=2;i<40;i++){const item=photonRaceItem(first.id,1,i);if(item.kind!=="needle"){hazard=item;break;}}
 assert.ok(hazard);
 await db.query("delete from app_private.photon_race_inputs where match_id=$1",[first.id]);
 await db.query("update app_private.photon_race_matches set host_hp=1,guest_hp=40,processed_until=$2,started_at=clock_timestamp()-$3*interval '1 second' where id=$1",[first.id,hazard.contactAt-.0001,hazard.contactAt+.1]);
 await db.query("insert into app_private.photon_race_inputs(match_id,user_id,command_id,at,lane)select id,host_user_id,gen_random_uuid(),started_at-interval '1 second',$2 from app_private.photon_race_matches where id=$1",[first.id,hazard.lane]);
 await uid(u);const win=parsePhotonRace(await value("select public.get_photon_race_state($1)",[first.id]));eq(win.status,"finished");eq(win.selfHp,0);eq(win.winner,true);assert.ok(win.rivalHp>0);checks++;
 const again=parsePhotonRace(await value("select public.get_photon_race_state($1)",[first.id]));eq(again.selfHp,win.selfHp);eq(again.rivalHp,win.rivalHp);eq(again.finishedAt,win.finishedAt);
 await uid(v);const loss=parsePhotonRace(await value("select public.get_photon_race_state($1)",[first.id]));eq(loss.winner,false);eq(loss.rivalHp,0);eq(loss.selfHp,win.rivalHp);
 eq(photonRaceContact(35,"needle"),36);eq(photonRaceContact(40,"needle"),40);for(const k of ["rock","car","log","spike","barrel"])eq(photonRaceContact(2,k),1);
 eq(Number(await value("select rating from public.player_ranked_1v1_stats where user_id=$1",[u])),1500);eq(Number(await value("select matches_played from public.player_ranked_1v1_stats where user_id=$1",[u])),23);
 eq(await value("select has_function_privilege('authenticated','app_private.advance_photon_race(uuid)','EXECUTE')"),false);
 eq(await value("select has_table_privilege('authenticated','app_private.photon_race_matches','UPDATE')"),false);
 eq(await value("select has_function_privilege('anon','public.join_photon_race()','EXECUTE')"),false);
 await db.exec("select set_config('test.runtime','off',false)");await assert.rejects(value("select public.get_photon_race_state($1)",[first.id]),/Runtime closed/);checks++;
 await db.exec("select set_config('test.runtime','on',false);select set_config('test.banned','true',false)");await assert.rejects(value("select public.join_photon_race()"),/Account unavailable/);checks++;
 console.log(`PASS ${checks} Photon Race WASM/source-pair checks; native/hosted/real-account cases 0`);
}finally{await db.close();}
