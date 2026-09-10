import assert from "node:assert/strict";
import test from "node:test";

import {
  ECHO_QUEST_ORDER,
  GAMBIT_MAX_HAND_SIZE,
  GAMBIT_REWARDS,
  HEATFEAST_CONSUME_LIMIT_PER_WAVE,
  MIRAGE_INVASION_DURATION_MS,
  WILDCARD_PERMANENT_EFFECT,
  activateEchoMirrorRealm,
  activateHexThrone,
  addHeatfeastSpending,
  advanceEchoQuest,
  advanceHexVoidCut,
  advanceMirageInvasion,
  becomeHexGod,
  beginEchoKnowingCharge,
  cancelEchoKnowingCharge,
  collectHexDamned,
  consumeHeatfeast,
  createEchoQuestState,
  createEchoKnowingState,
  createGambitState,
  createHeatfeastState,
  createHexVoidCutState,
  createStandardDeck,
  createWildcardDeck,
  createWildcardState,
  discardGambitCards,
  drawGambitWave,
  drawWildcard,
  enterHexVoid,
  evaluateGambitHand,
  getCometNaturalRemovalPrice,
  getCometSendPurchase,
  getEchoEligiblePassives,
  getEchoKnowingBenefits,
  getEchoKnowingChargeProgress,
  getGambitReward,
  getGambitRewardSchedule,
  getGambitWaveEffects,
  getHeatfeastBenefits,
  getHexChakramResult,
  getHexConstructedVoidDamage,
  getHexDamnationBenefits,
  getHexOpponentVoidEffect,
  getWildcardEffect,
  normalizeHeatfeastState,
  resolveGambitVersusCoins,
  resolveEchoKnowingDeath,
  resolveEchoKnowingHit,
  resolveHexChakram,
  resolveHexGodDeath,
  resolveHexSoulHit,
  splitCometIncomingObstacles,
  startMirageInvasion,
  summonHexSouls,
  validateEchoPassiveSelection,
} from "./advanced-character-rules.ts";

const closeTo = (actual, expected, epsilon = 1e-10) =>
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `${actual} was not within ${epsilon} of ${expected}`,
  );

const card = (deck, rank, suit) =>
  deck.find((candidate) => candidate.rank === rank && candidate.suit === suit);

test("Wildcard builds and exhausts a deterministic 54-card deck", () => {
  const deck = createWildcardDeck();
  assert.equal(deck.length, 54);
  assert.equal(new Set(deck.map(({ id }) => id)).size, 54);
  assert.equal(deck.filter(({ rank }) => rank === "JOKER").length, 2);

  let state = createWildcardState("one-run");
  assert.deepEqual(state.deck, createWildcardState("one-run").deck);
  const firstCycle = [];
  for (let index = 0; index < 53; index += 1) {
    const result = drawWildcard(state);
    firstCycle.push(result.card.id);
    state = result.state;
    assert.equal(result.permanentEffect, null);
  }
  const final = drawWildcard(state);
  firstCycle.push(final.card.id);
  assert.equal(new Set(firstCycle).size, 54);
  assert.equal(final.completedDeckThisDraw, true);
  assert.deepEqual(final.permanentEffect, WILDCARD_PERMANENT_EFFECT);
  assert.equal(final.state.permanentAceAndJoker, true);

  const nextCycle = drawWildcard(final.state);
  assert.equal(nextCycle.state.cycle, 1);
  assert.equal(nextCycle.state.cardsDrawn, 55);
  assert.deepEqual(nextCycle.permanentEffect, WILDCARD_PERMANENT_EFFECT);
});

