/**
 * Authoritative, UI-independent rules for Arena (1v1) maps.
 *
 * Lane indexes are zero based throughout this module. Percentages in
 * `naturalObstacleWeights` are whole-number weights that sum to 100.
 */

export const MAP_IDS = [
  "classic",
  "alley",
  "desert",
  "skyway",
  "pitch",
  "volcano",
  "factory",
  "grove",
] as const;

export type MapId = (typeof MAP_IDS)[number];

export const CHARACTER_CLASS_IDS = [
  "runner",
  "medic",
  "tank",
  "trickster",
  "misc",
] as const;

export type CharacterClassId = (typeof CHARACTER_CLASS_IDS)[number];

export const NATURAL_OBSTACLE_IDS = [
  "log",
  "spike",
  "barrel",
  "rock",
  "snowflake",
  "current",
  "car",
  "mushroom",
] as const;

export type NaturalObstacleId = (typeof NATURAL_OBSTACLE_IDS)[number];

export const ATTACK_IDS = [
  "log",
  "barrel",
  "snowflake",
  "current",
  "spike",
  "car",
  "rock",
] as const;

export type AttackId = (typeof ATTACK_IDS)[number];
export type RandomSource = () => number;
export type ObstacleDensityMode =
  | "classic-baseline"
  | "same-total"
  | "same-per-lane";

export interface HealthModifiers {
  readonly startingHpMultiplier: number;
  readonly startingHpBonus: number;
  readonly maxHpMultiplier: number;
  readonly maxHpBonus: number;
  readonly healingMultiplier: number;
  readonly obstacleDamageMultiplier: number;
}

export type WaveAttackReward =
  | { readonly kind: "fixed"; readonly points: number }
  | {
      readonly kind: "grove-mushroom-comparison";
      readonly winnerPoints: 14;
      readonly tiedPlayerPoints: 7;
      readonly loserPoints: 0;
    };

export interface MapRules {
  readonly id: MapId;
  readonly name: string;
  readonly laneCount: number;
  readonly obstacleDensityMode: ObstacleDensityMode;
  /** Relative to Classic's total natural-obstacle cadence. */
  readonly totalObstacleMultiplier: number;
  readonly allowedClasses: readonly CharacterClassId[];
  readonly forcedCharacterId: "runner_ace" | null;
  readonly health: HealthModifiers;
  readonly naturalObstacleWeights: Readonly<
    Partial<Record<NaturalObstacleId, number>>
  >;
  readonly availableAttacks: readonly AttackId[];
  readonly attackPointsPerCoin: number;
  readonly waveAttackReward: WaveAttackReward;
  readonly specialRules: readonly (
    | "current"
    | "katana"
    | "volcano-idle-damage"
    | "factory-conveyor"
    | "grove-mushrooms"
  )[];
}

const ALL_CLASSES: readonly CharacterClassId[] = CHARACTER_CLASS_IDS;
const NON_TRICKSTER_CLASSES: readonly CharacterClassId[] = [
  "runner",
  "medic",
  "tank",
  "misc",
];
const DESERT_CLASSES: readonly CharacterClassId[] = ["runner", "trickster"];

const NORMAL_HEALTH: HealthModifiers = {
  startingHpMultiplier: 1,
  startingHpBonus: 0,
  maxHpMultiplier: 1,
  maxHpBonus: 0,
  healingMultiplier: 1,
  obstacleDamageMultiplier: 1,
};

const ATTACKS_WITH_SNOWFLAKE: readonly AttackId[] = [
  "log",
  "barrel",
  "snowflake",
  "spike",
  "car",
  "rock",
];
const ATTACKS_WITHOUT_SNOWFLAKE: readonly AttackId[] = [
  "log",
  "barrel",
  "spike",
  "car",
  "rock",
];

/** The explicit 6/7/8 attack-point table is authoritative. */
export const ATTACK_POINT_COSTS: Readonly<Record<AttackId, 6 | 7 | 8>> = {
  log: 6,
  barrel: 6,
  snowflake: 7,
  current: 7,
  spike: 8,
  car: 8,
  rock: 8,
};

