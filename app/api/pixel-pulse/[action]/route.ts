import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import * as oidc from "openid-client";
import { neonAuth } from "@/lib/neon-auth-server";
import { neonServerSql } from "@/lib/neon-server";
import { consumePreAuthNetworkQuota } from "@/lib/pre-auth-rate-limit-server";
import {
  PIXEL_ISSUER,
  PIXEL_COOKIE,
  PIXEL_ATTEMPT_COOKIE,
  PIXEL_SESSION_SECONDS,
  pixelProfile,
} from "@/lib/pixel-pulse-rules";
import {
  pixelEnabled,
  pixelOrigin,
  pixelCallback,
  pixelConfiguration,
  pixelHash,
  pixelRandom,
  pixelCookieName,
  pixelCookieOptions,
  pixelPublicKeys,
  pixelDatabaseKeys,
  getPixelSession,
  pixelAccessToken,
} from "@/lib/pixel-pulse-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ action: string }> };
const json = (value: unknown, status = 200) =>
  NextResponse.json(value, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
async function route(request: Request, context: Context) {
  const { action } = await context.params;
  try {
    if (
      request.method === "GET" &&
      ["jwks", "database-keys"].includes(action)
    ) {
      const result =
        action === "jwks" ? await pixelPublicKeys() : await pixelDatabaseKeys();
      return NextResponse.json(result, {
        headers: {
          "Cache-Control": "public, max-age=60",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    if (action === "status" && request.method === "GET")
      return json({ enabled: pixelEnabled() && process.env.NEXT_PUBLIC_PIXEL_PULSE_ENABLED === "true" });
    if (!["start", "callback", "session", "token", "signout"].includes(action))
      return json({ error: "Not found." }, 404);
    if (
      ["start", "token", "signout"].includes(action) &&
      (request.method !== "POST" ||
        request.headers.get("origin") !== pixelOrigin())
    )
      return json({ error: "Continue from Skyway’s account menu." }, 403);
    if (["callback", "session"].includes(action) && request.method !== "GET")
      return json({ error: "Method not allowed." }, 405);
    if (action === "session") {
      const raw = (await cookies()).get(pixelCookieName(PIXEL_COOKIE))?.value;
      if (!raw || !/^[A-Za-z0-9_-]{43}$/.test(raw)) return json({ session: null });
      const quota = await consumePreAuthNetworkQuota(request);
      if (quota !== "allowed") return json({ error: "Session checks are temporarily unavailable. Try again shortly." }, quota === "rate_limited" ? 429 : 503);
      const live = await getPixelSession();
      if (!live) return json({ session: null });
      const token = await pixelAccessToken(live);
      const expiresAt = Math.floor(new Date(live.expires_at).getTime() / 1000);
      return json({
        session: {
          access_token: token,
          token_type: "bearer",
          refresh_token: "",
          expires_at: expiresAt,
          expires_in: expiresAt - Math.floor(Date.now() / 1000),
          user: {
            id: live.user_id,
            email: live.email,
            aud: "authenticated",
            role: "authenticated",
            created_at: live.created_at,
            email_confirmed_at: live.email_verified
              ? live.created_at
              : undefined,
            app_metadata: { provider: "pixel-pulse" },
            user_metadata: {
              pixel_pulse: true,
              preferred_username: live.username,
              displayName: live.username,
            },
          },
        },
      });
    }
    if (action === "signout") {
      const jar = await cookies(),
        raw = jar.get(pixelCookieName(PIXEL_COOKIE))?.value;
      if (raw && /^[A-Za-z0-9_-]{43}$/.test(raw) && neonServerSql) {
        const quota = await consumePreAuthNetworkQuota(request);
        if (quota !== "allowed") return json({ error: "Sign-out checks are temporarily unavailable. Try again shortly." }, quota === "rate_limited" ? 429 : 503);
        await neonServerSql`select app_private.pixel_session_revoke(${pixelHash(raw)}::text)`;
      }
      const response = json({ ok: true });
      response.cookies.set(
        pixelCookieName(PIXEL_COOKIE),
        "",
        pixelCookieOptions(0),
      );
      response.cookies.set(
        pixelCookieName(PIXEL_ATTEMPT_COOKIE),
        "",
        pixelCookieOptions(0),
      );
      return response;
    }
    if (!pixelEnabled() || !neonServerSql)
      return json(
        {
          error:
            "Pixel Pulse sign-in is still being connected. Existing Skyway sign-in remains available.",
        },
        503,
      );
    if (action === "token") {
      const quota = await consumePreAuthNetworkQuota(request);
      if (quota !== "allowed") return json({ error: "Session checks are temporarily unavailable. Try again shortly." }, quota === "rate_limited" ? 429 : 503);
      const live = await getPixelSession();
      return live
        ? json({ token: await pixelAccessToken(live), user_id: live.user_id })
        : json({ error: "Sign in again with Pixel Pulse." }, 401);
    }
    const quota = await consumePreAuthNetworkQuota(request);
    if (quota !== "allowed")
      return json(
        {
          error:
            quota === "rate_limited"
              ? "Too many sign-in attempts. Try again shortly."
              : "Sign-in checks are temporarily unavailable.",
        },
        quota === "rate_limited" ? 429 : 503,
      );
    const configuration = await pixelConfiguration();
    if (action === "start") {
      if (process.env.NEXT_PUBLIC_PIXEL_PULSE_ENABLED !== "true") return json({ error: "Pixel Pulse linking is still being verified. Existing Skyway sign-in remains available." }, 503);
      const text = await request.text();
      if (text.length > 2048) return json({ error: "Invalid request." }, 413);
      const body = JSON.parse(text || "{}");
      const intent =
        body.intent === "link"
          ? "link"
          : body.intent === "create"
            ? "create"
            : "sign-in";
      let linkUser: string | null = null;
      if (intent === "link") {
        // Proof comes only from a verified native session, never an email, client UUID or central role.
        const { data, error } = await neonAuth.getSession();
        if (error || !data?.user?.id)
          return json(
            {
              error:
                "Sign into your existing Skyway account first, then choose Link Pixel Pulse.",
            },
            401,
          );
        linkUser = data.user.id;
      }
      const state = oidc.randomState(),
        nonce = oidc.randomNonce(),
        verifier = oidc.randomPKCECodeVerifier(),
        browser = pixelRandom();
      await neonServerSql`select app_private.pixel_attempt_begin(${pixelHash(state)}::text,${pixelHash(browser)}::text,${verifier}::text,${nonce}::text,${intent}::text,${linkUser}::uuid)`;
      const url = oidc.buildAuthorizationUrl(configuration, {
        redirect_uri: pixelCallback(),
        scope: "openid profile email",
        state,
        nonce,
        code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
        code_challenge_method: "S256",
      });
      // No prompt=login: the provider reuses and verifies its existing managed cookie.
      const response = json({ url: url.href });
      response.cookies.set(
        pixelCookieName(PIXEL_ATTEMPT_COOKIE),
        browser,
        pixelCookieOptions(300),
      );
      return response;
    }
    const url = new URL(request.url),
      state = url.searchParams.get("state");
    const browser = (await cookies()).get(
      pixelCookieName(PIXEL_ATTEMPT_COOKIE),
    )?.value;
    if (
      url.origin !== pixelOrigin() ||
      !state ||
      state.length > 256 ||
      !browser ||
      !/^[A-Za-z0-9_-]{43}$/.test(browser) ||
      url.searchParams.get("iss") !== PIXEL_ISSUER
    )
      throw new Error(
        "This sign-in request expired or came from another website. Start again.",
      );
    const [row] =
      await neonServerSql`select app_private.pixel_attempt_take(${pixelHash(state)}::text,${pixelHash(browser)}::text) as attempt`;
    const attempt = row?.attempt as
      | {
          verifier: string;
          nonce: string;
          link_user_id: string | null;
          intent: string;
        }
      | undefined;
    if (!attempt)
      throw new Error("This sign-in attempt has expired. Start again.");
    const tokens = await oidc.authorizationCodeGrant(configuration, url, {
      pkceCodeVerifier: attempt.verifier,
      expectedState: state,
      expectedNonce: attempt.nonce,
      idTokenExpected: true,
    });
    const claims = tokens.claims();
    if (!claims) throw new Error("Pixel Pulse did not return an identity.");
    const profile = pixelProfile(
      claims,
      await oidc.fetchUserInfo(configuration, tokens.access_token, claims.sub),
    );
    const raw = pixelRandom();
    await neonServerSql`select app_private.pixel_bind_account(${profile.subject}::uuid,${profile.username}::text,${profile.email}::text,${profile.emailVerified}::boolean,${attempt.link_user_id}::uuid,${pixelHash(raw)}::text,${attempt.intent}::text)`;
    const response = NextResponse.redirect(
      new URL("/?pixel_connected=1", pixelOrigin()),
      303,
    );
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    response.cookies.set(
      pixelCookieName(PIXEL_COOKIE),
      raw,
      pixelCookieOptions(PIXEL_SESSION_SECONDS),
    );
    response.cookies.set(
      pixelCookieName(PIXEL_ATTEMPT_COOKIE),
      "",
      pixelCookieOptions(0),
    );
    return response;
  } catch (error) {
    // Never log credentials, codes, verifiers, cookies, email, or tokens.
    console.warn(
      "Pixel Pulse sign-in failed",
      error instanceof Error ? error.name : "Error",
    );
    const message =
      error instanceof Error &&
      /^(This sign-in|Choose your shared|An existing Skyway|Use the same email|This shared username|This Pixel Pulse|This Skyway account|Your shared email|Shared usernames)/.test(
        error.message,
      )
        ? error.message
        : "Pixel Pulse sign-in could not complete. Your existing account and progress have not been changed. Try again.";
    if (action === "callback") {
      const response = NextResponse.redirect(
        new URL(`/?pixel_error=${encodeURIComponent(message)}`, pixelOrigin()),
        303,
      );
      response.headers.set("Cache-Control", "no-store");
      response.headers.set("Referrer-Policy", "no-referrer");
      response.cookies.set(
        pixelCookieName(PIXEL_ATTEMPT_COOKIE),
        "",
        pixelCookieOptions(0),
      );
      return response;
    }
    return json({ error: message }, 503);
  }
}
export const GET = route;
export const POST = route;
