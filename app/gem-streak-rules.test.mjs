import assert from "node:assert/strict";
import test from "node:test";

import {
  GEM_STREAK_SATURATION_PICKUPS,
  INITIAL_GEM_STREAK_STATE,
  advanceGemStreak,
  getGemStreakMultiplier,
  resetGemStreak,
} from "./gem-streak-rules.ts";

const collect = (startingState, pickupCount) => {
  let state = startingState;
  const results = [];
  for (let pickup = 0; pickup < pickupCount; pickup += 1) {
    const result = advanceGemStreak(state);
    state = result.state;
    results.push(result);
  }
  return { state, results };
};

test("gem rewards climb to x5, hold for five pickups, then reach x6 and x7", () => {
  const { results } = collect(INITIAL_GEM_STREAK_STATE, 12);
  assert.deepEqual(
    results.map(({ gemsAwarded }) => gemsAwarded),
    [1, 2, 3, 4, 5, 5, 5, 5, 5, 5, 6, 7],
  );
  assert.equal(results[5].notice, "GEM STREAK ×5 · +5 GEMS");
  assert.equal(results[10].notice, "GEM STREAK ×6 · +6 GEMS");
  assert.equal(results[11].notice, "GEM STREAK ×7 · +7 GEMS");
});

test("gem rewards and chain state stay capped at x7", () => {
  const { state, results } = collect(INITIAL_GEM_STREAK_STATE, 30);
  assert.equal(state.consecutivePickups, GEM_STREAK_SATURATION_PICKUPS);
  assert.deepEqual(
    results.slice(11).map(({ multiplier }) => multiplier),
    Array(19).fill(7),
  );
});

test("damage reset cleanly starts the next gem back at x1", () => {
  const beforeDamage = collect(INITIAL_GEM_STREAK_STATE, 10);
  assert.equal(beforeDamage.results.at(-1)?.multiplier, 5);

  const resetState = resetGemStreak(beforeDamage.state);
  assert.deepEqual(resetState, INITIAL_GEM_STREAK_STATE);
  assert.notEqual(resetState, beforeDamage.state);

  const afterDamage = advanceGemStreak(resetState);
  assert.equal(afterDamage.multiplier, 1);
  assert.equal(afterDamage.gemsAwarded, 1);
});

test("streak multiplier safely normalizes persisted or invalid counts", () => {
  assert.equal(getGemStreakMultiplier(-50), 0);
  assert.equal(getGemStreakMultiplier(Number.NaN), 0);
  assert.equal(getGemStreakMultiplier(4.9), 4);
  assert.equal(getGemStreakMultiplier(500), 7);
});
