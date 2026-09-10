/**
 * Pure gameplay rules shared by the runner UI and the 1v1 synchronisation layer.
 *
 * This module intentionally has no React, browser, or Supabase dependencies. Keeping
 * the calculations here makes client previews and authoritative server tests agree.
 */

export type HazardKind =
  | "barrel"
  | "car"
  | "current"
  | "log"
  | "rock"
  | "snowflake"
  | "spikes"
  | "other";

export type TankCharacterKey =
  | "tank_bulwark"
  | "runner_vault"
  | "tank_guard"
  | "tank_brace"
  | "tank_ironclad"
  | "medic_mercy"
  | "tank_hammer"
  | "tank_anchor"
  | "tank_warden"
  | "tank_bastion"
  | "tank_rampart"
  | "trickster_jester"
  | "tank_citadel"
  | "tank_sentinel"
  | "tank_colossus"
  | "trickster_phantom"
  | "tank_atlas";

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

const finiteOr = (value: number, fallback = 0) =>
  Number.isFinite(value) ? value : fallback;

/** Fractional attack points remain real but the HUD only shows whole points. */
export const getDisplayedAttackPoints = (points: number) =>
  Math.max(0, Math.floor(finiteOr(points)));

/** Fractional HP remains real but the HUD rounds upward to the next half-heart. */
export const getDisplayedHearts = (hearts: number) => {
  const safeHearts = Math.max(0, finiteOr(hearts));
  // The epsilon stops a calculation such as 0.5 + Number.EPSILON displaying as 1.
  return Math.max(0, Math.ceil((safeHearts - Number.EPSILON) * 2) / 2);
};

/** Score bonuses also multiply fractional 1v1 attack-point rewards. */
export const applyScoreMultiplierToAttackPoints = (
  basePoints: number,
  scoreMultiplier: number,
) => Math.max(0, finiteOr(basePoints) * Math.max(0, finiteOr(scoreMultiplier, 1)));

export type CharacterRarity =
  | "common"
  | "uncommon"
  | "rare"
  | "epic"
  | "legendary"
  | "mythic";

/** Mythic characters may be used in Endless and Casual, never Ranked 1v1. */
export const canUseCharacterInMatch = (
  rarity: CharacterRarity,
  matchKind: "endless" | "casual-1v1" | "ranked-1v1",
) => matchKind !== "ranked-1v1" || rarity !== "mythic";

export interface TankDamageInput {
  readonly character: TankCharacterKey;
  readonly source: HazardKind;
  readonly baseDamage: number;
  readonly currentHearts: number;
  readonly firstHitOfWave?: boolean;
  readonly vaultChargeAvailable?: boolean;
  readonly bulwarkPlateAvailable?: boolean;
  readonly mercyPassiveActive?: boolean;
  /** A deterministic unit roll. Values below 0.25 keep Mercy active. */
  readonly mercyContinuationRoll?: number;
  readonly spikeDeactivated?: boolean;
  readonly bastionSecondsInLane?: number;
  readonly citadelBlocksRemaining?: number;
  readonly sentinelAnalyzedSource?: HazardKind | null;
  readonly sentinelFirstAnalyzedHitAvailable?: boolean;
  readonly titanMaulEquipped?: boolean;
}

export interface TankDamageResult {
  readonly damage: number;
  readonly reasons: readonly string[];
  readonly consumed: Readonly<{
    vaultCharge: boolean;
    bulwarkPlate: boolean;
    mercyPassive: boolean;
    bastionCharge: boolean;
    citadelBlock: boolean;
    sentinelFirstAnalyzedHit: boolean;
  }>;
  readonly mercyPassiveActiveAfterHit: boolean;
  readonly bastionDamageReduction: number;
}

const emptyConsumed = () => ({
  vaultCharge: false,
  bulwarkPlate: false,
  mercyPassive: false,
  bastionCharge: false,
  citadelBlock: false,
  sentinelFirstAnalyzedHit: false,
});

/** Damage reduction granted by Rampart at its current exact HP total. */
export const getRampartDamageReduction = (currentHearts: number) => {
  const hearts = Math.max(0, finiteOr(currentHearts));
  if (hearts <= 0.5) return 0.5;
  if (hearts <= 1) return 0.4;
  if (hearts <= 1.5) return 0.3;
  if (hearts <= 2) return 0.2;
  return 0;
};

/** Bastion earns exactly 5 percentage points per full second, capped at 100%. */
export const getBastionDamageReduction = (secondsInLane: number) =>
  clamp(Math.floor(Math.max(0, finiteOr(secondsInLane))) * 0.05, 0, 1);

/** Colossus's rock damage replaces the normal rock amount before weapon reductions. */
export const getColossusRockDamage = (
  currentHearts: number,
  normalRockDamage = 2,
) => {
  const hearts = Math.max(0, finiteOr(currentHearts));
  if (hearts >= 10) return 0;
  if (hearts >= 7) return Math.min(normalRockDamage, 1);
  if (hearts >= 5) return Math.min(normalRockDamage, 1.5);
  return Math.max(0, finiteOr(normalRockDamage));
};

/** A unit roll below 25% lets Mercy halve the following hit too. */
export const mercyPassiveContinues = (unitRoll: number) =>
  clamp(finiteOr(unitRoll, 1), 0, 1) < 0.25;

/**
 * Resolves the attached tank rules without quantising the resulting HP damage.
 * Hard immunities are resolved first, then flat reductions, then multipliers.
 */
