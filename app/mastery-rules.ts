/** Pure Update 2.3 quest, trial and mastery rules. Actual HP is never quantised. */
export type MasteryKey = "runner_dash" | "runner_stride" | "medic_bloom" | "medic_remedy" | "medic_salve" | "runner_vault" | "tank_guard" | "trickster_smoke";
export type MasteryHazard = "log" | "spikes" | "rock" | "barrel" | "snowflake" | "car" | "current" | "vortex";
export interface MasteryDefinition {
  key: MasteryKey; name: string; price: number; quests: readonly [string, string, string];
  targets: readonly [readonly number[], readonly number[], readonly number[]]; disclaimer: string; ability: string; finale: string;
}
export const MASTERIES: readonly MasteryDefinition[] = [
  { key: "runner_dash", name: "Dash", price: 200, quests: ["Dash 100 times", "Dash 10 times without taking a hit", "Dash-block 75 obstacles"], targets: [[100], [10], [75]], disclaimer: "Green, glowing obstacles MUST be dashed through. Missing one instantly ends the trial. Survive for 45 seconds. No pickups spawn.", ability: "+15% speed, +20% score and a 1-second shorter E cooldown. Green obstacles heal 1 HP and grant 2 seconds of invincibility when dashed through; missing one has a 65% chance to cost 0.5 HP.", finale: "Dash charges up and launches forward into a green trophy." },
  { key: "runner_stride", name: "Stride", price: 200, quests: ["Change lanes 300 times", "Block 100 obstacles with third-lane-change immunity", "Change lanes 100 times and block 25 obstacles without taking a hit"], targets: [[300], [100], [100, 25]], disclaimer: "Red obstacles MUST be blocked by third-lane-change immunity. Missing one instantly ends the trial. Survive for 45 seconds. No pickups spawn.", ability: "Every second lane change grants a 0.2-second dodge shield. Press F for 0.3-second shields for 15 seconds; cooldown: 30 seconds.", finale: "Stride rapidly changes lanes. All but the middle lane fall away, and a trophy glides down it." },
  { key: "medic_bloom", name: "Bloom", price: 225, quests: ["Collect 50 physical gems", "Heal 10 HP with Bloom's gem passive", "Heal 5 HP with Bloom's gem passive in one run"], targets: [[50], [10], [5]], disclaimer: "Collect the first gem each wave or instantly lose. Every later missed gem costs 1 HP. Complete wave 5. Only trial gems spawn; no other pickups.", ability: "The first gem each wave heals 1 HP; later gems heal 0.25 HP. Missing the first costs 0.5 HP and cancels its first-gem benefit. E spawns a gem in the farthest lane once per wave.", finale: "A cascade of gems supercharges Bloom, who zooms forward into a trophy." },
  { key: "medic_remedy", name: "Remedy", price: 225, quests: ["Heal 50 HP", "Heal 20 HP by collecting snowflakes", "Collect 100 snowflakes"], targets: [[50], [20], [100]], disclaimer: "Survive 5 volcano waves. Heat rises by 1 every 2 seconds; reaching 10 is fatal. A snowflake resets heat to 1. A snowflake appears at least every 11 seconds. No gems or pickups spawn.", ability: "Every snowflake heals 0.75 HP until you take a hit that wave. Snowflake turn delay is 0.1 seconds on every map. Starts at 3 HP with a 3.5-HP maximum.", finale: "Remedy freezes the volcano and collects a trophy formed from ice." },
  { key: "medic_salve", name: "Salve", price: 250, quests: ["Spend 300 seconds at 1 HP or less", "Use Salve's 2-HP heal 20 times", "Complete 20 waves after using all of Salve's heals"], targets: [[300], [20], [20]], disclaimer: "Treat 4 soldiers, 60 seconds each. Stay at 1 HP or less to avoid enemy fire. At each treatment check: below 10% low-HP time is fatal; below 30% has a 50% risk, below 60% a 25% risk, and up to 75% a 10% risk. No pickups spawn.", ability: "The low-HP 2-HP wave heal can activate 3 times per run, then waves heal 0.5 HP. At 1 HP or less, obstacles are 35% faster and score is 50% higher.", finale: "Salve finishes treating all four soldiers and escapes the battlefield." },
  { key: "runner_vault", name: "Vault", price: 260, quests: ["Vault over 50 logs", "Vault over 50 spikes", "Reach wave 10 in one run without being hit by a log or spike"], targets: [[50], [50], [10]], disclaimer: "Vault over 20 logs or spikes. E must be pressed within 0.25 seconds before contact. One mistimed vault damages the pole; a second ends the trial. An unvaulted log or spike instantly ends it. No pickups spawn.", ability: "A timed E vault gives 5 seconds of +100% obstacle speed and +125% score, then another vault becomes available after 10 more seconds. An untimed vault instead costs 0.5 HP and gives 15 seconds of half speed and 60% less score.", finale: "A trophy slides down the middle lane, and Vault vaults into it." },
  { key: "tank_guard", name: "Guard", price: 260, quests: ["Prevent 50 HP of damage with Guard's reduction", "Survive 20 hits that would otherwise have killed you", "Take 100 HP of damage after reduction"], targets: [[50], [20], [100]], disclaimer: "Blue obstacles MUST be hit. Missing one instantly ends the trial. They cannot reduce you below 0.5 HP. Complete 4 waves with 1, 2, 3 and 5 blue obstacles respectively. No pickups spawn.", ability: "Takes 35% less damage and earns 10% less score. Three hits from one hazard type grant immunity to that type for the rest of the wave and the first half of the next, including snowflake effects. E toggles GUARD mode, replacing damage reduction with a blue item every tenth spawn, at most two per wave. Hit a blue hazard for a nonlethal 0.5 HP loss and type immunity; missing costs 2 HP. Blue melons give 3× score; blue gems advance the streak two tiers.", finale: "Guard tanks a cascade of blue obstacles and collects the trophy in the current lane." },
  { key: "trickster_smoke", name: "Smoke", price: 300, quests: ["Use 50 smoke bombs", "Throw 30 smoke attacks at a 1v1 opponent", "Use a smoke bomb to dodge within 0.25 seconds of a hit 30 times"], targets: [[50], [30], [30]], disclaimer: "Survive 200 seconds through heavy, grey and mild smoke. E spends one of 2 dissipators, clearing your quarter and pushing smoke back for 50 seconds. No snowflakes, gems or pickups spawn.", ability: "Teleport to safety every 5 seconds using one of 3 shared bombs per wave. Exhausting them covers your field in heavy smoke: hits have a 50% automatic dodge chance and damage is 30% lower until wave end. In 1v1, hold E for 3 seconds to spend one bomb on 10 seconds of mild smoke, 5 seconds to spend two on grey smoke, or 10 seconds to spend all on a heavy top half and grey bottom half. Sending uses a 20-second cooldown.", finale: "Rescue lights cut through the smoke, and Smoke is rescued." },
] as const;
export const masteryDefinition = (key: string) => MASTERIES.find((entry) => entry.key === key);
export const isMasteryKey = (key: string): key is MasteryKey => !!masteryDefinition(key);
const safe = (n: number, fallback = 0) => Number.isFinite(n) ? n : fallback;
const bounded = (n: number, max: number) => Math.min(max, Math.max(0, safe(n)));
/** Thresholds only: ties round up; an alive fraction always counts as at least half a heart. */
export const roundedHealthForConditions = (hp: number) => hp > 0 && Number.isFinite(hp) ? Math.max(0.5, Math.floor(hp * 2 + 0.5) / 2) : 0;

