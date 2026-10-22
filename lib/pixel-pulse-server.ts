import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { importJWK, SignJWT, type JWK, type JSONWebKeySet } from "jose";
import * as oidc from "openid-client";
import { neonServerSql } from "@/lib/neon-server";
import {
  PIXEL_ISSUER,
  PIXEL_CLIENT_ID,
  PIXEL_COOKIE,
  PIXEL_CALLBACK_PATH,
  SKYWAY_ORIGIN,
  validatePixelMetadata,
} from "@/lib/pixel-pulse-rules";
import { verifyPixelFreshLinkProof, type PixelProofExpectation } from "@/lib/pixel-pulse-link-proof";
import { verifyPixelCredentialStatus } from "@/lib/pixel-pulse-runtime-proof";

export const pixelHash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const pixelRandom = () => randomBytes(32).toString("base64url");
export const pixelEnabled = () => process.env.PIXEL_PULSE_ENABLED === "true";
export const pixelOrigin = () =>
  process.env.NODE_ENV === "production"
    ? SKYWAY_ORIGIN
    : process.env.PIXEL_PULSE_LOCAL_ORIGIN || "http://localhost:3400";
export const pixelCallback = () => pixelOrigin() + PIXEL_CALLBACK_PATH;
export const pixelCookieOptions = (maxAge: number) => ({
  path: "/",
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge,
});
export const pixelCookieName = (name: string) =>
  process.env.NODE_ENV === "production" ? name : name.replace("__Host-", "");
