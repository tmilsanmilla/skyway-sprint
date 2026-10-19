import test from 'node:test';
import assert from 'node:assert/strict';
import * as m from './mastery-rules.ts';
const bought = key => m.purchaseMasteryQuest(m.emptyMasteryAccount(),key,1000,true).state;
const step = (s,key,type,fields={}) => m.reduceMasteryQuest(s,key,{type,...fields});
const repeat = (s,key,type,n,fields={}) => {for(let i=0;i<n;i++)s=step(s,key,type,fields);return s;};
const startTrial = key => m.reduceMasteryTrial(m.createMasteryTrial(key),{type:'accept'}).state;
const frames = (s,n,hp=1) => {for(let i=0;i<n;i++)s=m.reduceMasteryTrial(s,{type:'frame',seconds:1,hp}).state;return s;};
test('all eight exact costs and sequential three quests, only one active globally',()=>{
 assert.deepEqual(m.MASTERIES.map(x=>x.price),[200,200,225,225,250,260,260,300]);
 let s=bought('runner_dash');s=m.purchaseMasteryQuest(s,'medic_bloom',500,true).state;
 assert.equal(s.active,'runner_dash');assert.equal(step(s,'medic_bloom','gem').quests.medic_bloom.progress[0],0);
 s=m.activateMasteryQuest(s,'medic_bloom');assert.equal(s.active,'medic_bloom');
 assert.match(m.purchaseMasteryQuest(s,'tank_guard',1000,false).error,/Unlock/);
 assert.match(m.purchaseMasteryQuest(s,'tank_guard',259,true).error,/260/);
});
test('nearest-half threshold rounding is ties-up without changing actual health',()=>{
 for(const [hp,expected] of [[0,0],[.01,.5],[.49,.5],[.74,.5],[.75,1],[.8,1],[1.24,1],[1.25,1.5],[1.75,2],[-1,0],[NaN,0]])assert.equal(m.roundedHealthForConditions(hp),expected);
 assert.equal(.8,.8);
});
test('Dash quests do not spill events and hitless streak resets on damage/run boundary',()=>{
 let s=repeat(bought('runner_dash'),'runner_dash','dash',100);assert.equal(s.quests.runner_dash.quest,1);assert.deepEqual(s.quests.runner_dash.progress,[0]);
 s=repeat(s,'runner_dash','dash',9);s=step(s,'runner_dash','damage',{damage:.1,hazard:'barrel',before:3,baseDamage:.5});assert.equal(s.quests.runner_dash.progress[0],0);
 s=repeat(s,'runner_dash','dash',10);assert.equal(s.quests.runner_dash.quest,2);s=repeat(s,'runner_dash','block',74,{source:'dash'});assert.equal(s.quests.runner_dash.complete,false);
 s=step(s,'runner_dash','block',{source:'dash'});assert.equal(s.quests.runner_dash.complete,true);assert.equal(s.active,null);
 assert.equal(m.completeMasteryTrial(bought('runner_dash'),'runner_dash').quests.runner_dash.mastered,false);
 s=m.completeMasteryTrial(s,'runner_dash');s=m.toggleMastery(s,'runner_dash','mastery',false);assert.equal(s.quests.runner_dash.flairRewriteEnabled,true);
});
test('replaying an already-mastered trial is a no-op even when both benefit switches are off',()=>{
 const s={active:null,quests:{runner_dash:{quest:3,progress:[75],complete:true,mastered:true,masteryEnabled:false,flairRewriteEnabled:false}}};
 assert.equal(m.completeMasteryTrial(s,'runner_dash'),s);
 assert.equal(s.quests.runner_dash.masteryEnabled,false);assert.equal(s.quests.runner_dash.flairRewriteEnabled,false);
});
test('Stride requires both hitless counters and third immunity only on quest two',()=>{
 let s=repeat(bought('runner_stride'),'runner_stride','lane-change',300);s=repeat(s,'runner_stride','block',100,{source:'stride'});assert.equal(s.quests.runner_stride.quest,1);
 s=repeat(s,'runner_stride','block',100,{source:'stride-third'});s=repeat(s,'runner_stride','lane-change',100);s=repeat(s,'runner_stride','block',24,{source:'stride-third'});assert.equal(s.quests.runner_stride.complete,false);
 s=step(s,'runner_stride','block',{source:'stride-third'});assert.equal(s.quests.runner_stride.complete,true);
});
test('Bloom keeps cumulative healing but its final quest is one-run actual healing',()=>{
 let s=repeat(bought('medic_bloom'),'medic_bloom','gem',50);s=repeat(s,'medic_bloom','heal',20,{amount:.5,source:'bloom'});assert.equal(s.quests.medic_bloom.quest,2);
 s=step(s,'medic_bloom','heal',{amount:4,source:'bloom'});s=step(s,'medic_bloom','run-end');assert.equal(s.quests.medic_bloom.progress[0],0);
 s=step(s,'medic_bloom','heal',{amount:5,source:'bloom'});assert.equal(s.quests.medic_bloom.complete,true);
});
test('Remedy, Salve, Guard and Smoke credit exact sources',()=>{
 let r=step(bought('medic_remedy'),'medic_remedy','heal',{source:'other',amount:50});r=step(r,'medic_remedy','heal',{source:'other',amount:20});assert.equal(r.quests.medic_remedy.progress[0],0);r=step(r,'medic_remedy','heal',{source:'snowflake',amount:20});r=repeat(r,'medic_remedy','snowflake',100);assert.equal(r.quests.medic_remedy.complete,true);
 let s=repeat(bought('medic_salve'),'medic_salve','frame',300,{seconds:1,hp:.8});s=repeat(s,'medic_salve','salve-heal',20);s=repeat(s,'medic_salve','wave',20,{wave:2,salveExhausted:true});assert.equal(s.quests.medic_salve.complete,true);
 let g=repeat(bought('tank_guard'),'tank_guard','damage',100,{before:3,damage:.5,baseDamage:1,hazard:'log'});g=repeat(g,'tank_guard','damage',20,{before:.8,damage:.65,baseDamage:1,hazard:'log'});g=repeat(g,'tank_guard','damage',100,{before:3,damage:1,baseDamage:2,hazard:'rock'});assert.equal(g.quests.tank_guard.complete,true);
 let k=repeat(bought('trickster_smoke'),'trickster_smoke','smoke',50);k=repeat(k,'trickster_smoke','smoke',30,{opponent:true});k=repeat(k,'trickster_smoke','smoke',30,{timeToImpact:.251});assert.equal(k.quests.trickster_smoke.complete,false);k=repeat(k,'trickster_smoke','smoke',30,{timeToImpact:.25});assert.equal(k.quests.trickster_smoke.complete,true);
});
test('Vault final run fails on a log/spike hit and fresh run clears failure',()=>{
 let s=repeat(bought('runner_vault'),'runner_vault','vault',50,{hazard:'log'});s=repeat(s,'runner_vault','vault',50,{hazard:'spikes'});s=step(s,'runner_vault','damage',{hazard:'log',damage:1,before:3,baseDamage:1});s=step(s,'runner_vault','wave',{wave:10});assert.equal(s.quests.runner_vault.complete,false);s=step(s,'runner_vault','run-start');s=step(s,'runner_vault','wave',{wave:10});assert.equal(s.quests.runner_vault.complete,true);
});
test('Dash/Stride timed trials enforce colors and finish through trophy, not raw timer unlock',()=>{
 for(const [key,action]of [['runner_dash','dash'],['runner_stride','stride-third']]){
  const bad=m.reduceMasteryTrial(startTrial(key),{type:'special-obstacle',action:'miss'});assert.equal(bad.state.phase,'failed');
  let s=startTrial(key);s=m.reduceMasteryTrial(s,{type:'special-obstacle',action}).state;s=frames(s,45);assert.equal(s.phase,'finale');s=frames(s,3);assert.equal(s.phase,'complete');
 }
});
test('Bloom trial first miss kills; later miss loses one; wave5 finale',()=>{
 assert.equal(m.reduceMasteryTrial(startTrial('medic_bloom'),{type:'gem',collected:false}).state.phase,'failed');
 let s=m.reduceMasteryTrial(startTrial('medic_bloom'),{type:'gem',collected:true}).state;assert.equal(m.reduceMasteryTrial(s,{type:'gem',collected:false}).damage,1);
 s=m.reduceMasteryTrial(s,{type:'wave-end',wave:5}).state;assert.equal(s.phase,'finale');
});
test('Remedy heat and guaranteed spawn use active seconds and snowflake resets heat to1',()=>{
 let s=frames(startTrial('medic_remedy'),10);const due=m.reduceMasteryTrial(s,{type:'frame',seconds:1,hp:3});assert.equal(due.spawnSnowflake,true);s=due.state;assert.equal(s.heat,5);
 assert.equal(m.reduceMasteryTrial(s,{type:'frame',seconds:1,hp:3}).spawnSnowflake,false);
 s=m.reduceMasteryTrial(s,{type:'snowflake'}).state;assert.equal(s.heat,1);assert.equal(s.heatSeconds,0);
 assert.equal(frames(startTrial('medic_remedy'),20).phase,'failed');
});
test('Salve four60-second treatments and exact risk boundaries',()=>{
 assert.deepEqual([.099,.1,.299,.3,.599,.6,.75,.751].map(m.salveTrialDeathChance),[1,.5,.5,.25,.25,.1,.1,0]);
 let s=startTrial('medic_salve');for(let i=1;i<=4;i++){s=frames(s,60,1);s=m.reduceMasteryTrial(s,{type:'wave-end',wave:i,roll:.99}).state;}assert.equal(s.phase,'finale');assert.equal(s.treated,4);
 let unsafe=frames(startTrial('medic_salve'),60,3);unsafe=m.reduceMasteryTrial(unsafe,{type:'wave-end',wave:1,roll:.999}).state;assert.equal(unsafe.phase,'failed');
});
test('Vault trial tolerates exactly one mistime; twenty combined obstacles win',()=>{
 let s=startTrial('runner_vault');s=m.reduceMasteryTrial(s,{type:'vault',timed:false,vaulted:true}).state;assert.equal(s.poleDamaged,true);assert.equal(m.reduceMasteryTrial(s,{type:'vault',timed:false,vaulted:true}).state.phase,'failed');
 s=startTrial('runner_vault');for(let i=0;i<20;i++)s=m.reduceMasteryTrial(s,{type:'vault',timed:true,vaulted:true}).state;assert.equal(s.phase,'finale');
 assert.equal(m.reduceMasteryTrial(startTrial('runner_vault'),{type:'vault',timed:true,vaulted:false}).state.phase,'failed');
});
test('Guard exact blue counts and nonlethal floor; Smoke exact bands/two50-second dissipators',()=>{
 assert.deepEqual([1,2,3,4].map(m.guardTrialBlueCount),[1,2,3,5]);let s=startTrial('tank_guard');let hit=m.reduceMasteryTrial(s,{type:'special-obstacle',action:'hit',hp:.8,baseDamage:2});assert.ok(Math.abs(hit.damage-.3)<1e-9);assert.equal(hit.healthFloor,.5);assert.equal(m.reduceMasteryTrial(s,{type:'special-obstacle',action:'miss'}).state.phase,'failed');
 s=startTrial('trickster_smoke');assert.deepEqual(m.masteryTrialSmoke(s).map(x=>x.kind),['heavy','grey','mild']);s=m.reduceMasteryTrial(s,{type:'dissipate'}).state;assert.equal(s.dissipators,1);assert.deepEqual(m.masteryTrialSmoke(s).map(x=>x.kind),['grey','mild']);assert.equal(m.reduceMasteryTrial(s,{type:'dissipate'}).state.dissipators,1);s=frames(s,50);s=m.reduceMasteryTrial(s,{type:'dissipate'}).state;assert.equal(s.dissipators,0);s=frames(s,150);assert.equal(s.phase,'finale');
 for(const d of m.MASTERIES){assert.equal(m.trialPickupAllowed(d.key,'melon'),false);assert.equal(m.trialPickupAllowed(d.key,'coin'),false);}assert.equal(m.trialPickupAllowed('medic_bloom','gem'),true);assert.equal(m.trialHazardAllowed('trickster_smoke','snowflake'),false);
});
test('mastery gameplay modifiers are exact and preserve fractions',()=>{
 assert.equal(m.dashGreenChance(true),.01);assert.equal(m.dashGreenChance(true,true),1/90);assert.equal(m.resolveDashGreen(false,.65).damage,0);assert.equal(m.resolveDashGreen(false,.64999).damage,.5);
 assert.equal(m.strideShieldSeconds(3,false,false),.25);assert.equal(m.strideShieldSeconds(2,true,false),.2);assert.equal(m.strideShieldSeconds(2,true,true),.3);
 assert.equal(m.bloomGemHeal(true,false,false),.25);assert.equal(m.remedySnowflakeHeal(true,false,false),.75);assert.equal(m.remedySnowflakeHeal(true,true,false),0);
 assert.deepEqual(m.salveWaveHeal(.8,2,false),{heal:0,used:false});assert.deepEqual(m.salveWaveHeal(.8,2,true),{heal:2,used:true});assert.deepEqual(m.salveWaveHeal(.8,3,true),{heal:.5,used:false});
 assert.equal(m.vaultWasTimed(1,1.25),true);assert.equal(m.vaultWasTimed(1,1.251),false);assert.deepEqual(m.vaultEffect(true,true),{status:'quick-recovery',seconds:5,speed:2,score:2.25,damage:0,nextVaultSeconds:15});
 let guard=m.createGuardMemory();for(let i=0;i<3;i++)guard=m.guardHit(guard,'rock',1,.2).memory;assert.equal(m.guardHit(guard,'rock',2,.49).immune,true);assert.equal(m.guardHit(guard,'rock',2,.5).immune,false);
 assert.equal(m.smokeHoldAttack(10,2).cost,2);assert.equal(m.smokeHoldAttack(10,2).strength,'heavy-grey');assert.equal(m.smokeHoldAttack(10,0),null);assert.equal(m.smokeHoldAttack(5,3).cost,2);assert.equal(m.smokeLifeGuess(0,.49).dodge,true);
});
test('zero-health frames cannot finish a timed mastery trial',()=>{
 let s=frames(startTrial('runner_dash'),44,3);
 s=m.reduceMasteryTrial(s,{type:'frame',seconds:1,hp:0}).state;
 assert.equal(s.phase,'failed');
 assert.equal(m.reduceMasteryTrial(s,{type:'frame',seconds:3,hp:3}).unlock,false);
});
test('missing Bloom first gem cancels the first-gem bonus, not later quarter-heart healing',()=>{
 assert.equal(m.bloomGemHeal(true,true,true),.25);
 assert.equal(m.bloomGemHeal(true,false,true),.25);
 assert.equal(m.bloomGemHeal(false,false,true),0);
});
