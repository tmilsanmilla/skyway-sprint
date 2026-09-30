export const REALTIME_CONNECT_TICKET_TTL_SECONDS = 60;
export const REALTIME_CONNECT_TICKET_MAX_TTL_SECONDS = 90;
export const REALTIME_SESSION_TTL_SECONDS = 15 * 60;
export const REALTIME_TICKET_CLOCK_SKEW_SECONDS = 15;

type RealtimeTicketTimes = {
  issuedAt: number;
  connectExpiresAt: number;
  sessionExpiresAt: number;
  nowSeconds?: number;
};

export const isRealtimeTicketTimeWindowValid = ({
  issuedAt,
  connectExpiresAt,
  sessionExpiresAt,
  nowSeconds = Math.floor(Date.now() / 1_000),
}: RealtimeTicketTimes) =>
  Number.isInteger(issuedAt) &&
  Number.isInteger(connectExpiresAt) &&
  Number.isInteger(sessionExpiresAt) &&
  issuedAt <= nowSeconds + REALTIME_TICKET_CLOCK_SKEW_SECONDS &&
  connectExpiresAt > nowSeconds &&
  connectExpiresAt > issuedAt &&
  connectExpiresAt - issuedAt <= REALTIME_CONNECT_TICKET_MAX_TTL_SECONDS &&
  sessionExpiresAt >= connectExpiresAt &&
  sessionExpiresAt > nowSeconds &&
  sessionExpiresAt - issuedAt <= REALTIME_SESSION_TTL_SECONDS;