export interface MasteryQuestState { quest: number; progress: number[]; complete: boolean; mastered: boolean; masteryEnabled: boolean; flairRewriteEnabled: boolean; }
export interface MasteryAccountState { active: MasteryKey | null; quests: Partial<Record<MasteryKey, MasteryQuestState>>; }
export const emptyMasteryAccount = (): MasteryAccountState => ({ active: null, quests: {} });
export const newMasteryQuest = (): MasteryQuestState => ({ quest: 0, progress: [0], complete: false, mastered: false, masteryEnabled: false, flairRewriteEnabled: false });
/** Purchasing never replaces another active quest. Resuming explicitly switches the active questline. */
export function purchaseMasteryQuest(state: MasteryAccountState, key: MasteryKey, photons: number, owned: boolean): { state: MasteryAccountState; photons: number; error?: string } {
  const definition = masteryDefinition(key)!;
  if (!owned) return { state, photons, error: "Unlock this character first." };
  if (state.quests[key]) return { state, photons };
  if (!Number.isFinite(photons) || photons < definition.price) return { state, photons, error: `You need ${definition.price} photons.` };
  return { state: { ...state, active: state.active ?? key, quests: { ...state.quests, [key]: newMasteryQuest() } }, photons: photons - definition.price };
}
export function activateMasteryQuest(state: MasteryAccountState, key: MasteryKey): MasteryAccountState {
  return state.quests[key] && !state.quests[key]!.complete ? { ...state, active: key } : state;
}
export type MasteryQuestEvent =
  | { type: "dash" }
  | { type: "lane-change" }
  | { type: "block"; source: "dash" | "stride-third" | "stride"; green?: boolean; event_id?: string }
  | { type: "gem" }
  | { type: "heal"; amount: number; source: "bloom" | "snowflake" | "other" }
  | { type: "snowflake" }
  | { type: "frame"; seconds: number; hp: number }
  | { type: "salve-heal" }
  | { type: "wave"; wave: number; salveExhausted?: boolean }
  | { type: "vault"; hazard: "log" | "spikes" }
  | { type: "damage"; hazard: MasteryHazard; before: number; damage: number; baseDamage: number }
  | { type: "smoke"; opponent?: boolean; timeToImpact?: number }
  | { type: "trial-special"; action: "dash" | "stride-third" | "hit" | "miss" }
  | { type: "trial-gem"; collected: boolean }
  | { type: "trial-vault"; timed: boolean; vaulted: boolean }
  | { type: "trial-wave"; wave: number }
  | { type: "trial-died" }
  | { type: "run-start" | "run-end" };
