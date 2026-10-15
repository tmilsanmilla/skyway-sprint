/** Photon-only rules. All clocks use active gameplay, never menu/pause time. */
export const PHOTON_RULES = {
  version: 20261014,
  lanes: 4,
  unlockLevel: 15,
  price: 225,
  startingHp: 4,
  durability: 7,
  guardSeconds: 0.4,
  cooldownSeconds: 1,
  inputDelaySeconds: 0.1,
  needleSeconds: 4,
  needleDamageChance: 0.35,
  // The former 0.288 baseline is 35% faster, presented as the new 1×.
  baseTravelSpeed: 0.288 * 1.35,
  speedGrowth: 1.004,
} as const;
export const PHOTON_CATEGORIES = [
  "traditional",
  "rush",
  "strategic",
  "wild",
] as const;
export type PhotonCategory = (typeof PHOTON_CATEGORIES)[number];
export type PhotonCharacterKey =
  | "photon_magician"
  | "photon_tick"
  | "photon_trumpet"
  | "photon_saxophone"
  | "photon_wizard"
  | "photon_nuclear"
  | "photon_burner"
  | "photon_bull"
  | "photon_bluff"
  | "photon_magnet"
  | "photon_bear"
  | "photon_wrench"
  | "photon_bell"
  | "photon_static"
  | "photon_oyster"
  | "photon_spade";
export const PHOTON_STARTERS: readonly PhotonCharacterKey[] = [
  "photon_magician",
  "photon_wizard",
  "photon_bluff",
  "photon_bell",
];
export type PhotonAbility =
  "none" | "heal" | "bomb" | "dash" | "time-stop" | "wire-twist" | "chime";
