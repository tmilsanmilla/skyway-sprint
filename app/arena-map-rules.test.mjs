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
  getAttackPointsForCoin,
  getWaveAttackPointRewards,
  applyMapHealthModifiers,
  canPurchaseAttack,
  countPriorAttackPurchases,
  getFrozenTurnDelaySeconds,
  chooseRuinsCharacterBans,
  resolveRuinsPumpkin,
  getAllowedHealing,
  planBotAttackPurchases,
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
      car: ATTACK_POINT_COSTS.car,
    },
    { snowflake: 11, log: 13, spike: 14, rock: 15, barrel: 13, current: 13, car: 14 },
  );
  assert.equal(CURRENT_RULES.attackPointCost, ATTACK_POINT_COSTS.current);
  assert.ok(ATTACK_IDS.includes("car"));
  assert.ok(MAP_RULES.factory.naturalObstacleWeights.car > 0);

  for (const mapId of MAP_IDS) {
    const available = getAvailableAttacks(mapId);
    assert.equal(available.includes("current"), mapId === "skyway");
    assert.equal(available.includes("car"), mapId !== "terminal");
    assert.equal(available.includes("barrel"), !["terminal", "skyway", "volcano"].includes(mapId));
    assert.equal(available.includes("snowflake"), ["classic", "desert", "skyway", "pitch", "grove", "meadow"].includes(mapId));
    for (const kind of ["log", "spike", "rock"]) assert.equal(available.includes(kind), mapId !== "terminal");
    assert.equal(getAttackPointCost(mapId, "current"), mapId === "skyway" ? 13 : null);
    assert.equal(getAttackPointCost(mapId, "car"), mapId === "terminal" ? null : 14);
  }
  assert.deepEqual(getAvailableAttacks("terminal"), []);
  assert.equal(getAttackPointCost("skyway", "snowflake"), 12);
  assert.equal(getAttackPointCost("meadow", "snowflake"), 11, "formula overrides inconsistent worked example");
  const counts = { rock: 1, barrel: 2, snowflake: 6 };
  assert.equal(countPriorAttackPurchases(counts), 9);
  for (const kind of getAvailableAttacks("meadow"))
    assert.equal(getAttackPointCost("meadow", kind, 9), ATTACK_POINT_COSTS[kind] + 18);
  for (const kind of ATTACK_IDS) assert.equal(canPurchaseAttack("classic", kind, { [kind]: 4 }), kind === "snowflake");
  assert.equal(canPurchaseAttack("classic", "snowflake", { snowflake: 1000 }), true);
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
    ruins: [1, 2],
    desert: [1, 2, 3, 4, 5],
    skyway: [1, 2, 3, 4],
    pitch: [1, 2, 3, 4],
    volcano: [1, 2, 3, 4, 5],
    factory: [1, 2],
    grove: [1, 2, 3],
    meadow: [1, 2, 3, 4],
    terminal: [1, 2, 3],
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
  assert.deepEqual(resolveCurrentInteraction("grove", 4, 1), {
    kind: "none",
    damage: 0,
    nextLane: 4,
  });
  assert.deepEqual(resolveCurrentInteraction("ruins", 1, 2), {
    kind: "push",
    damage: 0,
    nextLane: 0,
  });
  assert.throws(() => resolveCurrentInteraction("ruins", 1, 0), /allowed lanes/);
});

