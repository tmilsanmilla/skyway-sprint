import { createHmac } from "node:crypto";
import { isIP } from "node:net";

type RequestNetworkOptions = {
  isProduction?: boolean;
  isVercel?: boolean;
};

type RateLimitEnvironment = {
  [key: string]: string | undefined;
  GUEST_RATE_LIMIT_SECRET?: string;
  REALTIME_TICKET_SECRET?: string;
};

const normalizeSingleIp = (value: string | null) => {
  const candidate = value?.trim().toLowerCase() ?? "";
  if (!candidate || candidate.includes(",") || isIP(candidate) === 0)
    return null;
  return candidate;
};

/**
 * Vercel overwrites x-vercel-forwarded-for with the requester's public address.
 * In deployed environments no generic forwarding header is trusted, because a
 * direct client can choose those values. Development uses one shared fallback
 * bucket only for a request that is actually addressed to localhost.
 */
export const trustedRequestNetworkIdentity = (
  request: Request,
  options: RequestNetworkOptions = {},
) => {
  const isVercel = options.isVercel ?? process.env.VERCEL === "1";
  const isProduction =
    options.isProduction ?? process.env.NODE_ENV === "production";
  if (isVercel)
    return normalizeSingleIp(request.headers.get("x-vercel-forwarded-for"));
  if (isProduction) return null;

  const hostname = new URL(request.url).hostname.toLowerCase();
  return hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]"
    ? "local-development"
    : null;
};

export const preAuthRateLimitSecret = (
  environment: RateLimitEnvironment = process.env,
) => {
  const secret =
    environment.GUEST_RATE_LIMIT_SECRET?.trim() ||
    environment.REALTIME_TICKET_SECRET?.trim() ||
    "";
  return secret.length >= 32 ? secret : null;
};

export const preAuthNetworkBucket = (secret: string, networkIdentity: string) =>
  createHmac("sha256", secret)
    .update(`skyway-pre-auth-network\0${networkIdentity}`)
    .digest("hex");
