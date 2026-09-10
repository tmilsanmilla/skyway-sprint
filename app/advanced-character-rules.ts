/**
 * Deterministic rules for the characters whose abilities need persistent,
 * multi-step state. This file intentionally has no React, DOM, audio, timer,
 * or Supabase dependencies so the client can render the returned state while
 * an authoritative 1v1 service validates the same transitions.
 */

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

const finiteOr = (value: number, fallback = 0) =>
  Number.isFinite(value) ? value : fallback;

const nonNegativeInteger = (value: number) =>
  Math.max(0, Math.floor(finiteOr(value)));

const seedText = (seed: string | number) => String(seed);

const seededUnit = (seed: string) => {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  hash += hash << 13;
  hash ^= hash >>> 7;
  hash += hash << 3;
  hash ^= hash >>> 17;
  hash += hash << 5;
  return (hash >>> 0) / 4_294_967_296;
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

export const STANDARD_CARD_SUITS: readonly CardSuit[] = [
  "clubs",
  "diamonds",
  "hearts",
  "spades",
];

export const STANDARD_CARD_RANKS: readonly StandardCardRank[] = [
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

export const createStandardDeck = (): readonly StandardCard[] =>
  STANDARD_CARD_SUITS.flatMap((suit) =>
    STANDARD_CARD_RANKS.map((rank) => ({
      id: `${suit}-${rank}`,
      rank,
      suit,
    })),
  );

export const createWildcardDeck = (): readonly WildcardCard[] => [
  ...createStandardDeck(),
  { id: "joker-red", rank: "JOKER", suit: "joker" },
  { id: "joker-black", rank: "JOKER", suit: "joker" },
];

export const shuffleCardDeck = <T>(
  cards: readonly T[],
  seed: string | number,
): readonly T[] => {
  const shuffled = [...cards];
  const prefix = seedText(seed);
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(
      seededUnit(`${prefix}:card:${index}`) * (index + 1),
    );
    [shuffled[index], shuffled[swapIndex]] = [
      shuffled[swapIndex],
      shuffled[index],
    ];
  }
  return shuffled;
};

// ---------------------------------------------------------------------------
// Wildcard

export interface WildcardRoundEffect {
  /** A value of 1.60 means the player earns 60% more score. */
  readonly scoreMultiplier: number;
  /** A value of 0.40 means the player takes 60% less damage. */
  readonly damageMultiplier: number;
  readonly ignoredHits: number;
  readonly label: string;
}

export const WILDCARD_PERMANENT_EFFECT: WildcardRoundEffect = {
  scoreMultiplier: 1.6,
  damageMultiplier: 0.4,
  ignoredHits: 5,
  label: "ACE + JOKER · PERMANENT",
};

export const getWildcardEffect = (
  card: WildcardCard,
): WildcardRoundEffect => {
  if (card.rank === "JOKER")
    return {
      scoreMultiplier: 1,
      damageMultiplier: 1,
      ignoredHits: 5,
      label: "JOKER · IGNORE 5 HITS",
    };
  if (card.rank === "A")
    return {
      scoreMultiplier: 1.6,
      damageMultiplier: 0.4,
      ignoredHits: 0,
      label: "ACE · +60% SCORE · 60% LESS DAMAGE",
    };
  if (card.rank === "K")
    return {
      scoreMultiplier: 1,
      damageMultiplier: 0.5,
      ignoredHits: 0,
      label: "KING · 50% LESS DAMAGE",
    };
  if (card.rank === "Q")
    return {
      scoreMultiplier: 1,
      damageMultiplier: 0.8,
      ignoredHits: 0,
      label: "QUEEN · 20% LESS DAMAGE",
    };
  if (card.rank === "J")
    return {
      scoreMultiplier: 1,
      damageMultiplier: 0.9,
      ignoredHits: 0,
      label: "JACK · 10% LESS DAMAGE",
    };
  const bonusPercent = Number(card.rank) * 5;
  return {
    scoreMultiplier: 1 + bonusPercent / 100,
    damageMultiplier: 1,
    ignoredHits: 0,
    label: `${card.rank} · +${bonusPercent}% SCORE`,
  };
};

export interface WildcardState {
  readonly seed: string;
  readonly cycle: number;
  readonly deck: readonly WildcardCard[];
  readonly nextIndex: number;
  readonly cardsDrawn: number;
  readonly permanentAceAndJoker: boolean;
}

const wildcardDeckForCycle = (seed: string, cycle: number) =>
  shuffleCardDeck(createWildcardDeck(), `${seed}:wildcard:${cycle}`);

export const createWildcardState = (
  seed: string | number,
): WildcardState => {
  const normalizedSeed = seedText(seed);
  return {
    seed: normalizedSeed,
    cycle: 0,
    deck: wildcardDeckForCycle(normalizedSeed, 0),
    nextIndex: 0,
    cardsDrawn: 0,
    permanentAceAndJoker: false,
  };
};

export interface WildcardDrawResult {
  readonly card: WildcardCard;
  readonly roundEffect: WildcardRoundEffect;
  /** Render this separately from the round card; it remains active forever. */
  readonly permanentEffect: WildcardRoundEffect | null;
  readonly completedDeckThisDraw: boolean;
  readonly state: WildcardState;
}

export const drawWildcard = (
  state: WildcardState,
): WildcardDrawResult => {
  const needsNewDeck = state.nextIndex >= state.deck.length;
  const cycle = needsNewDeck ? state.cycle + 1 : state.cycle;
  const deck = needsNewDeck
    ? wildcardDeckForCycle(state.seed, cycle)
    : state.deck;
  const nextIndex = needsNewDeck ? 0 : state.nextIndex;
  const card = deck[nextIndex];
  const completedDeckThisDraw = nextIndex + 1 === deck.length;
  const permanentAceAndJoker =
    state.permanentAceAndJoker || completedDeckThisDraw;
  return {
    card,
    roundEffect: getWildcardEffect(card),
    permanentEffect: permanentAceAndJoker
      ? WILDCARD_PERMANENT_EFFECT
      : null,
    completedDeckThisDraw,
    state: {
      seed: state.seed,
      cycle,
      deck,
      nextIndex: nextIndex + 1,
      cardsDrawn: state.cardsDrawn + 1,
      permanentAceAndJoker,
    },
  };
};

// ---------------------------------------------------------------------------
// Gambit

export const GAMBIT_DRAW_SIZE = 5;
export const GAMBIT_MAX_HAND_SIZE = 10;

export interface GambitState {
  readonly seed: string;
  readonly cycle: number;
  readonly drawPile: readonly StandardCard[];
  readonly discardPile: readonly StandardCard[];
  readonly hand: readonly StandardCard[];
}

const gambitDeckForCycle = (seed: string, cycle: number) =>
  shuffleCardDeck(createStandardDeck(), `${seed}:gambit:${cycle}`);

export const createGambitState = (
  seed: string | number,
): GambitState => {
  const normalizedSeed = seedText(seed);
  return {
    seed: normalizedSeed,
    cycle: 0,
    drawPile: gambitDeckForCycle(normalizedSeed, 0),
    discardPile: [],
    hand: [],
  };
};

export type GambitDrawResult =
  | {
      readonly ok: false;
      readonly reason: "discard-required";
      readonly discardRequired: number;
      readonly state: GambitState;
    }
  | {
      readonly ok: true;
      readonly drawn: readonly StandardCard[];
      readonly state: GambitState;
    };

/**
 * Draws exactly five cards. The state is left untouched until the player has
 * made five free hand slots, which keeps the 10-card limit unambiguous in UI.
 */
export const drawGambitWave = (state: GambitState): GambitDrawResult => {
  const freeSlots = GAMBIT_MAX_HAND_SIZE - state.hand.length;
  if (freeSlots < GAMBIT_DRAW_SIZE)
    return {
      ok: false,
      reason: "discard-required",
      discardRequired: GAMBIT_DRAW_SIZE - freeSlots,
      state,
    };

  let cycle = state.cycle;
  let drawPile = [...state.drawPile];
  let discardPile = [...state.discardPile];
  const drawn: StandardCard[] = [];
  while (drawn.length < GAMBIT_DRAW_SIZE) {
    if (drawPile.length === 0) {
      cycle += 1;
      drawPile = shuffleCardDeck(
        discardPile,
        `${state.seed}:gambit:${cycle}`,
      ) as StandardCard[];
      discardPile = [];
    }
    const card = drawPile.shift();
    // With at most ten held cards, a standard deck always leaves enough cards
    // to satisfy a five-card draw. This guard also keeps corrupt state safe.
    if (!card) break;
    drawn.push(card);
  }
  return {
    ok: true,
    drawn,
    state: {
      seed: state.seed,
      cycle,
      drawPile,
      discardPile,
      hand: [...state.hand, ...drawn],
    },
  };
};

export const discardGambitCards = (
  state: GambitState,
  cardIds: readonly string[],
): GambitState => {
  const selected = new Set(cardIds);
  const discarded = state.hand.filter((card) => selected.has(card.id));
  return {
    ...state,
    hand: state.hand.filter((card) => !selected.has(card.id)),
    discardPile: [...state.discardPile, ...discarded],
  };
};

export type GambitHand =
  | "high-card"
  | "pair"
  | "two-pair"
  | "three-of-a-kind"
  | "straight"
  | "flush"
  | "full-house"
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
  "full-house": 6,
  "four-of-a-kind": 7,
  "straight-flush": 8,
  "royal-flush": 9,
};

