import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as masteryRules from './mastery-rules.ts';

/** Deterministic hook fixture, not a browser or production authentication test. */
function fixture(rpc){
 const cells=[];let index=0,layouts=[],effects=[],writes=0;
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
 const effect=(fn,deps,layout)=>{const i=index++,old=cells[i];if(old&&same(old.deps,deps))return;cells[i]={deps};(layout?layouts:effects).push(()=>{old?.cleanup?.();cells[i].cleanup=fn();});};
 const react={
  useRef(value){const i=index++;return cells[i]??=( {current:value});},
  useState(initial){const i=index++;if(!(i in cells))cells[i]=typeof initial==='function'?initial():initial;return[cells[i],value=>{writes++;cells[i]=typeof value==='function'?value(cells[i]):value;}];},
  useCallback(fn,deps){const i=index++,old=cells[i];if(old&&same(old.deps,deps))return old.fn;cells[i]={fn,deps};return fn;},
  useLayoutEffect(fn,deps){effect(fn,deps,true);},useEffect(fn,deps){effect(fn,deps,false);},
 };
 const compiled=ts.transpileModule(readFileSync(new URL('./use-masteries.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const exports={};const intervals=new Set();
 const require=name=>name==='react'?react:name==='./skyway-client'?{supabase:{rpc}}:name==='./mastery-rules'?masteryRules:(()=>{throw new Error(name);})();
 vm.runInNewContext(compiled,{exports,require,Promise,Error,Number,Math,window:{setInterval(fn){intervals.add(fn);return fn;},clearInterval(fn){intervals.delete(fn);}}});
 return{render(uid,{commit=true}={}){index=0;layouts=[];effects=[];const result=exports.useMasteries(uid);if(commit){for(const fn of layouts)fn();for(const fn of effects)fn();}return result;},intervals,get writes(){return writes;},pulse(){for(const fn of intervals)fn();}};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const profile=n=>({data:{active:null,quests:{},photons:n},error:null});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};

test('failed or thrown batches retry exact sequence/time before newer events; only one request in flight',async()=>{
 const held=deferred(),calls=[];let attempt=0;
 const f=fixture(async(name,args)=>{
  if(name==='get_mastery_profile')return profile(8);
  if(name==='begin_mastery_session')return{data:'session-A',error:null};
  if(name==='credit_mastery_events'){calls.push(structuredClone(args));if(++attempt===1)return held.promise;return profile(8);}
  throw new Error(name);
 });
 let hook=f.render('A');await tick();hook=f.render('A');await hook.begin('run-A','endless','runner_dash');
 hook.record({type:'frame',seconds:.5,hp:3});hook.record({type:'dash'});
 const first=hook.flush();hook.record({type:'lane-change'});const second=hook.flush();
 assert.equal(calls.length,1);held.reject(new Error('network lost'));
 assert.equal(await first,false);assert.equal(await second,false);
 assert.equal(await hook.flush(),true);assert.equal(calls.length,2);
 assert.deepEqual(calls[1].p_batch.map(e=>e.seq),[1,2,3]);assert.deepEqual(calls[1].p_batch.slice(0,2),calls[0].p_batch);
});

test('finish drains more than100 events and never finalizes after a failed pending batch',async()=>{
 const calls=[];let fail=true,finishes=0;
 const f=fixture(async(name,args)=>{
  if(name==='get_mastery_profile')return profile(5);
  if(name==='begin_mastery_session')return{data:'trial-A',error:null};
  if(name==='credit_mastery_events'){calls.push(structuredClone(args.p_batch));if(fail)return{data:null,error:{message:'offline'}};return profile(5);}
  if(name==='finish_mastery_trial'){finishes++;return profile(5);}
  throw new Error(name);
 });
 const hook=f.render('A');await tick();await hook.begin('run-A','endless','runner_dash','runner_dash');
 for(let i=0;i<251;i++)hook.record({type:'frame',seconds:.1,hp:3});
 assert.equal(await hook.finish(),false);assert.equal(finishes,0);fail=false;
 assert.equal(await hook.finish(),true);assert.equal(finishes,1);
 assert.deepEqual(calls.slice(1).map(b=>b.length),[100,100,51]);
 assert.deepEqual(calls[1],calls[0]);
});

test('end records one run-end, drains it, and no later events survive the ended session',async()=>{
 const batches=[];let fail=true;
 const f=fixture(async(name,args)=>{
  if(name==='get_mastery_profile')return profile(2);
  if(name==='begin_mastery_session')return{data:'run-A',error:null};
  if(name==='credit_mastery_events'){batches.push(structuredClone(args.p_batch));return fail?{error:{message:'offline'}}:profile(2);}
  throw new Error(name);
 });
 const hook=f.render('A');await tick();await hook.begin('run','endless','runner_dash');hook.record({type:'dash'});
 assert.equal(await hook.end(),false);hook.record({type:'dash'});fail=false;assert.equal(await hook.end(),true);
 assert.equal(batches[1].filter(e=>e.type==='run-end').length,1);assert.equal(batches[1].length,2);
 hook.record({type:'dash'});await hook.flush();assert.equal(batches.length,2);
});

test('account changes mask prior profile immediately and discard late responses/failed queues',async()=>{
 const held=deferred(),refreshB=deferred(),calls=[];
 const f=fixture(async(name,args)=>{
  if(name==='get_mastery_profile')return calls.includes('B')?refreshB.promise:profile(55);
  if(name==='begin_mastery_session')return{data:'run-A',error:null};
  if(name==='credit_mastery_events'){calls.push(args);return held.promise;}
  throw new Error(name);
 });
 let hook=f.render('A');await tick();hook=f.render('A');assert.equal(hook.photons,55);
 await hook.begin('run','endless','runner_dash');hook.record({type:'dash'});const flight=hook.flush();
 calls.push('B');hook=f.render('B');assert.equal(hook.photons,0);assert.deepEqual(JSON.parse(JSON.stringify(hook.account)),{active:null,quests:{}});
 held.reject(new Error('late failure'));assert.equal(await flight,false);refreshB.resolve(profile(7));await tick();hook=f.render('B');assert.equal(hook.photons,7);
 await hook.flush();assert.equal(calls.filter(c=>typeof c==='object').length,1);
 assert.equal(f.intervals.size,1);
});

test('same-user begin races cannot install an older session and commands are stable across rerenders',async()=>{
 const first=deferred(),second=deferred(),batches=[];let begins=0;
 const f=fixture(async(name,args)=>{
  if(name==='get_mastery_profile')return profile(1);
  if(name==='begin_mastery_session')return++begins===1?first.promise:second.promise;
  if(name==='credit_mastery_events'){batches.push(args);return profile(1);}
  throw new Error(name);
 });
 let hook=f.render('A');await tick();const oldEquip=hook.equip;hook=f.render('A');assert.equal(hook.equip,oldEquip);
 const a=hook.begin('old','endless','runner_dash');const b=hook.begin('new','endless','runner_dash');second.resolve({data:'new-session',error:null});assert.equal(await b,'new-session');
 first.resolve({data:'old-session',error:null});assert.equal(await a,null);hook.record({type:'dash'});await hook.flush();assert.equal(batches[0].p_session_id,'new-session');
});

test('ending during a pending begin prevents that session from reopening after exit',async()=>{
 const held=deferred(),batches=[];
 const f=fixture(async(name,args)=>{
  if(name==='get_mastery_profile')return profile(1);
  if(name==='begin_mastery_session')return held.promise;
  if(name==='credit_mastery_events'){batches.push(args);return profile(1);}
  throw new Error(name);
 });
 const hook=f.render('A');await tick();const begin=hook.begin('run','endless','runner_dash');assert.equal(await hook.end(),true);
 held.resolve({data:'late-session',error:null});assert.equal(await begin,null);hook.record({type:'dash'});assert.equal(await hook.flush(),true);assert.equal(batches.length,0);
});
test('green Dash proof metadata survives the receipt queue unchanged without changing ordinary blocks',async()=>{
 const batches=[];
 const f=fixture(async(name,args)=>{
  if(name==='get_mastery_profile')return profile(1);
  if(name==='begin_mastery_session')return{data:'run-A',error:null};
  if(name==='credit_mastery_events'){batches.push(args.p_batch);return profile(1);}
  throw new Error(name);
 });
 const hook=f.render('A');await tick();await hook.begin('run','1v1','runner_dash');
 hook.record({type:'block',source:'dash',green:true,event_id:'green:run-A:17'});
 hook.record({type:'block',source:'dash'});await hook.flush();
 assert.equal(batches[0][0].green,true);assert.equal(batches[0][0].event_id,'green:run-A:17');
 assert.equal(Object.hasOwn(batches[0][1],'green'),false);assert.equal(Object.hasOwn(batches[0][1],'event_id'),false);
});
test('rejoining a committed context continues its server sequence and active clock',async()=>{
 const batches=[];
 const f=fixture(async(name,args)=>{
  if(name==='get_mastery_profile')return profile(1);
  if(name==='begin_mastery_session')return{data:{session_id:'existing-session',last_seq:40,last_at:20},error:null};
  if(name==='credit_mastery_events'){batches.push(args.p_batch);return profile(1);}
  throw new Error(name);
 });
 const hook=f.render('A');await tick();assert.equal(await hook.begin('run','1v1','runner_dash'),'existing-session');
 hook.record({type:'frame',seconds:.5,hp:3});await hook.flush();
 assert.equal(batches[0][0].seq,41);assert.equal(batches[0][0].at,20.5);
});
test('invalid resumed sequence or clock is rejected before installing a queue',async()=>{
 for(const metadata of [{last_seq:-1,last_at:20},{last_seq:1.5,last_at:20},{last_seq:1,last_at:-1},{last_seq:1,last_at:21_601},{last_seq:null,last_at:0}]){
  const batches=[];
  const f=fixture(async(name,args)=>{
   if(name==='get_mastery_profile')return profile(1);
   if(name==='begin_mastery_session')return{data:{session_id:'invalid',...metadata},error:null};
   if(name==='credit_mastery_events'){batches.push(args);return profile(1);}
   throw new Error(name);
  });
  const hook=f.render('A');await tick();assert.equal(await hook.begin('run','1v1','runner_dash'),null);
  hook.record({type:'dash'});await hook.flush();assert.equal(batches.length,0);
 }
});
const dashAccount=n=>({active:'runner_dash',quests:{runner_dash:{quest:0,progress:[n],complete:false,mastered:false,masteryEnabled:false,flairRewriteEnabled:false}}});
const withAccount=account=>({data:{...account,photons:10},error:null});
test('actual hook previews events on its250ms pulse, not every frame, then acknowledges only the saved batch and retains its newer tail',async()=>{
 const first=deferred(),second=deferred();let credits=0;
 const f=fixture(async name=>{
  if(name==='get_mastery_profile')return withAccount(dashAccount(5));
  if(name==='begin_mastery_session')return{data:{session_id:'run',profile:dashAccount(5)},error:null};
  if(name==='credit_mastery_events')return++credits===1?first.promise:second.promise;
  throw new Error(name);
 });
 let hook=f.render('A');await tick();hook=f.render('A');await hook.begin('run','endless','runner_dash');hook=f.render('A');
 const before=f.writes;for(let i=0;i<100;i++)hook.record({type:'frame',seconds:.01,hp:3});
 for(let i=0;i<3;i++)hook.record({type:'dash'});assert.equal(f.writes,before,'Recording never directly schedules React state');
 f.pulse();hook=f.render('A');assert.equal(hook.account.quests.runner_dash.progress[0],5);assert.equal(hook.liveAccount.quests.runner_dash.progress[0],8);assert.equal(hook.syncStatus,'pending');
 // Remove the frame-only prefix in the first two server batches; these carry
 // the same saved quest baseline, not any double-applied dash progress.
 first.resolve(withAccount(dashAccount(5)));second.resolve(withAccount(dashAccount(8)));await hook.flush();hook=f.render('A');
 assert.equal(hook.liveAccount.quests.runner_dash.progress[0],8);assert.equal(hook.pendingEvents,0);assert.equal(hook.syncStatus,'saved');
});
test('a saved batch never double counts the in-flight local preview or newer queued event',async()=>{
 const first=deferred(),second=deferred();let credits=0;
 const f=fixture(async name=>{
  if(name==='get_mastery_profile')return withAccount(dashAccount(5));
  if(name==='begin_mastery_session')return{data:{session_id:'run',profile:dashAccount(5)},error:null};
  if(name==='credit_mastery_events')return++credits===1?first.promise:second.promise;
  throw new Error(name);
 });
 let hook=f.render('A');await tick();hook=f.render('A');await hook.begin('run','endless','runner_dash');
 for(let i=0;i<3;i++)hook.record({type:'dash'});const flight=hook.flush();hook.record({type:'dash'});f.pulse();hook=f.render('A');
 assert.equal(hook.liveAccount.quests.runner_dash.progress[0],9);assert.equal(hook.syncStatus,'syncing');
 first.resolve(withAccount(dashAccount(8)));await tick();hook=f.render('A');assert.equal(hook.account.quests.runner_dash.progress[0],8);assert.equal(hook.liveAccount.quests.runner_dash.progress[0],9);
 second.resolve(withAccount(dashAccount(9)));assert.equal(await flight,true);hook=f.render('A');assert.equal(hook.liveAccount.quests.runner_dash.progress[0],9);assert.equal(hook.syncStatus,'saved');
});
test('failed save keeps its live preview marked retrying until an actual acknowledgment, and account changes mask it',async()=>{
 let fail=true;
 const f=fixture(async name=>{
  if(name==='get_mastery_profile')return withAccount(dashAccount(5));
  if(name==='begin_mastery_session')return{data:{session_id:'run',profile:dashAccount(5)},error:null};
  if(name==='credit_mastery_events')return fail?{data:null,error:{message:'offline'}}:withAccount(dashAccount(6));
  throw new Error(name);
 });
 let hook=f.render('A');await tick();hook=f.render('A');await hook.begin('run','endless','runner_dash');hook.record({type:'dash'});await hook.flush();hook=f.render('A');
 assert.equal(hook.syncStatus,'retrying');assert.equal(hook.account.quests.runner_dash.progress[0],5);assert.equal(hook.liveAccount.quests.runner_dash.progress[0],6);
 fail=false;await hook.flush();hook=f.render('A');assert.equal(hook.syncStatus,'saved');assert.equal(hook.error,'');assert.equal(hook.account.quests.runner_dash.progress[0],6);
 hook.record({type:'dash'});f.pulse();hook=f.render('A');assert.equal(hook.liveAccount.quests.runner_dash.progress[0],7);
 hook=f.render('B');assert.equal(hook.syncStatus,'idle');assert.equal(hook.liveAccount.active,null);assert.equal(hook.pendingEvents,0);
});
test('server-identified replay finishes without changing disabled mastery/flair switches or projecting trial events into quests',async()=>{
 const account={active:null,quests:{runner_dash:{quest:3,progress:[75],complete:true,mastered:true,masteryEnabled:false,flairRewriteEnabled:false}}};let finishes=0;
 const f=fixture(async name=>{
  if(name==='get_mastery_profile')return withAccount(account);
  if(name==='begin_mastery_session')return{data:{session_id:'replay',profile:account,trial_replay:true},error:null};
  if(name==='credit_mastery_events')return withAccount(account);
  if(name==='finish_mastery_trial'){finishes++;return{data:{...account,trial_replay:true},error:null};}
  throw new Error(name);
 });
 let hook=f.render('A');await tick();hook=f.render('A');await hook.begin('run','endless','runner_dash','runner_dash');hook=f.render('A');assert.equal(hook.trialReplay,true);
 hook.record({type:'dash'});hook.record({type:'frame',seconds:.5,hp:3});f.pulse();hook=f.render('A');assert.equal(hook.liveAccount.quests.runner_dash.masteryEnabled,false);
 assert.equal(await hook.finish(),true);hook=f.render('A');assert.equal(finishes,1);assert.equal(hook.account.quests.runner_dash.mastered,true);assert.equal(hook.account.quests.runner_dash.masteryEnabled,false);assert.equal(hook.account.quests.runner_dash.flairRewriteEnabled,false);assert.equal(hook.trialReplay,true);
});
test('already-mastered trial cannot start against an old backend without its explicit replay receipt',async()=>{
 const account={active:null,quests:{runner_dash:{quest:3,progress:[75],complete:true,mastered:true,masteryEnabled:false,flairRewriteEnabled:false}}};let finishes=0;
 const f=fixture(async name=>{
  if(name==='get_mastery_profile')return withAccount(account);
  if(name==='begin_mastery_session')return{data:{session_id:'old-trial',profile:account},error:null};
  if(name==='finish_mastery_trial'){finishes++;return withAccount(account);}
  throw new Error(name);
 });
 let hook=f.render('A');await tick();hook=f.render('A');assert.equal(await hook.begin('run','endless','runner_dash','runner_dash'),null);
 hook=f.render('A');assert.match(hook.error,/Trial replay is not ready/);assert.equal(await hook.finish(),false);assert.equal(finishes,0);
});
test('late initial profile cannot overwrite a newer saved receipt acknowledgment',async()=>{
 const initial=deferred();
 const f=fixture(async name=>{
  if(name==='get_mastery_profile')return initial.promise;
  if(name==='begin_mastery_session')return{data:{session_id:'run',profile:dashAccount(5)},error:null};
  if(name==='credit_mastery_events')return withAccount(dashAccount(6));
  throw new Error(name);
 });
 let hook=f.render('A');await hook.begin('run','endless','runner_dash');hook.record({type:'dash'});await hook.flush();
 initial.resolve(withAccount(dashAccount(0)));await tick();hook=f.render('A');
 assert.equal(hook.account.quests.runner_dash.progress[0],6);assert.equal(hook.liveAccount.quests.runner_dash.progress[0],6);
});
test('only the newest outstanding refresh applies, while a fresh authoritative reset is allowed to decrease progress',async()=>{
 const older=deferred(),newer=deferred();let reads=0;
 const f=fixture(async name=>{
  assert.equal(name,'get_mastery_profile');reads++;
  return reads===1?withAccount(dashAccount(5)):reads===2?older.promise:reads===3?newer.promise:withAccount(dashAccount(0));
 });
 let hook=f.render('A');await tick();hook=f.render('A');const first=hook.refresh(),second=hook.refresh();
 newer.resolve(withAccount(dashAccount(7)));await second;older.resolve(withAccount(dashAccount(1)));await first;hook=f.render('A');assert.equal(hook.account.quests.runner_dash.progress[0],7);
 await hook.refresh();hook=f.render('A');assert.equal(hook.account.quests.runner_dash.progress[0],0,'Do not latch maximum counts: authoritative hit/reset/revocation may reduce them');
});