test("Wildcard card effects match number, face, ace, and joker boundaries", () => {
  const deck = createWildcardDeck();
  assert.equal(getWildcardEffect(card(deck, "2", "clubs")).scoreMultiplier, 1.1);
  assert.equal(getWildcardEffect(card(deck, "10", "clubs")).scoreMultiplier, 1.5);
  assert.equal(getWildcardEffect(card(deck, "J", "clubs")).damageMultiplier, 0.9);
  assert.equal(getWildcardEffect(card(deck, "Q", "clubs")).damageMultiplier, 0.8);
  assert.equal(getWildcardEffect(card(deck, "K", "clubs")).damageMultiplier, 0.5);
  assert.deepEqual(getWildcardEffect(card(deck, "A", "clubs")), {
    scoreMultiplier: 1.6,
    damageMultiplier: 0.4,
    ignoredHits: 0,
    label: "ACE · +60% SCORE · 60% LESS DAMAGE",
  });
  assert.equal(
    getWildcardEffect(deck.find(({ rank }) => rank === "JOKER")).ignoredHits,
    5,
  );
});

test("Gambit draws five, caps the hand at ten, and requires explicit discards", () => {
  let state = createGambitState("gambit-run");
  const first = drawGambitWave(state);
  assert.equal(first.ok, true);
  assert.equal(first.drawn.length, 5);
  state = first.state;
  const second = drawGambitWave(state);
  assert.equal(second.ok, true);
  assert.equal(second.state.hand.length, GAMBIT_MAX_HAND_SIZE);
  state = second.state;
  const blocked = drawGambitWave(state);
  assert.deepEqual(
    { ok: blocked.ok, reason: blocked.reason, discardRequired: blocked.discardRequired },
    { ok: false, reason: "discard-required", discardRequired: 5 },
  );
  assert.strictEqual(blocked.state, state);

  state = discardGambitCards(state, state.hand.slice(0, 4).map(({ id }) => id));
  const stillBlocked = drawGambitWave(state);
  assert.equal(stillBlocked.ok, false);
  assert.equal(stillBlocked.discardRequired, 1);
  state = discardGambitCards(state, [state.hand[0].id]);
  const third = drawGambitWave(state);
  assert.equal(third.ok, true);
  assert.equal(third.state.hand.length, 10);
});

test("Gambit evaluates ordinary, wheel, full house, and best-of-ten hands", () => {
  const deck = createStandardDeck();
  const pair = [
    card(deck, "2", "clubs"),
    card(deck, "2", "hearts"),
    card(deck, "5", "diamonds"),
    card(deck, "8", "spades"),
    card(deck, "K", "clubs"),
  ];
  assert.equal(evaluateGambitHand(pair), "pair");
  assert.equal(
    evaluateGambitHand([
      card(deck, "A", "clubs"),
      card(deck, "2", "diamonds"),
      card(deck, "3", "hearts"),
      card(deck, "4", "spades"),
      card(deck, "5", "clubs"),
    ]),
    "straight",
  );
  const fullHouse = [
    card(deck, "K", "clubs"),
    card(deck, "K", "diamonds"),
    card(deck, "K", "hearts"),
    card(deck, "4", "spades"),
    card(deck, "4", "clubs"),
  ];
  assert.equal(evaluateGambitHand(fullHouse), "full-house");
  const royal = ["10", "J", "Q", "K", "A"].map((rank) =>
    card(deck, rank, "hearts"),
  );
  assert.equal(evaluateGambitHand(royal), "royal-flush");
  assert.equal(evaluateGambitHand([...pair, ...royal]), "royal-flush");
  assert.equal(evaluateGambitHand(deck.slice(0, 4)), null);
  assert.equal(evaluateGambitHand(deck.slice(0, 11)), null);
});

test("Gambit reward metadata preserves immediate, wave, permanent, and 1v1 effects", () => {
  assert.equal(getGambitReward("pair").temporary.damageMultiplier, 0.7);
  assert.equal(GAMBIT_REWARDS["two-pair"].versus.stealOpponentCoinsFraction, 0.25);
  assert.equal(GAMBIT_REWARDS.straight.immediate.setHearts, 5);
  assert.equal(GAMBIT_REWARDS.straight.permanent.setMaxHearts, 4);
  assert.equal(GAMBIT_REWARDS.flush.temporary.damageMultiplier, 0.05);
  assert.equal(GAMBIT_REWARDS["full-house"].inheritedFrom, "three-of-a-kind");
  assert.equal(GAMBIT_REWARDS["straight-flush"].temporary.damageStartsAfterWaves, 1);
  assert.equal(GAMBIT_REWARDS["straight-flush"].versus.sentObstacleMultiplier, 2);
  assert.equal(GAMBIT_REWARDS["royal-flush"].permanent.revivesAtFullHealth, 3);
  assert.equal(GAMBIT_REWARDS["royal-flush"].permanent.lastLifeScoreMultiplier, 6);
});

