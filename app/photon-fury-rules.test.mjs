import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PHOTON_RULES, PHOTON_CHARACTERS, PHOTON_CATEGORIES, PHOTON_STARTERS,
  PHOTON_WEIGHTS, MAGNET_WEIGHTS, createPhotonRun, getPhotonCharacter,
  getOwnedPhotonCharacters, resolveOwnedPhotonCharacter, isPhotonCharacterKey,
  activatePhotonSaber, activatePhotonAbility, advancePhotonRun, movePhoton,
  dashPhoton, selectPhotonTimeStopLane, healPhoton, wireTwistPhoton,
  photonSpeed, photonObstacleSpeed, photonHazardSpeed, photonGuardSeconds,
  photonPoints, photonTotalPoints, photonBonusPoints, photonReward, photonRunReward,
  photonControlsLocked, pickPhotonHazard, multiplyBonuses, addTurnDelays,
  isPhotonWeaponCompatible, armPhotonLaser, erasePhotonHazard,
} from './photon-fury-rules.ts';
import { MAP_IDS } from './arena-map-rules.ts';

const keys = Object.keys(PHOTON_CHARACTERS);
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
const quiet = (key = 'photon_magician', changes = {}) => ({ ...createPhotonRun(key), nextSpawnAt: Infinity, ...changes });
const seconds = (run, duration, random = () => .99) => {
  let remaining = duration;
  while (remaining > 1e-10) { const step = Math.min(.05, remaining); run = advancePhotonRun(run, step, random); remaining -= step; }
  return run;
};
const armed = (key = 'photon_magician', changes = {}) => {
  const run = quiet(key, changes);
  return seconds(activatePhotonSaber(run), getPhotonCharacter(key).saberInputDelaySeconds + .000001);
};
const contact = (key, kind, { guard = false, chaos = false, random = () => .99, weapon = 'lightsaber', ...changes } = {}) => {
  let run = { ...quiet(key), weaponKey: weapon, stage: chaos ? 'chaos' : 'normal', stageEndsAt: Infinity, ...changes };
  if (guard) run = seconds(activatePhotonSaber(run), getPhotonCharacter(key).saberInputDelaySeconds + .000001, random);
  return advancePhotonRun({ ...run, items: [{ id: 1, kind, lane: run.lane, y: .74 }] }, .01, random);
};

