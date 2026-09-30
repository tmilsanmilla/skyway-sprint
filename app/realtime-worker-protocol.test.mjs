import assert from "node:assert/strict";
import test from "node:test";

import {
  createWorkerSignalQuotaState,
  guardWorkerSignalKind,
  parseWorkerClientMessage,
  WORKER_SIGNAL_KIND_LIMITS,
  WORKER_SIGNAL_RATE_WINDOW_MS,
} from "../cloudflare/realtime-worker/src/protocol.ts";

const offer = JSON.stringify({
  v: 1,
  type: "signal",
  kind: "offer",
  negotiationId: "negotiation_1",
  sdp: "v=0\r\n",
  attackerControlledExtra: "drop me",
});

test("Worker signaling roles permit only slot 1 offers and slot 2 answers", () => {
  assert.equal(parseWorkerClientMessage(offer, 2), null);
  assert.deepEqual(parseWorkerClientMessage(offer, 1), {
    quotaKind: "offer",
    message: {
      v: 1,
      type: "signal",
      kind: "offer",
      negotiationId: "negotiation_1",
      sdp: "v=0\r\n",
    },
  });

  const answer = offer.replace('"offer"', '"answer"');
  assert.equal(parseWorkerClientMessage(answer, 1), null);
  assert.equal(parseWorkerClientMessage(answer, 2)?.quotaKind, "answer");
});

test("Worker relays only normalized TURN relay candidate fields", () => {
  const relay = parseWorkerClientMessage(
    JSON.stringify({
      v: 1,
      type: "signal",
      kind: "ice",
      negotiationId: "negotiation_1",
      candidate: {
        candidate:
          "candidate:1 1 UDP 1677734910 192.0.2.10 50000 typ relay raddr 0.0.0.0 rport 0",
        sdpMid: "0",
        sdpMLineIndex: 0,
        usernameFragment: "safe-fragment",
        attackerControlledExtra: "drop me",
      },
      attackerControlledExtra: "drop me too",
    }),
    1,
  );
  assert.deepEqual(relay, {
    quotaKind: "ice",
    message: {
      v: 1,
      type: "signal",
      kind: "ice",
      negotiationId: "negotiation_1",
      candidate: {
        candidate:
          "candidate:1 1 UDP 1677734910 192.0.2.10 50000 typ relay raddr 0.0.0.0 rport 0",
        sdpMid: "0",
        sdpMLineIndex: 0,
        usernameFragment: "safe-fragment",
      },
    },
  });

  assert.equal(
    parseWorkerClientMessage(
      JSON.stringify({
        v: 1,
        type: "signal",
        kind: "ice",
        negotiationId: "negotiation_1",
        candidate: {
          candidate: "candidate:1 1 UDP 1 10.0.0.5 50000 typ host",
        },
      }),
      1,
    ),
    null,
  );
});

test("Worker signaling quotas independently cap every message kind", () => {
  for (const kind of Object.keys(WORKER_SIGNAL_KIND_LIMITS)) {
    let state = createWorkerSignalQuotaState();
    const limit = WORKER_SIGNAL_KIND_LIMITS[kind];
    for (let index = 0; index < limit; index += 1) {
      const result = guardWorkerSignalKind(state, kind, 1_000);
      assert.equal(result.accepted, true, `${kind} was rejected too early`);
      state = result.state;
    }
    const overflow = guardWorkerSignalKind(state, kind, 1_001);
    assert.equal(overflow.accepted, false, `${kind} overflow was accepted`);
    assert.equal(
      guardWorkerSignalKind(
        overflow.state,
        kind,
        1_000 + WORKER_SIGNAL_RATE_WINDOW_MS,
      ).accepted,
      true,
    );
  }
});
