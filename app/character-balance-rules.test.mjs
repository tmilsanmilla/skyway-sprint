import assert from "node:assert/strict";
import test from "node:test";

import {
  GAMBIT_REWARDS,
  INITIAL_DRIFT_STATE,
  advanceDriftLaneChange,
  applyJesterDamageEffect,
  applyScoreMultiplierToAttackPoints,
  calculateTankDamage,
  canUseCharacterInMatch,
  createStandard52CardDeck,
  createStandard54CardDeck,
  createWildcardDeckState,
  addToBrokerFund,
  canWeaverCreateJacket,
  claimBrokerCoinFund,
  drawWildcardCard,
  evaluateGambitHand,
  generateJesterWaveEffect,
  getAtlasSkyCrushSecondsAfterHits,
  getBastionDamageReduction,
  getCatalystPickupSpeedMultiplier,
  getCitadelOpeningBlocks,
  getClockworkSpeedMultipliers,
  getColossusHazardSpeedMultiplier,
  getColossusRockDamage,
  getColossusWaveEndHearts,
  getCometSendOffer,
  getDisplayedAttackPoints,
  getDisplayedHearts,
  getDriftMultipliers,
  getFortuneGemChanceBonus,
  getFortuneGemSpawnChance,
  getHarvesterAbilities,
  getHarvesterAbility,
  getHarvesterAbilityTier,
  getMuseMixHealPulses,
  getMuseRemainingObstacleSlots,
  getMuseReplayAccuracyRequirement,
  getMuseReward,
  getPickpocketCoinSteal,
  getRampartDamageReduction,
  getRogueActionForGrazes,
  getProspectorGemWarningSchedule,
  getScribeHazardCap,
  getSentinelBarrelSpeedMultiplier,
  getSparkScoreMultiplier,
  getSwitchMilestones,
  getTankMaxHearts,
  getTankScoreMultiplier,
  getWildcardCardEffect,
  isDodgeableLaneGroup,
  mercyPassiveContinues,
  meetsMuseReplayAccuracyRequirement,
  moveBrokerFundForWave,
  moveBrokerFundsForWave,
  partitionDodgeableLaneGroups,
  resolveWeaverSnowflake,
  selectHammerTargets,
  selectSentinelAnalyzedSource,
  settleBrokerFundsOnDeath,
  shuffleCards,
} from "./character-balance-rules.ts";

const closeTo = (actual, expected, epsilon = 1e-10) =>
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `${actual} was not within ${epsilon} of ${expected}`,
  );

test("hidden HUD totals preserve the attached display rules", () => {
  assert.equal(getDisplayedAttackPoints(5.99), 5);
  assert.equal(getDisplayedAttackPoints(-2), 0);
  assert.equal(getDisplayedHearts(0.35), 0.5);
  assert.equal(getDisplayedHearts(0.5), 0.5);
  assert.equal(getDisplayedHearts(1.01), 1.5);
  assert.equal(Object.is(getDisplayedHearts(0), -0), false);
  closeTo(applyScoreMultiplierToAttackPoints(3, 1.15), 3.45);
});

test("ranked rejects mythics without restricting casual or endless", () => {
  assert.equal(canUseCharacterInMatch("mythic", "ranked-1v1"), false);
  assert.equal(canUseCharacterInMatch("mythic", "casual-1v1"), true);
  assert.equal(canUseCharacterInMatch("mythic", "endless"), true);
  assert.equal(canUseCharacterInMatch("legendary", "ranked-1v1"), true);
});

test("Bulwark keeps first-hit plate and then reduces all damage by 20%", () => {
  const hit = calculateTankDamage({
    character: "tank_bulwark",
    source: "rock",
    baseDamage: 2,
    currentHearts: 4,
    bulwarkPlateAvailable: true,
  });
  closeTo(hit.damage, 1.2);
  assert.equal(hit.consumed.bulwarkPlate, true);

  const halfHit = calculateTankDamage({
    character: "tank_bulwark",
    source: "barrel",
    baseDamage: 0.5,
    currentHearts: 4,
    bulwarkPlateAvailable: true,
  });
  closeTo(halfHit.damage, 0.4);
  assert.equal(halfHit.consumed.bulwarkPlate, false);
});

