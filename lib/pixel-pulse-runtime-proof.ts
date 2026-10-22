import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from "jose";
import { PIXEL_CLIENT_ID, PIXEL_ISSUER } from "./pixel-pulse-rules.ts";

export type PixelCredentialStatus = { credential_version: number; exp: number; sub: string };
export async function verifyPixelCredentialStatus(
  token: string,
  expected: { subject: string; nonce: string; requestJti: string },
  jwks: JSONWebKeySet,
  now = Math.floor(Date.now() / 1000),
): Promise<PixelCredentialStatus> {
  if (typeof token !== "string" || token.length > 16384) throw new Error("Pixel Pulse could not verify this session.");
  const { payload } = await jwtVerify(token, createLocalJWKSet(jwks), {
    issuer: PIXEL_ISSUER, audience: PIXEL_CLIENT_ID, algorithms: ["EdDSA"], currentDate: new Date(now * 1000),
  });
  if (payload.iss !== PIXEL_ISSUER || payload.aud !== PIXEL_CLIENT_ID || payload.sub !== expected.subject ||
      payload.purpose !== "pixel-pulse-credential-status" || payload.credential_check_version !== 1 ||
      payload.nonce !== expected.nonce || payload.request_jti !== expected.requestJti ||
      typeof payload.jti !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(payload.jti) ||
      !Number.isSafeInteger(payload.credential_version) || Number(payload.credential_version) < 0 ||
      !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp) || Number(payload.iat) > now ||
      now - Number(payload.iat) > 30 || Number(payload.exp) <= now || Number(payload.exp) - Number(payload.iat) > 30)
    throw new Error("Pixel Pulse could not verify this session. Sign in again.");
  return { credential_version: Number(payload.credential_version), exp: Number(payload.exp), sub: String(payload.sub) };
}