const cardRankValue = (rank: StandardCardRank) => {
  if (rank === "J") return 11;
  if (rank === "Q") return 12;
  if (rank === "K") return 13;
  if (rank === "A") return 14;
  return Number(rank);
};

const isFiveCardStraight = (cards: readonly StandardCard[]) => {
  const values = [...new Set(cards.map(({ rank }) => cardRankValue(rank)))].sort(
    (left, right) => left - right,
  );
  if (values.length !== 5) return false;
  return (
    values.join(",") === "2,3,4,5,14" || values[4] - values[0] === 4
  );
};

const evaluateFiveCardHand = (
  cards: readonly StandardCard[],
): GambitHand => {
  const counts = new Map<StandardCardRank, number>();
  for (const card of cards)
    counts.set(card.rank, (counts.get(card.rank) ?? 0) + 1);
  const groups = [...counts.values()].sort((left, right) => right - left);
  const flush = cards.every(({ suit }) => suit === cards[0]?.suit);
  const straight = isFiveCardStraight(cards);
  const royal =
    straight &&
    flush &&
    [10, 11, 12, 13, 14].every((rank) =>
      cards.some((card) => cardRankValue(card.rank) === rank),
    );
  if (royal) return "royal-flush";
  if (straight && flush) return "straight-flush";
  if (groups[0] === 4) return "four-of-a-kind";
  if (groups[0] === 3 && groups[1] === 2) return "full-house";
  if (flush) return "flush";
  if (straight) return "straight";
  if (groups[0] === 3) return "three-of-a-kind";
  if (groups[0] === 2 && groups[1] === 2) return "two-pair";
  if (groups[0] === 2) return "pair";
  return "high-card";
};

const forEachFiveCardCombination = (
  cards: readonly StandardCard[],
  visitor: (cards: readonly StandardCard[]) => void,
) => {
  for (let a = 0; a < cards.length - 4; a += 1)
    for (let b = a + 1; b < cards.length - 3; b += 1)
      for (let c = b + 1; c < cards.length - 2; c += 1)
        for (let d = c + 1; d < cards.length - 1; d += 1)
          for (let e = d + 1; e < cards.length; e += 1)
            visitor([cards[a], cards[b], cards[c], cards[d], cards[e]]);
};

/** Returns the strongest poker pattern within any legal 5–10 card hand. */
export const evaluateGambitHand = (
  cards: readonly StandardCard[],
): GambitHand | null => {
  if (cards.length < 5 || cards.length > GAMBIT_MAX_HAND_SIZE) return null;
  let best: GambitHand = "high-card";
  forEachFiveCardCombination(cards, (combination) => {
    const candidate = evaluateFiveCardHand(combination);
    if (GAMBIT_HAND_STRENGTH[candidate] > GAMBIT_HAND_STRENGTH[best])
      best = candidate;
  });
  return best;
};

export interface GambitReward {
  readonly label: string;
  readonly immediate?: Readonly<{
    setHearts?: number;
    setMaxHearts?: number;
    healToFull?: boolean;
  }>;
  readonly temporary?: Readonly<{
    scoreMultiplier?: number;
    scoreWaves?: number;
    scoreStartsAfterWaves?: number;
    damageMultiplier?: number;
    damageWaves?: number;
    damageStartsAfterWaves?: number;
    invincibleWaves?: number;
  }>;
  readonly permanent?: Readonly<{
    setMaxHearts?: number;
    damageMultiplier?: number;
    scoreMultiplier?: number;
    scoreStartsAfterWaves?: number;
    revivesAtFullHealth?: number;
    lastLifeScoreMultiplier?: number;
  }>;
  readonly versus?: Readonly<{
    stealOpponentCoinsFraction?: number;
    stealAllOpponentCoins?: boolean;
    doubleCurrentCoins?: boolean;
    sentObstacleMultiplier?: number;
  }>;
  /** The attachment did not assign Full House its own reward. */
  readonly inheritedFrom?: GambitHand;
}

