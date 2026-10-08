import assert from "node:assert/strict";
import test from "node:test";
import { isAdminTestModeActive, isCharacterAvailable, isRankedAvailable, getEffectiveOneVOneMode, getEffectiveCharacterTestMode, latchRunTestMode } from "./admin-test-mode-rules.ts";
test("retired Test Mode never grants characters, even to admins with a stale saved toggle", () => {
  for (const isAdmin of [true, false]) for (const testModeEnabled of [true, false]) {
    const context = { isAdmin, testModeEnabled };
    assert.equal(isAdminTestModeActive(context), false);
    assert.equal(isCharacterAvailable(false, context), false);
    assert.equal(isCharacterAvailable(true, context), true);
    assert.equal(getEffectiveCharacterTestMode(true, true, context), false);
    assert.equal(isRankedAvailable(true, context), true);
    assert.equal(isRankedAvailable(false, context), false);
    for (const mode of ["casual", "ranked", "rng", "hardcore_duel"]) assert.equal(getEffectiveOneVOneMode(mode, context), mode);
    assert.equal(latchRunTestMode(false, context), false);
    assert.equal(latchRunTestMode(true, context), true);
  }
});
