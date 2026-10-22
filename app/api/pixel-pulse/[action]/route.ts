import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import * as oidc from "openid-client";
import { neonAuth } from "@/lib/neon-auth-server";
import { neonServerSql } from "@/lib/neon-server";
import { verifyPixelNativePassword } from "@/lib/pixel-native-password-server";
import { PIXEL_CANARY_COOKIE, PIXEL_CANARY_SECONDS, issuePixelCanary, verifyPixelCanary } from "@/lib/pixel-canary-server";
import { consumePreAuthNetworkQuota } from "@/lib/pre-auth-rate-limit-server";
import {
  PIXEL_CLIENT_ID, PIXEL_COOKIE, PIXEL_ATTEMPT_COOKIE, PIXEL_DISCOVERY_COOKIE,
  PIXEL_SESSION_SECONDS, pixelIdentityEpoch, pixelProfile, type PixelProfile,
} from "@/lib/pixel-pulse-rules";
import {
  pixelEnabled, pixelOrigin, pixelCallback, pixelConfiguration, pixelHash,
  pixelRandom, pixelCookieName, pixelCookieOptions, pixelPublicKeys,
  pixelDatabaseKeys, getPixelSession, pixelAccessToken, pixelTokenExpiresAt,
  redeemPixelLink, type PixelSession,
} from "@/lib/pixel-pulse-server";
import {
  assertExpectedPixelActor, pixelCallbackValues, pixelNativeOwnership, type PixelLinkFlow,
} from "@/lib/pixel-pulse-link-proof";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ action: string }> };
type StoredProfile = {
  subject: string; username: string; email: string; email_verified: boolean;
  profile_version: number; credential_version: number;
};
type AttemptContext = {
  phase: "discovery" | "link";
  flow?: PixelLinkFlow;
  expected?: { subject: string; profile_version: number; credential_version: number };
  discovery_hash?: string;
  target_mode?: "link" | "create";
  native_user_id?: string;
  native_session_id?: string;
  canary_native_user_id?: string;
  canary_jti?: string;
};
const dbProfile = (profile: PixelProfile): StoredProfile => ({
  subject: profile.subject, username: profile.username, email: profile.email,
  email_verified: profile.emailVerified, profile_version: profile.profileVersion,
  credential_version: profile.credentialVersion,
});
const json = (value: unknown, status = 200) => NextResponse.json(value, {
  status, headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" },
});
const redirect = (path: string) => {
  const response = NextResponse.redirect(new URL(path, pixelOrigin()), 303);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
};
const validCookie = (raw: string | undefined) => !!raw && /^[A-Za-z0-9_-]{43}$/.test(raw);
const clearAttempt = (response: NextResponse) => response.cookies.set(pixelCookieName(PIXEL_ATTEMPT_COOKIE), "", pixelCookieOptions(0));
const clearDiscovery = (response: NextResponse) => response.cookies.set(pixelCookieName(PIXEL_DISCOVERY_COOKIE), "", pixelCookieOptions(0));
const complete = (raw: string) => {
  const response = redirect("/?pixel_connected=1");
  response.cookies.set(pixelCookieName(PIXEL_COOKIE), raw, pixelCookieOptions(PIXEL_SESSION_SECONDS));
  clearAttempt(response); clearDiscovery(response);
  return response;
};

