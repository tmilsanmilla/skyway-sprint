export type ExtractionRarity = "common" | "uncommon" | "rare" | "epic" | "legendary" | "mythic";
export type PullProfile = "normal" | "bonus" | "rare" | "legendary";
export type ExtractionOption = "normal" | "rare" | "legendary";
export const EXTRACTION_MAX_QUANTITY = 100;
export const EXTRACTION_RARITIES: readonly ExtractionRarity[] = ["common", "uncommon", "rare", "epic", "legendary", "mythic"];
export const PULL_PROFILES = {
  normal: { characterPercent: 6, weights: [42, 32, 15, 9, 2, 0] },
  bonus: { characterPercent: 10, weights: [32, 27, 17, 14, 10, 0] },
  rare: { characterPercent: 17, weights: [27, 24, 19, 16, 14, 0] },
  legendary: { characterPercent: 19, weights: [22, 21, 20, 19, 17, 1] },
} as const;
export const EXTRACTION_BOXES = {
  normal: { name: "NORMAL BOX", cost: 11, minLevel: 0, pullCount: 10, mix: "10 NORMAL PULLS", pulls: ["normal", "normal", "normal", "normal", "normal", "normal", "normal", "normal", "normal", "normal"] },
  rare: { name: "RARE BOX", cost: 19, minLevel: 10, pullCount: 11, mix: "7 NORMAL · 2 RARE · 2 BONUS PULLS", pulls: ["normal", "normal", "normal", "normal", "normal", "normal", "normal", "rare", "rare", "bonus", "bonus"] },
  legendary: { name: "LEGENDARY BOX", cost: 27, minLevel: 20, pullCount: 12, mix: "5 NORMAL · 3 RARE · 3 BONUS · 1 LEGENDARY PULL", pulls: ["normal", "normal", "normal", "normal", "normal", "rare", "rare", "rare", "bonus", "bonus", "bonus", "legendary"] },
} as const satisfies Record<ExtractionOption, { name: string; cost: number; minLevel: number; pullCount: number; mix: string; pulls: readonly PullProfile[] }>;
export const DIRECT_UNLOCK_COSTS = {
  common: { cosmetic: 2, character: 10 },
  uncommon: { cosmetic: 3, character: 15 },
  rare: { cosmetic: 5, character: 25 },
} as const;
export const directUnlockCost = (rarity: string, itemType: string): number | null => {
  if (!Object.prototype.hasOwnProperty.call(DIRECT_UNLOCK_COSTS, rarity)) return null;
  if (!["character", "player", "obstacle", "environment"].includes(itemType)) return null;
  const prices = DIRECT_UNLOCK_COSTS[rarity as keyof typeof DIRECT_UNLOCK_COSTS];
  return itemType === "character" ? prices.character : prices.cosmetic;
};
export const canOpenBox = (option: ExtractionOption, level: number) => Number.isFinite(level) && level >= EXTRACTION_BOXES[option].minLevel;
export const affordableBoxQuantity = (option: ExtractionOption, gems: number) => Number.isFinite(gems)
  ? Math.max(0, Math.min(EXTRACTION_MAX_QUANTITY, Math.floor(gems / EXTRACTION_BOXES[option].cost))) : 0;
/** Independent category and rarity rolls; duplicates never reroll or refund. */
export const rollExtraction = (profile: PullProfile, categoryRoll: number, rarityRoll: number) => {
  if (![categoryRoll, rarityRoll].every(value => Number.isFinite(value) && value >= 0 && value < 1)) throw new Error("Invalid extraction roll");
  const rules = PULL_PROFILES[profile];
  let cumulative = 0;
  for (let i = 0; i < rules.weights.length; i++) {
    cumulative += rules.weights[i];
    if (rarityRoll * 100 < cumulative) return {
      category: categoryRoll * 100 < rules.characterPercent ? "character" : "cosmetic",
      rarity: EXTRACTION_RARITIES[i],
    } as const;
  }
  throw new Error("Invalid extraction profile");
};
