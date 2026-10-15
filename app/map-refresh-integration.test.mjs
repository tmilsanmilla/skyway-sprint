import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, registerHooks } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
registerHooks({resolve(s,c,next){if(s==='./attack-delivery-rules'&&c.parentURL?.endsWith('map-refresh-runtime.ts'))return next('./attack-delivery-rules.ts',c);return next(s,c);}});
const {ruinsWaveProgress,ruinsWaveGate,mapRequestIsCurrent,shouldApplyTerminalFacing}=await import('./map-refresh-runtime.ts');
const require=createRequire(import.meta.url);
const oldTs=require.extensions['.ts'],oldTsx=require.extensions['.tsx'];
const compile=(m,f)=>m._compile(ts.transpileModule(readFileSync(f,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX},fileName:f}).outputText,f);
let LevelProgress,DuelHub,ExtractionBoxCards;
try{
 require.extensions['.ts']=compile;require.extensions['.tsx']=compile;
 ({LevelProgress}=require('./level-progress.tsx'));({DuelHub}=require('./duel-menus.tsx'));({ExtractionBoxCards}=require('./extraction-box-cards.tsx'));
}finally{
 if(oldTs)require.extensions['.ts']=oldTs;else delete require.extensions['.ts'];
 if(oldTsx)require.extensions['.tsx']=oldTsx;else delete require.extensions['.tsx'];
}
const render=(component,props)=>renderToStaticMarkup(React.createElement(component,props));
const noop=()=>{};
test('actual LevelProgress shows95/800 accessible XP, sanitizes invalid input and never shows a formula',()=>{
 const html=render(LevelProgress,{level:4,xp:95,required:800});
 assert.match(html,/95 \/ 800 XP/);assert.match(html,/aria-valuenow="95"/);assert.match(html,/aria-valuemax="800"/);assert.match(html,/width:11.875%/);
 const invalid=render(LevelProgress,{level:0,xp:NaN,required:0});assert.doesNotMatch(invalid,/NaN|Infinity/);assert.match(invalid,/0 \/ 1 XP/);
});
test('actual Casual hub requires level5 free while already-purchased Ranked remains playable',()=>{
 const props={special:false,mode:'casual',activeMode:'rng',nextRotation:0,level:4,guest:false,rankedUnlocked:false,rankedPurchased:false,gems:0,busy:false,searching:false,unlocking:false,status:'',arenas:[],attacks:[],leaders:[],leadersError:'',leadersLoading:false,onMode:noop,onFind:noop,onCancel:noop,onUnlock:noop,onRefresh:noop,onUpdates:noop};
 const locked=render(DuelHub,props);assert.match(locked,/LEVEL 5 · NO GEM COST/);assert.match(locked,/class="versus-primary" disabled=""/);
 const open=render(DuelHub,{...props,level:5});assert.doesNotMatch(open,/class="versus-primary" disabled/);
 const paid=render(DuelHub,{...props,mode:'ranked',level:0,rankedUnlocked:true,rankedPurchased:true});assert.doesNotMatch(paid,/class="versus-primary" disabled/);
});
test('actual extraction quantity controls cap at99 and show new category odds',()=>{
 const html=render(ExtractionBoxCards,{level:40,gems:100000,busy:false,quantities:{normal:100,rare:100,legendary:100},extracting:null,setQuantities:noop,onOpen:noop});
 assert.equal((html.match(/max="99"/g)||[]).length,3);assert.equal((html.match(/value="99"/g)||[]).length,3);
 for(const n of [7,13,18,20])assert.ok(html.includes(`${n}% CHARACTER`));
});
test('an occupied lane can delay a Pumpkin without forcing an unreachable miss',()=>{
 assert.equal(ruinsWaveProgress(2300,1,false),2249);assert.equal(ruinsWaveProgress(3000,1,false),2249);
 assert.equal(ruinsWaveProgress(2300,1,true),2300);assert.equal(ruinsWaveProgress(5000,2,false),4499);
 const page=readFileSync(new URL('./page.tsx',import.meta.url),'utf8');
 assert.doesNotMatch(page,/recordRuinsPumpkin\(completedWave, false\)/);
 assert.match(page,/pumpkinPendingRef.current.set\(pumpkinWave, collected\)/);
 assert.match(page,/setInterval\(\(\) => void syncRuinsPumpkins\(\), 2000\)/);
 assert.match(page,/RETRY XP SAVE/);
 const award=page.slice(page.indexOf('const awardUserId = userIdRef.current;'),page.indexOf('const pendingAward = awardRun()'));
 assert.match(award,/const finalScore = Math.max\(0, Math.floor\(scoreRef.current\)\)/);
 assert.equal((award.match(/p_score: finalScore/g)||[]).length,2,'both save routes use the captured final result');
 assert.match(award,/p_wave: finalWave/);
 assert.match(award,/if \(progressionRunIdRef.current === runId\) setRunXpTotal/);
});
test('Ruins waits for the exact receipt acknowledgement without adding a coin-sync phase',()=>{
 assert.deepEqual(ruinsWaveGate(2300,1,false,true,0,false),{progress:2249,waitForReceipt:false},'no timer-forced miss before physical opportunity');
 assert.deepEqual(ruinsWaveGate(2300,1,true,true,0,true),{progress:2249,waitForReceipt:true},'a local collection is not a server acknowledgement');
 assert.deepEqual(ruinsWaveGate(2300,1,true,true,1,true),{progress:2249,waitForReceipt:true},'polling the highest wave cannot acknowledge a specific pending value');
 assert.deepEqual(ruinsWaveGate(2300,1,true,true,1,false),{progress:2300,waitForReceipt:false},'accepted receipt releases boundary');
 assert.deepEqual(ruinsWaveGate(2300,1,true,false,0,false),{progress:2300,waitForReceipt:false},'practice does not require a network receipt');
 const page=readFileSync(new URL('./page.tsx',import.meta.url),'utf8');
 assert.match(page,/needsPumpkinOutcome = activeMapId === "ruins" &&\s*!pumpkinOutcomesRef.current.has\(wave\) && pumpkinServerWaveRef.current < wave/);
 assert.match(page,/if \(gate.waitForReceipt\) \{[\s\S]*?setPaused\(true\)/);
 assert.match(page,/if \(activeMapId === "ruins" && pumpkinPendingRef.current.size > 0\) return/);
 const snapshot=page.slice(page.indexOf('const applyRuinsPumpkinSnapshot'),page.indexOf('const syncRuinsPumpkins'));
 assert.doesNotMatch(snapshot,/pumpkinPendingRef.current.delete/);
 assert.doesNotMatch(page,/setVersusPhase\("syncing.*coins/i);
});
test('Terminal stale polls cannot undo a newer face input and Q blocks later direction changes',()=>{
 assert.equal(shouldApplyTerminalFacing(0),true,'initial hydration restores persisted direction');
 assert.equal(shouldApplyTerminalFacing(1),false,'unversioned poll cannot overwrite local intent');
 assert.equal(shouldApplyTerminalFacing(2,1),false,'older command acknowledgement is ignored');
 assert.equal(shouldApplyTerminalFacing(2,2),true,'latest command acknowledgement accepted');
 const page=readFileSync(new URL('./page.tsx',import.meta.url),'utf8');
 const facing=page.slice(page.indexOf('const changeTerminalFacing'),page.indexOf('const releaseRuinsBoundary'));
 assert.match(facing,/state.current.wavePause \|\| terminalSwordBusyRef.current/);
 const sword=page.slice(page.indexOf('const triggerTerminalSword'),page.indexOf('const triggerPitchKatana'));
 assert.ok(sword.indexOf('terminalSwordBusyRef.current = true')<sword.indexOf('await terminalPositionQueueRef.current'));
 assert.ok(sword.indexOf('await terminalPositionQueueRef.current')<sword.indexOf('supabase.rpc("use_1v1_terminal_sword"'));
 assert.match(page,/disabled=\{!running \|\| paused \|\| wavePause \|\| terminalSwordBusyRef.current\}/);
});
test('queued map actions are bound to the original account, auth generation and match',()=>{
 const request={userId:'account-a',generation:4,matchId:'match-a'};
 const current={...request,sessionUserId:'account-a'};
 assert.equal(mapRequestIsCurrent(request,current),true);
 for(const change of [{userId:'account-b',sessionUserId:'account-b'},{generation:5},{matchId:'match-b'},{sessionUserId:'account-b'},{userId:null}])
  assert.equal(mapRequestIsCurrent(request,{...current,...change}),false);
 const page=readFileSync(new URL('./page.tsx',import.meta.url),'utf8');
 for(const [start,end] of [['const changeTerminalFacing','const releaseRuinsBoundary'],['const syncRuinsPumpkins','const recordRuinsPumpkin']]){
  const action=page.slice(page.indexOf(start),page.indexOf(end));
  assert.match(action,/generation: authSessionGenerationRef.current/);
  assert.match(action,/sessionUserId: authSessionUserIdRef.current/);
  assert.ok((action.match(/if \(!isCurrent\(\)\) return/g)||[]).length>=2,'context is checked before RPC and after awaits');
 }
 assert.match(page,/invalidateMapRefreshRequests\(\);\s*mapRefreshIdentityRef.current = next/);
});
test('actual wave healing and practice opponent use shared map-health and paid-armory rules',()=>{
 const page=readFileSync(new URL('./page.tsx',import.meta.url),'utf8');
 assert.match(page,/state.current.hearts \+ getAllowedHealing\(activeMapId, healAmount\)/);
 assert.match(page,/planBotAttackPurchases\(activeMapId, botBudgetBefore, attackLimit\)/);
 assert.doesNotMatch(page,/attack.cost <= botBudget|botBudget -= chosen.cost/);
});
test('both leaderboards retain signed-only and ban-filtered server boundaries',()=>{
 const sql=readFileSync(new URL('../neon/map-refresh-leaderboards.sql',import.meta.url),'utf8');
 assert.match(sql,/auth.uid\(\) is not null/);assert.match(sql,/app_private.is_leaderboard_visible/);
 assert.match(sql,/from public,anon,anonymous/);assert.match(sql,/to authenticated/);
 assert.doesNotMatch(sql,/grant.*(?:insert|update|delete|all tables)|set high_score|set rating/i);
 const page=readFileSync(new URL('./page.tsx',import.meta.url),'utf8');assert.match(page,/leadersError/);assert.match(page,/requestUserId !== userIdRef.current/);
});