export const CURRENT_RULES = {
  mapId: "skyway",
  naturalSpawnWeight: 15,
  attackPointCost: 7,
  /** Current moves at 95% of Barrel's speed. */
  barrelSpeedMultiplier: 0.95,
  allowedLaneIndexes: [1, 2, 3, 4],
  directHitDamage: 0.5,
  edgeAdjacentDamage: 1,
  ignoresFrozenMovementDelay: true,
} as const;

export const VOLCANO_RULES = {
  forcedCharacterId: "runner_ace",
  turnDelaySeconds: 0.15,
  graceSecondsInLane: 1,
  damageTickSeconds: 1,
  damagePerTick: 0.5,
} as const;

export const FACTORY_RULES = {
  slowMultiplier: 0.5,
  fastMultiplier: 2,
  slowChance: 0.5,
} as const;

export const GROVE_RULES = {
  startingHpBonus: 1,
  maxHpBonus: 1,
  mushroomScore: 120,
  lowerMushroomHealthPenalty: 1,
  healthPenaltyTiming: "after-healing",
  mushroomWinnerAttackPoints: 14,
  mushroomTieAttackPointsPerPlayer: 7,
} as const;

export const PITCH_KATANA_RULES = {
  activeSeconds: 0.4,
  cooldownSeconds: 6,
  postActiveMovementLockSeconds: 0.1,
  whiffSelfDamage: 0.5,
  cooldownResetsAtWaveEnd: true,
  cannotActivateWhileFrozen: true,
  rockBreaksForMatch: true,
} as const;

export const ONE_V_ONE_SCORING_RULES = {
  secondDeathBonus: 75,
  tiedEloActualScore: 0.5,
} as const;

