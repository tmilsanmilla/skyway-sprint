export const PROGRESSION_VERSION = 20261017;
export const MODE_UNLOCKS = {
  casual: { level: 5, gems: 0 },
  rotating: { level: 15, gems: 0 },
  photon: { level: 25, gems: 225 },
  ranked: { level: 35, gems: 235 },
  unlimited: { level: 45, gems: 0 },
} as const;
export type EndlessMode = "normal" | "hardcore";
export const HARDCORE_SCORE_MULTIPLIER = 2;

/** Five broad visual steps; exact XP is shown separately in the progress label. */
export const broadLevelProgress = (xp: number, required: number) => {
  if (!Number.isFinite(xp) || !Number.isFinite(required) || required <= 0) return 0;
  return Math.min(100, Math.max(0, Math.floor((xp / required) * 5) * 20));
};

const wholeNonnegative = (value: number) => Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
const cumulativeThresholds = [0];
export const cumulativeXpForLevel = (level: number) => {
  const l = wholeNonnegative(level);
  for (let n = cumulativeThresholds.length; n <= l; n += 1)
    cumulativeThresholds.push(cumulativeThresholds[n - 1] + xpRequiredForLevel(n - 1));
  return cumulativeThresholds[l];
};
/** Amount still needed to advance from the current level, not lifetime XP. */
export const xpRequiredForLevel = (level: number) => Math.floor(400 + 60 * wholeNonnegative(level) ** 1.1);
export const levelForLifetimeXp = (xp: number) => {
  const total = wholeNonnegative(xp);
  let low = 0, high = 1;
  while (cumulativeXpForLevel(high) <= total) high *= 2;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (cumulativeXpForLevel(middle) <= total) low = middle;
    else high = middle;
  }
  return low;
};
/** XP is stored as whole points; rounding happens only once per completed run. */
export const endlessScoreXp = (score: number) => Math.floor((wholeNonnegative(score) / 1_200) ** 2.1);
/** Only a physical Endless pickup grants this bonus; streak/balance grants do not. */
export const endlessGemXp = (wave?: number) => { void wave; return 10; };
export const endlessRunXp = (score: number, physicalGems: number) => endlessScoreXp(score) + 10 * wholeNonnegative(physicalGems);
export const endlessCharacter = (mode: EndlessMode, selected: string) => mode === "hardcore" ? "runner_ace" : selected;
export const isOlderProgression = (
  current: { progression_version: number; lifetime_xp: number },
  incoming: { progression_version: number; lifetime_xp: number },
) => incoming.progression_version < current.progression_version ||
  (incoming.progression_version === current.progression_version && incoming.lifetime_xp < current.lifetime_xp);

export type ModeOwnership = {
  ranked_unlocked: boolean;
  ranked_purchased: boolean;
  casual_unlocked: boolean;
  rotating_unlocked: boolean;
  unlimited_unlocked: boolean;
  photon_unlocked: boolean;
};
/** Reward replies may omit mode fields. Omission is not a revocation. Only
 * reuse this snapshot for the same account; an explicit false still applies. */
export const mergeModeOwnership = (
  previous: Partial<ModeOwnership> | null,
  incoming: Partial<ModeOwnership>,
): ModeOwnership => {
  const read = (key: keyof ModeOwnership) => typeof incoming[key] === "boolean"
    ? incoming[key] === true : previous?.[key] === true;
  return {
    ranked_unlocked: read("ranked_unlocked"),
    ranked_purchased: read("ranked_purchased"),
    casual_unlocked: read("casual_unlocked"),
    rotating_unlocked: read("rotating_unlocked"),
    unlimited_unlocked: read("unlimited_unlocked"),
    photon_unlocked: read("photon_unlocked"),
  };
};