test("Gambit schedules delayed effects for their full duration", () => {
  const schedule = getGambitRewardSchedule("straight-flush", 7);
  assert.deepEqual(schedule.scoreWindow, {
    startsAtWave: 7,
    throughWave: 9,
    multiplier: 3,
  });
  assert.deepEqual(schedule.damageWindow, {
    startsAtWave: 8,
    throughWave: 9,
    multiplier: 0.25,
  });
  assert.deepEqual(schedule.invincibilityWindow, {
    startsAtWave: 7,
    throughWave: 7,
  });
  assert.deepEqual(getGambitWaveEffects(schedule, 7, 2), {
    scoreMultiplier: 3,
    damageMultiplier: 0,
    invincible: true,
    onLastLife: false,
    sentObstacleMultiplier: 2,
  });
  const delayedArmor = getGambitWaveEffects(schedule, 8, 0.5);
  closeTo(delayedArmor.damageMultiplier, 0.175);
  assert.equal(delayedArmor.scoreMultiplier, 3);
  assert.equal(delayedArmor.invincible, false);
  const expired = getGambitWaveEffects(schedule, 10, 2);
  assert.equal(expired.scoreMultiplier, 1);
  closeTo(expired.damageMultiplier, 0.7);
  assert.equal(expired.sentObstacleMultiplier, 1);
});

test("Gambit royal score changes after three waves and last-life means still alive", () => {
  const schedule = getGambitRewardSchedule("royal-flush", 4);
  assert.equal(schedule.permanentScoreStartsAtWave, 7);
  assert.equal(getGambitWaveEffects(schedule, 4, 0.5).scoreMultiplier, 18);
  assert.equal(getGambitWaveEffects(schedule, 6, 1).scoreMultiplier, 18);
  assert.equal(getGambitWaveEffects(schedule, 7, 1).scoreMultiplier, 12);
  assert.equal(getGambitWaveEffects(schedule, 7, 0).scoreMultiplier, 2);
  assert.equal(getGambitWaveEffects(schedule, 7, 1.5).scoreMultiplier, 2);
});

test("Gambit 1v1 steals preserve fractional coins and royal applies both effects", () => {
  assert.deepEqual(resolveGambitVersusCoins("two-pair", 10, 9), {
    selfCoins: 12.25,
    opponentCoins: 6.75,
    stolenCoins: 2.25,
    doubledCoins: 0,
  });
  assert.deepEqual(resolveGambitVersusCoins("royal-flush", 10, 5), {
    selfCoins: 30,
    opponentCoins: 0,
    stolenCoins: 5,
    doubledCoins: 15,
  });
  assert.deepEqual(resolveGambitVersusCoins("pair", Number.NaN, -10), {
    selfCoins: 0,
    opponentCoins: 0,
    stolenCoins: 0,
    doubledCoins: 0,
  });
});

const blankEchoProgress = () => ({
  highestWaveReached: 0,
  totalHeartsHealed: 0,
  totalDamageTaken: 0,
  allTrickstersUnlocked: false,
  wavesCompletedAfterUnlockingAllTricksters: 0,
  ideaCompletedByGameRule: false,
  allCharactersUnlocked: false,
});