test("healing-disabled maps reject Medics without excluding useful Medics", () => {
  for (const mapId of MAP_IDS) {
    if (MAP_RULES[mapId].health.healingMultiplier <= 0) {
      assert.equal(isCharacterClassAllowed(mapId, "medic"), false);
    }
  }
  assert.equal(isCharacterClassAllowed("desert", "medic"), false);
  assert.equal(isCharacterClassAllowed("ruins", "medic"), false);
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

test("Map Refresh exact hazard distributions and lane counts", () => {
  const expected = {
    classic: [5, { barrel: 20, log: 25, spike: 25, snowflake: 5, rock: 25 }],
    desert: [7, { barrel: 30, log: 5, spike: 20, snowflake: 10, rock: 35 }],
    pitch: [6, { barrel: 15, log: 25, spike: 25, snowflake: 10, rock: 25 }],
    factory: [4, { barrel: 25, spike: 40, car: 35 }],
    meadow: [6, { barrel: 15, log: 30, snowflake: 15, rock: 25, vortex: 15 }],
    ruins: [4, { barrel: 40, log: 10, spike: 20, rock: 30 }],
    skyway: [6, { barrel: 20, spike: 10, snowflake: 20, rock: 5, car: 25, current: 20 }],
    volcano: [7, { log: 25, spike: 10, rock: 50, car: 5, vortex: 10 }],
    grove: [5, { barrel: 10, log: 50, spike: 20, snowflake: 5, rock: 15 }],
    terminal: [5, { barrel: 30, spike: 40, rock: 5, car: 25 }],
  };
  assert.ok(!MAP_IDS.includes("alley"));
  assert.ok(!MAP_IDS.includes("unknown"), "Unfinished Unknown stays unavailable");
  for (const [id, [lanes, weights]] of Object.entries(expected)) {
    assert.equal(MAP_RULES[id].laneCount, lanes);
    assert.deepEqual(MAP_RULES[id].naturalObstacleWeights, weights);
    assert.equal(getFrozenTurnDelaySeconds(id), id === "skyway" ? 0.3 : 0.25);
  }
  assert.equal(MAP_RULES.factory.totalObstacleMultiplier, 0.88, "10% more than its previous 4/5-lane density");
  assert.deepEqual(applyMapHealthModifiers("ruins", 3, 5), { startingHp: 2, maxHp: 4 });
  assert.equal(getAttackPointsForCoin("meadow"), 3);
  assert.equal(getAttackPointsForCoin("meadow", true), 7);
  assert.deepEqual(getWaveAttackPointRewards("meadow"), [4, 4]);
  assert.deepEqual(getWaveAttackPointRewards("ruins"), [7, 7]);
  assert.equal(getAttackPointsForCoin("ruins"), 7);
  assert.deepEqual(getWaveAttackPointRewards("terminal"), [0, 0]);
  assert.equal(getAttackPointsForCoin("terminal"), 0);
});

test("Ruins bans are uniform without replacement, exclude starters/healers/mythics, and pumpkins reset", () => {
  const eligible = Array.from({ length: 16 }, (_, i) => ({ key: `runner_${i}`, class: "runner", rarity: "rare" }));
  const excluded = [
    { key: "runner_ace", class: "runner", rarity: "common" },
    { key: "tank_bulwark", class: "tank", rarity: "common" },
    { key: "trickster_rogue", class: "trickster", rarity: "common" },
    { key: "medic_patch", class: "medic", rarity: "common" },
    { key: "medic_other", class: "medic", rarity: "rare" },
    { key: "tank_mythic", class: "tank", rarity: "mythic" },
  ];
  const first = chooseRuinsCharacterBans([...excluded, ...eligible], () => 0);
  assert.deepEqual(first, eligible.slice(0, 10).map(c => c.key));
  assert.equal(new Set(first).size, 10);
  const last = chooseRuinsCharacterBans([...excluded, ...eligible], () => 0.999999);
  assert.deepEqual(last, eligible.slice(-10).reverse().map(c => c.key));
  assert.throws(() => chooseRuinsCharacterBans(eligible.slice(0, 9)), /at least ten/);
  assert.deepEqual(resolveRuinsPumpkin(0, false), { missed: 1, eliminated: false });
  assert.deepEqual(resolveRuinsPumpkin(1, false), { missed: 2, eliminated: false });
  assert.deepEqual(resolveRuinsPumpkin(2, false), { missed: 3, eliminated: true });
  assert.deepEqual(resolveRuinsPumpkin(2, true), { missed: 0, eliminated: false });
});

test("Terminal client healing and practice bot armory follow the same server map rules", () => {
  assert.equal(getAllowedHealing("terminal", 1), 0.5);
  assert.equal(getAllowedHealing("classic", 1), 1);
  assert.equal(getAllowedHealing("desert", 1), 0);
  const capped = planBotAttackPurchases("classic", 1000, 6, () => 0);
  assert.deepEqual(capped.attacks, ["log", "log", "log", "log", "barrel", "barrel"]);
  assert.equal(capped.remainingBudget, 1000 - (13 + 15 + 17 + 19 + 21 + 23));
  assert.equal(capped.counts.log, 4);
  const snowflakes = planBotAttackPurchases("classic", 1000, 6, () => 2.5 / 6);
  assert.deepEqual(snowflakes.attacks, Array(6).fill("snowflake"));
  assert.equal(snowflakes.remainingBudget, 1000 - (11 + 13 + 15 + 17 + 19 + 21));
  assert.deepEqual(planBotAttackPurchases("terminal", 1000, 6).attacks, []);
  assert.deepEqual(planBotAttackPurchases("skyway", 11, 6).attacks, []);
  assert.deepEqual(planBotAttackPurchases("classic", 11, 6).attacks, ["snowflake"]);
});
