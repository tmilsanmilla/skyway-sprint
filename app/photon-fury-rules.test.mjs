import test from 'node:test';
import assert from 'node:assert/strict';
import { activatePhotonSaber, advancePhotonRun, createPhotonRun, movePhoton, photonReward, photonScore, photonSpeed, pickPhotonHazard, PHOTON_WEIGHTS, multiplyBonuses, addTurnDelays } from './photon-fury-rules.ts';
import { activatePitchKatana, createPitchKatanaState, resolvePitchKatanaCollision, settlePitchKatanaWindow } from './arena-map-rules.ts';
import { MAP_IDS } from './arena-map-rules.ts';
test('bonuses multiply but turn delays add', () => {
  assert.ok(Math.abs(multiplyBonuses(1.4,1.1)-1.54)<1e-12);
  assert.equal(addTurnDelays(.25,.2),.45);
});
test('Laserdrome has six weighted hazards and cannot appear in ordinary voting', () => {
  assert.equal(Object.values(PHOTON_WEIGHTS).reduce((a,b)=>a+b,0),100);
  assert.equal(MAP_IDS.includes('laserdrome'),false);
  assert.deepEqual([.01,.11,.21,.36,.51,.76].map(pickPhotonHazard),['rock','needle','car','log','spike','barrel']);
});
test('Photon Fury starts with exactly four hearts and seven durability', () => {
  assert.equal(createPhotonRun().hp,4); assert.equal(createPhotonRun().durability,7);
});
test('lightsaber blocks only one hazard and cooldown begins on the block', () => {
  const active=activatePhotonSaber({...createPhotonRun(),elapsed:1,nextSpawnAt:99,items:[{id:1,kind:'car',lane:1,y:.74},{id:2,kind:'log',lane:1,y:.75}]});
  const blocked=advancePhotonRun(active,.01);
  assert.equal(blocked.photons,1); assert.equal(blocked.durability,6);
  assert.equal(blocked.guardUntil,0); assert.ok(Math.abs(blocked.cooldownUntil-1.61)<1e-12);
  assert.equal(blocked.hp,3); // second obstacle is not also reflected
  assert.equal(blocked.items.length,0);
  assert.equal(activatePhotonSaber(blocked),blocked);
});
test('a miss loses half a heart and starts .6s cooldown after .4s guard', () => {
  let run=activatePhotonSaber({...createPhotonRun(),nextSpawnAt:99});
  for(let i=0;i<9;i++) run=advancePhotonRun(run,.05);
  assert.equal(run.hp,3.5); assert.equal(run.photons,0);
  assert.equal(run.cooldownUntil,1);
  assert.equal(advancePhotonRun(run,.05).hp,3.5);
});
test('broken lightsaber cannot activate; non-cars do not consume durability', () => {
  const broken={...createPhotonRun(),durability:0}; assert.equal(activatePhotonSaber(broken),broken);
  const active=activatePhotonSaber({...createPhotonRun(),nextSpawnAt:99,items:[{id:1,kind:'rock',lane:1,y:.74}]});
  assert.equal(advancePhotonRun(active,.01).durability,7);
  assert.equal(advancePhotonRun(active,.01).hp,4);
});
test('needle duration stacks and each real lane change rolls independently', () => {
  let run=advancePhotonRun({...createPhotonRun(),elapsed:2,needleUntil:4,nextSpawnAt:99,items:[{id:1,kind:'needle',lane:1,y:.74}]},.01);
  assert.equal(run.needleUntil,8);
  run=movePhoton(run,1,.34); assert.equal(run.hp,3.5);
  run=movePhoton(run,-1,.35); assert.equal(run.hp,3.5);
  run=movePhoton({...run,elapsed:8},1,0); assert.equal(run.hp,3.5);
  assert.equal(movePhoton({...run,lane:3},1,0).hp,3.5);
});
test('reflected needles award one photon instead of applying their debuff', () => {
  const run=advancePhotonRun(activatePhotonSaber({...createPhotonRun(),nextSpawnAt:99,items:[{id:1,kind:'needle',lane:1,y:.74}]}),.01);
  assert.equal(run.photons,1); assert.equal(run.needleUntil,0);
});
test('speed uses active seconds, slow score retains fractions, payout floors safely', () => {
  assert.equal(photonSpeed(0),1); assert.equal(photonSpeed(100),1.004**100);
  assert.equal(photonScore(27),.1); assert.equal(photonReward(10,.1),12);
  assert.equal(photonReward(-1,-1),0);
  const run=createPhotonRun(); assert.equal(advancePhotonRun(run,0),run);
});
test('normal contact damage and no regeneration', () => {
  for(const [kind,damage] of Object.entries({rock:2,car:1,log:1,spike:1,barrel:.5})) {
    const run=advancePhotonRun({...createPhotonRun(),nextSpawnAt:99,items:[{id:1,kind,lane:1,y:.74}]},.01);
    assert.equal(run.hp,4-damage);
    assert.equal(advancePhotonRun({...run,items:[]},.05).hp,run.hp);
  }
});
test('generated hazards never share a lane and leave an escape lane', () => {
  let run=createPhotonRun();
  for(let i=0;i<10000;i++) {
    run=advancePhotonRun({...run,hp:4},.05,()=>.01);
    assert.equal(new Set(run.items.map(item=>item.lane)).size,run.items.length);
    assert.ok(run.items.length<=3);
  }
});
test('Katana unwields on one reflection and cannot reflect a second hazard', () => {
  const active=activatePitchKatana(createPitchKatanaState(),1000,false).state;
  const blocked=resolvePitchKatanaCollision(active,'log',1100);
  assert.equal(blocked.kind,'deflected');
  assert.equal(blocked.state.activeUntilMs,1100);
  assert.equal(blocked.state.cooldownUntilMs,7100);
  assert.equal(resolvePitchKatanaCollision(blocked.state,'barrel',1101).kind,'inactive');
  assert.equal(settlePitchKatanaWindow(blocked.state,1500).selfDamage,0);
});
