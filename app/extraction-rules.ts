export type ExtractionRarity =
  "common" | "uncommon" | "rare" | "epic" | "legendary" | "mythic";
export type PullProfile = "normal" | "bonus" | "rare" | "legendary";
export type ExtractionOption = "normal" | "rare" | "legendary";
export const EXTRACTION_MAX_QUANTITY = 99;
export const EXTRACTION_RARITIES: readonly ExtractionRarity[] = [
  "common",
  "uncommon",
  "rare",
  "epic",
  "legendary",
  "mythic",
];
export const PULL_PROFILES = {
  normal: { characterPercent: 7, weights: [42, 32, 15, 9, 2, 0] },
  bonus: { characterPercent: 13, weights: [32, 27, 17, 14, 10, 0] },
  rare: { characterPercent: 18, weights: [27, 24, 19, 16, 14, 0] },
  legendary: { characterPercent: 20, weights: [22, 21, 20, 19, 17, 1] },
} as const;
export const EXTRACTION_BOXES = {
  normal: {
    name: "NORMAL BOX",
    cost: 11,
    minLevel: 0,
    pullCount: 10,
    mix: "10 NORMAL PULLS",
    pulls: [
      "normal",
      "normal",
      "normal",
      "normal",
      "normal",
      "normal",
      "normal",
      "normal",
      "normal",
      "normal",
    ],
  },
  rare: {
    name: "RARE BOX",
    cost: 19,
    minLevel: 10,
    pullCount: 11,
    mix: "7 NORMAL · 2 RARE · 2 BONUS PULLS",
    pulls: [
      "normal",
      "normal",
      "normal",
      "normal",
      "normal",
      "normal",
      "normal",
      "rare",
      "rare",
      "bonus",
      "bonus",
    ],
  },
  legendary: {
    name: "LEGENDARY BOX",
    cost: 27,
    minLevel: 20,
    pullCount: 12,
    mix: "5 NORMAL · 3 RARE · 3 BONUS · 1 LEGENDARY PULL",
    pulls: [
      "normal",
      "normal",
      "normal",
      "normal",
      "normal",
      "rare",
      "rare",
      "rare",
      "bonus",
      "bonus",
      "bonus",
      "legendary",
    ],
  },
} as const satisfies Record<
  ExtractionOption,
  {
    name: string;
    cost: number;
    minLevel: number;
    pullCount: number;
    mix: string;
    pulls: readonly PullProfile[];
  }
>;
export const DIRECT_UNLOCK_COSTS = {
  common: { cosmetic: 24, character: 120 },
  uncommon: { cosmetic: 32, character: 160 },
  rare: { cosmetic: 48, character: 240 },
  epic: { cosmetic: 80, character: 400 },
  legendary: { cosmetic: 360, character: 1800 },
  mythic: { cosmetic: 3200, character: 16000 },
} as const;
/** Stardust purchases have no level gate; only booster boxes are level-gated. */
export const stardustUnlockLevel = (rarity: string): number | null =>
  Object.hasOwn(DIRECT_UNLOCK_COSTS, rarity) ? 0 : null;
export const duplicateStardust = (
  rarity: string,
  itemType: string,
  level: number,
) => {
  if (!["character", "player", "obstacle", "environment"].includes(itemType)) return 0;
  const payouts = { common: 10, uncommon: 12, rare: 16, epic: 24, legendary: 38, mythic: 60 };
  const base = Object.hasOwn(payouts, rarity) ? payouts[rarity as ExtractionRarity] : 0;
  return (
    base *
    (itemType === "character" ? 4 : 1) *
    (Number.isFinite(level) && level >= 40 ? 2 : Number.isFinite(level) && level >= 20 ? 1.5 : 1)
  );
};
export const directUnlockCost = (
  rarity: string,
  itemType: string,
): number | null => {
  if (!Object.prototype.hasOwnProperty.call(DIRECT_UNLOCK_COSTS, rarity))
    return null;
  if (!["character", "player", "obstacle", "environment"].includes(itemType))
    return null;
  const prices =
    DIRECT_UNLOCK_COSTS[rarity as keyof typeof DIRECT_UNLOCK_COSTS];
  return itemType === "character" ? prices.character : prices.cosmetic;
};
export const canOpenBox = (option: ExtractionOption, level: number) =>
  Number.isFinite(level) && level >= EXTRACTION_BOXES[option].minLevel;
export const affordableBoxQuantity = (
  option: ExtractionOption,
  gems: number,
) =>
  Number.isFinite(gems)
    ? Math.max(
        0,
        Math.min(
          EXTRACTION_MAX_QUANTITY,
          Math.floor(gems / EXTRACTION_BOXES[option].cost),
        ),
      )
    : 0;
/** Independent category/rarity rolls; duplicates give Stardust, never reroll. */
export const rollExtraction = (
  profile: PullProfile,
  categoryRoll: number,
  rarityRoll: number,
) => {
  if (
    ![categoryRoll, rarityRoll].every(
      (value) => Number.isFinite(value) && value >= 0 && value < 1,
    )
  )
    throw new Error("Invalid extraction roll");
  const rules = PULL_PROFILES[profile];
  let cumulative = 0;
  for (let i = 0; i < rules.weights.length; i++) {
    cumulative += rules.weights[i];
    if (rarityRoll * 100 < cumulative)
      return {
        category:
          categoryRoll * 100 < rules.characterPercent
            ? "character"
            : "cosmetic",
        rarity: EXTRACTION_RARITIES[i],
      } as const;
  }
  throw new Error("Invalid extraction profile");
};
