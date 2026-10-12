import { createRemoteJWKSet } from "jose";
import { neonServerSql } from "@/lib/neon-server";
import { consumePreAuthNetworkQuota } from "@/lib/pre-auth-rate-limit-server";
import { PIXEL_ISSUER, verifyPixelManagementTicket } from "@/lib/pixel-pulse-rules";
import { pixelEnabled, pixelHash, pixelRandom } from "@/lib/pixel-pulse-server";
import { verifyNativePixelLinkPassword } from "@/lib/pixel-pulse-native-proof";
import { handlePixelAccount, type PixelAccountReply } from "@/lib/pixel-pulse-account-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const keys = createRemoteJWKSet(new URL(PIXEL_ISSUER + "/jwks"), { timeoutDuration: 10_000 });

export async function POST(request: Request) {
  const sql = neonServerSql;
  return handlePixelAccount(request, {
    enabled: pixelEnabled() && Boolean(sql),
    quota: consumePreAuthNetworkQuota,
    verify: (token, operation) => verifyPixelManagementTicket(token, operation, keys),
    status: async p => {
      const [row] = await sql!`select app_private.pixel_account_status(${p.subject}::uuid,${p.email}::text,${p.emailVerified}::boolean) as result`;
      return row.result as PixelAccountReply;
    },
    takeTicket: async (jti, expiresAt) => {
      const [row] = await sql!`select app_private.pixel_ticket_take(${pixelHash(jti)}::text,${new Date(expiresAt * 1000).toISOString()}::timestamptz) as accepted`;
      return row?.accepted === true;
    },
    sync: async p => {
      const [row] = await sql!`select app_private.pixel_sync_identity(${p.subject}::uuid,${p.username}::text,${p.email}::text,${p.emailVerified}::boolean,${p.profileVersion}::bigint,${p.credentialVersion}::bigint) as result`;
      return row.result as PixelAccountReply;
    },
    nativeProof: (email, password) => {
      const nativeBase = process.env.NEON_AUTH_BASE_URL;
      if (!nativeBase) throw new Error("Native account proof is unavailable.");
      return verifyNativePixelLinkPassword(nativeBase, email, password);
    },
    bind: async (p, operation, nativeUser) => {
      const [row] = await sql!`select app_private.pixel_management_bind(${p.subject}::uuid,${p.username}::text,${p.email}::text,${p.emailVerified}::boolean,${p.profileVersion}::bigint,${p.credentialVersion}::bigint,${operation}::text,${nativeUser}::uuid,${pixelHash(pixelRandom())}::text) as result`;
      return row.result as PixelAccountReply;
    },
  });
}
