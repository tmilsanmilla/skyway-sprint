/** Laserdrome is deliberately separate from the ordinary 1v1 map catalog. */
export const PHOTON_RULES = {
  lanes: 4, unlockLevel: 15, price: 100, startingHp: 4,
  durability: 7, guardSeconds: 0.4, cooldownSeconds: 1.5,
  needleSeconds: 4, needleDamageChance: 0.35,
} as const;
export const PHOTON_CATEGORIES = ["traditional", "rush", "strategic", "wild"] as const;
export type PhotonCategory = typeof PHOTON_CATEGORIES[number];
export type PhotonCharacterKey = "photon_magician" | "photon_tick" | "photon_trumpet" | "photon_saxophone" | "photon_wizard" | "photon_burner" | "photon_bluff" | "photon_magnet" | "photon_bear" | "photon_wrench" | "photon_oyster";
export const PHOTON_STARTERS: readonly PhotonCharacterKey[] = ["photon_magician", "photon_tick", "photon_trumpet", "photon_saxophone", "photon_wizard", "photon_burner", "photon_bluff", "photon_magnet", "photon_bear", "photon_wrench"];
type PhotonCharacter = {
  name: string; category: PhotonCategory; description: string;
  maxHp: number; durability: number; guardSeconds: number; cooldownSeconds: number;
  bonusPointSeconds: number | null; healAmount: number; healCooldownSeconds: number;
  edgeWrap: boolean; missDamage: number; obstacleSpeed: number; pointMultiplier: number; turnDelaySeconds: number;
  saberInputDelaySeconds: number; spikeDamage: number; barrelSpeed: number; wireTwist: boolean;
  invertedControls: boolean; needleTeleport: boolean;
};
const STANDARD_MOVEMENT = {
  edgeWrap: false, missDamage: .5, obstacleSpeed: 1, pointMultiplier: 1, turnDelaySeconds: 0,
  saberInputDelaySeconds: 0, spikeDamage: 1, barrelSpeed: 1, wireTwist: false,
  invertedControls: false, needleTeleport: false,
} as const;
/** Never add these to the ordinary Skyway character/extraction catalog. */
export const PHOTON_CHARACTERS: Record<PhotonCharacterKey, PhotonCharacter> = {
  photon_magician: {
    ...STANDARD_MOVEMENT,
    name: "Magician", category: "traditional",
    description: "Earn 1 bonus point for every full 40 seconds of active play. Bonus points count toward your final Photon reward.",
    maxHp: 4, durability: 7, guardSeconds: .4, cooldownSeconds: 1.5,
    bonusPointSeconds: 40, healAmount: 0, healCooldownSeconds: 0,
  },
  photon_tick: {
    ...STANDARD_MOVEMENT,
    name: "Tick", category: "traditional",
    description: "Guard for 0.5 seconds, with a 1.2-second Lightsaber cooldown.",
    maxHp: 4, durability: 7, guardSeconds: .5, cooldownSeconds: 1.2,
    bonusPointSeconds: null, healAmount: 0, healCooldownSeconds: 0,
  },
  photon_trumpet: {
    ...STANDARD_MOVEMENT,
    name: "Trumpet", category: "traditional",
    description: "Start with 5 HP and 12 Lightsaber durability. Your Lightsaber cooldown is 1.2 seconds.",
    maxHp: 5, durability: 12, guardSeconds: .4, cooldownSeconds: 1.2,
    bonusPointSeconds: null, healAmount: 0, healCooldownSeconds: 0,
  },
  photon_saxophone: {
    ...STANDARD_MOVEMENT,
    name: "Saxophone", category: "traditional",
    description: "Press E to heal 0.5 HP every 25 seconds while your Lightsaber is intact. Your Lightsaber has 5 durability and a 0.2-second cooldown.",
    maxHp: 4, durability: 5, guardSeconds: .4, cooldownSeconds: .2,
    bonusPointSeconds: null, healAmount: .5, healCooldownSeconds: 25,
  },
  photon_wizard: {
    ...STANDARD_MOVEMENT, edgeWrap: true, missDamage: 0,
    name: "Wizard", category: "rush",
    description: "Wrap between the outside lanes with no cooldown: move left from the left edge or right from the right edge. Missing a Lightsaber swing costs no HP.",
    maxHp: 4, durability: 7, guardSeconds: .4, cooldownSeconds: 1.5,
    bonusPointSeconds: null, healAmount: 0, healCooldownSeconds: 0,
  },
  photon_burner: {
    ...STANDARD_MOVEMENT, obstacleSpeed: 1.3, pointMultiplier: 2, turnDelaySeconds: .05,
    name: "Burner", category: "rush",
    description: "Obstacles move 30% faster. Reflections earn twice the points before Photons are calculated. Each turn is delayed by 0.05 seconds. Guard for 0.3 seconds, with a 2-second Lightsaber cooldown.",
    maxHp: 4, durability: 7, guardSeconds: .3, cooldownSeconds: 2,
    bonusPointSeconds: null, healAmount: 0, healCooldownSeconds: 0,
  },
  photon_bluff: {
    ...STANDARD_MOVEMENT, saberInputDelaySeconds: .15, spikeDamage: .5,
    name: "Bluff", category: "strategic",
    description: "Start with 5 HP; spikes deal only 0.5 HP. Your Lightsaber activates 0.15 seconds after pressing Q and guards for 0.3 seconds.",
    maxHp: 5, durability: 7, guardSeconds: .3, cooldownSeconds: 1.5,
    bonusPointSeconds: null, healAmount: 0, healCooldownSeconds: 0,
  },
  photon_magnet: {
    ...STANDARD_MOVEMENT,
    name: "Magnet", category: "strategic",
    description: "Spawns: Rock 10%, Car 10%, Needle 10%, Log 15%, Spike 25%, Barrel 20%, Warpstone 10%. Collect a Warpstone to teleport to a random lane and gain 3 points. Touching one while your Lightsaber is guarding kills you with no points.",
    maxHp: 4, durability: 7, guardSeconds: .4, cooldownSeconds: 1.5,
    bonusPointSeconds: null, healAmount: 0, healCooldownSeconds: 0,
  },
  photon_bear: {
    ...STANDARD_MOVEMENT, obstacleSpeed: 1.05,
    name: "Bear", category: "strategic",
    description: "Normal: hazards move 5% faster; Needles cause no debuff and give 1 point on contact or 2 when reflected. Every 30 active seconds, a paused 3-second countdown begins 10 seconds of Chaos: hazards move 45% faster, deal double damage, and reflections give 3 points. Chaos Needles deal 1 HP on contact with no points, or give 3 points when reflected. Heal 0.5 HP after each Chaos, up to 4 HP.",
    maxHp: 4, durability: 7, guardSeconds: .4, cooldownSeconds: 1.5,
    bonusPointSeconds: null, healAmount: 0, healCooldownSeconds: 0,
  },
  photon_wrench: {
    ...STANDARD_MOVEMENT, barrelSpeed: 1.1, wireTwist: true,
    name: "Wrench", category: "strategic",
    description: "E: WIRE TWIST turns the obstacle in your lane into a barrel, with a 15-second cooldown. An empty lane uses no cooldown. Barrels move 10% faster. Your Lightsaber guards for 0.9 seconds, with a 3.5-second cooldown. Each reflection has an 85% chance of 1 point and a 15% chance of 2 points.",
    maxHp: 4, durability: 7, guardSeconds: .9, cooldownSeconds: 3.5,
    bonusPointSeconds: null, healAmount: 0, healCooldownSeconds: 0,
  },
  photon_oyster: {
    ...STANDARD_MOVEMENT, obstacleSpeed: .92, invertedControls: true, needleTeleport: true,
    name: "Oyster", category: "wild",
    description: "All hazards move 8% slower. Needles teleport you to a random lane instead of applying their usual effect. Controls are reversed: A, left arrow, and the left on-screen button move right; D, right arrow, and the right button move left. Swipes and lane taps are reversed too.",
    maxHp: 4, durability: 7, guardSeconds: .4, cooldownSeconds: 1.5,
    bonusPointSeconds: null, healAmount: 0, healCooldownSeconds: 0,
  },
};
export const isPhotonCharacterKey = (key: unknown): key is PhotonCharacterKey =>
  typeof key === "string" && Object.prototype.hasOwnProperty.call(PHOTON_CHARACTERS, key);
