export type LaneMoveDirection = -1 | 0 | 1;

export interface MobileLaneIntentInput {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  roadLeft: number;
  roadWidth: number;
  laneCount: number;
  currentLane: number;
}

const SWIPE_DISTANCE_PX = 28;
const TAP_DISTANCE_PX = 14;
const HORIZONTAL_SWIPE_RATIO = 1.25;

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

/**
 * Turns one mobile gesture into at most one adjacent lane move.
 * Horizontal swipes use their direction; taps move one step toward the lane
 * under the finger. Vertical or ambiguous drags are ignored.
 */
export const resolveMobileLaneIntent = ({
  startX,
  startY,
  endX,
  endY,
  roadLeft,
  roadWidth,
  laneCount,
  currentLane,
}: MobileLaneIntentInput): LaneMoveDirection => {
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const horizontalDistance = Math.abs(deltaX);
  const verticalDistance = Math.abs(deltaY);

  if (
    horizontalDistance >= SWIPE_DISTANCE_PX &&
    horizontalDistance > verticalDistance * HORIZONTAL_SWIPE_RATIO
  )
    return deltaX < 0 ? -1 : 1;

  if (
    horizontalDistance > TAP_DISTANCE_PX ||
    verticalDistance > TAP_DISTANCE_PX ||
    !Number.isFinite(roadWidth) ||
    roadWidth <= 0
  )
    return 0;

  const safeLaneCount = Math.max(1, Math.floor(laneCount));
  const safeCurrentLane = clamp(
    Math.floor(currentLane),
    0,
    safeLaneCount - 1,
  );
  const normalizedX = clamp((endX - roadLeft) / roadWidth, 0, 0.999999);
  const tappedLane = Math.floor(normalizedX * safeLaneCount);

  if (tappedLane === safeCurrentLane) return 0;
  return tappedLane < safeCurrentLane ? -1 : 1;
};
