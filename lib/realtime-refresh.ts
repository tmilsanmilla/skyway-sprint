export const TURN_CREDENTIAL_TTL_SECONDS = 30 * 60;
export const TURN_REFRESH_LEAD_MS = 5 * 60 * 1_000;
export const TURN_REFRESH_MIN_DELAY_MS = 5_000;
export const TURN_REFRESH_RETRY_MAX_MS = 60_000;

export const resolveTurnCredentialExpiresAtMs = (
  expiresAtSeconds: number | undefined,
  nowMs = Date.now(),
) => {
  const suppliedExpiresAtMs = Number(expiresAtSeconds) * 1_000;
  if (
    Number.isFinite(suppliedExpiresAtMs) &&
    suppliedExpiresAtMs > nowMs
  )
    return suppliedExpiresAtMs;
  return nowMs + TURN_CREDENTIAL_TTL_SECONDS * 1_000;
};

export const resolveTurnRefreshDelayMs = (
  expiresAtMs: number,
  nowMs = Date.now(),
) =>
  Math.max(
    TURN_REFRESH_MIN_DELAY_MS,
    expiresAtMs - TURN_REFRESH_LEAD_MS - nowMs,
  );

export const resolveTurnRefreshRetryDelayMs = (failureCount: number) => {
  const exponent = Math.max(0, Math.min(10, Math.floor(failureCount) - 1));
  return Math.min(
    TURN_REFRESH_RETRY_MAX_MS,
    TURN_REFRESH_MIN_DELAY_MS * 2 ** exponent,
  );
};

type PeerConfigurationTarget = Pick<
  RTCPeerConnection,
  "setConfiguration" | "signalingState"
>;

export const applyRefreshedTurnConfiguration = (
  peer: PeerConfigurationTarget | null,
  iceServers: RTCIceServer[],
) => {
  if (!peer || peer.signalingState === "closed") return false;
  peer.setConfiguration({
    iceServers,
    iceTransportPolicy: "relay",
  });
  return true;
};