test("Vault blocks the first spike or log and consumes one shared charge", () => {
  for (const source of ["spikes", "log"]) {
    const hit = calculateTankDamage({
      character: "runner_vault",
      source,
      baseDamage: 1,
      currentHearts: 4,
      vaultChargeAvailable: true,
    });
    assert.equal(hit.damage, 0);
    assert.equal(hit.consumed.vaultCharge, true);
  }
});

test("Guard, Brace, Ironclad, Hammer and Warden apply their exact tradeoffs", () => {
  closeTo(
    calculateTankDamage({
      character: "tank_guard",
      source: "car",
      baseDamage: 1,
      currentHearts: 4,
    }).damage,
    0.7,
  );
  assert.equal(getTankScoreMultiplier("tank_guard", 4), 0.9);

  assert.equal(
    calculateTankDamage({
      character: "tank_brace",
      source: "spikes",
      baseDamage: 1,
      currentHearts: 4,
    }).damage,
    0,
  );
  closeTo(
    calculateTankDamage({
      character: "tank_brace",
      source: "rock",
      baseDamage: 2,
      currentHearts: 4,
    }).damage,
    3,
  );
  assert.equal(getTankScoreMultiplier("tank_brace", 4), 1.15);

  assert.equal(
    calculateTankDamage({
      character: "tank_ironclad",
      source: "log",
      baseDamage: 1,
      currentHearts: 4,
    }).damage,
    0,
  );
  closeTo(
    calculateTankDamage({
      character: "tank_hammer",
      source: "rock",
      baseDamage: 2,
      currentHearts: 4,
    }).damage,
    1.8,
  );
  closeTo(
    calculateTankDamage({
      character: "tank_warden",
      source: "car",
      baseDamage: 1,
      currentHearts: 4,
    }).damage,
    0.75,
  );
  assert.equal(
    calculateTankDamage({
      character: "tank_warden",
      source: "spikes",
      baseDamage: 1,
      currentHearts: 4,
      spikeDeactivated: true,
    }).damage,
    0,
  );
});

test("Mercy rerolls only while its passive remains active", () => {
  assert.equal(mercyPassiveContinues(0.249999), true);
  assert.equal(mercyPassiveContinues(0.25), false);
  const continuing = calculateTankDamage({
    character: "medic_mercy",
    source: "rock",
    baseDamage: 2,
    currentHearts: 4,
    mercyPassiveActive: true,
    mercyContinuationRoll: 0.1,
  });
  assert.equal(continuing.damage, 1);
  assert.equal(continuing.mercyPassiveActiveAfterHit, true);
  const stopped = calculateTankDamage({
    character: "medic_mercy",
    source: "car",
    baseDamage: 1,
    currentHearts: 3,
    mercyPassiveActive: true,
    mercyContinuationRoll: 0.8,
  });
  assert.equal(stopped.damage, 0.5);
  assert.equal(stopped.mercyPassiveActiveAfterHit, false);
  const later = calculateTankDamage({
    character: "medic_mercy",
    source: "car",
    baseDamage: 1,
    currentHearts: 2.5,
    mercyPassiveActive: false,
    mercyContinuationRoll: 0,
  });
  assert.equal(later.damage, 1);
  assert.equal(later.consumed.mercyPassive, false);
});

test("Bastion charges per full second, negates at 20, and is consumed by a hit", () => {
  assert.equal(getBastionDamageReduction(0.99), 0);
  assert.equal(getBastionDamageReduction(1), 0.05);
  closeTo(getBastionDamageReduction(19.99), 0.95);
  assert.equal(getBastionDamageReduction(20), 1);
  const hit = calculateTankDamage({
    character: "tank_bastion",
    source: "rock",
    baseDamage: 2,
    currentHearts: 4,
    bastionSecondsInLane: 10,
  });
  assert.equal(hit.damage, 1);
  assert.equal(hit.consumed.bastionCharge, true);
});

test("Rampart reductions switch at exact half-heart thresholds", () => {
  assert.equal(getRampartDamageReduction(2.01), 0);
  assert.equal(getRampartDamageReduction(2), 0.2);
  assert.equal(getRampartDamageReduction(1.5), 0.3);
  assert.equal(getRampartDamageReduction(1), 0.4);
  assert.equal(getRampartDamageReduction(0.5), 0.5);
  closeTo(
    calculateTankDamage({
      character: "tank_rampart",
      source: "car",
      baseDamage: 1,
      currentHearts: 1.5,
    }).damage,
    0.7,
  );
});

