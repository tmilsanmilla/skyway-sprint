import { OVERHAUL_CHARACTERS } from "./overhaul-catalog.ts";
import { roundedHealthForConditions } from "./mastery-rules.ts";

export type OverhaulCounters = Record<string, number>;
export type OverhaulTimers = Record<string, number>;
export type OverhaulHazard = "log" | "spikes" | "rock" | "car" | "barrel" | "snowflake" | "vortex" | "current" | "other";
export interface OverhaulContext {
  name: string; wave: number; hp: number; maxHp: number; lane: number; laneCount: number;
  online: boolean; elapsed: number; waveElapsed: number; sinceLaneChange: number;
  counters: OverhaulCounters; timers: OverhaulTimers; form?: string; opponentName?: string;
}
export interface OverhaulModifiers {
  score: number; speed: number; damage: number; pickupSpeed: number; hazardSpeed: number;
  xp: number; waveHeal: number; snowflakeSeconds: number; inputDelay: number;
  canHeal: boolean; invincible: boolean; invisible: boolean; maxHp: number;
}
const HALF_HEAL = new Set(OVERHAUL_CHARACTERS.filter(c=>c.classKey==="tank").map(c=>c.name));
const count = (c: OverhaulContext, key: string) => c.counters[key] || 0;
const active = (c: OverhaulContext, key: string) => (c.timers[key] || 0) > c.elapsed;
export const primeWave = (wave: number) => {
  if (!Number.isInteger(wave) || wave < 2) return false;
  for (let i = 2; i * i <= wave; i += 1) if (wave % i === 0) return false;
  return true;
};
export const overhaulWaveSeconds = (name: string, online: boolean) => name === "Coil" && !online ? 15 : 40;
export const overhaulWaveSpeed = (name: string, wave: number) => 1 + Math.max(0, wave - 1) * (name === "Streaker" ? 0.35 : 0.2);
export function overhaulModifiers(c: OverhaulContext): OverhaulModifiers {
  const hp = roundedHealthForConditions(c.hp), n = c.name;
  const m: OverhaulModifiers = { score: 1, speed: 1, damage: 1, pickupSpeed: 1, hazardSpeed: 1, xp: 1, waveHeal: HALF_HEAL.has(n) ? 0.5 : 1, snowflakeSeconds: 2.5, inputDelay: 0, canHeal: true, invincible: false, invisible: false, maxHp: c.maxHp };
  switch (n) {
    case "Ace": m.score = 1.14; break;
    case "Dash": m.speed = 1.06; m.score = 1.06; break;
    case "Courier": if (active(c, "courier")) m.score = 1.25; break;
    case "Outpost": m.score = primeWave(c.wave) ? 1.3 : 0.85; m.xp = 1.25; break;
    case "Transfer": m.speed = 1.9; m.score = 1.2; break;
    case "Rocket": m.score = c.wave < 15 ? 0.9 : 1.95; m.speed = c.wave < 15 ? 1 : 1.6; break;
    case "Frontline": m.score = 1 + count(c, "closeDodges") * 0.002; break;
    case "Reactor":
      m.score = hp >= 2 ? 0.9 : hp >= 1.5 ? 1.05 : hp >= 1 ? 1.2 : 1.35;
      m.speed = hp >= 2 ? 0.9 : hp >= 1.5 ? 1.05 : hp >= 1 ? 1.15 : 1.25; break;
    case "Halo": m.score = hp >= roundedHealthForConditions(c.maxHp) ? 1.25 : hp === 0.5 ? 0.85 : 1; break;
    case "Cipher": m.score = 1.75; m.speed = 0.9; m.waveHeal = 0.5; break;
    case "Rind": m.score = 1 + count(c, "melons") * 0.003; break;
    case "Vector": if (c.lane === 0 || c.lane === c.laneCount - 1) m.score = 1.25; break;
    case "Switch": m.score = 1 + count(c, "moves") * 0.001; break;
    case "Melonhead": m.snowflakeSeconds = 3.5; break;
    case "Blitz": m.speed = 1 + 0.05 * c.wave; m.score = 1 + 0.04 * c.wave; break;
    case "Velocity": m.speed = 1 + Math.min(1, count(c, "velocity") / 100); m.score = 1 + Math.min(2, count(c, "velocity") / 50); break;
    case "Cartographer": m.score = c.online && c.opponentName !== "Cartographer" ? 1.11 : 1 + count(c, "drawingBonus"); break;
    case "Zenith": m.score = 1 + 0.02 * c.wave; break;
    case "Streaker": m.score = 1 + count(c, "flawlessTotal") * 0.05; break;
    case "Patch": m.waveHeal=1.5; if (hp === 0.5) m.score = 0.85; break;
    case "Remedy": break;
    case "Salve": m.waveHeal = count(c, "salveUses") >= 2 ? 0 : hp <= 1 ? 2 : 1; break;
    case "Nurse": m.waveHeal=1.5; if(hp===0.5)m.score=0.85; break;
    case "Gauze": m.waveHeal=1.5; if(hp===0.5)m.score=0.85; break;
    case "Kitty": m.waveHeal=1.5; if(hp===0.5)m.score=0.85; break;
    case "Tonic": m.waveHeal=.5;break;
    case "Mender": m.waveHeal = 0; break;
    case "Vial": m.waveHeal=Math.max(0,c.maxHp-c.hp); break;
    case "Balm": m.waveHeal = 2; break;
    case "Pulse": if (count(c, "revived")) m.score = 0.9; break;
    case "Suture": m.waveHeal = c.wave % 3 === 0 ? Math.max(0, c.maxHp - c.hp) : 0.5; break;
    case "Atlas": m.waveHeal = 1.5; break;
    case "Phoenix": if (count(c, "flight")) { m.speed = 1.5; m.score = 1.75; m.canHeal = false; } break;
    case "Pacer": if (c.elapsed < 10 && !c.form) { m.speed = 3; m.score = 5; } break;
    case "Bulwark": m.damage = 0.75; break;
    case "Vault": if (active(c, "vaultBoost")) { m.speed = 1.8; m.score = 1.9; } break;
    case "Warden": m.damage=.75;break;
    case "Guard": m.damage = 0.65; break;
    case "Recruit": m.damage = 0.9; break;
    case "Ironclad": m.damage = 1.3; break;
    case "Brace": m.damage = 1.25; break;
    case "Barrier": m.damage = 1.3; break;
    case "Screw": m.speed = 0.9; m.damage = 0.7; m.inputDelay = 0.1; break;
    case "Bastion": m.damage = 1 - Math.min(1, c.sinceLaneChange * 0.1); m.score = 0.95; break;
    case "Knight": m.maxHp = Number.POSITIVE_INFINITY; break;
    case "Beacon": if (count(c, "beaconLit")) { m.pickupSpeed = 0.85; m.hazardSpeed = 0.85; m.canHeal = false; } break;
    case "Rampart": m.waveHeal = 0.5; break;
    case "Juggernaut": m.maxHp = Math.min(14, 3 + count(c, "bonusMaxHp")); m.score = 1.05; break;
    case "Phantom": m.score = 1 + count(c, "melons") * 0.002; if(c.wave%3===0&&c.wave%5!==0){m.speed=1.5;m.score*=2;m.invincible=c.waveElapsed<5;m.snowflakeSeconds=0;} break;
    case "Seraph": m.waveHeal=count(c,"seraphTeleports")>=20?2:0; break;
    case "General": if (!count(c, "firstAdaptation")) m.damage = 0.9; break;
    case "Drift": m.speed = 1 + Math.min(30, count(c, "drift")) * 0.09; m.score = 1 + Math.min(30, count(c, "drift")) * 0.1; break;
    case "Burglar": if (!c.online) m.score = 0.95; break;
    case "Clockwork": m.hazardSpeed = m.pickupSpeed = Math.max(0.6, 1.2 - c.elapsed * 0.002); break;
    case "Gasser": if (count(c, "gas")) { m.damage = 2; m.speed = 1.2; m.score = 2; } break;
    case "Tempo": m.speed = count(c, "tempoSpeed") || 1; m.score = count(c, "tempoScore") || 1; break;
    case "Spark": m.score = 1 + count(c, "spark") * 0.005; break;
    case "Colossus": m.speed = m.score = 1.05; m.waveHeal = count(c, "waveHits") === 0 ? 1.5 : 0; break;
    case "Relay": m.speed = 1.15; m.waveHeal = 0; break;
    case "Hex": m.damage = 1 - Math.min(0.2, count(c, "damnation") * 0.002); m.score = 1 + Math.max(0, count(c, "damnation") - 100) * 0.002; break;
    case "Eclipse":
      if (count(c, "eclipse") === 1) m.invincible = c.waveElapsed % 7 < 5;
      if (count(c, "eclipse") === 2) { m.score = 1.5; m.hazardSpeed = 1.25; }
      if (count(c, "eclipse") === 4) m.score = 1.2;
      if (c.wave === 20) { m.score = 1.75; m.invincible = c.waveElapsed % 8 < 2; } break;
    case "Echo":
      if (count(c, "knowing")) { const lost = 6 - count(c, "shards"); m.maxHp = Math.max(1, 7 - lost); m.score = 1 + (lost >= 6 ? 1.75 : lost * 0.3); }
      break;
    case "Scout": m.snowflakeSeconds = 1.5; break;
    case "Timekeeper": m.pickupSpeed = 0.85; m.hazardSpeed = 0.95; m.xp = 1 + count(c, "hits") * 0.01; break;
    case "Engineer": break;
    case "Challenger": if (!c.online && !count(c, "ownsSprint")) m.score = 1.14; if (count(c, "secondLife")) { m.speed = 1.5; m.canHeal = false; } break;
    case "Carat": if (active(c, "pterodactyl")) { m.speed = 2.2; m.score = 2.5; } break;
    case "Weaver": if (!count(c, "ownsCourier")) m.score = 1.14; if (count(c, "secondLife")) { m.speed = 2; m.canHeal = false; } break;
    case "Fortune": m.waveHeal = 0.5; break;
    case "Particle": m.xp = 2; m.score = 0.85; break;
    case "Cloak": m.invisible = c.waveElapsed < 15; break;
    case "Spring": if (!c.online) m.score = 1 + count(c, "energy") * 0.006; break;
    case "Glide": m.score = c.wave % 2 === 0 ? 1.35 : 0.8; break;
    case "Hyperlink": if (active(c, "hyperFlight")) { m.speed = 1.9; m.score = 2.6; } break;
    case "Jester":
      if (count(c, "jesterKind") === 1) { m.damage = 0.6; m.waveHeal = 0.5; }
      if (count(c, "jesterKind") === 2) { m.score = 1 + count(c, "jesterPercent") / 100; m.speed = 1 + count(c, "jesterPercent") * 0.03; } break;
    case "Gambit": if (count(c, "revived")) { m.score = 1 + count(c, "diceScore") / 100; m.canHeal = false; } break;
    case "Hammer": m.score = 1.05; m.speed = 0.95; break;
    case "Imagination": m.score = 1.2; break;
    case "Rhythm": m.score = m.speed = 1 + count(c, "rhythm") * 0.03; break;
    case "Bowler": m.score = 1 + count(c, "pins") * 0.001; break;
    case "Prodigy": m.score = count(c, "mathScore") || 1; break;
    case "Conic":
      if (count(c, "shape") === 3) { m.speed = 0.95; m.score = 1.1; }
      if (count(c, "shape") === 7 && active(c, "lemon")) { m.speed = 3; m.score = 4; }
      break;
    case "Mimic": if (count(c, "copyUnavailable")) { m.score = 1.06; m.speed = 0.94; } else if (!c.online) { if (count(c, "mimicChoice") === 1 && c.lane > 0 && c.lane < c.laneCount - 1) m.score = 1.18; if (count(c, "mimicChoice") === 2) { m.hazardSpeed = 0.95; m.xp = 1.35; } } break;
    case "Wildcard": m.score = 1 + count(c, "kings") * 0.03 * (c.online ? 0 : 1); if (!c.online && count(c, "aceClubs")) m.speed = 0.85; if (count(c, "jackSpades")) m.snowflakeSeconds = 1.5; break;
    case "Muse": m.score = 0.95; break;
    case "Surveyor": m.score = 1.05 * (1 + Math.min(0.2, count(c, "surveys") * 0.001)); break;
    case "Prism":
      if (count(c, "prism") === 0) { m.score = 1.2; m.speed = 1.15; }
      if (count(c, "prism") === 1) { m.score = 0.9; m.waveHeal += 0.5; }
      if (count(c, "prism") === 2) { m.speed = 0.9; m.damage = 0.8; } break;
  }
  if (active(c, "generalShield") || active(c, "godShield")) m.invincible = true;
  if (active(c, "phaseInvincible") && !active(c, "phaseWindup")) m.invincible = true;
  return m;
}