export const GAMBIT_REWARDS: Readonly<Record<GambitHand, GambitReward>> = {
  "high-card": {
    label: "HIGH CARD · +5% SCORE THIS WAVE",
    temporary: { scoreMultiplier: 1.05, scoreWaves: 1 },
  },
  pair: {
    label: "PAIR · +15% SCORE · 30% LESS DAMAGE THIS WAVE",
    temporary: {
      scoreMultiplier: 1.15,
      scoreWaves: 1,
      damageMultiplier: 0.7,
      damageWaves: 1,
    },
  },
  "two-pair": {
    label: "TWO PAIR · HEAL FULL · STEAL 25% COINS · +30% SCORE",
    immediate: { healToFull: true },
    temporary: { scoreMultiplier: 1.3, scoreWaves: 1 },
    versus: { stealOpponentCoinsFraction: 0.25 },
  },
  "three-of-a-kind": {
    label: "THREE OF A KIND · 75% LESS DAMAGE THIS WAVE",
    temporary: { damageMultiplier: 0.25, damageWaves: 1 },
  },
  straight: {
    label: "STRAIGHT · SET 5 HP · MAX HP 4 · +50% SCORE",
    immediate: { setHearts: 5, setMaxHearts: 4 },
    temporary: { scoreMultiplier: 1.5, scoreWaves: 1 },
    permanent: { setMaxHearts: 4 },
  },
  flush: {
    label: "FLUSH · SET 1 HP · 95% LESS DAMAGE THIS WAVE",
    immediate: { setHearts: 1 },
    temporary: { damageMultiplier: 0.05, damageWaves: 1 },
  },
  "full-house": {
    label: "FULL HOUSE · THREE-OF-A-KIND REWARD",
    temporary: { damageMultiplier: 0.25, damageWaves: 1 },
    inheritedFrom: "three-of-a-kind",
  },
  "four-of-a-kind": {
    label: "FOUR OF A KIND · SET 10 HP",
    immediate: { setHearts: 10 },
  },
  "straight-flush": {
    label:
      "STRAIGHT FLUSH · INVINCIBLE 1 WAVE · ×3 SCORE 3 WAVES · PERMANENT 30% ARMOR",
    temporary: {
      invincibleWaves: 1,
      scoreMultiplier: 3,
      scoreWaves: 3,
      damageMultiplier: 0.25,
      damageStartsAfterWaves: 1,
      damageWaves: 2,
    },
    permanent: { damageMultiplier: 0.7 },
    versus: { sentObstacleMultiplier: 2 },
  },
  "royal-flush": {
    label:
      "ROYAL FLUSH · 10 MAX HP · 3 INVINCIBLE WAVES · 3 REVIVES · PERMANENT 80% ARMOR",
    immediate: { setHearts: 10, setMaxHearts: 10 },
    temporary: { invincibleWaves: 3, scoreMultiplier: 3, scoreWaves: 3 },
    permanent: {
      setMaxHearts: 10,
      damageMultiplier: 0.2,
      scoreMultiplier: 2,
      scoreStartsAfterWaves: 3,
      revivesAtFullHealth: 3,
      lastLifeScoreMultiplier: 6,
    },
    versus: { stealAllOpponentCoins: true, doubleCurrentCoins: true },
  },
};

export const getGambitReward = (hand: GambitHand) =>
  GAMBIT_REWARDS[hand];

export interface GambitWaveWindow {
  readonly startsAtWave: number;
  readonly throughWave: number;
}

export interface GambitRewardSchedule {
  readonly hand: GambitHand;
  readonly label: string;
  readonly scoreWindow: (GambitWaveWindow & {
    readonly multiplier: number;
  }) | null;
  readonly damageWindow: (GambitWaveWindow & {
    readonly multiplier: number;
  }) | null;
  readonly invincibilityWindow: GambitWaveWindow | null;
  readonly permanentScoreMultiplier: number;
  readonly permanentScoreStartsAtWave: number | null;
  readonly permanentDamageMultiplier: number;
  readonly lastLifeScoreMultiplier: number;
  readonly sentObstacleMultiplier: number;
}

const createGambitWaveWindow = (
  rewardWave: number,
  waves: number | undefined,
  startsAfterWaves: number | undefined,
): GambitWaveWindow | null => {
  const duration = nonNegativeInteger(waves ?? 0);
  if (duration === 0) return null;
  const startsAtWave =
    Math.max(1, nonNegativeInteger(rewardWave)) +
    nonNegativeInteger(startsAfterWaves ?? 0);
  return {
    startsAtWave,
    throughWave: startsAtWave + duration - 1,
  };
};

/**
 * Turns Gambit's reward metadata into explicit inclusive wave boundaries.
 * Keeping the delay separate from the duration prevents Straight Flush's
 * delayed armor from accidentally expiring before it ever becomes active.
 */
export const getGambitRewardSchedule = (
  hand: GambitHand,
  rewardWave: number,
): GambitRewardSchedule => {
  const reward = getGambitReward(hand);
  const scoreWindow = createGambitWaveWindow(
    rewardWave,
    reward.temporary?.scoreWaves,
    reward.temporary?.scoreStartsAfterWaves,
  );
  const damageWindow = createGambitWaveWindow(
    rewardWave,
    reward.temporary?.damageWaves,
    reward.temporary?.damageStartsAfterWaves,
  );
  const invincibilityWindow = createGambitWaveWindow(
    rewardWave,
    reward.temporary?.invincibleWaves,
    0,
  );
  const permanentScoreMultiplier = Math.max(
    1,
    finiteOr(reward.permanent?.scoreMultiplier ?? 1, 1),
  );
  return {
    hand,
    label: reward.label,
    scoreWindow: scoreWindow
      ? {
          ...scoreWindow,
          multiplier: Math.max(
            0,
            finiteOr(reward.temporary?.scoreMultiplier ?? 1, 1),
          ),
        }
      : null,
    damageWindow: damageWindow
      ? {
          ...damageWindow,
          multiplier: Math.max(
            0,
            finiteOr(reward.temporary?.damageMultiplier ?? 1, 1),
          ),
        }
      : null,
    invincibilityWindow,
    permanentScoreMultiplier,
    permanentScoreStartsAtWave:
      reward.permanent?.scoreMultiplier === undefined
        ? null
        : Math.max(1, nonNegativeInteger(rewardWave)) +
          nonNegativeInteger(reward.permanent.scoreStartsAfterWaves ?? 0),
    permanentDamageMultiplier: Math.max(
      0,
      finiteOr(reward.permanent?.damageMultiplier ?? 1, 1),
    ),
    lastLifeScoreMultiplier: Math.max(
      1,
      finiteOr(reward.permanent?.lastLifeScoreMultiplier ?? 1, 1),
    ),
    sentObstacleMultiplier: Math.max(
      1,
      finiteOr(reward.versus?.sentObstacleMultiplier ?? 1, 1),
    ),
  };
};

const isWaveInGambitWindow = (
  window: GambitWaveWindow | null,
  wave: number,
) => {
  if (!window) return false;
  const safeWave = Math.max(1, nonNegativeInteger(wave));
  return (
    safeWave >= window.startsAtWave && safeWave <= window.throughWave
  );
};

export interface GambitWaveEffects {
  readonly scoreMultiplier: number;
  readonly damageMultiplier: number;
  readonly invincible: boolean;
  readonly onLastLife: boolean;
  readonly sentObstacleMultiplier: number;
}

/** Resolves every timed/permanent multiplier for one wave exactly once. */
export const getGambitWaveEffects = (
  schedule: GambitRewardSchedule,
  wave: number,
  currentHearts: number,
): GambitWaveEffects => {
  const safeWave = Math.max(1, nonNegativeInteger(wave));
  const temporaryScore = isWaveInGambitWindow(schedule.scoreWindow, safeWave)
    ? schedule.scoreWindow?.multiplier ?? 1
    : 1;
  const temporaryDamage = isWaveInGambitWindow(
    schedule.damageWindow,
    safeWave,
  )
    ? schedule.damageWindow?.multiplier ?? 1
    : 1;
  const permanentScoreActive =
    schedule.permanentScoreStartsAtWave !== null &&
    safeWave >= schedule.permanentScoreStartsAtWave;
  const safeHearts = finiteOr(currentHearts);
  // "Last life" applies while alive at one heart or less, including half HP.
  const onLastLife = safeHearts > 0 && safeHearts <= 1;
  const invincible = isWaveInGambitWindow(
    schedule.invincibilityWindow,
    safeWave,
  );
  return {
    scoreMultiplier:
      temporaryScore *
      (permanentScoreActive ? schedule.permanentScoreMultiplier : 1) *
      (onLastLife ? schedule.lastLifeScoreMultiplier : 1),
    damageMultiplier: invincible
      ? 0
      : temporaryDamage * schedule.permanentDamageMultiplier,
    invincible,
    onLastLife,
    // Sending happens in the intermission immediately after the rewarded
    // wave. Callers pass that completed wave, so Straight Flush never leaks
    // into later intermissions as a permanent multiplier.
    sentObstacleMultiplier:
      schedule.hand === "straight-flush" &&
      safeWave === schedule.scoreWindow?.startsAtWave
        ? schedule.sentObstacleMultiplier
        : 1,
  };
};