test("Citadel clamps opening blocks and consumes one when damage is resolved", () => {
  assert.equal(getCitadelOpeningBlocks(0), 1);
  assert.equal(getCitadelOpeningBlocks(2), 2);
  assert.equal(getCitadelOpeningBlocks(20), 3);
  const hit = calculateTankDamage({
    character: "tank_citadel",
    source: "rock",
    baseDamage: 2,
    currentHearts: 4,
    citadelBlocksRemaining: 2,
  });
  assert.equal(hit.damage, 0);
  assert.equal(hit.consumed.citadelBlock, true);
});

test("Sentinel chooses a stable highest-damage type and applies both defenses", () => {
  assert.equal(
    selectSentinelAnalyzedSource({ rock: 3, car: 5, log: 5 }),
    "car",
  );
  assert.equal(selectSentinelAnalyzedSource({ rock: 0 }), null);
  const first = calculateTankDamage({
    character: "tank_sentinel",
    source: "car",
    baseDamage: 1,
    currentHearts: 4,
    sentinelAnalyzedSource: "car",
    sentinelFirstAnalyzedHitAvailable: true,
  });
  assert.equal(first.damage, 0);
  const next = calculateTankDamage({
    character: "tank_sentinel",
    source: "car",
    baseDamage: 1,
    currentHearts: 4,
    sentinelAnalyzedSource: "car",
    sentinelFirstAnalyzedHitAvailable: false,
  });
  assert.equal(next.damage, 0.25);
  assert.equal(getSentinelBarrelSpeedMultiplier(true), 0.25);
});

test("Colossus thresholds, Titan Maul, healing, score and speed all scale", () => {
  assert.equal(getTankMaxHearts("tank_colossus"), 10);
  assert.equal(getColossusRockDamage(4.5), 2);
  assert.equal(getColossusRockDamage(5), 1.5);
  assert.equal(getColossusRockDamage(7), 1);
  assert.equal(getColossusRockDamage(10), 0);
  closeTo(
    calculateTankDamage({
      character: "tank_colossus",
      source: "rock",
      baseDamage: 2,
      currentHearts: 7,
      titanMaulEquipped: true,
    }).damage,
    0.5,
  );
  closeTo(
    calculateTankDamage({
      character: "tank_colossus",
      source: "car",
      baseDamage: 1,
      currentHearts: 7,
      titanMaulEquipped: true,
    }).damage,
    0.65,
  );
  assert.equal(getColossusWaveEndHearts(7, true), 9);
  assert.equal(getColossusWaveEndHearts(7, false), 7);
  assert.equal(getTankScoreMultiplier("tank_colossus", 10), 1.35);
  assert.equal(getColossusHazardSpeedMultiplier(10), 0.65);
});

test("Hammer selects closest non-rock targets and doubles the sole edge neighbor", () => {
  const obstacles = [
    { id: "current", lane: 0, kind: "car", distanceToPlayer: 4 },
    { id: "rock", lane: 1, kind: "rock", distanceToPlayer: 1 },
    { id: "near", lane: 1, kind: "barrel", distanceToPlayer: 2 },
    { id: "far", lane: 1, kind: "log", distanceToPlayer: 8 },
    { id: "elsewhere", lane: 2, kind: "car", distanceToPlayer: 1 },
  ];
  assert.deepEqual(
    selectHammerTargets(obstacles, 0).map(({ id }) => id),
    ["current", "near", "far"],
  );
});

test("Atlas has seven max HP and Sky Crush loses 0.5s per hit down to 1s", () => {
  assert.equal(getTankMaxHearts("tank_atlas"), 7);
  assert.equal(getAtlasSkyCrushSecondsAfterHits(4, 1), 3.5);
  assert.equal(getAtlasSkyCrushSecondsAfterHits(4, 4), 2);
  assert.equal(getAtlasSkyCrushSecondsAfterHits(1.25, 1), 1);
});

test("Jester selection is deterministic and every neutral percent is 1 through 100", () => {
  const first = generateJesterWaveEffect("run-42", 8);
  assert.deepEqual(first, generateJesterWaveEffect("run-42", 8));
  for (let wave = 1; wave <= 500; wave += 1) {
    const effect = generateJesterWaveEffect("coverage", wave);
    if (effect.kind === "score-and-speed") {
      assert.ok(effect.percent >= 1);
      assert.ok(effect.percent <= 100);
    }
  }
  assert.equal(
    applyJesterDamageEffect(
      { group: "positive", kind: "first-hit-zero" },
      2,
      "rock",
      true,
    ),
    0,
  );
  assert.equal(
    applyJesterDamageEffect(
      { group: "negative", kind: "barrel-double-damage" },
      0.5,
      "barrel",
      false,
    ),
    1,
  );
});