export const calculateTankDamage = (
  input: TankDamageInput,
): TankDamageResult => {
  const consumed = emptyConsumed();
  const reasons: string[] = [];
  let damage = Math.max(0, finiteOr(input.baseDamage));
  let mercyActiveAfterHit = input.mercyPassiveActive ?? true;
  let bastionDamageReduction = 0;

  const finish = (): TankDamageResult => ({
    damage: Math.max(0, damage),
    reasons,
    consumed,
    mercyPassiveActiveAfterHit: mercyActiveAfterHit,
    bastionDamageReduction,
  });

  if (damage === 0) return finish();

  if (
    input.character === "tank_warden" &&
    input.source === "spikes" &&
    input.spikeDeactivated
  ) {
    damage = 0;
    reasons.push("warden-deactivated-spike");
    return finish();
  }

  if (input.character === "tank_brace" && input.source === "spikes") {
    damage = 0;
    reasons.push("brace-spike-immunity");
    return finish();
  }

  if (input.character === "tank_ironclad" && input.source === "log") {
    damage = 0;
    reasons.push("ironclad-log-immunity");
    return finish();
  }

  if (
    input.character === "runner_vault" &&
    (input.source === "spikes" || input.source === "log") &&
    (input.vaultChargeAvailable ?? input.firstHitOfWave ?? false)
  ) {
    consumed.vaultCharge = true;
    damage = 0;
    reasons.push("vault-first-spike-or-log");
    return finish();
  }

  if (
    input.character === "tank_citadel" &&
    Math.max(0, Math.floor(input.citadelBlocksRemaining ?? 0)) > 0
  ) {
    consumed.citadelBlock = true;
    damage = 0;
    reasons.push("citadel-opening-block");
    return finish();
  }

  const sentinelMatches =
    input.character === "tank_sentinel" &&
    input.sentinelAnalyzedSource === input.source;
  if (sentinelMatches && input.sentinelFirstAnalyzedHitAvailable) {
    consumed.sentinelFirstAnalyzedHit = true;
    damage = 0;
    reasons.push("sentinel-first-analyzed-hit");
    return finish();
  }

  if (input.character === "tank_colossus" && input.source === "rock") {
    damage = getColossusRockDamage(input.currentHearts, damage);
    reasons.push("colossus-rock-threshold");
    if (damage === 0) return finish();
  }

  if (
    input.character === "tank_bulwark" &&
    (input.bulwarkPlateAvailable ?? input.firstHitOfWave ?? false) &&
    damage >= 1
  ) {
    damage = Math.max(0.5, damage - 0.5);
    consumed.bulwarkPlate = true;
    reasons.push("bulwark-first-hit-plate");
  }

  switch (input.character) {
    case "tank_bulwark":
      damage *= 0.8;
      reasons.push("bulwark-20-percent-reduction");
      break;
    case "tank_guard":
      damage *= 0.7;
      reasons.push("guard-30-percent-reduction");
      break;
    case "tank_brace":
      damage *= 1.5;
      reasons.push("brace-50-percent-vulnerability");
      break;
    case "tank_ironclad":
      damage *= 1.5;
      reasons.push("ironclad-50-percent-vulnerability");
      break;
    case "medic_mercy": {
      if (input.mercyPassiveActive ?? true) {
        damage *= 0.5;
        consumed.mercyPassive = true;
        mercyActiveAfterHit = mercyPassiveContinues(
          input.mercyContinuationRoll ?? 1,
        );
        reasons.push("mercy-half-damage");
        reasons.push(
          mercyActiveAfterHit ? "mercy-continued" : "mercy-ended-for-wave",
        );
      }
      break;
    }
    case "tank_hammer":
      damage *= 0.9;
      reasons.push("hammer-10-percent-reduction");
      break;
    case "tank_warden":
      damage *= 0.75;
      reasons.push("warden-25-percent-reduction");
      break;
    case "tank_bastion":
      bastionDamageReduction = getBastionDamageReduction(
        input.bastionSecondsInLane ?? 0,
      );
      damage *= 1 - bastionDamageReduction;
      consumed.bastionCharge = true;
      reasons.push("bastion-lane-charge");
      break;
    case "tank_rampart": {
      const reduction = getRampartDamageReduction(input.currentHearts);
      damage *= 1 - reduction;
      if (reduction > 0) reasons.push("rampart-low-health-reduction");
      break;
    }
    case "tank_sentinel":
      if (sentinelMatches) {
        damage *= 0.25;
        reasons.push("sentinel-analyzed-75-percent-reduction");
      }
      break;
    case "tank_colossus":
      if (input.titanMaulEquipped ?? true) {
        if (input.source === "rock") {
          damage *= 0.5;
          reasons.push("titan-maul-rock-50-percent-reduction");
        } else {
          damage *= 0.65;
          reasons.push("titan-maul-35-percent-reduction");
        }
      }
      break;
    default:
      break;
  }

  return finish();
};

export const getTankMaxHearts = (character: TankCharacterKey) => {
  if (character === "tank_colossus") return 10;
  if (character === "tank_atlas") return 7;
  if (character === "trickster_phantom") return 3;
  return 4;
};

export const ATLAS_STARTING_HEARTS = 4;

export const getTankScoreMultiplier = (
  character: TankCharacterKey,
  currentHearts: number,
  weaponEquipped = true,
) => {
  if (character === "tank_guard") return 0.9;
  if (character === "tank_brace" && weaponEquipped) return 1.15;
  if (character === "tank_colossus") {
    return 1 + Math.max(0, finiteOr(currentHearts) - 3) * 0.05;
  }
  return 1;
};

export const getColossusHazardSpeedMultiplier = (currentHearts: number) =>
  clamp(1 - Math.max(0, finiteOr(currentHearts) - 3) * 0.05, 0.65, 1);

export const getColossusWaveEndHearts = (
  currentHearts: number,
  flawlessWave: boolean,
) =>
  flawlessWave
    ? Math.min(10, Math.max(0, finiteOr(currentHearts)) + 2)
    : Math.max(0, finiteOr(currentHearts));

export const getCitadelOpeningBlocks = (consecutiveFlawlessWaves: number) =>
  clamp(Math.floor(finiteOr(consecutiveFlawlessWaves)), 1, 3);

export const getSentinelBarrelSpeedMultiplier = (
  shockwaveActive: boolean,
) => (shockwaveActive ? 0.25 : 1);