type PhotonCharacter = {
  name: string;
  category: PhotonCategory;
  description: string;
  maxHp: number;
  durability: number;
  guardSeconds: number;
  cooldownSeconds: number;
  bonusPointSeconds: number | null;
  healAmount: number;
  healCooldownSeconds: number;
  edgeWrap: boolean;
  missDamage: number;
  obstacleSpeed: number;
  pointMultiplier: number;
  turnDelaySeconds: number;
  saberInputDelaySeconds: number;
  spikeDamage: number;
  barrelSpeed: number;
  wireTwist: boolean;
  invertedControls: boolean;
  needleTeleport: boolean;
  ability: PhotonAbility;
  abilityCooldown: number;
};
const STANDARD: Omit<PhotonCharacter, "name" | "category" | "description"> = {
  maxHp: 4,
  durability: 7,
  guardSeconds: 0.4,
  cooldownSeconds: 1,
  bonusPointSeconds: null,
  healAmount: 0,
  healCooldownSeconds: 0,
  edgeWrap: false,
  missDamage: 0.5,
  obstacleSpeed: 1,
  pointMultiplier: 1,
  turnDelaySeconds: 0,
  saberInputDelaySeconds: 0.1,
  spikeDamage: 1,
  barrelSpeed: 1,
  wireTwist: false,
  invertedControls: false,
  needleTeleport: false,
  ability: "none",
  abilityCooldown: 0,
};
const character = (
  name: string,
  category: PhotonCategory,
  description: string,
  changes: Partial<PhotonCharacter> = {},
): PhotonCharacter => ({
  ...STANDARD,
  name,
  category,
  description,
  ...changes,
});
export const PHOTON_CHARACTERS: Record<PhotonCharacterKey, PhotonCharacter> = {
  photon_magician: character(
    "Magician",
    "traditional",
    "Earn 1 bonus point per complete 45 seconds of active play.",
    { bonusPointSeconds: 45 },
  ),
  photon_tick: character(
    "Tick",
    "traditional",
    "Guard for 0.5 seconds; weapon cooldown is 0.8 seconds.",
    { guardSeconds: 0.5, cooldownSeconds: 0.8 },
  ),
  photon_trumpet: character(
    "Trumpet",
    "traditional",
    "Start with 5 HP and 12 durability; weapon cooldown is 0.8 seconds.",
    { maxHp: 5, durability: 12, cooldownSeconds: 0.8 },
  ),
  photon_saxophone: character(
    "Saxophone",
    "traditional",
    "E: heal 0.5 HP every 25 seconds with an intact weapon; each heal has a 10% chance to use 1 durability. Weapon input delay is 0.25 seconds and cooldown is 1.2 seconds.",
    {
      healAmount: 0.5,
      healCooldownSeconds: 25,
      saberInputDelaySeconds: 0.25,
      cooldownSeconds: 1.2,
      ability: "heal",
      abilityCooldown: 25,
    },
  ),
  photon_wizard: character(
    "Wizard",
    "rush",
    "Wrap between outside lanes while your weapon has at least 3 durability. Misses cost no HP, but still use 1 durability.",
    { edgeWrap: true, missDamage: 0 },
  ),
  photon_nuclear: character(
    "Nuclear",
    "rush",
    "E: REACTOR BOMB leaves only one random hazard, costs 0.5 HP, and has a 15-second cooldown. Weapon input delay is removed.",
    { saberInputDelaySeconds: 0, ability: "bomb", abilityCooldown: 15 },
  ),
  photon_burner: character(
    "Burner",
    "rush",
    "Hazards move 30% faster and earned points double before the reward formula. Turns wait 0.05 seconds; guard is 0.3 seconds and cooldown is 2 seconds.",
    {
      obstacleSpeed: 1.3,
      pointMultiplier: 2,
      turnDelaySeconds: 0.05,
      guardSeconds: 0.3,
      cooldownSeconds: 2,
    },
  ),
  photon_bull: character(
    "Bull",
    "rush",
    "E dashes two lanes right; W dashes two lanes left, skipping the middle lane. Rocks and spikes are 25% faster, barrels 15% slower, logs 20% slower. Weapon cooldown is 2 seconds.",
    { cooldownSeconds: 2, ability: "dash" },
  ),
  photon_bluff: character(
    "Bluff",
    "strategic",
    "Start with 5 HP; spikes deal 0.5 HP. Weapon input delay is 0.15 seconds and guard is 0.3 seconds.",
    {
      maxHp: 5,
      spikeDamage: 0.5,
      saberInputDelaySeconds: 0.15,
      guardSeconds: 0.3,
    },
  ),
  photon_magnet: character(
    "Magnet",
    "strategic",
    "Warpstones teleport you and give 3 points, but touching one while guarding is fatal. E: HALT pauses until you choose another lane with Z/X/C/V; then a 25-second cooldown starts, with a 40% chance to restore 1 durability up to 7.",
    { ability: "time-stop", abilityCooldown: 25 },
  ),
  photon_bear: character(
    "Bear",
    "strategic",
    "Normal lasts 60 active seconds: hazards are 5% faster; needles give 1 contact point or 2 reflected points. A paused 3-second countdown starts 10 seconds of Chaos: hazards are 45% faster, damage doubles and reflections give 3 points. Chaos needles deal 1 HP plus their normal debuff on contact. Heal 0.5 HP after Chaos, then pause for a 3-second countdown back to Normal. Needles never use durability.",
    { obstacleSpeed: 1.05 },
  ),
  photon_wrench: character(
    "Wrench",
    "strategic",
    "E: WIRE TWIST changes the nearest hazard in your lane into a barrel every 15 seconds; empty lanes use no cooldown. Barrels are 7% faster. Guard is 0.9 seconds and cooldown is 2 seconds. Each reflection has a 4% chance per remaining durability to give 2 points instead of 1.",
    {
      barrelSpeed: 1.07,
      guardSeconds: 0.9,
      cooldownSeconds: 2,
      wireTwist: true,
      ability: "wire-twist",
      abilityCooldown: 15,
    },
  ),
  photon_bell: character(
    "Bell",
    "wild",
    "Start with 3 HP. Grazing an adjacent needle deletes it and heals 0.5 HP; needles are 35% faster. E: RESONANT CHIME deletes one random hazard every 20 seconds.",
    { maxHp: 3, ability: "chime", abilityCooldown: 20 },
  ),
  photon_static: character(
    "Static",
    "wild",
    "Each lane change in the last 20 seconds adds 5% hazard speed; changes 20–30 seconds ago add 2%. Misses cost 1 HP. Turns wait 0.05 seconds; reflected rocks give 2 points.",
    { missDamage: 1, turnDelaySeconds: 0.05 },
  ),
  photon_oyster: character(
    "Oyster",
    "wild",
    "Hazards are 8% slower. Needles teleport you instead of applying their debuff. Left/right keys, buttons, swipes and lane taps are reversed.",
    { obstacleSpeed: 0.92, invertedControls: true, needleTeleport: true },
  ),
  photon_spade: character(
    "Spade",
    "wild",
    "After staying in one lane for 2 seconds, lose 0.5 HP each additional second. Weapon cooldown is 1.4 seconds. Each successful reflection has a 4% chance per remaining durability to heal 0.5 HP.",
    { cooldownSeconds: 1.4 },
  ),
};
export const isPhotonCharacterKey = (key: unknown): key is PhotonCharacterKey =>
  typeof key === "string" && Object.hasOwn(PHOTON_CHARACTERS, key);