export const MAP_RULES = {
  classic: {
    id: "classic",
    name: "Classic",
    laneCount: 5,
    obstacleDensityMode: "classic-baseline",
    totalObstacleMultiplier: 1,
    allowedClasses: ALL_CLASSES,
    forcedCharacterId: null,
    health: NORMAL_HEALTH,
    naturalObstacleWeights: {
      log: 30,
      spike: 30,
      barrel: 15,
      rock: 15,
      snowflake: 10,
    },
    availableAttacks: ATTACKS_WITH_SNOWFLAKE,
    attackPointsPerCoin: 6,
    waveAttackReward: { kind: "fixed", points: 8 },
    specialRules: [],
  },
  alley: {
    id: "alley",
    name: "Alley",
    laneCount: 3,
    obstacleDensityMode: "same-total",
    totalObstacleMultiplier: 1,
    allowedClasses: ALL_CLASSES,
    forcedCharacterId: null,
    health: {
      startingHpMultiplier: 2,
      startingHpBonus: 0,
      maxHpMultiplier: 2,
      maxHpBonus: 0,
      healingMultiplier: 1,
      obstacleDamageMultiplier: 1,
    },
    // The explicit spawn table lists Snowflake at 5%, so it wins over the
    // earlier prose sentence that says Alley has no Snowflake.
    naturalObstacleWeights: {
      log: 40,
      spike: 25,
      barrel: 10,
      rock: 20,
      snowflake: 5,
    },
    availableAttacks: ATTACKS_WITH_SNOWFLAKE,
    attackPointsPerCoin: 7,
    waveAttackReward: { kind: "fixed", points: 7 },
    specialRules: [],
  },
  desert: {
    id: "desert",
    name: "Desert",
    laneCount: 7,
    obstacleDensityMode: "same-total",
    totalObstacleMultiplier: 1,
    allowedClasses: DESERT_CLASSES,
    forcedCharacterId: null,
    health: { ...NORMAL_HEALTH, healingMultiplier: 0 },
    naturalObstacleWeights: {
      log: 25,
      spike: 25,
      barrel: 30,
      rock: 20,
    },
    availableAttacks: ATTACKS_WITHOUT_SNOWFLAKE,
    attackPointsPerCoin: 5,
    waveAttackReward: { kind: "fixed", points: 5 },
    specialRules: [],
  },
  skyway: {
    id: "skyway",
    name: "Skyway",
    laneCount: 6,
    obstacleDensityMode: "same-total",
    totalObstacleMultiplier: 1,
    allowedClasses: NON_TRICKSTER_CLASSES,
    forcedCharacterId: null,
    health: NORMAL_HEALTH,
    naturalObstacleWeights: {
      log: 25,
      spike: 25,
      barrel: 5,
      rock: 10,
      snowflake: 20,
      current: 15,
    },
    availableAttacks: [...ATTACKS_WITH_SNOWFLAKE, "current"],
    attackPointsPerCoin: 5,
    waveAttackReward: { kind: "fixed", points: 5 },
    specialRules: ["current"],
  },
  pitch: {
    id: "pitch",
    name: "Pitch",
    laneCount: 6,
    obstacleDensityMode: "same-total",
    totalObstacleMultiplier: 1,
    allowedClasses: ALL_CLASSES,
    forcedCharacterId: null,
    health: NORMAL_HEALTH,
    naturalObstacleWeights: {
      log: 25,
      spike: 30,
      barrel: 20,
      rock: 20,
      snowflake: 5,
    },
    availableAttacks: ATTACKS_WITH_SNOWFLAKE,
    attackPointsPerCoin: 6,
    waveAttackReward: { kind: "fixed", points: 6 },
    specialRules: ["katana"],
  },
  volcano: {
    id: "volcano",
    name: "Volcano",
    laneCount: 7,
    obstacleDensityMode: "same-total",
    totalObstacleMultiplier: 1,
    allowedClasses: ["runner"],
    forcedCharacterId: "runner_ace",
    health: NORMAL_HEALTH,
    naturalObstacleWeights: {
      log: 15,
      spike: 20,
      barrel: 25,
      rock: 40,
    },
    availableAttacks: ATTACKS_WITHOUT_SNOWFLAKE,
    attackPointsPerCoin: 5,
    waveAttackReward: { kind: "fixed", points: 5 },
    specialRules: ["volcano-idle-damage"],
  },
  factory: {
    id: "factory",
    name: "Factory",
    laneCount: 4,
    obstacleDensityMode: "same-per-lane",
    totalObstacleMultiplier: 4 / 5,
    allowedClasses: ALL_CLASSES,
    forcedCharacterId: null,
    health: NORMAL_HEALTH,
    naturalObstacleWeights: {
      log: 15,
      spike: 30,
      barrel: 5,
      rock: 35,
      snowflake: 5,
      car: 10,
    },
    availableAttacks: ATTACKS_WITH_SNOWFLAKE,
    attackPointsPerCoin: 5,
    waveAttackReward: { kind: "fixed", points: 5 },
    specialRules: ["factory-conveyor"],
  },
  grove: {
    id: "grove",
    name: "Grove",
    laneCount: 6,
    obstacleDensityMode: "same-per-lane",
    totalObstacleMultiplier: 6 / 5,
    allowedClasses: ALL_CLASSES,
    forcedCharacterId: null,
    health: {
      ...NORMAL_HEALTH,
      startingHpBonus: 1,
      maxHpBonus: 1,
    },
    naturalObstacleWeights: {
      log: 30,
      spike: 20,
      barrel: 15,
      rock: 20,
      mushroom: 15,
    },
    availableAttacks: ATTACKS_WITHOUT_SNOWFLAKE,
    attackPointsPerCoin: 5,
    waveAttackReward: {
      kind: "grove-mushroom-comparison",
      winnerPoints: 14,
      tiedPlayerPoints: 7,
      loserPoints: 0,
    },
    specialRules: ["grove-mushrooms"],
  },
} as const satisfies Record<MapId, MapRules>;

export const ENDLESS_MAP_ID: MapId = "classic";

export const getMapRules = (mapId: MapId): MapRules => MAP_RULES[mapId];

export const getMapForMode = (
  mode: "endless" | "one-v-one",
  selectedOneVersusOneMap: MapId = "classic",
): MapId => (mode === "endless" ? ENDLESS_MAP_ID : selectedOneVersusOneMap);

export const isCharacterClassAllowed = (
  mapId: MapId,
  characterClass: CharacterClassId,
): boolean => getMapRules(mapId).allowedClasses.includes(characterClass);

