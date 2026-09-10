import assert from "node:assert/strict";
import test from "node:test";

import { resolveMobileLaneIntent } from "./mobile-lane-controls.ts";

const base = {
  startX: 250,
  startY: 300,
  endX: 250,
  endY: 300,
  roadLeft: 0,
  roadWidth: 500,
  laneCount: 5,
  currentLane: 2,
};

test("a swipe always moves exactly one lane in its horizontal direction", () => {
  assert.equal(
    resolveMobileLaneIntent({ ...base, endX: 20, endY: 304 }),
    -1,
  );
  assert.equal(
    resolveMobileLaneIntent({ ...base, endX: 490, endY: 296 }),
    1,
  );
});

test("short, vertical, and diagonal drags do not move the runner", () => {
  assert.equal(resolveMobileLaneIntent({ ...base, endX: 273 }), 0);
  assert.equal(resolveMobileLaneIntent({ ...base, endX: 255, endY: 360 }), 0);
  assert.equal(resolveMobileLaneIntent({ ...base, endX: 285, endY: 335 }), 0);
});

test("a tap moves one lane toward its target and does nothing on the current lane", () => {
  assert.equal(
    resolveMobileLaneIntent({ ...base, startX: 40, endX: 40 }),
    -1,
  );
  assert.equal(
    resolveMobileLaneIntent({ ...base, startX: 460, endX: 460 }),
    1,
  );
  assert.equal(resolveMobileLaneIntent(base), 0);
});

test("tap lane mapping works for four, five, and seven lanes and clamps edges", () => {
  for (const laneCount of [4, 5, 7]) {
    const roadWidth = laneCount * 100;
    const currentLane = Math.floor(laneCount / 2);
    assert.equal(
      resolveMobileLaneIntent({
        ...base,
        startX: -20,
        endX: -20,
        roadWidth,
        laneCount,
        currentLane,
      }),
      -1,
    );
    assert.equal(
      resolveMobileLaneIntent({
        ...base,
        startX: roadWidth + 20,
        endX: roadWidth + 20,
        roadWidth,
        laneCount,
        currentLane,
      }),
      1,
    );
  }
});
