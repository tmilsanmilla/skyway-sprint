/** Compatibility for historical test receipts. New Test Mode access is retired. */
/* eslint-disable @typescript-eslint/no-unused-vars -- legacy call signatures are intentionally retained. */
export type OneVOneMode = "casual" | "ranked" | "rng" | "hardcore_duel";
export interface AdminTestModeContext { readonly isAdmin: boolean; readonly testModeEnabled: boolean }
export const isAdminTestModeActive = (_context: AdminTestModeContext) => false;
export const isCharacterAvailable = (owned: boolean, _context: AdminTestModeContext) => owned;
export const isRankedAvailable = (unlocked: boolean, _context: AdminTestModeContext) => unlocked;
export const getEffectiveOneVOneMode = (mode: OneVOneMode, _context: AdminTestModeContext): OneVOneMode => mode;
export const getEffectiveCharacterTestMode = (_active: boolean, _test: boolean, _context: AdminTestModeContext) => false;
/** Existing test receipts remain test-only; nobody can start a new test run. */
export const latchRunTestMode = (current: boolean, _context: AdminTestModeContext) => current;