const SENTINEL_TIE_BREAK_ORDER: readonly HazardKind[] = [
  "rock",
  "spikes",
  "car",
  "log",
  "barrel",
  "snowflake",
  "current",
  "other",
];

/** Picks one stable analyzed type from cumulative damage totals. */
export const selectSentinelAnalyzedSource = (
  damageBySource: Readonly<Partial<Record<HazardKind, number>>>,
): HazardKind | null => {
  let winner: HazardKind | null = null;
  let highestDamage = 0;
  for (const kind of SENTINEL_TIE_BREAK_ORDER) {
    const total = Math.max(0, finiteOr(damageBySource[kind] ?? 0));
    if (total > highestDamage) {
      winner = kind;
      highestDamage = total;
    }
  }
  return winner;
};

export interface HammerTarget {
  readonly id: string;
  readonly lane: number;
  readonly kind: HazardKind;
  /** Smaller values are closer to the player and are destroyed first. */
  readonly distanceToPlayer: number;
}

/** Selects Hammer's current-lane target plus its two neighbouring targets. */
export const selectHammerTargets = <T extends HammerTarget>(
  obstacles: readonly T[],
  currentLane: number,
  laneCount = 5,
): readonly T[] => {
  const firstDestroyableInLane = (lane: number, count: number) =>
    obstacles
      .filter(
        (obstacle) => obstacle.lane === lane && obstacle.kind !== "rock",
      )
      .sort(
        (left, right) => left.distanceToPlayer - right.distanceToPlayer,
      )
      .slice(0, count);

  const lane = clamp(Math.floor(currentLane), 0, Math.max(0, laneCount - 1));
  const neighbors = [lane - 1, lane + 1].filter(
    (candidate) => candidate >= 0 && candidate < laneCount,
  );
  const selected = [...firstDestroyableInLane(lane, 1)];
  if (neighbors.length === 1) {
    selected.push(...firstDestroyableInLane(neighbors[0], 2));
  } else {
    for (const neighbor of neighbors)
      selected.push(...firstDestroyableInLane(neighbor, 1));
  }
  return selected;
};

/** Atlas loses 0.5 seconds per collision, but Sky Crush never drops below 1s. */
export const getAtlasSkyCrushSecondsAfterHits = (
  currentSeconds: number,
  obstacleHits = 1,
) =>
  Math.max(
    1,
    Math.max(1, finiteOr(currentSeconds, 1)) -
      Math.max(0, Math.floor(finiteOr(obstacleHits))) * 0.5,
  );

export type JesterWaveEffect =
  | {
      readonly group: "positive";
      readonly kind: "first-hit-zero" | "half-damage" | "barrel-immunity";
    }
  | {
      readonly group: "neutral";
      readonly kind: "score-and-speed";
      readonly percent: number;
    }
  | {
      readonly group: "negative";
      readonly kind:
        | "first-hit-double"
        | "fifty-percent-more-damage"
        | "barrel-double-damage";
    };

const hashSeed = (seed: number | string) => {
  const text = String(seed);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const seededUnit = (seed: number | string) => {
  let value = hashSeed(seed);
  value += 0x6d2b79f5;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
};

/** Generates the same Jester effect for the same run seed and wave. */
export const generateJesterWaveEffect = (
  runSeed: number | string,
  wave: number,
): JesterWaveEffect => {
  const effectIndex = Math.floor(
    seededUnit(`${runSeed}:jester:${Math.max(1, Math.floor(wave))}`) * 7,
  );
  switch (effectIndex) {
    case 0:
      return { group: "positive", kind: "first-hit-zero" };
    case 1:
      return { group: "positive", kind: "half-damage" };
    case 2:
      return { group: "positive", kind: "barrel-immunity" };
    case 3:
      return {
        group: "neutral",
        kind: "score-and-speed",
        percent:
          1 +
          Math.floor(
            seededUnit(`${runSeed}:jester-percent:${Math.max(1, wave)}`) *
              100,
          ),
      };
    case 4:
      return { group: "negative", kind: "first-hit-double" };
    case 5:
      return {
        group: "negative",
        kind: "fifty-percent-more-damage",
      };
    default:
      return { group: "negative", kind: "barrel-double-damage" };
  }
};

export const applyJesterDamageEffect = (
  effect: JesterWaveEffect,
  damage: number,
  source: HazardKind,
  firstHitOfWave: boolean,
) => {
  const baseDamage = Math.max(0, finiteOr(damage));
  if (effect.kind === "first-hit-zero" && firstHitOfWave) return 0;
  if (effect.kind === "half-damage") return baseDamage * 0.5;
  if (effect.kind === "barrel-immunity" && source === "barrel") return 0;
  if (effect.kind === "first-hit-double" && firstHitOfWave)
    return baseDamage * 2;
  if (effect.kind === "fifty-percent-more-damage") return baseDamage * 1.5;
  if (effect.kind === "barrel-double-damage" && source === "barrel")
    return baseDamage * 2;
  return baseDamage;
};

export const getJesterWaveMultipliers = (effect: JesterWaveEffect) => {
  const neutralBonus =
    effect.kind === "score-and-speed" ? effect.percent / 100 : 0;
  return {
    scoreMultiplier: 1 + neutralBonus,
    hazardSpeedMultiplier: 1 + neutralBonus,
  } as const;
};

export interface DriftState {
  readonly bonus: number;
  readonly lastLaneChangeAtMs: number | null;
}

export const INITIAL_DRIFT_STATE: DriftState = {
  bonus: 0,
  lastLaneChangeAtMs: null,
};

export const advanceDriftLaneChange = (
  state: DriftState,
  laneChangeAtMs: number,
): DriftState => {
  const now = finiteOr(laneChangeAtMs);
  const remainsConsecutive =
    state.lastLaneChangeAtMs !== null &&
    now >= state.lastLaneChangeAtMs &&
    now - state.lastLaneChangeAtMs <= 500;
  return {
    bonus: Math.min(2, (remainsConsecutive ? state.bonus : 0) + 0.15),
    lastLaneChangeAtMs: now,
  };
};

export const resetDriftOnHit = (): DriftState => INITIAL_DRIFT_STATE;

export const getDriftMultipliers = (state: DriftState) => ({
  scoreMultiplier: 1 + clamp(state.bonus, 0, 2),
  hazardSpeedMultiplier: 1 + clamp(state.bonus, 0, 2),
});

export const getClockworkSlow = (elapsedRunMs: number) =>
  clamp(0.1 + (Math.max(0, finiteOr(elapsedRunMs)) / 1000) * 0.005, 0.1, 0.6);

export const getClockworkSpeedMultipliers = (elapsedRunMs: number) => {
  const slow = getClockworkSlow(elapsedRunMs);
  return {
    selfHazardSpeedMultiplier: 1 - slow,
    opponentSentHazardSpeedMultiplier: 1 + slow,
  } as const;
};

export type CardSuit = "clubs" | "diamonds" | "hearts" | "spades";
export type StandardCardRank =
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "10"
  | "J"
  | "Q"
  | "K"
  | "A";

export interface StandardCard {
  readonly id: string;
  readonly rank: StandardCardRank;
  readonly suit: CardSuit;
}

export interface JokerCard {
  readonly id: "joker-red" | "joker-black";
  readonly rank: "JOKER";
  readonly suit: "joker";
}

export type WildcardCard = StandardCard | JokerCard;

const CARD_SUITS: readonly CardSuit[] = [
  "clubs",
  "diamonds",
  "hearts",
  "spades",
];
const CARD_RANKS: readonly StandardCardRank[] = [
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
  "A",
];

export const createStandard52CardDeck = (): readonly StandardCard[] =>
  CARD_SUITS.flatMap((suit) =>
    CARD_RANKS.map((rank) => ({ id: `${suit}-${rank}`, rank, suit })),
  );

export const createStandard54CardDeck = (): readonly WildcardCard[] => [
  ...createStandard52CardDeck(),
  { id: "joker-red", rank: "JOKER", suit: "joker" },
  { id: "joker-black", rank: "JOKER", suit: "joker" },
];

export const shuffleCards = <T>(
  cards: readonly T[],
  seed: number | string,
): readonly T[] => {
  const shuffled = [...cards];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(
      seededUnit(`${seed}:shuffle:${index}`) * (index + 1),
    );
    [shuffled[index], shuffled[swapIndex]] = [
      shuffled[swapIndex],
      shuffled[index],
    ];
  }
  return shuffled;
};

