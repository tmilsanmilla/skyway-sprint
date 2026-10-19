import { roundedHealthForConditions } from "./mastery-rules.ts";

/** A flair's key is its source character: ownership is derived, never separately granted. */
export interface InventoryFlair { key: string; name: string; characterName: string; scoreBonus: number; }
export interface FlairCharacter { key: string; name: string; rarity?: string; weapon_name?: string | null; weapon_score_bonus?: number | null; }
const NAMES: Record<string, string> = { runner_ace: "Baton", runner_dash: "Jet Baton", runner_stride: "Pace Blades", medic_bloom: "Bloom Wand", medic_remedy: "Tonic Bell", medic_salve: "Remedy Brush", runner_vault: "Vaulting Pole", tank_guard: "Guard Shield", trickster_smoke: "Smoke Bomb" };
const RARITY_BONUS: Record<string, number> = { default: 0.03, common: 0.03, uncommon: 0.04, rare: 0.05, epic: 0.06, legendary: 0.07, mythic: 0.08 };
export function inventoryFlairs(characters: readonly FlairCharacter[], ownedCharacters: readonly string[]): InventoryFlair[] {
  const owned = new Set(ownedCharacters);
  return characters.filter((c) => owned.has(c.key)).map((c) => ({ key: c.key, characterName: c.name, name: c.weapon_name || NAMES[c.key] || `${c.name}'s Flair`, scoreBonus: Math.max(0, c.weapon_score_bonus ?? RARITY_BONUS[c.rarity ?? "common"] ?? 0.03) }));
}
export const defaultFlairOnCharacterChange = (character: string, ownedCharacters: readonly string[]) => ownedCharacters.includes(character) ? character : null;
export const canEquipFlair = (key: string, ownedCharacters: readonly string[]) => ownedCharacters.includes(key);
export function cycleFlair(current: string | null, direction: -1 | 1, flairs: readonly InventoryFlair[]) { if (!flairs.length) return null; const i = flairs.findIndex((f) => f.key === current); return flairs[(Math.max(0, i) + direction + flairs.length) % flairs.length].key; }

export interface FlairEffects {
  scoreMultiplier: number; gemMultiplier: number; damageMultiplier: number; snowflakeDurationReduction: number;
  frozenScoreMultiplier: number; laneChangeScore: number; waveHealExtra: number;
  postHitSeconds: number; postHitDamageMultiplier: number; postHitInvincible: boolean; postHitScoreMultiplier: number;
  opponentMildSmokeTop: number; dashCooldownReduction: number; dashGreenDenominator: number;
}
export function getFlairEffects(flair: InventoryFlair | null, character: string, rewriteUnlockedAndEnabled: boolean, hp = 3, maxHp = 3): FlairEffects {
  const effect: FlairEffects = { scoreMultiplier: 1 + (flair?.scoreBonus ?? 0), gemMultiplier: 1, damageMultiplier: 1, snowflakeDurationReduction: 0, frozenScoreMultiplier: 1, laneChangeScore: 0, waveHealExtra: 0, postHitSeconds: 0, postHitDamageMultiplier: 1, postHitInvincible: false, postHitScoreMultiplier: 1, opponentMildSmokeTop: 0, dashCooldownReduction: 0, dashGreenDenominator: 100 };
  if (!flair || !rewriteUnlockedAndEnabled) return effect;
  const paired = flair.key === character;
  switch (flair.key) {
    case "runner_dash":
      // Dash's new line is expressly paired-only; other characters retain its original score flair.
      if (paired) { effect.dashCooldownReduction = 0.5; effect.dashGreenDenominator = 90; }
      break;
    case "runner_stride": effect.scoreMultiplier = 1; effect.laneChangeScore = paired ? 25 : 10; break;
    case "medic_bloom": effect.scoreMultiplier = 1; effect.gemMultiplier = paired ? 1.35 : 1.25; break;
    case "medic_remedy": effect.scoreMultiplier = 1; effect.snowflakeDurationReduction = paired ? 1 : 0.5; effect.frozenScoreMultiplier = 1.1; break;
    case "medic_salve": {
      effect.scoreMultiplier = 1;
      const missingHalfHearts = Math.floor(Math.max(0, maxHp - roundedHealthForConditions(hp)) * 2 + 1e-9);
      effect.waveHealExtra = Math.min(paired ? 0.75 : 0.5, missingHalfHearts * (paired ? 0.15 : 0.1));
      break;
    }
    case "runner_vault": effect.scoreMultiplier = 1; effect.postHitSeconds = 3; effect.postHitDamageMultiplier = paired ? 0 : 0.1; effect.postHitInvincible = paired; effect.postHitScoreMultiplier = paired ? 1 : 0; break;
    case "tank_guard": effect.scoreMultiplier = paired ? 0.95 : 0.92; effect.damageMultiplier = 0.85; break;
    case "trickster_smoke": effect.scoreMultiplier = 1; effect.opponentMildSmokeTop = paired ? 0.4 : 0.2; break;
  }
  return effect;
}
export function flairDescription(flair: InventoryFlair, character: string, rewritten: boolean) {
  if (!rewritten) return `+${Math.round(flair.scoreBonus * 100)}% score. Unlocked with ${flair.characterName}; usable with any character.`;
  const paired = flair.key === character;
  switch (flair.key) {
    case "runner_dash": return paired ? "+0.5 seconds of Dash cooldown reduction; green obstacles appear 1 in 90 times. Retains its original score bonus." : "+" + Math.round(flair.scoreBonus * 100) + "% score. Dash-only cooldown and green-obstacle lines do not apply to other characters.";
    case "runner_stride": return `Every lane change gives ${paired ? 25 : 10} score.`;
    case "medic_bloom": return `${paired ? "1.35" : "1.25"}× gems. Fractions accumulate within the run; only whole gems are displayed and banked.`;
    case "medic_remedy": return `Snowflake freeze lasts ${paired ? 1 : 0.5} seconds less; +10% score while frozen.`;
    case "medic_salve": return `Wave healing gains ${paired ? 0.15 : 0.1} HP per missing half-heart, up to ${paired ? 0.75 : 0.5} HP.`;
    case "runner_vault": return paired ? "Getting hit grants 3 seconds of invincibility without losing score. Further hits refresh it." : "Getting hit grants 90% damage reduction for 3 seconds, but score pauses. Further hits refresh it.";
    case "tank_guard": return `15% less obstacle damage, multiplied with character reductions; ${paired ? 5 : 8}% less score.`;
    case "trickster_smoke": return `In 1v1, mild smoke covers the opponent's top ${paired ? 40 : 20}%.`;
    default: return `+${Math.round(flair.scoreBonus * 100)}% score.`;
  }
}
/** Carry fractional earnings privately. Banking and HUD use whole numbers only. */
export function addFlairGems(previousFractionalTotal: number, baseGemAward: number, multiplier: number) { const before = Math.max(0, previousFractionalTotal); const total = before + Math.max(0, baseGemAward) * Math.max(0, multiplier); return { total, whole: Math.floor(total + 1e-9), addedWhole: Math.floor(total + 1e-9) - Math.floor(before + 1e-9) }; }
