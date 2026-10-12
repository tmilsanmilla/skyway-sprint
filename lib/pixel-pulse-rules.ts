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
};
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
    !/^[a-z0-9_]{3,24}$/.test(username) ||
    username !== claims.preferred_username
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
  return {
    subject: claims.sub,
    username,
    email,
    emailVerified: info.email_verified,
  };
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
