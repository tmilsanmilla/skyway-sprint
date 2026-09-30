export const REALTIME_DOMAINS = [
  "match",
  "players",
  "attacks",
  "ability",
  "gambit",
] as const;

export type RealtimeDomain = (typeof REALTIME_DOMAINS)[number];

export const PEER_INVALIDATION_INTERVAL_MS = 250;
export const PEER_CONTROL_RATE_WINDOW_MS = 10_000;
export const PEER_CONTROL_RATE_LIMIT = 40;
export const PEER_CONTROL_MAX_SEQUENCE_GAP = 4_096;
export const PEER_CONTROL_VIOLATION_LIMIT = 4;
export const PEER_MOTION_RATE_WINDOW_MS = 1_000;
export const PEER_MOTION_RATE_LIMIT = 30;
export const PEER_MOTION_MAX_SEQUENCE_GAP = 4_096;
export const PEER_MOTION_MAX_LANE_INDEX = 6;
export const PEER_SIGNAL_RATE_WINDOW_MS = 10_000;
export const PEER_SIGNAL_KIND_LIMITS = {
  offer: 4,
  answer: 4,
  ice: 96,
} as const;
export const PEER_SIGNAL_VIOLATION_LIMIT = 4;
export const PEER_MAX_PENDING_ICE_CANDIDATES = 64;
export const PEER_SIGNALING_SESSION_EXPIRED_CLOSE_CODE = 4009;
export const PEER_SIGNALING_MAX_RECONNECT_ATTEMPT = 3;

const REALTIME_DOMAIN_SET = new Set<string>(REALTIME_DOMAINS);

export const normalizePeerInvalidationDomains = (
  value: unknown,
): RealtimeDomain[] => {
  if (!Array.isArray(value)) return [];
  const domains = new Set<RealtimeDomain>();
  for (const candidate of value) {
    if (
      typeof candidate === "string" &&
      REALTIME_DOMAIN_SET.has(candidate)
    )
      domains.add(candidate as RealtimeDomain);
  }
  return [...domains];
};

export const resolvePeerInvalidationDelayMs = (
  lastDeliveredAtMs: number,
  nowMs: number,
) =>
  Math.max(
    0,
    Math.max(0, lastDeliveredAtMs) + PEER_INVALIDATION_INTERVAL_MS - nowMs,
  );

type TimerHandle = ReturnType<typeof globalThis.setTimeout>;
type ScheduleTimer = (callback: () => void, delayMs: number) => TimerHandle;
type CancelTimer = (timer: TimerHandle) => void;

/**
 * Delivers at most one invalidation callback at a time. Any traffic received
 * while that callback is running is represented by one deduplicated pending
 * set, so a peer can never build an unbounded queue of authenticated reads.
 */
export class PeerInvalidationDispatcher {
  private readonly pending = new Set<RealtimeDomain>();
  private readonly deliver: (
    domains: RealtimeDomain[],
  ) => void | Promise<void>;
  private readonly now: () => number;
  private readonly schedule: ScheduleTimer;
  private readonly cancel: CancelTimer;
  private timer: TimerHandle | null = null;
  private inFlight = false;
  private closed = false;
  private lastDeliveredAtMs = 0;

  constructor(
    deliver: (domains: RealtimeDomain[]) => void | Promise<void>,
    now: () => number = Date.now,
    schedule: ScheduleTimer = (callback, delayMs) =>
      globalThis.setTimeout(callback, delayMs),
    cancel: CancelTimer = (timer) => globalThis.clearTimeout(timer),
  ) {
    this.deliver = deliver;
    this.now = now;
    this.schedule = schedule;
    this.cancel = cancel;
  }

  enqueue(domains: RealtimeDomain[]) {
    if (this.closed) return;
    for (const domain of domains) this.pending.add(domain);
    this.schedulePending();
  }

  close() {
    this.closed = true;
    if (this.timer !== null) this.cancel(this.timer);
    this.timer = null;
    this.pending.clear();
  }

