import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { importJWK, SignJWT, type JWK } from "jose";
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
};
export async function getPixelSession(): Promise<PixelSession | null> {
  if (!pixelEnabled() || !neonServerSql) return null;
  const raw = (await cookies()).get(pixelCookieName(PIXEL_COOKIE))?.value;
  if (!raw || !/^[A-Za-z0-9_-]{43}$/.test(raw)) return null;
  const [row] =
    await neonServerSql`select app_private.pixel_session_get(${pixelHash(raw)}::text) as session`;
  return (row?.session || null) as PixelSession | null;
}
export async function pixelAccessToken(session: PixelSession) {
  const nativeBase = process.env.NEON_AUTH_BASE_URL?.trim();
  if (!nativeBase) throw new Error("Game sign-in is not configured.");
  const { key, publicKey } = await pixelSigningKey();
  return new SignJWT({ role: "authenticated" })
    .setProtectedHeader({ alg: "RS256", kid: publicKey.kid, typ: "JWT" })
    .setIssuer(`${SKYWAY_ORIGIN}/api/pixel-pulse`)
    .setAudience([new URL(nativeBase).origin, SKYWAY_ORIGIN])
    .setSubject(session.user_id)
    .setIssuedAt()
    .setExpirationTime(
      Math.min(
        Math.floor(new Date(session.expires_at).getTime() / 1000),
        Math.floor(Date.now() / 1000) + 120,
      ),
    )
    .sign(key);
}