async function route(request: Request, context: Context) {
  const { action } = await context.params;
  try {
    if (request.method === "GET" && ["jwks", "database-keys"].includes(action)) {
      return NextResponse.json(action === "jwks" ? await pixelPublicKeys() : await pixelDatabaseKeys(), {
        headers: { "Cache-Control": "public, max-age=60", "X-Content-Type-Options": "nosniff" },
      });
    }
    if (action === "status" && request.method === "GET")
      return json({ enabled: pixelEnabled() && process.env.NEXT_PUBLIC_PIXEL_PULSE_ENABLED === "true" });
    if (!["start", "confirm-start", "connection", "cancel", "callback", "session", "token", "signout", "canary"].includes(action))
      return json({ error: "Not found." }, 404);
    const mutation = ["start", "confirm-start", "cancel", "token", "signout"].includes(action) || (action === "canary" && request.method === "POST");
    if (mutation && (request.method !== "POST" || request.headers.get("origin") !== pixelOrigin()))
      return json({ error: "Continue from Skyway’s account menu." }, 403);
    if (!mutation && request.method !== "GET") return json({ error: "Method not allowed." }, 405);
    const jar = await cookies();
    if (action === "signout" || action === "cancel") {
      const session = jar.get(pixelCookieName(PIXEL_COOKIE))?.value;
      const discovery = jar.get(pixelCookieName(PIXEL_DISCOVERY_COOKIE))?.value;
      const attempt = jar.get(pixelCookieName(PIXEL_ATTEMPT_COOKIE))?.value;
      let connectionSaved = false;
      if ((action === "signout" && validCookie(session)) || validCookie(discovery) || validCookie(attempt)) {
        const quota = await consumePreAuthNetworkQuota(request);
        if (quota !== "allowed") return json({ error: "Account checks are temporarily unavailable." }, quota === "rate_limited" ? 429 : 503);
        if (!neonServerSql) return json({ error: "Account checks are temporarily unavailable." }, 503);
        if (action === "signout" && validCookie(session))
          await neonServerSql`select app_private.pixel_session_revoke(${pixelHash(session!)}::text)`;
        if (validCookie(attempt)) {
          const [result] = await neonServerSql`select app_private.pixel_attempt_cancel(${pixelHash(attempt!)}::text) as cancellation`;
          connectionSaved = result?.cancellation?.connection_saved === true;
        }
        if (validCookie(discovery))
          await neonServerSql`select app_private.pixel_discovery_take(${pixelHash(discovery!)}::text)`;
      }
      const response = json({ ok: true, connectionSaved });
      if (action === "signout") {
        response.cookies.set(pixelCookieName(PIXEL_COOKIE), "", pixelCookieOptions(0));
        response.cookies.set(pixelCookieName(PIXEL_CANARY_COOKIE), "", pixelCookieOptions(0));
      }
      clearAttempt(response); clearDiscovery(response);
      return response;
    }
    if (!pixelEnabled() || !neonServerSql)
      return action === "session" && !jar.get(pixelCookieName(PIXEL_COOKIE)) ? json({ session: null }) : json({ error: "Pixel Pulse sign-in is still being connected. Existing Skyway sign-in remains available." }, 503);
    if (action === "session" && !jar.get(pixelCookieName(PIXEL_COOKIE))) return json({ session: null });
    const quota = await consumePreAuthNetworkQuota(request);
    if (quota !== "allowed") return json({ error: quota === "rate_limited" ? "Too many sign-in attempts. Try again shortly." : "Sign-in checks are temporarily unavailable." }, quota === "rate_limited" ? 429 : 503);
    const currentCanary = () => verifyPixelCanary(jar.get(pixelCookieName(PIXEL_CANARY_COOKIE))?.value, pixelOrigin());
    const nativeCanary = async () => {
      const admitted = await currentCanary();
      if (!admitted) return null;
      const { data, error } = await neonAuth.getSession({ query: { disableCookieCache: "true" } });
      return !error && data?.user?.id === admitted.nativeUserId ? admitted : null;
    };
    if (action === "canary") {
      if (request.method === "GET") return json({ canary: Boolean(await nativeCanary()) });
      const { data, error } = await neonAuth.getSession({ query: { disableCookieCache: "true" } });
      if (error) return json({ error: "Sign in to your existing Skyway account again before canary testing." }, 403);
      try {
        const ownership = pixelNativeOwnership(data);
        const token = await issuePixelCanary(ownership.native_user_id, pixelOrigin());
        const response = json({ canary: true });
        response.cookies.set(pixelCookieName(PIXEL_CANARY_COOKIE), token, pixelCookieOptions(PIXEL_CANARY_SECONDS));
        return response;
      } catch { return json({ error: "Canary testing requires a fresh sign-in to an allowlisted Skyway account." }, 403); }
    }
    if (action === "session" || action === "token") {
      const live = await getPixelSession();
      if (!live) return action === "session" ? json({ session: null }) : json({ error: "Sign in again with Pixel Pulse." }, 401);
      const token = await pixelAccessToken(live);
      if (action === "token") return json({ token, user_id: live.user_id });
      const expiresAt = pixelTokenExpiresAt(live);
      return json({ session: {
        access_token: token, token_type: "bearer", refresh_token: "", expires_at: expiresAt,
        expires_in: Math.max(0, expiresAt - Math.floor(Date.now() / 1000)),
        user: { id: live.user_id, email: live.email, aud: "authenticated", role: "authenticated", created_at: live.created_at,
          email_confirmed_at: live.email_verified ? live.created_at : undefined,
          app_metadata: { provider: "pixel-pulse" },
          user_metadata: { pixel_pulse: true, preferred_username: live.username, displayName: live.username } },
      } });
    }
    if (action === "connection") {
      const raw = jar.get(pixelCookieName(PIXEL_DISCOVERY_COOKIE))?.value;
      if (!validCookie(raw)) return json({ discovered: false });
      const [row] = await neonServerSql`select app_private.pixel_discovery_get(${pixelHash(raw!)}::text) as profile`;
      const saved = row?.profile as StoredProfile | null;
      return saved ? json({ discovered: true, username: saved.username, email: saved.email, emailVerified: saved.email_verified }) : json({ discovered: false });
    }
    const configuration = await pixelConfiguration();
    if (action === "start" || action === "confirm-start") {
      const canary = process.env.NEXT_PUBLIC_PIXEL_PULSE_ENABLED === "true" ? null : await nativeCanary();
      if (process.env.NEXT_PUBLIC_PIXEL_PULSE_ENABLED !== "true" && !canary)
        return json({ error: "Pixel Pulse linking is still being verified. Existing Skyway sign-in remains available." }, 503);
      const text = await request.text();
      if (text.length > 1024) return json({ error: "Invalid request." }, 413);
      const body = JSON.parse(text || "{}") as Record<string, unknown>;
      if (Object.keys(body).some(key => key !== "intent" && key !== "nativePassword") ||
          ("nativePassword" in body && (action !== "confirm-start" || body.intent !== "link")))
        return json({ error: "Start from Skyway’s connection page." }, 400);
      const state = oidc.randomState(), nonce = oidc.randomNonce(), verifier = oidc.randomPKCECodeVerifier(), browser = pixelRandom();
      const challenge = await oidc.calculatePKCECodeChallenge(verifier);
      const canaryContext = canary ? { canary_native_user_id: canary.nativeUserId, canary_jti: canary.jti } : {};
      let attempt: AttemptContext = { phase: "discovery", ...canaryContext };
      let flow: PixelLinkFlow | null = null;
      let nativePasswordTarget: { userId: string; email: string } | null = null;
      if (action === "confirm-start") {
        if (body.intent !== "link" && body.intent !== "create") return json({ error: "Choose Link or Create." }, 400);
        const raw = jar.get(pixelCookieName(PIXEL_DISCOVERY_COOKIE))?.value;
        if (!validCookie(raw)) return json({ error: "Continue with Pixel Pulse first to confirm which account you are connecting." }, 401);
        const [row] = await neonServerSql`select app_private.pixel_discovery_get(${pixelHash(raw!)}::text) as profile`;
        const expected = row?.profile as StoredProfile | null;
        if (!expected?.email_verified) return json({ error: "Verify your email on Pixel Pulse before connecting a game account." }, 403);
        let native: { native_user_id: string; native_session_id: string } | undefined;
        if (body.intent === "link") {
          if (typeof body.nativePassword !== "string" || !body.nativePassword || body.nativePassword.length > 128)
            return json({ error: "Enter your current Skyway password again." }, 400);
          const { data, error } = await neonAuth.getSession({ query: { disableCookieCache: "true" } });
          if (error || !data?.user?.email) return json({ error: "Sign into your existing Skyway account with its password again." }, 401);
          native = pixelNativeOwnership(data);
          nativePasswordTarget = { userId: native.native_user_id, email: data.user.email };
        }
        flow = { client_id: PIXEL_CLIENT_ID, redirect_uri: pixelCallback(), response_type: "code", scope: "openid profile email", state, nonce,
          code_challenge: challenge, code_challenge_method: "S256", pixel_intent: "link" };
        attempt = { phase: "link", flow, expected: { subject: expected.subject, profile_version: expected.profile_version, credential_version: expected.credential_version },
          discovery_hash: pixelHash(raw!), target_mode: body.intent, ...native, ...canaryContext };
      }
      const previous = jar.get(pixelCookieName(PIXEL_ATTEMPT_COOKIE))?.value;
      await neonServerSql`select app_private.pixel_attempt_begin_v2(${pixelHash(state)}::text,${pixelHash(browser)}::text,${verifier}::text,${nonce}::text,${JSON.stringify(attempt)}::jsonb)`;
      if (attempt.phase === "link" && attempt.target_mode === "link") {
        try {
          // Seal the target/session/credential stamp BEFORE checking its actual
          // password. A fresh Google session or browser confirmation is not proof.
          if (!nativePasswordTarget || nativePasswordTarget.userId !== attempt.native_user_id)
            throw new Error("This Skyway account changed during linking. Start again.");
          const verified = await verifyPixelNativePassword(
            nativePasswordTarget, body.nativePassword as string, pixelOrigin(),
          );
          await neonServerSql`select app_private.pixel_attempt_confirm_native_password(${pixelHash(state)}::text,${pixelHash(browser)}::text,${verified.userId}::uuid)`;
        } catch (error) {
          await neonServerSql`select app_private.pixel_attempt_cancel(${pixelHash(browser)}::text)`;
          throw error;
        }
      }
      // Copy/consume any source discovery first. Retiring its old attempt may
      // remove that discovery, but must not invalidate the newly sealed flow.
      if (validCookie(previous)) await neonServerSql`select app_private.pixel_attempt_cancel(${pixelHash(previous!)}::text)`;
      const url = oidc.buildAuthorizationUrl(configuration, {
        redirect_uri: pixelCallback(), scope: "openid profile email", state, nonce,
        code_challenge: challenge, code_challenge_method: "S256", ...(flow ? { pixel_intent: "link" } : {}),
      });
      const response = json({ url: url.href });
      response.cookies.set(pixelCookieName(PIXEL_ATTEMPT_COOKIE), browser, pixelCookieOptions(300));
      // Ordinary discovery/return never forces a password. Only first binding
      // requests the provider's separately gated current-password confirmation.
      return response;
    }
    const url = new URL(request.url);
    if (url.origin !== pixelOrigin()) throw new Error("This sign-in request came from another website. Start again.");
    const { state, code, ticket } = pixelCallbackValues(url);
    const browser = jar.get(pixelCookieName(PIXEL_ATTEMPT_COOKIE))?.value;
    if (!validCookie(browser)) throw new Error("This sign-in request expired. Start again.");
    const [row] = await neonServerSql`select app_private.pixel_attempt_take_v2(${pixelHash(state)}::text,${pixelHash(browser!)}::text) as attempt`;
    const attempt = row?.attempt as { verifier: string; nonce: string; context: AttemptContext } | null;
    if (!attempt || !["discovery", "link"].includes(attempt.context.phase)) throw new Error("This sign-in attempt expired. Start again.");
    if (process.env.NEXT_PUBLIC_PIXEL_PULSE_ENABLED !== "true") {
      const canary = await currentCanary();
      if (!canary || canary.nativeUserId !== attempt.context.canary_native_user_id || canary.jti !== attempt.context.canary_jti ||
          (attempt.context.target_mode === "link" && attempt.context.native_user_id !== canary.nativeUserId))
        throw new Error("This sign-in canary expired or changed. Start again.");
    }
    const tokens = await oidc.authorizationCodeGrant(configuration, url, { pkceCodeVerifier: attempt.verifier, expectedState: state, expectedNonce: attempt.nonce, idTokenExpected: true });
    const claims = tokens.claims();
    if (!claims) throw new Error("Pixel Pulse did not return an identity.");
    const epoch = pixelIdentityEpoch(claims);
    // Separate committed request: a canonical-name/email collision or later
    // UserInfo outage must not roll back retirement of old credential epochs.
    // The helper never provisions/probes an unknown subject's email.
    await neonServerSql`select app_private.pixel_retire_credentials(${epoch.subject}::uuid,${epoch.credentialVersion}::bigint)`;
    const profile = pixelProfile(claims, await oidc.fetchUserInfo(configuration, tokens.access_token, claims.sub));
    const raw = pixelRandom();
    if (attempt.context.phase === "discovery") {
      if (ticket) throw new Error("This sign-in request has an unexpected linking confirmation. Start again.");
      const [signed] = await neonServerSql`select app_private.pixel_signin_bound(${JSON.stringify(dbProfile(profile))}::jsonb,${pixelHash(raw)}::text,${pixelHash(state)}::text,${pixelHash(browser!)}::text) as session`;
      if (signed?.session) return complete(raw);
      const discovery = pixelRandom();
      await neonServerSql`select app_private.pixel_discovery_save(${pixelHash(discovery)}::text,${JSON.stringify(dbProfile(profile))}::jsonb,${pixelHash(state)}::text,${pixelHash(browser!)}::text)`;
      const response = redirect(attempt.context.canary_native_user_id ? "/connect/pixel-pulse/test?discovered=1" : "/connect/pixel-pulse?discovered=1");
      response.cookies.set(pixelCookieName(PIXEL_DISCOVERY_COOKIE), discovery, pixelCookieOptions(300)); clearAttempt(response);
      return response;
    }
    const stored = attempt.context;
    // Public entry OR the exact signed canary was checked before code exchange.
    if (!stored.expected || !stored.flow || !ticket || !tokens.id_token)
      throw new Error("Confirm your current Pixel Pulse password again.");
    assertExpectedPixelActor(profile, { subject: stored.expected.subject, profileVersion: stored.expected.profile_version, credentialVersion: stored.expected.credential_version });
    if (stored.flow.state !== state || stored.flow.nonce !== attempt.nonce || stored.flow.redirect_uri !== pixelCallback())
      throw new Error("This sign-in request changed during linking. Start again.");
    if (stored.target_mode === "link") {
      // Native cookies intentionally remain SameSite=Strict and do not travel
      // on this cross-site callback. The fixed original ID/session came from
      // fresh same-origin ownership proof; the atomic binder rechecks its
      // locked native session and credential snapshot, not a new browser ID.
      if (!stored.native_user_id || !stored.native_session_id)
        throw new Error("This Skyway ownership proof is missing. Start again.");
    } else if (stored.target_mode !== "create") throw new Error("This sign-in request has no account choice. Start again.");
    const proof = await redeemPixelLink(ticket, tokens.id_token, { subject: profile.subject, credentialVersion: profile.credentialVersion, code, verifier: attempt.verifier, flow: stored.flow });
    const binding = { state_hash: pixelHash(state), browser_hash: pixelHash(browser!), session_hash: pixelHash(raw), profile: dbProfile(profile),
      proof_jti: proof.jti, proof_exp: proof.exp, proof_auth_time: proof.auth_time,
      expected_subject: profile.subject, expected_credential_version: profile.credentialVersion };
    const [bound] = await neonServerSql`select app_private.pixel_bind_account_v2(${JSON.stringify(binding)}::jsonb) as session`;
    if (!(bound?.session as PixelSession | null)?.user_id) throw new Error("Pixel Pulse could not save this account connection. Start again.");
    // The DB receipt is the authority for a saved connection and its game UUID.
    return complete(raw);
  } catch (error) {
    console.warn("Pixel Pulse sign-in failed", error instanceof Error ? error.name : "Error");
    const message = error instanceof Error && /^(This sign-in|Choose your shared|An existing Skyway|Use the same email|This shared username|This Pixel Pulse|This Skyway account|Your shared email|Shared usernames|Confirm your current Pixel|Sign into your existing Skyway|Verify your email)/.test(error.message)
      ? error.message : "Pixel Pulse sign-in could not complete. Your existing account and progress have not been changed. Try again.";
    if (action === "callback") { const response = redirect(`/?pixel_error=${encodeURIComponent(message)}`); clearAttempt(response); return response; }
    return json({ error: message }, 503);
  }
}
export const GET = route;
export const POST = route;