test("Echo advances one ordered quest and one shard at a time", () => {
  assert.deepEqual(ECHO_QUEST_ORDER, [
    "dreamer-i",
    "uplift",
    "hope",
    "understanding",
    "idea",
    "the-knowing",
  ]);
  let state = createEchoQuestState();
  assert.equal(advanceEchoQuest(state, { ...blankEchoProgress(), highestWaveReached: 4 }).completed, null);
  let result = advanceEchoQuest(state, { ...blankEchoProgress(), highestWaveReached: 5 });
  assert.equal(result.completed, "dreamer-i");
  assert.equal(result.state.mirrorShards, 1);
  assert.equal(result.state.currentQuest, "uplift");
  state = result.state;

  assert.equal(advanceEchoQuest(state, { ...blankEchoProgress(), totalHeartsHealed: 4.99 }).completed, null);
  result = advanceEchoQuest(state, { ...blankEchoProgress(), totalHeartsHealed: 5 });
  assert.equal(result.completed, "uplift");
  state = result.state;

  assert.equal(advanceEchoQuest(state, { ...blankEchoProgress(), totalDamageTaken: 9.99 }).completed, null);
  result = advanceEchoQuest(state, { ...blankEchoProgress(), totalDamageTaken: 10 });
  assert.equal(result.completed, "hope");
  state = result.state;

  const understandingAlmost = {
    ...blankEchoProgress(),
    allTrickstersUnlocked: true,
    wavesCompletedAfterUnlockingAllTricksters: 4,
  };
  assert.equal(advanceEchoQuest(state, understandingAlmost).completed, null);
  result = advanceEchoQuest(state, {
    ...understandingAlmost,
    wavesCompletedAfterUnlockingAllTricksters: 5,
  });
  assert.equal(result.completed, "understanding");
  state = result.state;

  // The supplied design never defines Idea's objective, so it must not
  // permanently deadlock the ordered quest chain.
  result = advanceEchoQuest(state, blankEchoProgress());
  assert.equal(result.completed, "idea");
  assert.equal(result.passiveGrant, null);
  state = result.state;

  result = advanceEchoQuest(state, {
    ...blankEchoProgress(),
    allCharactersUnlocked: true,
  });
  assert.equal(result.completed, "the-knowing");
  assert.equal(result.state.currentQuest, null);
  assert.equal(result.state.mirrorShards, 6);
});

test("Echo exposes only eligible, explicitly selected passives", () => {
  const candidates = [
    { key: "runner_ace", name: "Ace", category: "runner", rarity: "common" },
    { key: "runner_zenith", name: "Zenith", category: "runner", rarity: "mythic" },
    { key: "medic_pulse", name: "Pulse", category: "healer", rarity: "epic" },
    { key: "medic_legend", name: "Legend", category: "healer", rarity: "legendary" },
    { key: "tank_guard", name: "Guard", category: "tank", rarity: "rare" },
    { key: "trickster_smoke", name: "Smoke", category: "trickster", rarity: "common" },
    { key: "runner_comet", name: "Comet", category: "trickster", rarity: "legendary" },
    { key: "trickster_hex", name: "Hex", category: "trickster", rarity: "mythic" },
  ];
  assert.deepEqual(
    getEchoEligiblePassives("dreamer-i", candidates).map(({ key }) => key),
    ["runner_ace"],
  );
  assert.deepEqual(
    getEchoEligiblePassives("uplift", candidates).map(({ key }) => key),
    ["medic_pulse"],
  );
  assert.deepEqual(
    getEchoEligiblePassives("understanding", candidates).map(({ key }) => key),
    ["trickster_smoke"],
  );
  assert.deepEqual(validateEchoPassiveSelection("dreamer-i", ["runner_ace"], candidates), {
    ok: false,
    reason: "must-pick-two-unique-passives",
  });
  assert.deepEqual(
    validateEchoPassiveSelection("understanding", ["trickster_smoke", "runner_comet"], candidates),
    { ok: false, reason: "passive-not-eligible" },
  );
  const twoRunners = [
    ...candidates,
    { key: "runner_dash", name: "Dash", category: "runner", rarity: "rare" },
  ];
  const valid = validateEchoPassiveSelection("dreamer-i", ["runner_ace", "runner_dash"], twoRunners);
  assert.equal(valid.ok, true);
  assert.deepEqual(valid.selected.map(({ key }) => key), ["runner_ace", "runner_dash"]);
  assert.deepEqual(validateEchoPassiveSelection("idea", [], candidates), {
    ok: false,
    reason: "quest-has-no-passive-choice",
  });
});

