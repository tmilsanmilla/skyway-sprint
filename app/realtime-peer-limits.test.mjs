import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createPeerRateGuardState,
  createPeerSequenceGuardState,
  createPeerSignalQuotaState,
  createPeerMotionGuardState,
  guardPeerRate,
  guardPeerSequence,
  guardPeerSignalKind,
  guardPeerMotion,
  normalizePeerInvalidationDomains,
  PEER_CONTROL_RATE_LIMIT,
  PEER_CONTROL_RATE_WINDOW_MS,
  PEER_INVALIDATION_INTERVAL_MS,
  PEER_MOTION_MAX_SEQUENCE_GAP,
  PEER_MOTION_RATE_LIMIT,
  PEER_SIGNAL_KIND_LIMITS,
  PEER_SIGNAL_RATE_WINDOW_MS,
  PeerInvalidationDispatcher,
  resolvePeerInvalidationDelayMs,
  resolvePeerSignalingReconnect,
  sanitizePeerIceCandidate,
} from "./realtime-peer-limits.ts";

test("peer invalidations keep only unique, recognized domains", () => {
  assert.deepEqual(
    normalizePeerInvalidationDomains([
      "attacks",
      "attacks",
      "players",
      "unknown",
      null,
    ]),
    ["attacks", "players"],
  );
  assert.deepEqual(normalizePeerInvalidationDomains("attacks"), []);
});

test("peer invalidation callbacks cannot be delivered in a tight loop", () => {
  assert.equal(resolvePeerInvalidationDelayMs(1_000, 1_001), 249);
  assert.equal(
    resolvePeerInvalidationDelayMs(1_000, 1_000 + PEER_INVALIDATION_INTERVAL_MS),
    0,
  );
});

test("peer invalidations use bounded monotonic control sequences", () => {
  const initial = createPeerSequenceGuardState();
  const first = guardPeerSequence(initial, 1);
  assert.equal(first.accepted, true);
  assert.equal(guardPeerSequence(first.state, 1).accepted, false);
  assert.equal(guardPeerSequence(first.state, 0).accepted, false);
  assert.equal(guardPeerSequence(first.state, Number.MAX_SAFE_INTEGER).accepted, false);
  assert.equal(guardPeerSequence(first.state, 2).accepted, true);
});

test("raw control traffic has a fixed-window hard bound", () => {
  let state = createPeerRateGuardState();
  for (let index = 0; index < PEER_CONTROL_RATE_LIMIT; index += 1) {
    const result = guardPeerRate(
      state,
      1_000,
      PEER_CONTROL_RATE_LIMIT,
      PEER_CONTROL_RATE_WINDOW_MS,
    );
    assert.equal(result.accepted, true);
    state = result.state;
  }
  const overflow = guardPeerRate(
    state,
    1_001,
    PEER_CONTROL_RATE_LIMIT,
    PEER_CONTROL_RATE_WINDOW_MS,
  );
  assert.equal(overflow.accepted, false);
  assert.equal(
    guardPeerRate(
      overflow.state,
      1_000 + PEER_CONTROL_RATE_WINDOW_MS,
      PEER_CONTROL_RATE_LIMIT,
      PEER_CONTROL_RATE_WINDOW_MS,
    ).accepted,
    true,
  );
});

test("invalidation delivery has one in-flight call and one coalesced pending call", async () => {
  let now = 1_000;
  const scheduled = [];
  const schedule = (callback, delayMs) => {
    const timer = { callback, delayMs };
    scheduled.push(timer);
    return timer;
  };
  const cancel = (timer) => {
    const index = scheduled.indexOf(timer);
    if (index >= 0) scheduled.splice(index, 1);
  };
  const calls = [];
  let releaseFirst;
  const dispatcher = new PeerInvalidationDispatcher(
    (domains) => {
      calls.push(domains);
      if (calls.length === 1)
        return new Promise((resolve) => {
          releaseFirst = resolve;
        });
    },
    () => now,
    schedule,
    cancel,
  );

  dispatcher.enqueue(["match"]);
  assert.equal(scheduled.length, 1);
  scheduled.shift().callback();
  await Promise.resolve();
  assert.deepEqual(calls, [["match"]]);

  dispatcher.enqueue(["players"]);
  dispatcher.enqueue(["players", "attacks"]);
  assert.equal(scheduled.length, 0);
  releaseFirst();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].delayMs, PEER_INVALIDATION_INTERVAL_MS);

  now += PEER_INVALIDATION_INTERVAL_MS;
  scheduled.shift().callback();
  await Promise.resolve();
  assert.deepEqual(calls, [
    ["match"],
    ["players", "attacks"],
  ]);
  dispatcher.close();
});

test("signaling quotas are independent per kind and reset by window", () => {
  let state = createPeerSignalQuotaState();
  for (let index = 0; index < PEER_SIGNAL_KIND_LIMITS.offer; index += 1) {
    const result = guardPeerSignalKind(state, "offer", 1_000);
    assert.equal(result.accepted, true);
    state = result.state;
  }
  const offerOverflow = guardPeerSignalKind(state, "offer", 1_001);
  assert.equal(offerOverflow.accepted, false);
  const answer = guardPeerSignalKind(offerOverflow.state, "answer", 1_001);
  assert.equal(answer.accepted, true);
  assert.equal(
    guardPeerSignalKind(
      answer.state,
      "offer",
      1_000 + PEER_SIGNAL_RATE_WINDOW_MS,
    ).accepted,
    true,
  );
});

