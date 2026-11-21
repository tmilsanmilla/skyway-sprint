import assert from "node:assert/strict";
import test from "node:test";
import { createVersusSnapshotRefresh } from "./versus-snapshot-refresh.ts";

const settle = async () => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
};
function clock() {
  let now = 1_000;
  const timers = new Map();
  let id = 0;
  return {
    timing: {
      now: () => now,
      schedule(callback, delay) {
        const key = ++id;
        timers.set(key, { callback, at: now + delay });
        return key;
      },
      cancel: (key) => timers.delete(key),
    },
    async advance(ms = 0) {
      now += ms;
      for (const [key, timer] of [...timers]) {
        if (timer.at <= now) {
          timers.delete(key);
          timer.callback();
        }
      }
      await settle();
    },
    pending: () => timers.size,
  };
}

test("host and delayed guest coalesce peer/reconnect/poll bursts and retain the newest state", async () => {
  const measurements = [];
  for (const label of ["host", "delayed guest"]) {
    const time = clock();
    let active = 0, peak = 0, calls = 0, revision = 0;
    let release;
    const observed = [];
    const refresh = createVersusSnapshotRefresh(async () => {
      calls += 1;
      active += 1;
      peak = Math.max(peak, active);
      if (calls === 1) await new Promise((resolve) => { release = resolve; });
      observed.push(revision);
      active -= 1;
    }, () => true, time.timing);
    for (let i = 0; i < 100; i += 1) refresh.request();
    await time.advance();
    assert.equal(calls, 1);
    for (let i = 0; i < 100; i += 1) refresh.request();
    await time.advance(label === "host" ? 250 : 2_000);
    assert.equal(calls, 1);
    revision = 7;
    release();
    await settle();
    await time.advance(250);
    assert.equal(calls, 2);
    assert.equal(peak, 1);
    assert.equal(observed.at(-1), 7);
    measurements.push({ client: label, independentHints: 200, reads: calls, peak });
    refresh.close();
    assert.equal(time.pending(), 0);
  }
  console.log(JSON.stringify({ scenario: "controlled hint burst, not measured FPS", measurements }));
});

test("a match or actor switch before delivery prevents the old read", async () => {
  for (const field of ["match", "actor"]) {
    const time = clock();
    const identity = { match: "match-a", actor: "actor-a" };
    let calls = 0;
    const refresh = createVersusSnapshotRefresh(async () => { calls += 1; },
      () => identity.match === "match-a" && identity.actor === "actor-a", time.timing);
    refresh.request();
    identity[field] = "replacement";
    await time.advance();
    refresh.request();
    await time.advance(1_000);
    assert.equal(calls, 0);
    assert.equal(time.pending(), 0);
    refresh.close();
  }
});

test("closing a scheduled refresh cancels its timer", async () => {
  const time = clock();
  let calls = 0;
  const refresh = createVersusSnapshotRefresh(async () => { calls += 1; }, () => true, time.timing);
  refresh.request();
  assert.equal(time.pending(), 1);
  refresh.close();
  refresh.request();
  await time.advance(1_000);
  assert.equal(calls, 0);
  assert.equal(time.pending(), 0);
});

test("closing an in-flight read discards all trailing refreshes", async () => {
  const time = clock();
  let calls = 0, release;
  const refresh = createVersusSnapshotRefresh(async () => {
    calls += 1;
    await new Promise((resolve) => { release = resolve; });
  }, () => true, time.timing);
  refresh.request();
  await time.advance();
  refresh.request();
  refresh.close();
  release();
  await settle();
  await time.advance(1_000);
  assert.equal(calls, 1);
  assert.equal(time.pending(), 0);
});

test("a failed read releases the flight and allows a later authoritative refresh", async () => {
  const time = clock();
  let calls = 0;
  const refresh = createVersusSnapshotRefresh(async () => {
    calls += 1;
    if (calls === 1) throw new Error("synthetic unavailable read");
  }, () => true, time.timing);
  refresh.request();
  await time.advance();
  refresh.request();
  await time.advance(250);
  assert.equal(calls, 2);
  refresh.close();
});

test("independent matches never share a flight or suppress each other's reads", async () => {
  const time = clock();
  const calls = [0, 0];
  const clients = calls.map((_, i) => createVersusSnapshotRefresh(async () => { calls[i] += 1; }, () => true, time.timing));
  clients.forEach((client) => client.request());
  await time.advance();
  assert.deepEqual(calls, [1, 1]);
  clients[0].close();
  clients[1].request();
  await time.advance(250);
  assert.deepEqual(calls, [1, 2]);
  clients[1].close();
});
