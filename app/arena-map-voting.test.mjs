import assert from "node:assert/strict";
import test from "node:test";

import {
  MAP_VOTE_COUNT,
  isValidMapVotes,
  selectOneVersusOneMapDetailed,
} from "./arena-map-rules.ts";

test("each player votes for exactly two distinct valid maps", () => {
  assert.equal(MAP_VOTE_COUNT, 2);
  assert.equal(isValidMapVotes(["classic", "alley"]), true);
  assert.equal(isValidMapVotes(["classic"]), false);
  assert.equal(isValidMapVotes(["classic", "classic"]), false);
  assert.equal(isValidMapVotes(["classic", "not-a-map"]), false);
});

test("one shared vote always selects that shared map", () => {
  const result = selectOneVersusOneMapDetailed({
    playerOneVotes: ["classic", "alley"],
    playerTwoVotes: ["alley", "pitch"],
    random: () => 0.99,
  });
  assert.equal(result.mapId, "alley");
  assert.equal(result.reason, "shared-vote");
  assert.deepEqual(result.candidates, ["alley"]);
});

test("identical two-map votes choose randomly between the shared pair", () => {
  const first = selectOneVersusOneMapDetailed({
    playerOneVotes: ["alley", "pitch"],
    playerTwoVotes: ["pitch", "alley"],
    random: () => 0,
  });
  const second = selectOneVersusOneMapDetailed({
    playerOneVotes: ["alley", "pitch"],
    playerTwoVotes: ["pitch", "alley"],
    random: () => 0.999,
  });
  assert.equal(first.mapId, "alley");
  assert.equal(second.mapId, "pitch");
  assert.equal(first.reason, "shared-pair-random");
});

test("non-overlapping votes choose randomly from all four picks", () => {
  const first = selectOneVersusOneMapDetailed({
    playerOneVotes: ["classic", "alley"],
    playerTwoVotes: ["pitch", "grove"],
    random: () => 0,
  });
  const fourth = selectOneVersusOneMapDetailed({
    playerOneVotes: ["classic", "alley"],
    playerTwoVotes: ["pitch", "grove"],
    random: () => 0.999,
  });
  assert.equal(first.mapId, "classic");
  assert.equal(fourth.mapId, "grove");
  assert.equal(first.reason, "no-overlap-random");
  assert.deepEqual(first.candidates, ["classic", "alley", "pitch", "grove"]);
});
