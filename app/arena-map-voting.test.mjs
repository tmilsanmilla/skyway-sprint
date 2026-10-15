import assert from "node:assert/strict";
import test from "node:test";

import {
  MAP_VOTE_COUNT,
  isValidMapVotes,
  selectOneVersusOneMapDetailed,
} from "./arena-map-rules.ts";

test("each player votes for exactly two distinct valid maps", () => {
  assert.equal(MAP_VOTE_COUNT, 2);
  assert.equal(isValidMapVotes(["classic", "ruins"]), true);
  assert.equal(isValidMapVotes(["classic"]), false);
  assert.equal(isValidMapVotes(["classic", "classic"]), false);
  assert.equal(isValidMapVotes(["classic", "not-a-map"]), false);
});

test("one shared vote always selects that shared map", () => {
  const result = selectOneVersusOneMapDetailed({
    playerOneVotes: ["classic", "ruins"],
    playerTwoVotes: ["ruins", "pitch"],
    random: () => 0.99,
  });
  assert.equal(result.mapId, "ruins");
  assert.equal(result.reason, "shared-vote");
  assert.deepEqual(result.candidates, ["ruins"]);
});

test("identical two-map votes choose randomly between the shared pair", () => {
  const first = selectOneVersusOneMapDetailed({
    playerOneVotes: ["ruins", "pitch"],
    playerTwoVotes: ["pitch", "ruins"],
    random: () => 0,
  });
  const second = selectOneVersusOneMapDetailed({
    playerOneVotes: ["ruins", "pitch"],
    playerTwoVotes: ["pitch", "ruins"],
    random: () => 0.999,
  });
  assert.equal(first.mapId, "ruins");
  assert.equal(second.mapId, "pitch");
  assert.equal(first.reason, "shared-pair-random");
});

test("non-overlapping votes choose randomly from all four picks", () => {
  const first = selectOneVersusOneMapDetailed({
    playerOneVotes: ["classic", "ruins"],
    playerTwoVotes: ["pitch", "grove"],
    random: () => 0,
  });
  const fourth = selectOneVersusOneMapDetailed({
    playerOneVotes: ["classic", "ruins"],
    playerTwoVotes: ["pitch", "grove"],
    random: () => 0.999,
  });
  assert.equal(first.mapId, "classic");
  assert.equal(fourth.mapId, "grove");
  assert.equal(first.reason, "no-overlap-random");
  assert.deepEqual(first.candidates, ["classic", "ruins", "pitch", "grove"]);
});
