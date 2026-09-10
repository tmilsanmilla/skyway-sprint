/**
 * Pure policy helpers for the admin-only Test Mode.
 *
 * The caller supplies one generic `isAdmin` flag, so both main admins and
 * co-admins receive the same Test Mode behavior without duplicating role
 * checks throughout the UI.
 */

export type OneVOneMode = "casual" | "ranked";

export interface AdminTestModeContext {
  readonly isAdmin: boolean;
  readonly testModeEnabled: boolean;
}

export const isAdminTestModeActive = ({
  isAdmin,
  testModeEnabled,
}: AdminTestModeContext) => isAdmin && testModeEnabled;

/** Locked characters are temporarily usable only during active admin Test Mode. */
export const isCharacterAvailable = (
  isOwned: boolean,
  context: AdminTestModeContext,
) => isOwned || isAdminTestModeActive(context);

/** Ranked remains unavailable while Test Mode is active, regardless of level. */
export const isRankedAvailable = (
  rankedUnlocked: boolean,
  context: AdminTestModeContext,
) => rankedUnlocked && !isAdminTestModeActive(context);

/** A direct or stale Ranked request is safely downgraded to Casual in Test Mode. */
export const getEffectiveOneVOneMode = (
  requestedMode: OneVOneMode,
  context: AdminTestModeContext,
): OneVOneMode =>
  isAdminTestModeActive(context) ? "casual" : requestedMode;

/**
 * Character access follows the server-backed run snapshot while a run is
 * active. The saved preference is used only before/after play.
 */
export const getEffectiveCharacterTestMode = (
  runActive: boolean,
  runIsTestMode: boolean,
  context: AdminTestModeContext,
) =>
  isAdminTestModeActive({
    isAdmin: context.isAdmin,
    testModeEnabled: runActive ? runIsTestMode : context.testModeEnabled,
  });

/**
 * Test status is sticky for a run. Turning the saved preference off affects
 * the next run, but can never make an already-unranked run ranked again.
 */
export const latchRunTestMode = (
  currentRunIsTest: boolean,
  context: AdminTestModeContext,
) => currentRunIsTest || isAdminTestModeActive(context);
