import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  preAuthNetworkBucket,
  preAuthRateLimitSecret,
  trustedRequestNetworkIdentity,
} from "../lib/pre-auth-network.ts";
import {
  REALTIME_CONNECT_TICKET_TTL_SECONDS,
  REALTIME_SESSION_TTL_SECONDS,
  isRealtimeTicketTimeWindowValid,
} from "../lib/realtime-session.ts";

test("deployed network identity trusts only Vercel's protected address", () => {
  const request = new Request("https://skyway-sprint.vercel.app/api/account/bootstrap", {
    headers: {
      "x-vercel-forwarded-for": "203.0.113.7",
      "x-forwarded-for": "198.51.100.9",
      "x-real-ip": "192.0.2.4",
    },
  });
  assert.equal(
    trustedRequestNetworkIdentity(request, {
      isProduction: true,
      isVercel: true,
    }),
    "203.0.113.7",
  );
});

test("deployed network identity fails closed without a valid Vercel address", () => {
  for (const headers of [
    { "x-forwarded-for": "203.0.113.7" },
    { "x-real-ip": "203.0.113.7" },
    { "x-vercel-forwarded-for": "203.0.113.7, 198.51.100.9" },
    { "x-vercel-forwarded-for": "not-an-ip" },
  ]) {
    const request = new Request("https://skyway-sprint.vercel.app/api/realtime/bootstrap", {
      headers,
    });
    assert.equal(
      trustedRequestNetworkIdentity(request, {
        isProduction: true,
        isVercel: true,
      }),
      null,
    );
  }

  const nonVercelProduction = new Request(
    "https://example.com/api/realtime/bootstrap",
    { headers: { "x-vercel-forwarded-for": "203.0.113.7" } },
  );
  assert.equal(
    trustedRequestNetworkIdentity(nonVercelProduction, {
      isProduction: true,
      isVercel: false,
    }),
    null,
  );
});

test("development fallback is fixed and localhost-only", () => {
  assert.equal(
    trustedRequestNetworkIdentity(
      new Request("http://localhost:3000/api/realtime/bootstrap", {
        headers: { "x-vercel-forwarded-for": "203.0.113.7" },
      }),
      { isProduction: false, isVercel: false },
    ),
    "local-development",
  );
  assert.equal(
    trustedRequestNetworkIdentity(
      new Request("http://localhost:3000/api/realtime/bootstrap"),
      { isProduction: false, isVercel: false },
    ),
    "local-development",
  );
  assert.equal(
    trustedRequestNetworkIdentity(
      new Request("http://192.168.1.20:3000/api/realtime/bootstrap", {
        headers: { "x-forwarded-for": "203.0.113.7" },
      }),
      { isProduction: false, isVercel: false },
    ),
    null,
  );
});

test("pre-auth storage receives only a secret-keyed digest", () => {
  const secret = "test-pre-auth-secret-that-is-at-least-32-bytes";
  const bucket = preAuthNetworkBucket(secret, "203.0.113.7");
  assert.match(bucket, /^[0-9a-f]{64}$/);
  assert.equal(bucket.includes("203.0.113.7"), false);
  assert.notEqual(bucket, preAuthNetworkBucket(secret, "203.0.113.8"));
  assert.equal(
    preAuthRateLimitSecret({ GUEST_RATE_LIMIT_SECRET: "too-short" }),
    null,
  );
  assert.equal(
    preAuthRateLimitSecret({ GUEST_RATE_LIMIT_SECRET: secret }),
    secret,
  );
});

test("realtime tickets separate short connect and bounded session lifetimes", () => {
  const nowSeconds = 1_800_000_000;
  assert.equal(
    isRealtimeTicketTimeWindowValid({
      issuedAt: nowSeconds,
      connectExpiresAt: nowSeconds + REALTIME_CONNECT_TICKET_TTL_SECONDS,
      sessionExpiresAt: nowSeconds + REALTIME_SESSION_TTL_SECONDS,
      nowSeconds,
    }),
    true,
  );
  assert.equal(
    isRealtimeTicketTimeWindowValid({
      issuedAt: nowSeconds - 61,
      connectExpiresAt: nowSeconds,
      sessionExpiresAt: nowSeconds + 100,
      nowSeconds,
    }),
    false,
  );
  assert.equal(
    isRealtimeTicketTimeWindowValid({
      issuedAt: nowSeconds,
      connectExpiresAt: nowSeconds + 60,
      sessionExpiresAt: nowSeconds + REALTIME_SESSION_TTL_SECONDS + 1,
      nowSeconds,
    }),
    false,
  );
});

test("both authenticated bridges consume network quota before managed Neon auth", async () => {
  for (const relativePath of [
    "api/account/bootstrap/route.ts",
    "api/realtime/bootstrap/route.ts",
  ]) {
    const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
    const quotaPosition = source.indexOf("await consumePreAuthNetworkQuota(request)");
    const authPosition = source.indexOf("await verifyNeonRequest(");
    assert.ok(quotaPosition >= 0, `${relativePath} is missing the pre-auth quota`);
    assert.ok(authPosition > quotaPosition, `${relativePath} verifies auth before quota`);
  }
});

test("guest access uses the same fail-closed network identity and strong secret", async () => {
  const source = await readFile(
    new URL("api/guest/access/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /trustedRequestNetworkIdentity\(request\)/);
  assert.match(source, /preAuthRateLimitSecret\(\)/);
  assert.match(source, /preAuthNetworkBucket\(secret, networkIdentity\)/);
  assert.doesNotMatch(source, /headers\.get\("x-forwarded-for"\)/);
  assert.doesNotMatch(source, /headers\.get\("x-real-ip"\)/);
  assert.doesNotMatch(source, /NEON_SERVER_DATABASE_URL/);
});

test("pre-auth quota storage is private, indexed, and batch-cleaned", async () => {
  const sql = await readFile(
    new URL("../neon/post-data-api.sql", import.meta.url),
    "utf8",
  );
  assert.match(sql, /create table if not exists app_private\.pre_auth_network_rate_limits/i);
  assert.match(sql, /pre_auth_network_rate_limits_window_idx/i);
  assert.match(sql, /window_started_at <= v_now - interval '5 minutes'/i);
  assert.match(sql, /limit 64\s+for update skip locked/i);
  assert.match(
    sql,
    /revoke all on table app_private\.pre_auth_network_rate_limits\s+from public, anon, anonymous, authenticated/i,
  );
  assert.match(
    sql,
    /grant execute on function app_private\.consume_pre_auth_network_quota\(text\)\s+to skyway_server_api/i,
  );
});