export interface WildcardEffect {
  readonly scoreBonus: number;
  readonly damageReduction: number;
  readonly ignoredHits: number;
}

export const getWildcardCardEffect = (
  card: WildcardCard,
): WildcardEffect => {
  if (card.rank === "JOKER")
    return { scoreBonus: 0, damageReduction: 0, ignoredHits: 5 };
  if (card.rank === "A")
    return { scoreBonus: 0.6, damageReduction: 0.6, ignoredHits: 0 };
  if (card.rank === "K")
    return { scoreBonus: 0, damageReduction: 0.5, ignoredHits: 0 };
  if (card.rank === "Q")
    return { scoreBonus: 0, damageReduction: 0.2, ignoredHits: 0 };
  if (card.rank === "J")
    return { scoreBonus: 0, damageReduction: 0.1, ignoredHits: 0 };
  return {
    scoreBonus: Number(card.rank) * 0.05,
    damageReduction: 0,
    ignoredHits: 0,
  };
};

export const WILDCARD_PERMANENT_DECK_EFFECT: WildcardEffect = {
  scoreBonus: 0.6,
  damageReduction: 0.6,
  ignoredHits: 5,
};

export interface WildcardDeckState {
  readonly deck: readonly WildcardCard[];
  readonly nextIndex: number;
  readonly permanentAceAndJoker: boolean;
}

export const createWildcardDeckState = (
  seed: number | string,
): WildcardDeckState => ({
  deck: shuffleCards(createStandard54CardDeck(), seed),
  nextIndex: 0,
  permanentAceAndJoker: false,
});

export const drawWildcardCard = (
  state: WildcardDeckState,
): Readonly<{
  card: WildcardCard;
  waveEffect: WildcardEffect;
  permanentEffect: WildcardEffect | null;
  state: WildcardDeckState;
}> => {
  const safeIndex = clamp(Math.floor(state.nextIndex), 0, state.deck.length - 1);
  const card = state.deck[safeIndex];
  const exhausted = safeIndex + 1 >= state.deck.length;
  const permanentAceAndJoker = state.permanentAceAndJoker || exhausted;
  return {
    card,
    waveEffect: getWildcardCardEffect(card),
    permanentEffect: permanentAceAndJoker
      ? WILDCARD_PERMANENT_DECK_EFFECT
      : null,
    state: {
      deck: state.deck,
      // A completed deck loops for visuals while its Ace + Joker buffs stay active.
      nextIndex: exhausted ? 0 : safeIndex + 1,
      permanentAceAndJoker,
    },
  };
};

export type GambitHand =
  | "high-card"
  | "pair"
  | "two-pair"
  | "three-of-a-kind"
  | "straight"
  | "flush"
  | "four-of-a-kind"
  | "straight-flush"
  | "royal-flush";

const GAMBIT_HAND_STRENGTH: Readonly<Record<GambitHand, number>> = {
  "high-card": 0,
  pair: 1,
  "two-pair": 2,
  "three-of-a-kind": 3,
  straight: 4,
  flush: 5,
  "four-of-a-kind": 6,
  "straight-flush": 7,
  "royal-flush": 8,
};

const rankValue = (rank: StandardCardRank) => {
  if (rank === "J") return 11;
  if (rank === "Q") return 12;
  if (rank === "K") return 13;
  if (rank === "A") return 14;
  return Number(rank);
};

