import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from "jose";
import { PIXEL_CLIENT_ID, PIXEL_ISSUER, pixelProfile, type PixelProfile } from "./pixel-pulse-rules.ts";

type Operation = "status" | "sync";
type AccountState = { state: string; localAccountId?: string; profileVersion?: number; credentialVersion?: number };
export type PixelManagementIO = {
  enabled(): boolean;
  quota(request: Request): Promise<string>;
  keys(): Promise<JSONWebKeySet>;
  take(jti: string, expiresAt: number): Promise<boolean>;
  retire(profile: PixelProfile, expiresAt: number): Promise<void>;
  status(profile: PixelProfile, expiresAt: number): Promise<unknown>;
  sync(profile: PixelProfile, expiresAt: number): Promise<unknown>;
  now?(): number;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const safeVersion = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0;
const response = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" },
});
function accountState(value: unknown): AccountState {
  if (!value || typeof value !== "object") throw new Error("Missing account result");
  const row = value as AccountState;
  if (!["linked", "link_required", "create_available", "verification_required", "conflict"].includes(row.state))
    throw new Error("Invalid account result");
  if (row.state !== "linked") return { state: row.state };
  if (typeof row.localAccountId !== "string" || !row.localAccountId || row.localAccountId.length > 160 ||
      !safeVersion(row.profileVersion) || !safeVersion(row.credentialVersion)) throw new Error("Invalid linked result");
  return { state: row.state, localAccountId: row.localAccountId, profileVersion: row.profileVersion, credentialVersion: row.credentialVersion };
}

// Central's signed status/sync backchannel. It never accepts browser cookies,
// native passwords or a management Link/Create operation as binding authority.
export async function managePixelAccount(request: Request, io: PixelManagementIO): Promise<Response> {
  if (request.method !== "POST") return response({ error: "Method not allowed." }, 405);
  if (request.headers.has("origin") || request.headers.has("cookie")) return response({ error: "Signed server request required." }, 403);
  if (!io.enabled()) return response({ error: "Account management is unavailable." }, 503);
  const bearer = request.headers.get("authorization");
  if (!bearer?.startsWith("Bearer ") || bearer.length > 16400 ||
      request.headers.get("content-type")?.split(";")[0].trim() !== "application/json")
    return response({ error: "Signed server request required." }, 401);
  let operation: Operation;
  try {
    const text = await request.text();
    if (text.length > 256) return response({ error: "Invalid request." }, 413);
    const body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1 ||
        !["status", "sync"].includes(body.operation)) return response({ error: "Unsupported account operation." }, 400);
    operation = body.operation;
  } catch { return response({ error: "Invalid request." }, 400); }
  const now = io.now ?? (() => Date.now());
  let profile: PixelProfile, jti: string, end: number;
  try {
    const quota = await io.quota(request);
    if (quota !== "allowed") return response({ error: "Account checks are temporarily unavailable." }, quota === "rate_limited" ? 429 : 503);
    const keys = await io.keys();
    const seconds = Math.floor(now() / 1000);
    const { payload } = await jwtVerify(bearer.slice(7), createLocalJWKSet(keys), {
      algorithms: ["EdDSA"], issuer: PIXEL_ISSUER, audience: PIXEL_CLIENT_ID, currentDate: new Date(now()),
    });
    if (payload.iss !== PIXEL_ISSUER || payload.aud !== PIXEL_CLIENT_ID ||
        payload.purpose !== "pixel-pulse-account-management" || payload.ticket_version !== 1 ||
        payload.operation !== operation || typeof payload.jti !== "string" || !uuid.test(payload.jti) ||
        !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp) ||
        Number(payload.iat) > seconds || Number(payload.exp) <= seconds ||
        Number(payload.exp) - Number(payload.iat) > 60 || Number(payload.exp) <= Number(payload.iat) ||
        payload.name !== payload.preferred_username) throw new Error("Invalid management ticket");
    profile = pixelProfile(payload, payload);
    jti = payload.jti; end = Number(payload.exp) * 1000;
  } catch { return response({ error: "Account request could not be verified." }, 401); }
  const live = () => { if (now() >= end) throw new Error("Management ticket expired"); };
  try {
    live();
    if (!await io.take(jti, end / 1000)) return response({ error: "Account request was already used or expired." }, 409);
    live();
    // Keep retirement committed independently: a subsequent profile conflict
    // or provider outage must not restore sessions from an older credential.
    await io.retire(profile, end / 1000);
    live();
    const result = accountState(await (operation === "status" ? io.status : io.sync)(profile, end / 1000));
    live();
    return response(result);
  } catch { return response({ error: "Account checks are temporarily unavailable." }, 503); }
}