  private schedulePending() {
    if (
      this.closed ||
      this.inFlight ||
      this.timer !== null ||
      this.pending.size === 0
    )
      return;
    const delay = Math.min(
      PEER_INVALIDATION_INTERVAL_MS,
      resolvePeerInvalidationDelayMs(
        this.lastDeliveredAtMs,
        this.now(),
      ),
    );
    this.timer = this.schedule(() => {
      this.timer = null;
      void this.flush();
    }, delay);
  }

  private async flush() {
    if (this.closed || this.inFlight || this.pending.size === 0) return;
    const domains = [...this.pending];
    this.pending.clear();
    this.inFlight = true;
    this.lastDeliveredAtMs = this.now();
    try {
      await this.deliver(domains);
    } catch {
      // Polling is authoritative, so a failed hint never needs a retry storm.
    } finally {
      this.inFlight = false;
      this.schedulePending();
    }
  }
}

export type PeerSequenceGuardState = {
  lastSequence: number;
};

export const createPeerSequenceGuardState = (): PeerSequenceGuardState => ({
  lastSequence: 0,
});

export const guardPeerSequence = (
  state: PeerSequenceGuardState,
  sequence: unknown,
  maxGap = PEER_CONTROL_MAX_SEQUENCE_GAP,
): { accepted: boolean; state: PeerSequenceGuardState } => {
  if (
    !Number.isSafeInteger(sequence) ||
    (sequence as number) <= state.lastSequence ||
    (sequence as number) - state.lastSequence > maxGap
  )
    return { accepted: false, state };
  return {
    accepted: true,
    state: { lastSequence: sequence as number },
  };
};

export type PeerRateGuardState = {
  windowStartedAtMs: number;
  messagesInWindow: number;
};

export const createPeerRateGuardState = (): PeerRateGuardState => ({
  windowStartedAtMs: 0,
  messagesInWindow: 0,
});

export const guardPeerRate = (
  state: PeerRateGuardState,
  nowMs: number,
  limit: number,
  windowMs: number,
): { accepted: boolean; state: PeerRateGuardState } => {
  const keepWindow =
    Number.isFinite(nowMs) &&
    nowMs >= state.windowStartedAtMs &&
    nowMs - state.windowStartedAtMs < windowMs;
  const messagesInWindow = keepWindow ? state.messagesInWindow + 1 : 1;
  const nextState = {
    windowStartedAtMs: keepWindow ? state.windowStartedAtMs : nowMs,
    messagesInWindow,
  };
  return { accepted: messagesInWindow <= limit, state: nextState };
};

export type PeerSignalKind = keyof typeof PEER_SIGNAL_KIND_LIMITS;

export type PeerSignalQuotaState = {
  windowStartedAtMs: number;
  counts: Record<PeerSignalKind, number>;
};

export const createPeerSignalQuotaState = (): PeerSignalQuotaState => ({
  windowStartedAtMs: 0,
  counts: { offer: 0, answer: 0, ice: 0 },
});

export const guardPeerSignalKind = (
  state: PeerSignalQuotaState,
  kind: PeerSignalKind,
  nowMs: number,
): { accepted: boolean; state: PeerSignalQuotaState } => {
  const keepWindow =
    Number.isFinite(nowMs) &&
    nowMs >= state.windowStartedAtMs &&
    nowMs - state.windowStartedAtMs < PEER_SIGNAL_RATE_WINDOW_MS;
  const counts = keepWindow
    ? { ...state.counts }
    : { offer: 0, answer: 0, ice: 0 };
  counts[kind] += 1;
  return {
    accepted: counts[kind] <= PEER_SIGNAL_KIND_LIMITS[kind],
    state: {
      windowStartedAtMs: keepWindow ? state.windowStartedAtMs : nowMs,
      counts,
    },
  };
};

export type SafePeerIceCandidate = {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
};

const isShortAscii = (value: string, maxLength: number) =>
  value.length <= maxLength && /^[\x20-\x7e]*$/.test(value);