test('sixteen exclusive characters form four groups of four, with exactly four starters', () => {
  assert.deepEqual(PHOTON_CATEGORIES, ['traditional', 'rush', 'strategic', 'wild']);
  assert.equal(keys.length, 16);
  for (const category of PHOTON_CATEGORIES) assert.equal(Object.values(PHOTON_CHARACTERS).filter(c => c.category === category).length, 4);
  assert.deepEqual(PHOTON_STARTERS, ['photon_magician', 'photon_wizard', 'photon_bluff', 'photon_bell']);
  assert.equal(isPhotonCharacterKey('runner_ace'), false);
  assert.equal(isPhotonCharacterKey('__proto__'), false);
  assert.throws(() => createPhotonRun('runner_ace'), /Photon Fury character/);
  assert.equal(MAP_IDS.includes('laserdrome'), false);
});
test('four starters require the mode unlock; other characters require explicit account ownership', () => {
  assert.deepEqual(getOwnedPhotonCharacters(false, keys), []);
  assert.deepEqual(getOwnedPhotonCharacters(true, null), PHOTON_STARTERS);
  const owned = getOwnedPhotonCharacters(true, ['photon_tick', 'photon_tick', 'runner_ace', null]);
  assert.deepEqual(owned, [...PHOTON_STARTERS, 'photon_tick']);
  assert.equal(resolveOwnedPhotonCharacter('photon_tick', owned), 'photon_tick');
  assert.equal(resolveOwnedPhotonCharacter('photon_trumpet', owned), 'photon_magician');
});
test('bonuses multiply, turn delays add, and the 35% faster baseline is the new displayed 1×', () => {
  close(multiplyBonuses(1.4, 1.1), 1.54); close(addTurnDelays(.25, .2), .45);
  close(PHOTON_RULES.baseTravelSpeed, .288 * 1.35);
  assert.equal(photonSpeed(0), 1); assert.equal(photonSpeed(100), 1.004 ** 100);
  assert.equal(photonObstacleSpeed(createPhotonRun()), 1);
  assert.equal(PHOTON_RULES.price, 225); assert.equal(PHOTON_RULES.unlockLevel, 15);
});
test('base and Magnet hazard percentages cover exactly 100%', () => {
  assert.equal(Object.values(PHOTON_WEIGHTS).reduce((a, b) => a + b, 0), 100);
  assert.equal(Object.values(MAGNET_WEIGHTS).reduce((a, b) => a + b, 0), 100);
  assert.deepEqual([.01,.11,.21,.36,.51,.76].map(r => pickPhotonHazard(r)), ['rock','needle','car','log','spike','barrel']);
  assert.deepEqual([.01,.11,.21,.31,.46,.71,.91].map(r => pickPhotonHazard(r,'photon_magnet')), ['rock','car','needle','log','spike','barrel','warpstone']);
  for (let i = 0; i < 100; i++) assert.notEqual(pickPhotonHazard(i / 100, 'photon_bear'), 'warpstone');
});
test('default saber has .1 input delay, .4 fixed guard, one-second cooldown, and seven durability', () => {
  let run = activatePhotonSaber(quiet());
  assert.equal(run.hp, 4); assert.equal(run.durability, 7); assert.equal(run.guardUntil, 0); assert.equal(run.saberStartsAt, .1);
  assert.equal(activatePhotonSaber(run), run);
  run = seconds(run, .1); close(run.guardUntil, .5); assert.equal(run.saberStartsAt, null);
  assert.equal(photonGuardSeconds({ ...run, elapsed: 1000 }), .4);
  run = seconds(run, .400001);
  assert.equal(run.hp, 3.5); assert.equal(run.durability, 6); close(run.cooldownUntil, 1.5);
  assert.equal(run.guardUntil, 0); assert.equal(run.reflections, 0);
  assert.equal(activatePhotonSaber(run), run);
  assert.equal(seconds(run, .05).hp, 3.5, 'a whiff is charged once only');
});
test('a collision before input delay expires cannot be reflected', () => {
  const early = advancePhotonRun({ ...activatePhotonSaber(quiet()), items: [{ id: 1, kind: 'car', lane: 1, y: .74 }] }, .01);
  assert.equal(early.reflections, 0); assert.equal(early.hp, 3);
});
test('one swing reflects exactly one obstacle and starts cooldown immediately on the block', () => {
  const ready = armed();
  const run = advancePhotonRun({ ...ready, items: [{ id: 1, kind: 'car', lane: 1, y: .74 }, { id: 2, kind: 'log', lane: 1, y: .75 }] }, .01);
  assert.equal(run.reflections, 1); assert.equal(run.durability, 6); assert.equal(run.hp, 3);
  assert.equal(run.guardUntil, 0); close(run.cooldownUntil, run.elapsed + 1);
  assert.equal(activatePhotonSaber(run), run);
});
test('only cars and needles wear the standard saber on reflection; a broken saber never activates', () => {
  for (const kind of Object.keys(PHOTON_WEIGHTS)) {
    const run = contact('photon_tick', kind, { guard: true });
    assert.equal(run.reflections, 1); assert.equal(run.hp, 4);
    assert.equal(run.durability, ['car','needle'].includes(kind) ? 6 : 7);
    assert.equal(run.needleUntil, 0);
  }
  const broken = { ...createPhotonRun(), durability: 0 };
  assert.equal(activatePhotonSaber(broken), broken);
});
test('ordinary contact damage remains half-heart granular and never regenerates automatically', () => {
  for (const [kind, damage] of Object.entries({ rock: 2, car: 1, log: 1, spike: 1, barrel: .5 })) {
    const run = contact('photon_tick', kind);
    assert.equal(run.hp, 4 - damage); assert.equal(seconds({ ...run, items: [] }, 3).hp, run.hp);
  }
});
test('needles stack four seconds and roll exactly once per actual lane change, including delayed turns', () => {
  let run = contact('photon_tick', 'needle', { elapsed: 2, needleUntil: 4 });
  assert.equal(run.needleUntil, 8);
  run = movePhoton(run, 1, .3499); assert.equal(run.hp, 3.5);
  run = movePhoton(run, -1, .35); assert.equal(run.hp, 3.5);
  assert.equal(movePhoton({ ...run, lane: 3 }, 1, 0).hp, 3.5);
  assert.equal(movePhoton({ ...run, elapsed: 8 }, 1, 0).hp, 3.5);
  let delayed = movePhoton(quiet('photon_burner', { needleUntil: 4 }), 1, 0);
  assert.equal(delayed.hp, 4); assert.equal(delayed.lane, 1);
  assert.equal(movePhoton(delayed, -1, 0), delayed);
  delayed = advancePhotonRun(delayed, .05, () => 0);
  assert.equal(delayed.lane, 2); assert.equal(delayed.hp, 3.5);
  assert.equal(advancePhotonRun(delayed, .05, () => 0).hp, 3.5);
});
test('pause and invalid clock inputs leave the entire run untouched', () => {
  for (const run of [quiet(), quiet('photon_magnet', { timeStop: true }), quiet('photon_tick', { hp: 0 })]) {
    for (const dt of [0, -1, NaN, Infinity]) assert.equal(advancePhotonRun(run, dt), run);
  }
  const halted = quiet('photon_magnet', { timeStop: true });
  assert.equal(advancePhotonRun(halted, 10), halted); assert.equal(movePhoton(halted, 1, 0), halted);
});
test('generated hazards never stack or overtake in a lane and always leave one escape lane', () => {
  let seed = 9;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  let run = createPhotonRun();
  for (let i = 0; i < 10000; i++) {
    run = advancePhotonRun({ ...run, hp: 4 }, .05, random);
    assert.equal(new Set(run.items.map(item => item.lane)).size, run.items.length);
    assert.ok(run.items.length <= 3);
  }
});
test('Photons use only whole points and the four-point minimum, never score or elapsed time', () => {
  for (const [points, reward] of [[0,0],[3.99,0],[4,1],[5,2],[7,10],[10,37],[-1,0],[NaN,0]]) assert.equal(photonReward(points), reward);
  const tick = { ...quiet('photon_tick'), reflections: 7 };
  assert.equal(photonRunReward({ ...tick, elapsed: 1 }), 10);
  assert.equal(photonRunReward({ ...tick, elapsed: 1000 }), 10);
  assert.equal(Object.hasOwn(tick, 'score'), false);
});
test('Magician adds one bonus point per complete 45 active seconds before the Photon reward', () => {
  const run = quiet('photon_magician', { elapsed: 89.999, reflections: 5 });
  assert.equal(photonBonusPoints(run), 1); assert.equal(photonTotalPoints(run), 6);
  assert.equal(photonBonusPoints({ ...run, elapsed: 90 }), 2);
  assert.equal(photonRunReward({ ...run, elapsed: 90 }), 10);
  assert.equal(photonBonusPoints({ ...run, characterKey: 'photon_tick' }), 0);
});
test('Tick guards .5s with .8s cooldown; Trumpet has five HP and twelve durability', () => {
  const tick = contact('photon_tick', 'log', { guard: true });
  close(tick.cooldownUntil, tick.elapsed + .8); assert.equal(photonGuardSeconds(tick), .5);
  const trumpet = contact('photon_trumpet', 'car', { guard: true });
  assert.equal(trumpet.hp, 5); assert.equal(trumpet.durability, 11); close(trumpet.cooldownUntil, trumpet.elapsed + .8);
  const injured = { ...trumpet, hp: 4 }; assert.equal(healPhoton(injured), injured);
});
test('Saxophone heals .5 every25s while intact, with exactly10% durability cost and .25 input/1.2 cooldown', () => {
  const original = quiet('photon_saxophone', { hp: 2.5, elapsed: 10 });
  assert.equal(original.durability, 7);
  const healed = healPhoton(original, () => .1);
  assert.equal(healed.hp, 3); assert.equal(healed.durability, 7); assert.equal(healed.healCooldownUntil, 35);
  assert.equal(healPhoton(healed, () => 0), healed);
  const worn = healPhoton(original, () => .0999); assert.equal(worn.durability, 6);
  assert.equal(healPhoton({ ...healed, elapsed: 35 }, () => .9).hp, 3.5);
  const broken = { ...original, durability: 0 }; assert.equal(healPhoton(broken), broken);
  const full = quiet('photon_saxophone'); assert.equal(healPhoton(full), full);
  const active = activatePhotonSaber(full); assert.equal(active.saberStartsAt, .25);
  const blocked = contact('photon_saxophone', 'log', { guard: true }); close(blocked.cooldownUntil, blocked.elapsed + 1.2);
});
test('Wizard wraps only with3+durability; missing uses durability but no HP', () => {
  for (const durability of [3, 7]) {
    const left = quiet('photon_wizard', { lane: 0, durability });
    assert.equal(movePhoton(left, -1, 1).lane, 3);
    assert.equal(movePhoton({ ...left, lane: 3 }, 1, 1).lane, 0);
  }
  for (const durability of [0,1,2]) {
    const left = quiet('photon_wizard', { lane: 0, durability }); assert.equal(movePhoton(left, -1, 1), left);
  }
  const missed = seconds(activatePhotonSaber(quiet('photon_wizard')), .500001);
  assert.equal(missed.hp, 4); assert.equal(missed.durability, 6); close(missed.cooldownUntil, 1.5);
});
test('Nuclear BOMB keeps exactly one randomly selected hazard, loses .5HP, has15s cooldown and no input delay', () => {
  const items = [{id:1,kind:'car',lane:0,y:.3},{id:2,kind:'rock',lane:1,y:.2},{id:3,kind:'needle',lane:3,y:.4}];
  const original = quiet('photon_nuclear', { elapsed: 5, items });
  const bomb = activatePhotonAbility(original, () => .5);
  assert.deepEqual(bomb.items, [items[1]]); assert.equal(original.items.length, 3);
  assert.equal(bomb.hp, 3.5); assert.equal(bomb.abilityCooldownUntil, 20);
  assert.equal(activatePhotonAbility(bomb), bomb);
  assert.ok(activatePhotonSaber(original).guardUntil > original.elapsed);
  assert.equal(activatePhotonSaber(original).saberStartsAt, null);
});
test('Burner doubles points before squaring rewards, speeds hazards30%, and delays every turn .05s', () => {
  for (const kind of Object.keys(PHOTON_WEIGHTS)) close(photonHazardSpeed(quiet('photon_burner'), kind) / photonHazardSpeed(quiet(), kind), 1.3);
  const blocked = contact('photon_burner', 'rock', { guard: true });
  assert.equal(photonPoints(blocked), 2); close(blocked.cooldownUntil, blocked.elapsed + 2);
  assert.equal(photonGuardSeconds(blocked), .3);
  assert.equal(photonRunReward({ ...blocked, reflections: 5 }), photonReward(10));
  const turn = movePhoton(quiet('photon_burner'), 1, 1);
  assert.equal(turn.lane, 1); close(turn.pendingTurn.at, .05);
  assert.equal(advancePhotonRun(turn, .049).lane, 1);
  assert.equal(advancePhotonRun(turn, .05).lane, 2);
});
test('Bull modifies only the specified hazards and teleports two lanes without touching the skipped lane', () => {
  for (const [kind, multiplier] of Object.entries({ rock:1.25, spike:1.25, barrel:.85, log:.8, car:1, needle:1 })) close(photonHazardSpeed(quiet('photon_bull'), kind) / photonHazardSpeed(quiet(), kind), multiplier);
  const original = quiet('photon_bull', { lane: 0, items: [{id:1,kind:'rock',lane:1,y:.74}] });
  const right = activatePhotonAbility(original);
  assert.equal(right.lane, 2); assert.equal(right.hp, 4); assert.equal(right.items.length, 1);
  assert.equal(dashPhoton(right, 1), right);
  assert.equal(dashPhoton(right, -1).lane, 0);
  assert.equal(getPhotonCharacter('photon_bull').cooldownSeconds, 2);
});
test('Bluff has five HP, half-damage spikes, .15 input delay and .3 guard', () => {
  assert.equal(contact('photon_bluff','spike').hp, 4.5);
  assert.equal(contact('photon_bluff','rock').hp, 3);
  assert.equal(activatePhotonSaber(quiet('photon_bluff')).saberStartsAt, .15);
  assert.equal(photonGuardSeconds(quiet('photon_bluff')), .3);
});
test('Magnet Warpstone contact teleports to any lane and grants3 points; guarding it kills with no point', () => {
  for (let lane = 0; lane < 4; lane++) {
    const run = contact('photon_magnet','warpstone',{ random: () => lane/4 });
    assert.equal(run.lane, lane); assert.equal(run.hp, 4); assert.equal(photonPoints(run), 3); assert.equal(run.reflections, 0);
  }
  const fatal = contact('photon_magnet','warpstone',{ guard: true });
  assert.equal(fatal.hp, 0); assert.equal(photonPoints(fatal), 0); assert.equal(fatal.guardUntil, 0);
});
test('Magnet HALT freezes active clocks until a different valid lane, then25s cooldown and40%repair up to7', () => {
  const original = quiet('photon_magnet', { elapsed: 10, durability: 6, cooldownUntil: 11, needleUntil: 14 });
  const halted = activatePhotonAbility(original);
  assert.equal(halted.timeStop, true); assert.equal(photonControlsLocked(halted), true);
  assert.equal(advancePhotonRun(halted, 10), halted);
  for (const lane of [1, -1, 4, .5, NaN]) assert.equal(selectPhotonTimeStopLane(halted, lane), halted);
  const resumed = selectPhotonTimeStopLane(halted, 3, () => .3999);
  assert.equal(resumed.lane, 3); assert.equal(resumed.elapsed, 10); assert.equal(resumed.durability, 7); assert.equal(resumed.abilityCooldownUntil, 35);
  assert.equal(resumed.needleUntil, 14); assert.equal(resumed.cooldownUntil, 11);
  assert.equal(activatePhotonAbility(resumed), resumed);
  assert.equal(selectPhotonTimeStopLane({ ...halted, durability: 7 }, 3, () => 0).durability, 7);
  assert.equal(selectPhotonTimeStopLane(halted, 3, () => .4).durability, 6);
});
test('Bear normal needles give1 contact or2 reflected points without debuff or durability loss', () => {
  const touched = contact('photon_bear','needle');
  assert.equal(photonPoints(touched), 1); assert.equal(touched.needleUntil, 0); assert.equal(touched.hp, 4);
  const reflected = contact('photon_bear','needle',{ guard: true });
  assert.equal(photonPoints(reflected), 2); assert.equal(reflected.durability, 7);
});
test('Bear Chaos gives3 reflection points, doubles ordinary damage, and needles deal1HP plus debuff', () => {
  for (const [kind, damage] of Object.entries({rock:4,car:2,log:2,spike:2,barrel:1,needle:1})) {
    const touched = contact('photon_bear',kind,{chaos:true});
    assert.equal(touched.hp, 4-damage); assert.equal(photonPoints(touched), 0);
    assert.equal(touched.needleUntil > touched.elapsed, kind === 'needle');
    const reflected = contact('photon_bear',kind,{chaos:true,guard:true});
    assert.equal(photonPoints(reflected), 3); assert.equal(reflected.hp, 4);
    if (kind === 'needle') assert.equal(reflected.durability, 7);
  }
  close(photonObstacleSpeed(quiet('photon_bear')), 1.05);
  close(photonObstacleSpeed(quiet('photon_bear', {stage:'chaos'})), 1.45);
});
test('Bear cycles60sNormal→paused3s→10sChaos→heal.5→paused3s→Normal, never advancing active time during countdown', () => {
  let run = advancePhotonRun(quiet('photon_bear', {elapsed:59.99,hp:3,items:[{id:1,kind:'log',lane:3,y:0}]}), .05);
  assert.equal(run.elapsed, 60); assert.equal(run.chaosCountdown, 3);
  const y = run.items[0].y;
  run = seconds(run, 3);
  assert.equal(run.elapsed, 60); assert.equal(run.items[0].y, y); assert.equal(run.stage, 'chaos'); assert.equal(run.stageEndsAt, 70);
  run = advancePhotonRun({ ...run, elapsed:69.99 }, .05);
  assert.equal(run.elapsed, 70); assert.equal(run.hp, 3.5); assert.equal(run.chaosCountdown, 3); assert.equal(run.nextStage, 'normal');
  run = seconds(run, 3);
  assert.equal(run.elapsed, 70); assert.equal(run.stage, 'normal'); assert.equal(run.stageEndsAt, 130);
  const lethal = advancePhotonRun(quiet('photon_bear', {stage:'chaos',stageEndsAt:70,elapsed:69.99,hp:1,items:[{id:1,kind:'log',lane:1,y:.74}]}), .05);
  assert.equal(lethal.hp, 0, 'end-of-stage healing never revives a death');
});
test('Wrench converts only nearest own-lane hazard; empty lanes and cooldowns make no mutation', () => {
  const run = quiet('photon_wrench',{elapsed:5,items:[{id:1,kind:'rock',lane:1,y:.2},{id:2,kind:'needle',lane:1,y:.5},{id:3,kind:'car',lane:3,y:.7}]});
  const twisted = wireTwistPhoton(run);
  assert.equal(twisted.items[0].kind, 'rock'); assert.equal(twisted.items[1].kind, 'barrel'); assert.equal(twisted.items[1].y, .5);
  assert.equal(twisted.wireCooldownUntil, 20); assert.equal(wireTwistPhoton(twisted), twisted);
  const empty = quiet('photon_wrench'); assert.equal(wireTwistPhoton(empty), empty);
  close(photonHazardSpeed(run,'barrel') / photonHazardSpeed({...run,characterKey:'photon_magician'},'barrel'), 1.07);
  assert.equal(photonGuardSeconds(run), .9); assert.equal(getPhotonCharacter('photon_wrench').cooldownSeconds, 2);
});
test('Wrench double-point chance is4% per remaining durability after a reflection', () => {
  for (const [kind, boundary] of [['rock',.28], ['car',.24], ['needle',.24]]) {
    assert.equal(photonPoints(contact('photon_wrench',kind,{guard:true,random:()=>boundary-.00001})), 2);
    assert.equal(photonPoints(contact('photon_wrench',kind,{guard:true,random:()=>boundary})), 1);
  }
});
test('Bell starts with3HP, grazes and deletes adjacent needles to heal.5, and chimes once per20s', () => {
  let run = quiet('photon_bell', {hp:2,items:[{id:1,kind:'needle',lane:2,y:.71}]});
  const graze = advancePhotonRun(run,.01); assert.equal(graze.hp,2.5); assert.equal(graze.items.length,0);
  assert.equal(advancePhotonRun({...run,hp:3},.01).hp,3);
  close(photonHazardSpeed(run,'needle')/photonHazardSpeed({...run,characterKey:'photon_magician'},'needle'),1.35);
  run = {...run,elapsed:5,items:[{id:1,kind:'car',lane:0,y:.2},{id:2,kind:'rock',lane:2,y:.3}]};
  const chime = activatePhotonAbility(run,()=>0); assert.deepEqual(chime.items,[run.items[1]]); assert.equal(chime.abilityCooldownUntil,25);
  assert.equal(activatePhotonAbility(chime),chime);
});
test('Static counts last20s changes at5% and previous10s at2%; turns delay.05, rock reflections give2, misses lose1HP', () => {
  const run = quiet('photon_static',{elapsed:40,laneChangeTimes:[9,10,19.9,20,39]});
  close(photonObstacleSpeed(run)/photonSpeed(40),1+.02+.02+.05+.05);
  assert.equal(photonPoints(contact('photon_static','rock',{guard:true})),2);
  assert.equal(movePhoton(run,1,1).pendingTurn.at,40.05);
  assert.equal(seconds(activatePhotonSaber(quiet('photon_static')),.50001).hp,3);
});
test('Oyster slows every hazard8%, reverses all directional inputs once and teleports on needle contact', () => {
  const run = quiet('photon_oyster');
  assert.equal(movePhoton(run,-1,1).lane,2); assert.equal(movePhoton(run,1,1).lane,0); assert.equal(movePhoton(run,0,1),run);
  for(const kind of Object.keys(PHOTON_WEIGHTS)) close(photonHazardSpeed(run,kind)/photonHazardSpeed(quiet(),kind),.92);
  for(let lane=0;lane<4;lane++) {
    const touched=contact('photon_oyster','needle',{random:()=>lane/4});
    assert.equal(touched.lane,lane); assert.equal(touched.needleUntil,0); assert.equal(touched.hp,4); assert.equal(photonPoints(touched),0);
  }
  const reflected=contact('photon_oyster','needle',{guard:true});
  assert.equal(reflected.lane,1); assert.equal(photonPoints(reflected),1); assert.equal(reflected.durability,6);
});
test('Spade loses.5HP each second after2s stillness; real lane changes reset it and successful blocks heal by durability chance', () => {
  const run=quiet('photon_spade');
  assert.equal(seconds(run,2.999).hp,4);
  assert.equal(seconds(run,3.00001).hp,3.5);
  assert.equal(seconds(run,4.00001).hp,3);
  let moved=movePhoton({...run,elapsed:2.9},1,1); moved=seconds(moved,2.5); assert.equal(moved.hp,4);
  assert.equal(contact('photon_spade','rock',{guard:true,hp:3,random:()=>.27999}).hp,3.5);
  assert.equal(contact('photon_spade','rock',{guard:true,hp:3,random:()=>.28}).hp,3);
  assert.equal(getPhotonCharacter('photon_spade').cooldownSeconds,1.4);
});
test('each of the16 characters applies exactly one whiff charge and its own cooldown', () => {
  for(const key of keys) {
    const c=getPhotonCharacter(key), end=c.saberInputDelaySeconds+c.guardSeconds;
    const run=seconds(activatePhotonSaber(quiet(key)),end+.000001);
    assert.equal(run.hp,c.maxHp-c.missDamage,key); assert.equal(run.durability,c.durability-1,key);
    close(run.cooldownUntil,end+c.cooldownSeconds);
  }
});
test('retained optional Photon weapons stay isolated and their restrictions are enforced', () => {
  assert.equal(isPhotonWeaponCompatible('photon_blaster','photon_bear'),false);
  assert.equal(isPhotonWeaponCompatible('magnetite_sword','photon_magnet'),false);
  assert.throws(()=>createPhotonRun('photon_bear','concentrated_laser'),/incompatible/);
  assert.equal(contact('photon_tick','barrel',{weapon:'photon_blaster'}).hp,4);
  assert.equal(contact('photon_tick','car',{weapon:'photon_blaster'}).hp,2);
  assert.equal(photonPoints(contact('photon_tick','rock',{weapon:'magnetite_sword'})),1);
  assert.equal(contact('photon_tick','needle',{weapon:'concentrated_laser'}).hp,0);
  const original={...createPhotonRun('photon_tick','concentrated_laser'),items:[{id:1,kind:'rock',lane:0,y:.5}]};
  const erased=erasePhotonHazard(armPhotonLaser(original),1);
  assert.equal(erased.items.length,0); assert.equal(erased.durability,6); assert.equal(erased.laserCooldownUntil,25);
  assert.equal(armPhotonLaser(erased),erased);
});

