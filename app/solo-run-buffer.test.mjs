import test from 'node:test';
import assert from 'node:assert/strict';
import {createSoloRunBuffer}from './solo-run-buffer.ts';
const run='33333333-3333-4333-8333-333333333333';
function fixture(){
 let actor='account-a',read={runId:run,score:200,wave:1,gems:10,checkpoint:{version:1,originalKey:'runner_ace',key:'runner_ace',elapsed:0,counters:{},maxHp:1}};
 const rows=new Map(),calls=[];let handler=async(name)=>({data:name==='start_solo_run_v1'?run:{saved:true,total_gems:16},error:null});
 const storage={setItem:(k,v)=>rows.set(k,v),getItem:k=>rows.get(k)||null,removeItem:k=>rows.delete(k)};
 const make=()=>createSoloRunBuffer({rpc:async(name,args)=>{calls.push({name,args:structuredClone(args)});return handler(name,args);},owner:()=>actor,view:()=>read,storage:()=>storage});
 return {get b(){return this.buffer??=make();},make,calls,rows,read,actor:id=>actor=id,handle:f=>handler=f};
}
async function start(f){await f.b.rpc('start_progression_run');await f.b.rpc('bind_six_class_run_v1',{p_run_id:run,p_mode:'hardcore',p_character_key:'runner_ace'});await f.b.rpc('begin_mastery_session',{p_context_id:run,p_context_type:'endless',p_character_key:'runner_ace',p_trial_key:null});}
test('solo play writes only its original start receipt until the run ends',async()=>{
 const f=fixture();await start(f);
 for(let i=1;i<=20;i++){f.read.checkpoint.elapsed=i*.5;await f.b.rpc('sync_progression_run',{p_run_id:run,p_wave:1,p_active:true});await f.b.rpc('record_six_class_run_v1',{p_run_id:run,p_checkpoint:f.read.checkpoint});await f.b.rpc('credit_mastery_events',{p_session_id:run,p_batch:[{seq:i,at:i*.5,type:'frame',seconds:.5,hp:1}]});}
 await f.b.rpc('claim_player_gem',{p_context_id:run,p_pickup_id:'physical-one'});assert.deepEqual(f.calls.map(c=>c.name),['start_solo_run_v1']);
 await f.b.rpc('credit_mastery_events',{p_session_id:run,p_batch:[{seq:21,at:10,type:'run-end'}]});
 const r=await f.b.rpc('award_completed_run_v2',{p_run_id:run,p_scope:'endless',p_score:200});assert.equal(r.data.saved,true);assert.deepEqual(f.calls.map(c=>c.name),['start_solo_run_v1','settle_solo_run_v1']);assert.equal(f.calls[1].args.p_payload.mode,'hardcore');assert.equal(f.calls[1].args.p_payload.events.length,21);
 await f.b.rpc('finish_six_class_run_v1',{p_run_id:run});assert.equal(f.calls.length,2);
});
test('lost start response retries exactly the original nonce, including a fresh local client',async()=>{
 const f=fixture();f.handle(async()=>({data:null,error:{message:'response lost'}}));await f.b.rpc('start_progression_run');const nonce=f.calls[0].args.p_nonce;
 f.handle(async()=>({data:run,error:null}));const second=f.make();await second.rpc('start_progression_run');assert.equal(f.calls[1].args.p_nonce,nonce);assert(!f.rows.has('skyway-solo-results-v1:account-a:start'));
});
test('concurrent start requests share one request and one original receipt',async()=>{
 const f=fixture();let resolve;f.handle(()=>new Promise(r=>resolve=r));const a=f.b.rpc('start_progression_run'),b=f.b.rpc('start_progression_run');assert.equal(f.calls.length,1);resolve({data:run,error:null});assert.deepEqual(await a,await b);
});
test('a lost settlement response retains an identical packet across retries and reload',async()=>{
 const f=fixture();await start(f);f.read.checkpoint.elapsed=10;f.handle(async()=>({data:null,error:{message:'response unknown'}}));await f.b.rpc('award_completed_run_v2',{p_run_id:run,p_scope:'endless',p_score:200});const packet=f.calls.at(-1).args.p_payload;
 f.read.score=9000;f.handle(async()=>({data:{saved:true},error:null}));await f.make().retryPending();assert.deepEqual(f.calls.at(-1).args.p_payload,packet);
});
test('concurrent final XP and character-save calls settle only once',async()=>{
 const f=fixture();await start(f);let resolve;f.handle(()=>new Promise(r=>resolve=r));const a=f.b.rpc('award_completed_run_v2',{p_run_id:run,p_scope:'endless',p_score:200}),b=f.b.rpc('finish_six_class_run_v1',{p_run_id:run});assert.equal(f.calls.length,2);resolve({data:{saved:true},error:null});await Promise.all([a,b]);assert.equal(f.calls.length,2);
});
test('local recovery cannot submit another account’s run or hydrate its result',async()=>{
 const f=fixture();await start(f);f.handle(async()=>({data:null,error:{message:'offline'}}));await f.b.rpc('finish_six_class_run_v1',{p_run_id:run});f.actor('account-b');assert.equal(f.b.pending(),0);assert.deepEqual(await f.b.retryPending(),[]);assert.equal(f.calls.length,2);
});
test('an account change during settlement rejects the late old-account result',async()=>{
 const f=fixture();await start(f);let resolve;f.handle(()=>new Promise(r=>resolve=r));const pending=f.b.rpc('finish_six_class_run_v1',{p_run_id:run});f.actor('account-b');resolve({data:{saved:true},error:null});assert.match((await pending).error.message,/account changed/);
});
test('failed saves remain pending rather than reporting account persistence',async()=>{const f=fixture();await start(f);f.handle(async()=>{throw Error('offline')});const r=await f.b.rpc('finish_six_class_run_v1',{p_run_id:run});assert(r.error);assert.equal(f.b.pending(),1);});
test('physical pickup retries are locally idempotent and preserve streak resets',async()=>{const f=fixture();await start(f);const a=await f.b.rpc('claim_player_gem',{p_context_id:run,p_pickup_id:'one'});const b=await f.b.rpc('claim_player_gem',{p_context_id:run,p_pickup_id:'one'});assert.equal(a.data.total_gems,b.data.total_gems);assert.equal(b.data.is_new,false);await f.b.rpc('reset_endless_gem_streak',{p_run_id:run});assert.equal((await f.b.rpc('claim_player_gem',{p_context_id:run,p_pickup_id:'two'})).data.streak,1);});
test('changed or gapped mastery event retries are refused without erasing the original',async()=>{const f=fixture();await start(f);const e={seq:1,at:0,type:'run-start'};await f.b.rpc('credit_mastery_events',{p_session_id:run,p_batch:[e]});assert((await f.b.rpc('credit_mastery_events',{p_session_id:run,p_batch:[{...e,at:1}]})).error);assert((await f.b.rpc('credit_mastery_events',{p_session_id:run,p_batch:[{...e,seq:3}]})).error);});
test('transformations preserve their preceding checkpoint and final form locally',async()=>{const f=fixture();await start(f);f.b.capture();f.read.checkpoint={...f.read.checkpoint,key:'runner_stride',elapsed:5};f.b.capture();f.read.checkpoint.elapsed=10;await f.b.rpc('finish_six_class_run_v1',{p_run_id:run});assert.deepEqual(f.calls.at(-1).args.p_payload.checkpoints.map(c=>c.key),['runner_ace','runner_stride']);});
test('trials use their actual event clock and cannot inherit an older ordinary checkpoint',async()=>{const f=fixture();await start(f);await f.b.rpc('begin_mastery_session',{p_context_id:run,p_context_type:'endless',p_character_key:'runner_dash',p_trial_key:'runner_dash'});await f.b.rpc('credit_mastery_events',{p_session_id:run,p_batch:[{seq:1,at:1,type:'frame',seconds:1,hp:1}]});await f.b.rpc('finish_mastery_trial',{p_session_id:run});const p=f.calls.at(-1).args.p_payload;assert.equal(p.elapsed,1);assert.equal(p.wave,1);assert.deepEqual(p.checkpoints,[]);assert.equal(p.finishTrial,true);});
test('online and unrelated account operations keep their existing RPC path',async()=>{const f=fixture();await start(f);await f.b.rpc('credit_mastery_events',{p_session_id:'online-session',p_batch:[]});await f.b.rpc('step_photon_race',{p_match_id:'online-match'});assert.deepEqual(f.calls.slice(-2).map(c=>c.name),['credit_mastery_events','step_photon_race']);});
