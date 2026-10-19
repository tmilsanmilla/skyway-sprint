import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { cumulativeXpForLevel, xpRequiredForLevel, levelForLifetimeXp, endlessScoreXp, endlessGemXp, endlessRunXp, endlessCharacter, MODE_UNLOCKS, isOlderProgression, PROGRESSION_VERSION } from "./progression-rules.ts";
test("level costs floor 400 + 60*l^1.1 and sum exact per-level requirements", () => {
  let total = 0;
  for (let level = 0; level < 10000; level++) {
    assert.equal(xpRequiredForLevel(level), Math.floor(400 + 60 * level ** 1.1));
    assert.equal(cumulativeXpForLevel(level), total);
    assert.equal(levelForLifetimeXp(total), level);
    if (level) assert.equal(levelForLifetimeXp(total - 1), level - 1);
    total += xpRequiredForLevel(level);
  }
  assert.equal(xpRequiredForLevel(0), 400); assert.equal(xpRequiredForLevel(10), 1155);
  assert.equal(levelForLifetimeXp(-10), 0);
});
test("Endless XP uses 1200/2.1 and only physical pickups add 10 each", () => {
  for (const score of [0, 1, 1200, 8000, 100000, 50000000]) assert.equal(endlessScoreXp(score), Math.floor((score / 1200) ** 2.1));
  assert.equal(endlessScoreXp(-1), 0); assert.equal(endlessScoreXp(NaN), 0);
  assert.deepEqual([0, 1, 5, 25, NaN].map(endlessGemXp), [10, 10, 10, 10, 10]);
  assert.equal(endlessRunXp(1200, 3), 31); assert.equal(endlessRunXp(1200, -2), 1);
});
test("new mode thresholds and fees are independent", () => {
  assert.deepEqual(MODE_UNLOCKS, { casual: { level: 5, gems: 0 }, rotating: { level: 15, gems: 0 }, photon: { level: 25, gems: 225 }, ranked: { level: 35, gems: 235 }, unlimited: { level: 45, gems: 0 } });
});
test("Hardcore forces Ace without disturbing Normal", () => {
  assert.equal(endlessCharacter("hardcore", "medic_seraph"), "runner_ace"); assert.equal(endlessCharacter("normal", "medic_seraph"), "medic_seraph");
});
test("reset versions allow authorized reset but reject stale and reordered responses", () => {
  assert.equal(PROGRESSION_VERSION, 20261017);
  const reset = { progression_version: PROGRESSION_VERSION, lifetime_xp: 0 };
  assert.equal(isOlderProgression({ progression_version: 0, lifetime_xp: 9000000 }, reset), false);
  assert.equal(isOlderProgression(reset, { progression_version: 0, lifetime_xp: 9000000 }), true);
  assert.equal(isOlderProgression({ ...reset, lifetime_xp: 200 }, reset), true);
});
test("new SQL reset is once-only and preserves mode entitlements and receipts", () => {
  const sql = readFileSync(new URL("../neon/update-2-3-economy.sql", import.meta.url), "utf8");
  assert.match(sql, /progression_resets where version=20261017/); assert.match(sql, /mode_unlock_entitlements/);
  assert.match(sql, /level=0,xp_in_level=0,lifetime_xp=0/);
  assert.match(sql, /power\(greatest\(p_score,0\)::numeric\/1200,2\.1\)/);
  assert.doesNotMatch(sql, /delete from public\.player_unlocks|truncate|vacuum full|drop table|set total_gems=0|set high_score=0/i);
});