test("Echo's Knowing charge, realm, damage, healing, and shard revives are explicit", () => {
  const questsComplete = {
    completedQuests: [...ECHO_QUEST_ORDER],
    currentQuest: null,
    mirrorShards: 6,
  };
  const charging = beginEchoKnowingCharge(
    createEchoKnowingState(),
    questsComplete,
    1_000,
  );
  assert.equal(charging.ok, true);
  assert.equal(getEchoKnowingChargeProgress(charging.state, 6_000), 0.5);
  assert.equal(cancelEchoKnowingCharge(charging.state).chargingSinceMs, null);
  const awakened = { ...charging.state, awakened: true, chargingSinceMs: null };
  assert.deepEqual(getEchoKnowingBenefits(awakened, 2), {
    maxHearts: 8,
    damageMultiplier: 0.2,
    scoreMultiplier: 2.2,
  });
  const realm = activateEchoMirrorRealm(awakened, 10_000);
  assert.deepEqual(resolveEchoKnowingHit(realm, 2, 12_000, false), {
    selfDamage: 0.4,
    healing: 0.5,
    opponentDamage: 0,
    realmActive: true,
  });
  assert.equal(resolveEchoKnowingDeath(awakened, 2, false).revived, true);
  assert.equal(resolveEchoKnowingDeath(awakened, 1, false).revived, false);
});

test("Hex damnation thresholds activate at exact documented boundaries", () => {
  assert.equal(getHexDamnationBenefits(9).scoreMultiplier, 1);
  assert.equal(getHexDamnationBenefits(10).scoreMultiplier, 1.3);
  assert.equal(getHexDamnationBenefits(29).currentUnlocked, false);
  assert.equal(getHexDamnationBenefits(30).currentUnlocked, true);
  assert.equal(getHexDamnationBenefits(59).soulsUnlocked, false);
  assert.equal(getHexDamnationBenefits(60).soulsUnlocked, true);
  assert.equal(getHexDamnationBenefits(99).hadesUnlocked, false);
  assert.equal(getHexDamnationBenefits(100).hadesUnlocked, true);
  closeTo(getHexDamnationBenefits(100).damageMultiplier, 0.5);
  closeTo(getHexDamnationBenefits(120).damageMultiplier, 0.4);
  closeTo(getHexDamnationBenefits(999).damageMultiplier, 0.4);
});

test("Hex restores its three-move Void Cut at 30 Damnation with a cooldown", () => {
  let state = createHexVoidCutState();
  assert.equal(advanceHexVoidCut(state, 29, 0).reason, "locked");
  state = advanceHexVoidCut(state, 30, 0).state;
  state = advanceHexVoidCut(state, 30, 10).state;
  let result = advanceHexVoidCut(state, 30, 20);
  assert.equal(result.activated, true);
  assert.equal(result.state.cooldownUntilMs, 5_020);
  state = advanceHexVoidCut(result.state, 30, 100).state;
  state = advanceHexVoidCut(state, 30, 200).state;
  result = advanceHexVoidCut(state, 30, 300);
  assert.equal(result.reason, "cooldown");
  assert.equal(advanceHexVoidCut(result.state, 30, 5_020).activated, true);
});

test("Hex void is even-wave, once-per-wave, 15 seconds, and pauses wave time", () => {
  const initial = collectHexDamned(
    collectHexDamned(
      {
        damnation: 98,
        voidUsedWave: null,
        soulsRemaining: 0,
        godMode: false,
        godMaxHearts: 0,
        throneUsedWave: null,
      },
      1,
    ),
    1,
  );
  assert.equal(enterHexVoid(initial, 3).reason, "odd-wave");
  const entered = enterHexVoid(initial, 4);
  assert.equal(entered.ok, true);
  assert.equal(entered.durationMs, 15_000);
  assert.equal(entered.pausesWaveClock, true);
  assert.equal(entered.encounter, "hades");
  assert.equal(enterHexVoid(entered.state, 4).reason, "already-used-this-wave");
  assert.equal(enterHexVoid(entered.state, 6).ok, true);
});