test("Drift stacks within 0.5s, caps at +200%, and resets a broken chain", () => {
  let state = advanceDriftLaneChange(INITIAL_DRIFT_STATE, 1_000);
  assert.equal(state.bonus, 0.15);
  state = advanceDriftLaneChange(state, 1_500);
  assert.equal(state.bonus, 0.3);
  for (let index = 0; index < 30; index += 1)
    state = advanceDriftLaneChange(state, state.lastLaneChangeAtMs + 100);
  assert.equal(state.bonus, 2);
  assert.deepEqual(getDriftMultipliers(state), {
    scoreMultiplier: 3,
    hazardSpeedMultiplier: 3,
  });
  state = advanceDriftLaneChange(state, state.lastLaneChangeAtMs + 501);
  assert.equal(state.bonus, 0.15);
});

test("Clockwork starts at 10% slow and reaches 60% at 100 seconds", () => {
  assert.deepEqual(getClockworkSpeedMultipliers(0), {
    selfHazardSpeedMultiplier: 0.9,
    opponentSentHazardSpeedMultiplier: 1.1,
  });
  assert.deepEqual(getClockworkSpeedMultipliers(100_000), {
    selfHazardSpeedMultiplier: 0.4,
    opponentSentHazardSpeedMultiplier: 1.6,
  });
  assert.deepEqual(getClockworkSpeedMultipliers(999_999), {
    selfHazardSpeedMultiplier: 0.4,
    opponentSentHazardSpeedMultiplier: 1.6,
  });
});

test("Wildcard uses a unique seeded 54-card deck and permanently unlocks Ace + Joker", () => {
  const deck = createStandard54CardDeck();
  assert.equal(deck.length, 54);
  assert.equal(new Set(deck.map(({ id }) => id)).size, 54);
  assert.deepEqual(shuffleCards(deck, "same"), shuffleCards(deck, "same"));
  assert.equal(getWildcardCardEffect(deck.find(({ rank }) => rank === "A")).scoreBonus, 0.6);
  assert.equal(
    getWildcardCardEffect(deck.find(({ rank }) => rank === "JOKER"))
      .ignoredHits,
    5,
  );
  let state = createWildcardDeckState("wild-run");
  let lastDraw;
  for (let draw = 0; draw < 54; draw += 1) {
    lastDraw = drawWildcardCard(state);
    state = lastDraw.state;
  }
  assert.equal(state.permanentAceAndJoker, true);
  assert.equal(state.nextIndex, 0);
  assert.deepEqual(lastDraw.permanentEffect, {
    scoreBonus: 0.6,
    damageReduction: 0.6,
    ignoredHits: 5,
  });
});

const card = (deck, rank, suit) =>
  deck.find((candidate) => candidate.rank === rank && candidate.suit === suit);

test("Gambit evaluates wheel, full-house fallback, royal flush and best of ten", () => {
  const deck = createStandard52CardDeck();
  const wheel = [
    card(deck, "A", "clubs"),
    card(deck, "2", "diamonds"),
    card(deck, "3", "hearts"),
    card(deck, "4", "spades"),
    card(deck, "5", "clubs"),
  ];
  assert.equal(evaluateGambitHand(wheel), "straight");
  const fullHouse = [
    card(deck, "K", "clubs"),
    card(deck, "K", "diamonds"),
    card(deck, "K", "hearts"),
    card(deck, "2", "clubs"),
    card(deck, "2", "spades"),
  ];
  assert.equal(evaluateGambitHand(fullHouse), "three-of-a-kind");
  const royal = ["10", "J", "Q", "K", "A"].map((rank) =>
    card(deck, rank, "hearts"),
  );
  assert.equal(evaluateGambitHand(royal), "royal-flush");
  assert.equal(
    evaluateGambitHand([
      ...wheel,
      ...royal,
    ]),
    "royal-flush",
  );
  assert.equal(evaluateGambitHand(deck.slice(0, 4)), null);
  assert.equal(GAMBIT_REWARDS["royal-flush"].revives, 3);
  assert.equal(GAMBIT_REWARDS["straight-flush"].scoreWaves, 3);
});

