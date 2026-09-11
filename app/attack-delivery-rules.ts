export const WAVE_PROGRESS_LENGTH = 2250;
export const ATTACK_RELEASE_START_FRACTION = 0.1;
export const ATTACK_RELEASE_END_FRACTION = 0.8;
export const WAVE_START_SPEED_MULTIPLIER = 2;
export const WAVE_SPEED_STEP = 0.25;
export const PURCHASED_ATTACK_SPAWN_Y = -12;
export const PURCHASED_ATTACK_ENTRY_GAP = 24;

type ActivePurchasedAttack = {
  lane: number;
  y: number;
  safeLanes: readonly number[];
};

type PurchasedAttackReleaseCheck = {
  activePurchasedAttacks: readonly ActivePurchasedAttack[];
  occupiedLanes: readonly number[];
  blockedLanes?: readonly number[];
  incomingLanes: readonly number[];
  incomingBlockedLanes?: readonly number[];
  incomingSafeLanes: readonly number[];
};

/**
 * Lets a queued attack enter once the previous one is visibly farther down
 * the track, while preserving every active attack's escape lane. Same-lane
 * occupancy is still exclusive, so mixed-speed hazards cannot phase through
 * one another.
 */
export const canReleasePurchasedAttack = ({
  activePurchasedAttacks,
  occupiedLanes,
  blockedLanes = occupiedLanes,
  incomingLanes,
  incomingBlockedLanes = incomingLanes,
  incomingSafeLanes,
}: PurchasedAttackReleaseCheck): boolean => {
  if (
    activePurchasedAttacks.some(
      (attack) =>
        attack.y < PURCHASED_ATTACK_SPAWN_Y + PURCHASED_ATTACK_ENTRY_GAP,
    )
  )
    return false;

  const occupied = new Set(occupiedLanes);
  if (incomingLanes.some((lane) => occupied.has(lane))) return false;
  const blocked = new Set(blockedLanes);
  if (
    incomingSafeLanes.length === 0 ||
    incomingSafeLanes.every((lane) => blocked.has(lane))
  )
    return false;

  const reservedEscapeLanes = new Set(
    activePurchasedAttacks.flatMap((attack) => [...attack.safeLanes]),
  );
  return !incomingBlockedLanes.some((lane) =>
    reservedEscapeLanes.has(lane),
  );
};

/** Evenly spreads incoming purchased hazards through the playable wave. */
export const getAttackReleaseProgresses = (
  count: number,
  waveStartProgress: number,
  currentWaveProgress: number = waveStartProgress,
): readonly number[] => {
  if (!Number.isFinite(count) || count <= 0) return [];
  const releaseCount = Math.floor(count);
  const safeWaveStart = Number.isFinite(waveStartProgress)
    ? waveStartProgress
    : 0;
  const waveEnd = safeWaveStart + WAVE_PROGRESS_LENGTH;
  const scheduleOrigin = Math.min(
    waveEnd,
    Math.max(
      safeWaveStart,
      Number.isFinite(currentWaveProgress)
        ? currentWaveProgress
        : safeWaveStart,
    ),
  );
  const remainingWave = waveEnd - scheduleOrigin;
  const start = remainingWave * ATTACK_RELEASE_START_FRACTION;
  const end = remainingWave * ATTACK_RELEASE_END_FRACTION;
  return Array.from({ length: releaseCount }, (_, index) => {
    const ratio = releaseCount === 1 ? 0.5 : index / (releaseCount - 1);
    return scheduleOrigin + Math.round(start + (end - start) * ratio);
  });
};

/** Wave one starts at 2x; every later wave adds another 0.25x. */
export const getWaveSpeedMultiplier = (waveNumber: number): number =>
  WAVE_START_SPEED_MULTIPLIER +
  Math.max(0, Math.floor(Number.isFinite(waveNumber) ? waveNumber : 1) - 1) *
    WAVE_SPEED_STEP;