test("Hex souls each absorb one hit and cost 15 damnation", () => {
  let state = collectHexDamned({
    damnation: 0,
    voidUsedWave: null,
    soulsRemaining: 0,
    godMode: false,
    godMaxHearts: 0,
    throneUsedWave: null,
  }, 59);
  assert.equal(summonHexSouls(state).reason, "requires-60-damnation");
  state = collectHexDamned(state);
  const summoned = summonHexSouls(state);
  assert.equal(summoned.ok, true);
  assert.equal(summoned.state.damnation, 45);
  assert.equal(summoned.state.soulsRemaining, 3);
  assert.equal(summonHexSouls(summoned.state).reason, "souls-still-active");
  let hit = resolveHexSoulHit(summoned.state);
  assert.equal(hit.blocked, true);
  hit = resolveHexSoulHit(hit.state);
  hit = resolveHexSoulHit(hit.state);
  assert.equal(hit.state.soulsRemaining, 0);
  assert.equal(resolveHexSoulHit(hit.state).blocked, false);
});

test("Hex god, throne, constructed void, and chakram outcomes are explicit", () => {
  let god = becomeHexGod({
    damnation: 100,
    voidUsedWave: 2,
    soulsRemaining: 0,
    godMode: false,
    godMaxHearts: 0,
    throneUsedWave: null,
  });
  assert.equal(god.godMaxHearts, 5);
  const throne = activateHexThrone(god, 3);
  assert.equal(throne.ok, true);
  assert.equal(throne.retreatDurationMs, 3_000);
  assert.equal(throne.invincibilityAfterReturnMs, 10_000);
  assert.equal(activateHexThrone(throne.state, 3).reason, "already-used-this-wave");
  for (const expected of [4, 3, 2, 1]) {
    const death = resolveHexGodDeath(god);
    assert.equal(death.revived, true);
    assert.equal(death.hearts, expected);
    god = death.state;
  }
  assert.equal(resolveHexGodDeath(god).revived, false);
  assert.equal(getHexConstructedVoidDamage("natural", 2), 0.1);
  assert.equal(getHexConstructedVoidDamage("opponent-sent", 2), 2);
  assert.deepEqual(getHexOpponentVoidEffect(), {
    durationMs: 15_000,
    inputDelayMs: 200,
    damageMultiplier: 2,
  });
  assert.deepEqual(getHexChakramResult(true), {
    removeFirstObstacleInLane: true,
    sentCopiesToOpponent: 3,
  });
});

test("Hex Chakram hits only the nearest obstacle ahead in the current lane", () => {
  const candidates = [
    { id: "behind", lane: 2, distanceAhead: -0.1, kind: "rock" },
    { id: "other-lane", lane: 1, distanceAhead: 0.1, kind: "barrel" },
    { id: "far", lane: 2, distanceAhead: 12, kind: "log" },
    { id: "nearest", lane: 2, distanceAhead: 2, kind: "snowflake" },
    { id: "same-distance-later", lane: 2, distanceAhead: 2, kind: "car" },
  ];
  const resolved = resolveHexChakram(candidates, 2, true);
  assert.equal(resolved.target?.id, "nearest");
  assert.equal(resolved.removeFirstObstacleInLane, true);
  assert.equal(resolved.sentCopiesToOpponent, 3);
  assert.deepEqual(resolveHexChakram(candidates, 4, true), {
    target: null,
    removeFirstObstacleInLane: false,
    sentCopiesToOpponent: 0,
  });
});

test("HEATFEAST stores both players' spending and caps total consumption at 100 per wave", () => {
  let state = addHeatfeastSpending(createHeatfeastState(), 250);
  let consumed = consumeHeatfeast(state, 4, 70);
  assert.equal(consumed.amount, 70);
  state = consumed.state;
  consumed = consumeHeatfeast(state, 4, 99);
  assert.equal(consumed.amount, 30);
  assert.equal(consumed.state.consumedThisWave, HEATFEAST_CONSUME_LIMIT_PER_WAVE);
  assert.equal(consumeHeatfeast(consumed.state, 4, 1).amount, 0);
  consumed = consumeHeatfeast(consumed.state, 5, 1_000);
  assert.equal(consumed.amount, 100);
  assert.equal(consumed.state.stored, 50);
  assert.equal(consumed.state.consumed, 200);
});

