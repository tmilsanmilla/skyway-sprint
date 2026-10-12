export const PIXEL_ISSUER = "https://pixel-pulse-websites.vercel.app/api/sso";
export const SKYWAY_ORIGIN = "https://skyway-sprint.vercel.app";
export const PIXEL_CLIENT_ID = "skyway-sprint";
export const PIXEL_CALLBACK_PATH = "/api/pixel-pulse/callback";
export const PIXEL_SESSION_SECONDS = 7 * 24 * 60 * 60;
export const PIXEL_COOKIE = "__Host-skyway_pixel_session";
export const PIXEL_ATTEMPT_COOKIE = "__Host-skyway_pixel_attempt";

export type PixelProfile = {
  subject: string;
  username: string;
  email: string;
  emailVerified: boolean;
  profileVersion: number;
  credentialVersion: number;
};
export function normalizePixelUsername(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}
export function pixelVersion(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error("Pixel Pulse returned an invalid profile version.");
  return value;
}
export function pixelProfile(
  claims: Record<string, unknown>,
  info: Record<string, unknown>,
): PixelProfile {
  if (
    typeof claims.sub !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      claims.sub,
    ) ||
    claims.sub !== info.sub
  )
    throw new Error("Pixel Pulse returned an invalid identity.");
  const username = info.preferred_username;
  if (
    typeof username !== "string" ||
    !/^[a-z0-9_ ]{3,25}$/.test(normalizePixelUsername(username)) ||
    normalizePixelUsername(username) !== normalizePixelUsername(String(claims.preferred_username || ""))
  )
    throw new Error("Choose your shared username on Pixel Pulse first.");
  const email =
    typeof info.email === "string" ? info.email.trim().toLowerCase() : "";
  if (
    !/^\S+@\S+\.\S+$/.test(email) ||
    email.length > 254 ||
    email !==
      String(claims.email || "")
        .trim()
        .toLowerCase() ||
    typeof info.email_verified !== "boolean" ||
    info.email_verified !== claims.email_verified
  )
    throw new Error("Pixel Pulse returned an invalid email.");
  for (const field of ["profile_version", "credential_version"])
    if (claims[field] !== undefined && info[field] !== undefined && claims[field] !== info[field])
      throw new Error("Pixel Pulse returned conflicting profile versions.");
  return {
    subject: claims.sub,
    username: normalizePixelUsername(username),
    email,
    emailVerified: info.email_verified,
    profileVersion: pixelVersion(info.profile_version ?? claims.profile_version ?? 0),
    credentialVersion: pixelVersion(info.credential_version ?? claims.credential_version ?? 0),
  };
}

export type PixelManagementOperation = "status" | "sync" | "link" | "create";
export async function verifyPixelManagementTicket(
  token: string,
  operation: PixelManagementOperation,
  keys: JWTVerifyGetKey,
  now = Date.now(),
) {
  if (!token || token.length > 8192) throw new Error("Invalid account ticket.");
  const { payload } = await jwtVerify(token, keys, {
    issuer: PIXEL_ISSUER,
    audience: PIXEL_CLIENT_ID,
    algorithms: ["EdDSA"],
    currentDate: new Date(now),
    clockTolerance: 5,
    maxTokenAge: 60,
    requiredClaims: ["sub", "iat", "exp", "jti"],
  });
  if (
    payload.aud !== PIXEL_CLIENT_ID ||
    payload.ticket_version !== 1 ||
    payload.purpose !== "pixel-pulse-account-management" ||
    payload.operation !== operation ||
    !Number.isInteger(payload.iat) || !Number.isInteger(payload.exp) ||
    payload.exp! <= payload.iat! || payload.exp! - payload.iat! > 60 ||
    typeof payload.jti !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(payload.jti)
  ) throw new Error("Invalid account ticket.");
  // Versions must be present on management tickets, not inferred from sign-in.
  pixelVersion(payload.profile_version); pixelVersion(payload.credential_version);
  if (typeof payload.name !== "string" || normalizePixelUsername(payload.name) !== payload.preferred_username)
    throw new Error("Invalid account ticket.");
  return { profile: pixelProfile(payload, payload), jti: payload.jti, expiresAt: payload.exp! };
}

export function validatePixelMetadata(metadata: Record<string, unknown>) {
  if (
    metadata.issuer !== PIXEL_ISSUER ||
    metadata.authorization_response_iss_parameter_supported !== true
  )
    throw new Error("Pixel Pulse sign-in configuration is invalid.");
  for (const name of [
    "authorization_endpoint",
    "token_endpoint",
    "userinfo_endpoint",
    "jwks_uri",
  ])
    if (
      typeof metadata[name] !== "string" ||
      !metadata[name].startsWith(`${PIXEL_ISSUER}/`)
    )
      throw new Error("Pixel Pulse sign-in endpoint is invalid.");
  const algorithms = metadata.id_token_signing_alg_values_supported;
  const algorithm = ["EdDSA", "ES256", "RS256"].find(
    (value) => Array.isArray(algorithms) && algorithms.includes(value),
  );
  if (!algorithm)
    throw new Error("Pixel Pulse signing algorithm is unsupported.");
  return algorithm;
}
import { jwtVerify, type JWTVerifyGetKey } from "jose";