const isStraight = (cards: readonly StandardCard[]) => {
  const values = [...new Set(cards.map((card) => rankValue(card.rank)))].sort(
    (left, right) => left - right,
  );
  if (values.length !== 5) return false;
  const wheel = values.join(",") === "2,3,4,5,14";
  return wheel || values[4] - values[0] === 4;
};

const evaluateFiveCardGambitHand = (
  cards: readonly StandardCard[],
): GambitHand => {
  const counts = new Map<StandardCardRank, number>();
  for (const card of cards)
    counts.set(card.rank, (counts.get(card.rank) ?? 0) + 1);
  const groups = [...counts.values()].sort((left, right) => right - left);
  const flush = cards.every((card) => card.suit === cards[0]?.suit);
  const straight = isStraight(cards);
  const royal =
    straight &&
    flush &&
    [10, 11, 12, 13, 14].every((value) =>
      cards.some((card) => rankValue(card.rank) === value),
    );
  if (royal) return "royal-flush";
  if (straight && flush) return "straight-flush";
  if (groups[0] === 4) return "four-of-a-kind";
  if (flush) return "flush";
  if (straight) return "straight";
  // Full house has no separate attached reward, so its documented qualifying
  // component is the three-of-a-kind reward.
  if (groups[0] === 3) return "three-of-a-kind";
  if (groups[0] === 2 && groups[1] === 2) return "two-pair";
  if (groups[0] === 2) return "pair";
  return "high-card";
};

const fiveCardCombinations = (
  cards: readonly StandardCard[],
): readonly (readonly StandardCard[])[] => {
  const combinations: StandardCard[][] = [];
  for (let a = 0; a < cards.length - 4; a += 1)
    for (let b = a + 1; b < cards.length - 3; b += 1)
      for (let c = b + 1; c < cards.length - 2; c += 1)
        for (let d = c + 1; d < cards.length - 1; d += 1)
          for (let e = d + 1; e < cards.length; e += 1)
            combinations.push([
              cards[a],
              cards[b],
              cards[c],
              cards[d],
              cards[e],
            ]);
  return combinations;
};

/** Evaluates the strongest documented reward among Gambit's 5–10 held cards. */
export const evaluateGambitHand = (
  cards: readonly StandardCard[],
): GambitHand | null => {
  if (cards.length < 5 || cards.length > 10) return null;
  let best: GambitHand = "high-card";
  for (const combination of fiveCardCombinations(cards)) {
    const hand = evaluateFiveCardGambitHand(combination);
    if (GAMBIT_HAND_STRENGTH[hand] > GAMBIT_HAND_STRENGTH[best]) best = hand;
  }
  return best;
};

export interface GambitReward {
  readonly label: string;
  readonly scoreMultiplier?: number;
  readonly scoreWaves?: number;
  readonly damageReduction?: number;
  readonly damageReductionWaves?: number;
  readonly permanentDamageReduction?: number;
  readonly setHearts?: number;
  readonly setMaxHearts?: number;
  readonly healToFull?: boolean;
  readonly opponentCoinStealFraction?: number;
  readonly stealAllOpponentCoins?: boolean;
  readonly doubleCurrentCoins?: boolean;
  readonly invincibleWaves?: number;
  readonly doubleSentObstacles?: boolean;
  readonly revives?: number;
  readonly lastLifeScoreMultiplier?: number;
  readonly permanentScoreMultiplier?: number;
}

export const GAMBIT_REWARDS: Readonly<Record<GambitHand, GambitReward>> = {
  "high-card": {
    label: "HIGH CARD · +5% SCORE THIS WAVE",
    scoreMultiplier: 1.05,
    scoreWaves: 1,
  },
  pair: {
    label: "PAIR · +15% SCORE · 30% LESS DAMAGE THIS WAVE",
    scoreMultiplier: 1.15,
    scoreWaves: 1,
    damageReduction: 0.3,
    damageReductionWaves: 1,
  },
  "two-pair": {
    label: "TWO PAIR · HEAL FULL · STEAL 25% COINS · +30% SCORE",
    healToFull: true,
    opponentCoinStealFraction: 0.25,
    scoreMultiplier: 1.3,
    scoreWaves: 1,
  },
  "three-of-a-kind": {
    label: "THREE OF A KIND · 75% LESS DAMAGE THIS WAVE",
    damageReduction: 0.75,
    damageReductionWaves: 1,
  },
  straight: {
    label: "STRAIGHT · SET 5 HP · MAX HP 4 · +50% SCORE",
    setHearts: 5,
    setMaxHearts: 4,
    scoreMultiplier: 1.5,
    scoreWaves: 1,
  },
  flush: {
    label: "FLUSH · SET 1 HP · 95% LESS DAMAGE THIS WAVE",
    setHearts: 1,
    damageReduction: 0.95,
    damageReductionWaves: 1,
  },
  "four-of-a-kind": {
    label: "FOUR OF A KIND · SET 10 HP",
    setHearts: 10,
  },
  "straight-flush": {
    label:
      "STRAIGHT FLUSH · INVINCIBLE 1 WAVE · ×3 SCORE 3 WAVES · PERMANENT 30% ARMOR",
    invincibleWaves: 1,
    scoreMultiplier: 3,
    scoreWaves: 3,
    damageReduction: 0.75,
    damageReductionWaves: 2,
    permanentDamageReduction: 0.3,
    doubleSentObstacles: true,
  },
  "royal-flush": {
    label:
      "ROYAL FLUSH · 10 MAX HP · 3 INVINCIBLE WAVES · 3 REVIVES · PERMANENT 80% ARMOR",
    setHearts: 10,
    setMaxHearts: 10,
    stealAllOpponentCoins: true,
    doubleCurrentCoins: true,
    invincibleWaves: 3,
    permanentDamageReduction: 0.8,
    revives: 3,
    lastLifeScoreMultiplier: 6,
    permanentScoreMultiplier: 2,
  },
};

export const getGambitReward = (hand: GambitHand) => GAMBIT_REWARDS[hand];

