import { createHash } from "node:crypto";
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet, type JWTPayload } from "jose";
import { PIXEL_CLIENT_ID, PIXEL_ISSUER } from "./pixel-pulse-rules.ts";

export type PixelLinkFlow = {
  client_id: string;
  redirect_uri: string;
  response_type: "code";
  scope: "openid profile email";
  state: string;
  nonce: string;
  code_challenge: string;
  code_challenge_method: "S256";
  pixel_intent: "link";
};
export type PixelProofExpectation = {
  subject: string;
  credentialVersion: number;
  code: string;
  verifier: string;
  flow: PixelLinkFlow;
};
export type PixelFreshLinkProof = JWTPayload & {
  sub: string;
  jti: string;
  auth_time: number;
  credential_version: number;
  iat: number;
  exp: number;
};
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const flowFields = ["client_id", "redirect_uri", "response_type", "scope", "state", "nonce", "code_challenge", "code_challenge_method", "pixel_intent"] as const;
export const pixelLinkFlowDigest = (flow: PixelLinkFlow) =>
  hash(JSON.stringify(Object.fromEntries(flowFields.map((field) => [field, flow[field]]))));

// All expected fields originate in Skyway's one-use server transaction and the
// independently verified OIDC identity. Nothing from a browser approval flag,
// email lookup, management ticket or central role can authorize a first binding.
export async function verifyPixelFreshLinkProof(
  proof: string,
  expected: PixelProofExpectation,
  jwks: JSONWebKeySet,
  now = Math.floor(Date.now() / 1000),
): Promise<PixelFreshLinkProof> {
  if (typeof proof !== "string" || proof.length > 16384)
    throw new Error("Confirm your current Pixel Pulse password again.");
  const { payload } = await jwtVerify(proof, createLocalJWKSet(jwks), {
    issuer: PIXEL_ISSUER, audience: PIXEL_CLIENT_ID, algorithms: ["EdDSA"],
    currentDate: new Date(now * 1000),
  });
  const flow = expected.flow;
  if (!flow || flow.client_id !== PIXEL_CLIENT_ID || flow.pixel_intent !== "link" ||
      flow.response_type !== "code" || flow.scope !== "openid profile email" || flow.code_challenge_method !== "S256" ||
      typeof expected.verifier !== "string" || !/^[A-Za-z0-9._~-]{43,128}$/.test(expected.verifier) ||
      createHash("sha256").update(expected.verifier).digest("base64url") !== flow.code_challenge ||
      !Number.isSafeInteger(expected.credentialVersion) || expected.credentialVersion < 0 ||
      payload.iss !== PIXEL_ISSUER || payload.aud !== PIXEL_CLIENT_ID || payload.sub !== expected.subject ||
      payload.intent !== "link" || payload.purpose !== "pixel-pulse-fresh-link" || payload.link_proof_version !== 1 ||
      !Array.isArray(payload.amr) || payload.amr.length !== 1 || payload.amr[0] !== "pwd" ||
      typeof payload.jti !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(payload.jti) ||
      !Number.isSafeInteger(payload.auth_time) || !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp) ||
      Number(payload.auth_time) > now || now - Number(payload.auth_time) > 90 ||
      Number(payload.iat) > now || Number(payload.iat) < Number(payload.auth_time) ||
      Number(payload.exp) <= Number(payload.iat) || Number(payload.exp) - Number(payload.iat) > 30 ||
      Number(payload.exp) > Number(payload.auth_time) + 90 ||
      payload.credential_version !== expected.credentialVersion || payload.flow_hash !== pixelLinkFlowDigest(flow) ||
      payload.oauth_state_hash !== hash(flow.state) || payload.oauth_nonce_hash !== hash(flow.nonce) ||
      payload.pkce_challenge !== flow.code_challenge || payload.redirect_uri !== flow.redirect_uri ||
      payload.authorization_code_hash !== hash(expected.code))
    throw new Error("This Pixel Pulse confirmation does not match your account connection. Start again.");
  return payload as PixelFreshLinkProof;
}

export function assertExpectedPixelActor(
  actual: { subject: string; credentialVersion: number; profileVersion: number; emailVerified: boolean },
  expected: { subject: string; credentialVersion: number; profileVersion: number },
) {
  if (!actual.emailVerified || actual.subject !== expected.subject ||
      actual.credentialVersion !== expected.credentialVersion || actual.profileVersion !== expected.profileVersion)
    throw new Error("This Pixel Pulse account changed during linking. Start again.");
}

export function pixelCallbackValues(url: URL) {
  // Reject duplicate query keys rather than letting URLSearchParams select a
  // convenient first value while the OIDC library sees another.
  for (const key of ["state", "iss", "code"])
    if (url.searchParams.getAll(key).length !== 1)
      throw new Error("This sign-in request is incomplete or duplicated. Start again.");
  if (url.searchParams.getAll("pixel_link_ticket").length > 1 ||
      url.searchParams.get("iss") !== PIXEL_ISSUER)
    throw new Error("This sign-in request came from another website. Start again.");
  const state = url.searchParams.get("state")!, code = url.searchParams.get("code")!;
  if (!/^[A-Za-z0-9_-]{22,256}$/.test(state) || !code || code.length > 4096)
    throw new Error("This sign-in request expired. Start again.");
  return { state, code, ticket: url.searchParams.get("pixel_link_ticket") };
}

export function pixelNativeOwnership(data: unknown, now = Date.now(), maxAge = 90_000) {
  const value = data as { user?: { id?: unknown }; session?: { id?: unknown; userId?: unknown; createdAt?: unknown; expiresAt?: unknown } } | null;
  const session = value?.session, user = value?.user;
  const created = new Date(String(session?.createdAt ?? "")).getTime();
  const expires = new Date(String(session?.expiresAt ?? "")).getTime();
  if (typeof user?.id !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(user.id) ||
      typeof session?.id !== "string" || !session.id || session.id.length > 256 || session.userId !== user.id ||
      !Number.isFinite(created) || created > now || now - created > maxAge || !Number.isFinite(expires) || expires <= now)
    throw new Error("Sign into your existing Skyway account with its password again, then choose Link.");
  return { native_user_id: user.id, native_session_id: session.id };
}