export interface GambitVersusCoinResult {
  readonly selfCoins: number;
  readonly opponentCoins: number;
  readonly stolenCoins: number;
  readonly doubledCoins: number;
}

/** Applies the listed 1v1 coin effects in their written order. */
export const resolveGambitVersusCoins = (
  hand: GambitHand,
  selfCoins: number,
  opponentCoins: number,
): GambitVersusCoinResult => {
  const versus = getGambitReward(hand).versus;
  let nextSelfCoins = Math.max(0, finiteOr(selfCoins));
  let nextOpponentCoins = Math.max(0, finiteOr(opponentCoins));
  const stealFraction = versus?.stealAllOpponentCoins
    ? 1
    : clamp(finiteOr(versus?.stealOpponentCoinsFraction ?? 0), 0, 1);
  const stolenCoins = nextOpponentCoins * stealFraction;
  nextOpponentCoins -= stolenCoins;
  nextSelfCoins += stolenCoins;
  const beforeDouble = nextSelfCoins;
  if (versus?.doubleCurrentCoins) nextSelfCoins *= 2;
  return {
    selfCoins: nextSelfCoins,
    opponentCoins: nextOpponentCoins,
    stolenCoins,
    doubledCoins: nextSelfCoins - beforeDouble,
  };
};

// ---------------------------------------------------------------------------
// Echo

export type CharacterCategory =
  | "runner"
  | "healer"
  | "tank"
  | "trickster"
  | "misc";
export type CharacterRarity =
  | "common"
  | "uncommon"
  | "rare"
  | "epic"
  | "legendary"
  | "mythic";

export interface PassiveCandidate {
  readonly key: string;
  readonly name: string;
  readonly category: CharacterCategory;
  readonly rarity: CharacterRarity;
}

export type EchoQuestId =
  | "dreamer-i"
  | "uplift"
  | "hope"
  | "understanding"
  | "idea"
  | "the-knowing";

export const ECHO_QUEST_ORDER: readonly EchoQuestId[] = [
  "dreamer-i",
  "uplift",
  "hope",
  "understanding",
  "idea",
  "the-knowing",
];

export interface EchoQuestProgress {
  readonly highestWaveReached: number;
  readonly totalHeartsHealed: number;
  readonly totalDamageTaken: number;
  readonly allTrickstersUnlocked: boolean;
  readonly wavesCompletedAfterUnlockingAllTricksters: number;
  /** The supplied design names Idea but does not define its objective. */
  readonly ideaCompletedByGameRule: boolean;
  readonly allCharactersUnlocked: boolean;
}

export interface EchoPassiveGrant {
  readonly category: CharacterCategory;
  readonly maximumSelections: 2;
  readonly excludedRarities: readonly CharacterRarity[];
  readonly excludedCharacterKeys: readonly string[];
}

export interface EchoQuestDefinition {
  readonly id: EchoQuestId;
  readonly label: string;
  readonly requirementLabel: string;
  readonly passiveGrant: EchoPassiveGrant | null;
  readonly ruleSource: "documented" | "external-until-defined";
}

export const ECHO_QUESTS: Readonly<Record<EchoQuestId, EchoQuestDefinition>> = {
  "dreamer-i": {
    id: "dreamer-i",
    label: "DREAMER I",
    requirementLabel: "REACH WAVE 5",
    passiveGrant: {
      category: "runner",
      maximumSelections: 2,
      excludedRarities: ["mythic"],
      excludedCharacterKeys: [],
    },
    ruleSource: "documented",
  },
  uplift: {
    id: "uplift",
    label: "UPLIFT",
    requirementLabel: "HEAL 5 HP",
    passiveGrant: {
      category: "healer",
      maximumSelections: 2,
      excludedRarities: ["legendary", "mythic"],
      excludedCharacterKeys: [],
    },
    ruleSource: "documented",
  },
  hope: {
    id: "hope",
    label: "HOPE",
    requirementLabel: "TAKE 10 DAMAGE",
    passiveGrant: {
      category: "tank",
      maximumSelections: 2,
      excludedRarities: ["mythic"],
      excludedCharacterKeys: [],
    },
    ruleSource: "documented",
  },
  understanding: {
    id: "understanding",
    label: "UNDERSTANDING",
    requirementLabel: "UNLOCK EVERY TRICKSTER · THEN COMPLETE 5 WAVES",
    passiveGrant: {
      category: "trickster",
      maximumSelections: 2,
      excludedRarities: ["mythic"],
      excludedCharacterKeys: ["runner_comet"],
    },
    ruleSource: "documented",
  },
  idea: {
    id: "idea",
    label: "IDEA",
    requirementLabel: "NO SEPARATE OBJECTIVE · CONTINUES AUTOMATICALLY",
    passiveGrant: null,
    ruleSource: "external-until-defined",
  },
  "the-knowing": {
    id: "the-knowing",
    label: "THE KNOWING",
    requirementLabel: "UNLOCK EVERY CHARACTER",
    passiveGrant: null,
    ruleSource: "documented",
  },
};

export const isEchoQuestComplete = (
  quest: EchoQuestId,
  progress: EchoQuestProgress,
) => {
  if (quest === "dreamer-i")
    return nonNegativeInteger(progress.highestWaveReached) >= 5;
  if (quest === "uplift")
    return Math.max(0, finiteOr(progress.totalHeartsHealed)) >= 5;
  if (quest === "hope")
    return Math.max(0, finiteOr(progress.totalDamageTaken)) >= 10;
  if (quest === "understanding")
    return (
      progress.allTrickstersUnlocked &&
      nonNegativeInteger(
        progress.wavesCompletedAfterUnlockingAllTricksters,
      ) >= 5
    );
  // The supplied rules list Idea in the order but provide no objective for it.
  // Treating that missing objective as a blocker made Echo impossible to finish.
  // Keep the legacy progress field in the public shape for saved-state
  // compatibility, but advance Idea automatically when it becomes current.
  if (quest === "idea") return true;
  return progress.allCharactersUnlocked;
};

export interface EchoQuestState {
  readonly completedQuests: readonly EchoQuestId[];
  readonly currentQuest: EchoQuestId | null;
  readonly mirrorShards: number;
}

export const createEchoQuestState = (): EchoQuestState => ({
  completedQuests: [],
  currentQuest: ECHO_QUEST_ORDER[0],
  mirrorShards: 0,
});