export const getPhotonCharacter = (key: PhotonCharacterKey) => {
  if (!isPhotonCharacterKey(key))
    throw new Error("Choose a Photon Fury character.");
  return PHOTON_CHARACTERS[key];
};
export const getOwnedPhotonCharacters = (
  unlocked: boolean,
  keys: unknown,
): PhotonCharacterKey[] =>
  unlocked
    ? Array.from(
        new Set([
          ...PHOTON_STARTERS,
          ...(Array.isArray(keys) ? keys.filter(isPhotonCharacterKey) : []),
        ]),
      )
    : [];
export const resolveOwnedPhotonCharacter = (
  selected: unknown,
  owned: readonly PhotonCharacterKey[],
): PhotonCharacterKey =>
  isPhotonCharacterKey(selected) && owned.includes(selected)
    ? selected
    : "photon_magician";
export const PHOTON_WEIGHTS = {
  rock: 10,
  needle: 10,
  car: 15,
  log: 15,
  spike: 25,
  barrel: 25,
} as const;
export const MAGNET_WEIGHTS = {
  rock: 10,
  car: 10,
  needle: 10,
  log: 15,
  spike: 25,
  barrel: 20,
  warpstone: 10,
} as const;
export type PhotonHazard = keyof typeof MAGNET_WEIGHTS;
export type PhotonItem = {
  id: number;
  kind: PhotonHazard;
  lane: number;
  y: number;
};
export type PhotonWeaponKey =
  | "lightsaber"
  | "photon_blaster"
  | "ninjablade"
  | "magnetite_sword"
  | "concentrated_laser"
  | "jolt_shockwave";
export const PHOTON_WEAPONS = {
  lightsaber: {
    name: "Lightsaber",
    photons: 0,
    gems: 0,
    description:
      "Reflect one hazard per swing. Cars, needles and missed swings use 1 durability.",
  },
  photon_blaster: {
    name: "Photon Blaster",
    photons: 13000,
    gems: 390,
    description:
      "Barrel contact is harmless, with a 10% chance to repair 1 durability while intact. Reflected barrels give 3 points; cars deal 2 HP.",
  },
  ninjablade: {
    name: "Ninjablade",
    photons: 8000,
    gems: 240,
    description:
      "Each lane change has a 15% chance to use 1 durability. Earned points double at 1 HP or less.",
  },
  magnetite_sword: {
    name: "Magnetite Sword",
    photons: 5000,
    gems: 150,
    description:
      "Rock contact gives 1 point without damage; reflected rocks give 3 points. Spikes deal 2 HP and barrels deal 1 HP.",
  },
  concentrated_laser: {
    name: "Concentrated Laser",
    photons: 6000,
    gems: 180,
    description:
      "Needles are 40% faster and contact is fatal. F: PRECISION ERASE lets you tap one rock, barrel, log, car or spike to remove it, costing 1 durability with a 25-second cooldown.",
  },
  jolt_shockwave: {
    name: "Jolt Shockwave",
    photons: 9000,
    gems: 270,
    description:
      "Each lane change has a 65% chance to give 1 point and a separate 15% chance to deal 0.5 HP. Its Photon reward starts at 14 points using its own reward curve.",
  },
} as const;
export const isPhotonWeaponKey = (key: unknown): key is PhotonWeaponKey =>
  typeof key === "string" && Object.hasOwn(PHOTON_WEAPONS, key);
export const isPhotonWeaponCompatible = (
  weapon: PhotonWeaponKey,
  character: PhotonCharacterKey,
) =>
  !(
    ["photon_blaster", "magnetite_sword", "concentrated_laser"].includes(
      weapon,
    ) && ["photon_bear", "photon_magnet"].includes(character)
  );