/** Copies only the browser-supported ICE fields after strict type checks. */
export const sanitizePeerIceCandidate = (
  value: unknown,
): SafePeerIceCandidate | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (
    typeof input.candidate !== "string" ||
    input.candidate.length > 8_192 ||
    !/^candidate:[\x20-\x7e]+$/.test(input.candidate)
  )
    return null;
  const candidate: SafePeerIceCandidate = { candidate: input.candidate };
  if (input.sdpMid !== undefined) {
    if (
      input.sdpMid !== null &&
      (typeof input.sdpMid !== "string" ||
        !isShortAscii(input.sdpMid, 256))
    )
      return null;
    candidate.sdpMid = input.sdpMid as string | null;
  }
  if (input.sdpMLineIndex !== undefined) {
    if (
      input.sdpMLineIndex !== null &&
      (!Number.isInteger(input.sdpMLineIndex) ||
        (input.sdpMLineIndex as number) < 0 ||
        (input.sdpMLineIndex as number) > 255)
    )
      return null;
    candidate.sdpMLineIndex = input.sdpMLineIndex as number | null;
  }
  if (input.usernameFragment !== undefined) {
    if (
      input.usernameFragment !== null &&
      (typeof input.usernameFragment !== "string" ||
        !isShortAscii(input.usernameFragment, 256))
    )
      return null;
    candidate.usernameFragment = input.usernameFragment as string | null;
  }
  return candidate;
};

export const resolvePeerSignalingReconnect = ({
  closeCode,
  opened,
  peerConnected,
  attempt,
}: {
  closeCode: number;
  opened: boolean;
  peerConnected: boolean;
  attempt: number;
}): { attempt: number; delayMs: number } | null => {
  if (closeCode === PEER_SIGNALING_SESSION_EXPIRED_CLOSE_CODE)
    return { attempt: 0, delayMs: 0 };
  if (peerConnected) return null;
  const nextAttempt = opened ? 0 : attempt + 1;
  if (nextAttempt > PEER_SIGNALING_MAX_RECONNECT_ATTEMPT) return null;
  return {
    attempt: nextAttempt,
    delayMs: 1_000 * 2 ** Math.max(0, nextAttempt - 1),
  };
};

export type PeerMotionGuardState = {
  lastSequence: number;
  windowStartedAtMs: number;
  messagesInWindow: number;
};

export const createPeerMotionGuardState = (): PeerMotionGuardState => ({
  lastSequence: 0,
  windowStartedAtMs: 0,
  messagesInWindow: 0,
});

export const guardPeerMotion = (
  state: PeerMotionGuardState,
  input: { laneIndex: unknown; sequence: unknown },
  nowMs: number,
): { accepted: boolean; state: PeerMotionGuardState } => {
  const laneIndex = input.laneIndex;
  const sequence = input.sequence;
  if (
    typeof laneIndex !== "number" ||
    !Number.isInteger(laneIndex) ||
    laneIndex < 0 ||
    laneIndex > PEER_MOTION_MAX_LANE_INDEX ||
    typeof sequence !== "number" ||
    !Number.isSafeInteger(sequence) ||
    sequence <= state.lastSequence ||
    sequence - state.lastSequence > PEER_MOTION_MAX_SEQUENCE_GAP
  )
    return { accepted: false, state };

  const keepWindow =
    Number.isFinite(nowMs) &&
    nowMs >= state.windowStartedAtMs &&
    nowMs - state.windowStartedAtMs < PEER_MOTION_RATE_WINDOW_MS;
  const messagesInWindow = keepWindow ? state.messagesInWindow + 1 : 1;
  const nextState = {
    lastSequence: sequence,
    windowStartedAtMs: keepWindow ? state.windowStartedAtMs : nowMs,
    messagesInWindow,
  };
  return {
    accepted: messagesInWindow <= PEER_MOTION_RATE_LIMIT,
    state: nextState,
  };
};
