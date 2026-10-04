import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const jwt = `${Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: USER_ID, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.test-signature`;

test("cached Better Auth sessions cannot replace the /token response", async () => {
  process.env.NEXT_PUBLIC_NEON_DATA_API_URL = "https://example.neon.tech/neondb/rest/v1";
  const originalFetch = globalThis.fetch;
  const requests = [];
  let tokenResponse = () => Response.json({ token: jwt });
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, headers: new Headers(init?.headers) });
    if (url.endsWith("/get-session")) return Response.json({
      session: { id: "test-session", userId: USER_ID, token: "opaque-cookie-session", expiresAt: new Date(Date.now() + 3600000).toISOString() },
      user: { id: USER_ID, email: "test@example.test", emailVerified: true, name: "Test" },
    });
    if (url.endsWith("/token")) return tokenResponse();
    if (url.includes("/rpc/register_player_device")) {
      assert.equal(new Headers(init?.headers).get("Authorization"), `Bearer ${jwt}`);
      return Response.json({ account_banned: false, device_banned: false, active_bans: [] });
    }
    throw new Error(`Unexpected test request: ${url}`);
  };
  const client = await import("./skyway-client.ts");
  try {
    const { data, error } = await client.supabase.auth.getSession();
    assert.equal(error, null);
    assert.equal(data.session.user.id, USER_ID);
    // The real pinned SDK caches this response under BOTH get-session and
    // token. This regression uses that SDK, not a mocked token provider.
    const databaseSession = await client.ensureNeonCompatibleSession(data.session);
    assert.equal(databaseSession.access_token, jwt);
    assert.equal(requests.filter(({ url }) => url.endsWith("/token")).length, 1);
    assert.equal(requests.find(({ url }) => url.endsWith("/token")).headers.has("X-Force-Fetch"), false);
    assert.equal(client.setDataSession(databaseSession, USER_ID), true);
    const result = await client.supabase.rpc("register_player_device", { p_device_token: "test-device-token", p_label: "Test browser" });
    assert.equal(result.error, null);
    assert.equal(result.data.account_banned, false);
    // Token refresh still reaches the JWT endpoint with a warm SDK cache.
    const refreshedSession = await client.ensureNeonCompatibleSession(data.session);
    assert.equal(refreshedSession.access_token, jwt);
    assert.equal(requests.filter(({ url }) => url.endsWith("/token")).length, 2);
    // A rejected or malformed JWT request must not fall back to the SDK's
    // opaque cached cookie token, even when that cache still contains a user.
    client.setDataSession(null, null);
    tokenResponse = () => Response.json({ message: "Unauthorized" }, { status: 401 });
    await assert.rejects(() => client.ensureNeonCompatibleSession(data.session));
    assert.equal(client.getDataAccessToken(), null);
    tokenResponse = () => Response.json({ token: "opaque-cookie-session" });
    await assert.rejects(() => client.ensureNeonCompatibleSession(data.session), /database access token/);
    assert.equal(client.getDataAccessToken(), null);
    const requestCount = requests.length;
    assert.equal(await client.ensureNeonCompatibleSession(null), null);
    assert.equal(requests.length, requestCount);
  } finally {
    client.setDataSession(null, null);
    globalThis.fetch = originalFetch;
  }
});

test("retry rebuilds auth hydration, and late unsubscribed callbacks cannot revoke it", async () => {
  const source = await readFile(new URL("./page.tsx", import.meta.url), "utf8");
  const errorGate = source.slice(source.indexOf('if (!recoveryToken && (userEmail || guest) && playerAccessError)'), source.indexOf('if (!recoveryToken && userEmail && !playerAccess)'));
  assert.match(errorGate, /setAuthSessionRefresh\(\(value\) => value \+ 1\)/);
  assert.doesNotMatch(errorGate, /refreshPlayerAccess\(true\)/);
  const subscription = source.slice(source.indexOf('const { data } = supabase.auth.onAuthStateChange'), source.indexOf('}, [applyProgressionPayload, authSessionRefresh, refreshPlayerAccess]'));
  assert.match(subscription, /if \(!active\) return/);
  assert.match(subscription, /active = false/);
});

test("startup grants remain explicit and never grant anonymous or blanket access", async () => {
  for (const path of ["../neon/post-data-api.sql", "../neon/account-session-access.sql"]) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    assert.match(source, /grant execute on function public\.(?:register_player_device\(text,text\),\s*public\.)?is_admin\(\),\s*public\.get_admin_role\(\),\s*public\.get_admin_test_mode\(\),\s*public\.get_player_progression\(\)\s*to authenticated/i);
    assert.doesNotMatch(source, /grant execute on all functions/i);
    assert.doesNotMatch(source, /grant execute[\s\S]*?\bto\s+(?:public|anon|anonymous)\s*;/i);
  }
});

test("admin restoration grants only guarded public tools and never changes roles", async () => {
  const source = await readFile(new URL("../neon/admin-session-access.sql", import.meta.url), "utf8");
  assert.match(source, /public\.is_admin\(\)/);
  assert.match(source, /public\.is_main_admin\(\)/);
  assert.match(source, /p\.prosecdef and 'search_path=""'=any\(p\.proconfig\)/);
  assert.match(source, /Admin entry guard failed verification/);
  assert.match(source, /from public, anon, anonymous/);
  assert.match(source, /to authenticated/);
  assert.doesNotMatch(source, /grant execute on all functions/i);
  assert.doesNotMatch(source, /grant[\s\S]*?\bto\s+(?:public|anon|anonymous)\s*;/i);
  assert.doesNotMatch(source, /grant[\s\S]*?app_private/i);
  assert.doesNotMatch(source, /\b(?:insert into|update|delete from)\s+(?:public\.)?admin_users/i);
  assert.match(source, /users\."createdAt"/);
  assert.match(source, /Unexpected admin lookup definition/);
  assert.doesNotMatch(source, /\b(?:insert into|update|delete from|alter table)\s+neon_auth\./i);
});