/** One active quest is credited, and an event never spills over into the next quest. */
export function reduceMasteryQuest(state: MasteryAccountState, character: string, event: MasteryQuestEvent): MasteryAccountState {
  const key = state.active;
  if (!key || key !== character) return state;
  const current = state.quests[key];
  if (!current || current.complete) return state;
  const def = masteryDefinition(key)!;
  const q = current.quest;
  const progress = [...current.progress];
  const add = (n = 1, slot = 0) => { progress[slot] = (progress[slot] ?? 0) + Math.max(0, safe(n)); };
  const reset = () => { for (let i = 0; i < Math.max(progress.length, def.targets[q].length); i++) progress[i] = 0; };
  const boundary = event.type === "run-start" || event.type === "run-end";
  if (key === "runner_dash") {
    if (q < 2 && event.type === "dash") add();
    if (q === 1 && (event.type === "damage" && event.damage > 0 || boundary)) reset();
    if (q === 2 && event.type === "block" && event.source === "dash") add();
  } else if (key === "runner_stride") {
    if ((q === 0 || q === 2) && event.type === "lane-change") add();
    if (q === 1 && event.type === "block" && event.source === "stride-third") add();
    if (q === 2 && event.type === "block" && (event.source === "stride-third" || event.source === "stride")) add(1, 1);
    if (q === 2 && (event.type === "damage" && event.damage > 0 || boundary)) reset();
  } else if (key === "medic_bloom") {
    if (q === 0 && event.type === "gem") add();
    if (q > 0 && event.type === "heal" && event.source === "bloom") add(event.amount);
    if (q === 2 && boundary) reset();
  } else if (key === "medic_remedy") {
    if (q === 0 && event.type === "heal") add(event.amount);
    if (q === 1 && event.type === "heal" && event.source === "snowflake") add(event.amount);
    if (q === 2 && event.type === "snowflake") add();
  } else if (key === "medic_salve") {
    if (q === 0 && event.type === "frame" && roundedHealthForConditions(event.hp) > 0 && roundedHealthForConditions(event.hp) <= 1) add(bounded(event.seconds, 1));
    if (q === 1 && event.type === "salve-heal") add();
    if (q === 2 && event.type === "wave" && event.salveExhausted) add();
  } else if (key === "runner_vault") {
    if (q < 2 && event.type === "vault" && event.hazard === (q === 0 ? "log" : "spikes")) add();
    if (q === 2 && event.type === "damage" && event.damage > 0 && (event.hazard === "log" || event.hazard === "spikes")) progress[1] = 1;
    if (q === 2 && event.type === "wave" && !progress[1]) progress[0] = Math.max(progress[0] ?? 0, event.wave);
    if (q === 2 && boundary) reset();
  } else if (key === "tank_guard" && event.type === "damage") {
    if (q === 0) add(Math.max(0, event.baseDamage - event.damage));
    if (q === 1 && event.before > event.damage && event.before <= event.baseDamage) add();
    if (q === 2) add(event.damage);
  } else if (key === "trickster_smoke" && event.type === "smoke") {
    if (q === 0 || q === 1 && event.opponent || q === 2 && !event.opponent && event.timeToImpact !== undefined && event.timeToImpact >= 0 && event.timeToImpact <= 0.25) add();
  }
  const done = def.targets[q].every((target, i) => (progress[i] ?? 0) + 1e-9 >= target);
  const next: MasteryQuestState = done ? { ...current, quest: Math.min(3, q + 1), complete: q === 2, progress: q === 2 ? progress : def.targets[q + 1].map(() => 0) } : { ...current, progress };
  return { ...state, active: done && q === 2 ? null : key, quests: { ...state.quests, [key]: next } };
}
export function completeMasteryTrial(state: MasteryAccountState, key: MasteryKey): MasteryAccountState {
  const quest = state.quests[key];
  if (quest?.mastered) return state;
  return quest?.complete ? { ...state, quests: { ...state.quests, [key]: { ...quest, mastered: true, masteryEnabled: true, flairRewriteEnabled: true } } } : state;
}
export function toggleMastery(state: MasteryAccountState, key: MasteryKey, which: "mastery" | "flair", enabled: boolean): MasteryAccountState {
  const quest = state.quests[key];
  if (!quest?.mastered) return state;
  return { ...state, quests: { ...state.quests, [key]: { ...quest, [which === "mastery" ? "masteryEnabled" : "flairRewriteEnabled"]: enabled } } };
}