/** Per-item modifiers do not mutate shared definitions or cache frame geometry. */
export function overhaulItemSpeed(c: OverhaulContext, kind: string, lane: number) {
  const distance = Math.abs(c.lane - lane), pickup = ["gem", "melon", "coin"].includes(kind);
  let multiplier = 1;
  if (c.name === "Catalyst") multiplier *= pickup ? distance <= 1 ? 1.5 : distance === 2 ? 1.1 : distance === 3 ? 0.7 : 0.5
    : distance === 0 ? 0.8 : distance === 1 ? 0.85 : distance === 2 ? 0.97 : distance === 3 ? 1.09 : 1.15;
  if (c.name === "Drag" && ["barrel", "log"].includes(kind)) multiplier *= 0.8;
  if (c.name === "Recruit" && kind === "barrel" && active(c, "spear")) multiplier *= 0.4;
  if (c.name === "Conic" && count(c, "shape") === 2 && kind === c.form) multiplier *= 2;
  return multiplier;
}

export function overhaulDamage(c: OverhaulContext, source: OverhaulHazard, base: number, roll: number) {
  const m = overhaulModifiers(c); let damage = Math.max(0, base) * m.damage;
  if (m.invincible) return 0;
  const hp = roundedHealthForConditions(c.hp), n = c.name;
  if (n === "Lifeline" && count(c,"revived") && ["barrel","log","spikes","rock","car"][count(c,"lifelineSource")-1]===source)damage*=0.5;
  if (n === "Rind" && source === "barrel") damage = 1;
  if (n === "Balm" && source === "barrel") damage = 1;
  if (n === "Ironclad" && ["log", "vortex"].includes(source)) damage = 0;
  if (n === "Brace" && source === "spikes" || n === "Barrier" && source === "barrel") damage = 0;
  if (n === "Gauze" && (source === "vortex" || source === "snowflake" && count(c, "waveSnowflakes") === 0)) damage = 0;
  if (n === "Mercy" && count(c, "waveHazardHits") < (c.wave <= 3 ? 2 : 1)) damage = 0;
  if (n === "Arch" && source === "rock") damage = 1.5;
  if (n === "Rampart" && source === "car") damage = 0.5;
  if (n === "Beacon" && count(c, "beaconLit") && source === "spikes") damage = 0.5;
  if (n === "Colossus" && source === "rock") damage = hp >= 9 ? 0.5 : hp >= 7.5 ? 1 : hp >= 5 ? 1.5 : 2;
  if (n === "Elixir" && count(c,"moves")>0 && c.sinceLaneChange >= 0.1 && c.sinceLaneChange < 2.1 && roll < 0.6) damage = 0;
  if (n === "Carat" && source === "log" && active(c, "pterodactyl") && roll < 0.3) damage = 0;
  if (n === "General" && ["barrel", "log", "spikes", "rock"].includes(source)) {
    const hits = count(c, "adapt:" + source), sacrificed = count(c, "sacrifice:" + source) > 0;
    if (sacrificed) damage = base * 0.8;
    else if (hits >= 40) damage = base * 0.1;
    else if (hits >= 20) damage = base * 0.3;
    else if (hits >= 10) damage = base * 0.6;
  }
  if (n === "Jester" && count(c, "jesterKind") === 3) {
    if (source === "barrel") damage = 1;
    if (source === "log") damage = 2;
  }
  if (n === "Gambit" && count(c, "diceHand") >= 10 && source === "log") damage = 0.5;
  if (n === "Conic" && count(c, "shape") === 1 && ["barrel", "rock"].includes(source)) damage = 1;
  if (n === "Conic" && count(c, "shape") === 2 && source === c.form) damage *= 0.5;
  return Math.max(0, damage);
}

export const tempoResult = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 2.6 || seconds > 5.4) return { speed: 0.75, score: 0.5, resetStreak: true, harmfulGems: true };
  if (seconds >= 3.8 && seconds <= 4.2) return { speed: 1.25, score: 1.5, resetStreak: false, harmfulGems: false };
  if (seconds >= 3.5 && seconds <= 4.5) return { speed: 1.1, score: 1.2, resetStreak: false, harmfulGems: false };
  if (seconds >= 3.1 && seconds <= 4.9) return { speed: 1, score: 1, resetStreak: false, harmfulGems: false };
  return { speed: 0.9, score: 0.8, resetStreak: true, harmfulGems: false };
};