let configuration: Promise<oidc.Configuration> | null = null;
export async function pixelConfiguration() {
  if (!configuration)
    configuration = oidc
      .discovery(
        new URL(PIXEL_ISSUER),
        PIXEL_CLIENT_ID,
        { token_endpoint_auth_method: "none" },
        oidc.None(),
        { timeout: 10, execute: [oidc.enableNonRepudiationChecks] },
      )
      .then((discovered) => {
        const metadata = discovered.serverMetadata();
        const algorithm = validatePixelMetadata(
          metadata as unknown as Record<string, unknown>,
        );
        const config = new oidc.Configuration(
          metadata,
          PIXEL_CLIENT_ID,
          {
            token_endpoint_auth_method: "none",
            id_token_signed_response_alg: algorithm,
          },
          oidc.None(),
        );
        config.timeout = 10;
        oidc.enableNonRepudiationChecks(config);
        return config;
      })
      .catch((error) => {
        configuration = null;
        throw error;
      });
  return configuration;
}
let signing: Promise<{
  key: Awaited<ReturnType<typeof importJWK>>;
  publicKey: JWK;
}> | null = null;
async function pixelSigningKey() {
  if (!signing)
    signing = (async () => {
      const key: JWK = JSON.parse(
        process.env.PIXEL_PULSE_GAME_SIGNING_KEY || "null",
      );
      if (!key?.d || key.kty !== "RSA" || !key.kid || !key.n || !key.e)
        throw new Error("Pixel Pulse sign-in is not configured.");
      return {
        key: await importJWK(key, "RS256"),
        publicKey: {
          kty: "RSA",
          n: key.n,
          e: key.e,
          kid: key.kid,
          alg: "RS256",
          use: "sig",
        },
      };
    })().catch((error) => {
      signing = null;
      throw error;
    });
  return signing;
}
export async function pixelPublicKeys() {
  return { keys: [(await pixelSigningKey()).publicKey] };
}
let centralKeys: { value: JSONWebKeySet; until: number } | null = null;
export async function pixelCentralKeys(): Promise<JSONWebKeySet> {
  if (!centralKeys || centralKeys.until < Date.now()) {
    const response = await fetch(`${PIXEL_ISSUER}/jwks`, {
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error("Pixel Pulse verification is temporarily unavailable.");
    const value = await response.json() as JSONWebKeySet;
    if (!Array.isArray(value.keys) || !value.keys.length || value.keys.length > 16 ||
        value.keys.some(key => key.d || !key.kid || key.kty !== "OKP" || key.crv !== "Ed25519"))
      throw new Error("Pixel Pulse verification keys are invalid.");
    centralKeys = { value, until: Date.now() + 60_000 };
  }
  return centralKeys.value;
}

export async function redeemPixelLink(ticket: string, idToken: string, expected: PixelProofExpectation) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(ticket)) throw new Error("Confirm your current Pixel Pulse password again.");
  const response = await fetch(`${PIXEL_ISSUER}/pixel-pulse/redeem-link`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticket, idToken, code: expected.code, codeVerifier: expected.verifier, flow: expected.flow }),
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error("This Pixel Pulse confirmation expired or could not be verified. Start again.");
  const body = await response.json() as { proof?: unknown };
  if (typeof body.proof !== "string") throw new Error("Pixel Pulse did not confirm this connection.");
  return verifyPixelFreshLinkProof(body.proof, expected, await pixelCentralKeys());
}
let nativeKeys: { keys: JWK[]; until: number } | null = null;
export async function pixelDatabaseKeys() {
  const nativeBase = process.env.NEON_AUTH_BASE_URL?.trim();
  if (!nativeBase || !nativeBase.startsWith("https://"))
    throw new Error("Native sign-in keys are unavailable.");
  if (!nativeKeys || nativeKeys.until < Date.now()) {
    const response = await fetch(
      `${nativeBase.replace(/\/$/, "")}/.well-known/jwks.json`,
      {
        headers: { Origin: SKYWAY_ORIGIN },
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
        cache: "no-store",
      },
    );
    if (!response.ok) throw new Error("Native sign-in keys are unavailable.");
    const result = (await response.json()) as { keys?: JWK[] };
    if (
      !Array.isArray(result.keys) ||
      !result.keys.length ||
      result.keys.some((key) => key.d || !key.kid)
    )
      throw new Error("Native sign-in keys are invalid.");
    nativeKeys = { keys: result.keys, until: Date.now() + 60_000 };
  }
  const keys = [...nativeKeys.keys, ...(await pixelPublicKeys()).keys];
  if (new Set(keys.map((key) => key.kid)).size !== keys.length)
    throw new Error("Database signing keys conflict.");
  return { keys };
}
export type PixelSession = {
  user_id: string;
  subject: string;
  username: string;
  email: string;
  email_verified: boolean;
  expires_at: string;
  created_at: string;
  token_hash: string;
  credential_version: number;
  runtime_lease_until: string;
};
export async function getPixelSession(): Promise<PixelSession | null> {
  const presented = (await cookies()).get(pixelCookieName(PIXEL_COOKIE));
  if (!presented) return null;
  const raw = presented.value;
  if (!/^[A-Za-z0-9_-]{43}$/.test(raw) || !pixelEnabled() || !neonServerSql)
    throw new Error("This Pixel Pulse session must be verified again. Sign in again.");
  const [row] =
    await neonServerSql`select app_private.pixel_session_get(${pixelHash(raw)}::text) as session`;
  const saved = (row?.session || null) as PixelSession | null;
  if (!saved) throw new Error("This Pixel Pulse session expired. Sign in again.");
  // A local cookie is not proof that the central password is still current.
  // Every renewal gets a signed, nonce-bound status using the existing game
  // key, then installs only its short lease. Errors propagate: no stale/native
  // fallback is permitted for a linked account during a provider outage.
  const requestJti = randomUUID(), nonce = pixelRandom(), now = Math.floor(Date.now() / 1000);
  const { key, publicKey } = await pixelSigningKey();
  const request = await new SignJWT({ client_id: PIXEL_CLIENT_ID, purpose: "pixel-pulse-credential-check", credential_check_version: 1, nonce })
    .setProtectedHeader({ alg: "RS256", kid: publicKey.kid, typ: "JWT" })
    .setIssuer(SKYWAY_ORIGIN).setAudience(PIXEL_ISSUER).setSubject(saved.subject)
    .setJti(requestJti).setIssuedAt(now).setExpirationTime(now + 30).sign(key);
  const response = await fetch(`${PIXEL_ISSUER}/pixel-pulse/credential-status`, {
    method: "POST", headers: { Authorization: `Bearer ${request}`, "Content-Type": "application/json" },
    body: "{}", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error("Pixel Pulse session verification is temporarily unavailable.");
  const body = await response.json() as { proof?: unknown };
  if (typeof body.proof !== "string") throw new Error("Pixel Pulse could not verify this session.");
  const status = await verifyPixelCredentialStatus(body.proof, { subject: saved.subject, nonce, requestJti }, await pixelCentralKeys());
  const [confirmed] = await neonServerSql`select app_private.pixel_session_confirm_lease(${pixelHash(raw)}::text,${saved.subject}::uuid,${status.credential_version}::bigint,${new Date(status.exp * 1000).toISOString()}::timestamptz) as session`;
  if (!confirmed?.session) throw new Error("This Pixel Pulse session expired or its credentials changed. Sign in again.");
  return confirmed.session as PixelSession;
}
export const pixelTokenExpiresAt = (session: PixelSession) => Math.min(
  Math.floor(new Date(session.expires_at).getTime() / 1000),
  Math.floor(new Date(session.runtime_lease_until).getTime() / 1000),
  Math.floor(Date.now() / 1000) + 120,
);
export async function pixelAccessToken(session: PixelSession) {
  const nativeBase = process.env.NEON_AUTH_BASE_URL?.trim();
  if (!nativeBase) throw new Error("Game sign-in is not configured.");
  const { key, publicKey } = await pixelSigningKey();
  const expires = pixelTokenExpiresAt(session);
  if (!Number.isSafeInteger(session.credential_version) || session.credential_version < 0 ||
      !/^[a-f0-9]{64}$/.test(session.token_hash) || !Number.isFinite(expires) || expires <= Math.floor(Date.now() / 1000))
    throw new Error("Pixel Pulse session must be verified again.");
  return new SignJWT({ role: "authenticated", skyway_auth: "pixel", pixel_subject: session.subject,
    pixel_credential_version: session.credential_version, pixel_session_hash: session.token_hash })
    .setProtectedHeader({ alg: "RS256", kid: publicKey.kid, typ: "JWT" })
    .setIssuer(`${SKYWAY_ORIGIN}/api/pixel-pulse`)
    .setAudience([new URL(nativeBase).origin, SKYWAY_ORIGIN])
    .setSubject(session.user_id)
    .setIssuedAt()
    .setExpirationTime(expires)
    .sign(key);
}
