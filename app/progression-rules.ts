export const PROGRESSION_VERSION = 20261008;
export const MODE_UNLOCKS = {
  photon: { level: 15, gems: 100 },
  ranked: { level: 25, gems: 100 },
} as const;
export type EndlessMode = "normal" | "hardcore";

const wholeNonnegative = (value: number) => Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
export const cumulativeXpForLevel = (level: number) => {
  const l = wholeNonnegative(level);
  return 50 * l * l + 150 * l;
};
/** Amount still needed to advance from the current level, not lifetime XP. */
export const xpRequiredForLevel = (level: number) => 200 + 100 * wholeNonnegative(level);
export const levelForLifetimeXp = (xp: number) => {
  const total = wholeNonnegative(xp);
  let level = Math.max(0, Math.floor((Math.sqrt(22500 + 200 * total) - 150) / 100));
  while (level > 0 && cumulativeXpForLevel(level) > total) level -= 1;
  while (cumulativeXpForLevel(level + 1) <= total) level += 1;
  return level;
};
/** XP is stored as whole points; rounding happens only once per completed run. */
export const endlessScoreXp = (score: number) => Math.floor(wholeNonnegative(score) ** 2.2 / 3_000_000);
export const endlessCharacter = (mode: EndlessMode, selected: string) => mode === "hardcore" ? "runner_ace" : selected;
export const isOlderProgression = (
  current: { progression_version: number; lifetime_xp: number },
  incoming: { progression_version: number; lifetime_xp: number },
) => incoming.progression_version < current.progression_version ||
  (incoming.progression_version === current.progression_version && incoming.lifetime_xp < current.lifetime_xp);
