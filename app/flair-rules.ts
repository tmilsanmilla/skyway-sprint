import { roundedHealthForConditions } from "./mastery-rules.ts";

/** Embedded mastery effect data; there is no independently equipped flair. */
export interface InventoryFlair { key: string; name: string; characterName: string; scoreBonus: number; }
export interface FlairEffects {
  scoreMultiplier: number; gemMultiplier: number; damageMultiplier: number; snowflakeDurationReduction: number;
  frozenScoreMultiplier: number; laneChangeScore: number; waveHealExtra: number;
  postHitSeconds: number; postHitDamageMultiplier: number; postHitInvincible: boolean; postHitScoreMultiplier: number;
  opponentMildSmokeTop: number; dashCooldownReduction: number; dashGreenDenominator: number;
}
export function getFlairEffects(flair: InventoryFlair | null, character: string, rewriteUnlockedAndEnabled: boolean, hp = 3, maxHp = 3): FlairEffects {
  const effect: FlairEffects = { scoreMultiplier: 1, gemMultiplier: 1, damageMultiplier: 1, snowflakeDurationReduction: 0, frozenScoreMultiplier: 1, laneChangeScore: 0, waveHealExtra: 0, postHitSeconds: 0, postHitDamageMultiplier: 1, postHitInvincible: false, postHitScoreMultiplier: 1, opponentMildSmokeTop: 0, dashCooldownReduction: 0, dashGreenDenominator: 100 };
  if (!flair || flair.key !== character || !rewriteUnlockedAndEnabled) return effect;
  effect.scoreMultiplier=1+flair.scoreBonus;
  const paired = flair.key === character;
  switch (flair.key) {
    case "runner_dash":
      // Embedded Dash mastery applies only to Dash.
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
/** Carry fractional earnings privately. Banking and HUD use whole numbers only. */
export function addFlairGems(previousFractionalTotal: number, baseGemAward: number, multiplier: number) { const before = Math.max(0, previousFractionalTotal); const total = before + Math.max(0, baseGemAward) * Math.max(0, multiplier); return { total, whole: Math.floor(total + 1e-9), addedWhole: Math.floor(total + 1e-9) - Math.floor(before + 1e-9) }; }
