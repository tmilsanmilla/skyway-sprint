/**
 * The current online match is tab-scoped so a refresh can resume it without
 * making every tab fight over the same 1v1 client session.
 */
export const ACTIVE_VERSUS_SESSION_STORAGE_KEY =
  "skyway-sprint:active-1v1-session:v1";

export const RESUMABLE_VERSUS_MATCH_STATUSES = [
  "countdown",
  "playing",
  "intermission",
] as const;

export const TERMINAL_VERSUS_MATCH_STATUSES = [
  "finished",
  "cancelled",
] as const;

export type ResumableVersusMatchStatus =
  (typeof RESUMABLE_VERSUS_MATCH_STATUSES)[number];
export type TerminalVersusMatchStatus =
  (typeof TERMINAL_VERSUS_MATCH_STATUSES)[number];

export interface ActiveVersusSession {
  readonly matchId: string;
  readonly status: ResumableVersusMatchStatus;
}

export interface VersusSessionSignals {
  readonly activeMatchId?: string | null;
  readonly searching?: boolean;
  readonly storedSession?: ActiveVersusSession | null;
  readonly reconnecting?: boolean;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isStringIn = <Value extends string>(
  value: unknown,
  values: readonly Value[],
): value is Value =>
  typeof value === "string" && values.some((candidate) => candidate === value);

export const isVersusMatchUuid = (value: unknown): value is string =>
  typeof value === "string" && UUID_PATTERN.test(value);

export const isResumableVersusMatchStatus = (
  value: unknown,
): value is ResumableVersusMatchStatus =>
  isStringIn(value, RESUMABLE_VERSUS_MATCH_STATUSES);

export const isTerminalVersusMatchStatus = (
  value: unknown,
): value is TerminalVersusMatchStatus =>
  isStringIn(value, TERMINAL_VERSUS_MATCH_STATUSES);

export const parseActiveVersusSession = (
  value: unknown,
): ActiveVersusSession | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (
    !isVersusMatchUuid(candidate.matchId) ||
    !isResumableVersusMatchStatus(candidate.status)
  )
    return null;
  return {
    matchId: candidate.matchId.toLowerCase(),
    status: candidate.status,
  };
};

export const parseActiveVersusSessionStorageValue = (
  rawValue: string | null,
): ActiveVersusSession | null => {
  if (rawValue === null) return null;
  try {
    return parseActiveVersusSession(JSON.parse(rawValue));
  } catch {
    return null;
  }
};

export const serializeActiveVersusSession = (value: unknown): string | null => {
  const session = parseActiveVersusSession(value);
  return session ? JSON.stringify(session) : null;
};

export const hasVersusSessionActivity = ({
  activeMatchId,
  searching = false,
  storedSession,
  reconnecting = false,
}: VersusSessionSignals): boolean =>
  Boolean(activeMatchId || searching || storedSession || reconnecting);

export const shouldNotifyServerBeforeVersusExit = (
  authenticated: boolean,
  signals: VersusSessionSignals,
): boolean => authenticated && hasVersusSessionActivity(signals);

export const shouldBlockNonVersusStart = (
  signals: Pick<VersusSessionSignals, "storedSession" | "reconnecting">,
): boolean => hasVersusSessionActivity(signals);

export const shouldAnnounceHydratedVersusWave = ({
  preserveRunState,
  previousWave,
  restoredWave,
}: {
  preserveRunState: boolean;
  previousWave: number;
  restoredWave: number;
}): boolean =>
  !preserveRunState ||
  restoredWave !== previousWave;