export const getForcedCharacterId = (mapId: MapId): "runner_ace" | null =>
  MAP_RULES[mapId].forcedCharacterId;

export const applyMapHealthModifiers = (
  mapId: MapId,
  baseStartingHp: number,
  baseMaxHp: number,
): { startingHp: number; maxHp: number } => {
  const rules = MAP_RULES[mapId].health;
  return {
    startingHp:
      baseStartingHp * rules.startingHpMultiplier + rules.startingHpBonus,
    maxHp: baseMaxHp * rules.maxHpMultiplier + rules.maxHpBonus,
  };
};

export const getAllowedHealing = (mapId: MapId, healingAmount: number): number =>
  Math.max(0, healingAmount) * MAP_RULES[mapId].health.healingMultiplier;

export const getObstacleDamage = (mapId: MapId, baseDamage: number): number =>
  Math.max(0, baseDamage) * MAP_RULES[mapId].health.obstacleDamageMultiplier;

const readRandom = (random: RandomSource): number => {
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError("Random source must return a finite value in [0, 1).");
  }
  return value;
};

const randomIndex = (length: number, random: RandomSource): number => {
  if (!Number.isInteger(length) || length <= 0) {
    throw new RangeError("Cannot select from an empty collection.");
  }
  return Math.floor(readRandom(random) * length);
};

const chooseUniformly = <T>(values: readonly T[], random: RandomSource): T =>
  values[randomIndex(values.length, random)];

const sampleWithoutReplacement = <T>(
  values: readonly T[],
  count: number,
  random: RandomSource,
): T[] => {
  const remaining = [...values];
  const chosen: T[] = [];
  while (chosen.length < count) {
    chosen.push(remaining.splice(randomIndex(remaining.length, random), 1)[0]);
  }
  return chosen;
};

export const chooseNaturalObstacle = (
  mapId: MapId,
  random: RandomSource = Math.random,
): NaturalObstacleId => {
  const weights = getMapRules(mapId).naturalObstacleWeights;
  const roll = readRandom(random) * 100;
  let cumulativeWeight = 0;
  for (const obstacleId of NATURAL_OBSTACLE_IDS) {
    cumulativeWeight += weights[obstacleId] ?? 0;
    if (roll < cumulativeWeight) return obstacleId;
  }
  // Validation guarantees a 100-point table; this only protects against
  // floating-point edge cases if the table is edited later.
  return NATURAL_OBSTACLE_IDS.findLast(
    (obstacleId) => (weights[obstacleId] ?? 0) > 0,
  )!;
};

export const isAttackAvailable = (mapId: MapId, attackId: AttackId): boolean =>
  MAP_RULES[mapId].availableAttacks.includes(attackId);

export const getAvailableAttacks = (mapId: MapId): readonly AttackId[] =>
  ATTACK_IDS.filter((attackId) => isAttackAvailable(mapId, attackId));

export const getAttackPointCost = (
  mapId: MapId,
  attackId: AttackId,
): 6 | 7 | 8 | null =>
  isAttackAvailable(mapId, attackId) ? ATTACK_POINT_COSTS[attackId] : null;

export const getAttackPointsForCoin = (mapId: MapId): number =>
  MAP_RULES[mapId].attackPointsPerCoin;

export const getWaveAttackPointRewards = (
  mapId: MapId,
  playerOneMushrooms = 0,
  playerTwoMushrooms = 0,
): readonly [playerOne: number, playerTwo: number] => {
  const reward = MAP_RULES[mapId].waveAttackReward;
  if (reward.kind === "fixed") return [reward.points, reward.points];
  if (playerOneMushrooms === playerTwoMushrooms) {
    return [reward.tiedPlayerPoints, reward.tiedPlayerPoints];
  }
  return playerOneMushrooms > playerTwoMushrooms
    ? [reward.winnerPoints, reward.loserPoints]
    : [reward.loserPoints, reward.winnerPoints];
};

