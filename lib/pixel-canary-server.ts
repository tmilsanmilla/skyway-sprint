import "server-only";
import { createHmac, randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { SKYWAY_ORIGIN } from "./pixel-pulse-rules.ts";

export const PIXEL_CANARY_COOKIE = "__Host-skyway_pixel_canary";
export const PIXEL_CANARY_SECONDS = 15 * 60;
export type PixelCanary = { nativeUserId: string; jti: string; expiresAt: number };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const purpose = "skyway-pixel-canary-gate";
const allowedNativeIds = () => {
  const ids = (process.env.PIXEL_PULSE_CANARY_NATIVE_IDS || "").split(",").map(id => id.trim().toLowerCase()).filter(Boolean);
  return ids.length > 0 && ids.length <= 64 && ids.every(id => uuid.test(id)) ? new Set(ids) : new Set<string>();
};
const signingKey = () => {
  const secret = process.env.NEON_AUTH_COOKIE_SECRET?.trim();
  if (!secret || secret.length < 32) throw new Error("Canary testing is unavailable.");
  // Domain separation from managed session-cache cookies; no new secret/key.
  return createHmac("sha256", secret).update("skyway-pixel-canary-gate:v1").digest();
};
export async function issuePixelCanary(nativeUserId: string, origin: string, now = Math.floor(Date.now() / 1000)) {
  if (!uuid.test(nativeUserId) || !allowedNativeIds().has(nativeUserId) || new URL(origin).origin !== origin)
    throw new Error("Canary testing is unavailable for this Skyway account.");
  return new SignJWT({ purpose, canary_version: 1, origin })
    .setProtectedHeader({ alg: "HS256", typ: "skyway-pixel-canary+jwt" })
    .setIssuer(SKYWAY_ORIGIN).setAudience(SKYWAY_ORIGIN).setSubject(nativeUserId)
    .setJti(randomUUID()).setIssuedAt(now).setExpirationTime(now + PIXEL_CANARY_SECONDS).sign(signingKey());
}
export async function verifyPixelCanary(raw: string | undefined, origin: string, now = Math.floor(Date.now() / 1000)): Promise<PixelCanary | null> {
  try {
    if (!raw || raw.length > 4096 || new URL(origin).origin !== origin) return null;
    const { payload, protectedHeader } = await jwtVerify(raw, signingKey(), {
      algorithms: ["HS256"], issuer: SKYWAY_ORIGIN, audience: SKYWAY_ORIGIN, currentDate: new Date(now * 1000),
    });
    if (protectedHeader.typ !== "skyway-pixel-canary+jwt" || payload.iss !== SKYWAY_ORIGIN || payload.aud !== SKYWAY_ORIGIN ||
        payload.purpose !== purpose || payload.canary_version !== 1 || payload.origin !== origin ||
        typeof payload.sub !== "string" || !uuid.test(payload.sub) || !allowedNativeIds().has(payload.sub) ||
        typeof payload.jti !== "string" || !uuid.test(payload.jti) || !Number.isSafeInteger(payload.iat) ||
        !Number.isSafeInteger(payload.exp) || Number(payload.iat) > now || Number(payload.exp) <= now ||
        Number(payload.exp) - Number(payload.iat) !== PIXEL_CANARY_SECONDS || now - Number(payload.iat) > PIXEL_CANARY_SECONDS)
      return null;
    return { nativeUserId: payload.sub, jti: payload.jti, expiresAt: Number(payload.exp) };
  } catch { return null; }
}