test("small Trickster and Misc helpers implement their exact thresholds", () => {
  assert.equal(getSparkScoreMultiplier(25), 1.25);
  assert.equal(getPickpocketCoinSteal(0.25, false), 0.25);
  assert.equal(getPickpocketCoinSteal(24.2, false), 3);
  assert.equal(getPickpocketCoinSteal(500, true), 0);
  assert.deepEqual(getRogueActionForGrazes(2), {
    kind: "invincibility",
    durationSeconds: 0.45,
    locksLane: true,
  });
  assert.deepEqual(getRogueActionForGrazes(5), {
    kind: "clear-all-obstacles",
  });
  assert.equal(getSwitchMilestones(49).scoreMultiplier, 1);
  assert.equal(getSwitchMilestones(50).scoreMultiplier, 1.1);
  assert.equal(getSwitchMilestones(100).laneChangeInvincibilitySeconds, 0.25);
  assert.equal(getSwitchMilestones(1_000).canScrambleOpponentShop, true);
  assert.deepEqual(getCometSendOffer(5, 3), { price: 3, amount: 6 });
  assert.equal(getFortuneGemChanceBonus(100), 1);
  assert.equal(getFortuneGemSpawnChance(0.06, 3), 0.09);
  assert.equal(getFortuneGemSpawnChance(0.14, 100), 1);
  assert.equal(getScribeHazardCap(9), 1);
  assert.equal(getScribeHazardCap(10), 1);
  assert.equal(getScribeHazardCap(25), 2);
  assert.equal(getCatalystPickupSpeedMultiplier(1), 1.5);
  assert.equal(getCatalystPickupSpeedMultiplier(2), 0.5);
  assert.equal(getHarvesterAbilityTier(9), "locked");
  assert.equal(getHarvesterAbilityTier(10), "base");
  assert.equal(getHarvesterAbilityTier(50), "upgraded");
});

test("Broker funds move independently and pay or claim without losing fractions", () => {
  const up = moveBrokerFundForWave(100, {
    directionRoll: 0.599,
    percentageRoll: 1,
  });
  assert.deepEqual(up, {
    before: 100,
    after: 150,
    direction: "up",
    changeFraction: 0.5,
  });
  const down = moveBrokerFundForWave(100, {
    directionRoll: 0.6,
    percentageRoll: 0,
  });
  assert.deepEqual(down, {
    before: 100,
    after: 99,
    direction: "down",
    changeFraction: 0.01,
  });

  const deposited = addToBrokerFund(
    { gems: 4, coins: 2.25, melons: 200 },
    "coins",
    0.5,
  );
  assert.deepEqual(deposited, { gems: 4, coins: 2.75, melons: 200 });
  const moved = moveBrokerFundsForWave(deposited, {
    gems: { directionRoll: 0, percentageRoll: 0 },
    coins: { directionRoll: 1, percentageRoll: 1 },
    melons: { directionRoll: 0, percentageRoll: 1 },
  });
  closeTo(moved.funds.gems, 4.04);
  closeTo(moved.funds.coins, 1.375);
  closeTo(moved.funds.melons, 300);

  const claimed = claimBrokerCoinFund(moved.funds, 3.25);
  closeTo(claimed.claimed, 1.375);
  closeTo(claimed.attackPoints, 4.625);
  assert.equal(claimed.funds.coins, 0);

  const settled = settleBrokerFundsOnDeath(
    { gems: 4.04, coins: 1.375, melons: 300 },
    { gems: 10, attackPoints: 3.25, score: 800 },
  );
  closeTo(settled.totals.gems, 14.04);
  closeTo(settled.totals.attackPoints, 4.625);
  closeTo(settled.totals.score, 1100);
  assert.deepEqual(settled.funds, { gems: 0, coins: 0, melons: 0 });
});

test("Prospector emits a clamped lane warning exactly five seconds early", () => {
  assert.deepEqual(getProspectorGemWarningSchedule("gem-7", 3, 12_500), {
    gemId: "gem-7",
    lane: 3,
    warningAtMs: 7_500,
    spawnAtMs: 12_500,
    warningDurationMs: 5_000,
  });
  assert.deepEqual(getProspectorGemWarningSchedule(2, 99, 3_000, 5), {
    gemId: 2,
    lane: 4,
    warningAtMs: 0,
    spawnAtMs: 3_000,
    warningDurationMs: 5_000,
  });
});