export type TrialPhase = "disclaimer" | "playing" | "finale" | "complete" | "failed";
export interface MasteryTrialState {
  key: MasteryKey; phase: TrialPhase; seconds: number; wave: number; finaleSeconds: number; failure: string | null;
  heat: number; heatSeconds: number; lastSnowflakeSpawn: number; snowflakeDue: boolean;
  lowHpSeconds: number; treatmentSeconds: number; treated: number; vaults: number; poleDamaged: boolean;
  dissipators: number; smokeClearUntil: number; waveGemSeen: boolean; blueSpawned: number;
}
export type MasteryTrialEvent =
  | { type: "accept" }
  | { type: "frame"; seconds: number; hp: number }
  | { type: "wave-end"; wave: number; roll?: number }
  | { type: "special-obstacle"; action: "dash" | "stride-third" | "hit" | "miss"; baseDamage?: number; hp?: number }
  | { type: "gem"; collected: boolean }
  | { type: "snowflake" }
  | { type: "snowflake-spawn" }
  | { type: "vault"; timed: boolean; vaulted: boolean }
  | { type: "dissipate" }
  | { type: "died" };
export interface MasteryTrialResult { state: MasteryTrialState; damage: number; healthFloor?: number; spawnSnowflake: boolean; unlock: boolean; }
export const createMasteryTrial = (key: MasteryKey): MasteryTrialState => ({ key, phase: "disclaimer", seconds: 0, wave: 1, finaleSeconds: 0, failure: null, heat: 0, heatSeconds: 0, lastSnowflakeSpawn: 0, snowflakeDue: false, lowHpSeconds: 0, treatmentSeconds: 0, treated: 0, vaults: 0, poleDamaged: false, dissipators: 2, smokeClearUntil: 0, waveGemSeen: false, blueSpawned: 0 });
export const trialPickupAllowed = (key: MasteryKey, kind: string) => key === "medic_bloom" && kind === "gem" || key === "medic_remedy" && kind === "snowflake";
export const trialHazardAllowed = (key: MasteryKey, kind: string) => key !== "trickster_smoke" || kind !== "snowflake";
export const trialSpecialChance = (key: MasteryKey) => key === "runner_dash" || key === "runner_stride" ? 0.1 : 0;
export const guardTrialBlueCount = (wave: number) => [1, 2, 3, 5][Math.min(3, Math.max(0, wave - 1))];
export const salveTrialDeathChance = (ratio: number) => ratio < 0.1 ? 1 : ratio < 0.3 ? 0.5 : ratio < 0.6 ? 0.25 : ratio <= 0.75 ? 0.1 : 0;
export const masteryTrialDuration = (key: MasteryKey) => key === "runner_dash" || key === "runner_stride" ? 45 : key === "trickster_smoke" ? 200 : null;
export function masteryTrialSmoke(state: MasteryTrialState) {
  const clear = state.seconds < state.smokeClearUntil;
  return clear ? [{ from: 0, to: 0.25, kind: "grey" }, { from: 0.25, to: 0.75, kind: "mild" }] as const : [{ from: 0, to: 0.25, kind: "heavy" }, { from: 0.25, to: 0.75, kind: "grey" }, { from: 0.75, to: 1, kind: "mild" }] as const;
}
/** Feed only active gameplay seconds, never menu/pause/wall-clock time. */
export function reduceMasteryTrial(current: MasteryTrialState, event: MasteryTrialEvent): MasteryTrialResult {
  const state = { ...current };
  let damage = 0; let healthFloor: number | undefined; let spawnSnowflake = false; let unlock = false;
  const fail = (message: string) => { state.phase = "failed"; state.failure = message; };
  const finale = () => { state.phase = "finale"; state.finaleSeconds = 0; };
  if (event.type === "accept" && state.phase === "disclaimer") state.phase = "playing";
  else if (event.type === "frame" && state.phase === "finale") {
    state.finaleSeconds += bounded(event.seconds, 1);
    if (state.finaleSeconds >= 3) { state.phase = "complete"; unlock = true; }
  } else if (state.phase === "playing") {
    if (event.type === "died") fail("You did not survive the trial. Try again.");
    if (event.type === "frame" && (!Number.isFinite(event.hp) || event.hp <= 0)) fail("You did not survive the trial. Try again.");
    if (event.type === "frame" && state.phase === "playing") {
      const dt = bounded(event.seconds, 1);
      state.seconds += dt;
      const duration = masteryTrialDuration(state.key);
      if (duration && state.seconds >= duration) finale();
      if (state.key === "medic_remedy") {
        state.heatSeconds += dt;
        while (state.heatSeconds >= 2) { state.heatSeconds -= 2; state.heat++; }
        if (state.heat >= 10) fail("The volcano heat reached 10.");
        if (state.seconds - state.lastSnowflakeSpawn >= 11 && !state.snowflakeDue) { spawnSnowflake = true; state.snowflakeDue = true; }
      }
      if (state.key === "medic_salve") {
        state.treatmentSeconds += dt;
        if (roundedHealthForConditions(event.hp) > 0 && roundedHealthForConditions(event.hp) <= 1) state.lowHpSeconds += dt;
      }
    }
    if (event.type === "special-obstacle") {
      if (state.key === "runner_dash" && event.action !== "dash") fail("A green obstacle was not dashed through.");
      if (state.key === "runner_stride" && event.action !== "stride-third") fail("A red obstacle was not blocked by third-change immunity.");
      if (state.key === "tank_guard") {
        if (event.action !== "hit") fail("A blue obstacle was not tanked.");
        else { damage = Math.max(0, Math.min(safe(event.baseDamage ?? 0), safe(event.hp ?? 0) - 0.5)); healthFloor = 0.5; }
      }
    }
    if (event.type === "gem" && state.key === "medic_bloom") {
      if (!event.collected) { if (!state.waveGemSeen) fail("The first gem of the wave was missed."); else damage = 1; }
      state.waveGemSeen = true;
    }
    if (event.type === "snowflake" && state.key === "medic_remedy") { state.heat = 1; state.heatSeconds = 0; }
    if (event.type === "snowflake-spawn" && state.key === "medic_remedy") { state.lastSnowflakeSpawn = state.seconds; state.snowflakeDue = false; }
    if (event.type === "vault" && state.key === "runner_vault") {
      if (!event.vaulted) fail("A log or spike was not vaulted.");
      else if (!event.timed && state.poleDamaged) fail("The compromised vaulting pole broke.");
      else { if (!event.timed) state.poleDamaged = true; state.vaults++; if (state.vaults >= 20) finale(); }
    }
    if (event.type === "dissipate" && state.key === "trickster_smoke" && state.dissipators > 0 && state.seconds >= state.smokeClearUntil) { state.dissipators--; state.smokeClearUntil = state.seconds + 50; }
    if (event.type === "wave-end") {
      if (state.key === "medic_bloom" && event.wave >= 5 || state.key === "medic_remedy" && event.wave >= 5 || state.key === "tank_guard" && event.wave >= 4) finale();
      if (state.key === "medic_salve") {
        // Treatment waves are exactly 60 active seconds, not the normal wave clock.
        if (state.treatmentSeconds < 60) return { state, damage, spawnSnowflake, unlock };
        const risk = salveTrialDeathChance(state.lowHpSeconds / state.treatmentSeconds);
        if (bounded(event.roll ?? 1, 1) < risk || risk === 1) fail("Enemy soldiers saw that Salve was alive.");
        else { state.treated++; state.treatmentSeconds = 0; state.lowHpSeconds = 0; if (state.treated >= 4) finale(); }
      }
      state.wave = event.wave + 1; state.waveGemSeen = false; state.blueSpawned = 0;
    }
  }
  return { state, damage, healthFloor, spawnSnowflake, unlock };
}

