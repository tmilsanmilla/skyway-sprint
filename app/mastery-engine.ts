import { bloomGemHeal, createGuardMemory, dashGreenChance, farthestGemLane, guardHit, guardSpawn, guardWaveStart, smokeHoldAttack, vaultEffect, vaultWasTimed, type GuardMemory, type MasteryHazard, type VaultEffect } from "./mastery-rules.ts";
import { getGemStreakMultiplier, formatGemStreakNotice } from "./gem-streak-rules.ts";

/** Per-run, active-gameplay state. Pausing never consumes these ability windows. */
export interface MasteryRuntime {
  elapsed: number;
  wave: number;
  spawnTags: Map<number, MasteryItemTags>;
  taggedWave: Map<number, number>;
  resolvedMisses: Set<number>;
  guard: GuardMemory;
  bloomFirstId: number | null;
  bloomFirstResolved: boolean;
  bloomFirstMissed: boolean;
  bloomAbilityUsed: boolean;
  vaultUsedWave: number;
  vaultPressedAt: number | null;
  vaultNextAt: number | null;
  vaultUntil: number;
  vaultStatus: VaultEffect["status"];
  vaultSpeed: number;
  vaultScore: number;
  smokeBombs: number;
  smokeCooldownUntil: number;
  smokeHoldStartedAt: number | null;
}
export interface MasteryItemTags { dashGreen?: boolean; guardBlue?: boolean; bloomFirst?: boolean; }
export function createMasteryRuntime(wave = 1): MasteryRuntime {
  return { elapsed: 0, wave, spawnTags: new Map(), taggedWave:new Map(), resolvedMisses: new Set(), guard: createGuardMemory(), bloomFirstId: null, bloomFirstResolved: false, bloomFirstMissed: false, bloomAbilityUsed: false, vaultUsedWave: 0, vaultPressedAt: null, vaultNextAt: null, vaultUntil: 0, vaultStatus: "normal", vaultSpeed: 1, vaultScore: 1, smokeBombs: 3, smokeCooldownUntil: 0, smokeHoldStartedAt: null };
}
export function startMasteryWave(runtime: MasteryRuntime, wave: number) {
  if (runtime.wave >= wave) return;
  runtime.wave = wave;
  runtime.guard = guardWaveStart(runtime.guard);
  runtime.bloomFirstId = null;
  runtime.bloomFirstResolved = false;
  runtime.bloomFirstMissed = false;
  runtime.bloomAbilityUsed = false;
  runtime.smokeBombs = 3;
  runtime.smokeHoldStartedAt = null;
}
/** Tag a spawn exactly once, including server course objects recreated by polling. */
export function decorateMasteryItem(runtime: MasteryRuntime, item: { id: number; kind: string }, character: string, mastered: boolean, pairedDashFlair: boolean, roll: number, hazard: boolean): MasteryItemTags {
  const previous = runtime.spawnTags.get(item.id);
  if (previous) return previous;
  const tags: MasteryItemTags = {};
  if (mastered && character === "runner_dash" && hazard) tags.dashGreen = roll < dashGreenChance(true, pairedDashFlair);
  if (mastered && character === "tank_guard" && (hazard || item.kind === "gem" || item.kind === "melon")) {
    const spawn = guardSpawn(runtime.guard);
    runtime.guard = spawn.memory;
    tags.guardBlue = spawn.blue;
  }
  if (character === "medic_bloom" && item.kind === "gem" && runtime.bloomFirstId === null) {
    runtime.bloomFirstId = item.id;
    tags.bloomFirst = true;
  }
  runtime.spawnTags.set(item.id, tags);
  runtime.taggedWave.set(item.id,runtime.wave);
  return tags;
}
/** Keep live objects and the prior wave so late course hydration cannot reroll tags. */
export function pruneMasteryRuntime(runtime:MasteryRuntime,liveIds:ReadonlySet<number>){
  for(const [id,spawnWave] of runtime.taggedWave)if(!liveIds.has(id)&&spawnWave<runtime.wave-1){runtime.taggedWave.delete(id);runtime.spawnTags.delete(id);runtime.resolvedMisses.delete(id);}
}
export function resolveBloomCollection(runtime: MasteryRuntime, itemId: number, mastered: boolean) {
  const first = !runtime.bloomFirstResolved && (!mastered || itemId === runtime.bloomFirstId);
  if (first) runtime.bloomFirstResolved = true;
  return bloomGemHeal(mastered, first, runtime.bloomFirstMissed);
}
/** A missed first gem consumes its benefit; future gems still heal a mastered Bloom by .25. */
export function resolveMasteryMiss(runtime: MasteryRuntime, itemId: number, character: string, mastered: boolean, roll: number) {
  if (runtime.resolvedMisses.has(itemId)) return { damage: 0, reason: null };
  runtime.resolvedMisses.add(itemId);
  const tags = runtime.spawnTags.get(itemId);
  if (mastered && character === "medic_bloom" && itemId === runtime.bloomFirstId && !runtime.bloomFirstResolved) {
    runtime.bloomFirstResolved = true;
    runtime.bloomFirstMissed = true;
    return { damage: mastered ? 0.5 : 0, reason: "BLOOM · FIRST GEM MISSED" };
  }
  if (mastered && tags?.dashGreen) return { damage: roll < 0.65 ? 0.5 : 0, reason: "DASH · GREEN OBSTACLE MISSED" };
  if (mastered && tags?.guardBlue) return { damage: 2, reason: "GUARD · BLUE OBJECT MISSED" };
  return { damage: 0, reason: null };
}
export function consumeBloomAbility(runtime: MasteryRuntime, lane: number, laneCount: number, roll: number) {
  if (runtime.bloomAbilityUsed) return null;
  runtime.bloomAbilityUsed = true;
  return farthestGemLane(lane, laneCount, roll);
}
export function guardBlueGemPickup(consecutivePickups:number) {
  const tier=getGemStreakMultiplier(consecutivePickups)+2;
  return {state:{consecutivePickups:tier<=5?tier:tier+5},multiplier:tier,gemsAwarded:tier,notice:formatGemStreakNotice(tier)};
}
export function vaultAvailable(runtime: MasteryRuntime, wave: number) {
  return runtime.vaultUsedWave !== wave || runtime.vaultNextAt !== null && runtime.elapsed >= runtime.vaultNextAt;
}
export function resolveMasteryVault(runtime: MasteryRuntime, wave: number, mastered: boolean) {
  if (!vaultAvailable(runtime, wave)) return null;
  const timed = vaultWasTimed(runtime.vaultPressedAt, runtime.elapsed);
  const effect = vaultEffect(mastered, timed);
  runtime.vaultUsedWave = wave;
  runtime.vaultPressedAt = null;
  runtime.vaultNextAt = effect.nextVaultSeconds === null ? null : runtime.elapsed + effect.nextVaultSeconds;
  runtime.vaultUntil = runtime.elapsed + effect.seconds;
  runtime.vaultStatus = effect.status;
  runtime.vaultSpeed = effect.speed;
  runtime.vaultScore = effect.score;
  return effect;
}
export function resolveGuardContact(runtime: MasteryRuntime, hazard: MasteryHazard, wave: number, fraction: number, blue: boolean) {
  const position = wave + fraction;
  if (blue) {
    runtime.guard.immuneUntil[hazard] = Math.max(runtime.guard.immuneUntil[hazard] ?? 0, wave + 1);
    return { immune: false, blue: true };
  }
  const result = guardHit(runtime.guard, hazard, wave, fraction);
  runtime.guard = result.memory;
  void position;
  return { immune: result.immune, blue: false };
}
export function smokeNearMissSeconds(items: readonly { id?:number; lane: number; y: number; kind: string }[], originalLane: number, speedPerSecond: (item: { id?:number; lane: number; y: number; kind: string }) => number, hazard: (kind: string) => boolean) {
  let nearest: number | undefined;
  for (const item of items) {
    if (item.lane !== originalLane || !hazard(item.kind) || item.y >= 91) continue;
    const speed = speedPerSecond(item);
    if (!(speed > 0)) continue;
    const seconds = Math.max(0, 65 - item.y) / speed;
    if (nearest === undefined || seconds < nearest) nearest = seconds;
  }
  return nearest;
}
export function spendLocalSmoke(runtime: MasteryRuntime, mastered: boolean, heldSeconds = 0, versus = false) {
  if (runtime.elapsed < runtime.smokeCooldownUntil || mastered && runtime.smokeBombs <= 0) return null;
  const attack = versus && heldSeconds >= 3 ? mastered ? smokeHoldAttack(heldSeconds, runtime.smokeBombs) : {cost:1,strength:"mild",seconds:10,cooldown:20} as const : null;
  if (versus && heldSeconds >= 3 && !attack) return null;
  const cost = attack?.cost ?? 1;
  if (mastered) runtime.smokeBombs -= cost;
  runtime.smokeCooldownUntil = runtime.elapsed + (attack && mastered ? 20 : mastered ? 5 : 12);
  return { attack, bombs: runtime.smokeBombs, cost };
}
export type SmokeStrength = "mild" | "grey" | "heavy-grey";
export function smokeOverlayBands(selfHeavy: boolean, attack: SmokeStrength | null, flairTop = 0) {
  if (selfHeavy) return [{ from: 0, to: 1, kind: "heavy" }];
  if (attack === "heavy-grey") return [{ from: 0, to: 0.5, kind: "heavy" }, { from: 0.5, to: 1, kind: "grey" }];
  if (attack) return [{ from: 0, to: 1, kind: attack }];
  return flairTop > 0 ? [{ from: 0, to: Math.min(0.4, flairTop), kind: "mild" }] : [];
}
