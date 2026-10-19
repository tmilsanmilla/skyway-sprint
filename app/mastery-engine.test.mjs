import test from 'node:test';
import assert from 'node:assert/strict';
import * as e from './mastery-engine.ts';
import {guardBlueDamage,strideShieldSeconds} from './mastery-rules.ts';

test('Dash spawn probability is exact and each object is tagged once, including hydrated course rows',()=>{
 const r=e.createMasteryRuntime();let greens=0;
 for(let id=0;id<100;id++)greens+=Number(e.decorateMasteryItem(r,{id,kind:'rock'},'runner_dash',true,false,id/100,true).dashGreen);
 assert.equal(greens,1);
 assert.equal(e.decorateMasteryItem(r,{id:0,kind:'rock'},'runner_dash',true,false,.99,true).dashGreen,true);
 const paired=e.createMasteryRuntime();let pairedGreens=0;
 for(let id=0;id<90;id++)pairedGreens+=Number(e.decorateMasteryItem(paired,{id,kind:'log'},'runner_dash',true,true,id/90,true).dashGreen);
 assert.equal(pairedGreens,1);
 assert.equal(e.decorateMasteryItem(r,{id:201,kind:'gem'},'runner_dash',true,true,0,false).dashGreen,undefined);
});
test('a green miss damages at 65% boundary exactly once, while dash resolution consumes the miss',()=>{
 const r=e.createMasteryRuntime();e.decorateMasteryItem(r,{id:1,kind:'log'},'runner_dash',true,false,0,true);
 assert.equal(e.resolveMasteryMiss(r,1,'runner_dash',true,.6499).damage,.5);
 assert.equal(e.resolveMasteryMiss(r,1,'runner_dash',true,0).damage,0);
 e.decorateMasteryItem(r,{id:2,kind:'log'},'runner_dash',true,false,0,true);
 assert.equal(e.resolveMasteryMiss(r,2,'runner_dash',true,.65).damage,0);
 e.decorateMasteryItem(r,{id:3,kind:'log'},'runner_dash',true,false,0,true);r.resolvedMisses.add(3);
 assert.equal(e.resolveMasteryMiss(r,3,'runner_dash',true,0).damage,0);
});
test('Bloom missed first gem consumes the first benefit, but all later gems still heal .25',()=>{
 const r=e.createMasteryRuntime();e.decorateMasteryItem(r,{id:1,kind:'gem'},'medic_bloom',true,false,.5,false);
 assert.equal(e.resolveMasteryMiss(r,1,'medic_bloom',true,.1).damage,.5);
 assert.equal(e.resolveMasteryMiss(r,1,'medic_bloom',true,.1).damage,0);
 assert.equal(e.resolveBloomCollection(r,2,true),.25);
 e.startMasteryWave(r,2);e.decorateMasteryItem(r,{id:3,kind:'gem'},'medic_bloom',true,false,.5,false);
 assert.equal(e.resolveBloomCollection(r,3,true),1);assert.equal(e.resolveBloomCollection(r,4,true),.25);
});
test('unmastered Bloom retains first-collected semantics rather than first-spawned penalties',()=>{
 const r=e.createMasteryRuntime();e.decorateMasteryItem(r,{id:1,kind:'gem'},'medic_bloom',false,false,.5,false);
 assert.equal(e.resolveMasteryMiss(r,1,'medic_bloom',false,.1).damage,0);
 assert.equal(e.resolveBloomCollection(r,2,false),.5);assert.equal(e.resolveBloomCollection(r,3,false),0);
});
test('Bloom ability uses farthest lane once per wave, centre roll chooses either outside lane',()=>{
 const r=e.createMasteryRuntime();assert.equal(e.consumeBloomAbility(r,2,5,.49),0);assert.equal(e.consumeBloomAbility(r,0,5,.9),null);
 e.startMasteryWave(r,2);assert.equal(e.consumeBloomAbility(r,2,5,.5),4);
 e.startMasteryWave(r,3);assert.equal(e.consumeBloomAbility(r,5,6,.5),0);
});
test('timed Vault has recovery at 15 active seconds and can repeat in the same wave',()=>{
 const r=e.createMasteryRuntime();r.elapsed=10;r.vaultPressedAt=9.75;
 assert.equal(e.resolveMasteryVault(r,1,true).status,'quick-recovery');assert.equal(r.vaultSpeed,2);assert.equal(r.vaultScore,2.25);
 r.elapsed=24.999;assert.equal(e.vaultAvailable(r,1),false);r.elapsed=25;assert.equal(e.vaultAvailable(r,1),true);
 r.vaultPressedAt=25;assert.equal(e.resolveMasteryVault(r,1,true).status,'quick-recovery');assert.equal(r.vaultNextAt,40);
});
test('untimed Vault flops once, cannot repeat until next wave, and does not mutate actual stored HP',()=>{
 const r=e.createMasteryRuntime(),hp=.8;r.elapsed=2;r.vaultPressedAt=1.749;
 const v=e.resolveMasteryVault(r,1,true);assert.equal(v.status,'flop');assert.equal(v.damage,.5);assert.equal(r.vaultSpeed,.5);assert.equal(r.vaultScore,.4);
 r.elapsed=50;assert.equal(e.vaultAvailable(r,1),false);assert.equal(e.vaultAvailable(r,2),true);assert.equal(hp,.8);
 const normal=e.createMasteryRuntime();assert.equal(e.resolveMasteryVault(normal,1,false).seconds,1);assert.equal(normal.vaultSpeed,1.8);assert.equal(normal.vaultScore,1.9);
});
test('Guard blue every tenth eligible object caps at two per wave and never rerolls an old ID',()=>{
 const r=e.createMasteryRuntime();r.guard.mode=true;let blues=[];
 for(let id=1;id<=30;id++)if(e.decorateMasteryItem(r,{id,kind:'log'},'tank_guard',true,false,.2,true).guardBlue)blues.push(id);
 assert.deepEqual(blues,[10,20]);assert.equal(r.guard.obstacleCount,30);
 e.decorateMasteryItem(r,{id:10,kind:'log'},'tank_guard',true,false,.2,true);assert.equal(r.guard.obstacleCount,30);
 e.startMasteryWave(r,2);assert.equal(r.guard.mode,true);assert.equal(r.guard.blueSpawned,0);
 for(let id=31;id<=40;id++)e.decorateMasteryItem(r,{id,kind:'gem'},'tank_guard',true,false,.2,false);
 assert.equal(r.spawnTags.get(40).guardBlue,true);
});
test('Guard remembers third contact by type, including snowflakes, through first half of next wave',()=>{
 const r=e.createMasteryRuntime();
 for(let n=0;n<3;n++)assert.equal(e.resolveGuardContact(r,'snowflake',1,.2,false).immune,false);
 assert.equal(e.resolveGuardContact(r,'snowflake',1,.9,false).immune,true);
 e.startMasteryWave(r,2);assert.equal(e.resolveGuardContact(r,'snowflake',2,.49999,false).immune,true);
 assert.equal(e.resolveGuardContact(r,'snowflake',2,.5,false).immune,false);
 assert.equal(e.resolveGuardContact(r,'rock',2,.5,false).immune,false);
});
test('blue contact is nonlethal at real fractional HP and grants only current-wave type immunity',()=>{
 const r=e.createMasteryRuntime();assert.equal(e.resolveGuardContact(r,'rock',1,.9,true).blue,true);
 assert.equal(guardBlueDamage(.8),.30000000000000004);assert.equal(.8-guardBlueDamage(.8),.5);assert.equal(guardBlueDamage(.2),0);
 assert.equal(e.resolveGuardContact(r,'rock',1,.99,false).immune,true);e.startMasteryWave(r,2);assert.equal(e.resolveGuardContact(r,'rock',2,0,false).immune,false);
});
test('blue misses cost two HP once even if the object is later culled by collision recovery',()=>{
 const r=e.createMasteryRuntime();r.guard.mode=true;for(let id=1;id<=10;id++)e.decorateMasteryItem(r,{id,kind:'barrel'},'tank_guard',true,false,.5,true);
 assert.equal(e.resolveMasteryMiss(r,10,'tank_guard',true,.5).damage,2);assert.equal(e.resolveMasteryMiss(r,10,'tank_guard',true,.5).damage,0);
});
test('Guard blue gem advances exactly two reward tiers, including across the five-tier hold',()=>{
 assert.equal(e.guardBlueGemPickup(2).gemsAwarded,4);assert.equal(e.guardBlueGemPickup(4).gemsAwarded,6);assert.equal(e.guardBlueGemPickup(4).state.consecutivePickups,11);
 assert.equal(e.guardBlueGemPickup(8).gemsAwarded,7);assert.equal(e.guardBlueGemPickup(8).state.consecutivePickups,12);
});
test('wave transitions never reset active clock or replay a prior wave',()=>{
 const r=e.createMasteryRuntime();r.elapsed=25;r.smokeBombs=0;e.startMasteryWave(r,2);assert.equal(r.smokeBombs,3);assert.equal(r.elapsed,25);
 r.smokeBombs=1;e.startMasteryWave(r,1);assert.equal(r.wave,2);assert.equal(r.smokeBombs,1);
});
test('Smoke narrow dodge uses original lane and measured impact time, not destination lane',()=>{
 const items=[{lane:1,y:64,kind:'rock'},{lane:3,y:30,kind:'rock'}];
 assert.equal(e.smokeNearMissSeconds(items,1,()=>10,()=>true),.1);
 assert.equal(e.smokeNearMissSeconds(items,3,()=>10,()=>true),3.5);
 assert.equal(e.smokeNearMissSeconds(items,0,()=>10,()=>true),undefined);
 assert.equal(e.smokeNearMissSeconds([{lane:1,y:80,kind:'rock'}],1,()=>10,()=>true),0);
 assert.equal(e.smokeNearMissSeconds([{lane:1,y:91,kind:'rock'}],1,()=>10,()=>true),undefined);
});
test('Smoke teleports and hold attacks share exactly three bombs and active-time cooldown',()=>{
 const r=e.createMasteryRuntime();assert.equal(e.spendLocalSmoke(r,true,0,true).bombs,2);assert.equal(e.spendLocalSmoke(r,true,3,true),null);
 r.elapsed=5;const sent=e.spendLocalSmoke(r,true,5,true);assert.equal(sent.attack.strength,'grey');assert.equal(sent.bombs,0);
 r.elapsed=100;assert.equal(e.spendLocalSmoke(r,true,0,true),null);e.startMasteryWave(r,2);assert.equal(e.spendLocalSmoke(r,true,10,true).attack.strength,'heavy-grey');assert.equal(r.smokeBombs,0);
});
test('unmastered Smoke can do basic approved mild quest throw without receiving mastery bomb limit',()=>{
 const r=e.createMasteryRuntime();const sent=e.spendLocalSmoke(r,false,10,true);assert.equal(sent.attack.strength,'mild');assert.equal(r.smokeBombs,3);
 r.elapsed=12;assert.ok(e.spendLocalSmoke(r,false,3,true));
});
test('smoke overlay has exact trial bands, opponent heavy split and independent passive top fog',()=>{
 assert.deepEqual(e.smokeOverlayBands(true,null).map(x=>[x.from,x.to,x.kind]),[[0,1,'heavy']]);
 assert.deepEqual(e.smokeOverlayBands(false,'heavy-grey'),[{from:0,to:.5,kind:'heavy'},{from:.5,to:1,kind:'grey'}]);
 assert.deepEqual(e.smokeOverlayBands(false,null,.4),[{from:0,to:.4,kind:'mild'}]);
 assert.equal(strideShieldSeconds(2,true,true),.3);assert.equal(strideShieldSeconds(3,true,true),0);
});
test('mastery runtime prunes expired tags while preserving all live and prior-wave objects',()=>{
 const r=e.createMasteryRuntime();for(let id=1;id<=3;id++)e.decorateMasteryItem(r,{id,kind:'rock'},'runner_dash',true,false,0,true);
 r.resolvedMisses.add(1);e.startMasteryWave(r,2);e.decorateMasteryItem(r,{id:4,kind:'rock'},'runner_dash',true,false,0,true);
 e.startMasteryWave(r,3);e.pruneMasteryRuntime(r,new Set([3]));
 assert.equal(r.spawnTags.has(1),false);assert.equal(r.resolvedMisses.has(1),false);assert.equal(r.spawnTags.has(3),true);assert.equal(r.spawnTags.has(4),true);
});