export const getSparkScoreMultiplier = (gemsCollectedThisRun: number) =>
  1 + Math.max(0, Math.floor(finiteOr(gemsCollectedThisRun))) * 0.01;

export const getPickpocketCoinSteal = (
  opponentAttackPoints: number,
  opponentAlsoPickpocket: boolean,
) => {
  if (opponentAlsoPickpocket) return 0;
  const available = Math.max(0, finiteOr(opponentAttackPoints));
  if (available <= 0) return 0;
  return Math.min(available, Math.max(1, Math.ceil(available * 0.1)));
};

export const getRogueActionForGrazes = (grazes: number) => {
  const count = Math.max(0, Math.floor(finiteOr(grazes)));
  if (count >= 10)
    return { kind: "invincibility", durationSeconds: 5, locksLane: true } as const;
  if (count >= 5) return { kind: "clear-all-obstacles" } as const;
  if (count >= 2)
    return {
      kind: "invincibility",
      durationSeconds: 0.45,
      locksLane: true,
    } as const;
  return { kind: "not-ready" } as const;
};

export const getSwitchMilestones = (cumulativeLaneChanges: number) => {
  const changes = Math.max(0, Math.floor(finiteOr(cumulativeLaneChanges)));
  return {
    scoreMultiplier: changes >= 50 ? 1.1 : 1,
    laneChangeInvincibilitySeconds: changes >= 100 ? 0.25 : 0,
    invincibilityDelaySeconds: changes >= 100 ? 0.01 : 0,
    canScrambleOpponentShop: changes >= 1000,
  } as const;
};

export const getCometSendOffer = (basePrice: number, baseAmount: number) => ({
  price: Math.ceil(Math.max(0, finiteOr(basePrice)) / 2),
  amount: Math.max(0, Math.floor(finiteOr(baseAmount))) * 2,
});

export const getCometRemovalCost = (kind: HazardKind) => {
  if (kind === "barrel" || kind === "log") return 6;
  if (kind === "snowflake") return 7;
  if (kind === "car" || kind === "spikes" || kind === "rock") return 8;
  return null;
};

export const getFortuneGemChanceBonus = (gemsCollectedThisRun: number) =>
  clamp(Math.floor(finiteOr(gemsCollectedThisRun)) / 100, 0, 1);

/**
 * Fortune adds one percentage point per gem collected during this run. The
 * resulting probability, rather than only the bonus, is capped at 100%.
 */
export const getFortuneGemSpawnChance = (
  baseSpawnChance: number,
  gemsCollectedThisRun: number,
) =>
  clamp(
    finiteOr(baseSpawnChance) +
      getFortuneGemChanceBonus(gemsCollectedThisRun),
    0,
    1,
  );

export interface BrokerFunds {
  readonly gems: number;
  /** Coin/attack-point units, including fractional hidden points. */
  readonly coins: number;
  /** Score value banked by collected melons, not the number of melons. */
  readonly melons: number;
}

export type BrokerFundKind = keyof BrokerFunds;

export const EMPTY_BROKER_FUNDS: BrokerFunds = {
  gems: 0,
  coins: 0,
  melons: 0,
};

export interface BrokerMarketRoll {
  /** A unit roll below 0.6 raises the fund; all other rolls lower it. */
  readonly directionRoll: number;
  /** A unit roll mapped linearly to a 1%-50% change. */
  readonly percentageRoll: number;
}

export interface BrokerFundMovement {
  readonly before: number;
  readonly after: number;
  readonly direction: "up" | "down";
  readonly changeFraction: number;
}

/** Applies one deterministic Broker market roll to one non-negative fund. */
export const moveBrokerFundForWave = (
  fund: number,
  roll: BrokerMarketRoll,
): BrokerFundMovement => {
  const before = Math.max(0, finiteOr(fund));
  const direction =
    clamp(finiteOr(roll.directionRoll, 1), 0, 1) < 0.6 ? "up" : "down";
  const changeFraction =
    0.01 + clamp(finiteOr(roll.percentageRoll), 0, 1) * 0.49;
  return {
    before,
    after: Math.max(
      0,
      before * (direction === "up" ? 1 + changeFraction : 1 - changeFraction),
    ),
    direction,
    changeFraction,
  };
};

export type BrokerMarketRolls = Readonly<Record<BrokerFundKind, BrokerMarketRoll>>;

/** Moves all three independent Broker funds once at wave end. */
export const moveBrokerFundsForWave = (
  funds: BrokerFunds,
  rolls: BrokerMarketRolls,
) => {
  const movements = {
    gems: moveBrokerFundForWave(funds.gems, rolls.gems),
    coins: moveBrokerFundForWave(funds.coins, rolls.coins),
    melons: moveBrokerFundForWave(funds.melons, rolls.melons),
  } as const;
  return {
    funds: {
      gems: movements.gems.after,
      coins: movements.coins.after,
      melons: movements.melons.after,
    },
    movements,
  } as const;
};

export const addToBrokerFund = (
  funds: BrokerFunds,
  kind: BrokerFundKind,
  amount: number,
): BrokerFunds => ({
  ...funds,
  [kind]: Math.max(0, finiteOr(funds[kind])) + Math.max(0, finiteOr(amount)),
});

/** Claims the coin fund during a run and leaves the other funds invested. */
export const claimBrokerCoinFund = (
  funds: BrokerFunds,
  currentAttackPoints: number,
) => {
  const claimed = Math.max(0, finiteOr(funds.coins));
  return {
    claimed,
    attackPoints: Math.max(0, finiteOr(currentAttackPoints)) + claimed,
    funds: { ...funds, coins: 0 },
  } as const;
};

export interface BrokerPayoutTotals {
  readonly gems: number;
  readonly attackPoints: number;
  readonly score: number;
}

/**
 * Settles every Broker fund on death. The melon fund already stores score
 * value, so score bonuses are applied when a melon enters the fund, not here.
 */
