import assert from "node:assert/strict";
import test from "node:test";
import { gambitHand, gambitRevival, rerollGambit, freshEuchreDeck, takeWildcard, wildcardChoiceCount, MATH_NUMBERS, createProdigyQuestion, appendImaginationColors, matchImaginationInput, cartographyAccuracy, nextConicShape, conicShapePath, throwBowlingBall } from "./overhaul-challenges.ts";

test("all 262144 Gambit rolls preserve the specified ranking and achievable revive bounds", () => {
  const counts = Array(12).fill(0); let min = Infinity, max = -Infinity;
  for (let encoded = 0; encoded < 8 ** 6; encoded += 1) {
    let value = encoded; const dice = [];
    for (let n = 0; n < 6; n += 1) { dice.push(1 + value % 8); value = Math.floor(value / 8); }
    const result = gambitRevival(dice); counts[result.hand] += 1;
    if (result.hp) { min = Math.min(min, result.percent); max = Math.max(max, result.percent); }
  }
  assert.equal(counts.reduce((a, b) => a + b), 262144);
  assert.equal(counts[11], 8); assert.equal(counts[10], 336); assert.equal(counts[9], 560);
  assert.equal(counts[8], 840); assert.equal(counts[7], 2160); assert.equal(counts[6], 10080);
  assert.equal(min, -32); assert.equal(max, 123);
  assert.equal(gambitHand([1, 1, 2, 2, 3, 3]), gambitHand([1, 1, 1, 1, 2, 3]));
});
test("Gambit changes only selected dice and never adds a fourth reroll", () => {
  assert.deepEqual(rerollGambit([1, 2, 3, 4, 5, 6], [1, 4], 2, () => 0.999), [1, 8, 3, 4, 8, 6]);
  assert.throws(() => rerollGambit([1, 2, 3, 4, 5, 6], [1], 3, Math.random));
  assert.throws(() => gambitHand([0, 1, 2, 3, 4, 5]));
});
test("Wildcard has exactly 24 unique cards and red-Ace chains consume cards once", () => {
  assert.equal(new Set(freshEuchreDeck(() => 0.5)).size, 24);
  const result = takeWildcard(["AH", "AD", "9S", "KS"], 0, () => 0.999);
  assert.deepEqual(result.discarded, ["AH", "AD"]); assert.deepEqual(result.drawn, ["9S", "KS"]); assert.deepEqual(result.deck, []);
  assert.deepEqual([24, 11, 10, 5, 4, 1, 0].map(wildcardChoiceCount), [3, 3, 2, 2, 1, 1, 0]);
  assert.throws(() => takeWildcard(["9H", "9D", "9C", "9S"], 1, Math.random));
});
test("Prodigy samples exactly the 1891 unordered distinct valid problems", () => {
  assert.equal(MATH_NUMBERS.length, 62); const questions = new Set();
  for (let a = 0; a < 62; a += 1) for (let b = 0; b < 61; b += 1) {
    let i = 0; const draws = [(a + 0.1) / 62, (b + 0.1) / 61]; const q = createProdigyQuestion(() => draws[i++]);
    assert.notEqual(q.a, q.b); assert.notEqual(q.a % 5, 0); assert.notEqual(q.b % 5, 0);
    assert.equal(Number(q.answer), q.a + q.b); questions.add([q.a, q.b].sort((x, y) => x - y).join("+"));
  }
  assert.equal(questions.size, 1891);
});
test("Imagination appends two colors and rejects a wrong prefix immediately", () => {
  const sequence = appendImaginationColors([2, 4], () => 0);
  assert.deepEqual(sequence, [2, 4, 1, 1]); assert.equal(matchImaginationInput(sequence, [2]), "continue");
  assert.equal(matchImaginationInput(sequence, [2, 4, 1, 1]), "complete"); assert.equal(matchImaginationInput(sequence, [2, 3]), "wrong");
});
test("Cartographer ignores drawing scale and position without awarding an empty drawing", () => {
  const outline = [[0, 0], [4, 0], [4, 2], [1, 3], [0, 1]];
  assert.ok(cartographyAccuracy(outline.map(([x, y]) => [x * 4 + 80, y * 4 - 70]), outline) > 0.999);
  assert.equal(cartographyAccuracy([], outline), 0);
  assert.equal(cartographyAccuracy([[1, 1], [1, 1], [1, 1]], outline), 0);
});
test("every Conic has a finite visible contour and the next shape cannot repeat", () => {
  for (let prior = 0; prior < 10; prior += 1) {
    const path = conicShapePath(prior); assert.ok(path.length > 30); assert.doesNotMatch(path, /NaN|Infinity/);
    const choices = new Set(Array.from({ length: 9 }, (_, i) => nextConicShape(prior, () => (i + 0.1) / 9)));
    assert.equal(choices.size, 9); assert.equal(choices.has(prior), false);
  }
});
test("Bowling awards only standing pins; a pocket strike is possible", () => {
  const pins = Array(10).fill(true), strike = throwBowlingBall(pins, 0.12);
  assert.equal(strike.points, 10); assert.equal(strike.standing.some(Boolean), false);
  assert.equal(throwBowlingBall(strike.standing, 0.12).points, 0);
  assert.equal(throwBowlingBall(pins, 1).points, 0);
});