export const getPhotonCharacter = (key: PhotonCharacterKey): PhotonCharacter => {
  if (!isPhotonCharacterKey(key)) throw new Error("Choose a Photon Fury character.");
  return PHOTON_CHARACTERS[key];
};
export const PHOTON_WEIGHTS = { rock: 10, needle: 10, car: 15, log: 15, spike: 25, barrel: 25 } as const;
export const MAGNET_WEIGHTS = { rock: 10, car: 10, needle: 10, log: 15, spike: 25, barrel: 20, warpstone: 10 } as const;
export type PhotonHazard = keyof typeof MAGNET_WEIGHTS;
export type PhotonItem = { id: number; kind: PhotonHazard; lane: number; y: number };
export type PhotonRun = {
  characterKey: PhotonCharacterKey; healCooldownUntil: number;
  wireCooldownUntil: number; saberStartsAt: number | null;
  extraPoints: number;
  stage: "normal" | "chaos"; stageEndsAt: number; chaosCountdown: number; stageNoticeUntil: number;
  pendingTurn: { lane: number; at: number } | null;
  elapsed: number; hp: number; lane: number; reflections: number; durability: number;
  guardUntil: number; cooldownUntil: number; needleUntil: number;
  lastHitAt: number; nextSpawnAt: number; nextId: number; items: PhotonItem[];
};
export const createPhotonRun = (characterKey: PhotonCharacterKey = "photon_magician"): PhotonRun => ({
  characterKey, healCooldownUntil: 0, pendingTurn: null,
  wireCooldownUntil: 0, saberStartsAt: null, extraPoints: 0,
  stage: "normal", stageEndsAt: 30, chaosCountdown: 0, stageNoticeUntil: 0,
  elapsed: 0, hp: getPhotonCharacter(characterKey).maxHp, lane: 1, reflections: 0,
  durability: getPhotonCharacter(characterKey).durability,
  guardUntil: 0, cooldownUntil: 0, needleUntil: 0,
  lastHitAt: -10, nextSpawnAt: 0.6, nextId: 1, items: [],
});
export const multiplyBonuses = (...multipliers: number[]) => multipliers.reduce((a, b) => a * b, 1);
export const addTurnDelays = (...seconds: number[]) => seconds.reduce((a, b) => a + b, 0);
export const photonSpeed = (elapsed: number) => 1.004 ** Math.max(0, elapsed);
export const photonObstacleSpeed = (run: PhotonRun) => photonSpeed(run.elapsed) * (run.characterKey === "photon_bear" && run.stage === "chaos" ? 1.45 : getPhotonCharacter(run.characterKey).obstacleSpeed);
export const photonReward = (points: number) => {
  if (!Number.isFinite(points)) return 0;
  const p = Math.max(0, Math.floor(points));
  return p >= 4 ? (p - 4) ** 2 + 1 : 0;
};
export const photonBonusPoints = (run: PhotonRun) => {
  const seconds = getPhotonCharacter(run.characterKey).bonusPointSeconds;
  return seconds ? Math.floor(Math.max(0, run.elapsed) / seconds) : 0;
};
export const photonPoints = (run: PhotonRun) => run.reflections * getPhotonCharacter(run.characterKey).pointMultiplier + run.extraPoints;
export const photonTotalPoints = (run: PhotonRun) => photonPoints(run) + photonBonusPoints(run);
export const photonRunReward = (run: PhotonRun) => photonReward(photonTotalPoints(run));
export const healPhoton = (run: PhotonRun): PhotonRun => {
  const character = getPhotonCharacter(run.characterKey);
  if (!character.healAmount || run.hp <= 0 || run.chaosCountdown > 0 || run.hp >= character.maxHp || run.durability <= 0 || run.elapsed < run.healCooldownUntil) return run;
  return { ...run, hp: Math.min(character.maxHp, run.hp + character.healAmount), healCooldownUntil: run.elapsed + character.healCooldownSeconds };
};
export const photonControlsLocked = (run: PhotonRun) => run.hp <= 0 || run.chaosCountdown > 0;
export const wireTwistPhoton = (run: PhotonRun): PhotonRun => {
  if (!getPhotonCharacter(run.characterKey).wireTwist || photonControlsLocked(run) || run.elapsed < run.wireCooldownUntil) return run;
  const target = run.items.filter(item => item.lane === run.lane).sort((a,b) => b.y-a.y)[0];
  if (!target) return run;
  return {
    ...run, wireCooldownUntil: run.elapsed + 15,
    items: run.items.map(item => item.id === target.id ? { ...item, kind: "barrel" } : item),
  };
};
export const pickPhotonHazard = (random: number, characterKey?: PhotonCharacterKey): PhotonHazard => {
  let remaining = Math.max(0, Math.min(0.999999, random)) * 100;
  for (const [kind, weight] of Object.entries(characterKey === "photon_magnet" ? MAGNET_WEIGHTS : PHOTON_WEIGHTS)) {
    remaining -= weight;
    if (remaining < 0) return kind as PhotonHazard;
  }
  return "barrel";
};
export const activatePhotonSaber = (run: PhotonRun): PhotonRun => {
  if (photonControlsLocked(run) || run.durability <= 0 || run.guardUntil > 0 || run.saberStartsAt !== null || run.elapsed < run.cooldownUntil) return run;
  const character = getPhotonCharacter(run.characterKey);
  return character.saberInputDelaySeconds > 0
    ? { ...run, saberStartsAt: run.elapsed + character.saberInputDelaySeconds }
    : { ...run, guardUntil: run.elapsed + character.guardSeconds };
};
const completePhotonTurn = (run: PhotonRun, lane: number, random: number): PhotonRun => ({
  ...run, lane, pendingTurn: null,
  hp: Math.max(0, run.hp - (run.needleUntil > run.elapsed && random < PHOTON_RULES.needleDamageChance ? .5 : 0)),
});
export const movePhoton = (run: PhotonRun, direction: number, random: number): PhotonRun => {
  if (photonControlsLocked(run) || run.pendingTurn) return run;
  const character = getPhotonCharacter(run.characterKey);
  const step = Math.sign(direction) * (character.invertedControls ? -1 : 1);
  const destination = run.lane + step;
  const lane = character.edgeWrap && step !== 0 ? (destination + 4) % 4 : Math.max(0, Math.min(3, destination));
  if (lane === run.lane) return run;
  if (character.turnDelaySeconds > 0) return { ...run, pendingTurn: { lane, at: run.elapsed + character.turnDelaySeconds } };
  return completePhotonTurn(run, lane, random);
};
const DAMAGE: Record<PhotonHazard, number> = { rock: 2, needle: 0, car: 1, log: 1, spike: 1, barrel: .5, warpstone: 0 };
const SPEED: Record<PhotonHazard, number> = { rock: .35, needle: 1, car: 1.25, log: .72, spike: 1, barrel: 1.5, warpstone: 1 };
const reflectionBonus = (run: PhotonRun, kind: PhotonHazard, random: () => number) => {
  if (run.characterKey === "photon_bear") return run.stage === "chaos" ? 2 : kind === "needle" ? 1 : 0;
  if (run.characterKey === "photon_wrench") return random() >= .85 ? 1 : 0;
  return 0;
};
/** dt is ACTIVE time only. Pauses and open menus must never advance this clock. */
export const advancePhotonRun = (previous: PhotonRun, dt: number, random: () => number = Math.random): PhotonRun => {
  if (previous.hp <= 0 || dt <= 0) return previous;
  const character = getPhotonCharacter(previous.characterKey);
  const bear = previous.characterKey === "photon_bear";
  if (bear && previous.chaosCountdown > 0) {
    const countdown = previous.chaosCountdown - Math.min(dt, .05);
    const remaining = countdown < 1e-9 ? 0 : countdown;
    return {
      ...previous, chaosCountdown: remaining,
      ...(remaining === 0 ? { stage: "chaos" as const, stageEndsAt: previous.elapsed + 10, stageNoticeUntil: previous.elapsed + 2 } : {}),
    };
  }
  const step = Math.min(dt, .05, bear ? previous.stageEndsAt - previous.elapsed : Infinity);
  let run = { ...previous, items: previous.items.map(item => ({ ...item })), elapsed: previous.elapsed + step };
  if (run.pendingTurn && run.elapsed >= run.pendingTurn.at) {
    run = completePhotonTurn(run, run.pendingTurn.lane, random());
    if (run.hp <= 0) return run;
  }
  if (run.saberStartsAt !== null && run.elapsed >= run.saberStartsAt) {
    run.guardUntil = run.saberStartsAt + character.guardSeconds;
    run.saberStartsAt = null;
  }
  const travel = step * .24 * photonObstacleSpeed(run);
  // Spawn at most three occupied lanes. Nothing can overtake another object in a lane.
  if (run.elapsed >= run.nextSpawnAt) {
    const free = [0, 1, 2, 3].filter(lane => !run.items.some(item => item.lane === lane));
    if (free.length > 1) run.items.push({ id: run.nextId++, kind: pickPhotonHazard(random(),run.characterKey), lane: free[Math.floor(random() * free.length)], y: -.12 });
    run.nextSpawnAt = run.elapsed + .65 / Math.sqrt(photonSpeed(run.elapsed));
  }
  const remaining: PhotonItem[] = [];
  for (const item of run.items) {
    item.y += travel * SPEED[item.kind] * (item.kind === "barrel" ? character.barrelSpeed : 1);
    if (run.hp <= 0) { if (item.y <= 1.15) remaining.push(item); continue; }
    if (item.lane === run.lane && item.y >= .73 && item.y <= .88) {
      if (item.kind === "warpstone") {
        if (run.guardUntil > run.elapsed) {
          run.hp = 0; run.guardUntil = 0; run.saberStartsAt = null;
        } else {
          run.lane = Math.min(3, Math.floor(Math.max(0,random()) * 4));
          run.pendingTurn = null; run.extraPoints += 3;
        }
        continue;
      }
      if (run.guardUntil > run.elapsed) {
        run.reflections += 1;
        run.extraPoints += reflectionBonus(run,item.kind,random);
        run.durability -= item.kind === "car" ? 1 : 0;
        run.guardUntil = 0;
        run.cooldownUntil = run.elapsed + character.cooldownSeconds;
        continue; // Exactly one block per swing; the next item cannot be reflected.
      }
      if (item.kind === "needle") {
        if (character.needleTeleport) {
          run.lane = Math.min(3, Math.floor(Math.max(0,random()) * 4));
          run.pendingTurn = null;
          continue;
        }
        if (!bear) { run.needleUntil = Math.max(run.elapsed, run.needleUntil) + 4; continue; }
        if (run.stage === "normal") { run.extraPoints += 1; continue; }
      }
      if (run.elapsed - run.lastHitAt >= .8) {
        const damage = item.kind === "needle" && bear ? 1 : (item.kind === "spike" ? character.spikeDamage : DAMAGE[item.kind]) * (bear && run.stage === "chaos" ? 2 : 1);
        run.hp = Math.max(0, run.hp - damage);
        run.lastHitAt = run.elapsed;
        continue;
      }
    }
    if (item.y <= 1.15) remaining.push(item);
  }
  run.items = remaining;
  if (run.guardUntil > 0 && run.elapsed >= run.guardUntil) {
    run.cooldownUntil = run.guardUntil + character.cooldownSeconds;
    run.guardUntil = 0;
    run.hp = Math.max(0, run.hp - character.missDamage);
  }
  if (bear && run.elapsed >= run.stageEndsAt) {
    if (run.stage === "normal") run.chaosCountdown = 3;
    else {
      run.stage = "normal"; run.stageEndsAt = run.elapsed + 30; run.stageNoticeUntil = run.elapsed + 2;
      if (run.hp > 0) run.hp = Math.min(character.maxHp,run.hp + .5);
    }
  }
  return run;
};