test("ICE candidates are copied from strict bounded fields only", () => {
  assert.deepEqual(
    sanitizePeerIceCandidate({
      candidate: "candidate:1 1 UDP 2122260223 192.0.2.1 54400 typ host",
      sdpMid: "0",
      sdpMLineIndex: 0,
      usernameFragment: "safe-fragment",
      serverUrl: "must-not-pass-through",
    }),
    {
      candidate: "candidate:1 1 UDP 2122260223 192.0.2.1 54400 typ host",
      sdpMid: "0",
      sdpMLineIndex: 0,
      usernameFragment: "safe-fragment",
    },
  );
  assert.equal(
    sanitizePeerIceCandidate({ candidate: "candidate:bad\nfield" }),
    null,
  );
  assert.equal(
    sanitizePeerIceCandidate({
      candidate: "candidate:1 1 UDP 1 192.0.2.1 1 typ host",
      sdpMLineIndex: 256,
    }),
    null,
  );
});

test("signaling expiry always re-bootstraps and successful opens reset retries", () => {
  assert.deepEqual(
    resolvePeerSignalingReconnect({
      closeCode: 4009,
      opened: true,
      peerConnected: true,
      attempt: 3,
    }),
    { attempt: 0, delayMs: 0 },
  );
  assert.deepEqual(
    resolvePeerSignalingReconnect({
      closeCode: 4009,
      opened: true,
      peerConnected: true,
      attempt: 3,
    }),
    { attempt: 0, delayMs: 0 },
  );
  assert.deepEqual(
    resolvePeerSignalingReconnect({
      closeCode: 1006,
      opened: true,
      peerConnected: false,
      attempt: 3,
    }),
    { attempt: 0, delayMs: 1_000 },
  );
  assert.equal(
    resolvePeerSignalingReconnect({
      closeCode: 1000,
      opened: true,
      peerConnected: true,
      attempt: 0,
    }),
    null,
  );
});

test("peer motion drops stale, impossible-lane, and huge-jump sequences", () => {
  const initial = createPeerMotionGuardState();
  const first = guardPeerMotion(
    initial,
    { laneIndex: 3, sequence: 1 },
    1_000,
  );
  assert.equal(first.accepted, true);
  assert.equal(
    guardPeerMotion(first.state, { laneIndex: 3, sequence: 1 }, 1_010)
      .accepted,
    false,
  );
  assert.equal(
    guardPeerMotion(first.state, { laneIndex: 7, sequence: 2 }, 1_010)
      .accepted,
    false,
  );
  assert.equal(
    guardPeerMotion(
      first.state,
      { laneIndex: 3, sequence: 1 + PEER_MOTION_MAX_SEQUENCE_GAP + 1 },
      1_010,
    ).accepted,
    false,
  );
});

test("peer motion burst delivery is bounded and recovers next window", () => {
  let state = createPeerMotionGuardState();
  for (let sequence = 1; sequence <= PEER_MOTION_RATE_LIMIT; sequence += 1) {
    const result = guardPeerMotion(
      state,
      { laneIndex: sequence % 7, sequence },
      1_000,
    );
    assert.equal(result.accepted, true);
    state = result.state;
  }
  const overflow = guardPeerMotion(
    state,
    { laneIndex: 0, sequence: PEER_MOTION_RATE_LIMIT + 1 },
    1_500,
  );
  assert.equal(overflow.accepted, false);
  const recovered = guardPeerMotion(
    overflow.state,
    { laneIndex: 0, sequence: PEER_MOTION_RATE_LIMIT + 2 },
    2_001,
  );
  assert.equal(recovered.accepted, true);
});

test("the realtime client wires every peer boundary into the live channels", async () => {
  const realtimeSource = await readFile(
    new URL("./cloudflare-realtime.ts", import.meta.url),
    "utf8",
  );
  const pageSource = await readFile(new URL("./page.tsx", import.meta.url), "utf8");
  assert.match(realtimeSource, /seq: \+\+this\.controlSequence/);
  assert.match(realtimeSource, /guardPeerSequence\(/);
  assert.match(realtimeSource, /guardPeerRate\(/);
  assert.match(realtimeSource, /this\.controlChannel && this\.controlChannel !== channel/);
  assert.match(realtimeSource, /negotiationId !== this\.negotiationId/);
  assert.match(realtimeSource, /PEER_MAX_PENDING_ICE_CANDIDATES/);
  assert.match(realtimeSource, /sanitizePeerIceCandidate\(message\.candidate\)/);
  assert.match(realtimeSource, /signalingReconnectTimer/);
  assert.match(pageSource, /onInvalidate: async \(\) =>/);
  assert.match(pageSource, /await hydrateVersusStateRef\.current\?\.\(matchId, true\)/);
});
