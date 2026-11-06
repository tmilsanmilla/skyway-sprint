import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { managePixelAccount } from '../lib/pixel-account-management.ts';
import { PIXEL_ISSUER, PIXEL_CLIENT_ID } from '../lib/pixel-pulse-rules.ts';

// Real signed management requests and actual receiver. Only SQL/quota/key
// transport and the clock are modeled; no provider or database is contacted.
const { privateKey, publicKey } = await generateKeyPair('EdDSA');
const jwks = { keys: [{ ...await exportJWK(publicKey), kid: 'offline-management', alg: 'EdDSA' }] };
const initial = 2_000_000_000;
const base = {
  iss: PIXEL_ISSUER, aud: PIXEL_CLIENT_ID, sub: '11111111-1111-4111-8111-111111111111',
  iat: initial, exp: initial + 60, jti: randomUUID(), ticket_version: 1,
  purpose: 'pixel-pulse-account-management', operation: 'status',
  name: 'owned_player', preferred_username: 'owned_player', email: 'owned@example.invalid',
  email_verified: true, profile_version: 2, credential_version: 3,
};
const linked = { state: 'linked', localAccountId: '22222222-2222-4222-8222-222222222222', profileVersion: 2, credentialVersion: 3 };
const sign = payload => new SignJWT(payload).setProtectedHeader({ alg: 'EdDSA', kid: 'offline-management' }).sign(privateKey);
function fixture(options = {}) {
  let time = initial * 1000;
  const calls = [], used = new Set();
  const advance = seconds => { time += seconds * 1000; };
  const io = {
    enabled: () => options.enabled !== false,
    now: () => time,
    quota: async () => { calls.push('quota'); return options.quota ?? 'allowed'; },
    keys: async () => { calls.push('keys'); if (options.keyDelay) advance(options.keyDelay); return jwks; },
    take: async (jti, exp) => { calls.push(['take', jti, exp]); if (options.takeDelay) advance(options.takeDelay); if (used.has(jti)) return false; used.add(jti); return true; },
    retire: async p => { calls.push(['retire', p]); if (options.retireDelay) advance(options.retireDelay); },
    status: async p => { calls.push(['status', p]); if (options.operationDelay) advance(options.operationDelay); return options.result ?? linked; },
    sync: async p => { calls.push(['sync', p]); if (options.operationFailure) throw new Error('synthetic collision'); return options.result ?? linked; },
  };
  const invoke = async (payload = base, extras = {}) => {
    const token = extras.token ?? await sign(payload);
    const headers = { 'content-type': 'application/json', authorization: 'Bearer ' + token, ...extras.headers };
    return managePixelAccount(new Request('https://skyway-sprint.vercel.app/api/pixel-pulse/account', {
      method: extras.method ?? 'POST', headers,
      ...((extras.method ?? 'POST') === 'GET' ? {} : { body: extras.body ?? JSON.stringify({ operation: payload.operation }) }),
    }), io);
  };
  return { invoke, calls, advance };
}
const named = (f, name) => f.calls.filter(c => Array.isArray(c) && c[0] === name);
for (const operation of ['status', 'sync']) test(`signed ${operation} returns only canonical linked result, commits retirement first`, async () => {
  const f = fixture({ result: { ...linked, unwanted: 'not returned' } });
  const r = await f.invoke({ ...base, operation });
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), linked);
  assert.deepEqual(f.calls.filter(Array.isArray).map(c => c[0]), ['take', 'retire', operation]);
  assert.equal(r.headers.get('set-cookie'), null); assert.match(r.headers.get('cache-control'), /no-store/);
});
test('one signed request is single-use and replay makes no further account call', async () => {
  const f = fixture(); assert.equal((await f.invoke()).status, 200);
  assert.equal((await f.invoke()).status, 409); assert.equal(named(f, 'status').length, 1);
});
test('unknown unverified status passes unverified bit to non-provisioning status only', async () => {
  const f = fixture({ result: { state: 'verification_required', leaked: 'omitted' } });
  const r = await f.invoke({ ...base, email_verified: false });
  assert.deepEqual(await r.json(), { state: 'verification_required' });
  assert.equal(named(f, 'status')[0][1].emailVerified, false); assert.equal(named(f, 'sync').length, 0);
});
test('already-supported canonical space25 profile reaches status without truncation', async () => {
  const username = 'player name ' + 'x'.repeat(13);
  assert.equal(username.length, 25);
  const f = fixture(); assert.equal((await f.invoke({ ...base, name: username, preferred_username: username })).status, 200);
  assert.equal(named(f, 'status')[0][1].username, username);
  for (const bad of [' player', 'player ', 'player  name', 'x'.repeat(26)]) {
    const denied = fixture(); assert.equal((await denied.invoke({ ...base, name: bad, preferred_username: bad })).status, 401);
    assert.equal(named(denied, 'take').length, 0);
  }
});
test('a subsequent sync failure cannot undo the already completed epoch retirement', async () => {
  const f = fixture({ operationFailure: true });
  assert.equal((await f.invoke({ ...base, operation: 'sync' })).status, 503);
  assert.deepEqual(f.calls.filter(Array.isArray).map(c => c[0]), ['take', 'retire', 'sync']);
});
for (const [field, value] of Object.entries({
  iss: 'https://evil.invalid', aud: [PIXEL_CLIENT_ID], sub: 'wrong', jti: 'not-a-jti',
  ticket_version: 2, purpose: 'pixel-pulse-fresh-link', name: 'different_name',
  preferred_username: 'bad.name', email: 'bad', email_verified: 'true',
  profile_version: -1, credential_version: 1.2, iat: initial + 1, exp: initial + 61,
})) test(`signed invalid ${field} refuses before ticket/SQL`, async () => {
  const f = fixture(); assert.equal((await f.invoke({ ...base, [field]: value })).status, 401);
  assert.equal(f.calls.filter(Array.isArray).length, 0);
});
test('body operation must match signed operation, and Link/Create or extra authority are refused', async () => {
  for (const body of [{ operation: 'sync' }, { operation: 'link' }, { operation: 'create' }, { operation: 'status', localAccountId: linked.localAccountId }]) {
    const f = fixture(), r = await f.invoke(base, { body: JSON.stringify(body) });
    assert.ok([400, 401].includes(r.status)); assert.equal(f.calls.filter(Array.isArray).length, 0);
  }
});
test('browser Origin/cookie, GET and missing signature cannot use the management endpoint', async () => {
  for (const extras of [{ headers: { origin: 'https://skyway-sprint.vercel.app' } }, { headers: { cookie: 'native=fictional' } }, { method: 'GET' }, { token: 'invalid' }]) {
    const f = fixture(); assert.ok((await f.invoke(base, extras)).status >= 400);
    assert.equal(f.calls.filter(Array.isArray).length, 0);
  }
});
test('an expired key-fetch wait cannot restamp an old signed request', async () => {
  const f = fixture({ keyDelay: 60 }); assert.equal((await f.invoke()).status, 401); assert.equal(named(f, 'take').length, 0);
});
test('expiry at ticket claim or retirement stops subsequent account access', async () => {
  for (const delay of ['takeDelay', 'retireDelay']) {
    const f = fixture({ [delay]: 60 }); assert.equal((await f.invoke()).status, 503);
    assert.equal(named(f, 'status').length, 0);
    assert.equal(named(f, 'retire').length, delay === 'takeDelay' ? 0 : 1);
  }
});
test('expiry after an account wait refuses success, with no automatic retry', async () => {
  const f = fixture({ operationDelay: 60 }); assert.equal((await f.invoke()).status, 503);
  assert.equal(named(f, 'status').length, 1); assert.equal(named(f, 'take').length, 1);
});
test('closed service, denied quota and invalid DB result fail closed', async () => {
  for (const options of [{ enabled: false }, { quota: 'unavailable' }, { result: { ...linked, credentialVersion: -1 } }]) {
    const f = fixture(options); assert.equal((await f.invoke()).status, 503);
  }
});