export type CurrentInteraction =
  | { readonly kind: "none"; readonly damage: 0; readonly nextLane: number }
  | {
      readonly kind: "direct-hit";
      readonly damage: 0.5;
      readonly nextLane: number;
    }
  | {
      readonly kind: "edge-adjacent-hit";
      readonly damage: 1;
      readonly nextLane: number;
    }
  | { readonly kind: "push"; readonly damage: 0; readonly nextLane: number };

const assertLane = (lane: number, laneCount: number, label: string) => {
  if (!Number.isInteger(lane) || lane < 0 || lane >= laneCount) {
    throw new RangeError(`${label} must be an integer from 0 to ${laneCount - 1}.`);
  }
};

export const isCurrentLaneAllowed = (lane: number): boolean =>
  Number.isInteger(lane) &&
  (CURRENT_RULES.allowedLaneIndexes as readonly number[]).includes(lane);

export const chooseCurrentLane = (
  random: RandomSource = Math.random,
): (typeof CURRENT_RULES.allowedLaneIndexes)[number] =>
  chooseUniformly(CURRENT_RULES.allowedLaneIndexes, random);

export const resolveCurrentInteraction = (
  playerLane: number,
  currentLane: number,
): CurrentInteraction => {
  const laneCount = MAP_RULES.skyway.laneCount;
  assertLane(playerLane, laneCount, "Player lane");
  assertLane(currentLane, laneCount, "Current lane");
  if (!isCurrentLaneAllowed(currentLane)) {
    throw new RangeError("Current may only use Skyway's middle four lanes (1-4).");
  }

  if (playerLane === currentLane) {
    return { kind: "direct-hit", damage: 0.5, nextLane: playerLane };
  }
  if (Math.abs(playerLane - currentLane) !== 1) {
    return { kind: "none", damage: 0, nextLane: playerLane };
  }
  const playerIsOnEdge = playerLane === 0 || playerLane === laneCount - 1;
  if (playerIsOnEdge) {
    return { kind: "edge-adjacent-hit", damage: 1, nextLane: playerLane };
  }
  const directionAwayFromCurrent = Math.sign(playerLane - currentLane);
  return {
    kind: "push",
    damage: 0,
    nextLane: playerLane + directionAwayFromCurrent,
  };
};

/** Total accumulated Volcano lane-camping damage at this elapsed duration. */
export const getVolcanoStationaryDamage = (
  stationarySeconds: number,
): number => {
  const safeSeconds = Math.max(0, stationarySeconds);
  const ticks = Math.max(
    0,
    Math.floor(safeSeconds / VOLCANO_RULES.damageTickSeconds) -
      VOLCANO_RULES.graceSecondsInLane / VOLCANO_RULES.damageTickSeconds,
  );
  return ticks * VOLCANO_RULES.damagePerTick;
};

/** Damage newly owed between two stationary-duration samples. */
export const getNewVolcanoStationaryDamage = (
  previousStationarySeconds: number,
  nextStationarySeconds: number,
): number =>
  Math.max(
    0,
    getVolcanoStationaryDamage(nextStationarySeconds) -
      getVolcanoStationaryDamage(previousStationarySeconds),
  );

export interface FactoryConveyorState {
  readonly lane: number;
  readonly speedMultiplier: 0.5 | 2;
}

export const createFactoryConveyorState = (
  random: RandomSource = Math.random,
): FactoryConveyorState => ({
  lane: randomIndex(MAP_RULES.factory.laneCount, random),
  speedMultiplier:
    readRandom(random) < FACTORY_RULES.slowChance
      ? FACTORY_RULES.slowMultiplier
      : FACTORY_RULES.fastMultiplier,
});

export const getFactoryObstacleSpeedMultiplier = (
  obstacleLane: number,
  conveyor: FactoryConveyorState,
): number => {
  assertLane(obstacleLane, MAP_RULES.factory.laneCount, "Obstacle lane");
  assertLane(conveyor.lane, MAP_RULES.factory.laneCount, "Conveyor lane");
  return obstacleLane === conveyor.lane ? conveyor.speedMultiplier : 1;
};

export interface GrovePlayerWaveResult {
  readonly mushrooms: number;
  readonly scoreBonus: number;
  /** Apply this after all end-of-wave healing. */
  readonly healthPenalty: 0 | 1;
  readonly attackPoints: 0 | 7 | 14;
}