/** Completes at most one quest so each shard/reward gets its own UI moment. */
export const advanceEchoQuest = (
  state: EchoQuestState,
  progress: EchoQuestProgress,
) => {
  const quest = state.currentQuest;
  if (!quest || !isEchoQuestComplete(quest, progress))
    return { completed: null, passiveGrant: null, state } as const;
  const completedQuests = [...state.completedQuests, quest];
  const nextQuest = ECHO_QUEST_ORDER[completedQuests.length] ?? null;
  return {
    completed: quest,
    passiveGrant: ECHO_QUESTS[quest].passiveGrant,
    state: {
      completedQuests,
      currentQuest: nextQuest,
      mirrorShards: state.mirrorShards + 1,
    },
  } as const;
};

export const getEchoEligiblePassives = (
  quest: EchoQuestId,
  candidates: readonly PassiveCandidate[],
) => {
  const grant = ECHO_QUESTS[quest].passiveGrant;
  if (!grant) return [];
  return candidates.filter(
    (candidate) =>
      candidate.category === grant.category &&
      !grant.excludedRarities.includes(candidate.rarity) &&
      !grant.excludedCharacterKeys.includes(candidate.key),
  );
};

export type EchoPassiveSelectionResult =
  | { readonly ok: true; readonly selected: readonly PassiveCandidate[] }
  | {
      readonly ok: false;
      readonly reason:
        | "quest-has-no-passive-choice"
        | "must-pick-two-unique-passives"
        | "passive-not-eligible";
    };

export const validateEchoPassiveSelection = (
  quest: EchoQuestId,
  selectedKeys: readonly string[],
  candidates: readonly PassiveCandidate[],
): EchoPassiveSelectionResult => {
  const grant = ECHO_QUESTS[quest].passiveGrant;
  if (!grant) return { ok: false, reason: "quest-has-no-passive-choice" };
  if (
    selectedKeys.length !== grant.maximumSelections ||
    new Set(selectedKeys).size !== grant.maximumSelections
  )
    return { ok: false, reason: "must-pick-two-unique-passives" };
  const eligible = new Map(
    getEchoEligiblePassives(quest, candidates).map((candidate) => [
      candidate.key,
      candidate,
    ]),
  );
  const selected = selectedKeys.map((key) => eligible.get(key));
  if (selected.some((candidate) => !candidate))
    return { ok: false, reason: "passive-not-eligible" };
  return { ok: true, selected: selected as PassiveCandidate[] };
};

export const ECHO_KNOWING_HOLD_MS = 10_000;
export const ECHO_MIRROR_REALM_DURATION_MS = 10_000;
export const ECHO_KNOWING_MAX_HEARTS = 8;
export const ECHO_KNOWING_DAMAGE_MULTIPLIER = 0.2;
export const ECHO_MIRROR_HEAL_PER_HIT = 0.5;
export const ECHO_MIRROR_VERSUS_DAMAGE_PER_HIT = 0.25;

export interface EchoKnowingState {
  readonly awakened: boolean;
  readonly chargingSinceMs: number | null;
  readonly realmUntilMs: number;
  readonly startingShards: number;
}

export const createEchoKnowingState = (): EchoKnowingState => ({
  awakened: false,
  chargingSinceMs: null,
  realmUntilMs: 0,
  startingShards: 0,
});

export type EchoKnowingChargeResult =
  | {
      readonly ok: false;
      readonly reason: "quests-incomplete" | "already-awakened" | "no-shards";
      readonly state: EchoKnowingState;
    }
  | { readonly ok: true; readonly state: EchoKnowingState };

export const beginEchoKnowingCharge = (
  state: EchoKnowingState,
  questState: EchoQuestState,
  nowMs: number,
): EchoKnowingChargeResult => {
  if (questState.currentQuest)
    return { ok: false, reason: "quests-incomplete", state };
  if (state.awakened)
    return { ok: false, reason: "already-awakened", state };
  if (questState.mirrorShards <= 0)
    return { ok: false, reason: "no-shards", state };
  return {
    ok: true,
    state: {
      ...state,
      chargingSinceMs: Math.max(0, finiteOr(nowMs)),
      startingShards: Math.max(
        state.startingShards,
        nonNegativeInteger(questState.mirrorShards),
      ),
    },
  };
};

export const getEchoKnowingChargeProgress = (
  state: EchoKnowingState,
  nowMs: number,
) => {
  if (state.chargingSinceMs === null) return 0;
  return Math.min(
    1,
    Math.max(0, finiteOr(nowMs) - state.chargingSinceMs) /
      ECHO_KNOWING_HOLD_MS,
  );
};

export const cancelEchoKnowingCharge = (
  state: EchoKnowingState,
): EchoKnowingState => ({ ...state, chargingSinceMs: null });

export const completeEchoKnowingCharge = (
  state: EchoKnowingState,
  nowMs: number,
): EchoKnowingState =>
  getEchoKnowingChargeProgress(state, nowMs) < 1
    ? state
    : { ...state, awakened: true, chargingSinceMs: null };

export const activateEchoMirrorRealm = (
  state: EchoKnowingState,
  nowMs: number,
): EchoKnowingState =>
  !state.awakened || state.realmUntilMs > finiteOr(nowMs)
    ? state
    : {
        ...state,
        realmUntilMs: Math.max(0, finiteOr(nowMs)) + ECHO_MIRROR_REALM_DURATION_MS,
      };

export const getEchoKnowingBenefits = (
  state: EchoKnowingState,
  currentShards: number,
) => {
  if (!state.awakened)
    return {
      maxHearts: null,
      damageMultiplier: 1,
      scoreMultiplier: 1,
    } as const;
  const startingShards = Math.max(1, nonNegativeInteger(state.startingShards));
  const shardsLost = Math.max(
    0,
    startingShards - nonNegativeInteger(currentShards),
  );
  return {
    maxHearts: ECHO_KNOWING_MAX_HEARTS,
    damageMultiplier: ECHO_KNOWING_DAMAGE_MULTIPLIER,
    scoreMultiplier: 1 + Math.min(1.2, shardsLost * 0.3),
  } as const;
};

export const resolveEchoKnowingHit = (
  state: EchoKnowingState,
  rawDamage: number,
  nowMs: number,
  isVersus: boolean,
) => {
  const damage = Math.max(0, finiteOr(rawDamage));
  const realmActive = state.awakened && state.realmUntilMs > finiteOr(nowMs);
  return {
    selfDamage: state.awakened
      ? damage * ECHO_KNOWING_DAMAGE_MULTIPLIER
      : damage,
    healing: realmActive ? ECHO_MIRROR_HEAL_PER_HIT : 0,
    opponentDamage: isVersus
      ? realmActive
        ? ECHO_MIRROR_VERSUS_DAMAGE_PER_HIT
        : state.awakened
          ? damage * 0.5
          : 0
      : 0,
    realmActive,
  } as const;
};

export const resolveEchoKnowingDeath = (
  state: EchoKnowingState,
  mirrorShards: number,
  isVersus: boolean,
) => {
  const currentShards = nonNegativeInteger(mirrorShards);
  if (!state.awakened || currentShards <= 0)
    return {
      revived: false,
      remainingShards: currentShards,
      hearts: 0,
      reflectivePhase: false,
    } as const;
  const remainingShards = currentShards - 1;
  return {
    revived: remainingShards > 0,
    remainingShards,
    hearts: remainingShards > 0 ? ECHO_KNOWING_MAX_HEARTS : 0,
    reflectivePhase: isVersus && remainingShards === 0,
  } as const;
};