export const dashGreenChance = (mastered: boolean, pairedRewrittenFlair = false) => mastered ? 1 / (pairedRewrittenFlair ? 90 : 100) : 0;
export function resolveDashGreen(dashed: boolean, roll: number) { return dashed ? { heal: 1, invincibleSeconds: 2, damage: 0 } : { heal: 0, invincibleSeconds: 0, damage: roll < 0.65 ? 0.5 : 0 }; }
export const strideShieldSeconds = (laneChanges: number, mastered: boolean, fActive: boolean) => laneChanges > 0 && laneChanges % (mastered ? 2 : 3) === 0 ? mastered ? fActive ? 0.3 : 0.2 : 0.25 : 0;
export const STRIDE_F_DURATION = 15;
export const STRIDE_F_COOLDOWN = 30;
export const bloomGemHeal = (mastered: boolean, isFirst: boolean, missedFirst: boolean) => isFirst && !missedFirst ? mastered ? 1 : 0.5 : mastered ? 0.25 : 0;
export const farthestGemLane = (lane: number, lanes: number, roll = 0) => lane < (lanes - 1) / 2 ? lanes - 1 : lane > (lanes - 1) / 2 ? 0 : roll < 0.5 ? 0 : lanes - 1;
export const remedySnowflakeHeal = (mastered: boolean, hitThisWave: boolean, alreadyHealed: boolean) => mastered ? hitThisWave ? 0 : 0.75 : alreadyHealed ? 0 : 1;
export function salveWaveHeal(hp: number, uses: number, mastered: boolean) { const available = uses < (mastered ? 3 : 2); return { heal: available ? roundedHealthForConditions(hp) <= 1 && hp > 0 ? 2 : 1 : mastered ? 0.5 : 0, used: available && hp > 0 && roundedHealthForConditions(hp) <= 1 }; }
export const salveLowHealthMultipliers = (hp: number, mastered: boolean) => mastered && hp > 0 && roundedHealthForConditions(hp) <= 1 ? { speed: 1.35, score: 1.5 } : { speed: 1, score: 1 };
export interface VaultEffect { status: "normal" | "quick-recovery" | "flop"; seconds: number; speed: number; score: number; damage: number; nextVaultSeconds: number | null; }
export const vaultEffect = (mastered: boolean, timed: boolean): VaultEffect => !mastered ? { status: "normal", seconds: 1, speed: 1.8, score: 1.9, damage: 0, nextVaultSeconds: null } : timed ? { status: "quick-recovery", seconds: 5, speed: 2, score: 2.25, damage: 0, nextVaultSeconds: 15 } : { status: "flop", seconds: 15, speed: 0.5, score: 0.4, damage: 0.5, nextVaultSeconds: null };
export const vaultWasTimed = (pressedAt: number | null, now: number) => pressedAt !== null && now >= pressedAt && now - pressedAt <= 0.25 + Number.EPSILON;
export interface GuardMemory { counts: Partial<Record<MasteryHazard, number>>; immuneUntil: Partial<Record<MasteryHazard, number>>; blueSpawned: number; obstacleCount: number; mode: boolean; }
export const createGuardMemory = (): GuardMemory => ({ counts: {}, immuneUntil: {}, blueSpawned: 0, obstacleCount: 0, mode: false });
/** wavePosition is wave + active-wave fraction. Immunity ends exactly halfway into the next wave. */
export function guardHit(memory: GuardMemory, hazard: MasteryHazard, wave: number, waveFraction: number) { const position = wave + waveFraction; if ((memory.immuneUntil[hazard] ?? 0) > position) return { memory, immune: true }; const count = (memory.counts[hazard] ?? 0) + 1; return { memory: { ...memory, counts: { ...memory.counts, [hazard]: count }, immuneUntil: count >= 3 ? { ...memory.immuneUntil, [hazard]: wave + 1.5 } : memory.immuneUntil }, immune: false }; }
export const guardWaveStart = (memory: GuardMemory): GuardMemory => ({ ...memory, counts: {}, blueSpawned: 0, obstacleCount: 0 });
export function guardSpawn(memory: GuardMemory) { const obstacleCount = memory.obstacleCount + 1; const blue = memory.mode && obstacleCount % 10 === 0 && memory.blueSpawned < 2; return { memory: { ...memory, obstacleCount, blueSpawned: memory.blueSpawned + (blue ? 1 : 0) }, blue }; }
export const guardBlueDamage = (hp: number) => Math.max(0, Math.min(0.5, hp - 0.5));
export const guardDamageMultiplier = (guardMode: boolean) => guardMode ? 1 : 0.65;
export function smokeHoldAttack(seconds: number, bombs: number) { const cost = seconds >= 10 ? Math.max(0, Math.floor(bombs)) : seconds >= 5 ? 2 : seconds >= 3 ? 1 : 0; return cost > 0 && bombs >= cost ? { cost, strength: seconds >= 10 ? "heavy-grey" : seconds >= 5 ? "grey" : "mild", seconds: 10, cooldown: 20 } as const : null; }
export const smokeLifeGuess = (bombs: number, roll: number) => ({ active: bombs <= 0, dodge: bombs <= 0 && roll < 0.5, damageMultiplier: bombs <= 0 ? 0.7 : 1 });