export type PhotonRun = {
  characterKey: PhotonCharacterKey;
  weaponKey: PhotonWeaponKey;
  healCooldownUntil: number;
  wireCooldownUntil: number;
  abilityCooldownUntil: number;
  laserCooldownUntil: number;
  laserTargeting: boolean;
  timeStop: boolean;
  saberStartsAt: number | null;
  extraPoints: number;
  stage: "normal" | "chaos";
  nextStage: "normal" | "chaos";
  stageEndsAt: number;
  chaosCountdown: number;
  stageNoticeUntil: number;
  pendingTurn: { lane: number; at: number } | null;
  elapsed: number;
  hp: number;
  lane: number;
  reflections: number;
  durability: number;
  guardUntil: number;
  cooldownUntil: number;
  needleUntil: number;
  lastHitAt: number;
  nextSpawnAt: number;
  nextId: number;
  items: PhotonItem[];
  laneChangedAt: number;
  idleDamageTicks: number;
  laneChangeTimes: number[];
  moveCount: number;
  weaponShockAt: number;
};
export const createPhotonRun = (
  characterKey: PhotonCharacterKey = "photon_magician",
  weaponKey: PhotonWeaponKey = "lightsaber",
): PhotonRun => {
  const c = getPhotonCharacter(characterKey);
  if (
    !isPhotonWeaponKey(weaponKey) ||
    !isPhotonWeaponCompatible(weaponKey, characterKey)
  )
    throw new Error("Weapon is incompatible with this Photon character.");
  return {
    characterKey,
    weaponKey,
    healCooldownUntil: 0,
    wireCooldownUntil: 0,
    abilityCooldownUntil: 0,
    laserCooldownUntil: 0,
    laserTargeting: false,
    timeStop: false,
    saberStartsAt: null,
    extraPoints: 0,
    stage: "normal",
    nextStage: "chaos",
    stageEndsAt: 60,
    chaosCountdown: 0,
    stageNoticeUntil: 0,
    pendingTurn: null,
    elapsed: 0,
    hp: c.maxHp,
    lane: 1,
    reflections: 0,
    durability: c.durability,
    guardUntil: 0,
    cooldownUntil: 0,
    needleUntil: 0,
    lastHitAt: -10,
    nextSpawnAt: 0.6,
    nextId: 1,
    items: [],
    laneChangedAt: 0,
    idleDamageTicks: 0,
    laneChangeTimes: [],
    moveCount: 0,
    weaponShockAt: -10,
  };
};
export const multiplyBonuses = (...multipliers: number[]) =>
  multipliers.reduce((a, b) => a * b, 1);
export const addTurnDelays = (...seconds: number[]) =>
  seconds.reduce((a, b) => a + b, 0);
export const photonSpeed = (elapsed: number) =>
  PHOTON_RULES.speedGrowth ** Math.max(0, elapsed);
export const photonGuardSeconds = (run: PhotonRun) =>
  getPhotonCharacter(run.characterKey).guardSeconds;
export const photonObstacleSpeed = (run: PhotonRun) =>
  photonSpeed(run.elapsed) *
  (run.characterKey === "photon_bear" && run.stage === "chaos"
    ? 1.45
    : getPhotonCharacter(run.characterKey).obstacleSpeed) *
  (run.characterKey === "photon_static"
    ? 1 +
      run.laneChangeTimes.reduce(
        (n, t) =>
          n + (run.elapsed - t <= 20 ? 0.05 : run.elapsed - t <= 30 ? 0.02 : 0),
        0,
      )
    : 1);
export const photonReward = (
  points: number,
  weapon: PhotonWeaponKey = "lightsaber",
) => {
  if (!Number.isFinite(points)) return 0;
  const p = Math.max(0, Math.floor(points));
  return weapon === "jolt_shockwave"
    ? p >= 14
      ? 2 * (p - 14) ** 2 + 1
      : 0
    : p >= 4
      ? (p - 4) ** 2 + 1
      : 0;
};
export const photonBonusPoints = (run: PhotonRun) => {
  const s = getPhotonCharacter(run.characterKey).bonusPointSeconds;
  return s
    ? Math.floor(Math.max(0, run.elapsed) / s) *
        (run.weaponKey === "ninjablade" && run.hp > 0 && run.hp <= 1 ? 2 : 1)
    : 0;
};
export const photonPoints = (run: PhotonRun) =>
  run.reflections * getPhotonCharacter(run.characterKey).pointMultiplier +
  run.extraPoints;
