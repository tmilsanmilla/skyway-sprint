import type { MapId, CharacterClassId } from "./arena-map-rules";

export type DuelMode = "casual" | "ranked" | "rng" | "hardcore_duel";
export type RotatingMode = "rng" | "hardcore_duel";
export const MATCH_SETUP = { banSeconds: 10, announcementSeconds: 4, characterSeconds: 15 } as const;
export const ROTATING_MODE_LEVEL = 5;
export const HARDCORE_DUEL_MAPS: readonly MapId[] = ["classic", "skyway", "pitch", "volcano", "factory", "meadow"];
export const RNG_MAP_WEIGHTS = { classic: 30, pitch: 25, factory: 25, meadow: 20 } as const;
export const RNG_RARITY_WEIGHTS = { uncommon: 15, rare: 35, epic: 35, legendary: 15 } as const;
export const activeRotatingMode = (timestamp = Date.now()): RotatingMode => Math.floor(timestamp / 86400000) % 2 === 0 ? "rng" : "hardcore_duel";
export const nextRotationAt = (timestamp = Date.now()) => (Math.floor(timestamp / 86400000) + 1) * 86400000;
export const melonBaseScore = (wave: number) => Math.floor(220 + 30 * Math.max(1, Math.floor(wave)) ** 1.4);
export const secondFinisherScore = (score: number) => Math.round(Math.max(0, score) * 1.05) + 500;
export const rankedK = (priorGamesIn28Days: number) => priorGamesIn28Days <= 22 ? 1200 / (Math.max(0, priorGamesIn28Days) + 8) : 37;
export const expectedRankedScore = (a: number, b: number) => 1 / (1 + 10 ** ((b - a) / 600));
export const bannedMapPool = (candidates: readonly MapId[], bans: readonly (MapId | null)[]) => candidates.filter(m => !bans.includes(m));
export const weightedChoice = <T extends string>(weights: Readonly<Record<T, number>>, roll: number): T => {
  if (!Number.isFinite(roll) || roll < 0 || roll >= 1) throw new Error("Invalid random roll");
  let ceiling = 0;
  for (const [key, weight] of Object.entries<number>(weights)) { ceiling += weight; if (roll * 100 < ceiling) return key as T; }
  throw new Error("Invalid weights");
};
export const rngClasses = (rollOne: number, rollTwo: number): [CharacterClassId, CharacterClassId] => {
  const classes: CharacterClassId[] = ["runner", "medic", "tank", "trickster", "misc"];
  const first = classes.splice(Math.min(4, Math.floor(Math.max(0, rollOne) * 5)), 1)[0];
  return [first, classes[Math.min(3, Math.floor(Math.max(0, rollTwo) * 4))]];
};