export interface GroveWaveResult {
  readonly playerOne: GrovePlayerWaveResult;
  readonly playerTwo: GrovePlayerWaveResult;
}

const normalizeCount = (value: number, label: string): number => {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer.`);
  }
  return value;
};

export const resolveGroveWave = (
  playerOneMushrooms: number,
  playerTwoMushrooms: number,
): GroveWaveResult => {
  const one = normalizeCount(playerOneMushrooms, "Player-one mushrooms");
  const two = normalizeCount(playerTwoMushrooms, "Player-two mushrooms");
  const [oneAttackPoints, twoAttackPoints] = getWaveAttackPointRewards(
    "grove",
    one,
    two,
  );
  return {
    playerOne: {
      mushrooms: one,
      scoreBonus: one * GROVE_RULES.mushroomScore,
      healthPenalty: one < two ? 1 : 0,
      attackPoints: oneAttackPoints as 0 | 7 | 14,
    },
    playerTwo: {
      mushrooms: two,
      scoreBonus: two * GROVE_RULES.mushroomScore,
      healthPenalty: two < one ? 1 : 0,
      attackPoints: twoAttackPoints as 0 | 7 | 14,
    },
  };
};

export const applyGroveHealthPenalty = (
  hpAfterHealing: number,
  ownMushrooms: number,
  opponentMushrooms: number,
): number =>
  Math.max(
    0,
    hpAfterHealing - (ownMushrooms < opponentMushrooms ? 1 : 0),
  );

export interface PitchKatanaState {
  readonly broken: boolean;
  readonly activationStartedAtMs: number | null;
  readonly activeUntilMs: number;
  readonly cooldownUntilMs: number;
  readonly movementLockedUntilMs: number;
  readonly hitDuringActivation: boolean;
  readonly whiffSettled: boolean;
}

export const createPitchKatanaState = (): PitchKatanaState => ({
  broken: false,
  activationStartedAtMs: null,
  activeUntilMs: 0,
  cooldownUntilMs: 0,
  movementLockedUntilMs: 0,
  hitDuringActivation: false,
  whiffSettled: true,
});

export type PitchKatanaActivation =
  | { readonly activated: true; readonly state: PitchKatanaState }
  | {
      readonly activated: false;
      readonly reason: "broken" | "frozen" | "cooldown" | "already-active";
      readonly state: PitchKatanaState;
    };

export const activatePitchKatana = (
  state: PitchKatanaState,
  nowMs: number,
  frozen: boolean,
): PitchKatanaActivation => {
  if (state.broken) return { activated: false, reason: "broken", state };
  if (frozen) return { activated: false, reason: "frozen", state };
  if (nowMs < state.activeUntilMs) {
    return { activated: false, reason: "already-active", state };
  }
  if (nowMs < state.cooldownUntilMs) {
    return { activated: false, reason: "cooldown", state };
  }
  const activeUntilMs = nowMs + PITCH_KATANA_RULES.activeSeconds * 1_000;
  return {
    activated: true,
    state: {
      ...state,
      activationStartedAtMs: nowMs,
      activeUntilMs,
      cooldownUntilMs: nowMs + PITCH_KATANA_RULES.cooldownSeconds * 1_000,
      movementLockedUntilMs:
        activeUntilMs +
        PITCH_KATANA_RULES.postActiveMovementLockSeconds * 1_000,
      hitDuringActivation: false,
      whiffSettled: false,
    },
  };
};

export type PitchKatanaCollision =
  | {
      readonly kind: "inactive";
      readonly blocksDamage: false;
      readonly sendToOpponent: false;
      readonly state: PitchKatanaState;
    }
  | {
      readonly kind: "deflected";
      readonly blocksDamage: true;
      readonly sendToOpponent: true;
      readonly state: PitchKatanaState;
    }
  | {
      readonly kind: "rock-broke-katana";
      readonly blocksDamage: false;
      readonly sendToOpponent: false;
      readonly state: PitchKatanaState;
    };

export const resolvePitchKatanaCollision = (
  state: PitchKatanaState,
  obstacleId: AttackId,
  nowMs: number,
): PitchKatanaCollision => {
  if (
    state.broken ||
    nowMs >= state.activeUntilMs ||
    state.activationStartedAtMs === null
  ) {
    return {
      kind: "inactive",
      blocksDamage: false,
      sendToOpponent: false,
      state,
    };
  }
  if (obstacleId === "rock") {
    return {
      kind: "rock-broke-katana",
      blocksDamage: false,
      sendToOpponent: false,
      state: {
        ...state,
        broken: true,
        activeUntilMs: nowMs,
        hitDuringActivation: true,
        whiffSettled: true,
      },
    };
  }
  return {
    kind: "deflected",
    blocksDamage: true,
    sendToOpponent: true,
    state: { ...state, hitDuringActivation: true },
  };
};

export const isPitchKatanaMovementLocked = (
  state: PitchKatanaState,
  nowMs: number,
): boolean => nowMs < state.movementLockedUntilMs;

export const settlePitchKatanaWindow = (
  state: PitchKatanaState,
  nowMs: number,
): { readonly state: PitchKatanaState; readonly selfDamage: 0 | 0.5 } => {
  if (
    state.activationStartedAtMs === null ||
    state.whiffSettled ||
    nowMs < state.activeUntilMs
  ) {
    return { state, selfDamage: 0 };
  }
  return {
    state: { ...state, whiffSettled: true },
    selfDamage: state.hitDuringActivation ? 0 : 0.5,
  };
};

/** Resets the six-second cooldown, but a rock-broken Katana stays broken. */
export const resetPitchKatanaAtWaveEnd = (
  state: PitchKatanaState,
  nowMs: number,
): PitchKatanaState => ({
  ...state,
  activationStartedAtMs: null,
  activeUntilMs: nowMs,
  cooldownUntilMs: nowMs,
  movementLockedUntilMs: nowMs,
  hitDuringActivation: false,
  whiffSettled: true,
});

export type PlayerSlot = "playerOne" | "playerTwo";

export const resolveOneVersusOneScores = (
  playerOneScore: number,
  playerTwoScore: number,
  secondDeath: PlayerSlot | null,
) => {
  const adjustedPlayerOneScore =
    playerOneScore +
    (secondDeath === "playerOne" ? ONE_V_ONE_SCORING_RULES.secondDeathBonus : 0);
  const adjustedPlayerTwoScore =
    playerTwoScore +
    (secondDeath === "playerTwo" ? ONE_V_ONE_SCORING_RULES.secondDeathBonus : 0);
  const winner: PlayerSlot | "draw" =
    adjustedPlayerOneScore === adjustedPlayerTwoScore
      ? "draw"
      : adjustedPlayerOneScore > adjustedPlayerTwoScore
        ? "playerOne"
        : "playerTwo";
  return {
    adjustedPlayerOneScore,
    adjustedPlayerTwoScore,
    winner,
    eloActualScores:
      winner === "draw"
        ? ([0.5, 0.5] as const)
        : winner === "playerOne"
          ? ([1, 0] as const)
          : ([0, 1] as const),
  };
};

export const MAP_VOTE_COUNT = 2;

export type MapVoteList = readonly MapId[];
export type MapVoteInput = MapVoteList | null | undefined;
// Compatibility aliases for the existing client while the saved preference UI
// moves from an eight-map ranking to a two-map vote.
export type MapPriorityList = MapVoteList;
export type MapPriorityInput = MapVoteInput;

const isMapId = (value: unknown): value is MapId =>
  typeof value === "string" && (MAP_IDS as readonly string[]).includes(value);

export const isValidMapVotes = (input: MapVoteInput): input is MapVoteList =>
  Array.isArray(input) &&
  input.length === MAP_VOTE_COUNT &&
  input.every(isMapId) &&
  new Set(input).size === MAP_VOTE_COUNT;

export const isValidMapPriority = isValidMapVotes;

export const createRandomMapVotes = (
  random: RandomSource = Math.random,
): MapVoteList => sampleWithoutReplacement(MAP_IDS, MAP_VOTE_COUNT, random);

export const createRandomMapPriority = createRandomMapVotes;

/**
 * Returns two distinct votes. Missing or malformed saved votes are randomized,
 * matching the matchmaking fallback rule.
 */
export const normalizeMapVotes = (
  input: MapVoteInput,
  random: RandomSource = Math.random,
): MapVoteList =>
  isValidMapVotes(input) ? [...input] : createRandomMapVotes(random);

export const normalizeMapPriority = normalizeMapVotes;

export interface OneVersusOneMapSelectionOptions {
  readonly playerOneVotes?: MapVoteInput;
  readonly playerTwoVotes?: MapVoteInput;
  /** @deprecated Use playerOneVotes. */
  readonly playerOnePriority?: MapPriorityInput;
  /** @deprecated Use playerTwoVotes. */
  readonly playerTwoPriority?: MapPriorityInput;
  readonly random?: RandomSource;
}

export type OneVersusOneMapSelection = {
  readonly mapId: MapId;
  readonly reason:
    | "shared-vote"
    | "shared-pair-random"
    | "no-overlap-random";
  readonly candidates: readonly MapId[];
  readonly sharedVotes: readonly MapId[];
};

export const selectOneVersusOneMapDetailed = (
  options: OneVersusOneMapSelectionOptions = {},
): OneVersusOneMapSelection => {
  const random = options.random ?? Math.random;
  const playerOneVotes = normalizeMapVotes(
    options.playerOneVotes ?? options.playerOnePriority,
    random,
  );
  const playerTwoVotes = normalizeMapVotes(
    options.playerTwoVotes ?? options.playerTwoPriority,
    random,
  );
  const sharedVotes = playerOneVotes.filter((mapId) =>
    playerTwoVotes.includes(mapId),
  );
  const candidates =
    sharedVotes.length > 0
      ? sharedVotes
      : Array.from(new Set([...playerOneVotes, ...playerTwoVotes]));
  return {
    mapId: chooseUniformly(candidates, random),
    reason:
      sharedVotes.length === 1
        ? "shared-vote"
        : sharedVotes.length === MAP_VOTE_COUNT
          ? "shared-pair-random"
          : "no-overlap-random",
    candidates,
    sharedVotes,
  };
};

export const selectOneVersusOneMap = (
  options: OneVersusOneMapSelectionOptions = {},
): MapId => selectOneVersusOneMapDetailed(options).mapId;

/** Returns human-readable invariant failures; an empty array means valid. */
export const validateArenaMapRules = (): readonly string[] => {
  const errors: string[] = [];
  if (Object.keys(MAP_RULES).length !== 8) errors.push("Expected exactly 8 maps.");
  for (const mapId of MAP_IDS) {
    const map = MAP_RULES[mapId];
    const weightTotal = Object.values(map.naturalObstacleWeights).reduce(
      (total, weight) => total + weight,
      0,
    );
    if (weightTotal !== 100) {
      errors.push(`${map.name} natural obstacle weights total ${weightTotal}.`);
    }
    if (map.laneCount < 2) errors.push(`${map.name} needs at least two lanes.`);
    if (map.forcedCharacterId && map.allowedClasses.length !== 1) {
      errors.push(`${map.name} forced character should also force one class.`);
    }
  }
  if (MAP_VOTE_COUNT !== 2) errors.push("1v1 map voting must use two picks.");
  if (ATTACK_POINT_COSTS.current !== 7) {
    errors.push("Current must cost exactly 7 attack points.");
  }
  for (const mapId of MAP_IDS) {
    if (mapId !== "skyway" && MAP_RULES[mapId].availableAttacks.includes("current")) {
      errors.push(`Current attack must not be available on ${MAP_RULES[mapId].name}.`);
    }
  }
  if (MAP_RULES.skyway.laneCount !== 6) {
    errors.push("Skyway must have 6 lanes for Current's middle-four-lane rule.");
  }
  return errors;
};

export const assertValidArenaMapRules = (): void => {
  const errors = validateArenaMapRules();
  if (errors.length > 0) {
    throw new Error(`Invalid Arena map rules:\n${errors.join("\n")}`);
  }
};