export const photonTotalPoints = (run: PhotonRun) =>
  photonPoints(run) + photonBonusPoints(run);
export const photonRunReward = (run: PhotonRun) =>
  photonReward(photonTotalPoints(run), run.weaponKey);
export const photonControlsLocked = (run: PhotonRun) =>
  run.hp <= 0 || run.chaosCountdown > 0 || run.timeStop;
const loseDurability = (run: PhotonRun, amount = 1) => {
  run.durability = Math.max(0, run.durability - amount);
  if (run.durability === 0) {
    run.guardUntil = 0;
    run.saberStartsAt = null;
  }
};
const pointMultiplier = (run: PhotonRun) =>
  getPhotonCharacter(run.characterKey).pointMultiplier *
  (run.weaponKey === "ninjablade" && run.hp > 0 && run.hp <= 1 ? 2 : 1);
const awardPoints = (run: PhotonRun, amount: number) => {
  run.extraPoints += amount * pointMultiplier(run);
};
export const healPhoton = (
  run: PhotonRun,
  random: () => number = Math.random,
): PhotonRun => {
  const c = getPhotonCharacter(run.characterKey);
  if (
    !c.healAmount ||
    photonControlsLocked(run) ||
    run.hp >= c.maxHp ||
    run.durability <= 0 ||
    run.elapsed < run.healCooldownUntil
  )
    return run;
  const next = {
    ...run,
    hp: Math.min(c.maxHp, run.hp + c.healAmount),
    healCooldownUntil: run.elapsed + c.healCooldownSeconds,
  };
  if (random() < 0.1) loseDurability(next);
  return next;
};
export const wireTwistPhoton = (run: PhotonRun): PhotonRun => {
  if (
    !getPhotonCharacter(run.characterKey).wireTwist ||
    photonControlsLocked(run) ||
    run.elapsed < run.wireCooldownUntil
  )
    return run;
  const target = run.items
    .filter((item) => item.lane === run.lane)
    .sort((a, b) => b.y - a.y)[0];
  if (!target) return run;
  return {
    ...run,
    wireCooldownUntil: run.elapsed + 15,
    abilityCooldownUntil: run.elapsed + 15,
    items: run.items.map((item) =>
      item.id === target.id ? { ...item, kind: "barrel" } : item,
    ),
  };
};
export const activatePhotonAbility = (
  run: PhotonRun,
  random: () => number = Math.random,
): PhotonRun => {
  if (photonControlsLocked(run) || run.elapsed < run.abilityCooldownUntil)
    return run;
  const c = getPhotonCharacter(run.characterKey);
  if (c.ability === "heal") return healPhoton(run, random);
  if (c.ability === "wire-twist") return wireTwistPhoton(run);
  if (c.ability === "dash") return dashPhoton(run, 1, random);
  if (c.ability === "time-stop") return { ...run, timeStop: true };
  if (c.ability === "bomb") {
    const survivor = run.items.length
      ? run.items[
          Math.min(
            run.items.length - 1,
            Math.floor(random() * run.items.length),
          )
        ]
      : null;
    return {
      ...run,
      hp: Math.max(0, run.hp - 0.5),
      items: survivor ? [survivor] : [],
      abilityCooldownUntil: run.elapsed + 15,
    };
  }
  if (c.ability === "chime" && run.items.length) {
    const id =
      run.items[
        Math.min(run.items.length - 1, Math.floor(random() * run.items.length))
      ].id;
    return {
      ...run,
      items: run.items.filter((item) => item.id !== id),
      abilityCooldownUntil: run.elapsed + 20,
    };
  }
  return run;
};
const completePhotonTurn = (
  previous: PhotonRun,
  lane: number,
  random: () => number,
): PhotonRun => {
  if (lane === previous.lane) return previous;
  const run = {
    ...previous,
    lane,
    pendingTurn: null,
    laneChangedAt: previous.elapsed,
    idleDamageTicks: 0,
    laneChangeTimes: [
      ...previous.laneChangeTimes.filter((t) => previous.elapsed - t <= 30),
      previous.elapsed,
    ],
    moveCount: previous.moveCount + 1,
  };
  if (run.needleUntil > run.elapsed && random() < 0.35)
    run.hp = Math.max(0, run.hp - 0.5);
  if (run.weaponKey === "ninjablade" && run.durability > 0 && random() < 0.15)
    loseDurability(run);
  if (run.weaponKey === "jolt_shockwave") {
    if (random() < 0.65) awardPoints(run, 1);
    if (random() < 0.15) {
      run.hp = Math.max(0, run.hp - 0.5);
      run.weaponShockAt = run.elapsed;
    }
  }
  return run;
};
export const movePhoton = (
  run: PhotonRun,
  direction: number,
  random: number | (() => number),
): PhotonRun => {
  if (photonControlsLocked(run) || run.pendingTurn) return run;
  const c = getPhotonCharacter(run.characterKey),
    step = Math.sign(direction) * (c.invertedControls ? -1 : 1),
    destination = run.lane + step;
  const lane =
    c.edgeWrap && run.durability >= 3 && step !== 0
      ? (destination + 4) % 4
      : Math.max(0, Math.min(3, destination));
  if (lane === run.lane) return run;
  if (c.turnDelaySeconds > 0)
    return {
      ...run,
      pendingTurn: { lane, at: run.elapsed + c.turnDelaySeconds },
    };
  return completePhotonTurn(
    run,
    lane,
    typeof random === "number" ? () => random : random,
  );
};
export const dashPhoton = (
  run: PhotonRun,
  direction: number,
  random: () => number = Math.random,
): PhotonRun => {
  const lane = run.lane + 2 * Math.sign(direction);
  if (
    run.characterKey !== "photon_bull" ||
    photonControlsLocked(run) ||
    lane < 0 ||
    lane > 3 ||
    lane === run.lane
  )
    return run;
  return completePhotonTurn(run, lane, random);
};
export const selectPhotonTimeStopLane = (
  run: PhotonRun,
  lane: number,
  random: () => number = Math.random,
): PhotonRun => {
  if (
    !run.timeStop ||
    !Number.isInteger(lane) ||
    lane < 0 ||
    lane > 3 ||
    lane === run.lane
  )
    return run;
  const next = completePhotonTurn({ ...run, timeStop: false }, lane, random);
  next.abilityCooldownUntil = run.elapsed + 25;
  if (next.durability < 7 && random() < 0.4) next.durability += 1;
  return next;
};
export const armPhotonLaser = (run: PhotonRun): PhotonRun =>
  run.weaponKey === "concentrated_laser" &&
  !photonControlsLocked(run) &&
  run.durability > 0 &&
  run.elapsed >= run.laserCooldownUntil
    ? { ...run, laserTargeting: true }
    : run;
