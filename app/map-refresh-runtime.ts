import { WAVE_PROGRESS_LENGTH } from "./attack-delivery-rules";

/** A required pickup cannot be missed merely because the wave timer ran out. */
export const ruinsWaveProgress = (nextProgress: number, wave: number, settled: boolean) =>
  settled ? nextProgress : Math.min(nextProgress, Math.max(1, wave) * WAVE_PROGRESS_LENGTH - 1);

export const ruinsWaveGate = (
  nextProgress: number,
  wave: number,
  physicalOutcome: boolean,
  online: boolean,
  serverWave: number,
  receiptPending: boolean,
) => {
  const settled = physicalOutcome && (!online || (serverWave >= wave && !receiptPending));
  return {
    progress: ruinsWaveProgress(nextProgress, wave, settled),
    waitForReceipt: online && physicalOutcome && !settled && nextProgress >= wave * WAVE_PROGRESS_LENGTH,
  };
};

export type MapRequestContext = { userId: string | null; generation: number; matchId: string | null };
export const mapRequestIsCurrent = (
  request: MapRequestContext,
  current: MapRequestContext & { sessionUserId: string | null },
) => Boolean(request.userId && request.matchId && request.userId === current.userId &&
  request.userId === current.sessionUserId && request.generation === current.generation &&
  request.matchId === current.matchId);

/** Old polling responses cannot replace a newer local facing command. */
export const shouldApplyTerminalFacing = (currentIntent: number, responseIntent?: number) =>
  currentIntent === 0 || responseIntent === currentIntent;
