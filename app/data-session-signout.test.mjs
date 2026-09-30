import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const USER_ID = "11111111-1111-4111-8111-111111111111";

test("sign-out revokes browser data authority before its captured leave finishes", async () => {
  process.env.NEXT_PUBLIC_NEON_DATA_API_URL =
    "https://example.neon.tech/neondb/rest/v1";

  const client = await import("./skyway-client.ts");
  client.setDataSession(
    { user: { id: USER_ID }, access_token: "test-access-token" },
    USER_ID,
  );

  const originalFetch = globalThis.fetch;
  let finishLeave;
  globalThis.fetch = () =>
    new Promise((resolve) => {
      finishLeave = () => resolve(new Response(null, { status: 204 }));
    });

  try {
    const leave = client.revokeDataSessionForSignOut({
      expectedUserId: USER_ID,
      notifyVersus: true,
    });
    assert.equal(client.getDataAccessToken(), null);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(typeof finishLeave, "function");
    finishLeave();
    assert.equal(await leave, true);
  } finally {
    client.setDataSession(null, null);
    globalThis.fetch = originalFetch;
  }
});

test("guest bucket cleanup is indexed, expired, locked, and batch bounded", async () => {
  const sql = await readFile(
    new URL("../neon/post-data-api.sql", import.meta.url),
    "utf8",
  );
  assert.match(sql, /guest_access_rate_limits_window_idx/);
  assert.match(sql, /window_started_at <= v_now - interval '5 minutes'/);
  assert.match(sql, /limit 64\s+for update skip locked/i);
  assert.match(
    sql,
    /delete from app_private\.guest_access_rate_limits rate_limit\s+using stale_buckets/i,
  );
});

test("UI sign-out invalidates auth hydration before revoking the data token", async () => {
  const source = await readFile(new URL("./page.tsx", import.meta.url), "utf8");
  const signOut = source.slice(source.indexOf("const signOut = async () =>"));
  const invalidateGeneration = signOut.indexOf(
    "authSessionGenerationRef.current += 1",
  );
  const clearAuthOwner = signOut.indexOf(
    "authSessionUserIdRef.current = null",
  );
  const revokeData = signOut.indexOf("revokeDataSessionForSignOut({");
  const startAuthSignOut = signOut.indexOf("supabase.auth.signOut()");
  const awaitCapturedLeave = signOut.indexOf("await leaveVersusPromise");
  assert.ok(invalidateGeneration >= 0 && invalidateGeneration < revokeData);
  assert.ok(clearAuthOwner >= 0 && clearAuthOwner < revokeData);
  assert.ok(startAuthSignOut > revokeData);
  assert.ok(startAuthSignOut < awaitCapturedLeave);
});