export const erasePhotonHazard = (run: PhotonRun, id: number): PhotonRun => {
  const item = run.items.find((item) => item.id === id);
  if (
    !run.laserTargeting ||
    !item ||
    !["rock", "barrel", "log", "car", "spike"].includes(item.kind) ||
    photonControlsLocked(run) ||
    run.durability <= 0
  )
    return run;
  const next = {
    ...run,
    laserTargeting: false,
    laserCooldownUntil: run.elapsed + 25,
    items: run.items.filter((item) => item.id !== id),
  };
  loseDurability(next);
  return next;
};
export const pickPhotonHazard = (
  random: number,
  characterKey?: PhotonCharacterKey,
): PhotonHazard => {
  let remaining = Math.max(0, Math.min(0.999999, random)) * 100;
  for (const [kind, weight] of Object.entries(
    characterKey === "photon_magnet" ? MAGNET_WEIGHTS : PHOTON_WEIGHTS,
  )) {
    remaining -= weight;
    if (remaining < 0) return kind as PhotonHazard;
  }
  return "barrel";
};
export const activatePhotonSaber = (run: PhotonRun): PhotonRun => {
  if (
    photonControlsLocked(run) ||
    run.durability <= 0 ||
    run.guardUntil > 0 ||
    run.saberStartsAt !== null ||
    run.elapsed < run.cooldownUntil
  )
    return run;
  const c = getPhotonCharacter(run.characterKey);
  return c.saberInputDelaySeconds > 0
    ? { ...run, saberStartsAt: run.elapsed + c.saberInputDelaySeconds }
    : { ...run, guardUntil: run.elapsed + photonGuardSeconds(run) };
};
const DAMAGE: Record<PhotonHazard, number> = {
  rock: 2,
  needle: 0,
  car: 1,
  log: 1,
  spike: 1,
  barrel: 0.5,
  warpstone: 0,
};
const SPEED: Record<PhotonHazard, number> = {
  rock: 0.35,
  needle: 1,
  car: 1.25,
  log: 0.72,
  spike: 1,
  barrel: 1.5,
  warpstone: 1,
};
export const photonHazardSpeed = (run: PhotonRun, kind: PhotonHazard) => {
  let m =
    kind === "barrel" ? getPhotonCharacter(run.characterKey).barrelSpeed : 1;
  if (run.characterKey === "photon_bull")
    m *=
      kind === "rock" || kind === "spike"
        ? 1.25
        : kind === "barrel"
          ? 0.85
          : kind === "log"
            ? 0.8
            : 1;
  if (run.characterKey === "photon_bell" && kind === "needle") m *= 1.35;
  if (run.weaponKey === "concentrated_laser" && kind === "needle") m *= 1.4;
  return (
    PHOTON_RULES.baseTravelSpeed * photonObstacleSpeed(run) * SPEED[kind] * m
  );
};
export const advancePhotonRun = (
  previous: PhotonRun,
  dt: number,
  random: () => number = Math.random,
): PhotonRun => {
  if (previous.hp <= 0 || !Number.isFinite(dt) || dt <= 0 || previous.timeStop)
    return previous;
  const c = getPhotonCharacter(previous.characterKey),
    bear = previous.characterKey === "photon_bear";
  if (bear && previous.chaosCountdown > 0) {
    const left = Math.max(0, previous.chaosCountdown - Math.min(dt, 0.05));
    return {
      ...previous,
      chaosCountdown: left < 1e-9 ? 0 : left,
      ...(left < 1e-9
        ? {
            stage: previous.nextStage,
            stageEndsAt:
              previous.elapsed + (previous.nextStage === "chaos" ? 10 : 60),
            stageNoticeUntil: previous.elapsed + 2,
          }
        : {}),
    };
  }
  const step = Math.min(
    dt,
    0.05,
    bear ? Math.max(0, previous.stageEndsAt - previous.elapsed) : Infinity,
  );
  let run = {
    ...previous,
    items: previous.items.map((item) => ({ ...item })),
    elapsed: previous.elapsed + step,
  };
  if (run.pendingTurn && run.elapsed >= run.pendingTurn.at)
    run = completePhotonTurn(run, run.pendingTurn.lane, random);
  if (run.hp <= 0) return run;
  if (run.saberStartsAt !== null && run.elapsed >= run.saberStartsAt) {
    run.guardUntil = run.saberStartsAt + c.guardSeconds;
    run.saberStartsAt = null;
  }
  if (run.elapsed >= run.nextSpawnAt) {
    const free = [0, 1, 2, 3].filter(
      (lane) => !run.items.some((item) => item.lane === lane),
    );
    if (free.length > 1)
      run.items.push({
        id: run.nextId++,
        kind: pickPhotonHazard(random(), run.characterKey),
        lane: free[
          Math.min(free.length - 1, Math.floor(random() * free.length))
        ],
        y: -0.12,
      });
    run.nextSpawnAt = run.elapsed + 0.65 / Math.sqrt(photonSpeed(run.elapsed));
  }
  const remaining: PhotonItem[] = [];
  for (const item of run.items) {
    const oldY = item.y;
    item.y += step * photonHazardSpeed(run, item.kind);
    if (run.hp <= 0) {
      if (item.y <= 1.15) remaining.push(item);
      continue;
    }
    if (
      run.characterKey === "photon_bell" &&
      item.kind === "needle" &&
      Math.abs(item.lane - run.lane) === 1 &&
      item.y >= 0.7 &&
      oldY <= 0.88
    ) {
      run.hp = Math.min(c.maxHp, run.hp + 0.5);
      continue;
    }
    if (item.lane === run.lane && item.y >= 0.73 && oldY <= 0.88) {
      if (item.kind === "warpstone") {
        if (run.guardUntil > run.elapsed) {
          run.hp = 0;
          run.guardUntil = 0;
          run.saberStartsAt = null;
        } else {
          const lane = Math.min(3, Math.floor(Math.max(0, random()) * 4));
          if (lane !== run.lane) run = completePhotonTurn(run, lane, random);
          awardPoints(run, 3);
        }
        continue;
      }
      if (run.guardUntil > run.elapsed) {
        if (
          item.kind === "car" ||
          (item.kind === "needle" && run.characterKey !== "photon_bear")
        )
          run.durability = Math.max(0, run.durability - 1);
        let points = bear
          ? run.stage === "chaos"
            ? 3
            : item.kind === "needle"
              ? 2
              : 1
          : 1;
        if (
          run.characterKey === "photon_wrench" &&
          random() < 0.04 * run.durability
        )
          points = 2;
        if (run.characterKey === "photon_static" && item.kind === "rock")
          points = 2;
        if (run.weaponKey === "photon_blaster" && item.kind === "barrel")
          points = 3;
        if (run.weaponKey === "magnetite_sword" && item.kind === "rock")
          points = 3;
        const awarded = points * pointMultiplier(run);
        run.reflections += 1;
        run.extraPoints += awarded - c.pointMultiplier;
        if (
          run.characterKey === "photon_spade" &&
          random() < 0.04 * run.durability
        )
          run.hp = Math.min(c.maxHp, run.hp + 0.5);
        run.guardUntil = 0;
        run.cooldownUntil = run.elapsed + c.cooldownSeconds;
        continue;
      }
      if (item.kind === "needle") {
        if (run.weaponKey === "concentrated_laser") {
          run.hp = 0;
          continue;
        }
        if (c.needleTeleport) {
          const lane = Math.min(3, Math.floor(Math.max(0, random()) * 4));
          if (lane !== run.lane) run = completePhotonTurn(run, lane, random);
          continue;
        }
        if (bear && run.stage === "normal") {
          awardPoints(run, 1);
          continue;
        }
        run.needleUntil = Math.max(run.elapsed, run.needleUntil) + 4;
        if (bear && run.stage === "chaos") {
          run.hp = Math.max(0, run.hp - 1);
          run.lastHitAt = run.elapsed;
        }
        continue;
      }
      if (run.weaponKey === "photon_blaster" && item.kind === "barrel") {
        if (
          run.durability > 0 &&
          run.durability < c.durability &&
          random() < 0.1
        )
          run.durability += 1;
        continue;
      }
      if (run.weaponKey === "magnetite_sword" && item.kind === "rock") {
        awardPoints(run, 1);
        continue;
      }
      if (run.elapsed - run.lastHitAt >= 0.8) {
        let damage = item.kind === "spike" ? c.spikeDamage : DAMAGE[item.kind];
        if (run.weaponKey === "photon_blaster" && item.kind === "car")
          damage = 2;
        if (run.weaponKey === "magnetite_sword")
          damage =
            item.kind === "spike" ? 2 : item.kind === "barrel" ? 1 : damage;
        run.hp = Math.max(
          0,
          run.hp - damage * (bear && run.stage === "chaos" ? 2 : 1),
        );
        run.lastHitAt = run.elapsed;
        continue;
      }
    }
    if (item.y <= 1.15) remaining.push(item);
  }
  run.items = remaining;
  if (run.guardUntil > 0 && run.elapsed >= run.guardUntil) {
    run.cooldownUntil = run.guardUntil + c.cooldownSeconds;
    run.guardUntil = 0;
    run.hp = Math.max(0, run.hp - c.missDamage);
    loseDurability(run);
  }
  if (run.characterKey === "photon_spade") {
    const ticks = Math.max(0, Math.floor(run.elapsed - run.laneChangedAt - 2));
    if (ticks > run.idleDamageTicks) {
      run.hp = Math.max(0, run.hp - 0.5 * (ticks - run.idleDamageTicks));
      run.idleDamageTicks = ticks;
    }
  }
  if (bear && run.elapsed >= run.stageEndsAt) {
    run.nextStage = run.stage === "normal" ? "chaos" : "normal";
    run.chaosCountdown = 3;
    if (run.stage === "chaos" && run.hp > 0)
      run.hp = Math.min(c.maxHp, run.hp + 0.5);
  }
  return run;
};
