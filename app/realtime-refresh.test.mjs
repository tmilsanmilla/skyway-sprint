import assert from "node:assert/strict";
import test from "node:test";

import {
  TURN_CREDENTIAL_TTL_SECONDS,
  TURN_REFRESH_LEAD_MS,
  TURN_REFRESH_MIN_DELAY_MS,
  TURN_REFRESH_RETRY_MAX_MS,
  applyRefreshedTurnConfiguration,
  resolveTurnCredentialExpiresAtMs,
  resolveTurnRefreshDelayMs,
  resolveTurnRefreshRetryDelayMs,
} from "../lib/realtime-refresh.ts";

test("TURN credentials refresh five minutes before their server expiry", () => {
  const nowMs = 1_800_000_000_000;
  const expiresAtMs = nowMs + TURN_CREDENTIAL_TTL_SECONDS * 1_000;

  assert.equal(
    resolveTurnRefreshDelayMs(expiresAtMs, nowMs),
    TURN_CREDENTIAL_TTL_SECONDS * 1_000 - TURN_REFRESH_LEAD_MS,
  );
});

test("missing or stale expiry metadata gets a conservative local expiry", () => {
  const nowMs = 1_800_000_000_000;

  assert.equal(
    resolveTurnCredentialExpiresAtMs(undefined, nowMs),
    nowMs + TURN_CREDENTIAL_TTL_SECONDS * 1_000,
  );
  assert.equal(
    resolveTurnCredentialExpiresAtMs(nowMs / 1_000 - 1, nowMs),
    nowMs + TURN_CREDENTIAL_TTL_SECONDS * 1_000,
  );
});

test("near-expiry credentials refresh promptly without creating a tight loop", () => {
  const nowMs = 1_800_000_000_000;

  assert.equal(
    resolveTurnRefreshDelayMs(nowMs + 1_000, nowMs),
    TURN_REFRESH_MIN_DELAY_MS,
  );
});

test("TURN refresh retries back off and remain capped", () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5, 20].map(resolveTurnRefreshRetryDelayMs),
    [5_000, 10_000, 20_000, 40_000, 60_000, TURN_REFRESH_RETRY_MAX_MS],
  );
});

test("refreshed TURN credentials replace the live peer configuration", () => {
  const applied = [];
  const iceServers = [
    {
      urls: ["turns:turn.cloudflare.com:443?transport=tcp"],
      username: "short-lived-user",
      credential: "short-lived-credential",
    },
  ];
  const peer = {
    signalingState: "stable",
    setConfiguration: (configuration) => applied.push(configuration),
  };

  assert.equal(applyRefreshedTurnConfiguration(peer, iceServers), true);
  assert.deepEqual(applied, [
    { iceServers, iceTransportPolicy: "relay" },
  ]);
});

test("refresh cleanup does not reconfigure a closed peer", () => {
  let calls = 0;
  const peer = {
    signalingState: "closed",
    setConfiguration: () => {
      calls += 1;
    },
  };

  assert.equal(applyRefreshedTurnConfiguration(peer, []), false);
  assert.equal(calls, 0);
});