test('SQL catalog matches all16 rule snapshots,48 special skins,17 themes and four starter ownership keys', () => {
  const sql=readFileSync(new URL('../neon/qol-photon-01-catalog.sql',import.meta.url),'utf8');
  const rows=[...sql.matchAll(/\('(photon_[a-z]+)',([\d.,a-z]+)\)/g)].filter(([, ,columns])=>columns.split(',').length===7);
  assert.equal(rows.length,16);
  for(const [,key,columns] of rows) {
    const c=getPhotonCharacter(key), values=columns.split(',').map(x=>x==='null'?null:Number(x));
    assert.deepEqual(values,[c.maxHp,c.durability,c.guardSeconds,c.cooldownSeconds,c.bonusPointSeconds,c.healAmount,c.healCooldownSeconds],key);
  }
  assert.match(sql,/p_character_key in\('photon_magician','photon_wizard','photon_bluff','photon_bell'\)/);
  assert.match(sql,/user_id=p_user_id and item_key=p_character_key and kind='character'/);
  assert.match(sql,/alter table app_private\.photon_unlocks enable row level security/);
  assert.match(sql,/revoke all on app_private\.photon_unlocks from public,anon,anonymous,authenticated/);
});
test('new run receipts bind own actor/version/rules, preserve old receipts, reject client payout and replay once', () => {
  const sql=readFileSync(new URL('../neon/qol-photon-03-runs.sql',import.meta.url),'utf8');
  assert.match(sql,/u uuid:=app_private\.photon_user\(\)/);
  assert.match(sql,/if not app_private\.owns_photon_character\(u,k\) then raise exception 'Character locked'/);
  assert.match(sql,/where id=p_run_id and user_id=u for update/);
  assert.match(sql,new RegExp(`rules_version=${PHOTON_RULES.version}`));
  assert.match(sql,/if r\.finished_at is not null then/);
  assert.match(sql,/p:=n\*r\.point_multiplier\+x/);
  assert.match(sql,/v:=case/); assert.match(sql,/Invalid playtime/); assert.match(sql,/Invalid reflections/); assert.match(sql,/Invalid bonus/);
  assert.doesNotMatch(sql,/p_awarded|drop table|delete from public\.player/);
});