export const settleBrokerFundsOnDeath = (
  funds: BrokerFunds,
  totals: BrokerPayoutTotals,
) => ({
  payout: {
    gems: Math.max(0, finiteOr(funds.gems)),
    attackPoints: Math.max(0, finiteOr(funds.coins)),
    score: Math.max(0, finiteOr(funds.melons)),
  },
  totals: {
    gems:
      Math.max(0, finiteOr(totals.gems)) +
      Math.max(0, finiteOr(funds.gems)),
    attackPoints:
      Math.max(0, finiteOr(totals.attackPoints)) +
      Math.max(0, finiteOr(funds.coins)),
    score:
      Math.max(0, finiteOr(totals.score)) +
      Math.max(0, finiteOr(funds.melons)),
  },
  funds: EMPTY_BROKER_FUNDS,
});

export interface ProspectorGemWarningSchedule {
  readonly gemId: string | number;
  readonly lane: number;
  readonly warningAtMs: number;
  readonly spawnAtMs: number;
  readonly warningDurationMs: 5000;
}

/** Gives Prospector a stable lane warning exactly five seconds before spawn. */
export const getProspectorGemWarningSchedule = (
  gemId: string | number,
  lane: number,
  spawnAtMs: number,
  laneCount = 5,
): ProspectorGemWarningSchedule => {
  const safeLaneCount = Math.max(1, Math.floor(finiteOr(laneCount, 5)));
  const safeSpawnAtMs = Math.max(0, finiteOr(spawnAtMs));
  return {
    gemId,
    lane: clamp(Math.floor(finiteOr(lane)), 0, safeLaneCount - 1),
    warningAtMs: Math.max(0, safeSpawnAtMs - 5000),
    spawnAtMs: safeSpawnAtMs,
    warningDurationMs: 5000,
  };
};

export const getScribeHazardCap = (wave: number) =>
  Math.max(1, Math.floor(Math.max(0, finiteOr(wave)) / 10));

export interface WeaverSnowflakeState {
  readonly snowflakesSinceJacket: number;
  readonly healedThisWave: number;
}

export const canWeaverCreateJacket = (snowflakesCollected: number) =>
  Math.max(0, Math.floor(finiteOr(snowflakesCollected))) >= 5;

/**
 * Resolves one post-jacket snowflake. Every second snowflake heals half a heart,
 * while the per-wave healing total can never exceed one heart.
 */
export const resolveWeaverSnowflake = (
  state: WeaverSnowflakeState,
  jacketActive: boolean,
) => {
  if (!jacketActive)
    return {
      state: {
        snowflakesSinceJacket: Math.max(
          0,
          Math.floor(finiteOr(state.snowflakesSinceJacket)),
        ),
        healedThisWave: clamp(finiteOr(state.healedThisWave), 0, 1),
      },
      blocksFreeze: false,
      healing: 0,
    } as const;

  const snowflakesSinceJacket =
    Math.max(0, Math.floor(finiteOr(state.snowflakesSinceJacket))) + 1;
  const healedThisWave = clamp(finiteOr(state.healedThisWave), 0, 1);
  const healing =
    snowflakesSinceJacket % 2 === 0 ? Math.min(0.5, 1 - healedThisWave) : 0;
  return {
    state: {
      snowflakesSinceJacket,
      healedThisWave: healedThisWave + healing,
    },
    blocksFreeze: true,
    healing,
  } as const;
};

export const getCatalystPickupSpeedMultiplier = (laneDistance: number) =>
  Math.abs(finiteOr(laneDistance)) >= 2 ? 0.5 : 1.5;

export type HarvesterPickupKind = "gem" | "melon" | "attack-point";
export const getHarvesterAbilityTier = (collected: number) => {
  const count = Math.max(0, Math.floor(finiteOr(collected)));
  if (count >= 50) return "upgraded" as const;
  if (count >= 10) return "base" as const;
  return "locked" as const;
};

export type HarvesterAbility =
  | {
      readonly kind: HarvesterPickupKind;
      readonly tier: "locked";
      readonly unlockAt: 10;
      readonly upgradeAt: 50;
    }
  | {
      readonly kind: "gem";
      readonly tier: "base" | "upgraded";
      readonly cooldownSeconds: 30;
      readonly durationSeconds: 10 | 20;
      readonly healPerDeflectedObstacle: 0.5 | 1;
      readonly sendsDeflectedObstaclesIn1v1: true;
    }
  | {
      readonly kind: "melon";
      readonly tier: "base" | "upgraded";
      readonly cooldownSeconds: 30 | 45;
      readonly removal: "first-obstacle-per-lane" | "all-obstacles";
      readonly rewardWhenEveryLaneCleared:
        | "heal-to-full"
        | "invincible-15-seconds";
    }
  | {
      readonly kind: "attack-point";
      readonly tier: "base" | "upgraded";
      readonly cooldownSeconds: 30;
      readonly fakeCoinSteal: 10 | 20;
      readonly opponentPurchaseCostMultiplier: 1 | 1.2;
    };

/** Returns the exact unlocked action for one of Harvester's three counters. */
export const getHarvesterAbility = (
  kind: HarvesterPickupKind,
  collected: number,
): HarvesterAbility => {
  const tier = getHarvesterAbilityTier(collected);
  if (tier === "locked") return { kind, tier, unlockAt: 10, upgradeAt: 50 };
  if (kind === "gem")
    return {
      kind,
      tier,
      cooldownSeconds: 30,
      durationSeconds: tier === "upgraded" ? 20 : 10,
      healPerDeflectedObstacle: tier === "upgraded" ? 1 : 0.5,
      sendsDeflectedObstaclesIn1v1: true,
    };
  if (kind === "melon")
    return {
      kind,
      tier,
      cooldownSeconds: tier === "upgraded" ? 45 : 30,
      removal:
        tier === "upgraded" ? "all-obstacles" : "first-obstacle-per-lane",
      rewardWhenEveryLaneCleared:
        tier === "upgraded" ? "invincible-15-seconds" : "heal-to-full",
    };
  return {
    kind,
    tier,
    cooldownSeconds: 30,
    fakeCoinSteal: tier === "upgraded" ? 20 : 10,
    opponentPurchaseCostMultiplier: tier === "upgraded" ? 1.2 : 1,
  };
};

