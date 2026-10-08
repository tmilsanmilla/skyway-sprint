import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { activatePhotonSaber, advancePhotonRun, createPhotonRun, movePhoton, photonReward, photonSpeed, photonObstacleSpeed, photonPoints, photonTotalPoints, pickPhotonHazard, PHOTON_WEIGHTS, MAGNET_WEIGHTS, multiplyBonuses, addTurnDelays, PHOTON_CATEGORIES, PHOTON_CHARACTERS, PHOTON_STARTERS, isPhotonCharacterKey, getPhotonCharacter, healPhoton, photonBonusPoints, photonRunReward, photonControlsLocked, wireTwistPhoton } from './photon-fury-rules.ts';
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
  assert.equal(blocked.reflections,1); assert.equal(blocked.durability,6);
  assert.equal(blocked.guardUntil,0); assert.ok(Math.abs(blocked.cooldownUntil-2.51)<1e-12);
  assert.equal(blocked.hp,3); // second obstacle is not also reflected
  assert.equal(blocked.items.length,0);
  assert.equal(activatePhotonSaber(blocked),blocked);
});
test('a miss loses half a heart and starts 1.5s cooldown after .4s guard', () => {
  let run=activatePhotonSaber({...createPhotonRun(),nextSpawnAt:99});
  for(let i=0;i<9;i++) run=advancePhotonRun(run,.05);
  assert.equal(run.hp,3.5); assert.equal(run.reflections,0);
  assert.equal(run.cooldownUntil,1.9);
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
test('reflected needles award a point instead of applying their debuff', () => {
  const run=advancePhotonRun(activatePhotonSaber({...createPhotonRun(),nextSpawnAt:99,items:[{id:1,kind:'needle',lane:1,y:.74}]}),.01);
  assert.equal(run.reflections,1); assert.equal(run.needleUntil,0);
});
test('speed uses active seconds; Update 17 photons use only points with a four-point minimum', () => {
  assert.equal(photonSpeed(0),1); assert.equal(photonSpeed(100),1.004**100);
  for(const [points,reward] of [[0,0],[1,0],[2,0],[3,0],[3.99,0],[4,1],[5,2],[7,10],[10,37]]) assert.equal(photonReward(points),reward);
  assert.equal(photonReward(-1),0); assert.equal(photonReward(NaN),0);
  const tick={...createPhotonRun('photon_tick'),reflections:5};
  assert.equal(photonRunReward({...tick,elapsed:1}),2);
  assert.equal(photonRunReward({...tick,elapsed:500}),2);
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
test('Photon has its own four categories and ten available starter characters', () => {
  assert.deepEqual(PHOTON_CATEGORIES,['traditional','rush','strategic','wild']);
  assert.equal(PHOTON_STARTERS.length,10);
  assert.equal(PHOTON_STARTERS.filter(key=>getPhotonCharacter(key).category==='traditional').length,4);
  assert.deepEqual(PHOTON_STARTERS.filter(key=>getPhotonCharacter(key).category==='rush'),['photon_wizard','photon_burner']);
  assert.equal(isPhotonCharacterKey('runner_ace'),false);
  assert.equal(isPhotonCharacterKey('medic_seraph'),false);
  assert.throws(()=>createPhotonRun('runner_ace'),/Photon Fury character/);
  assert.deepEqual(PHOTON_STARTERS.filter(key=>getPhotonCharacter(key).category==='strategic'),['photon_bluff','photon_magnet','photon_bear','photon_wrench']);
  assert.deepEqual(Object.values(PHOTON_CHARACTERS).map(c=>c.cooldownSeconds),[1.5,1.2,1.2,.2,1.5,2,1.5,1.5,1.5,3.5,1.5]);
});
test('Oyster is Wild, has baseline HP and saber, and slows every hazard by exactly eight percent', () => {
  const c=getPhotonCharacter('photon_oyster');
  assert.equal(c.category,'wild'); assert.equal(c.obstacleSpeed,.92);
  const run=createPhotonRun('photon_oyster');
  assert.equal(run.hp,4); assert.equal(run.durability,7);
  assert.equal(activatePhotonSaber(run).guardUntil,.4);
  for(const kind of Object.keys(PHOTON_WEIGHTS)) {
    const item={id:1,kind,lane:3,y:0};
    const normal=advancePhotonRun({...createPhotonRun(),nextSpawnAt:999,items:[item]},.05);
    const slower=advancePhotonRun({...run,nextSpawnAt:999,items:[item]},.05);
    assert.ok(Math.abs(slower.items[0].y/normal.items[0].y-.92)<1e-12);
  }
});
test('Oyster reverses every directional input once, clamps at both edges, and ignores a same-lane tap', () => {
  const run=createPhotonRun('photon_oyster');
  assert.equal(movePhoton(run,-1,1).lane,2);
  assert.equal(movePhoton(run,1,1).lane,0);
  assert.equal(movePhoton(run,0,1),run);
  const rightEdge={...run,lane:3}; assert.equal(movePhoton(rightEdge,-1,1),rightEdge);
  const leftEdge={...run,lane:0}; assert.equal(movePhoton(leftEdge,1,1),leftEdge);
  const paused={...run,chaosCountdown:3}; assert.equal(movePhoton(paused,-1,1),paused);
  const dead={...run,hp:0}; assert.equal(movePhoton(dead,-1,1),dead);
  for(const key of PHOTON_STARTERS) {
    const ordinary=createPhotonRun(key);
    assert.equal(getPhotonCharacter(key).invertedControls,false);
    const moved=movePhoton(ordinary,-1,1);
    assert.equal(moved.pendingTurn?.lane??moved.lane,0);
  }
});
test('Oyster Needle contact teleports to any random lane with no damage, points, or Needle debuff', () => {
  for(const [random,lane] of [[0,0],[.24999,0],[.25,1],[.5,2],[.75,3],[.99999,3],[1,3]]) {
    const run=advancePhotonRun({...createPhotonRun('photon_oyster'),nextSpawnAt:999,items:[{id:1,kind:'needle',lane:1,y:.74}]},.01,()=>random);
    assert.equal(run.lane,lane); assert.equal(run.hp,4); assert.equal(run.needleUntil,0);
    assert.equal(run.reflections,0); assert.equal(run.extraPoints,0); assert.equal(run.items.length,0);
    const moved=movePhoton(run,lane===3?1:-1,0);
    assert.equal(moved.hp,4,'teleport must not leave the usual Needle damage risk');
  }
});
test('Oyster can still reflect a Needle for one point instead of teleporting', () => {
  const original=activatePhotonSaber({...createPhotonRun('photon_oyster'),nextSpawnAt:999,items:[{id:1,kind:'needle',lane:1,y:.74}]});
  const run=advancePhotonRun(original,.01,()=>0);
  assert.equal(run.lane,1); assert.equal(run.hp,4); assert.equal(run.needleUntil,0);
  assert.equal(run.reflections,1); assert.equal(photonPoints(run),1); assert.equal(run.extraPoints,0);
  assert.equal(run.durability,7); assert.equal(run.guardUntil,0);
  assert.ok(Math.abs(run.cooldownUntil-1.51)<1e-12);
});
test('keyboard, on-screen buttons, swipes, and lane taps share Oyster inversion without double reversing', () => {
  const view=readFileSync(new URL('./photon-fury.tsx',import.meta.url),'utf8');
  assert.match(view,/lower === "a" \|\| event\.key === "ArrowLeft"\) move\(-1\)/);
  assert.match(view,/lower === "d" \|\| event\.key === "ArrowRight"\) move\(1\)/);
  assert.match(view,/aria-label="Left lane control"[^\n]*onClick=\{\(\) => move\(-1\)\}/);
  assert.match(view,/aria-label="Right lane control"[^\n]*onClick=\{\(\) => move\(1\)\}/);
  assert.match(view,/move\(Math\.sign\(dx\)\)/);
  assert.match(view,/move\(Math\.sign\(target - runRef\.current\.lane\)\)/);
});
test('merged Neon setup fits the visible query limit and matches every character receipt', () => {
  const files = ['../supabase/photon_fury.sql','../supabase/migrations/20261003200000_photon_characters.sql'];
  for (const file of files) {
    const sql=readFileSync(new URL(file,import.meta.url),'utf8');
    if (file.endsWith('/photon_fury.sql')) {
      assert.ok(sql.length<=9000,'Neon would truncate the saved query');
      assert.match(sql,/^-- Photon Fury MISC\s+begin;/);
      assert.match(sql,/commit;\s*$/);
    }
    const rows=Array.from(sql.matchAll(/\('(photon_[a-z]+)'(?:::text)?,([^)]*)\)/g));
    assert.deepEqual(rows.map(row=>row[1]),PHOTON_STARTERS);
    for(const [,key,columns] of rows) {
      const c=getPhotonCharacter(key);
      const values=columns.split(',').map(value=>value.trim()==='null'?null:Number(value.replace(/::numeric/g,'')));
      assert.deepEqual(values,[c.maxHp,c.durability,c.guardSeconds,c.cooldownSeconds,c.bonusPointSeconds,c.healAmount,c.healCooldownSeconds]);
    }
    assert.match(sql,/revoke all on function app_private\.photon_character_rules\(text\)\s*from public,anon,authenticated/);
  }
});
test('Photon payouts send raw reflections separately from earned pickup and reflection bonuses', () => {
  const view=readFileSync(new URL('./photon-fury.tsx',import.meta.url),'utf8');
  assert.match(view,/rpc\("finish_photon_character_run",/);
  assert.match(view,/p_reflections: current\.reflections/);
  assert.match(view,/p_extra_points: current\.extraPoints/);
  const sql=readFileSync(new URL('../supabase/photon_fury.sql',import.meta.url),'utf8');
  assert.match(sql,/public\.finish_photon_fury_run\(p_run_id uuid,p_active_seconds numeric,p_reflections int\)/);
  assert.match(sql,/public\.finish_photon_character_run\(\$1,\$2,\$3,0\)/);
  assert.match(sql,/reflections=n,extra_points=x,awarded=v/);
});
test('Magician adds full forty-second points before the Photon multiplier', () => {
  let run={...createPhotonRun('photon_magician'),reflections:10,elapsed:39.999};
  assert.equal(photonBonusPoints(run),0);
  run={...run,elapsed:80.001};
  assert.equal(photonBonusPoints(run),2);
  assert.equal(photonRunReward(run),photonReward(12));
  assert.equal(photonTotalPoints(run),12);
  assert.equal(photonBonusPoints({...run,characterKey:'photon_tick'}),0);
  assert.equal(photonBonusPoints({...run,elapsed:-10}),0);
  assert.equal(photonBonusPoints(advancePhotonRun(run,0)),2);
});
test('Tick alone guards for .5 seconds and has a 1.2-second post-block cooldown', () => {
  let run=activatePhotonSaber({...createPhotonRun('photon_tick'),nextSpawnAt:999});
  assert.equal(run.guardUntil,.5);
  for(let i=0;i<8;i++) run=advancePhotonRun(run,.05);
  run=advancePhotonRun({...run,items:[{id:1,kind:'log',lane:1,y:.74}]},.05);
  assert.equal(run.reflections,1); assert.equal(run.hp,4);
  assert.ok(Math.abs(run.cooldownUntil-1.65)<1e-12);
  assert.equal(run.guardUntil,0);
});
test('each character miss uses its own cooldown and damage rule', () => {
  for(const key of PHOTON_STARTERS) {
    const config=getPhotonCharacter(key);
    let run=activatePhotonSaber({...createPhotonRun(key),nextSpawnAt:999});
    for(let i=0;i<22;i++) run=advancePhotonRun(run,.05);
    assert.equal(run.hp,config.maxHp-config.missDamage);
    assert.ok(Math.abs(run.cooldownUntil-config.saberInputDelaySeconds-config.guardSeconds-config.cooldownSeconds)<1e-12);
    assert.equal(run.reflections,0);
  }
});

const contact = (key,kind,{guard=false,chaos=false,random=()=>0}={}) => {
  const initial={...createPhotonRun(key),stage:chaos?'chaos':'normal',stageEndsAt:999,nextSpawnAt:999,items:[{id:1,kind,lane:1,y:.74}]};
  return advancePhotonRun(guard?activatePhotonSaber(initial):initial,.01,random);
};
test('Bluff starts at 5 HP and halves only spike contact damage', () => {
  assert.equal(createPhotonRun('photon_bluff').hp,5);
  assert.equal(contact('photon_bluff','spike').hp,4.5);
  assert.equal(contact('photon_bluff','log').hp,4);
  assert.equal(contact('photon_bluff','rock').hp,3);
});
test('Bluff waits .15 active seconds before its .3-second guard, with no early block or repeated queue', () => {
  let run=activatePhotonSaber({...createPhotonRun('photon_bluff'),nextSpawnAt:999});
  assert.equal(run.guardUntil,0); assert.equal(run.saberStartsAt,.15);
  assert.equal(activatePhotonSaber(run),run); assert.equal(advancePhotonRun(run,0),run);
  for(let i=0;i<2;i++) run=advancePhotonRun(run,.05);
  const early=advancePhotonRun({...run,items:[{id:1,kind:'spike',lane:1,y:.74}]},.01);
  assert.equal(early.hp,4.5); assert.equal(early.reflections,0);
  run=advancePhotonRun(run,.05);
  assert.equal(run.saberStartsAt,null); assert.ok(Math.abs(run.guardUntil-.45)<1e-12);
  run=advancePhotonRun({...run,items:[{id:2,kind:'car',lane:1,y:.74}]},.01);
  assert.equal(run.reflections,1); assert.equal(run.hp,5); assert.equal(run.durability,6);
  assert.ok(Math.abs(run.cooldownUntil-1.66)<1e-12);
});
test('only Magnet uses the exact seven-hazard Warpstone distribution', () => {
  assert.equal(Object.values(MAGNET_WEIGHTS).reduce((a,b)=>a+b,0),100);
  assert.deepEqual([.01,.11,.21,.31,.46,.71,.91].map(value=>pickPhotonHazard(value,'photon_magnet')),['rock','car','needle','log','spike','barrel','warpstone']);
  for(let i=0;i<1000;i++) assert.notEqual(pickPhotonHazard(i/1000,'photon_bear'),'warpstone');
  let run={...createPhotonRun('photon_magnet'),elapsed:1,nextSpawnAt:0};
  run=advancePhotonRun(run,.01,()=>.95); assert.equal(run.items[0].kind,'warpstone');
});
test('unguarded Warpstones teleport to every lane and grant exactly 3 points, not reflections', () => {
  for(let lane=0;lane<4;lane++) {
    const run=contact('photon_magnet','warpstone',{random:()=>lane/4});
    assert.equal(run.lane,lane); assert.equal(run.hp,4); assert.equal(run.extraPoints,3);
    assert.equal(run.reflections,0); assert.equal(photonPoints(run),3); assert.equal(run.items.length,0);
    assert.equal(run.pendingTurn,null); assert.equal(photonRunReward(run),0);
  }
});
test('a guarded Warpstone instantly kills without reflecting or awarding points', () => {
  const run=contact('photon_magnet','warpstone',{guard:true});
  assert.equal(run.hp,0); assert.equal(run.reflections,0); assert.equal(run.extraPoints,0);
  assert.equal(run.guardUntil,0); assert.equal(photonRunReward(run),0);
});
test('Bear normal Needles grant 1 contact point or 2 reflection points and never apply a debuff', () => {
  const touched=contact('photon_bear','needle');
  assert.equal(touched.hp,4); assert.equal(photonPoints(touched),1); assert.equal(touched.reflections,0);
  assert.equal(touched.needleUntil,0); assert.equal(movePhoton(touched,1,0).hp,4);
  const blocked=contact('photon_bear','needle',{guard:true});
  assert.equal(photonPoints(blocked),2); assert.equal(blocked.reflections,1); assert.equal(blocked.hp,4);
  assert.equal(blocked.guardUntil,0); assert.equal(blocked.needleUntil,0);
  assert.equal(advancePhotonRun({...blocked,items:[]},.05).hp,4); // not a miss
});
test('Bear Chaos triples all reflection points, doubles ordinary damage, and Needle contact stays 1 HP', () => {
  for(const [kind,damage] of Object.entries({rock:4,car:2,log:2,spike:2,barrel:1,needle:1})) {
    const touched=contact('photon_bear',kind,{chaos:true});
    assert.equal(touched.hp,4-damage); assert.equal(photonPoints(touched),0); assert.equal(touched.needleUntil,0);
    const blocked=contact('photon_bear',kind,{chaos:true,guard:true});
    assert.equal(photonPoints(blocked),3); assert.equal(blocked.reflections,1); assert.equal(blocked.hp,4);
  }
});
test('Bear has 1.05x normal or 1.45x Chaos hazard speed, never compounding them', () => {
  for(const kind of Object.keys(PHOTON_WEIGHTS)) {
    const base={...createPhotonRun(),lane:3,nextSpawnAt:999,items:[{id:1,kind,lane:1,y:.1}]};
    const normal=advancePhotonRun(base,.01).items[0].y-.1;
    for(const [stage,multiplier] of [['normal',1.05],['chaos',1.45]]) {
      const bear=advancePhotonRun({...base,characterKey:'photon_bear',stage,stageEndsAt:999},.01);
      assert.ok(Math.abs((bear.items[0].y-.1)/normal-multiplier)<1e-12);
    }
  }
});
test('Bear pauses all gameplay for exactly 3 seconds after 30 active seconds, then starts 10-second Chaos', () => {
  let run={...createPhotonRun('photon_bear'),elapsed:29.99,nextSpawnAt:999,guardUntil:31,cooldownUntil:32,items:[{id:1,kind:'log',lane:3,y:.1}]};
  run=advancePhotonRun(run,.05); assert.equal(run.elapsed,30); assert.equal(run.chaosCountdown,3);
  const frozenY=run.items[0].y;
  assert.equal(photonControlsLocked(run),true); assert.equal(activatePhotonSaber(run),run); assert.equal(movePhoton(run,1,0),run);
  assert.equal(advancePhotonRun(run,0),run);
  for(let i=0;i<59;i++) run=advancePhotonRun(run,.05);
  assert.ok(run.chaosCountdown>0); assert.equal(run.stage,'normal');
  run=advancePhotonRun(run,.05);
  assert.equal(run.chaosCountdown,0); assert.equal(run.stage,'chaos'); assert.equal(run.stageEndsAt,40);
  assert.equal(run.elapsed,30); assert.equal(run.items[0].y,frozenY); assert.equal(run.guardUntil,31); assert.equal(run.cooldownUntil,32);
});
test('Bear returns to Normal, announces it, heals .5 to max 4, and repeats the forty-active-second cycle', () => {
  let run={...createPhotonRun('photon_bear'),stage:'chaos',stageEndsAt:40,elapsed:39.99,hp:2,nextSpawnAt:999};
  run=advancePhotonRun(run,.05); assert.equal(run.elapsed,40); assert.equal(run.hp,2.5);
  assert.equal(run.stage,'normal'); assert.equal(run.stageEndsAt,70); assert.equal(run.stageNoticeUntil,42);
  run=advancePhotonRun({...run,elapsed:69.99},.05); assert.equal(run.chaosCountdown,3); assert.equal(run.elapsed,70);
  for(let i=0;i<60;i++) run=advancePhotonRun(run,.05);
  assert.equal(run.stage,'chaos'); assert.equal(run.stageEndsAt,80);
  assert.equal(advancePhotonRun({...run,elapsed:79.99,hp:3.5},.05).hp,4);
  assert.equal(advancePhotonRun({...run,elapsed:79.99,hp:4},.05).hp,4);
  const lethal=advancePhotonRun({...run,elapsed:79.99,hp:1,items:[{id:1,kind:'log',lane:1,y:.74}]},.05);
  assert.equal(lethal.hp,0); // end-of-Chaos healing cannot revive
});
test('Wrench E converts only the closest obstacle in its lane, preserves its position, and waits 15 active seconds', () => {
  const run={...createPhotonRun('photon_wrench'),elapsed:5,items:[{id:1,kind:'rock',lane:1,y:.5},{id:2,kind:'log',lane:2,y:.7}]};
  const twisted=wireTwistPhoton(run);
  assert.deepEqual(twisted.items,[{id:1,kind:'barrel',lane:1,y:.5},{id:2,kind:'log',lane:2,y:.7}]);
  assert.equal(twisted.wireCooldownUntil,20); assert.equal(run.items[0].kind,'rock');
  assert.equal(wireTwistPhoton(twisted),twisted); assert.equal(advancePhotonRun(twisted,0),twisted);
  const cooling={...twisted,elapsed:19.999}; assert.equal(wireTwistPhoton(cooling),cooling);
});
test('Wrench never consumes a cooldown in an empty lane or when unusable; E is available again at 15 seconds', () => {
  const empty=createPhotonRun('photon_wrench'); assert.equal(wireTwistPhoton(empty),empty);
  const other={...empty,items:[{id:1,kind:'rock',lane:3,y:.2}]}; assert.equal(wireTwistPhoton(other),other);
  const ready={...empty,wireCooldownUntil:15,elapsed:15,items:[{id:1,kind:'rock',lane:1,y:.2}]};
  assert.equal(wireTwistPhoton(ready).wireCooldownUntil,30);
  for(const run of [{...ready,hp:0},{...ready,chaosCountdown:3},{...ready,characterKey:'photon_tick'}]) assert.equal(wireTwistPhoton(run),run);
});
test('Wrench barrels alone move 10% faster, and its .9s guard uses a 3.5s cooldown', () => {
  for(const kind of Object.keys(PHOTON_WEIGHTS)) {
    const base={...createPhotonRun(),lane:3,nextSpawnAt:999,items:[{id:1,kind,lane:1,y:.1}]};
    const normal=advancePhotonRun(base,.01).items[0].y-.1;
    const wrench=advancePhotonRun({...base,characterKey:'photon_wrench'},.01);
    assert.ok(Math.abs((wrench.items[0].y-.1)/normal-(kind==='barrel'?1.1:1))<1e-12);
  }
  assert.equal(activatePhotonSaber(createPhotonRun('photon_wrench')).guardUntil,.9);
  const blocked=contact('photon_wrench','car',{guard:true});
  assert.equal(blocked.durability,6); assert.equal(blocked.cooldownUntil,3.51);
});
test('Wrench reflections use the exact 85/15 point split before payout, without extra miss damage', () => {
  for(const [roll,points] of [[0,1],[.849999,1],[.85,2],[.999999,2]]) {
    const run=contact('photon_wrench','needle',{guard:true,random:()=>roll});
    assert.equal(run.reflections,1); assert.equal(photonPoints(run),points); assert.equal(run.hp,4);
    assert.equal(run.needleUntil,0); assert.equal(run.guardUntil,0);
    assert.equal(photonRunReward({...run,elapsed:81}),photonReward(points));
  }
});
test('Wizard wraps both edges repeatedly with no cooldown; other characters stop at the edge', () => {
  let wizard={...createPhotonRun('photon_wizard'),lane:0};
  for(let i=0;i<10;i++) {
    wizard=movePhoton(wizard,-1,1); assert.equal(wizard.lane,3);
    wizard=movePhoton(wizard,1,1); assert.equal(wizard.lane,0);
    assert.equal(wizard.pendingTurn,null);
  }
  assert.equal(movePhoton({...createPhotonRun(),lane:0},-1,1).lane,0);
  assert.equal(movePhoton({...createPhotonRun(),lane:3},1,1).lane,3);
  assert.equal(movePhoton(wizard,0,0),wizard);
  assert.equal(movePhoton({...wizard,hp:0},-1,0).lane,0);
});
test('Wizard misses are free but still start the normal cooldown and contact still hurts', () => {
  let wizard=activatePhotonSaber({...createPhotonRun('photon_wizard'),nextSpawnAt:999});
  for(let i=0;i<9;i++) wizard=advancePhotonRun(wizard,.05);
  assert.equal(wizard.hp,4); assert.equal(wizard.reflections,0);
  assert.equal(wizard.guardUntil,0); assert.equal(wizard.cooldownUntil,1.9);
  assert.equal(activatePhotonSaber(wizard),wizard);
  wizard=advancePhotonRun({...wizard,items:[{id:1,kind:'rock',lane:1,y:.74}]},.01);
  assert.equal(wizard.hp,2);
  const needled=movePhoton({...wizard,lane:0,needleUntil:99},-1,0);
  assert.equal(needled.lane,3); assert.equal(needled.hp,1.5);
});
test('Burner speeds up every hazard by exactly 30%, not the active clock', () => {
  for(const kind of Object.keys(PHOTON_WEIGHTS)) {
    const base={...createPhotonRun('photon_tick'),lane:3,elapsed:5,nextSpawnAt:999,items:[{id:1,kind,lane:1,y:.1}]};
    const normal=advancePhotonRun(base,.01);
    const burner=advancePhotonRun({...base,characterKey:'photon_burner'},.01);
    assert.ok(Math.abs((burner.items[0].y-.1)/(normal.items[0].y-.1)-1.3)<1e-12);
    assert.equal(burner.elapsed,normal.elapsed);
    assert.equal(photonObstacleSpeed(burner),photonSpeed(burner.elapsed)*1.3);
  }
});
test('Burner doubles raw reflection points BEFORE the formula and final rounding', () => {
  const burner=advancePhotonRun(activatePhotonSaber({...createPhotonRun('photon_burner'),nextSpawnAt:999,items:[{id:1,kind:'log',lane:1,y:.74}]}),.01);
  assert.equal(burner.reflections,1); assert.equal(photonPoints(burner),2);
  assert.equal(burner.hp,4); assert.equal(burner.durability,7);
  assert.ok(Math.abs(burner.cooldownUntil-2.01)<1e-12);
  const result={...burner,elapsed:80,reflections:5};
  assert.equal(photonRunReward(result),photonReward(10));
  assert.equal(photonRunReward(result),37);
  const fractional={...result,elapsed:27,reflections:1};
  assert.equal(photonRunReward(fractional),0);
  assert.equal(photonRunReward({...result,elapsed:54,reflections:1}),0);
  assert.equal(photonRunReward({...result,elapsed:81,reflections:1}),0);
  assert.notEqual(photonRunReward({...result,reflections:2}),2*photonReward(2));
  assert.equal(photonBonusPoints(result),0);
  assert.equal(activatePhotonSaber(createPhotonRun('photon_burner')).guardUntil,.3);
});
test('every Burner turn waits .05 active seconds, cannot skip or reset the delay, and pauses preserve it', () => {
  let burner={...createPhotonRun('photon_burner'),elapsed:1,nextSpawnAt:999};
  burner=movePhoton(burner,1,0);
  assert.equal(burner.lane,1); assert.deepEqual(burner.pendingTurn,{lane:2,at:1.05});
  assert.equal(movePhoton(burner,-1,0),burner);
  assert.equal(advancePhotonRun(burner,0),burner);
  burner=advancePhotonRun(burner,.049); assert.equal(burner.lane,1);
  burner=advancePhotonRun(burner,.002); assert.equal(burner.lane,2); assert.equal(burner.pendingTurn,null);
  burner=movePhoton(burner,-1,0); assert.equal(burner.lane,2);
  burner=advancePhotonRun(burner,.05); assert.equal(burner.lane,1);
  const edge={...burner,lane:0}; assert.equal(movePhoton(edge,-1,0),edge);
});
test('Burner needle checks happen once when a delayed turn completes, not when queued', () => {
  const queued=movePhoton({...createPhotonRun('photon_burner'),nextSpawnAt:999,needleUntil:4},1,0);
  assert.equal(queued.hp,4);
  const completed=advancePhotonRun(queued,.05,()=>0);
  assert.equal(completed.lane,2); assert.equal(completed.hp,3.5);
  assert.equal(advancePhotonRun(completed,.05,()=>0).hp,3.5);
  const expired=advancePhotonRun({...queued,needleUntil:.04},.05,()=>0);
  assert.equal(expired.hp,4);
});
test('Trumpet starts at 5 HP and 12 durability, with no healing', () => {
  const run=createPhotonRun('photon_trumpet');
  assert.equal(run.hp,5); assert.equal(run.durability,12);
  const blocked=advancePhotonRun(activatePhotonSaber({...run,nextSpawnAt:999,items:[{id:1,kind:'car',lane:1,y:.74}]}),.01);
  assert.equal(blocked.durability,11); assert.equal(blocked.hp,5);
  assert.ok(Math.abs(blocked.cooldownUntil-1.21)<1e-12);
  const injured={...run,hp:4}; assert.equal(healPhoton(injured),injured);
});
test('Saxophone has five durability, .2s saber cooldown, and .5 healing every 25s', () => {
  const run=createPhotonRun('photon_saxophone');
  assert.equal(run.durability,5);
  const blocked=advancePhotonRun(activatePhotonSaber({...run,nextSpawnAt:999,items:[{id:1,kind:'car',lane:1,y:.74}]}),.01);
  assert.equal(blocked.durability,4); assert.ok(Math.abs(blocked.cooldownUntil-.21)<1e-12);
  const healed=healPhoton({...run,hp:2.5,elapsed:10});
  assert.equal(healed.hp,3); assert.equal(healed.healCooldownUntil,35);
  assert.equal(healPhoton(healed),healed);
  assert.equal(healPhoton({...healed,elapsed:34.999}).hp,3);
  assert.equal(healPhoton({...healed,elapsed:35}).hp,3.5);
  assert.equal(advancePhotonRun(healed,0),healed);
});
test('Saxophone cannot heal with a broken saber, when dead, or above max HP', () => {
  const run=createPhotonRun('photon_saxophone');
  for(const modified of [{...run,hp:2,durability:0},{...run,hp:0},run]) assert.equal(healPhoton(modified),modified);
  assert.equal(healPhoton({...run,hp:3.5}).hp,4);
  for(const key of PHOTON_STARTERS.filter(key=>key!=='photon_saxophone')) {
    const injured={...createPhotonRun(key),hp:2}; assert.equal(healPhoton(injured),injured);
  }
});
