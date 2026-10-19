/**
 * Pure Endless gem-streak rules.
 *
 * The streak climbs normally through x5, holds x5 for five additional
 * consecutive pickups, then continues to x6, x7, x8 and beyond without a cap.
 * Damage should call `resetGemStreak`; a new run starts from the initial state.
 */

export interface GemStreakState {
  /**
   * Consecutive pickups used to find the next reward, retained across waves.
   */
  readonly consecutivePickups: number;
}

export interface GemStreakPickup {
  readonly state: GemStreakState;
  readonly multiplier: number;
  readonly gemsAwarded: number;
  readonly notice: string;
}

export const GEM_STREAK_HOLD_AT_FIVE_PICKUPS = 5;

export const INITIAL_GEM_STREAK_STATE: GemStreakState = Object.freeze({
  consecutivePickups: 0,
});

const normalizePickupCount = (pickupCount: number) =>
  Math.max(0, Math.floor(Number.isFinite(pickupCount) ? pickupCount : 0));

/** Returns the reward for a one-based consecutive-pickup count. */
export const getGemStreakMultiplier = (pickupCount: number) => {
  const count = normalizePickupCount(pickupCount);
  if (count <= 0) return 0;
  if (count <= 5) return count;
  if (count <= 5 + GEM_STREAK_HOLD_AT_FIVE_PICKUPS) return 5;
  return count - 5;
};

export const formatGemStreakNotice = (multiplier: number) => {
  const safeMultiplier = Math.max(
    1,
    Math.floor(Number.isFinite(multiplier) ? multiplier : 1),
  );
  return `GEM STREAK ×${safeMultiplier} · +${safeMultiplier} GEMS`;
};

/** Advances the chain by exactly one gem pickup. */
export const advanceGemStreak = (
  state: GemStreakState = INITIAL_GEM_STREAK_STATE,
): GemStreakPickup => {
  const consecutivePickups = normalizePickupCount(
    state.consecutivePickups + 1,
  );
  const multiplier = getGemStreakMultiplier(consecutivePickups);
  return {
    state: { consecutivePickups },
    multiplier,
    gemsAwarded: multiplier,
    notice: formatGemStreakNotice(multiplier),
  };
};

/** Breaks the chain after damage without mutating the previous state. */
export const resetGemStreak = (
  state: GemStreakState = INITIAL_GEM_STREAK_STATE,
): GemStreakState => {
  void state;
  return INITIAL_GEM_STREAK_STATE;
};
