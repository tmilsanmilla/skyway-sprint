/** Empty, local WASM Postgres only. Actual installed progression, mastery and
 * reward implementations execute; no connection strings or user rows loaded. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {trackFieldFixture}from './track-field-test-fixture.mjs';
const db=await trackFieldFixture(),u='11111111-1111-4111-8111-111111111111',x='22222222-2222-4222-8222-222222222222';
let checks=0;const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};
const v=async(sql,args)=>Object.values((await db.query(sql,args)).rows[0])[0];
const refuse=async(sql,args,pattern)=>{await assert.rejects(v(sql,args),pattern);checks++;};
const one=fs.readFileSync(new URL('./track-field-01-account-catalog.sql',import.meta.url),'utf8'),two=fs.readFileSync(new URL('./track-field-02-post-run.sql',import.meta.url),'utf8');
const start=async(seconds=10)=>{const id=await v('select public.start_solo_run_v1(gen_random_uuid())');await db.query("update public.player_progression_runs set started_at=clock_timestamp()-$2*interval '1 second'where run_id=$1",[id,seconds+1]);return id;};
const payload=(key='runner_ace',seconds=10)=>({version:1,character:key,mode:'normal',elapsed:seconds,score:10000,wave:1+Math.floor(seconds/15),checkpoints:[{version:1,originalKey:key,key,elapsed:seconds,counters:{},maxHp:3}],actions:[],events:[{seq:1,at:0,type:'run-start'},{seq:2,at:seconds,type:'run-end'}],trial:null,finishTrial:false});
const settle=(id,p)=>v('select public.settle_solo_run_v1($1,$2)',[id,p]);
try{
 await db.exec(`insert into app_private.photon_race_entitlements(user_id)values('${u}');insert into public.ranked_1v1_seasons(id,name,is_active)values(1,'Historical',true);insert into public.player_ranked_1v1_stats(season_id,user_id,rating,matches_played,wins,losses)values(1,'${u}',1750,10,6,4);`);
 await db.exec(one);await db.exec(two);checks+=2;
 eq(Number(await v('select photons from public.player_photon_fury where user_id=$1',[u])),2100);
 eq(Number(await v('select count(*)from app_private.photon_race_entitlements')),0);
 eq(Number(await v('select rating from public.player_ranked_1v1_stats s join public.ranked_1v1_seasons season on season.id=s.season_id where user_id=$1 and season.is_active',[u])),1500);
 eq(Number(await v('select wins from public.player_ranked_1v1_stats where user_id=$1 and season_id=1',[u])),6);
 await db.exec(one);await db.exec(two);checks+=2;
 eq(Number(await v('select photons from public.player_photon_fury where user_id=$1',[u])),2100);
 eq(Number(await v('select count(*)from public.ranked_1v1_seasons')),2);
 eq(await v("select character_class||':'||rarity from app_private.six_class_catalog where item_key='trickster_jester'"),'trickster:rare');
 eq(await v("select rarity from app_private.six_class_catalog where item_key='runner_flare'"),'epic');
 eq(Number(await v("select count(*)from app_private.photon_qol_catalog()where kind='skin'")),176);
 eq(Number(await v("select count(*)from app_private.photon_qol_catalog()where kind='theme'")),54);
 const themes=(await db.query("select rarity,count(*)::int as n from app_private.photon_qol_catalog()where kind='theme'group by rarity")).rows;eq(themes.every(r=>r.n===9),true);
 eq((await db.query("select character_key,count(*)::int as n from app_private.photon_qol_catalog()where kind='skin'group by character_key")).rows.every(r=>r.n===11),true);
 eq(await v("select cardinality(profiles)from app_private.booster_box_rules('normal')"),14);eq(await v("select cardinality(profiles)from app_private.booster_box_rules('rare')"),16);eq(await v("select cardinality(profiles)from app_private.booster_box_rules('legendary')"),18);
 const native=await v('select app_private.pixel_native_admission($1)',[u]);eq(native,true);
 await db.query('update neon_auth."user"set banned=true where id=$1',[u]);eq(await v('select app_private.pixel_native_admission($1)',[u]),false);await db.query('update neon_auth."user"set banned=false where id=$1',[u]);
 await db.query("select set_config('test.claims',$1,false)",[JSON.stringify({sub:u,iss:'https://skyway-sprint.vercel.app/api/pixel-pulse',skyway_auth:'pixel'})]);eq(await v('select app_private.pixel_runtime_admitted()'),false);
 await db.query("select set_config('test.claims',$1,false)",[JSON.stringify({sub:u,iss:'https://ep-tiny-tooth-ax0800jo.neonauth.c-4.us-east-2.aws.neon.tech'})]);
 const nonce='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';const id=await v('select public.start_solo_run_v1($1)',[nonce]);eq(await v('select public.start_solo_run_v1($1)',[nonce]),id);
 // A run is visible only as an uncredited original start receipt before play.
 eq(Number(await v("select count(*)from public.player_progression_events where source='run'and source_key=$1",[id])),0);
 await db.exec("update public.player_stats set lifetime_xp=850,xp_in_level=450,level=1,stardust=2000");
 const normal=await start(200),p=payload('runner_ace',200);
 p.actions=[0,1,2,3,4].map(i=>({kind:'gem',id:'physical-'+i,at:10+i*2,wave:1}));
 const before=Number(await v('select total_gems from public.player_stats where user_id=$1',[u]));
 const result=await settle(normal,p);eq(result.saved,true);assert(result.level>1,'Actual XP implementation must advance levels');checks++;
 eq(Number(await v('select total_gems from public.player_stats where user_id=$1',[u])),before+15);
 const after=Number(await v('select lifetime_xp from public.player_stats where user_id=$1',[u]));
 eq((await settle(normal,p)).already_completed,true);eq(Number(await v('select lifetime_xp from public.player_stats where user_id=$1',[u])),after);
 await refuse('select public.settle_solo_run_v1($1,$2)',[normal,{...p,score:9999}],/cannot change/);
 await db.query("select set_config('test.uid',$1,false)",[x]);await db.query("select set_config('test.claims',$1,false)",[JSON.stringify({sub:x,iss:'https://ep-tiny-tooth-ax0800jo.neonauth.c-4.us-east-2.aws.neon.tech'})]);await refuse('select public.settle_solo_run_v1($1,$2)',[normal,p],/Original owned/);
 await db.query("select set_config('test.uid',$1,false)",[u]);await db.query("select set_config('test.claims',$1,false)",[JSON.stringify({sub:u,iss:'https://ep-tiny-tooth-ax0800jo.neonauth.c-4.us-east-2.aws.neon.tech'})]);
 const bad=await start(10);await refuse('select public.settle_solo_run_v1($1,$2)',[bad,payload('runner_ace',100)],/original time bounds/);
 const burst=await start(10),burstPayload=payload();burstPayload.actions=Array.from({length:4},(_,i)=>({kind:'gem',id:'burst'+i,at:5+i/10,wave:1}));await refuse('select public.settle_solo_run_v1($1,$2)',[burst,burstPayload],/Physical pickups/);eq(Number(await v("select count(*)from public.player_progression_events where metadata->>'context_id'=$1",[burst])),0);
 const hard=await start(),hardPayload=payload();hardPayload.mode='hardcore';hardPayload.checkpoints[0].maxHp=1;eq((await settle(hard,hardPayload)).saved,true);eq(await v('select run_mode from app_private.six_class_runs where run_id=$1',[hard]),'hardcore');
 const quests=await start(10);await db.exec(`insert into public.player_unlocks(user_id,item_key,item_type,rarity)values('${u}','runner_stride','character','common')on conflict do nothing;insert into app_private.player_mastery_quests(user_id,character_key,quest)values('${u}','runner_stride',0)on conflict(user_id,character_key)do update set quest=0,progress=0;`);
 const q=payload('runner_stride');q.events=[{seq:1,at:0,type:'run-start'},{seq:2,at:1,type:'lane-change'},{seq:3,at:2,type:'lane-change'},{seq:4,at:10,type:'run-end'}];await settle(quests,q);eq(Number(await v("select progress from app_private.player_mastery_quests where user_id=$1 and character_key='runner_stride'",[u])),2);

 const trialRun=await start(5),trialPayload=payload('runner_dash',5);trialPayload.trial='runner_dash';trialPayload.checkpoints=[];trialPayload.actions=[];trialPayload.score=0;trialPayload.wave=1;trialPayload.events=[{seq:1,at:0,type:'run-start'},{seq:2,at:.5,type:'frame',seconds:.5,hp:3},{seq:3,at:.5,type:'trial-special',action:'miss'},{seq:4,at:.5,type:'run-end'}];
 await db.exec(`insert into public.player_unlocks(user_id,item_key,item_type,rarity)values('${u}','runner_dash','character','common')on conflict do nothing;insert into app_private.player_mastery_quests(user_id,character_key,quest)values('${u}','runner_dash',3)on conflict(user_id,character_key)do update set quest=3;`);
 const trialResult=await settle(trialRun,trialPayload);eq(trialResult.xp_awarded,0);eq(await v("select mastered from app_private.player_mastery_quests where user_id=$1 and character_key='runner_dash'",[u]),false);eq(await v('select trial_failed from app_private.mastery_sessions where context_id=$1',[trialRun]),true);
 eq(await v("select has_function_privilege('anonymous','public.settle_solo_run_v1(uuid,jsonb)','execute')"),false);eq(await v("select has_table_privilege('authenticated','app_private.solo_run_receipts','update')"),false);
 console.log(`PASS ${checks} actual SQL account/catalog/refund/ranked/post-run/XP/mastery/idempotency checks in empty WASM database; native/hosted executions 0`);
}catch(error){console.error({message:error.message,where:error.where,detail:error.detail});process.exitCode=1;}finally{await db.close();}
