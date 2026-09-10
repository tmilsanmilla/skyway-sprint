import assert from "node:assert/strict";
import test from "node:test";

import {
  getEffectiveCharacterTestMode,
  getEffectiveOneVOneMode,
  isAdminTestModeActive,
  isCharacterAvailable,
  isRankedAvailable,
  latchRunTestMode,
} from "./admin-test-mode-rules.ts";

const regularPlayer = { isAdmin: false, testModeEnabled: false };
const spoofedRegularPlayer = { isAdmin: false, testModeEnabled: true };
const adminWithTestOff = { isAdmin: true, testModeEnabled: false };
const adminWithTestOn = { isAdmin: true, testModeEnabled: true };

test("Test Mode activates only for an admin with the saved setting enabled", () => {
  assert.equal(isAdminTestModeActive(regularPlayer), false);
  assert.equal(isAdminTestModeActive(spoofedRegularPlayer), false);
  assert.equal(isAdminTestModeActive(adminWithTestOff), false);
  assert.equal(isAdminTestModeActive(adminWithTestOn), true);
});

test("owned characters remain available to everyone", () => {
  assert.equal(isCharacterAvailable(true, regularPlayer), true);
  assert.equal(isCharacterAvailable(true, adminWithTestOff), true);
  assert.equal(isCharacterAvailable(true, adminWithTestOn), true);
});

test("locked characters require active admin Test Mode", () => {
  assert.equal(isCharacterAvailable(false, regularPlayer), false);
  assert.equal(isCharacterAvailable(false, spoofedRegularPlayer), false);
  assert.equal(isCharacterAvailable(false, adminWithTestOff), false);
  assert.equal(isCharacterAvailable(false, adminWithTestOn), true);
});

test("main admins and co-admins can share the same generic admin policy", () => {
  const mainAdmin = { isAdmin: true, testModeEnabled: true };
  const coAdmin = { isAdmin: true, testModeEnabled: true };

  assert.equal(isCharacterAvailable(false, mainAdmin), true);
  assert.equal(isCharacterAvailable(false, coAdmin), true);
  assert.equal(getEffectiveOneVOneMode("ranked", mainAdmin), "casual");
  assert.equal(getEffectiveOneVOneMode("ranked", coAdmin), "casual");
});

test("Ranked requires its normal unlock and inactive Test Mode", () => {
  assert.equal(isRankedAvailable(false, regularPlayer), false);
  assert.equal(isRankedAvailable(true, regularPlayer), true);
  assert.equal(isRankedAvailable(true, adminWithTestOff), true);
  assert.equal(isRankedAvailable(true, adminWithTestOn), false);
  assert.equal(isRankedAvailable(true, spoofedRegularPlayer), true);
});

test("active admin Test Mode forces every 1v1 request to Casual", () => {
  assert.equal(getEffectiveOneVOneMode("ranked", adminWithTestOn), "casual");
  assert.equal(getEffectiveOneVOneMode("casual", adminWithTestOn), "casual");
  assert.equal(getEffectiveOneVOneMode("ranked", adminWithTestOff), "ranked");
  assert.equal(getEffectiveOneVOneMode("ranked", spoofedRegularPlayer), "ranked");
});

test("a run latches Test Mode and never becomes ranked again mid-run", () => {
  assert.equal(latchRunTestMode(false, adminWithTestOn), true);
  assert.equal(latchRunTestMode(true, adminWithTestOff), true);
  assert.equal(latchRunTestMode(true, regularPlayer), true);
  assert.equal(latchRunTestMode(false, adminWithTestOff), false);
  assert.equal(latchRunTestMode(false, spoofedRegularPlayer), false);
});

test("character access uses the run snapshot instead of mid-run setting changes", () => {
  assert.equal(
    getEffectiveCharacterTestMode(true, false, adminWithTestOn),
    false,
  );
  assert.equal(
    getEffectiveCharacterTestMode(true, true, adminWithTestOff),
    true,
  );
  assert.equal(
    getEffectiveCharacterTestMode(false, false, adminWithTestOn),
    true,
  );
  assert.equal(
    getEffectiveCharacterTestMode(true, true, spoofedRegularPlayer),
    false,
  );
});