// ---------------------------------------------------------------------------
// Hex

export const HEX_VOID_DURATION_MS = 15_000;
export const HEX_CURRENT_COOLDOWN_MS = 5_000;
export const HEX_VOID_CUT_SHIELD_MS = 500;
export const HEX_CHAKRAM_COOLDOWN_MS = 10_000;
export const HEX_DAMNATION_PER_VOID_CAP = 25;
export const HEX_HADES_REQUIRED_DODGES = 20;
export const HEX_HADES_DODGE_INTERVAL_MS = 600;
export const HEX_HADES_MAX_MISSES = 3;
export const HEX_THRONE_RETREAT_MS = 3_000;
export const HEX_THRONE_INVINCIBILITY_MS = 10_000;
export const HEX_OPPONENT_VOID_INPUT_DELAY_MS = 200;

export type HexHadesRune = "A" | "S" | "D" | "F";

export interface HexHadesChallenge {
  readonly dodges: number;
  readonly misses: number;
  readonly prompt: HexHadesRune;
  readonly nextDodgeAtMs: number;
}

export const createHexHadesChallenge = (
  nowMs: number,
  prompt: HexHadesRune = "A",
): HexHadesChallenge => ({
  dodges: 0,
  misses: 0,
  prompt,
  nextDodgeAtMs: Math.max(0, finiteOr(nowMs)),
});

export const resolveHexHadesInput = (
  challenge: HexHadesChallenge,
  input: string,
  nowMs: number,
  nextPrompt: HexHadesRune,
) => {
  const now = Math.max(0, finiteOr(nowMs));
  if (challenge.dodges >= HEX_HADES_REQUIRED_DODGES)
    return { outcome: "won", challenge } as const;
  if (challenge.misses >= HEX_HADES_MAX_MISSES)
    return { outcome: "lost", challenge } as const;
  if (now < challenge.nextDodgeAtMs)
    return { outcome: "waiting", challenge } as const;
  const correct = input.toUpperCase() === challenge.prompt;
  const updated: HexHadesChallenge = {
    dodges: challenge.dodges + Number(correct),
    misses: challenge.misses + Number(!correct),
    prompt: nextPrompt,
    nextDodgeAtMs: now + HEX_HADES_DODGE_INTERVAL_MS,
  };
  return {
    outcome:
      updated.dodges >= HEX_HADES_REQUIRED_DODGES
        ? "won"
        : updated.misses >= HEX_HADES_MAX_MISSES
          ? "lost"
          : correct
            ? "dodged"
            : "missed",
    challenge: updated,
  } as const;
};

export interface HexDamnationBenefits {
  readonly damnation: number;
  readonly scoreMultiplier: number;
  readonly damageMultiplier: number;
  readonly currentUnlocked: boolean;
  readonly soulsUnlocked: boolean;
  readonly hadesUnlocked: boolean;
}

export const getHexDamnationBenefits = (
  damnation: number,
): HexDamnationBenefits => {
  const safeDamnation = nonNegativeInteger(damnation);
  return {
    damnation: safeDamnation,
    scoreMultiplier: safeDamnation >= 10 ? 1.3 : 1,
    damageMultiplier: 1 - Math.min(0.6, safeDamnation * 0.005),
    currentUnlocked: safeDamnation >= 30,
    soulsUnlocked: safeDamnation >= 60,
    hadesUnlocked: safeDamnation >= 100,
  };
};

export interface HexVoidCutState {
  readonly movesSinceCut: number;
  readonly cooldownUntilMs: number;
}

export const createHexVoidCutState = (): HexVoidCutState => ({
  movesSinceCut: 0,
  cooldownUntilMs: 0,
});

/**
 * Preserves Hex's original every-third-move Void Cut after its 30-Damnation
 * unlock, while enforcing the documented five-second cooldown.
 */
export const advanceHexVoidCut = (
  state: HexVoidCutState,
  damnation: number,
  nowMs: number,
) => {
  if (!getHexDamnationBenefits(damnation).currentUnlocked)
    return { activated: false, reason: "locked", state } as const;
  const movesSinceCut = Math.min(
    3,
    nonNegativeInteger(state.movesSinceCut) + 1,
  );
  const now = Math.max(0, finiteOr(nowMs));
  if (movesSinceCut < 3)
    return {
      activated: false,
      reason: "charging",
      state: { ...state, movesSinceCut },
    } as const;
  if (state.cooldownUntilMs > now)
    return {
      activated: false,
      reason: "cooldown",
      state: { ...state, movesSinceCut },
    } as const;
  return {
    activated: true,
    reason: "ready",
    state: {
      movesSinceCut: 0,
      cooldownUntilMs: now + HEX_CURRENT_COOLDOWN_MS,
    },
  } as const;
};

export interface HexState {
  readonly damnation: number;
  readonly voidUsedWave: number | null;
  readonly soulsRemaining: number;
  readonly godMode: boolean;
  readonly godMaxHearts: number;
  readonly throneUsedWave: number | null;
}

export const createHexState = (): HexState => ({
  damnation: 0,
  voidUsedWave: null,
  soulsRemaining: 0,
  godMode: false,
  godMaxHearts: 0,
  throneUsedWave: null,
});

export type HexVoidEntryResult =
  | {
      readonly ok: false;
      readonly reason: "odd-wave" | "already-used-this-wave";
      readonly state: HexState;
    }
  | {
      readonly ok: true;
      readonly durationMs: 15_000;
      readonly pausesWaveClock: true;
      readonly encounter: "damned" | "hades";
      readonly state: HexState;
    };

export const enterHexVoid = (
  state: HexState,
  wave: number,
): HexVoidEntryResult => {
  const safeWave = Math.max(1, nonNegativeInteger(wave));
  if (safeWave % 2 !== 0)
    return { ok: false, reason: "odd-wave", state };
  if (state.voidUsedWave === safeWave)
    return { ok: false, reason: "already-used-this-wave", state };
  return {
    ok: true,
    durationMs: HEX_VOID_DURATION_MS,
    pausesWaveClock: true,
    encounter:
      getHexDamnationBenefits(state.damnation).hadesUnlocked
        ? "hades"
        : "damned",
    state: { ...state, voidUsedWave: safeWave },
  };
};

export const collectHexDamned = (
  state: HexState,
  amount = 1,
): HexState => ({
  ...state,
  damnation: state.damnation + nonNegativeInteger(amount),
});

export const collectHexDamnedForVoid = (
  state: HexState,
  collectedThisVoid: number,
  amount = 1,
) => {
  const alreadyCollected = Math.min(
    HEX_DAMNATION_PER_VOID_CAP,
    nonNegativeInteger(collectedThisVoid),
  );
  const gained = Math.min(
    HEX_DAMNATION_PER_VOID_CAP - alreadyCollected,
    nonNegativeInteger(amount),
  );
  return {
    gained,
    collectedThisVoid: alreadyCollected + gained,
    state: collectHexDamned(state, gained),
  } as const;
};

export const getHexVoidCutEffect = () => ({
  shieldDurationMs: HEX_VOID_CUT_SHIELD_MS,
  removesObstacle: false,
} as const);

export type HexSoulResult =
  | {
      readonly ok: false;
      readonly reason: "requires-60-damnation" | "souls-still-active";
      readonly state: HexState;
    }
  | {
      readonly ok: true;
      readonly damnationSpent: 15;
      readonly state: HexState;
    };

