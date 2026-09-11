import assert from "node:assert/strict";
import test from "node:test";

import {
  ATTACK_IDS,
  ATTACK_POINT_COSTS,
  CURRENT_RULES,
  MAP_IDS,
  MAP_RULES,
  chooseCurrentLane,
  getAttackPointCost,
  getAvailableAttacks,
  getCurrentAllowedLaneIndexes,
  isCharacterClassAllowed,
  isHealerAllowedByHealthRules,
  isCurrentLaneAllowed,
  resolveCurrentInteraction,
  validateArenaMapRules,
} from "./arena-map-rules.ts";

test("armory prices and map inventories match the shared 1v1 catalog", () => {
  assert.deepEqual(
    {
      snowflake: ATTACK_POINT_COSTS.snowflake,
      log: ATTACK_POINT_COSTS.log,
      spike: ATTACK_POINT_COSTS.spike,
      rock: ATTACK_POINT_COSTS.rock,
      barrel: ATTACK_POINT_COSTS.barrel,
      current: ATTACK_POINT_COSTS.current,
    },
    { snowflake: 4, log: 4, spike: 5, rock: 5, barrel: 6, current: 8 },
  );
  assert.equal(CURRENT_RULES.attackPointCost, ATTACK_POINT_COSTS.current);
  assert.ok(ATTACK_IDS.includes("car"), "legacy car payloads remain supported");
  assert.equal("car" in ATTACK_POINT_COSTS, false, "Car has no armory price");
  assert.ok(MAP_RULES.factory.naturalObstacleWeights.car > 0);

  for (const mapId of MAP_IDS) {
    const available = getAvailableAttacks(mapId);
    assert.ok(available.includes("current"), `${mapId} offers Current`);
    assert.ok(!available.includes("car"), `${mapId} does not sell Car`);
    assert.equal(getAttackPointCost(mapId, "current"), 8);
    assert.equal(getAttackPointCost(mapId, "car"), null);
  }
});

test("Current remains a natural obstacle only on Skyway", () => {
  for (const mapId of MAP_IDS) {
    const naturalWeight = MAP_RULES[mapId].naturalObstacleWeights.current ?? 0;
    assert.equal(naturalWeight > 0, mapId === "skyway");
  }
  assert.equal(
    MAP_RULES.skyway.naturalObstacleWeights.current,
    CURRENT_RULES.naturalSpawnWeight,
  );
});

test("Current lane selection is safe and map-aware", () => {
  const expectedLanes = {
    classic: [1, 2, 3],
    alley: [0, 2],
    desert: [1, 2, 3, 4, 5],
    skyway: [1, 2, 3, 4],
    pitch: [1, 2, 3, 4],
    volcano: [1, 2, 3, 4, 5],
    factory: [1, 2],
    grove: [1, 2, 3, 4],
  };

  for (const mapId of MAP_IDS) {
    const lanes = getCurrentAllowedLaneIndexes(mapId);
    assert.deepEqual(lanes, expectedLanes[mapId]);
    assert.equal(chooseCurrentLane(mapId, () => 0), lanes[0]);
    assert.equal(chooseCurrentLane(mapId, () => 0.999), lanes.at(-1));
    for (let lane = 0; lane < MAP_RULES[mapId].laneCount; lane += 1) {
      assert.equal(isCurrentLaneAllowed(mapId, lane), lanes.includes(lane));
    }
    assert.deepEqual(resolveCurrentInteraction(mapId, lanes[0], lanes[0]), {
      kind: "direct-hit",
      damage: 0.5,
      nextLane: lanes[0],
    });
  }
  assert.deepEqual(
    getCurrentAllowedLaneIndexes("skyway"),
    [...CURRENT_RULES.allowedLaneIndexes],
  );
});

test("Current collision behavior works across map lane counts", () => {
  assert.deepEqual(resolveCurrentInteraction("classic", 2, 2), {
    kind: "direct-hit",
    damage: 0.5,
    nextLane: 2,
  });
  assert.deepEqual(resolveCurrentInteraction("factory", 2, 1), {
    kind: "push",
    damage: 0,
    nextLane: 3,
  });
  assert.deepEqual(resolveCurrentInteraction("desert", 0, 1), {
    kind: "edge-adjacent-hit",
    damage: 1,
    nextLane: 0,
  });
  assert.deepEqual(resolveCurrentInteraction("grove", 5, 1), {
    kind: "none",
    damage: 0,
    nextLane: 5,
  });
  assert.deepEqual(resolveCurrentInteraction("alley", 1, 0), {
    kind: "push",
    damage: 0,
    nextLane: 2,
  });
  assert.throws(() => resolveCurrentInteraction("alley", 1, 1), /allowed lanes/);
});

test("healing-disabled maps reject Medics without excluding useful Medics", () => {
  for (const mapId of MAP_IDS) {
    if (MAP_RULES[mapId].health.healingMultiplier <= 0) {
      assert.equal(isCharacterClassAllowed(mapId, "medic"), false);
    }
  }
  assert.equal(isCharacterClassAllowed("desert", "medic"), false);
  assert.equal(isCharacterClassAllowed("alley", "medic"), true);
  assert.equal(isCharacterClassAllowed("grove", "medic"), true);
  assert.equal(
    isHealerAllowedByHealthRules({
      ...MAP_RULES.classic.health,
      healingCap: 1,
    }),
    false,
  );
  assert.equal(
    isHealerAllowedByHealthRules({
      ...MAP_RULES.classic.health,
      healingCap: 1.5,
    }),
    true,
  );
  assert.deepEqual(validateArenaMapRules(), []);
});
