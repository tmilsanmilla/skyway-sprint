import assert from "node:assert/strict";
import test from "node:test";

import {
  ATTACK_RELEASE_END_FRACTION,
  ATTACK_RELEASE_START_FRACTION,
  PURCHASED_ATTACK_ENTRY_GAP,
  PURCHASED_ATTACK_SPAWN_Y,
  WAVE_PROGRESS_LENGTH,
  canReleasePurchasedAttack,
  getAttackReleaseProgresses,
  getWaveSpeedMultiplier,
} from "./attack-delivery-rules.ts";

test("purchased attacks trickle from 10% through 80% of a wave", () => {
  const releases = getAttackReleaseProgresses(5, WAVE_PROGRESS_LENGTH);
  assert.equal(releases.length, 5);
  assert.equal(
    releases[0],
    WAVE_PROGRESS_LENGTH * (1 + ATTACK_RELEASE_START_FRACTION),
  );
  assert.equal(
    releases.at(-1),
    WAVE_PROGRESS_LENGTH * (1 + ATTACK_RELEASE_END_FRACTION),
  );
  assert.ok(releases.every((value, index) => index === 0 || value > releases[index - 1]));
});

test("a single attack arrives during the wave instead of at its start", () => {
  assert.deepEqual(getAttackReleaseProgresses(1, 0), [1013]);
  assert.deepEqual(getAttackReleaseProgresses(0, 0), []);
});

test("late network arrivals are spread through the remaining wave", () => {
  const releases = getAttackReleaseProgresses(4, 0, 1500);
  assert.ok(releases[0] > 1500);
  assert.ok(releases.at(-1) < WAVE_PROGRESS_LENGTH);
  assert.ok(
    releases.every(
      (value, index) => index === 0 || value > releases[index - 1],
    ),
  );
});

test("wave speed starts at 2x and rises by 0.25x", () => {
  assert.equal(getWaveSpeedMultiplier(1), 2);
  assert.equal(getWaveSpeedMultiplier(2), 2.25);
  assert.equal(getWaveSpeedMultiplier(5), 3);
});

test("late attacks can trickle in after a visible vertical gap", () => {
  const baseCheck = {
    occupiedLanes: [0],
    incomingLanes: [1],
    incomingSafeLanes: [2],
  };
  assert.equal(
    canReleasePurchasedAttack({
      ...baseCheck,
      activePurchasedAttacks: [
        { lane: 0, y: PURCHASED_ATTACK_SPAWN_Y, safeLanes: [2] },
      ],
    }),
    false,
  );
  assert.equal(
    canReleasePurchasedAttack({
      ...baseCheck,
      activePurchasedAttacks: [
        {
          lane: 0,
          y: PURCHASED_ATTACK_SPAWN_Y + PURCHASED_ATTACK_ENTRY_GAP,
          safeLanes: [2],
        },
      ],
    }),
    true,
  );
});

test("a new attack cannot occupy an active attack's escape lane", () => {
  assert.equal(
    canReleasePurchasedAttack({
      activePurchasedAttacks: [{ lane: 0, y: 40, safeLanes: [2] }],
      occupiedLanes: [0],
      incomingLanes: [2],
      incomingSafeLanes: [3],
    }),
    false,
  );
});

test("wide-effect attacks cannot touch an active escape corridor", () => {
  assert.equal(
    canReleasePurchasedAttack({
      activePurchasedAttacks: [{ lane: 0, y: 40, safeLanes: [2] }],
      occupiedLanes: [0],
      incomingLanes: [1],
      incomingBlockedLanes: [0, 1, 2],
      incomingSafeLanes: [3],
    }),
    false,
  );
});

test("a new attack waits for its lane and an escape lane to clear", () => {
  const activePurchasedAttacks = [
    { lane: 0, y: 40, safeLanes: [4] },
  ];
  assert.equal(
    canReleasePurchasedAttack({
      activePurchasedAttacks,
      occupiedLanes: [0, 1],
      incomingLanes: [1],
      incomingSafeLanes: [3],
    }),
    false,
  );
  assert.equal(
    canReleasePurchasedAttack({
      activePurchasedAttacks,
      occupiedLanes: [0, 3],
      incomingLanes: [1],
      incomingSafeLanes: [3],
    }),
    false,
  );
  assert.equal(
    canReleasePurchasedAttack({
      activePurchasedAttacks,
      occupiedLanes: [0],
      incomingLanes: [1],
      incomingSafeLanes: [],
    }),
    false,
  );
});