test("HEATFEAST benefits switch on at 50/100/250/500/750/1000", () => {
  assert.equal(getHeatfeastBenefits(49.99).attackCoinMultiplier, 1);
  assert.equal(getHeatfeastBenefits(50).attackCoinMultiplier, 1.2);
  closeTo(getHeatfeastBenefits(50).attackCoinMultiplierWithStarSpear, 1.8);
  assert.equal(getHeatfeastBenefits(99.99).selfDamageMultiplier, 1);
  assert.equal(getHeatfeastBenefits(100).selfDamageMultiplier, 0.75);
  assert.equal(getHeatfeastBenefits(100).opponentDamageMultiplier, 1.25);
  assert.equal(getHeatfeastBenefits(249.99).opponentCoinTaxFraction, 0);
  assert.equal(getHeatfeastBenefits(250).opponentCoinTaxFraction, 0.1);
  assert.equal(getHeatfeastBenefits(499.99).naturalRemovalPriceMultiplier, 1);
  assert.equal(getHeatfeastBenefits(500).naturalRemovalPriceMultiplier, 0.5);
  assert.equal(getHeatfeastBenefits(749.99).sentObstaclePriceMultiplier, 1);
  assert.equal(getHeatfeastBenefits(750).sentObstaclePriceMultiplier, 0.5);
  assert.equal(getHeatfeastBenefits(999.99).splitOpponentSentObstacles, false);
  assert.equal(getHeatfeastBenefits(1000).splitOpponentSentObstacles, true);
});

test("Comet prices round up, quantities double, and odd splits conserve obstacles", () => {
  assert.deepEqual(getCometSendPurchase(5, 3, 0), { price: 3, amount: 6 });
  assert.deepEqual(getCometSendPurchase(5, 3, 750), { price: 2, amount: 6 });
  assert.equal(getCometNaturalRemovalPrice("barrel", 499), 6);
  assert.equal(getCometNaturalRemovalPrice("barrel", 500), 3);
  assert.equal(getCometNaturalRemovalPrice("snowflake", 500), 4);
  assert.equal(getCometNaturalRemovalPrice("rock", 500), 4);
  assert.deepEqual(splitCometIncomingObstacles(5), {
    remainingForComet: 3,
    returnedToOpponent: 2,
  });
});

test("HEATFEAST sanitizes corrupt persisted values instead of producing NaN or debt", () => {
  assert.deepEqual(
    normalizeHeatfeastState({
      stored: -50,
      consumed: Number.NaN,
      trackedWave: Number.NaN,
      consumedThisWave: Number.POSITIVE_INFINITY,
    }),
    {
      stored: 0,
      consumed: 0,
      trackedWave: null,
      consumedThisWave: 0,
    },
  );
  assert.deepEqual(
    normalizeHeatfeastState({
      stored: 40,
      consumed: 250,
      trackedWave: 9.8,
      consumedThisWave: 999,
    }),
    {
      stored: 40,
      consumed: 250,
      trackedWave: 9,
      consumedThisWave: 100,
    },
  );
  assert.equal(
    addHeatfeastSpending(
      {
        stored: -10,
        consumed: 0,
        trackedWave: null,
        consumedThisWave: 20,
      },
      7,
    ).stored,
    7,
  );
  assert.deepEqual(getCometSendPurchase(Number.NaN, Infinity, 1_000), {
    price: 0,
    amount: 0,
  });
});

test("Mirage can invade once per wave and must begin away from the opponent", () => {
  const base = {
    isVersus: true,
    wave: 4,
    nowMs: 1_000,
    mirageLane: 1,
    opponentLane: 3,
    lastUsedWave: null,
  };
  assert.equal(startMirageInvasion({ ...base, isVersus: false }).reason, "versus-only");
  assert.equal(startMirageInvasion({ ...base, lastUsedWave: 4 }).reason, "already-used-this-wave");
  assert.equal(startMirageInvasion({ ...base, mirageLane: 3 }).reason, "must-start-in-different-lane");
  const started = startMirageInvasion(base);
  assert.equal(started.ok, true);
  assert.equal(started.state.endsAtMs - started.state.startedAtMs, MIRAGE_INVASION_DURATION_MS);
});

