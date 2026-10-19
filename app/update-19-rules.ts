import type { MapId, CharacterClassId } from "./arena-map-rules";

export type DuelMode = "casual" | "ranked" | "unlimited" | "rng" | "hardcore_duel" | "quicksand" | "mundane";
export type RotatingMode = "rng" | "hardcore_duel" | "quicksand" | "mundane";
export const MATCH_SETUP = { banSeconds: 10, announcementSeconds: 4, characterSeconds: 15 } as const;
export const ROTATING_MODE_LEVEL = 15;
export const HARDCORE_DUEL_MAPS: readonly MapId[] = ["classic", "ruins", "desert", "skyway", "pitch", "factory", "meadow"];
export const RNG_MAP_WEIGHTS = { classic: 30, pitch: 25, factory: 25, meadow: 20 } as const;
export const RNG_RARITY_WEIGHTS = { uncommon: 15, rare: 35, epic: 35, legendary: 15 } as const;
const newYorkDay = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" });
const newYorkDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
export const ROTATING_MODE_SCHEDULE = { Mon: "mundane", Tue: "hardcore_duel", Wed: "rng", Thu: "mundane", Fri: "hardcore_duel", Sat: "rng", Sun: "quicksand" } as const;
export const activeRotatingMode = (timestamp = Date.now()): RotatingMode => ROTATING_MODE_SCHEDULE[newYorkDay.format(timestamp) as keyof typeof ROTATING_MODE_SCHEDULE];
/** Find the next New York calendar boundary, including 23/25-hour DST days. */
export const nextRotationAt = (timestamp = Date.now()) => {
  const date = newYorkDate.format(timestamp);
  let low = Math.floor(timestamp), high = low + 26 * 60 * 60 * 1000;
  while (low + 1 < high) {
    const mid = Math.floor((low + high) / 2);
    if (newYorkDate.format(mid) === date) low = mid;
    else high = mid;
  }
  return high;
};
export const MUNDANE_MAP_WEIGHTS = { classic: 55, factory: 25, meadow: 10, pitch: 10 } as const;
export const QUICKSAND_RULES = { map: "classic", character: "runner_ace", baseSpeed: 4, scoreSpeedMultiplier: 1, startingHp: 4, maxHp: 4 } as const;
export const melonBaseScore = (wave: number, mode?: DuelMode) => {
  const w = Math.max(1, Math.floor(Number.isFinite(wave) ? wave : 1));
  return mode === "quicksand" ? Math.floor(627 + 99 * w ** 1.4) : Math.floor(285 + 45 * w ** 1.4);
};
export const isDuelCharacterAllowed = (mode: DuelMode, character: { key: string; rarity: string; classKey: string }) => {
  if (mode === "quicksand" || mode === "hardcore_duel") return character.key === "runner_ace";
  if (mode === "unlimited") return true;
  if (character.rarity === "mythic") return false;
  return mode !== "mundane" || (character.classKey !== "trickster" && ["default", "common", "uncommon", "rare"].includes(character.rarity));
};
export type UnlimitedRequirement = { key: string; label: string; complete: boolean; progress: string };
export const unlimitedRequirements = (catalog: readonly { key: string; rarity: string; classKey: string }[], owned: readonly string[], level: number, ranked: boolean, photon: boolean): UnlimitedRequirement[] => {
  const keys = new Set(owned), unique = new Map(catalog.filter(c => ["runner", "medic", "tank", "trickster", "misc"].includes(c.classKey)).map(c => [c.key, c]));
  const count = (rarities: readonly string[]) => [...unique.values()].filter(c => keys.has(c.key) && rarities.includes(c.rarity)).length;
  return [
    { key: "collection", label: "Own all 80 Common, Uncommon, Rare and Epic characters", count: count(["common", "uncommon", "rare", "epic"]), target: 80 },
    { key: "legendary", label: "Own at least 18 Legendary characters", count: count(["legendary"]), target: 18 },
    { key: "mythic", label: "Own at least 3 Mythic characters", count: count(["mythic"]), target: 3 },
  ].map(r => ({ key: r.key, label: r.label, complete: r.count >= r.target, progress: r.count >= r.target ? "Completed" : `${r.count}/${r.target}` })).concat([
    { key: "modes", label: "Unlock Ranked and Photon Fury", complete: ranked && photon, progress: ranked && photon ? "Completed" : "In progress" },
    { key: "level", label: "Reach level 45", complete: level >= 45, progress: level >= 45 ? "Completed" : "In progress" },
  ]);
};
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