export const summonHexSouls = (state: HexState): HexSoulResult => {
  if (state.soulsRemaining > 0)
    return { ok: false, reason: "souls-still-active", state };
  if (state.damnation < 60)
    return { ok: false, reason: "requires-60-damnation", state };
  return {
    ok: true,
    damnationSpent: 15,
    state: { ...state, damnation: state.damnation - 15, soulsRemaining: 3 },
  };
};

/** Each soul negates exactly one hit, regardless of that hit's damage. */
export const resolveHexSoulHit = (state: HexState) => {
  if (state.soulsRemaining <= 0)
    return { blocked: false, state } as const;
  return {
    blocked: true,
    state: { ...state, soulsRemaining: state.soulsRemaining - 1 },
  } as const;
};

export const becomeHexGod = (state: HexState): HexState => ({
  ...state,
  godMode: true,
  godMaxHearts: 5,
});

export const resolveHexGodDeath = (state: HexState) => {
  if (!state.godMode || state.godMaxHearts <= 1)
    return {
      revived: false,
      hearts: 0,
      state: { ...state, godMode: false, godMaxHearts: 0 },
    } as const;
  const godMaxHearts = state.godMaxHearts - 1;
  return {
    revived: true,
    hearts: godMaxHearts,
    state: { ...state, godMaxHearts },
  } as const;
};

export const activateHexThrone = (state: HexState, wave: number) => {
  const safeWave = Math.max(1, nonNegativeInteger(wave));
  if (!state.godMode)
    return { ok: false, reason: "not-a-god", state } as const;
  if (state.throneUsedWave === safeWave)
    return { ok: false, reason: "already-used-this-wave", state } as const;
  return {
    ok: true,
    retreatDurationMs: HEX_THRONE_RETREAT_MS,
    invincibilityAfterReturnMs: HEX_THRONE_INVINCIBILITY_MS,
    state: { ...state, throneUsedWave: safeWave },
  } as const;
};

export const getHexConstructedVoidDamage = (
  source: "natural" | "opponent-sent",
  normalDamage: number,
) =>
  source === "opponent-sent"
    ? Math.max(0, finiteOr(normalDamage))
    : 0.1;

export const getHexOpponentVoidEffect = () => ({
  durationMs: HEX_VOID_DURATION_MS,
  inputDelayMs: HEX_OPPONENT_VOID_INPUT_DELAY_MS,
  damageMultiplier: 2,
});

export const getHexChakramResult = (isVersus: boolean) => ({
  removeFirstObstacleInLane: true,
  sentCopiesToOpponent: isVersus ? 3 : 0,
});

export interface HexChakramCandidate<Id extends string | number = number> {
  readonly id: Id;
  readonly lane: number;
  /** Distance in front of Hex; zero is colliding and negative is behind. */
  readonly distanceAhead: number;
}

export interface HexChakramResolution<
  Candidate extends HexChakramCandidate<string | number>,
> {
  readonly target: Candidate | null;
  readonly removeFirstObstacleInLane: boolean;
  readonly sentCopiesToOpponent: number;
}

/**
 * Selects the nearest obstacle actually ahead in Hex's lane. Input order is
 * retained as the tie-breaker so two clients resolve equal distances alike.
 */
export const resolveHexChakram = <
  Candidate extends HexChakramCandidate<string | number>,
>(
  candidates: readonly Candidate[],
  playerLane: number,
  isVersus: boolean,
): HexChakramResolution<Candidate> => {
  let target: Candidate | null = null;
  for (const candidate of candidates) {
    if (
      candidate.lane !== playerLane ||
      !Number.isFinite(candidate.distanceAhead) ||
      candidate.distanceAhead < 0
    )
      continue;
    if (!target || candidate.distanceAhead < target.distanceAhead)
      target = candidate;
  }
  return {
    target,
    removeFirstObstacleInLane: target !== null,
    sentCopiesToOpponent: target && isVersus ? 3 : 0,
  };
};

// ---------------------------------------------------------------------------
// Comet / HEATFEAST

export const HEATFEAST_CONSUME_LIMIT_PER_WAVE = 100;

export interface HeatfeastState {
  /** Spent attack coins available to consume. */
  readonly stored: number;
  /** Lifetime amount consumed; this drives the permanent thresholds. */
  readonly consumed: number;
  readonly trackedWave: number | null;
  readonly consumedThisWave: number;
}

export const createHeatfeastState = (): HeatfeastState => ({
  stored: 0,
  consumed: 0,
  trackedWave: null,
  consumedThisWave: 0,
});

export const normalizeHeatfeastState = (
  state: HeatfeastState,
): HeatfeastState => {
  const trackedWave =
    state.trackedWave === null || !Number.isFinite(state.trackedWave)
      ? null
      : Math.max(1, nonNegativeInteger(state.trackedWave));
  return {
    stored: Math.max(0, finiteOr(state.stored)),
    consumed: Math.max(0, finiteOr(state.consumed)),
    trackedWave,
    consumedThisWave:
      trackedWave === null
        ? 0
        : clamp(
            Math.max(0, finiteOr(state.consumedThisWave)),
            0,
            HEATFEAST_CONSUME_LIMIT_PER_WAVE,
          ),
  };
};

/** Both players' spending goes through this shared-state transition. */
export const addHeatfeastSpending = (
  state: HeatfeastState,
  attackCoinsSpent: number,
): HeatfeastState => {
  const safeState = normalizeHeatfeastState(state);
  return {
    ...safeState,
    stored:
      safeState.stored + Math.max(0, finiteOr(attackCoinsSpent)),
  };
};

export const consumeHeatfeast = (
  state: HeatfeastState,
  wave: number,
  requested: number,
) => {
  const safeState = normalizeHeatfeastState(state);
  const safeWave = Math.max(1, nonNegativeInteger(wave));
  const consumedThisWave =
    safeState.trackedWave === safeWave
      ? safeState.consumedThisWave
      : 0;
  const remainingWaveAllowance = Math.max(
    0,
    HEATFEAST_CONSUME_LIMIT_PER_WAVE - consumedThisWave,
  );
  const amount = Math.min(
    safeState.stored,
    remainingWaveAllowance,
    Math.max(0, finiteOr(requested)),
  );
  return {
    amount,
    state: {
      stored: safeState.stored - amount,
      consumed: safeState.consumed + amount,
      trackedWave: safeWave,
      consumedThisWave: consumedThisWave + amount,
    },
  } as const;
};

export interface HeatfeastBenefits {
  readonly attackCoinMultiplier: number;
  readonly attackCoinMultiplierWithStarSpear: number;
  readonly selfDamageMultiplier: number;
  readonly opponentDamageMultiplier: number;
  readonly opponentCoinTaxFraction: number;
  readonly naturalRemovalPriceMultiplier: number;
  readonly sentObstaclePriceMultiplier: number;
  readonly splitOpponentSentObstacles: boolean;
}