test("Mirage deals one damage per continuous 500 ms match and resets on lane exit", () => {
  const started = startMirageInvasion({
    isVersus: true,
    wave: 2,
    nowMs: 0,
    mirageLane: 0,
    opponentLane: 1,
    lastUsedWave: null,
  });
  let state = started.state;
  let step = advanceMirageInvasion(state, { nowMs: 100, mirageLane: 1, opponentLane: 1 });
  assert.equal(step.opponentDamage, 0);
  state = step.state;
  step = advanceMirageInvasion(state, { nowMs: 599, mirageLane: 1, opponentLane: 1 });
  assert.equal(step.opponentDamage, 0);
  state = step.state;
  step = advanceMirageInvasion(state, { nowMs: 600, mirageLane: 1, opponentLane: 1 });
  assert.equal(step.opponentDamage, 1);
  state = step.state;
  step = advanceMirageInvasion(state, { nowMs: 1_200, mirageLane: 2, opponentLane: 1 });
  assert.equal(step.opponentDamage, 0);
  state = step.state;
  step = advanceMirageInvasion(state, { nowMs: 1_300, mirageLane: 1, opponentLane: 1 });
  state = step.state;
  step = advanceMirageInvasion(state, { nowMs: 1_799, mirageLane: 1, opponentLane: 1 });
  assert.equal(step.opponentDamage, 0);
  state = step.state;
  step = advanceMirageInvasion(state, { nowMs: 1_800, mirageLane: 1, opponentLane: 1 });
  assert.equal(step.opponentDamage, 1);
});

test("Mirage counts the 5-second boundary then applies exit damage exactly once", () => {
  const started = startMirageInvasion({
    isVersus: true,
    wave: 8,
    nowMs: 0,
    mirageLane: 0,
    opponentLane: 1,
    lastUsedWave: null,
  });
  let state = advanceMirageInvasion(started.state, {
    nowMs: 0,
    mirageLane: 1,
    opponentLane: 1,
  }).state;
  const finished = advanceMirageInvasion(state, {
    nowMs: 5_000,
    mirageLane: 1,
    opponentLane: 1,
  });
  assert.equal(finished.opponentDamage, 10);
  assert.equal(finished.selfDamage, 1);
  assert.equal(finished.invulnerable, false);
  assert.equal(finished.state.damageDealt, 10);
  const repeated = advanceMirageInvasion(finished.state, {
    nowMs: 6_000,
    mirageLane: 1,
    opponentLane: 1,
  });
  assert.equal(repeated.opponentDamage, 0);
  assert.equal(repeated.selfDamage, 0);
});

test("Mirage ignores stale timer events without breaking a same-lane streak", () => {
  const started = startMirageInvasion({
    isVersus: true,
    wave: 3,
    nowMs: 0,
    mirageLane: 0,
    opponentLane: 1,
    lastUsedWave: null,
  });
  let step = advanceMirageInvasion(started.state, {
    nowMs: 100,
    mirageLane: 1,
    opponentLane: 1,
  });
  step = advanceMirageInvasion(step.state, {
    nowMs: 600,
    mirageLane: 1,
    opponentLane: 1,
  });
  assert.equal(step.opponentDamage, 1);
  const beforeStale = step.state;
  const stale = advanceMirageInvasion(beforeStale, {
    nowMs: 550,
    mirageLane: 4,
    opponentLane: 1,
  });
  assert.strictEqual(stale.state, beforeStale);
  assert.equal(stale.opponentDamage, 0);
  step = advanceMirageInvasion(stale.state, {
    nowMs: 1_100,
    mirageLane: 1,
    opponentLane: 1,
  });
  assert.equal(step.opponentDamage, 1);
  assert.equal(step.state.damageDealt, 2);
});