export interface HarvesterPickupCounts {
  readonly gems: number;
  readonly melons: number;
  readonly attackPoints: number;
}

export const getHarvesterAbilities = (
  counts: HarvesterPickupCounts,
): readonly HarvesterAbility[] => [
  getHarvesterAbility("gem", counts.gems),
  getHarvesterAbility("melon", counts.melons),
  getHarvesterAbility("attack-point", counts.attackPoints),
];

export const MUSE_MAX_VISIBLE_OBSTACLES = 5;
export const MUSE_RHYTHM_DURATION_MS = 15_000;
export const MUSE_RHYTHM_MAX_HITS = 30;

export const clampMuseRhythmHits = (hits: number) =>
  clamp(Math.floor(finiteOr(hits)), 0, MUSE_RHYTHM_MAX_HITS);

export const getMuseRemainingObstacleSlots = (visibleObstacles: number) =>
  Math.max(
    0,
    MUSE_MAX_VISIBLE_OBSTACLES -
      Math.max(0, Math.floor(finiteOr(visibleObstacles))),
  );

/** Muse Mix heals on each completed 10-second interval of its 30-second run. */
export const getMuseMixHealPulses = (elapsedSeconds: number) =>
  clamp(Math.floor(Math.max(0, finiteOr(elapsedSeconds)) / 10), 0, 3);

/** Starts above 90%, rises two points after each replay revive, and caps at 100%. */
export const getMuseReplayAccuracyRequirement = (
  successfulReplayRevives: number,
) =>
  clamp(
    90 + Math.max(0, Math.floor(finiteOr(successfulReplayRevives))) * 2,
    90,
    100,
  );

export const meetsMuseReplayAccuracyRequirement = (
  accuracyPercent: number,
  successfulReplayRevives: number,
) => {
  const accuracy = clamp(finiteOr(accuracyPercent), 0, 100);
  const requirement = getMuseReplayAccuracyRequirement(successfulReplayRevives);
  return requirement === 100 ? accuracy === 100 : accuracy > requirement;
};

export interface MuseReward {
  readonly tier: "basic" | "mix" | "advanced" | "disco" | "perfect";
  readonly scoreBonus: number;
  readonly hazardSlow: number;
  readonly damageReduction: number;
  readonly unlocksMuseMix: boolean;
  readonly unlocksNotes: boolean;
  readonly perfectRevival: boolean;
}

export const getMuseReward = (accuracyPercent: number): MuseReward => {
  const accuracy = clamp(finiteOr(accuracyPercent), 0, 100);
  if (accuracy === 100)
    return {
      tier: "perfect",
      scoreBonus: 1,
      hazardSlow: 0.3,
      damageReduction: 0.75,
      unlocksMuseMix: true,
      unlocksNotes: true,
      perfectRevival: true,
    };
  if (accuracy >= 90)
    return {
      tier: "disco",
      scoreBonus: 0.5,
      hazardSlow: 0.2,
      damageReduction: 0.5,
      unlocksMuseMix: true,
      unlocksNotes: true,
      perfectRevival: false,
    };
  if (accuracy >= 75)
    return {
      tier: "advanced",
      scoreBonus: 0.5,
      hazardSlow: 0.2,
      damageReduction: 0.5,
      unlocksMuseMix: true,
      unlocksNotes: false,
      perfectRevival: false,
    };
  if (accuracy > 50)
    return {
      tier: "mix",
      scoreBonus: 0.2,
      hazardSlow: 0.05,
      damageReduction: 0.3,
      unlocksMuseMix: true,
      unlocksNotes: false,
      perfectRevival: false,
    };
  return {
    tier: "basic",
    scoreBonus: 0.2,
    hazardSlow: 0.05,
    damageReduction: 0.3,
    unlocksMuseMix: false,
    unlocksNotes: false,
    perfectRevival: false,
  };
};

export interface LaneOccupant {
  readonly lane: number;
}

/** A simultaneous group is safe only when at least one valid lane remains open. */
export const isDodgeableLaneGroup = (
  occupants: readonly LaneOccupant[],
  laneCount = 5,
) => {
  const validLaneCount = Math.max(1, Math.floor(finiteOr(laneCount, 5)));
  const occupied = new Set(
    occupants
      .map((occupant) => Math.floor(occupant.lane))
      .filter((lane) => lane >= 0 && lane < validLaneCount),
  );
  return occupied.size < validLaneCount;
};

/**
 * Splits incoming attacks into sequential rows that cannot overlap in one lane
 * and can never cover all lanes. Five rocks therefore become a safe 4 + 1.
 */
export const partitionDodgeableLaneGroups = <T extends LaneOccupant>(
  occupants: readonly T[],
  laneCount = 5,
): readonly (readonly T[])[] => {
  const validLaneCount = Math.max(1, Math.floor(finiteOr(laneCount, 5)));
  const maxOccupiedLanes = Math.max(0, validLaneCount - 1);
  if (maxOccupiedLanes === 0) return occupants.map((occupant) => [occupant]);
  const groups: T[][] = [];
  let current: T[] = [];
  let currentLanes = new Set<number>();
  for (const occupant of occupants) {
    const lane = clamp(Math.floor(occupant.lane), 0, validLaneCount - 1);
    const wouldOverlap = currentLanes.has(lane);
    const wouldBlockEveryLane = currentLanes.size >= maxOccupiedLanes;
    if (current.length > 0 && (wouldOverlap || wouldBlockEveryLane)) {
      groups.push(current);
      current = [];
      currentLanes = new Set<number>();
    }
    current.push(occupant);
    currentLanes.add(lane);
  }
  if (current.length > 0) groups.push(current);
  return groups;
};
