import "server-only";

import { neonServerSql } from "@/lib/neon-server";
import {
  preAuthNetworkBucket,
  preAuthRateLimitSecret,
  trustedRequestNetworkIdentity,
} from "@/lib/pre-auth-network";

export type PreAuthQuotaResult = "allowed" | "rate_limited" | "unavailable";

/**
 * This intentionally runs before remote identity verification. A failure to
 * identify or account for the request fails closed, so an attacker cannot turn
 * managed Neon Auth into an unmetered request amplifier.
 */
export const consumePreAuthNetworkQuota = async (
  request: Request,
): Promise<PreAuthQuotaResult> => {
  if (!neonServerSql) return "unavailable";
  const networkIdentity = trustedRequestNetworkIdentity(request);
  const secret = preAuthRateLimitSecret();
  if (!networkIdentity || !secret) return "unavailable";

  const bucket = preAuthNetworkBucket(secret, networkIdentity);
  try {
    const [row] = await neonServerSql`
      select app_private.consume_pre_auth_network_quota(
        ${bucket}::text
      ) as allowed
    `;
    if (row?.allowed === true) return "allowed";
    if (row?.allowed === false) return "rate_limited";
    return "unavailable";
  } catch {
    return "unavailable";
  }
};
