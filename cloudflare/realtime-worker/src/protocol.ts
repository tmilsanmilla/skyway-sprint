export type WorkerSlot = 1 | 2;

export const WORKER_MAX_MESSAGE_BYTES = 64 * 1024;
export const WORKER_SIGNAL_RATE_WINDOW_MS = 10_000;
export const WORKER_SIGNAL_KIND_LIMITS = {
  ping: 10,
  leave: 1,
  offer: 4,
  answer: 4,
  ice: 96,
} as const;

export type WorkerMessageKind = keyof typeof WORKER_SIGNAL_KIND_LIMITS;

export type WorkerSignalQuotaState = {
  windowStartedAtMs: number;
  counts: Record<WorkerMessageKind, number>;
};

export const createWorkerSignalQuotaState = (): WorkerSignalQuotaState => ({
  windowStartedAtMs: 0,
  counts: { ping: 0, leave: 0, offer: 0, answer: 0, ice: 0 },
});

export const guardWorkerSignalKind = (
  state: WorkerSignalQuotaState,
  kind: WorkerMessageKind,
  nowMs: number,
) => {
  const keepWindow =
    Number.isFinite(nowMs) &&
    nowMs >= state.windowStartedAtMs &&
    nowMs - state.windowStartedAtMs < WORKER_SIGNAL_RATE_WINDOW_MS;
  const counts = keepWindow
    ? { ...state.counts }
    : createWorkerSignalQuotaState().counts;
  counts[kind] += 1;
  return {
    accepted: counts[kind] <= WORKER_SIGNAL_KIND_LIMITS[kind],
    state: {
      windowStartedAtMs: keepWindow ? state.windowStartedAtMs : nowMs,
      counts,
    },
  };
};

type SafeIceCandidate = {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
};

export type ParsedWorkerMessage = {
  quotaKind: WorkerMessageKind;
  message: Record<string, unknown>;
};

const ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const encoder = new TextEncoder();
const isShortAscii = (value: string, maxLength: number) =>
  value.length <= maxLength && /^[\x20-\x7e]*$/.test(value);

const normalizeIceCandidate = (value: unknown): SafeIceCandidate | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (
    typeof input.candidate !== "string" ||
    input.candidate.length > 8_192 ||
    !/^candidate:[\x20-\x7e]+$/.test(input.candidate) ||
    !/(?:^|\s)typ relay(?:\s|$)/i.test(input.candidate)
  )
    return null;

  const candidate: SafeIceCandidate = { candidate: input.candidate };
  if (input.sdpMid !== undefined) {
    if (
      input.sdpMid !== null &&
      (typeof input.sdpMid !== "string" || !isShortAscii(input.sdpMid, 256))
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

/** Strictly parses and copies only fields the signaling peer needs. */
export const parseWorkerClientMessage = (
  raw: string,
  slot: WorkerSlot,
): ParsedWorkerMessage | null => {
  if (encoder.encode(raw).byteLength > WORKER_MAX_MESSAGE_BYTES) return null;
  try {
    const input = JSON.parse(raw) as Record<string, unknown>;
    if (input.v !== 1 || typeof input.type !== "string") return null;
    if (input.type === "ping") {
      if (!Number.isSafeInteger(input.seq) || (input.seq as number) < 0)
        return null;
      return {
        quotaKind: "ping",
        message: { v: 1, type: "ping", seq: input.seq },
      };
    }
    if (input.type === "leave")
      return {
        quotaKind: "leave",
        message: { v: 1, type: "leave" },
      };
    if (input.type !== "signal") return null;

    const negotiationId = String(input.negotiationId ?? "");
    if (!ID_PATTERN.test(negotiationId)) return null;
    if (input.kind === "offer" || input.kind === "answer") {
      if (
        (input.kind === "offer" && slot !== 1) ||
        (input.kind === "answer" && slot !== 2) ||
        typeof input.sdp !== "string" ||
        input.sdp.length > 60_000 ||
        !input.sdp.startsWith("v=0")
      )
        return null;
      return {
        quotaKind: input.kind,
        message: {
          v: 1,
          type: "signal",
          kind: input.kind,
          negotiationId,
          sdp: input.sdp,
        },
      };
    }
    if (input.kind === "ice") {
      const candidate = normalizeIceCandidate(input.candidate);
      if (!candidate) return null;
      return {
        quotaKind: "ice",
        message: {
          v: 1,
          type: "signal",
          kind: "ice",
          negotiationId,
          candidate,
        },
      };
    }
    return null;
  } catch {
    return null;
  }
};