export const getHeatfeastBenefits = (
  lifetimeConsumed: number,
): HeatfeastBenefits => {
  const amount = Math.max(0, finiteOr(lifetimeConsumed));
  const attackCoinMultiplier = amount >= 50 ? 1.2 : 1;
  return {
    attackCoinMultiplier,
    // Star Spear's static 50% boost multiplies the threshold boost.
    attackCoinMultiplierWithStarSpear: attackCoinMultiplier * 1.5,
    selfDamageMultiplier: amount >= 100 ? 0.75 : 1,
    opponentDamageMultiplier: amount >= 100 ? 1.25 : 1,
    opponentCoinTaxFraction: amount >= 250 ? 0.1 : 0,
    naturalRemovalPriceMultiplier: amount >= 500 ? 0.5 : 1,
    sentObstaclePriceMultiplier: amount >= 750 ? 0.5 : 1,
    splitOpponentSentObstacles: amount >= 1000,
  };
};

export type CometObstacleKind =
  | "barrel"
  | "log"
  | "snowflake"
  | "car"
  | "spikes"
  | "rock";

export const getCometNaturalRemovalPrice = (
  kind: CometObstacleKind,
  lifetimeConsumed: number,
) => {
  const basePrice =
    kind === "barrel" || kind === "log"
      ? 6
      : kind === "snowflake"
        ? 7
        : 8;
  return Math.ceil(
    basePrice * getHeatfeastBenefits(lifetimeConsumed).naturalRemovalPriceMultiplier,
  );
};

/** Comet always halves send price and doubles amount; 750 HEATFEAST halves price again. */
export const getCometSendPurchase = (
  basePrice: number,
  baseAmount: number,
  lifetimeConsumed: number,
) => {
  const cometPrice = Math.ceil(Math.max(0, finiteOr(basePrice)) / 2);
  return {
    price: Math.ceil(
      cometPrice * getHeatfeastBenefits(lifetimeConsumed).sentObstaclePriceMultiplier,
    ),
    amount: nonNegativeInteger(baseAmount) * 2,
  } as const;
};

/** Odd groups leave the extra obstacle on Comet's side; none are duplicated. */
export const splitCometIncomingObstacles = (amount: number) => {
  const total = nonNegativeInteger(amount);
  return {
    remainingForComet: Math.ceil(total / 2),
    returnedToOpponent: Math.floor(total / 2),
  } as const;
};

// ---------------------------------------------------------------------------
// Mirage

export const MIRAGE_INVASION_DURATION_MS = 5_000;
export const MIRAGE_DAMAGE_CADENCE_MS = 500;
export const MIRAGE_DAMAGE_PER_TICK = 1;
export const MIRAGE_SELF_DAMAGE_ON_EXIT = 1;

export interface MirageInvasionState {
  readonly wave: number;
  readonly startedAtMs: number;
  readonly endsAtMs: number;
  readonly mirageLane: number;
  readonly opponentLane: number;
  readonly matchingSinceMs: number | null;
  readonly nextDamageAtMs: number | null;
  readonly damageDealt: number;
  readonly finished: boolean;
  readonly exitDamageApplied: boolean;
  /** Optional for compatibility with invasions saved before monotonic timing. */
  readonly lastAdvancedAtMs?: number;
}

export type MirageStartResult =
  | {
      readonly ok: false;
      readonly reason:
        | "versus-only"
        | "already-used-this-wave"
        | "must-start-in-different-lane";
    }
  | { readonly ok: true; readonly state: MirageInvasionState };

export const startMirageInvasion = (input: {
  readonly isVersus: boolean;
  readonly wave: number;
  readonly nowMs: number;
  readonly mirageLane: number;
  readonly opponentLane: number;
  readonly lastUsedWave: number | null;
}): MirageStartResult => {
  const wave = Math.max(1, nonNegativeInteger(input.wave));
  if (!input.isVersus) return { ok: false, reason: "versus-only" };
  if (input.lastUsedWave === wave)
    return { ok: false, reason: "already-used-this-wave" };
  if (input.mirageLane === input.opponentLane)
    return { ok: false, reason: "must-start-in-different-lane" };
  const startedAtMs = Math.max(0, finiteOr(input.nowMs));
  return {
    ok: true,
    state: {
      wave,
      startedAtMs,
      endsAtMs: startedAtMs + MIRAGE_INVASION_DURATION_MS,
      mirageLane: input.mirageLane,
      opponentLane: input.opponentLane,
      matchingSinceMs: null,
      nextDamageAtMs: null,
      damageDealt: 0,
      finished: false,
      exitDamageApplied: false,
      lastAdvancedAtMs: startedAtMs,
    },
  };
};

export interface MirageStepResult {
  readonly opponentDamage: number;
  readonly selfDamage: number;
  readonly invulnerable: boolean;
  readonly state: MirageInvasionState;
}

/**
 * Advances invasion time. Damage begins only after 500 continuous milliseconds
 * in the same lane; leaving that lane resets the cadence. The final 5-second
 * boundary is counted before the one-time exit damage is applied.
 */
export const advanceMirageInvasion = (
  state: MirageInvasionState,
  input: {
    readonly nowMs: number;
    readonly mirageLane: number;
    readonly opponentLane: number;
  },
): MirageStepResult => {
  if (state.finished)
    return {
      opponentDamage: 0,
      selfDamage: 0,
      invulnerable: false,
      state,
    };

  const lastAdvancedAtMs = clamp(
    finiteOr(state.lastAdvancedAtMs ?? state.startedAtMs, state.startedAtMs),
    state.startedAtMs,
    state.endsAtMs,
  );
  const requestedNowMs = finiteOr(input.nowMs, lastAdvancedAtMs);
  // Ignore out-of-order timer/network events completely; otherwise a stale
  // lane update can reset a valid continuous same-lane damage streak.
  if (requestedNowMs < lastAdvancedAtMs)
    return {
      opponentDamage: 0,
      selfDamage: 0,
      invulnerable: lastAdvancedAtMs < state.endsAtMs,
      state,
    };

  const nowMs = clamp(
    requestedNowMs,
    state.startedAtMs,
    state.endsAtMs,
  );
  const lanesMatch = input.mirageLane === input.opponentLane;
  let matchingSinceMs = lanesMatch ? state.matchingSinceMs : null;
  let nextDamageAtMs = lanesMatch ? state.nextDamageAtMs : null;
  if (lanesMatch && matchingSinceMs === null) {
    matchingSinceMs = nowMs;
    nextDamageAtMs = nowMs + MIRAGE_DAMAGE_CADENCE_MS;
  }

  let ticks = 0;
  while (
    lanesMatch &&
    nextDamageAtMs !== null &&
    nextDamageAtMs <= nowMs
  ) {
    ticks += 1;
    nextDamageAtMs += MIRAGE_DAMAGE_CADENCE_MS;
  }

  const finished = nowMs >= state.endsAtMs;
  const selfDamage = finished && !state.exitDamageApplied
    ? MIRAGE_SELF_DAMAGE_ON_EXIT
    : 0;
  const nextState: MirageInvasionState = {
    ...state,
    mirageLane: input.mirageLane,
    opponentLane: input.opponentLane,
    matchingSinceMs,
    nextDamageAtMs,
    damageDealt: state.damageDealt + ticks * MIRAGE_DAMAGE_PER_TICK,
    finished,
    exitDamageApplied: state.exitDamageApplied || selfDamage > 0,
    lastAdvancedAtMs: nowMs,
  };
  return {
    opponentDamage: ticks * MIRAGE_DAMAGE_PER_TICK,
    selfDamage,
    invulnerable: !finished,
    state: nextState,
  };
};