test("Weaver blocks freeze and heals every second snowflake up to one HP per wave", () => {
  assert.equal(canWeaverCreateJacket(4), false);
  assert.equal(canWeaverCreateJacket(5), true);
  let state = { snowflakesSinceJacket: 0, healedThisWave: 0 };
  let result = resolveWeaverSnowflake(state, true);
  assert.equal(result.blocksFreeze, true);
  assert.equal(result.healing, 0);
  result = resolveWeaverSnowflake(result.state, true);
  assert.equal(result.healing, 0.5);
  result = resolveWeaverSnowflake(result.state, true);
  result = resolveWeaverSnowflake(result.state, true);
  assert.equal(result.healing, 0.5);
  result = resolveWeaverSnowflake(result.state, true);
  result = resolveWeaverSnowflake(result.state, true);
  assert.equal(result.healing, 0);
  assert.equal(result.state.healedThisWave, 1);
  assert.equal(resolveWeaverSnowflake(state, false).blocksFreeze, false);
});

test("Harvester exposes exact base and upgraded actions for each counter", () => {
  assert.deepEqual(getHarvesterAbility("gem", 9), {
    kind: "gem",
    tier: "locked",
    unlockAt: 10,
    upgradeAt: 50,
  });
  assert.deepEqual(getHarvesterAbility("gem", 10), {
    kind: "gem",
    tier: "base",
    cooldownSeconds: 30,
    durationSeconds: 10,
    healPerDeflectedObstacle: 0.5,
    sendsDeflectedObstaclesIn1v1: true,
  });
  assert.deepEqual(getHarvesterAbility("melon", 50), {
    kind: "melon",
    tier: "upgraded",
    cooldownSeconds: 45,
    removal: "all-obstacles",
    rewardWhenEveryLaneCleared: "invincible-15-seconds",
  });
  assert.deepEqual(getHarvesterAbility("attack-point", 50), {
    kind: "attack-point",
    tier: "upgraded",
    cooldownSeconds: 30,
    fakeCoinSteal: 20,
    opponentPurchaseCostMultiplier: 1.2,
  });
  assert.deepEqual(
    getHarvesterAbilities({ gems: 10, melons: 49, attackPoints: 50 }).map(
      ({ tier }) => tier,
    ),
    ["base", "base", "upgraded"],
  );
});

test("Muse tiers use the requested accuracy boundaries", () => {
  assert.equal(getMuseReward(50).tier, "basic");
  assert.equal(getMuseReward(50.01).tier, "mix");
  assert.equal(getMuseReward(75).tier, "advanced");
  assert.equal(getMuseReward(90).tier, "disco");
  assert.equal(getMuseReward(99.99).tier, "disco");
  assert.equal(getMuseReward(100).tier, "perfect");
  assert.equal(getMuseRemainingObstacleSlots(0), 5);
  assert.equal(getMuseRemainingObstacleSlots(4), 1);
  assert.equal(getMuseRemainingObstacleSlots(12), 0);
  assert.equal(getMuseMixHealPulses(9.999), 0);
  assert.equal(getMuseMixHealPulses(10), 1);
  assert.equal(getMuseMixHealPulses(31), 3);
  assert.equal(getMuseReplayAccuracyRequirement(0), 90);
  assert.equal(getMuseReplayAccuracyRequirement(3), 96);
  assert.equal(getMuseReplayAccuracyRequirement(20), 100);
  assert.equal(meetsMuseReplayAccuracyRequirement(90, 0), false);
  assert.equal(meetsMuseReplayAccuracyRequirement(90.01, 0), true);
  assert.equal(meetsMuseReplayAccuracyRequirement(100, 20), true);
});

test("simultaneous hazards never overlap a lane or close every lane", () => {
  const fiveRocks = [0, 1, 2, 3, 4].map((lane) => ({
    lane,
    kind: "rock",
  }));
  assert.equal(isDodgeableLaneGroup(fiveRocks), false);
  const groups = partitionDodgeableLaneGroups(fiveRocks);
  assert.deepEqual(groups.map((group) => group.length), [4, 1]);
  assert.equal(groups.every((group) => isDodgeableLaneGroup(group)), true);

  const overlaps = partitionDodgeableLaneGroups([
    { lane: 2, id: "a" },
    { lane: 2, id: "b" },
    { lane: 3, id: "c" },
  ]);
  assert.deepEqual(overlaps.map((group) => group.map(({ id }) => id)), [
    ["a"],
    ["b", "c"],
  ]);
});
