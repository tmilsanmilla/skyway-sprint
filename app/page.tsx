"use client";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { audioEngine, type Soundtrack } from "./audio-engine";
import { AdminPlayerEditor } from "./admin-player-editor";
type Kind =
  "gem" | "coin" | "car" | "log" | "snowflake" | "rock" | "barrel" | "spikes";
type Item = {
  id: number;
  lane: number;
  y: number;
  kind: Kind;
};
type GameMode = "normal" | "hardcore" | "impossible";
type PlayerReport = {
  id: number;
  user_id: string;
  report_type: string;
  message: string;
  status: string;
  created_at: string;
};
type AdminUser = {
  user_id: string;
  email: string;
  username: string | null;
  role: "main" | "co_admin";
};
type PlayerAccess = {
  device_id?: string;
  account_banned: boolean;
  device_banned: boolean;
  leaderboard_banned: boolean;
  active_bans?: Array<{
    id: number;
    scope: string;
    expires_at: string | null;
    reason: string | null;
  }>;
};
type Leader = { rank: number; username: string; high_score: number };
type VersusLeader = {
  rank: number;
  username: string;
  rating: number;
  provisional: boolean;
  matches_played: number;
  wins: number;
  losses: number;
  win_rate: number | string;
  current_streak: number;
  best_streak: number;
  best_wave: number;
  best_score: number;
  coins_collected: number;
  obstacle_points_spent: number;
  is_self: boolean;
};
type Rarity =
  | "common"
  | "uncommon"
  | "rare"
  | "epic"
  | "legendary"
  | "mythic";
const RARITY_ORDER: Readonly<Record<Rarity, number>> = {
  common: 0,
  uncommon: 1,
  rare: 2,
  epic: 3,
  legendary: 4,
  mythic: 5,
};
type Unlock = {
  item_key: string;
  item_type:
    | "class"
    | "character"
    | "player"
    | "obstacle"
    | "environment";
  rarity: Rarity;
};
type ExtractionResult = Unlock & {
  is_new: boolean;
  category: "character" | "cosmetic";
  display_name?: string;
  pull_number?: number;
  draw_profile?: "regular" | "legendary";
};
type StoredLoadout = {
  class_key?: string | null;
  character_key?: string | null;
  player_cosmetic?: string | null;
  obstacle_cosmetic?: string | null;
  environment_cosmetic?: string | null;
} | null;
type ExtractionOption = "regular" | "ten";
type ExtractionAnimation = "idle" | "shaking" | "opening";
type PlayScope = "single" | "versus" | "practice";
type MainView = "endless" | "versus";
type VersusAttackKind =
  | "barrel"
  | "log"
  | "car"
  | "snowflake"
  | "spike"
  | "rock";
type PendingVersusAttack = { id: string; kind: Kind };
type VersusStatePayload = {
  match?: {
    status?: string;
    intermission_ends_at?: string | null;
    winner_user_id?: string | null;
  };
  self?: {
    obstacle_points?: number;
    hearts?: number;
    wave?: number;
    score?: number;
    status?: string;
    character_key?: string | null;
    character_class?: string | null;
    max_hearts?: number | null;
  };
  opponent?: {
    username?: string;
    hearts?: number;
    status?: string;
  };
  pending_attacks?: Array<{
    id?: string;
    obstacle_type?: string;
  }>;
};
const TRACK_LANES = [0, 1, 2, 3, 4] as const;
const AMBIENT_HAZARDS: ReadonlyArray<Kind> = [
  "log",
  "snowflake",
  "rock",
  "barrel",
  "spikes",
];
const MAX_HAZARD_LANES = TRACK_LANES.length - 1;
const MAX_SAME_HAZARD_STREAK = 4;
const isHazardKind = (kind: Kind) => kind !== "gem" && kind !== "coin";
const appendSafeAttackWave = (
  current: Item[],
  hazards: readonly Kind[],
  nextId: () => number,
  spacing: number,
) => {
  if (hazards.length === 0) return current;
  const occupiedHazardLanes = new Set(
    current.filter((item) => isHazardKind(item.kind)).map((item) => item.lane),
  );
  const alreadySafeLanes = TRACK_LANES.filter(
    (lane) => !occupiedHazardLanes.has(lane),
  );
  const safeLane =
    alreadySafeLanes[Math.floor(Math.random() * alreadySafeLanes.length)] ??
    TRACK_LANES[Math.floor(Math.random() * TRACK_LANES.length)];
  const safeCurrent = current.filter(
    (item) => !isHazardKind(item.kind) || item.lane !== safeLane,
  );
  const attackLanes = TRACK_LANES.filter((lane) => lane !== safeLane).sort(
    () => Math.random() - 0.5,
  );
  return [
    ...safeCurrent,
    ...hazards.map((kind, index): Item => ({
      id: nextId(),
      lane: attackLanes[index % attackLanes.length],
      y:
        -10 -
        index * spacing -
        Math.floor(index / MAX_HAZARD_LANES) * spacing,
      kind,
    })),
  ];
};
const AUDIO_PREFERENCES_KEY = "skyway.audio.v1";
const DEVICE_TOKEN_KEY = "skyway.device.v1";
const getOrCreateDeviceToken = () => {
  try {
    const stored = window.localStorage.getItem(DEVICE_TOKEN_KEY);
    if (stored && /^[a-f0-9-]{36}$/i.test(stored)) return stored;
    const token = window.crypto.randomUUID();
    window.localStorage.setItem(DEVICE_TOKEN_KEY, token);
    return token;
  } catch {
    return window.crypto.randomUUID();
  }
};
const SOUNDTRACKS: ReadonlyArray<{
  id: Soundtrack;
  name: string;
  description: string;
  icon: string;
}> = [
  { id: "jazz", name: "JAZZ", description: "Swing · keys · bass", icon: "♬" },
  { id: "calm", name: "CALM", description: "Soft · dreamy · slow", icon: "☁" },
  {
    id: "energetic",
    name: "ENERGETIC",
    description: "Fast · bright · driving",
    icon: "⚡",
  },
];
const VERSUS_ATTACKS: ReadonlyArray<{
  kind: VersusAttackKind;
  label: string;
  cost: 2 | 3;
  icon: string;
  description: string;
}> = [
  {
    kind: "barrel",
    label: "BARREL",
    cost: 2,
    icon: "◉",
    description: "Fast roll · 0.5 HP",
  },
  {
    kind: "log",
    label: "LOG",
    cost: 2,
    icon: "▬",
    description: "Steady obstacle · 1 HP",
  },
  {
    kind: "car",
    label: "CAR",
    cost: 3,
    icon: "▰",
    description: "Fast lane pressure",
  },
  {
    kind: "snowflake",
    label: "SNOWFLAKE",
    cost: 3,
    icon: "❄",
    description: "3-second freeze · every turn delayed 0.25 seconds",
  },
  {
    kind: "spike",
    label: "SPIKES",
    cost: 3,
    icon: "▲",
    description: "Warning flash · ground trap",
  },
  {
    kind: "rock",
    label: "ROCK",
    cost: 3,
    icon: "◆",
    description: "Slow threat · 2 HP",
  },
];
const VERSUS_INTERMISSION_SECONDS = 10;
const VERSUS_MAX_HEARTS = 6;
const createVersusPickupNonce = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
const isTransportLikeError = (message: string) => {
  const normalized = message.toLowerCase();
  return [
    "network",
    "fetch",
    "timeout",
    "timed out",
    "connection",
    "socket",
    "load failed",
  ].some((fragment) => normalized.includes(fragment));
};
const isCoinSetupError = (message: string) => {
  const normalized = message.toLowerCase();
  return [
    "schema cache",
    "could not find the function",
    "function public.award_1v1_points",
    "valid coin pickup id",
    "coins must be awarded",
    "invalid coin",
  ].some((fragment) => normalized.includes(fragment));
};
const isCoinMatchStateError = (message: string) => {
  const normalized = message.toLowerCase();
  return [
    "match not found",
    "no longer active",
    "active 1v1 play",
    "sign in required",
  ].some((fragment) => normalized.includes(fragment));
};
const normalizeVersusHearts = (value: number) => {
  const finiteValue = Number.isFinite(value) ? value : 0;
  return Math.min(
    VERSUS_MAX_HEARTS,
    Math.max(0, Math.round(finiteValue * 2) / 2),
  );
};
const normalizeVersusObstacle = (value: unknown): Kind | null => {
  if (value === "spike" || value === "spikes") return "spikes";
  if (
    value === "barrel" ||
    value === "log" ||
    value === "car" ||
    value === "snowflake" ||
    value === "rock"
  )
    return value;
  return null;
};
const BOT_MAX_HEARTS = 3;
const VERSUS_ATTACK_DAMAGE: Readonly<Record<VersusAttackKind, number>> = {
  barrel: 0.5,
  log: 1,
  car: 1,
  snowflake: 0,
  spike: 1,
  rock: 2,
};
const simulateBotWave = (
  currentHearts: number,
  attacks: readonly VersusAttackKind[],
  waveNumber: number,
  random: () => number = Math.random,
) => {
  let nextHearts = currentHearts;
  let chilled = false;
  let landed = 0;
  let dodged = 0;
  const ambientHitChance = Math.min(0.48, 0.08 + waveNumber * 0.018);
  if (random() < ambientHitChance) {
    const ambientDamage = [0.5, 1, 1, 2][Math.floor(random() * 4)];
    nextHearts -= ambientDamage;
    landed += 1;
  }
  attacks.forEach((attack) => {
    const dodgeChance = Math.max(
      0.3,
      0.68 - waveNumber * 0.008 - (chilled ? 0.18 : 0),
    );
    if (random() < dodgeChance) {
      dodged += 1;
      return;
    }
    landed += 1;
    if (attack === "snowflake") {
      chilled = true;
      return;
    }
    nextHearts -= VERSUS_ATTACK_DAMAGE[attack];
  });
  if (nextHearts > 0)
    nextHearts = Math.min(BOT_MAX_HEARTS, nextHearts + 1);
  return {
    hearts: Math.max(0, nextHearts),
    landed,
    dodged,
  };
};
const secondsUntil = (value: unknown, fallback: number) => {
  if (typeof value !== "string") return fallback;
  const deadline = Date.parse(value);
  if (!Number.isFinite(deadline)) return fallback;
  return Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
};
type VersusPhase =
  "idle" | "searching" | "ready" | "playing" | "intermission" | "finished";
const CLASS_CHARACTERS = {
  runner: [
    { key: "runner_ace", name: "Ace", weapon: "Baton", rarity: "common" },
    { key: "runner_dash", name: "Dash", weapon: "Jet Baton", rarity: "common" },
    { key: "runner_stride", name: "Stride", weapon: "Pace Blades", rarity: "common" },
    { key: "tank_glacier", name: "Glacier", weapon: "Frost Shield", rarity: "uncommon" },
    { key: "runner_courier", name: "Courier", weapon: "Parcel Staff", rarity: "uncommon" },
    { key: "runner_tempo", name: "Tempo", weapon: "Rhythm Rod", rarity: "uncommon" },
    { key: "tank_reactor", name: "Reactor", weapon: "Core Maul", rarity: "rare" },
    { key: "runner_vector", name: "Vector", weapon: "Arrow Lance", rarity: "rare" },
    { key: "runner_blitz", name: "Blitz", weapon: "Volt Cleats", rarity: "rare" },
    { key: "medic_halo", name: "Halo", weapon: "Sun Staff", rarity: "epic" },
    { key: "runner_orbit", name: "Orbit", weapon: "Ring Blades", rarity: "epic" },
    { key: "runner_relay", name: "Relay", weapon: "Circuit Baton", rarity: "epic" },
    { key: "runner_horizon", name: "Horizon", weapon: "Skyline Disc", rarity: "epic" },
    { key: "runner_velocity", name: "Velocity", weapon: "Turbo Spear", rarity: "legendary" },
    { key: "runner_pacer", name: "Pacer", weapon: "Relay Rod", rarity: "mythic" },
    { key: "runner_zenith", name: "Zenith", weapon: "Apex Relay", rarity: "mythic" },
  ],
  medic: [
    { key: "medic_patch", name: "Patch", weapon: "Med Staff", rarity: "common" },
    { key: "medic_bloom", name: "Bloom", weapon: "Bloom Wand", rarity: "common" },
    { key: "medic_remedy", name: "Remedy", weapon: "Tonic Bell", rarity: "common" },
    { key: "medic_salve", name: "Salve", weapon: "Remedy Brush", rarity: "common" },
    { key: "medic_reserve", name: "Reserve", weapon: "Field Pack", rarity: "uncommon" },
    { key: "medic_sprout", name: "Sprout", weapon: "Seed Scepter", rarity: "uncommon" },
    { key: "medic_mender", name: "Mender", weapon: "Clock Needle", rarity: "rare" },
    { key: "medic_pulse", name: "Pulse", weapon: "Pulse Syringe", rarity: "rare" },
    { key: "medic_tonic", name: "Tonic", weapon: "Vital Flask", rarity: "rare" },
    { key: "medic_suture", name: "Suture", weapon: "Pulse Thread", rarity: "epic" },
    { key: "medic_beacon", name: "Beacon", weapon: "Rescue Lamp", rarity: "epic" },
    { key: "medic_lifeline", name: "Lifeline", weapon: "Rescue Hook", rarity: "legendary" },
    { key: "medic_seraph", name: "Seraph", weapon: "Halo Staff", rarity: "legendary" },
    { key: "tank_atlas", name: "Atlas", weapon: "World Maul", rarity: "legendary" },
    { key: "medic_revive", name: "Revive", weapon: "Phoenix Needle", rarity: "legendary" },
    { key: "medic_oracle", name: "Oracle", weapon: "Fate Censer", rarity: "mythic" },
  ],
  tank: [
    { key: "tank_bulwark", name: "Bulwark", weapon: "Tower Shield", rarity: "common" },
    { key: "runner_vault", name: "Vault", weapon: "Spring Pole", rarity: "common" },
    { key: "tank_guard", name: "Guard", weapon: "Iron Buckler", rarity: "common" },
    { key: "tank_brace", name: "Brace", weapon: "Spike Buckler", rarity: "uncommon" },
    { key: "tank_ironclad", name: "Ironclad", weapon: "Plate Hammer", rarity: "uncommon" },
    { key: "medic_mercy", name: "Mercy", weapon: "Injector", rarity: "rare" },
    { key: "tank_hammer", name: "Hammer", weapon: "War Hammer", rarity: "rare" },
    { key: "tank_anchor", name: "Anchor", weapon: "Ground Hook", rarity: "rare" },
    { key: "tank_warden", name: "Warden", weapon: "Lock Shield", rarity: "rare" },
    { key: "tank_bastion", name: "Bastion", weapon: "Fortress Shield", rarity: "epic" },
    { key: "tank_rampart", name: "Rampart", weapon: "Siege Wall", rarity: "epic" },
    { key: "trickster_jester", name: "Jester", weapon: "Card Fan", rarity: "epic" },
    { key: "tank_citadel", name: "Citadel", weapon: "Rampart Axe", rarity: "epic" },
    { key: "tank_sentinel", name: "Sentinel", weapon: "Steel Spear", rarity: "legendary" },
    { key: "tank_colossus", name: "Colossus", weapon: "Titan Maul", rarity: "legendary" },
    { key: "trickster_phantom", name: "Phantom", weapon: "Moon Scythe", rarity: "mythic" },
  ],
  trickster: [
    { key: "trickster_smoke", name: "Smoke", weapon: "Smoke Bombs", rarity: "common" },
    { key: "runner_drift", name: "Drift", weapon: "Slipstream Shoes", rarity: "uncommon" },
    { key: "runner_spark", name: "Spark", weapon: "Prism Baton", rarity: "uncommon" },
    { key: "tank_plow", name: "Plow", weapon: "Ram Shield", rarity: "uncommon" },
    { key: "trickster_rogue", name: "Rogue", weapon: "Daggers", rarity: "uncommon" },
    { key: "trickster_clockwork", name: "Clockwork", weapon: "Time Cards", rarity: "uncommon" },
    { key: "trickster_flicker", name: "Flicker", weapon: "Blink Knives", rarity: "uncommon" },
    { key: "runner_flare", name: "Flare", weapon: "Signal Spear", rarity: "rare" },
    { key: "trickster_pickpocket", name: "Pickpocket", weapon: "Coin Dagger", rarity: "rare" },
    { key: "trickster_switch", name: "Switch", weapon: "Twin Coins", rarity: "rare" },
    { key: "trickster_gambit", name: "Gambit", weapon: "Loaded Cards", rarity: "rare" },
    { key: "medic_vial", name: "Vial", weapon: "Tonic Flask", rarity: "epic" },
    { key: "trickster_mirage", name: "Mirage", weapon: "Prism Fans", rarity: "epic" },
    { key: "runner_comet", name: "Comet", weapon: "Star Spear", rarity: "legendary" },
    { key: "trickster_hex", name: "Hex", weapon: "Void Chakram", rarity: "legendary" },
    { key: "trickster_echo", name: "Echo", weapon: "Repeat Knives", rarity: "mythic" },
  ],
  misc: [
    { key: "runner_scout", name: "Scout", weapon: "Twin Blades", rarity: "common" },
    { key: "tank_drag", name: "Drag", weapon: "Chain Hook", rarity: "common" },
    { key: "misc_nomad", name: "Nomad", weapon: "Trail Hook", rarity: "common" },
    { key: "misc_tinker", name: "Tinker", weapon: "Gear Wrench", rarity: "common" },
    { key: "runner_ranger", name: "Ranger", weapon: "Pixel Bow", rarity: "uncommon" },
    { key: "misc_broker", name: "Broker", weapon: "Coin Cane", rarity: "uncommon" },
    { key: "misc_prospector", name: "Prospector", weapon: "Gem Pick", rarity: "uncommon" },
    { key: "misc_lantern", name: "Lantern", weapon: "Glow Rod", rarity: "uncommon" },
    { key: "runner_fortune", name: "Fortune", weapon: "Lucky Compass", rarity: "rare" },
    { key: "misc_scribe", name: "Scribe", weapon: "Rune Quill", rarity: "rare" },
    { key: "misc_weaver", name: "Weaver", weapon: "Thread Blades", rarity: "rare" },
    { key: "trickster_wildcard", name: "Wildcard", weapon: "Dice Fans", rarity: "epic" },
    { key: "misc_mimic", name: "Mimic", weapon: "Copy Mask", rarity: "epic" },
    { key: "misc_catalyst", name: "Catalyst", weapon: "Flux Vial", rarity: "epic" },
    { key: "misc_harvester", name: "Harvester", weapon: "Crescent Sickle", rarity: "legendary" },
    { key: "misc_muse", name: "Muse", weapon: "Dream Harp", rarity: "mythic" },
  ],
} as const satisfies Record<
  string,
  ReadonlyArray<{
    key: string;
    name: string;
    weapon: string;
    rarity: Rarity;
  }>
>;
type RosterCharacterKey =
  (typeof CLASS_CHARACTERS)[keyof typeof CLASS_CHARACTERS][number]["key"];
type CharacterClassKey = keyof typeof CLASS_CHARACTERS;
const getCharacterClassKey = (characterKey: string): CharacterClassKey =>
  (Object.keys(CLASS_CHARACTERS) as CharacterClassKey[]).find((classKey) =>
    CLASS_CHARACTERS[classKey].some(
      (character) => character.key === characterKey,
    ),
  ) ?? "runner";
const CHARACTER_ABILITIES = {
  runner_ace: {
    name: "MOMENTUM",
    description: "Can earn 10% more score.",
  },
  runner_dash: {
    name: "JET STEP",
    description: "Can move 6% faster and earn 6% more distance score.",
  },
  runner_stride: {
    name: "CENTER STRIDE",
    description: "Can earn 12% more distance score while in the middle three lanes.",
  },
  runner_courier: {
    name: "SPECIAL DELIVERY",
    description: "Can earn 25% more distance score for 4 seconds after collecting a gem or coin.",
  },
  runner_tempo: {
    name: "EVEN TEMPO",
    description: "Can earn 18% more distance score during every even-numbered wave.",
  },
  runner_vector: {
    name: "EDGE VECTOR",
    description: "Can earn 25% more distance score while in either outside lane.",
  },
  runner_blitz: {
    name: "BLITZ PACE",
    description: "Can move 12% faster and earn 12% more distance score.",
  },
  runner_horizon: {
    name: "FAR HORIZON",
    description: "Can earn 30% more distance score from wave 10 onward.",
  },
  runner_velocity: {
    name: "FULL VELOCITY",
    description: "Can move 20% faster and earn 20% more distance score.",
  },
  runner_zenith: {
    name: "ZENITH CLIMB",
    description: "Can add 2% distance score per completed wave, up to 60%.",
  },
  runner_scout: {
    name: "QUICKSTEP",
    description:
      "Can ignore snowflake freeze. Can gain 1 second of invincibility from a snowflake every 4 seconds.",
  },
  runner_drift: {
    name: "SLIPSTREAM",
    description:
      "Can gain 15% more score for 1.25 seconds after a lane change. Another lane change refreshes the boost.",
  },
  runner_ranger: {
    name: "PICKUP MAGNET",
    description: "Can collect gems and coins from either neighboring lane.",
  },
  runner_fortune: {
    name: "FORTUNE FINDER",
    description: "Can make gems appear 2× as often.",
  },
  runner_relay: {
    name: "BATON CHAIN",
    description: "Can add 3% more score per completed wave, up to 30%.",
  },
  runner_comet: {
    name: "STAR DRIVE",
    description:
      "Can earn 50% more score after 8 seconds without damage. The boost ends when hit.",
  },
  runner_pacer: {
    name: "WAVE RUSH",
    description:
      "Can make hazards move 3× faster and add a 5× score boost for the first 15 seconds of each wave, producing a 15× score rate before other bonuses.",
  },
  runner_vault: {
    name: "SPIKE VAULT",
    description: "Can vault over spikes and take no damage from them.",
  },
  runner_spark: {
    name: "CRYSTAL CHARGE",
    description:
      "Can earn 50% more score for 10 seconds after collecting a gem. Another gem refreshes the boost.",
  },
  runner_flare: {
    name: "CLEAN RUN",
    description:
      "Can earn 50% more score during the next wave after completing a wave without taking damage.",
  },
  runner_orbit: {
    name: "LANE ORBIT",
    description:
      "Can wrap from one outside lane to the other by moving outward. Cooldown: 5 seconds.",
  },
  medic_patch: {
    name: "FIELD DRESSING",
    description: "Can heal 1.5 HP after each wave and reach 5 HP.",
  },
  medic_salve: {
    name: "DEEP SALVE",
    description: "Can heal 1.5 HP after a wave when at 2 HP or less.",
  },
  medic_sprout: {
    name: "GROWTH CYCLE",
    description: "Can heal 0.5 HP with every second gem collected.",
  },
  medic_tonic: {
    name: "FIRST TONIC",
    description: "Can heal 0.5 HP from the first gem or coin collected each wave.",
  },
  medic_beacon: {
    name: "BEACON HEART",
    description: "Can reach 5.5 HP.",
  },
  medic_revive: {
    name: "PHOENIX REVIVE",
    description: "Can survive one lethal hit per run with 0.5 HP.",
  },
  medic_oracle: {
    name: "THIRD OMEN",
    description: "Can reach 6 HP and heal 2 HP after every third wave instead of 1 HP.",
  },
  medic_bloom: {
    name: "HEALING BLOOM",
    description: "Can heal 0.5 HP with the first gem collected each wave.",
  },
  medic_mercy: {
    name: "GRACE GUARD",
    description:
      "Can reduce the first hit worth at least 1 HP by 0.5 HP once each wave.",
  },
  medic_pulse: {
    name: "VITAL PULSE",
    description: "Can heal 1 HP with every third gem collected.",
  },
  medic_suture: {
    name: "TRIAGE CYCLE",
    description: "Can restore HP to 5 after every third completed wave.",
  },
  medic_vial: {
    name: "CRYSTAL TONIC",
    description: "Can gain 2 seconds of invincibility from every gem.",
  },
  medic_lifeline: {
    name: "LIFELINE",
    description:
      "Can heal 1.5 HP once per run after surviving a hit at 1 HP or less.",
  },
  medic_seraph: {
    name: "DIVINE RECOVERY",
    description: "Can reach 5.5 HP and heal 1.5 HP after each wave.",
  },
  medic_remedy: {
    name: "COLD REMEDY",
    description:
      "Can heal 0.5 HP from the first snowflake collected each wave.",
  },
  medic_reserve: {
    name: "RESERVE DOSE",
    description:
      "Can store one 0.5 HP heal when a wave ends at full HP, then use it after surviving a hit.",
  },
  medic_mender: {
    name: "STEADY MEND",
    description:
      "Can heal 0.5 HP once each wave after avoiding damage for 12 seconds.",
  },
  medic_halo: {
    name: "RADIANT PACE",
    description: "Can earn 15% more score while at full HP.",
  },
  tank_bulwark: {
    name: "HEAVY PLATE",
    description:
      "Can reduce the first hit worth at least 1 HP by 0.5 HP once each wave.",
  },
  tank_guard: {
    name: "EXTRA PLATE",
    description: "Can reach 4.5 HP.",
  },
  tank_ironclad: {
    name: "IRON SHELL",
    description: "Can reduce log damage to 0.5 HP.",
  },
  tank_warden: {
    name: "SPIKE LOCK",
    description: "Can ignore the first spike hit each wave.",
  },
  tank_citadel: {
    name: "EVEN WALL",
    description: "Can ignore the first damaging hit during every even-numbered wave.",
  },
  tank_colossus: {
    name: "COLOSSUS FRAME",
    description: "Can reach 5.5 HP and reduce rock damage to 1.5 HP.",
  },
  tank_glacier: {
    name: "FROST ARMOR",
    description:
      "Can cut snowflake freeze to 1.5 seconds and frozen lane-change delay to 0.125 seconds.",
  },
  tank_brace: {
    name: "SPIKE BRACE",
    description: "Can reduce spike damage to 0.5 HP.",
  },
  tank_hammer: {
    name: "DEMOLITION",
    description:
      "Can reach 5 HP, reduce log damage to 0.5 HP, and ignore the first barrel each wave.",
  },
  tank_anchor: {
    name: "STONEGUARD",
    description: "Can reduce rock damage to 1 HP.",
  },
  tank_rampart: {
    name: "THIRD WALL",
    description: "Can ignore every third damaging collision.",
  },
  tank_sentinel: {
    name: "LAST STAND",
    description: "Can survive one lethal hit per run with 0.5 HP.",
  },
  tank_atlas: {
    name: "WORLD BEARER",
    description: "Can reach 6 HP and heal 1 HP after each wave.",
  },
  tank_drag: {
    name: "HEAVY DRAG",
    description: "Can make barrels and logs move 15% slower.",
  },
  tank_plow: {
    name: "LANE PLOW",
    description:
      "Can clear the remaining hazards in the current lane after surviving a hit.",
  },
  tank_reactor: {
    name: "DANGER CORE",
    description: "Can earn 25% more score while at 2 HP or less.",
  },
  tank_bastion: {
    name: "HOLD GROUND",
    description:
      "Can gain 0.5 HP of armor after staying in one lane for 6 seconds. Moving before it charges restarts the timer. The next damaging hit consumes the armor.",
  },
  trickster_rogue: {
    name: "SHADOWSTEP",
    description:
      "Can gain 0.45 seconds of invincibility by grazing an adjacent hazard. Cooldown: 1.25 seconds.",
  },
  trickster_echo: {
    name: "ECHO GRAZE",
    description: "Can gain 0.65 seconds of invincibility and 40 score by grazing an adjacent hazard. Cooldown: 2 seconds.",
  },
  trickster_flicker: {
    name: "FIRST FLICKER",
    description:
      "Can gain 0.75 seconds of invincibility from the first lane change each wave.",
  },
  trickster_switch: {
    name: "REVERSAL",
    description:
      "Can gain 0.5 seconds of invincibility by reversing lane-change direction. Cooldown: 2 seconds.",
  },
  trickster_gambit: {
    name: "HIGH STAKES",
    description:
      "Can gain 75% more score for 2 seconds by grazing an adjacent hazard. Cooldown: 2.5 seconds.",
  },
  trickster_jester: {
    name: "ENCORE",
    description: "Can start every wave with 2.5 seconds of invincibility.",
  },
  trickster_mirage: {
    name: "AFTERIMAGE",
    description:
      "Can gain 0.65 seconds of invincibility from a lane change. Cooldown: 2.5 seconds.",
  },
  trickster_hex: {
    name: "VOID CUT",
    description:
      "Can destroy the nearest damaging obstacle in the destination lane every third lane change.",
  },
  trickster_phantom: {
    name: "PHASE VEIL",
    description: "Can ignore the first damaging obstacle each wave.",
  },
  trickster_smoke: {
    name: "SMOKE SCREEN",
    description:
      "Can make hazards move 35% slower for 2.5 seconds after surviving a hit.",
  },
  trickster_clockwork: {
    name: "TIME TRICK",
    description:
      "Can make hazards move 30% slower for 1.25 seconds after every sixth lane change. Cooldown: 5 seconds.",
  },
  trickster_pickpocket: {
    name: "CLOSE COUNT",
    description: "Can gain 75 score after every seventh hazard safely passed.",
  },
  trickster_wildcard: {
    name: "LUCKY DRAW",
    description:
      "Can draw one wave-long bonus: 15% more score, 50% more gem spawns, or 15% slower hazards.",
  },
  misc_nomad: {
    name: "OPEN ROAD",
    description: "Can make every hazard move 7% slower.",
  },
  misc_tinker: {
    name: "SPIKE TIMER",
    description: "Can make spikes move 25% slower.",
  },
  misc_broker: {
    name: "BETTER MARKET",
    description: "Can make gems and 1v1 coins appear 25% more often.",
  },
  misc_prospector: {
    name: "GEM SURVEY",
    description: "Can make gems appear 60% more often.",
  },
  misc_lantern: {
    name: "DANGER LIGHT",
    description: "Can make rocks and spikes move 15% slower.",
  },
  misc_scribe: {
    name: "THREE-RUNE RULE",
    description: "Can limit consecutive spawns of the same hazard to 3 instead of 4.",
  },
  misc_weaver: {
    name: "THAWING THREAD",
    description: "Can make snowflakes move 35% slower.",
  },
  misc_mimic: {
    name: "COPIED CYCLE",
    description: "Can cycle each wave between hazards 10% slower, gems 50% more often, and pickups 25% slower.",
  },
  misc_catalyst: {
    name: "FLUX FIELD",
    description: "Can make gems and coins move 25% slower.",
  },
  misc_harvester: {
    name: "CAREFUL HARVEST",
    description: "Can make gems and coins move 35% slower.",
  },
  misc_muse: {
    name: "DREAM CONTROL",
    description: "Can make every hazard move 12% slower and limit consecutive matching hazards to 2.",
  },
} as const satisfies Record<
  RosterCharacterKey,
  { name: string; description: string }
>;
type CharacterKey = RosterCharacterKey;
const CHARACTER_ROSTER = Object.values(CLASS_CHARACTERS).flat();
const getValidatedVersusCharacter = (
  characterValue: unknown,
  classValue: unknown,
) => {
  const characterKey =
    typeof characterValue === "string" &&
    Object.prototype.hasOwnProperty.call(CHARACTER_ABILITIES, characterValue)
      ? (characterValue as CharacterKey)
      : "runner_ace";
  const catalogClass = getCharacterClassKey(characterKey);
  const requestedClass =
    typeof classValue === "string" &&
    Object.prototype.hasOwnProperty.call(CLASS_CHARACTERS, classValue)
      ? (classValue as CharacterClassKey)
      : null;
  const characterClass =
    requestedClass &&
    CLASS_CHARACTERS[requestedClass].some(
      (character) => character.key === characterKey,
    )
      ? requestedClass
      : catalogClass;
  return { characterKey, characterClass };
};
const getCharacterMaxHearts = (
  characterKey: string,
  characterClass: string,
) =>
  characterKey === "medic_oracle" || characterKey === "tank_atlas"
    ? 6
    : characterKey === "medic_seraph" ||
        characterKey === "medic_beacon" ||
        characterKey === "tank_colossus"
      ? 5.5
      : characterKey === "tank_guard"
        ? 4.5
        : characterKey === "tank_hammer" || characterClass === "medic"
          ? 5
          : characterClass === "tank"
            ? 4
            : characterClass === "trickster"
              ? 2
              : 3;
const WEAPON_SCORE_BONUS_BY_RARITY: Readonly<Record<Rarity, number>> = {
  common: 0.03,
  uncommon: 0.04,
  rare: 0.05,
  epic: 0.06,
  legendary: 0.07,
  mythic: 0.08,
};
const getCharacterDefinition = (characterKey: string) =>
  CHARACTER_ROSTER.find((character) => character.key === characterKey) ??
  CLASS_CHARACTERS.runner[0];
const getWeaponScoreBonus = (rarity: Rarity) =>
  WEAPON_SCORE_BONUS_BY_RARITY[rarity];
const getWeaponScoreLabel = (rarity: Rarity) =>
  `+${Math.round(getWeaponScoreBonus(rarity) * 100)}% DISTANCE SCORE`;
const STARTER_CHARACTER_KEYS: ReadonlySet<CharacterKey> = new Set([
  "runner_ace",
  "medic_patch",
  "tank_bulwark",
  "trickster_rogue",
]);
const isStarterCharacter = (characterKey?: string | null) =>
  Boolean(
    characterKey &&
      STARTER_CHARACTER_KEYS.has(characterKey as CharacterKey),
  );
const isCharacterOwned = (
  owned: Unlock[],
  characterKey?: string | null,
) =>
  Boolean(
    characterKey &&
      (isStarterCharacter(characterKey) ||
        owned.some(
          (item) =>
            item.item_type === "character" &&
            item.item_key === characterKey,
        )),
  );
const normalizeOwnedLoadout = (owned: Unlock[], loadout: StoredLoadout) => {
  const owns = (itemType: Unlock["item_type"], itemKey?: string | null) =>
    Boolean(
      itemKey &&
        owned.some(
          (item) =>
            item.item_type === itemType && item.item_key === itemKey,
        ),
    );
  const requestedCharacter = loadout?.character_key ?? "runner_ace";
  const characterKey =
    requestedCharacter in CHARACTER_ABILITIES &&
    isCharacterOwned(owned, requestedCharacter)
      ? requestedCharacter
      : "runner_ace";
  const classKey = getCharacterClassKey(characterKey);
  return {
    classKey,
    characterKey,
    playerCosmetic: owns("player", loadout?.player_cosmetic)
      ? loadout?.player_cosmetic ?? ""
      : "",
    obstacleCosmetic: owns("obstacle", loadout?.obstacle_cosmetic)
      ? loadout?.obstacle_cosmetic ?? ""
      : "",
    environmentCosmetic: owns("environment", loadout?.environment_cosmetic)
      ? loadout?.environment_cosmetic ?? ""
      : "",
  };
};
const BASE_ITEM_SPEED = 0.0452;
const WAVE_SPEED_STEP = 0.25;
const getWaveSpeedMultiplier = (waveNumber: number) =>
  1 + Math.max(0, waveNumber - 1) * WAVE_SPEED_STEP;
const INVENTORY_CLASSES: ReadonlyArray<{
  key: keyof typeof CLASS_CHARACTERS;
  label: string;
  description: string;
}> = [
  {
    key: "runner",
    label: "RUNNER",
    description: "Movement or score.",
  },
  {
    key: "medic",
    label: "HEALER",
    description: "Special healing or HP.",
  },
  {
    key: "tank",
    label: "TANK",
    description: "Less damage or more health, but not healing.",
  },
  {
    key: "trickster",
    label: "TRICKSTER",
    description: "Special actions trigger invincibility or other rewards.",
  },
  {
    key: "misc",
    label: "MISC",
    description: "Everything else.",
  },
];
const EXTRACTION_UNIT_COST = 4;
const EXTRACTION_MAX_QUANTITY = 100;
const EXTRACTION_BOXES = {
  regular: {
    name: "NORMAL BOX",
    cost: EXTRACTION_UNIT_COST,
    pullCount: 1,
    icon: "◇",
    mix: "5% CHARACTER + WEAPON · 95% COSMETIC",
    oddsLabel: "NORMAL PULL ODDS",
    note:
      "DUPLICATES AWARD NOTHING · EVERY 10TH ITEM IN ONE MULTI-OPEN USES THE 10× BONUS ODDS",
    odds: [
      ["common", "45.75%"],
      ["uncommon", "30.2%"],
      ["rare", "15.4%"],
      ["epic", "8%"],
      ["legendary", "1%"],
      ["mythic", "0.01%"],
    ],
  },
  ten: {
    name: "10 NORMAL BOXES",
    cost: EXTRACTION_UNIT_COST * 10,
    pullCount: 10,
    icon: "◇×10",
    mix: "9 NORMAL PULLS · 1 LEGENDARY-ODDS PULL",
    oddsLabel: "10TH: 20% CHARACTER + WEAPON · 80% COSMETIC",
    note: "DUPLICATES AWARD NOTHING · THE 10TH PULL IS NOT GUARANTEED NEW",
    odds: [
      ["common", "3%"],
      ["uncommon", "12%"],
      ["rare", "40.3%"],
      ["epic", "41.5%"],
      ["legendary", "3%"],
      ["mythic", "0.2%"],
    ],
  },
} as const satisfies Record<
  ExtractionOption,
  {
    name: string;
    cost: number;
    pullCount: 1 | 10;
    icon: string;
    mix: string;
    oddsLabel: string;
    note: string;
    odds: readonly (readonly [Rarity, string])[];
  }
>;
const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
);
function Obstacle({ kind }: { kind: Kind }) {
  if (kind === "gem") return <span>♦</span>;
  if (kind === "coin") return <span>●</span>;

  if (kind === "barrel")
    return (
      <div className="barrel-shape">
        <i />
        <b />
        <em />
      </div>
    );
  if (kind === "car")
    return (
      <div className="car-shape">
        <i className="windshield" />
        <i className="light left" />
        <i className="light right" />
        <i className="wheel left" />
        <i className="wheel right" />
        <b />
      </div>
    );
  if (kind === "spikes")
    return (
      <div className="ground-spike-shape">
        <span>!</span>
        <i />
        <i />
        <i />
        <i />
      </div>
    );
  if (kind === "log")
    return (
      <div className="log-shape">
        <i />
        <b />
        <em />
      </div>
    );
  if (kind === "snowflake") return <span>❄</span>;
  return (
    <div className="rock-shape">
      <u />
      <i />
      <b />
      <em />
    </div>
  );
}
export default function Home() {
  const [lane, setLane] = useState(2),
    [items, setItems] = useState<Item[]>([]),
    [score, setScore] = useState(0),
    [waveProgress, setWaveProgress] = useState(0),
    [gems, setGems] = useState(0),
    [highScore, setHighScore] = useState(0),
    [gemBump, setGemBump] = useState(false),
    [hearts, setHearts] = useState(3),
    [wave, setWave] = useState(1),
    [running, setRunning] = useState(false),
    [paused, setPaused] = useState(false),
    [pauseMenuOpen, setPauseMenuOpen] = useState(false),
    [wavePause, setWavePause] = useState(false),
    [waveMessage, setWaveMessage] = useState(""),
    [over, setOver] = useState(false),
    [flash, setFlash] = useState(""),
    [invincible, setInvincible] = useState(false),
    [slowed, setSlowed] = useState(false),
    [abilityNotice, setAbilityNotice] = useState(""),
    [shopOpen, setShopOpen] = useState(false),
    [shopStatus, setShopStatus] = useState(""),
    [inventoryOpen, setInventoryOpen] = useState(false),
    [inventoryStatus, setInventoryStatus] = useState(""),
    [extractBusy, setExtractBusy] = useState(false),
    [extractQuantities, setExtractQuantities] = useState<
      Record<ExtractionOption, number>
    >({ regular: 1, ten: 1 }),
    [extractingOption, setExtractingOption] =
      useState<ExtractionOption | null>(null),
    [extractAnimation, setExtractAnimation] =
      useState<ExtractionAnimation>("idle"),
    [leaderboardOpen, setLeaderboardOpen] = useState(false),
    [leaders, setLeaders] = useState<Leader[]>([]);
  const [soundtrack, setSoundtrack] = useState<Soundtrack>("energetic"),
    [musicVolume, setMusicVolume] = useState(0.45),
    [sfxVolume, setSfxVolume] = useState(0.7);
  const id = useRef(0),
    last = useRef(0),
    userIdRef = useRef<string | null>(null),
    gemsRef = useRef(0),
    scoreRef = useRef(0),
    highScoreRef = useRef(0),
    scoreCarryRef = useRef(0),
    pacerRushRemainingRef = useRef(0),
    courierBoostRemainingRef = useRef(0),
    driftBoostRemainingRef = useRef(0),
    sparkBoostRemainingRef = useRef(0),
    flareDamageWaveRef = useRef(0),
    flareBoostWaveRef = useRef(0),
    orbitCooldownRemainingRef = useRef(0),
    cometChargeRemainingRef = useRef(8000),
    cometChargedRef = useRef(false),
    scoutShieldCooldownUntilRef = useRef(0),
    invincibleUntilRef = useRef(0),
    invincibilityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null),
    abilityNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null),
    reportPreviousPausedRef = useRef(false),
    waveAnnouncementTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
      null,
    ),
    rogueGrazeCooldownUntilRef = useRef(0),
    rogueGrazedItemIdsRef = useRef<Set<number>>(new Set()),
    bloomGemWaveRef = useRef(0),
    pulseGemCountRef = useRef(0),
    sproutGemCountRef = useRef(0),
    tonicCollectibleWaveRef = useRef(0),
    remedySnowflakeWaveRef = useRef(0),
    reserveHealStoredRef = useRef(false),
    menderChargeRemainingRef = useRef(12000),
    menderHealedWaveRef = useRef(0),
    lifelineUsedRef = useRef(false),
    reviveUsedRef = useRef(false),
    rampartCollisionCountRef = useRef(0),
    flickerShieldWaveRef = useRef(0),
    switchLastDirectionRef = useRef(0),
    switchShieldCooldownUntilRef = useRef(0),
    gambitBoostRemainingRef = useRef(0),
    gambitCooldownUntilRef = useRef(0),
    echoGrazeCooldownUntilRef = useRef(0),
    mirageShieldCooldownUntilRef = useRef(0),
    hexMoveCountRef = useRef(0),
    turnLockedRef = useRef(false),
    delayedMoveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null),
    freezeEffectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null),
    damageLockedRef = useRef(false),
    frozenUntilRef = useRef(0),
    firstGuardWaveRef = useRef(0),
    hammerBreakWaveRef = useRef(0),
    wardenBlockWaveRef = useRef(0),
    citadelBlockWaveRef = useRef(0),
    bastionChargeRemainingRef = useRef(6000),
    bastionArmorChargedRef = useRef(false),
    sentinelLastStandUsedRef = useRef(false),
    phantomPhaseWaveRef = useRef(0),
    smokeSlowRemainingRef = useRef(0),
    clockworkMoveCountRef = useRef(0),
    clockworkSlowRemainingRef = useRef(0),
    clockworkCooldownRemainingRef = useRef(0),
    pickpocketPassedCountRef = useRef(0),
    wildcardBuffRef = useRef<"score" | "gems" | "slow" | null>(null),
    ambientHazardStreakRef = useRef<{ kind: Kind | null; count: number }>({
      kind: null,
      count: 0,
    }),
    versusMatchRef = useRef<string | null>(null),
    versusSearchingRef = useRef(false),
    versusSearchTokenRef = useRef(0),
    versusPollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null),
    versusAttackBusyRef = useRef(false),
    realtimeRef = useRef<ReturnType<typeof supabase.channel> | null>(null),
    incomingAttacksRef = useRef<PendingVersusAttack[]>([]),
    spawnedAttackIdsRef = useRef<Set<string>>(new Set()),
    processedPickupIdsRef = useRef<Set<number>>(new Set()),
    versusPickupNonceRef = useRef(createVersusPickupNonce()),
    versusFinishedRef = useRef(false),
    versusPointsRef = useRef(0),
    versusCoinAwardQueueRef = useRef<Promise<void>>(Promise.resolve()),
    versusStateSyncQueueRef = useRef<Promise<void>>(Promise.resolve()),
    versusScoreSyncPendingRef = useRef(false),
    versusTransitionBusyRef = useRef(false),
    versusStateSyncIntentRef = useRef(0),
    versusHydrationIntentRef = useRef(0),
    versusRunHydratedRef = useRef(false),
    hydrateVersusStateRef = useRef<
      ((matchId: string, preserveRunState?: boolean) => Promise<boolean>) | null
    >(null),
    versusSyncRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
      null,
    ),
    extractBusyRef = useRef(false),
    extractFeedbackRef = useRef<HTMLDivElement | null>(null),
    botAttackPointsRef = useRef(0),
    playerAttacksAgainstBotRef = useRef<VersusAttackKind[]>([]),
    state = useRef({
      lane,
      running,
      paused,
      pauseMenuOpen,
      wavePause,
      hearts,
    });
  state.current = {
    lane,
    running,
    paused,
    pauseMenuOpen,
    wavePause,
    hearts,
  };
  gemsRef.current = gems;
  scoreRef.current = score;
  highScoreRef.current = highScore;
  useEffect(
    () => () => {
      if (delayedMoveTimerRef.current)
        clearTimeout(delayedMoveTimerRef.current);
      if (freezeEffectTimerRef.current)
        clearTimeout(freezeEffectTimerRef.current);
      if (invincibilityTimerRef.current)
        clearTimeout(invincibilityTimerRef.current);
      if (abilityNoticeTimerRef.current)
        clearTimeout(abilityNoticeTimerRef.current);
      if (waveAnnouncementTimerRef.current)
        clearTimeout(waveAnnouncementTimerRef.current);
      versusSearchingRef.current = false;
      versusSearchTokenRef.current += 1;
      if (versusPollTimerRef.current)
        clearTimeout(versusPollTimerRef.current);
      if (realtimeRef.current) void supabase.removeChannel(realtimeRef.current);
    },
    [],
  );
  useEffect(() => {
    let savedTrack: Soundtrack = "energetic";
    let savedMusic = 0.45;
    let savedSfx = 0.7;
    try {
      const raw = window.localStorage.getItem(AUDIO_PREFERENCES_KEY);
      const saved = raw
        ? (JSON.parse(raw) as {
            soundtrack?: unknown;
            musicVolume?: unknown;
            sfxVolume?: unknown;
          })
        : null;
      if (
        saved?.soundtrack === "jazz" ||
        saved?.soundtrack === "calm" ||
        saved?.soundtrack === "energetic"
      )
        savedTrack = saved.soundtrack;
      if (typeof saved?.musicVolume === "number")
        savedMusic = Math.max(0, Math.min(1, saved.musicVolume));
      if (typeof saved?.sfxVolume === "number")
        savedSfx = Math.max(0, Math.min(1, saved.sfxVolume));
    } catch {
      // Invalid or blocked storage falls back to the game defaults.
    }
    audioEngine.setTrack(savedTrack);
    audioEngine.setMusicVolume(savedMusic);
    audioEngine.setSfxVolume(savedSfx);
    const applyPreferences = window.setTimeout(() => {
      setSoundtrack(savedTrack);
      setMusicVolume(savedMusic);
      setSfxVolume(savedSfx);
    }, 0);
    return () => {
      window.clearTimeout(applyPreferences);
      audioEngine.stop();
    };
  }, []);
  const [authReady, setAuthReady] = useState(false),
    [guest, setGuest] = useState(false),
    [userEmail, setUserEmail] = useState<string | null>(null),
    [playerAccess, setPlayerAccess] = useState<PlayerAccess | null>(null),
    [playerAccessError, setPlayerAccessError] = useState(""),
    [playerAccessChecking, setPlayerAccessChecking] = useState(false),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [confirmPassword, setConfirmPassword] = useState(""),
    [authMode, setAuthMode] = useState<"signin" | "signup">("signin"),
    [authBusy, setAuthBusy] = useState(false),
    [authMessage, setAuthMessage] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false),
    [reportOpen, setReportOpen] = useState(false),
    [adminOpen, setAdminOpen] = useState(false),
    [isAdmin, setIsAdmin] = useState(false),
    [adminRole, setAdminRole] = useState<string | null>(null),
    [adminTab, setAdminTab] = useState<"reports" | "admins" | "players">(
      "reports",
    ),
    [admins, setAdmins] = useState<AdminUser[]>([]),
    [adminTarget, setAdminTarget] = useState(""),
    [adminStatus, setAdminStatus] = useState(""),
    [reports, setReports] = useState<PlayerReport[]>([]),
    [copyStatus, setCopyStatus] = useState(""),
    [reportType, setReportType] = useState("Bug"),
    [reportMessage, setReportMessage] = useState(""),
    [reportStatus, setReportStatus] = useState(""),
    [reportBusy, setReportBusy] = useState(false);
  const [username, setUsername] = useState(""),
    [usernameInput, setUsernameInput] = useState(""),
    [usernameRequired, setUsernameRequired] = useState(false),
    [usernameStatus, setUsernameStatus] = useState(""),
    [newPassword, setNewPassword] = useState(""),
    [passwordStatus, setPasswordStatus] = useState("");
  const [editUsername, setEditUsername] = useState(false),
    [editPassword, setEditPassword] = useState(false);
  const [endlessMode, setEndlessMode] = useState<GameMode>("normal");
  const [mainView, setMainView] = useState<MainView>("endless"),
    [playScope, setPlayScope] = useState<PlayScope>("single"),
    [versusPhase, setVersusPhase] = useState<VersusPhase>("idle"),
    [versusOpponent, setVersusOpponent] = useState("WAITING…"),
    [versusPoints, setVersusPoints] = useState(0),
    [versusCountdown, setVersusCountdown] = useState(
      VERSUS_INTERMISSION_SECONDS,
    ),
    [versusOpponentHearts, setVersusOpponentHearts] = useState(3),
    [versusResult, setVersusResult] = useState(""),
    [versusAttackBusy, setVersusAttackBusy] = useState(false),
    [versusIntermissionReady, setVersusIntermissionReady] = useState(false),
    [versusLeaving, setVersusLeaving] = useState(false),
    [versusLeaders, setVersusLeaders] = useState<VersusLeader[]>([]),
    [versusLeadersLoading, setVersusLeadersLoading] = useState(false),
    [versusLeadersError, setVersusLeadersError] = useState(""),
    [versusServerMaxHearts, setVersusServerMaxHearts] = useState<number | null>(
      null,
    ),
    [versusSyncRetry, setVersusSyncRetry] = useState(0);
  versusPointsRef.current = versusPoints;
  const applyAuthoritativeVersusPoints = useCallback((value: unknown) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    const points = Math.max(0, Math.floor(parsed));
    versusPointsRef.current = points;
    setVersusPoints(points);
  }, []);
  const enqueueVersusStateSync = useCallback(
    (task: () => Promise<void>) => {
      const queued = versusStateSyncQueueRef.current.then(task, task);
      versusStateSyncQueueRef.current = queued.catch(() => undefined);
      return queued;
    },
    [],
  );
  const resetVersusClientSync = useCallback(() => {
    processedPickupIdsRef.current.clear();
    versusPickupNonceRef.current = createVersusPickupNonce();
    versusCoinAwardQueueRef.current = Promise.resolve();
    versusStateSyncQueueRef.current = Promise.resolve();
    versusScoreSyncPendingRef.current = false;
    versusTransitionBusyRef.current = false;
    versusStateSyncIntentRef.current += 1;
    versusHydrationIntentRef.current += 1;
    versusRunHydratedRef.current = false;
    setVersusServerMaxHearts(null);
    if (versusSyncRetryTimerRef.current) {
      clearTimeout(versusSyncRetryTimerRef.current);
      versusSyncRetryTimerRef.current = null;
    }
  }, []);
  const reconcileVersusPoints = useCallback(
    async (matchId: string) => {
      try {
        const { data, error } = await supabase.rpc("get_1v1_state", {
          p_match_id: matchId,
        });
        if (error || versusMatchRef.current !== matchId) return false;
        applyAuthoritativeVersusPoints(data?.self?.obstacle_points);
        return true;
      } catch {
        return false;
      }
    },
    [applyAuthoritativeVersusPoints],
  );
  const queueOnlineCoinAward = useCallback(
    (matchId: string, pickupId: number) => {
      const pickupClaimId = `coin:${versusPickupNonceRef.current}:${pickupId}`;
      const awardCoin = async () => {
        let attempt = 0;
        while (
          versusMatchRef.current === matchId &&
          !versusFinishedRef.current
        ) {
          let lastError = "";
          try {
            const { data, error } = await supabase.rpc("award_1v1_points", {
              p_match_id: matchId,
              p_source: "coin",
              p_amount: 1,
              p_pickup_id: pickupClaimId,
            });
            if (versusMatchRef.current !== matchId) return;
            if (!error) {
              applyAuthoritativeVersusPoints(data?.obstacle_points);
              return;
            }
            lastError = error.message;
          } catch {
            lastError = "connection interrupted";
          }
          if (!isTransportLikeError(lastError)) {
            if (
              isCoinSetupError(lastError) ||
              !isCoinMatchStateError(lastError)
            ) {
              setVersusResult("1V1 COIN DATABASE SETUP IS MISSING");
              return;
            }
            const restored = await hydrateVersusStateRef.current?.(
              matchId,
              true,
            );
            if (!restored && versusMatchRef.current === matchId) {
              versusFinishedRef.current = true;
              setVersusPhase("finished");
              setVersusIntermissionReady(false);
              setRunning(false);
              setPaused(false);
              setOver(true);
              setVersusResult(
                lastError.toLowerCase().includes("sign in")
                  ? "SIGN IN AGAIN TO CONTINUE 1V1"
                  : "THIS 1V1 MATCH IS NO LONGER ACTIVE",
              );
            }
            return;
          }
          attempt += 1;
          if (attempt % 3 === 0) {
            await reconcileVersusPoints(matchId);
            if (versusMatchRef.current !== matchId) return;
            setVersusResult(
              `COIN SAVE DELAYED · RETRYING · ${lastError.toUpperCase()}`,
            );
          }
          await new Promise((resolve) =>
            setTimeout(resolve, Math.min(2000, 200 * 2 ** attempt)),
          );
        }
      };
      const queued = enqueueVersusStateSync(awardCoin);
      versusCoinAwardQueueRef.current = queued.catch(() => undefined);
    },
    [
      applyAuthoritativeVersusPoints,
      enqueueVersusStateSync,
      reconcileVersusPoints,
    ],
  );
  const isOnlineVersus = playScope === "versus";
  const isBotPractice = playScope === "practice";
  const isVersusRun = playScope !== "single";
  const mode: GameMode = mainView === "versus" ? "normal" : endlessMode;
  const [playerClass, setPlayerClass] = useState("runner"),
    [selectedCharacter, setSelectedCharacter] = useState("runner_ace"),
    [inventoryCharacter, setInventoryCharacter] = useState<{
      classKey: keyof typeof CLASS_CHARACTERS;
      characterKey: string;
    }>({ classKey: "runner", characterKey: "runner_ace" }),
    [playerCosmetic, setPlayerCosmetic] = useState(""),
    [obstacleCosmetic, setObstacleCosmetic] = useState(""),
    [environmentCosmetic, setEnvironmentCosmetic] = useState(""),
    [unlocks, setUnlocks] = useState<Unlock[]>([]),
    [extractResults, setExtractResults] = useState<ExtractionResult[]>([]);
  const classBlockedByMode =
    mode === "impossible" ||
    (mode === "hardcore" &&
      (playerClass === "medic" || playerClass === "tank"));
  const activeClass = classBlockedByMode ? "runner" : playerClass;
  const activeCharacter =
    mode === "impossible" || classBlockedByMode
      ? "runner_ace"
      : selectedCharacter;
  const baseHearts =
    activeClass === "tank" ? 4 : activeClass === "trickster" ? 2 : 3;
  const startingHearts =
    mode === "impossible" || mode === "hardcore" ? 1 : baseHearts;
  const localMaxHearts =
    mode === "impossible" || mode === "hardcore"
      ? 1
      : getCharacterMaxHearts(activeCharacter, activeClass);
  const maxHearts =
    isOnlineVersus && versusServerMaxHearts !== null
      ? versusServerMaxHearts
      : localMaxHearts;
  const modeMultiplier =
    mode === "impossible" ? 3 : mode === "hardcore" ? 1.75 : 1;
  const classScoreMultiplier =
    activeClass === "trickster" && mode === "normal" ? 1.15 : 1;
  const activeAbility =
    CHARACTER_ABILITIES[activeCharacter as CharacterKey] ??
    CHARACTER_ABILITIES.runner_ace;
  const activeCharacterDefinition = getCharacterDefinition(activeCharacter);
  const activeWeaponScoreBonus = getWeaponScoreBonus(
    activeCharacterDefinition.rarity,
  );
  const activeWeaponScoreMultiplier = 1 + activeWeaponScoreBonus;
  useEffect(() => {
    if (mainView === "endless" && !running && !over)
      setHearts(startingHearts);
  }, [mainView, over, running, startingHearts]);
  const saveAudioPreferences = (
    nextTrack: Soundtrack,
    nextMusic: number,
    nextSfx: number,
  ) => {
    try {
      window.localStorage.setItem(
        AUDIO_PREFERENCES_KEY,
        JSON.stringify({
          soundtrack: nextTrack,
          musicVolume: nextMusic,
          sfxVolume: nextSfx,
        }),
      );
    } catch {
      // Audio still works when storage is disabled; it just will not persist.
    }
  };
  const chooseSoundtrack = (nextTrack: Soundtrack) => {
    setSoundtrack(nextTrack);
    audioEngine.setTrack(nextTrack);
    saveAudioPreferences(nextTrack, musicVolume, sfxVolume);
    void audioEngine.playSfx("click");
  };
  const changeMusicVolume = (nextVolume: number) => {
    const volume = Math.max(0, Math.min(1, nextVolume));
    setMusicVolume(volume);
    audioEngine.setMusicVolume(volume);
    saveAudioPreferences(soundtrack, volume, sfxVolume);
  };
  const changeSfxVolume = (nextVolume: number) => {
    const volume = Math.max(0, Math.min(1, nextVolume));
    setSfxVolume(volume);
    audioEngine.setSfxVolume(volume);
    saveAudioPreferences(soundtrack, musicVolume, volume);
  };
  const refreshPlayerAccess = useCallback(async (blocking = false) => {
    if (!userIdRef.current) return null;
    if (blocking) setPlayerAccessChecking(true);
    const { data, error } = await supabase.rpc("register_player_device", {
      p_device_token: getOrCreateDeviceToken(),
      p_label: "Web browser",
    });
    if (error) {
      console.error("Could not verify player access:", error.message);
      setPlayerAccessError(error.message);
      setRunning(false);
      audioEngine.stop();
      setPlayerAccessChecking(false);
      return null;
    }
    if (!data || typeof data !== "object") {
      setPlayerAccessError("The access service returned an invalid response.");
      setRunning(false);
      setPlayerAccessChecking(false);
      audioEngine.stop();
      return null;
    }
    const access = data as PlayerAccess;
    setPlayerAccessError("");
    setPlayerAccess(access);
    if (access.account_banned || access.device_banned) {
      setRunning(false);
      setPaused(false);
      setPauseMenuOpen(false);
      setWavePause(false);
      audioEngine.stop();
    }
    setPlayerAccessChecking(false);
    return access;
  }, []);
  const refreshGuestDeviceAccess = useCallback(async () => {
    const { data, error } = await supabase.rpc("check_player_device", {
      p_device_token: getOrCreateDeviceToken(),
    });
    if (error) {
      setPlayerAccessError(error.message);
      setRunning(false);
      audioEngine.stop();
      return null;
    }
    const access = {
      account_banned: false,
      device_banned: Boolean(data?.device_banned),
      leaderboard_banned: false,
      active_bans: data?.active_bans ?? [],
    } satisfies PlayerAccess;
    setPlayerAccessError("");
    setPlayerAccess(access);
    if (access.device_banned) {
      setRunning(false);
      setPaused(false);
      setPauseMenuOpen(false);
      audioEngine.stop();
      return false;
    }
    return true;
  }, []);
  const showAbilityNotice = useCallback(
    (message: string, durationMs = 950) => {
      setAbilityNotice(message);
      if (abilityNoticeTimerRef.current)
        clearTimeout(abilityNoticeTimerRef.current);
      abilityNoticeTimerRef.current = setTimeout(() => {
        setAbilityNotice("");
        abilityNoticeTimerRef.current = null;
      }, durationMs);
    },
    [],
  );
  const grantInvincibility = useCallback((durationMs: number) => {
    const now = Date.now();
    const until = Math.max(invincibleUntilRef.current, now + durationMs);
    invincibleUntilRef.current = until;
    setInvincible(true);
    if (invincibilityTimerRef.current)
      clearTimeout(invincibilityTimerRef.current);
    invincibilityTimerRef.current = setTimeout(() => {
      if (invincibleUntilRef.current <= Date.now()) {
        setInvincible(false);
        invincibilityTimerRef.current = null;
      }
    }, until - now + 25);
  }, []);
  const clearFreezeEffect = useCallback(() => {
    frozenUntilRef.current = 0;
    if (freezeEffectTimerRef.current) {
      clearTimeout(freezeEffectTimerRef.current);
      freezeEffectTimerRef.current = null;
    }
    setSlowed(false);
  }, []);
  const applyFreezeEffect = useCallback((durationMs = 3000) => {
    const until = Date.now() + durationMs;
    frozenUntilRef.current = until;
    if (freezeEffectTimerRef.current)
      clearTimeout(freezeEffectTimerRef.current);
    setSlowed(true);
    freezeEffectTimerRef.current = setTimeout(() => {
      if (frozenUntilRef.current <= Date.now()) {
        frozenUntilRef.current = 0;
        setSlowed(false);
        freezeEffectTimerRef.current = null;
      }
    }, durationMs + 25);
  }, []);
  const resetCharacterAbilityState = useCallback(
    (restoredWave?: number) => {
      const restoring = restoredWave !== undefined;
      const now = Date.now();
      firstGuardWaveRef.current = restoring ? restoredWave : 0;
      hammerBreakWaveRef.current = restoring ? restoredWave : 0;
      sentinelLastStandUsedRef.current = restoring;
      phantomPhaseWaveRef.current = restoring ? restoredWave : 0;
      scoreCarryRef.current = 0;
      pacerRushRemainingRef.current = 0;
      courierBoostRemainingRef.current = 0;
      driftBoostRemainingRef.current = 0;
      sparkBoostRemainingRef.current = 0;
      flareDamageWaveRef.current = restoring ? restoredWave : 0;
      flareBoostWaveRef.current = 0;
      orbitCooldownRemainingRef.current = restoring ? 5000 : 0;
      cometChargeRemainingRef.current = 8000;
      cometChargedRef.current = false;
      scoutShieldCooldownUntilRef.current = restoring ? now + 4000 : 0;
      rogueGrazeCooldownUntilRef.current = restoring ? now + 1250 : 0;
      rogueGrazedItemIdsRef.current.clear();
      bloomGemWaveRef.current = restoring ? restoredWave : 0;
      pulseGemCountRef.current = 0;
      sproutGemCountRef.current = 0;
      tonicCollectibleWaveRef.current = restoring ? restoredWave : 0;
      remedySnowflakeWaveRef.current = restoring ? restoredWave : 0;
      reserveHealStoredRef.current = false;
      menderChargeRemainingRef.current = 12000;
      menderHealedWaveRef.current = restoring ? restoredWave : 0;
      lifelineUsedRef.current = restoring;
      reviveUsedRef.current = restoring;
      rampartCollisionCountRef.current = 0;
      flickerShieldWaveRef.current = restoring ? restoredWave : 0;
      switchLastDirectionRef.current = 0;
      switchShieldCooldownUntilRef.current = restoring ? now + 2000 : 0;
      gambitBoostRemainingRef.current = 0;
      gambitCooldownUntilRef.current = restoring ? now + 2500 : 0;
      echoGrazeCooldownUntilRef.current = restoring ? now + 2000 : 0;
      mirageShieldCooldownUntilRef.current = restoring ? now + 2500 : 0;
      hexMoveCountRef.current = 0;
      wardenBlockWaveRef.current = restoring ? restoredWave : 0;
      citadelBlockWaveRef.current = restoring ? restoredWave : 0;
      bastionChargeRemainingRef.current = 6000;
      bastionArmorChargedRef.current = false;
      smokeSlowRemainingRef.current = 0;
      clockworkMoveCountRef.current = 0;
      clockworkSlowRemainingRef.current = 0;
      clockworkCooldownRemainingRef.current = restoring ? 5000 : 0;
      pickpocketPassedCountRef.current = 0;
      wildcardBuffRef.current = null;
    },
    [],
  );
  const announceWave = useCallback(
    (
      number: number,
      applyCharacterEffects = true,
      characterOverride?: string,
    ) => {
      const announcedCharacter = characterOverride ?? activeCharacter;
      const announcedAbility =
        CHARACTER_ABILITIES[announcedCharacter as CharacterKey] ??
        CHARACTER_ABILITIES.runner_ace;
      void audioEngine.playSfx("wave");
      setWaveMessage(`WAVE ${number}`);
      setWavePause(true);
      if (waveAnnouncementTimerRef.current)
        clearTimeout(waveAnnouncementTimerRef.current);
      waveAnnouncementTimerRef.current = setTimeout(() => {
        setWaveMessage("");
        setWavePause(false);
        if (applyCharacterEffects && number === 1)
          showAbilityNotice(`${announcedAbility.name} · ACTIVE`, 1400);
        if (applyCharacterEffects && announcedCharacter === "runner_ace")
          showAbilityNotice("MOMENTUM · SCORE ×1.10", 1400);
        if (applyCharacterEffects && announcedCharacter === "runner_pacer") {
          pacerRushRemainingRef.current = 15000;
          showAbilityNotice(
            "WAVE RUSH · SPEED ×3 + SCORE ×5 = ×15 FOR 15 SECONDS",
            1800,
          );
        }
        if (
          applyCharacterEffects &&
          announcedCharacter === "trickster_jester"
        ) {
          grantInvincibility(2500);
          showAbilityNotice("ENCORE · 2.5 SECOND SHIELD", 1400);
        }
        if (announcedCharacter === "trickster_wildcard") {
          const matchId = versusMatchRef.current;
          const seed = `${matchId ?? "solo"}:${userIdRef.current ?? "guest"}:${number}`;
          let hash = 0;
          for (let index = 0; index < seed.length; index += 1)
            hash = (hash * 31 + seed.charCodeAt(index)) | 0;
          const roll = matchId
            ? Math.abs(hash) % 3
            : Math.floor(Math.random() * 3);
          const buff = roll === 0 ? "score" : roll === 1 ? "gems" : "slow";
          wildcardBuffRef.current = buff;
          if (applyCharacterEffects)
            showAbilityNotice(
              buff === "score"
                ? "LUCKY DRAW · SCORE ×1.15"
                : buff === "gems"
                  ? "LUCKY DRAW · GEM CHANCE ×1.50"
                  : "LUCKY DRAW · HAZARDS 15% SLOWER",
              1800,
            );
        }
        waveAnnouncementTimerRef.current = null;
      }, 1250);
    },
    [activeCharacter, grantInvincibility, showAbilityNotice],
  );
  const reset = useCallback((forceNormalMode = false) => {
    const runStartingHearts = forceNormalMode
      ? playerClass === "tank"
        ? 4
        : playerClass === "trickster"
          ? 2
          : 3
      : startingHearts;
    const runCharacter = forceNormalMode ? selectedCharacter : activeCharacter;
    resetVersusClientSync();
    ambientHazardStreakRef.current = { kind: null, count: 0 };
    setLane(2);
    setItems([]);
    setScore(0);
    setWaveProgress(0);
    setHearts(runStartingHearts);
    setWave(1);
    setOver(false);
    setPaused(false);
    setPauseMenuOpen(false);
    setInvincible(false);
    clearFreezeEffect();
    setAbilityNotice("");
    invincibleUntilRef.current = 0;
    if (invincibilityTimerRef.current) {
      clearTimeout(invincibilityTimerRef.current);
      invincibilityTimerRef.current = null;
    }
    if (abilityNoticeTimerRef.current) {
      clearTimeout(abilityNoticeTimerRef.current);
      abilityNoticeTimerRef.current = null;
    }
    if (waveAnnouncementTimerRef.current) {
      clearTimeout(waveAnnouncementTimerRef.current);
      waveAnnouncementTimerRef.current = null;
    }
    resetCharacterAbilityState();
    botAttackPointsRef.current = 0;
    playerAttacksAgainstBotRef.current = [];
    turnLockedRef.current = false;
    if (delayedMoveTimerRef.current) {
      clearTimeout(delayedMoveTimerRef.current);
      delayedMoveTimerRef.current = null;
    }
    damageLockedRef.current = false;
    setRunning(true);
    last.current = 0;
    void audioEngine.start(soundtrack);
    announceWave(1, true, runCharacter);
  }, [
    activeCharacter,
    announceWave,
    clearFreezeEffect,
    playerClass,
    resetCharacterAbilityState,
    resetVersusClientSync,
    selectedCharacter,
    soundtrack,
    startingHearts,
  ]);
  const resetGameToMenu = () => {
    resetVersusClientSync();
    setRunning(false);
    setPaused(false);
    setPauseMenuOpen(false);
    setOver(false);
    setItems([]);
    setScore(0);
    setWaveProgress(0);
    setWave(1);
    setHearts(startingHearts);
    setInvincible(false);
    clearFreezeEffect();
    setAbilityNotice("");
    invincibleUntilRef.current = 0;
    if (invincibilityTimerRef.current) {
      clearTimeout(invincibilityTimerRef.current);
      invincibilityTimerRef.current = null;
    }
    if (abilityNoticeTimerRef.current) {
      clearTimeout(abilityNoticeTimerRef.current);
      abilityNoticeTimerRef.current = null;
    }
    if (waveAnnouncementTimerRef.current) {
      clearTimeout(waveAnnouncementTimerRef.current);
      waveAnnouncementTimerRef.current = null;
    }
    resetCharacterAbilityState();
    botAttackPointsRef.current = 0;
    playerAttacksAgainstBotRef.current = [];
    turnLockedRef.current = false;
    if (delayedMoveTimerRef.current) {
      clearTimeout(delayedMoveTimerRef.current);
      delayedMoveTimerRef.current = null;
    }
    damageLockedRef.current = false;
    if (playScope === "practice") {
      setPlayScope("single");
      setVersusPhase("idle");
      setVersusPoints(0);
      versusPointsRef.current = 0;
      setVersusOpponent("WAITING…");
      setVersusOpponentHearts(BOT_MAX_HEARTS);
      setVersusResult("");
      setVersusIntermissionReady(false);
    }
  };
  const completeMove = useCallback(
    (destination: number, direction: number) => {
      state.current.lane = destination;
      setLane(destination);
      void audioEngine.playSfx("move");
      const now = Date.now();
      if (
        activeCharacter === "tank_bastion" &&
        !bastionArmorChargedRef.current
      )
        bastionChargeRemainingRef.current = 6000;
      if (activeCharacter === "runner_drift") {
        driftBoostRemainingRef.current = 1250;
        showAbilityNotice("SLIPSTREAM · SCORE ×1.15", 700);
      }
      if (
        activeCharacter === "trickster_flicker" &&
        flickerShieldWaveRef.current !== wave
      ) {
        flickerShieldWaveRef.current = wave;
        grantInvincibility(750);
        showAbilityNotice("FIRST FLICKER · 0.75 SECOND SHIELD", 850);
      }
      if (activeCharacter === "trickster_switch") {
        if (
          switchLastDirectionRef.current === -direction &&
          switchShieldCooldownUntilRef.current <= now
        ) {
          switchShieldCooldownUntilRef.current = now + 2000;
          grantInvincibility(500);
          showAbilityNotice("REVERSAL · 0.5 SECOND SHIELD", 750);
        }
        switchLastDirectionRef.current = direction;
      }
      if (
        activeCharacter === "trickster_mirage" &&
        mirageShieldCooldownUntilRef.current <= now
      ) {
        mirageShieldCooldownUntilRef.current = now + 2500;
        grantInvincibility(650);
        showAbilityNotice("AFTERIMAGE · 0.65 SECOND SHIELD", 800);
      }
      if (activeCharacter === "trickster_hex") {
        hexMoveCountRef.current += 1;
        if (hexMoveCountRef.current % 3 === 0) {
          showAbilityNotice("VOID CUT · THIRD MOVE", 900);
          setItems((current) => {
            const target = current
              .filter(
                (item) =>
                  item.lane === destination &&
                  item.y >= -10 &&
                  item.y < 91 &&
                  item.kind !== "gem" &&
                  item.kind !== "coin" &&
                  item.kind !== "snowflake",
              )
              .sort((left, right) => right.y - left.y)[0];
            return target
              ? current.filter((item) => item.id !== target.id)
              : current;
          });
        }
      }
      if (activeCharacter === "trickster_clockwork") {
        if (clockworkCooldownRemainingRef.current <= 0) {
          clockworkMoveCountRef.current += 1;
          if (clockworkMoveCountRef.current >= 6) {
            clockworkMoveCountRef.current = 0;
            clockworkSlowRemainingRef.current = 1250;
            clockworkCooldownRemainingRef.current = 5000;
            showAbilityNotice("TIME TRICK · HAZARDS 30% SLOWER", 1000);
          }
        }
      }
    },
    [activeCharacter, grantInvincibility, showAbilityNotice, wave],
  );
  const move = useCallback(
    (d: number) => {
      if (
        !state.current.running ||
        state.current.paused ||
        state.current.wavePause ||
        turnLockedRef.current
      )
        return;
      const orbitWrap =
        activeCharacter === "runner_orbit" &&
        orbitCooldownRemainingRef.current <= 0 &&
        ((state.current.lane === 0 && d < 0) ||
          (state.current.lane === 4 && d > 0));
      const destination = orbitWrap
        ? state.current.lane === 0
          ? 4
          : 0
        : Math.max(0, Math.min(4, state.current.lane + d));
      if (destination === state.current.lane) return;
      const finishMove = () => {
        completeMove(destination, d);
        if (orbitWrap) {
          orbitCooldownRemainingRef.current = 5000;
          showAbilityNotice("LANE ORBIT · EDGE WRAP", 850);
        }
      };
      if (frozenUntilRef.current > Date.now()) {
        turnLockedRef.current = true;
        delayedMoveTimerRef.current = setTimeout(
          () => {
            if (
              state.current.running &&
              !state.current.paused &&
              !state.current.wavePause
            )
              finishMove();
            turnLockedRef.current = false;
            delayedMoveTimerRef.current = null;
          },
          activeCharacter === "tank_glacier" ? 125 : 250,
        );
        return;
      }
      finishMove();
    },
    [activeCharacter, completeMove, showAbilityNotice],
  );
  const toggleManualPause = useCallback(() => {
    if (
      isOnlineVersus ||
      !state.current.running ||
      (state.current.paused && !state.current.pauseMenuOpen)
    )
      return;
    const nextOpen = !state.current.pauseMenuOpen;
    setPauseMenuOpen(nextOpen);
    setPaused(nextOpen);
    void audioEngine.playSfx("click");
    if (!nextOpen) void audioEngine.resume();
  }, [isOnlineVersus]);
  const resumeFromPause = () => {
    setPauseMenuOpen(false);
    setPaused(false);
    void audioEngine.playSfx("click");
    void audioEngine.resume();
  };
  const returnHomeFromPause = () => {
    void audioEngine.playSfx("click");
    resetGameToMenu();
  };
  const closeVersusChannel = () => {
    if (realtimeRef.current) {
      void supabase.removeChannel(realtimeRef.current);
      realtimeRef.current = null;
    }
  };
  const acknowledgeSpawnedVersusAttacks = useCallback(
    async function acknowledgeSpawnedAttacks(
      matchId: string,
      attackIds: string[],
      attempt = 0,
    ) {
      if (
        attackIds.length === 0 ||
        versusMatchRef.current !== matchId
      )
        return;
      const { error } = await supabase.rpc("acknowledge_1v1_attacks", {
        p_match_id: matchId,
        p_attack_ids: attackIds,
      });
      if (!error) {
        attackIds.forEach((attackId) =>
          spawnedAttackIdsRef.current.delete(attackId),
        );
        return;
      }
      if (
        attempt < 3 &&
        versusMatchRef.current === matchId
      )
        setTimeout(
          () =>
            void acknowledgeSpawnedAttacks(
              matchId,
              attackIds,
              attempt + 1,
            ),
          750 * (attempt + 1),
        );
    },
    [],
  );
  const subscribeToMatch = (matchId: string) => {
    closeVersusChannel();
    const channel = supabase
      .channel(`skyway-1v1-${matchId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "multiplayer_attacks",
          filter: `match_id=eq.${matchId}`,
        },
        (payload) => {
          if (versusMatchRef.current !== matchId) return;
          const attack = payload.new as {
            id: string;
            target_user_id: string;
            obstacle_type: Kind | "spike";
          };
          if (attack.target_user_id === userIdRef.current) {
            const kind = normalizeVersusObstacle(attack.obstacle_type);
            if (
              kind &&
              !incomingAttacksRef.current.some(
                (pending) => pending.id === attack.id,
              )
            )
              incomingAttacksRef.current.push({ id: attack.id, kind });
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "multiplayer_players",
          filter: `match_id=eq.${matchId}`,
        },
        (payload) => {
          if (versusMatchRef.current !== matchId) return;
          const player = payload.new as {
            user_id: string;
            hearts: number;
            status: string;
            obstacle_points?: number;
            username?: string;
          };
          if (player.user_id === userIdRef.current) return;
          setVersusOpponentHearts(Number(player.hearts));
          if (player.username) setVersusOpponent(player.username);
          if (player.status === "eliminated") {
            versusFinishedRef.current = true;
            setVersusResult("VICTORY");
            setVersusPhase("finished");
            setVersusIntermissionReady(false);
            setRunning(false);
            setOver(true);
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "multiplayer_matches",
          filter: `id=eq.${matchId}`,
        },
        (payload) => {
          if (versusMatchRef.current !== matchId) return;
          const previousMatch = payload.old as {
            status?: string;
            intermission_ends_at?: string | null;
          };
          const match = payload.new as {
            status: string;
            winner_user_id: string | null;
            intermission_ends_at?: string | null;
          };
          if (match.status === "finished") {
            versusFinishedRef.current = true;
            setVersusResult(
              match.winner_user_id === userIdRef.current ? "VICTORY" : "DEFEAT",
            );
            setVersusPhase("finished");
            setVersusIntermissionReady(false);
            setRunning(false);
            setOver(true);
            return;
          }
          if (match.status === "intermission") {
            const enteredIntermission = previousMatch.status !== "intermission";
            const deadlineChanged =
              previousMatch.intermission_ends_at !== match.intermission_ends_at;
            if (!enteredIntermission && !deadlineChanged) return;
            const remaining = secondsUntil(
              match.intermission_ends_at,
              VERSUS_INTERMISSION_SECONDS,
            );
            setVersusCountdown(remaining);
            setVersusPhase("intermission");
            setVersusIntermissionReady(true);
            setPaused(true);
            setVersusResult(remaining > 0 ? "INTERMISSION" : "SYNCING NEXT WAVE");
            void enqueueVersusStateSync(async () => {
              await hydrateVersusState(
                matchId,
                versusRunHydratedRef.current,
              );
            });
            return;
          }
          if (
            match.status === "playing" &&
            (previousMatch.status === "intermission" ||
              previousMatch.status === "countdown")
          ) {
            if (versusTransitionBusyRef.current) {
              versusHydrationIntentRef.current += 1;
              return;
            }
            const preserveRunState = versusRunHydratedRef.current;
            void hydrateVersusState(
              matchId,
              preserveRunState,
              !preserveRunState && previousMatch.status === "countdown",
            );
          }
        },
      )
      .subscribe();
    realtimeRef.current = channel;
  };
  const hydrateVersusState = async (
    matchId: string,
    preserveRunState = false,
    freshMatch = false,
  ) => {
    const hydrationIntent = ++versusHydrationIntentRef.current;
    const { data, error } = await supabase.rpc("get_1v1_state", {
      p_match_id: matchId,
    });
    if (versusMatchRef.current !== matchId) return false;
    if (versusHydrationIntentRef.current !== hydrationIntent) return true;
    if (error || !data) {
      setVersusResult(error?.message ?? "COULD NOT RESTORE THIS MATCH");
      return false;
    }
    versusRunHydratedRef.current = true;
    const snapshot = data as VersusStatePayload;
    const { characterKey, characterClass } = getValidatedVersusCharacter(
      snapshot.self?.character_key,
      snapshot.self?.character_class,
    );
    const rawMaxHearts = Number(snapshot.self?.max_hearts);
    const restoredMaxHearts =
      Number.isFinite(rawMaxHearts) &&
      rawMaxHearts >= 1 &&
      rawMaxHearts <= VERSUS_MAX_HEARTS
        ? normalizeVersusHearts(rawMaxHearts)
        : getCharacterMaxHearts(characterKey, characterClass);
    const restoredWave = Math.max(1, Number(snapshot.self?.wave) || 1);
    const restoredScore = Math.max(0, Number(snapshot.self?.score) || 0);
    const restoredHearts = Math.min(
      restoredMaxHearts,
      normalizeVersusHearts(Number(snapshot.self?.hearts) || 0),
    );
    const matchStatus = snapshot.match?.status ?? "playing";
    const eliminated =
      snapshot.self?.status === "eliminated" || matchStatus === "finished";

    setSelectedCharacter(characterKey);
    setPlayerClass(characterClass);
    setVersusServerMaxHearts(restoredMaxHearts);
    if (!preserveRunState) {
      setLane(2);
      setItems([]);
      processedPickupIdsRef.current.clear();
      ambientHazardStreakRef.current = { kind: null, count: 0 };
      resetCharacterAbilityState(freshMatch ? undefined : restoredWave);
      setWaveProgress((restoredWave - 1) * 2250);
      setPauseMenuOpen(false);
      setInvincible(false);
      invincibleUntilRef.current = 0;
      if (invincibilityTimerRef.current) {
        clearTimeout(invincibilityTimerRef.current);
        invincibilityTimerRef.current = null;
      }
      clearFreezeEffect();
      if (delayedMoveTimerRef.current) {
        clearTimeout(delayedMoveTimerRef.current);
        delayedMoveTimerRef.current = null;
      }
      turnLockedRef.current = false;
      damageLockedRef.current = false;
      setAbilityNotice("");
      if (abilityNoticeTimerRef.current) {
        clearTimeout(abilityNoticeTimerRef.current);
        abilityNoticeTimerRef.current = null;
      }
      if (waveAnnouncementTimerRef.current) {
        clearTimeout(waveAnnouncementTimerRef.current);
        waveAnnouncementTimerRef.current = null;
      }
      last.current = 0;
    }
    setScore(restoredScore);
    setWave(restoredWave);
    setHearts(restoredHearts);
    applyAuthoritativeVersusPoints(snapshot.self?.obstacle_points ?? 0);
    setVersusOpponent(snapshot.opponent?.username || "RIVAL");
    setVersusOpponentHearts(
      Math.max(0, Number(snapshot.opponent?.hearts) || 0),
    );
    setPlayScope("versus");
    setOver(eliminated);
    setRunning(!eliminated);

    const pending = (snapshot.pending_attacks ?? [])
      .map((attack) => ({
        id: attack.id,
        kind: normalizeVersusObstacle(attack.obstacle_type),
      }))
      .filter(
        (attack): attack is { id: string; kind: Kind } =>
          Boolean(attack.id && attack.kind),
      );
    const mergedPending = new Map(
      incomingAttacksRef.current.map((attack) => [attack.id, attack]),
    );
    pending.forEach((attack) => mergedPending.set(attack.id, attack));
    incomingAttacksRef.current = Array.from(mergedPending.values());

    if (eliminated) {
      setPaused(false);
      setVersusPhase("finished");
      setVersusIntermissionReady(false);
      setVersusResult(
        snapshot.match?.winner_user_id === userIdRef.current
          ? "VICTORY"
          : "DEFEAT",
      );
    } else if (matchStatus === "intermission") {
      const remaining = secondsUntil(
        snapshot.match?.intermission_ends_at,
        VERSUS_INTERMISSION_SECONDS,
      );
      setVersusCountdown(remaining);
      setVersusPhase("intermission");
      setVersusIntermissionReady(true);
      setPaused(true);
    } else if (snapshot.self?.status === "intermission") {
      setVersusCountdown(VERSUS_INTERMISSION_SECONDS);
      setVersusPhase("intermission");
      setVersusIntermissionReady(false);
      setVersusResult("WAITING FOR RIVAL");
      setPaused(true);
    } else {
      const attacks = Array.from(mergedPending.values()).filter(
        (attack) => !spawnedAttackIdsRef.current.has(attack.id),
      );
      incomingAttacksRef.current = [];
      attacks.forEach((attack) =>
        spawnedAttackIdsRef.current.add(attack.id),
      );
      if (attacks.length > 0)
        setItems((current) =>
          appendSafeAttackWave(
            current,
            attacks.map((attack) => attack.kind),
            () => id.current++,
            9,
          ),
        );
      setVersusPhase("playing");
      setVersusIntermissionReady(false);
      setPaused(false);
      void audioEngine.start(soundtrack);
      if (!preserveRunState)
        announceWave(restoredWave, freshMatch, characterKey);
      else if (!versusTransitionBusyRef.current)
        announceWave(restoredWave, true, characterKey);
    }
    return true;
  };
  hydrateVersusStateRef.current = hydrateVersusState;
  const beginVersusMatch = async (
    matchId: string,
    opponent: string,
    serverStatus?: string,
  ) => {
    resetVersusClientSync();
    versusMatchRef.current = matchId;
    versusFinishedRef.current = false;
    setMainView("versus");
    setVersusOpponent(opponent || "RIVAL");
    setVersusOpponentHearts(3);
    setVersusPoints(0);
    versusPointsRef.current = 0;
    setVersusResult("");
    setVersusIntermissionReady(false);
    incomingAttacksRef.current = [];
    spawnedAttackIdsRef.current.clear();
    subscribeToMatch(matchId);
    setPlayScope("versus");
    setVersusPhase("ready");
    setRunning(false);
    const freshMatch = serverStatus === "countdown";
    const restored = await hydrateVersusState(matchId, false, freshMatch);
    if (!restored && versusMatchRef.current === matchId) {
      setVersusResult("MATCH CONNECTION INTERRUPTED · RETRYING");
      const retryHydration = () => {
        setTimeout(async () => {
          if (versusMatchRef.current !== matchId) return;
          const recovered = await hydrateVersusState(
            matchId,
            false,
            freshMatch,
          );
          if (!recovered && versusMatchRef.current === matchId)
            retryHydration();
        }, 1200);
      };
      retryHydration();
    }
  };
  const invalidateVersusSearch = () => {
    versusSearchingRef.current = false;
    versusSearchTokenRef.current += 1;
    if (versusPollTimerRef.current) {
      clearTimeout(versusPollTimerRef.current);
      versusPollTimerRef.current = null;
    }
  };
  const findVersusMatch = async (preserveResult = false) => {
    if (guest) {
      setVersusResult("SIGN IN TO PLAY 1V1");
      return;
    }
    if (versusSearchingRef.current || versusLeaving) return;
    invalidateVersusSearch();
    const searchToken = versusSearchTokenRef.current;
    if (!preserveResult) setVersusResult("");
    setVersusPhase("searching");
    versusSearchingRef.current = true;
    const poll = async () => {
      const { data, error } = await supabase.rpc("join_1v1_queue");
      if (searchToken !== versusSearchTokenRef.current) {
        if (
          data?.match_id &&
          !versusMatchRef.current &&
          !versusSearchingRef.current
        )
          void supabase.rpc("leave_1v1");
        return;
      }
      if (error) {
        setVersusResult(error.message);
        setVersusPhase("idle");
        versusSearchingRef.current = false;
        return;
      }
      if (data?.match_id) {
        versusSearchingRef.current = false;
        if (versusPollTimerRef.current) {
          clearTimeout(versusPollTimerRef.current);
          versusPollTimerRef.current = null;
        }
        void beginVersusMatch(
          data.match_id,
          data.opponent_username,
          data.status,
        );
        return;
      }
      if (
        versusSearchingRef.current &&
        searchToken === versusSearchTokenRef.current
      )
        versusPollTimerRef.current = setTimeout(() => void poll(), 1800);
    };
    versusMatchRef.current = null;
    await poll();
  };
  const startBotPractice = () => {
    invalidateVersusSearch();
    closeVersusChannel();
    versusMatchRef.current = null;
    versusFinishedRef.current = false;
    incomingAttacksRef.current = [];
    spawnedAttackIdsRef.current.clear();
    botAttackPointsRef.current = 0;
    playerAttacksAgainstBotRef.current = [];
    setMainView("versus");
    setPlayScope("practice");
    setVersusPhase("playing");
    setVersusOpponent("TRAINING BOT");
    setVersusOpponentHearts(BOT_MAX_HEARTS);
    setVersusPoints(0);
    versusPointsRef.current = 0;
    setVersusCountdown(VERSUS_INTERMISSION_SECONDS);
    setVersusResult("");
    setVersusIntermissionReady(false);
    reset(true);
  };
  const clearVersusLocalSession = () => {
    resetVersusClientSync();
    versusMatchRef.current = null;
    closeVersusChannel();
    incomingAttacksRef.current = [];
    spawnedAttackIdsRef.current.clear();
    versusAttackBusyRef.current = false;
    botAttackPointsRef.current = 0;
    playerAttacksAgainstBotRef.current = [];
    setVersusAttackBusy(false);
    setVersusIntermissionReady(false);
    setPlayScope("single");
    setVersusPhase("idle");
    setPaused(false);
    setVersusPoints(0);
    versusPointsRef.current = 0;
    setVersusOpponent("WAITING…");
    setVersusOpponentHearts(3);
  };
  const leaveVersusSession = async () => {
    const wasSearching = versusSearchingRef.current;
    const activeMatchId = versusMatchRef.current;
    const shouldTellServer = Boolean(
      userIdRef.current &&
        (wasSearching || activeMatchId),
    );
    invalidateVersusSearch();
    setVersusLeaving(shouldTellServer);
    if (!shouldTellServer) {
      clearVersusLocalSession();
      return true;
    }
    try {
      const { error } = await supabase.rpc("leave_1v1");
      if (error) {
        setVersusResult(error.message);
        if (wasSearching && !activeMatchId) {
          versusSearchingRef.current = false;
          setVersusPhase("idle");
          void findVersusMatch(true);
        }
        return false;
      }
      clearVersusLocalSession();
      return true;
    } catch {
      setVersusResult("COULD NOT LEAVE 1V1 CLEANLY · TRY AGAIN");
      if (wasSearching && !activeMatchId) {
        versusSearchingRef.current = false;
        setVersusPhase("idle");
        void findVersusMatch(true);
      }
      return false;
    } finally {
      setVersusLeaving(false);
    }
  };
  const cancelVersus = async () => {
    setVersusResult("");
    const left = await leaveVersusSession();
    if (left) setVersusResult("MATCHMAKING CANCELLED");
  };
  const switchMainView = async (nextView: MainView) => {
    if (nextView === mainView && !versusLeaving) return;
    setPauseMenuOpen(false);
    if (nextView === "versus") {
      if (running && playScope === "single") resetGameToMenu();
      setPaused(false);
      setMainView("versus");
      void loadVersusLeaderboard();
      return;
    }
    const left = await leaveVersusSession();
    if (!left) return;
    resetGameToMenu();
    setVersusResult("");
    setMainView("endless");
  };
  const backToMenu = () => {
    const wasVersus = isVersusRun || Boolean(versusMatchRef.current);
    if (wasVersus) {
      void leaveVersusSession().then((left) => {
        if (!left) return;
        resetGameToMenu();
        setMainView("versus");
        void loadVersusLeaderboard();
      });
    } else {
      resetGameToMenu();
      setMainView("endless");
    }
  };
  const sendVersusAttack = async (kind: VersusAttackKind) => {
    const attack = VERSUS_ATTACKS.find((entry) => entry.kind === kind);
    if (
      !attack ||
      versusPhase !== "intermission" ||
      !versusIntermissionReady ||
      versusCountdown <= 0 ||
      versusAttackBusyRef.current
    )
      return;
    if (isBotPractice) {
      if (versusPointsRef.current < attack.cost) {
        setVersusResult("NOT ENOUGH ATTACK COINS");
        return;
      }
      versusPointsRef.current -= attack.cost;
      playerAttacksAgainstBotRef.current.push(kind);
      setVersusPoints(versusPointsRef.current);
      setVersusResult(`${attack.label} QUEUED FOR THE BOT'S NEXT WAVE`);
      void audioEngine.playSfx("click");
      return;
    }
    if (!versusMatchRef.current) return;
    const matchId = versusMatchRef.current;
    const refreshAttackCoins = async () => {
      const refreshResult: { data: VersusStatePayload | null } = { data: null };
      await enqueueVersusStateSync(async () => {
        const { data } = await supabase.rpc("get_1v1_state", {
          p_match_id: matchId,
        });
        refreshResult.data = data as VersusStatePayload | null;
      });
      if (versusMatchRef.current !== matchId) return;
      const snapshot = refreshResult.data;
      const authoritativePoints = Number(snapshot?.self?.obstacle_points);
      if (Number.isFinite(authoritativePoints))
        applyAuthoritativeVersusPoints(authoritativePoints);
      const remaining = secondsUntil(
        snapshot?.match?.intermission_ends_at,
        0,
      );
      setVersusCountdown(remaining);
      setVersusIntermissionReady(
        snapshot?.match?.status === "intermission",
      );
    };
    versusAttackBusyRef.current = true;
    setVersusAttackBusy(true);
    try {
      const attackResult: {
        data: { remaining_points?: number } | null;
        error: string;
      } = { data: null, error: "" };
      await enqueueVersusStateSync(async () => {
        if (versusMatchRef.current !== matchId) return;
        const { data, error } = await supabase.rpc("send_1v1_attack", {
          p_match_id: matchId,
          p_obstacle_type: kind,
        });
        attackResult.data = data as { remaining_points?: number } | null;
        attackResult.error = error?.message ?? "";
      });
      if (versusMatchRef.current !== matchId) return;
      if (attackResult.error) {
        setVersusResult(attackResult.error);
        await refreshAttackCoins();
        return;
      }
      if (typeof attackResult.data?.remaining_points === "number")
        applyAuthoritativeVersusPoints(attackResult.data.remaining_points);
      setVersusResult("");
    } catch {
      if (versusMatchRef.current === matchId) {
        setVersusResult("COULD NOT SEND THAT ATTACK · TRY AGAIN");
        await refreshAttackCoins();
      }
    } finally {
      if (versusMatchRef.current === matchId) {
        versusAttackBusyRef.current = false;
        setVersusAttackBusy(false);
      }
    }
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target?.matches(
          'button, input, textarea, select, [contenteditable="true"]',
        )
      )
        return;
      if (["ArrowLeft", "a", "A"].includes(e.key)) {
        e.preventDefault();
        move(-1);
      }
      if (["ArrowRight", "d", "D"].includes(e.key)) {
        e.preventDefault();
        move(1);
      }
      if (e.key === " " && state.current.running && !isOnlineVersus) {
        e.preventDefault();
        toggleManualPause();
      }
      if (
        e.key === "Enter" &&
        !state.current.running &&
        mainView === "endless"
      )
        reset();
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [move, reset, isOnlineVersus, mainView, toggleManualPause]);
  useEffect(() => {
    if (!running || paused || wavePause) return;
    let raf = 0,
      prev = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(32, now - prev);
      prev = now;
      const currentSpeedMultiplier = getWaveSpeedMultiplier(wave);
      const pacerRushActive =
        activeCharacter === "runner_pacer" &&
        pacerRushRemainingRef.current > 0;
      const mimicPhase = (wave - 1) % 3;
      const characterSpeedMultiplier = pacerRushActive
        ? 3
        : activeCharacter === "runner_dash"
          ? 1.06
          : activeCharacter === "runner_blitz"
            ? 1.12
            : activeCharacter === "runner_velocity"
              ? 1.2
              : 1;
      const obstacleSpeedMultiplier =
        currentSpeedMultiplier * characterSpeedMultiplier;
      if (now - last.current > Math.max(330, 980 - wave * 55)) {
        last.current = now;
        const r = Math.random(),
          danger = Math.min(0.82, 0.59 + wave * 0.025),
          baseGemChance =
            mode === "impossible" ? 0.14 : mode === "hardcore" ? 0.1 : 0.06,
          characterGemMultiplier =
            (activeCharacter === "runner_fortune" ? 2 : 1) *
            (activeCharacter === "misc_broker" ? 1.25 : 1) *
            (activeCharacter === "misc_prospector" ? 1.6 : 1) *
            (activeCharacter === "misc_mimic" && mimicPhase === 1
              ? 1.5
              : 1) *
            (activeCharacter === "trickster_wildcard" &&
            wildcardBuffRef.current === "gems"
              ? 1.5
              : 1),
          gemChance = Math.min(
            0.3,
            baseGemChance * characterGemMultiplier,
          ),
          gemThreshold = 1 - gemChance,
          versusGemThreshold = 1 - 0.025 * characterGemMultiplier,
          versusCoinChance =
            activeCharacter === "misc_broker" ? 0.27 * 1.25 : 0.27,
          sameHazardLimit =
            activeCharacter === "misc_muse"
              ? 2
              : activeCharacter === "misc_scribe"
                ? 3
                : MAX_SAME_HAZARD_STREAK;
        const hazardChoices =
          ambientHazardStreakRef.current.count >= sameHazardLimit
            ? AMBIENT_HAZARDS.filter(
                (hazard) => hazard !== ambientHazardStreakRef.current.kind,
              )
            : AMBIENT_HAZARDS;
        const randomHazard = () =>
          hazardChoices[Math.floor(Math.random() * hazardChoices.length)];
        let kind: Kind;
        if (isVersusRun && r < versusCoinChance) kind = "coin";
        else if (isVersusRun && r > versusGemThreshold) kind = "gem";
        else if (r < danger || isVersusRun) kind = randomHazard();
        else if (r > gemThreshold) kind = "gem";
        else kind = randomHazard();
        setItems((v) => {
          const hazardLanes = new Set(
            v
              .filter((item) => isHazardKind(item.kind))
              .map((item) => item.lane),
          );
          if (isHazardKind(kind) && hazardLanes.size >= MAX_HAZARD_LANES)
            return v;
          const blocked = new Set(v.map((x) => x.lane));
          const lanes = TRACK_LANES.filter((l) => !blocked.has(l));
          if (!lanes.length) return v;
          const spawnLane = lanes[Math.floor(Math.random() * lanes.length)];
          if (isHazardKind(kind)) {
            const previous = ambientHazardStreakRef.current;
            ambientHazardStreakRef.current =
              previous.kind === kind
                ? { kind, count: previous.count + 1 }
                : { kind, count: 1 };
          }
          return [...v, { id: id.current++, lane: spawnLane, y: -10, kind }];
        });
      }
      setItems((old) => {
        let clearRecoveryZone = false;
        let clearDamagedLane = false;
        const advanced = old.flatMap((item) => {
          const isHazard = item.kind !== "gem" && item.kind !== "coin";
          let speedFactor =
            item.kind === "barrel"
              ? 1.75
              : item.kind === "car"
                ? 1.28
                : item.kind === "log"
                  ? 0.72
                  : item.kind === "rock"
                  ? 0.3
                  : 1;
          if (
            activeCharacter === "tank_drag" &&
            (item.kind === "barrel" || item.kind === "log")
          )
            speedFactor *= 0.85;
          if (isHazard && activeCharacter === "misc_nomad")
            speedFactor *= 0.93;
          if (item.kind === "spikes" && activeCharacter === "misc_tinker")
            speedFactor *= 0.75;
          if (
            (item.kind === "rock" || item.kind === "spikes") &&
            activeCharacter === "misc_lantern"
          )
            speedFactor *= 0.85;
          if (
            item.kind === "snowflake" &&
            activeCharacter === "misc_weaver"
          )
            speedFactor *= 0.65;
          if (
            isHazard &&
            activeCharacter === "misc_mimic" &&
            mimicPhase === 0
          )
            speedFactor *= 0.9;
          if (
            (item.kind === "gem" || item.kind === "coin") &&
            activeCharacter === "misc_mimic" &&
            mimicPhase === 2
          )
            speedFactor *= 0.75;
          if (
            (item.kind === "gem" || item.kind === "coin") &&
            activeCharacter === "misc_catalyst"
          )
            speedFactor *= 0.75;
          if (
            (item.kind === "gem" || item.kind === "coin") &&
            activeCharacter === "misc_harvester"
          )
            speedFactor *= 0.65;
          if (isHazard && activeCharacter === "misc_muse")
            speedFactor *= 0.88;
          if (
            isHazard &&
            activeCharacter === "trickster_smoke" &&
            smokeSlowRemainingRef.current > 0
          )
            speedFactor *= 0.65;
          if (
            isHazard &&
            activeCharacter === "trickster_clockwork" &&
            clockworkSlowRemainingRef.current > 0
          )
            speedFactor *= 0.7;
          if (
            isHazard &&
            activeCharacter === "trickster_wildcard" &&
            wildcardBuffRef.current === "slow"
          )
            speedFactor *= 0.85;
          const n = {
            ...item,
            y:
              item.y +
              BASE_ITEM_SPEED *
                obstacleSpeedMultiplier *
                speedFactor *
                dt,
          };
          const crossedRunnerBand = item.y < 91 && n.y >= 65;
          const abilityGraze =
            (activeCharacter === "trickster_rogue" ||
              activeCharacter === "trickster_gambit" ||
              activeCharacter === "trickster_echo") &&
            isHazard &&
            Math.abs(n.lane - state.current.lane) === 1 &&
            crossedRunnerBand &&
            !rogueGrazedItemIdsRef.current.has(n.id);
          if (abilityGraze) {
            rogueGrazedItemIdsRef.current.add(n.id);
            if (
              activeCharacter === "trickster_rogue" &&
              rogueGrazeCooldownUntilRef.current <= Date.now()
            ) {
              rogueGrazeCooldownUntilRef.current = Date.now() + 1250;
              grantInvincibility(450);
              showAbilityNotice("SHADOWSTEP · GRAZE SHIELD");
            }
            if (
              activeCharacter === "trickster_gambit" &&
              gambitCooldownUntilRef.current <= Date.now()
            ) {
              gambitCooldownUntilRef.current = Date.now() + 2500;
              gambitBoostRemainingRef.current = 2000;
              showAbilityNotice("HIGH STAKES · SCORE ×1.75", 950);
            }
            if (
              activeCharacter === "trickster_echo" &&
              echoGrazeCooldownUntilRef.current <= Date.now()
            ) {
              echoGrazeCooldownUntilRef.current = Date.now() + 2000;
              grantInvincibility(650);
              setScore((value) => value + 40);
              showAbilityNotice("ECHO GRAZE · SHIELD +40 SCORE", 1000);
            }
          }
          const rangerPickup =
            activeCharacter === "runner_ranger" &&
            (n.kind === "gem" || n.kind === "coin") &&
            Math.abs(n.lane - state.current.lane) <= 1;
          const rangerPulled =
            rangerPickup && n.lane !== state.current.lane;
          if (
            !damageLockedRef.current &&
            (n.lane === state.current.lane || rangerPickup) &&
            crossedRunnerBand
          ) {
            if (rangerPulled)
              showAbilityNotice("PICKUP MAGNET · ADJACENT PICKUP");
            if (n.kind === "gem" || n.kind === "coin") {
              if (processedPickupIdsRef.current.has(n.id)) return [];
              processedPickupIdsRef.current.add(n.id);
              if (activeCharacter === "runner_courier") {
                courierBoostRemainingRef.current = 4000;
                showAbilityNotice("SPECIAL DELIVERY · SCORE ×1.25", 900);
              }
              if (
                activeCharacter === "medic_tonic" &&
                tonicCollectibleWaveRef.current !== wave
              ) {
                tonicCollectibleWaveRef.current = wave;
                setHearts((value) => Math.min(maxHearts, value + 0.5));
                showAbilityNotice("FIRST TONIC · +0.5 HP", 850);
              }
            }
            if (n.kind === "gem") {
              void audioEngine.playSfx("gem");
              const total = gemsRef.current + 1;
              gemsRef.current = total;
              setGems(total);
              setGemBump(false);
              requestAnimationFrame(() => setGemBump(true));
              setTimeout(() => setGemBump(false), 500);
              if (activeCharacter === "runner_spark") {
                sparkBoostRemainingRef.current = 10000;
                showAbilityNotice("CRYSTAL CHARGE · SCORE ×1.50", 900);
              }
              if (
                activeCharacter === "medic_bloom" &&
                bloomGemWaveRef.current !== wave
              ) {
                bloomGemWaveRef.current = wave;
                setHearts((value) => Math.min(maxHearts, value + 0.5));
                showAbilityNotice("HEALING BLOOM · +0.5 HP", 850);
              }
              if (activeCharacter === "medic_pulse") {
                pulseGemCountRef.current += 1;
                if (pulseGemCountRef.current % 3 === 0) {
                  setHearts((value) => Math.min(maxHearts, value + 1));
                  showAbilityNotice("VITAL PULSE · +1 HP", 850);
                }
              }
              if (activeCharacter === "medic_sprout") {
                sproutGemCountRef.current += 1;
                if (sproutGemCountRef.current % 2 === 0) {
                  setHearts((value) => Math.min(maxHearts, value + 0.5));
                  showAbilityNotice("GROWTH CYCLE · +0.5 HP", 850);
                }
              }
              if (activeCharacter === "medic_vial") {
                grantInvincibility(2000);
                showAbilityNotice("CRYSTAL TONIC · 2 SECOND SHIELD", 1200);
              }
              if (userIdRef.current)
                void supabase
                  .rpc("increment_player_gems")
                  .then(({ data, error }) => {
                    if (error) {
                      console.error("Could not save gem:", error.message);
                      return;
                    }
                    if (typeof data === "number") {
                      gemsRef.current = data;
                      setGems(data);
                    }
                  });
            } else if (n.kind === "coin") {
              void audioEngine.playSfx("gem");
              if (isBotPractice) {
                versusPointsRef.current += 2;
                setVersusPoints(versusPointsRef.current);
              } else if (isOnlineVersus && versusMatchRef.current) {
                queueOnlineCoinAward(versusMatchRef.current, n.id);
              }
            } else if (n.kind === "snowflake") {
              if (
                activeCharacter === "medic_remedy" &&
                remedySnowflakeWaveRef.current !== wave
              ) {
                remedySnowflakeWaveRef.current = wave;
                setHearts((value) => Math.min(maxHearts, value + 0.5));
                showAbilityNotice("COLD REMEDY · +0.5 HP", 900);
              }
              if (activeCharacter === "runner_scout") {
                void audioEngine.playSfx("shield");
                clearFreezeEffect();
                if (scoutShieldCooldownUntilRef.current <= Date.now()) {
                  scoutShieldCooldownUntilRef.current = Date.now() + 4000;
                  grantInvincibility(1000);
                  showAbilityNotice(
                    "QUICKSTEP · FREEZE BLOCKED + 1 SECOND SHIELD",
                  );
                } else {
                  showAbilityNotice("QUICKSTEP · FREEZE BLOCKED");
                }
              } else {
                void audioEngine.playSfx("freeze");
                applyFreezeEffect(
                  activeCharacter === "tank_glacier" ? 1500 : 3000,
                );
                setFlash("freeze-hit");
                setTimeout(() => {
                  setFlash((value) =>
                    value === "freeze-hit" ? "" : value,
                  );
                }, 700);
              }
            } else if (
              activeCharacter === "runner_vault" &&
              n.kind === "spikes"
            ) {
              void audioEngine.playSfx("shield");
              setFlash("shield");
              setTimeout(() => setFlash(""), 150);
              showAbilityNotice("SPIKE VAULT · SPIKES CLEARED");
              return [];
            } else if (
              activeCharacter === "tank_hammer" &&
              n.kind === "barrel" &&
              hammerBreakWaveRef.current !== wave
            ) {
              hammerBreakWaveRef.current = wave;
              void audioEngine.playSfx("shield");
              setFlash("shield");
              setTimeout(() => setFlash(""), 150);
              showAbilityNotice("DEMOLITION · FIRST BARREL 0 DAMAGE");
              return [];
            } else if (
              invincibleUntilRef.current > Date.now()
            ) {
              setFlash("shield");
              setTimeout(() => setFlash(""), 120);
              showAbilityNotice(`${activeAbility.name} · HIT BLOCKED`);
              return [];
            } else if (
              activeCharacter === "tank_warden" &&
              n.kind === "spikes" &&
              wardenBlockWaveRef.current !== wave
            ) {
              wardenBlockWaveRef.current = wave;
              void audioEngine.playSfx("shield");
              setFlash("shield");
              setTimeout(() => setFlash(""), 150);
              showAbilityNotice("SPIKE LOCK · FIRST SPIKE BLOCKED");
              return [];
            } else if (
              activeCharacter === "tank_citadel" &&
              wave % 2 === 0 &&
              citadelBlockWaveRef.current !== wave
            ) {
              citadelBlockWaveRef.current = wave;
              void audioEngine.playSfx("shield");
              setFlash("shield");
              setTimeout(() => setFlash(""), 150);
              showAbilityNotice("EVEN WALL · FIRST HIT BLOCKED");
              return [];
            } else if (
              activeCharacter === "trickster_phantom" &&
              phantomPhaseWaveRef.current !== wave
            ) {
              phantomPhaseWaveRef.current = wave;
              void audioEngine.playSfx("shield");
              setFlash("shield");
              setTimeout(() => setFlash(""), 150);
              showAbilityNotice("PHASE VEIL · HIT PHASED");
              return [];
            } else if (
              activeCharacter === "tank_rampart" &&
              (rampartCollisionCountRef.current + 1) % 3 === 0
            ) {
              rampartCollisionCountRef.current += 1;
              void audioEngine.playSfx("shield");
              setFlash("shield");
              setTimeout(() => setFlash(""), 150);
              showAbilityNotice("THIRD WALL · 0 DAMAGE");
              return [];
            } else {
              clearRecoveryZone = true;
              damageLockedRef.current = true;
              if (activeCharacter === "tank_rampart")
                rampartCollisionCountRef.current += 1;
              if (activeCharacter === "runner_comet") {
                cometChargeRemainingRef.current = 8000;
                cometChargedRef.current = false;
                showAbilityNotice("STAR DRIVE · RECHARGING", 800);
              }
              if (activeCharacter === "runner_flare")
                flareDamageWaveRef.current = wave;
              if (activeCharacter === "medic_mender")
                menderChargeRemainingRef.current = 12000;
              const rawDamage =
                mode === "impossible"
                  ? 1
                  : n.kind === "rock"
                    ? 2
                    : n.kind === "barrel"
                      ? 0.5
                      : activeCharacter === "tank_hammer" && n.kind === "log"
                        ? 0.5
                        : activeCharacter === "tank_ironclad" &&
                            n.kind === "log"
                          ? 0.5
                        : activeCharacter === "tank_brace" &&
                            n.kind === "spikes"
                          ? 0.5
                          : 1;
              let abilityAdjustedDamage =
                activeCharacter === "tank_anchor" && n.kind === "rock"
                  ? 1
                  : activeCharacter === "tank_colossus" && n.kind === "rock"
                    ? 1.5
                  : rawDamage;
              if (
                activeCharacter === "tank_anchor" &&
                n.kind === "rock" &&
                rawDamage > abilityAdjustedDamage
              )
                showAbilityNotice("STONEGUARD · ROCK DAMAGE 1 HP");
              if (
                activeCharacter === "tank_colossus" &&
                n.kind === "rock" &&
                rawDamage > abilityAdjustedDamage
              )
                showAbilityNotice("COLOSSUS FRAME · ROCK DAMAGE 1.5 HP");
              if (
                activeCharacter === "tank_ironclad" &&
                n.kind === "log"
              )
                showAbilityNotice("IRON SHELL · LOG DAMAGE 0.5 HP");
              if (
                activeCharacter === "tank_brace" &&
                n.kind === "spikes"
              )
                showAbilityNotice("SPIKE BRACE · SPIKE DAMAGE 0.5 HP");
              if (
                (activeCharacter === "medic_mercy" ||
                  activeCharacter === "tank_bulwark") &&
                abilityAdjustedDamage > 0.5 &&
                firstGuardWaveRef.current !== wave
              ) {
                firstGuardWaveRef.current = wave;
                abilityAdjustedDamage = Math.max(
                  0.5,
                  abilityAdjustedDamage - 0.5,
                );
                showAbilityNotice(
                  `${
                    activeCharacter === "tank_bulwark"
                      ? "HEAVY PLATE"
                      : "GRACE GUARD"
                  } · BLOCKED 0.5 HP`,
                );
              }
              if (
                activeCharacter === "tank_bastion" &&
                bastionArmorChargedRef.current
              ) {
                bastionArmorChargedRef.current = false;
                bastionChargeRemainingRef.current = 6000;
                abilityAdjustedDamage = Math.max(
                  0,
                  abilityAdjustedDamage - 0.5,
                );
                showAbilityNotice("HOLD GROUND · 0.5 HP ARMOR USED", 1100);
              }
              const damage = abilityAdjustedDamage;
              if (damage === 0) {
                void audioEngine.playSfx("shield");
                setFlash("shield");
                setTimeout(() => {
                  setFlash((value) => (value === "shield" ? "" : value));
                  damageLockedRef.current = false;
                }, 150);
                return [];
              }
              void audioEngine.playSfx("hit");
              let nextHearts = state.current.hearts - damage;
              if (
                nextHearts <= 0 &&
                activeCharacter === "tank_sentinel" &&
                !sentinelLastStandUsedRef.current
              ) {
                sentinelLastStandUsedRef.current = true;
                nextHearts = 0.5;
                showAbilityNotice("LAST STAND · SURVIVED AT 0.5 HP", 1400);
              }
              if (
                nextHearts <= 0 &&
                activeCharacter === "medic_revive" &&
                !reviveUsedRef.current
              ) {
                reviveUsedRef.current = true;
                nextHearts = 0.5;
                showAbilityNotice("PHOENIX REVIVE · SURVIVED AT 0.5 HP", 1400);
              }
              const triggerLifelineHeal =
                nextHearts > 0 &&
                nextHearts <= 1 &&
                activeCharacter === "medic_lifeline" &&
                !lifelineUsedRef.current;
              if (triggerLifelineHeal) lifelineUsedRef.current = true;
              const triggerReserveHeal =
                nextHearts > 0 &&
                activeCharacter === "medic_reserve" &&
                reserveHealStoredRef.current;
              if (triggerReserveHeal) reserveHealStoredRef.current = false;
              if (nextHearts > 0 && activeCharacter === "tank_plow") {
                clearDamagedLane = true;
                showAbilityNotice("LANE PLOW · LANE CLEARED", 1000);
              }
              if (nextHearts > 0 && activeCharacter === "trickster_smoke") {
                smokeSlowRemainingRef.current = 2500;
                showAbilityNotice("SMOKE SCREEN · HAZARDS 35% SLOWER", 1100);
              }
              setHearts(Math.max(0, nextHearts));
              if (nextHearts <= 0) {
                setRunning(false);
                setPauseMenuOpen(false);
                setOver(true);
                if (isBotPractice) {
                  setVersusResult("PRACTICE DEFEAT");
                  setVersusPhase("finished");
                  setVersusIntermissionReady(false);
                } else if (guest) {
                  setGems(0);
                  gemsRef.current = 0;
                } else {
                  const best = Math.max(
                    highScoreRef.current,
                    scoreRef.current,
                  );
                  highScoreRef.current = best;
                  setHighScore(best);
                  if (userIdRef.current)
                    void supabase
                      .rpc("save_player_high_score", { new_score: best })
                      .then(({ data, error }) => {
                        if (error) {
                          console.error(
                            "Could not save high score:",
                            error.message,
                          );
                          return;
                        }
                        if (typeof data === "number") {
                          highScoreRef.current = data;
                          setHighScore(data);
                        }
                      });
                }
              }
              setPaused(true);
              setFlash(
                damage <= 0.5
                  ? "life-half"
                  : damage >= 2
                    ? "life-two"
                    : "life-lost",
              );
              setTimeout(() => {
                setFlash("");
                setPaused(false);
                damageLockedRef.current = false;
                if (triggerLifelineHeal) {
                  setHearts((value) => Math.min(maxHearts, value + 1.5));
                  showAbilityNotice("LIFELINE · +1.5 HP", 1200);
                }
                if (triggerReserveHeal) {
                  setHearts((value) => Math.min(maxHearts, value + 0.5));
                  showAbilityNotice("RESERVE DOSE · +0.5 HP", 1200);
                }
              }, 480);
              return [];
            }
            return [];
          }
          if (n.y < 108) return [n];
          if (
            isHazard &&
            activeCharacter === "trickster_pickpocket"
          ) {
            pickpocketPassedCountRef.current += 1;
            if (pickpocketPassedCountRef.current % 7 === 0) {
              setScore((value) => value + 75);
              showAbilityNotice("CLOSE COUNT · +75 SCORE", 950);
            }
          }
          rogueGrazedItemIdsRef.current.delete(n.id);
          return [];
        });
        // Keep the runner in place and clear every nearby object after impact.
        const recoveryRetained = clearRecoveryZone
          ? advanced.filter((item) => item.y <= 45 || item.y >= 105)
          : advanced;
        const retained = clearDamagedLane
          ? recoveryRetained.filter(
              (item) =>
                item.lane !== state.current.lane ||
                item.kind === "gem" ||
                item.kind === "coin",
            )
          : recoveryRetained;
        const retainedIds = new Set(retained.map((item) => item.id));
        rogueGrazedItemIdsRef.current.forEach((itemId) => {
          if (!retainedIds.has(itemId))
            rogueGrazedItemIdsRef.current.delete(itemId);
        });
        return retained;
      });
      const rawProgressGain = (dt / 12) * (1 + wave * 0.01);
      const waveProgressGain = Math.max(1, Math.round(rawProgressGain));
      let characterScoreMultiplier = 1;
      if (activeCharacter === "runner_ace")
        characterScoreMultiplier = 1.1;
      else if (activeCharacter === "runner_dash")
        characterScoreMultiplier = 1.06;
      else if (
        activeCharacter === "runner_stride" &&
        state.current.lane >= 1 &&
        state.current.lane <= 3
      )
        characterScoreMultiplier = 1.12;
      else if (
        activeCharacter === "runner_courier" &&
        courierBoostRemainingRef.current > 0
      )
        characterScoreMultiplier = 1.25;
      else if (activeCharacter === "runner_tempo" && wave % 2 === 0)
        characterScoreMultiplier = 1.18;
      else if (
        activeCharacter === "runner_vector" &&
        (state.current.lane === 0 || state.current.lane === 4)
      )
        characterScoreMultiplier = 1.25;
      else if (activeCharacter === "runner_blitz")
        characterScoreMultiplier = 1.12;
      else if (activeCharacter === "runner_horizon" && wave >= 10)
        characterScoreMultiplier = 1.3;
      else if (activeCharacter === "runner_velocity")
        characterScoreMultiplier = 1.2;
      else if (activeCharacter === "runner_zenith")
        characterScoreMultiplier =
          1 + Math.min(0.6, Math.max(0, wave - 1) * 0.02);
      else if (pacerRushActive) characterScoreMultiplier = 5;
      else if (
        activeCharacter === "runner_drift" &&
        driftBoostRemainingRef.current > 0
      )
        characterScoreMultiplier = 1.15;
      else if (
        activeCharacter === "runner_spark" &&
        sparkBoostRemainingRef.current > 0
      )
        characterScoreMultiplier = 1.5;
      else if (
        activeCharacter === "runner_flare" &&
        flareBoostWaveRef.current === wave
      )
        characterScoreMultiplier = 1.5;
      else if (activeCharacter === "runner_relay")
        characterScoreMultiplier =
          1 + Math.min(0.3, Math.max(0, wave - 1) * 0.03);
      else if (
        activeCharacter === "runner_comet" &&
        cometChargedRef.current
      )
        characterScoreMultiplier = 1.5;
      else if (
        activeCharacter === "medic_halo" &&
        state.current.hearts >= maxHearts
      )
        characterScoreMultiplier = 1.15;
      else if (
        activeCharacter === "tank_reactor" &&
        state.current.hearts <= 2
      )
        characterScoreMultiplier = 1.25;
      else if (
        activeCharacter === "trickster_gambit" &&
        gambitBoostRemainingRef.current > 0
      )
        characterScoreMultiplier = 1.75;
      else if (
        activeCharacter === "trickster_wildcard" &&
        wildcardBuffRef.current === "score"
      )
        characterScoreMultiplier = 1.15;
      const totalScoreMultiplier =
        classScoreMultiplier *
        characterScoreMultiplier *
        activeWeaponScoreMultiplier;
      scoreCarryRef.current +=
        rawProgressGain *
        obstacleSpeedMultiplier *
        modeMultiplier *
        totalScoreMultiplier;
      const scoreGain = Math.floor(scoreCarryRef.current);
      scoreCarryRef.current -= scoreGain;
      if (pacerRushActive)
        pacerRushRemainingRef.current = Math.max(
          0,
          pacerRushRemainingRef.current - dt,
        );
      if (courierBoostRemainingRef.current > 0)
        courierBoostRemainingRef.current = Math.max(
          0,
          courierBoostRemainingRef.current - dt,
        );
      if (driftBoostRemainingRef.current > 0)
        driftBoostRemainingRef.current = Math.max(
          0,
          driftBoostRemainingRef.current - dt,
        );
      if (sparkBoostRemainingRef.current > 0)
        sparkBoostRemainingRef.current = Math.max(
          0,
          sparkBoostRemainingRef.current - dt,
        );
      if (orbitCooldownRemainingRef.current > 0)
        orbitCooldownRemainingRef.current = Math.max(
          0,
          orbitCooldownRemainingRef.current - dt,
        );
      if (gambitBoostRemainingRef.current > 0)
        gambitBoostRemainingRef.current = Math.max(
          0,
          gambitBoostRemainingRef.current - dt,
        );
      if (smokeSlowRemainingRef.current > 0)
        smokeSlowRemainingRef.current = Math.max(
          0,
          smokeSlowRemainingRef.current - dt,
        );
      if (clockworkSlowRemainingRef.current > 0)
        clockworkSlowRemainingRef.current = Math.max(
          0,
          clockworkSlowRemainingRef.current - dt,
        );
      if (clockworkCooldownRemainingRef.current > 0)
        clockworkCooldownRemainingRef.current = Math.max(
          0,
          clockworkCooldownRemainingRef.current - dt,
        );
      if (
        activeCharacter === "tank_bastion" &&
        !bastionArmorChargedRef.current
      ) {
        bastionChargeRemainingRef.current = Math.max(
          0,
          bastionChargeRemainingRef.current - dt,
        );
        if (bastionChargeRemainingRef.current === 0) {
          bastionArmorChargedRef.current = true;
          showAbilityNotice("HOLD GROUND · 0.5 HP ARMOR READY", 1100);
        }
      }
      if (
        activeCharacter === "medic_mender" &&
        menderHealedWaveRef.current !== wave
      ) {
        menderChargeRemainingRef.current = Math.max(
          0,
          menderChargeRemainingRef.current - dt,
        );
        if (
          menderChargeRemainingRef.current === 0 &&
          state.current.hearts < maxHearts
        ) {
          menderHealedWaveRef.current = wave;
          setHearts((value) => Math.min(maxHearts, value + 0.5));
          showAbilityNotice("STEADY MEND · +0.5 HP", 1000);
        }
      }
      if (
        activeCharacter === "runner_comet" &&
        !cometChargedRef.current
      ) {
        cometChargeRemainingRef.current = Math.max(
          0,
          cometChargeRemainingRef.current - dt,
        );
        if (cometChargeRemainingRef.current === 0) {
          cometChargedRef.current = true;
          showAbilityNotice("STAR DRIVE · SCORE ×1.50", 1000);
        }
      }
      if (scoreGain > 0) setScore((v) => v + scoreGain);
      setWaveProgress((v) => v + waveProgressGain);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [
    running,
    paused,
    wavePause,
    wave,
    guest,
    mode,
    maxHearts,
    activeClass,
    activeCharacter,
    playScope,
    isBotPractice,
    isOnlineVersus,
    isVersusRun,
    modeMultiplier,
    classScoreMultiplier,
    activeWeaponScoreMultiplier,
    grantInvincibility,
    applyFreezeEffect,
    clearFreezeEffect,
    showAbilityNotice,
    queueOnlineCoinAward,
    activeAbility.name,
  ]);
  useEffect(() => {
    if (!running) return;
    const next = Math.floor(waveProgress / 2250) + 1;
    if (next !== wave) {
      const completedWave = next - 1;
      setWave(next);
      wildcardBuffRef.current = null;
      if (activeCharacter === "runner_flare") {
        const cleanWave = flareDamageWaveRef.current !== completedWave;
        flareBoostWaveRef.current = cleanWave ? next : 0;
        if (cleanWave)
          showAbilityNotice("CLEAN RUN · NEXT WAVE SCORE ×1.50", 1200);
      }
      if (activeCharacter === "medic_mender") {
        menderChargeRemainingRef.current = 12000;
        menderHealedWaveRef.current = 0;
      }
      if (
        mode === "normal" &&
        activeCharacter === "medic_reserve" &&
        state.current.hearts >= maxHearts &&
        !reserveHealStoredRef.current
      ) {
        reserveHealStoredRef.current = true;
        showAbilityNotice("RESERVE DOSE · 0.5 HP STORED", 1100);
      }
      if (mode === "normal") {
        const sutureFullRestore =
          activeCharacter === "medic_suture" && completedWave % 3 === 0;
        const healAmount =
          activeCharacter === "medic_patch"
            ? 1.5
            : activeCharacter === "medic_salve" &&
                state.current.hearts <= 2
              ? 1.5
              : activeCharacter === "medic_oracle" &&
                  completedWave % 3 === 0
                ? 2
            : activeCharacter === "medic_seraph"
              ? 1.5
              : activeCharacter === "tank_atlas"
                ? 1
                : activeClass === "tank"
                  ? 0.5
                  : 1;
        if (
          activeCharacter === "medic_patch" &&
          state.current.hearts < maxHearts
        )
          showAbilityNotice("FIELD DRESSING · +1.5 HP", 1200);
        if (
          activeCharacter === "medic_salve" &&
          state.current.hearts <= 2 &&
          state.current.hearts < maxHearts
        )
          showAbilityNotice("DEEP SALVE · +1.5 HP", 1200);
        if (
          activeCharacter === "medic_oracle" &&
          completedWave % 3 === 0 &&
          state.current.hearts < maxHearts
        )
          showAbilityNotice("THIRD OMEN · +2 HP", 1200);
        if (
          sutureFullRestore &&
          state.current.hearts < maxHearts
        )
          showAbilityNotice("TRIAGE CYCLE · HP RESTORED TO 5", 1200);
        if (
          activeCharacter === "medic_seraph" &&
          state.current.hearts < maxHearts
        )
          showAbilityNotice("DIVINE RECOVERY · +1.5 HP", 1200);
        if (
          activeCharacter === "tank_atlas" &&
          state.current.hearts < maxHearts
        )
          showAbilityNotice("WORLD BEARER · +1 HP", 1200);
        setHearts((value) =>
          sutureFullRestore
            ? maxHearts
            : Math.min(maxHearts, value + healAmount),
        );
      }
      if (isBotPractice) {
        const queuedAttacks = playerAttacksAgainstBotRef.current;
        playerAttacksAgainstBotRef.current = [];
        const outcome = simulateBotWave(
          versusOpponentHearts,
          queuedAttacks,
          next - 1,
        );
        setVersusOpponentHearts(outcome.hearts);
        if (outcome.hearts <= 0) {
          setVersusResult("PRACTICE VICTORY");
          setVersusPhase("finished");
          setVersusIntermissionReady(false);
          setPaused(false);
          setRunning(false);
          setOver(true);
          return;
        }
        const simulatedBotCoinPickups = Math.floor(Math.random() * 3) * 2;
        botAttackPointsRef.current += 3 + simulatedBotCoinPickups;
        versusPointsRef.current += 3;
        setVersusPoints(versusPointsRef.current);
        setVersusCountdown(VERSUS_INTERMISSION_SECONDS);
        setVersusPhase("intermission");
        setVersusIntermissionReady(true);
        setVersusResult(
          queuedAttacks.length === 0
            ? "THE BOT SURVIVED THE WAVE"
            : `BOT WAVE: ${outcome.landed} HIT · ${outcome.dodged} DODGED`,
        );
        setPaused(true);
      } else if (isOnlineVersus && versusMatchRef.current) {
        const completedAttackIds = Array.from(spawnedAttackIdsRef.current);
        if (completedAttackIds.length > 0)
          void acknowledgeSpawnedVersusAttacks(
            versusMatchRef.current,
            completedAttackIds,
          );
        setVersusCountdown(VERSUS_INTERMISSION_SECONDS);
        setVersusPhase("intermission");
        setVersusIntermissionReady(false);
        setVersusResult("WAITING FOR RIVAL");
        setPaused(true);
      } else announceWave(next);
    }
  }, [
    waveProgress,
    running,
    wave,
    announceWave,
    mode,
    maxHearts,
    activeClass,
    activeCharacter,
    playScope,
    isBotPractice,
    isOnlineVersus,
    versusOpponentHearts,
    showAbilityNotice,
    acknowledgeSpawnedVersusAttacks,
  ]);
  useEffect(() => {
    if (versusPhase !== "intermission") return;
    if (versusCountdown <= 0) {
      if (isBotPractice) {
        let botBudget = botAttackPointsRef.current;
        const botAttacks: VersusAttackKind[] = [];
        const attackLimit = Math.min(6, 1 + Math.ceil(wave / 3));
        while (botBudget >= 2 && botAttacks.length < attackLimit) {
          const affordable = VERSUS_ATTACKS.filter(
            (attack) => attack.cost <= botBudget,
          );
          if (affordable.length === 0) break;
          const chosen = affordable[Math.floor(Math.random() * affordable.length)];
          botAttacks.push(chosen.kind);
          botBudget -= chosen.cost;
        }
        botAttackPointsRef.current = botBudget;
        if (botAttacks.length > 0)
          setItems((current) =>
            appendSafeAttackWave(
              current,
              botAttacks.map((attack) =>
                attack === "spike" ? "spikes" : attack,
              ),
              () => id.current++,
              18,
            ),
          );
        setVersusResult(
          botAttacks.length > 0
            ? `TRAINING BOT SENT ${botAttacks.length} HAZARD${botAttacks.length === 1 ? "" : "S"}`
            : "TRAINING BOT SAVED ITS ATTACK COINS",
        );
        setVersusPhase("playing");
        setVersusIntermissionReady(false);
        setPaused(false);
        announceWave(wave);
        return;
      }
      if (!isOnlineVersus || !versusIntermissionReady) return;
      if (versusAttackBusyRef.current) {
        setVersusCountdown(1);
        return;
      }
      const matchId = versusMatchRef.current;
      if (!matchId || versusTransitionBusyRef.current) return;
      versusTransitionBusyRef.current = true;
      versusHydrationIntentRef.current += 1;
      const resumeMatch = async () => {
        await versusCoinAwardQueueRef.current.catch(() => undefined);
        if (versusMatchRef.current !== matchId) return;
        await enqueueVersusStateSync(async () => {
          if (versusMatchRef.current !== matchId) return;
          const { data, error } = await supabase.rpc("update_1v1_state", {
            p_match_id: matchId,
            p_hearts: normalizeVersusHearts(state.current.hearts),
            p_wave: wave,
            p_score: scoreRef.current,
            p_status: "playing",
          });
          if (versusMatchRef.current !== matchId) return;
          if (error) {
            setVersusResult("MATCH SYNC INTERRUPTED · RETRYING");
            setVersusCountdown(1);
            setVersusIntermissionReady(true);
            return;
          }
          applyAuthoritativeVersusPoints(data?.self?.obstacle_points);
          const serverStatus = String(data?.match?.status ?? "playing");
          if (serverStatus !== "playing") {
            const remaining = secondsUntil(data?.match?.intermission_ends_at, 1);
            setVersusCountdown(Math.max(1, remaining));
            setVersusIntermissionReady(serverStatus === "intermission");
            setVersusResult(
              serverStatus === "intermission"
                ? "INTERMISSION"
                : "WAITING FOR RIVAL",
            );
            setPaused(true);
            return;
          }
          const pending = new Map(
            incomingAttacksRef.current.map((attack) => [attack.id, attack]),
          );
          const serverPending = (data?.pending_attacks ?? []) as Array<{
            id?: string;
            obstacle_type?: string;
          }>;
          serverPending.forEach((attack) => {
            const kind = normalizeVersusObstacle(attack.obstacle_type);
            if (attack.id && spawnedAttackIdsRef.current.has(attack.id)) return;
            if (attack.id && kind)
              pending.set(attack.id, { id: attack.id, kind });
          });
          const attacks = Array.from(pending.values());
          incomingAttacksRef.current = [];
          if (attacks.length > 0) {
            attacks.forEach((attack) => {
              spawnedAttackIdsRef.current.add(attack.id);
            });
            setItems((current) =>
              appendSafeAttackWave(
                current,
                attacks.map((attack) => attack.kind),
                () => id.current++,
                9,
              ),
            );
          }
          setVersusResult("");
          setVersusPhase("playing");
          setVersusIntermissionReady(false);
          setPaused(false);
          announceWave(wave);
        });
      };
      void resumeMatch().finally(() => {
        if (versusMatchRef.current === matchId)
          versusTransitionBusyRef.current = false;
      });
      return;
    }
    if (isOnlineVersus && !versusIntermissionReady) return;
    const timer = setTimeout(() => setVersusCountdown((v) => v - 1), 1000);
    return () => clearTimeout(timer);
  }, [
    versusPhase,
    versusCountdown,
    announceWave,
    wave,
    isBotPractice,
    isOnlineVersus,
    versusIntermissionReady,
    enqueueVersusStateSync,
    applyAuthoritativeVersusPoints,
  ]);
  useEffect(() => {
    if (
      playScope !== "versus" ||
      versusPhase !== "intermission" ||
      versusIntermissionReady
    )
      return;
    const matchId = versusMatchRef.current;
    if (!matchId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const pollBarrier = async () => {
      await hydrateVersusStateRef.current?.(matchId, true);
      if (stopped || versusMatchRef.current !== matchId) return;
      timer = setTimeout(() => void pollBarrier(), 2000);
    };
    timer = setTimeout(() => void pollBarrier(), 2000);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [playScope, versusPhase, versusIntermissionReady]);
  useEffect(() => {
    if (
      playScope !== "versus" ||
      !versusMatchRef.current ||
      !versusRunHydratedRef.current ||
      (versusPhase !== "playing" &&
        versusPhase !== "intermission" &&
        versusPhase !== "finished")
    )
      return;
    const matchId = versusMatchRef.current;
    const locallyEliminated = hearts <= 0;
    if (versusPhase === "finished" && !locallyEliminated) return;
    const nextStatus = locallyEliminated
      ? "eliminated"
      : versusPhase === "intermission"
        ? "intermission"
        : "playing";
    const syncIntent = ++versusStateSyncIntentRef.current;
    const syncState = async () => {
      if (nextStatus === "intermission")
        await versusCoinAwardQueueRef.current.catch(() => undefined);
      if (
        versusMatchRef.current !== matchId ||
        versusStateSyncIntentRef.current !== syncIntent
      )
        return;
      await enqueueVersusStateSync(async () => {
        if (
          versusMatchRef.current !== matchId ||
          versusStateSyncIntentRef.current !== syncIntent
        )
          return;
        let data: VersusStatePayload | null = null;
        let syncError = "";
        try {
          const response = await supabase.rpc("update_1v1_state", {
            p_match_id: matchId,
            p_hearts: normalizeVersusHearts(hearts),
            p_wave: wave,
            p_score: scoreRef.current,
            p_status: nextStatus,
          });
          data = response.data as VersusStatePayload | null;
          syncError = response.error?.message ?? "";
        } catch {
          syncError = "connection interrupted";
        }
        if (
          versusMatchRef.current !== matchId ||
          versusStateSyncIntentRef.current !== syncIntent
        )
          return;
        if (syncError) {
          setVersusResult("MATCH SYNC INTERRUPTED · RETRYING");
          if (!versusSyncRetryTimerRef.current)
            versusSyncRetryTimerRef.current = setTimeout(() => {
              versusSyncRetryTimerRef.current = null;
              if (versusMatchRef.current === matchId)
                setVersusSyncRetry((value) => value + 1);
            }, 1000);
          return;
        }
        if (versusSyncRetryTimerRef.current) {
          clearTimeout(versusSyncRetryTimerRef.current);
          versusSyncRetryTimerRef.current = null;
        }
        applyAuthoritativeVersusPoints(data?.self?.obstacle_points);
        const serverStatus = String(data?.match?.status ?? "");
        if (serverStatus === "finished") {
          versusFinishedRef.current = true;
          setVersusResult(
            data?.match?.winner_user_id === userIdRef.current
              ? "VICTORY"
              : "DEFEAT",
          );
          setVersusPhase("finished");
          setVersusIntermissionReady(false);
          setRunning(false);
          setOver(true);
          return;
        }
        if (serverStatus === "intermission") {
          const remaining = secondsUntil(
            data?.match?.intermission_ends_at,
            VERSUS_INTERMISSION_SECONDS,
          );
          setVersusCountdown(remaining);
          setVersusPhase("intermission");
          setVersusIntermissionReady(true);
          setPaused(true);
          setVersusResult("INTERMISSION");
          return;
        }
        if (nextStatus === "intermission") {
          setVersusCountdown(VERSUS_INTERMISSION_SECONDS);
          setVersusIntermissionReady(false);
          setVersusResult("WAITING FOR RIVAL");
          setPaused(true);
        }
      });
    };
    void syncState();
  }, [
    hearts,
    wave,
    over,
    playScope,
    versusPhase,
    versusSyncRetry,
    enqueueVersusStateSync,
    applyAuthoritativeVersusPoints,
  ]);
  useEffect(() => {
    if (
      playScope !== "versus" ||
      versusPhase !== "playing" ||
      !running ||
      over
    )
      return;
    const syncScore = () => {
      const matchId = versusMatchRef.current;
      if (!matchId || versusScoreSyncPendingRef.current) return;
      versusScoreSyncPendingRef.current = true;
      void enqueueVersusStateSync(async () => {
        try {
          if (versusMatchRef.current !== matchId) return;
          const { error } = await supabase.rpc("sync_1v1_score", {
            p_match_id: matchId,
            p_score: scoreRef.current,
          });
          if (error && versusMatchRef.current === matchId)
            await hydrateVersusStateRef.current?.(matchId, true);
        } finally {
          versusScoreSyncPendingRef.current = false;
        }
      });
    };
    syncScore();
    const timer = window.setInterval(syncScore, 1000);
    return () => window.clearInterval(timer);
  }, [over, playScope, running, versusPhase, enqueueVersusStateSync]);
  useEffect(() => {
    const applySession = async (
      session: Awaited<
        ReturnType<typeof supabase.auth.getSession>
      >["data"]["session"],
    ) => {
      const user = session?.user ?? null;
      userIdRef.current = user?.id ?? null;
      if (user) {
        setPlayerAccess(null);
        setPlayerAccessError("");
        setPlayerAccessChecking(true);
      }
      setUserEmail(user?.email ?? null);
      if (user) {
        await refreshPlayerAccess();
        const [
          { data: stats, error: statsError },
          { data: profile },
          { data: admin },
          { data: role },
          { data: owned },
          { data: loadout },
        ] = await Promise.all([
          supabase
            .from("player_stats")
            .select("total_gems,high_score")
            .eq("user_id", user.id)
            .maybeSingle(),
          supabase
            .from("player_profiles")
            .select("username,username_changed_at")
            .eq("user_id", user.id)
            .maybeSingle(),
          supabase.rpc("is_admin"),
          supabase.rpc("get_admin_role"),
          supabase
            .from("player_unlocks")
            .select("item_key,item_type,rarity")
            .eq("user_id", user.id),
          supabase
            .from("player_loadouts")
            .select(
              "class_key,character_key,player_cosmetic,obstacle_cosmetic,environment_cosmetic",
            )
            .eq("user_id", user.id)
            .maybeSingle(),
        ]);
        if (statsError)
          console.error("Could not load account stats:", statsError.message);
        if (stats) {
          gemsRef.current = stats.total_gems;
          highScoreRef.current = stats.high_score;
          setGems(stats.total_gems);
          setHighScore(stats.high_score);
        } else {
          gemsRef.current = 0;
          highScoreRef.current = 0;
          setGems(0);
          setHighScore(0);
          console.error("Account stats were not provisioned for this player.");
        }
        if (profile) {
          setUsername(profile.username);
          setUsernameInput(profile.username);
          setUsernameRequired(false);
        } else setUsernameRequired(true);
        setIsAdmin(Boolean(admin));
        setAdminRole(role);
        const ownedItems = (owned ?? []) as Unlock[];
        const safeLoadout = normalizeOwnedLoadout(ownedItems, loadout);
        setUnlocks(ownedItems);
        setPlayerClass(safeLoadout.classKey);
        setSelectedCharacter(safeLoadout.characterKey);
        setPlayerCosmetic(safeLoadout.playerCosmetic);
        setObstacleCosmetic(safeLoadout.obstacleCosmetic);
        setEnvironmentCosmetic(safeLoadout.environmentCosmetic);
      } else {
        setPlayerAccess(null);
        setPlayerAccessError("");
        setPlayerAccessChecking(false);
        setUsername("");
        setUsernameRequired(false);
        setIsAdmin(false);
        setAdminRole(null);
        setUnlocks([]);
        setPlayerClass("runner");
        setSelectedCharacter("runner_ace");
        setInventoryCharacter({
          classKey: "runner",
          characterKey: "runner_ace",
        });
        setPlayerCosmetic("");
        setObstacleCosmetic("");
        setEnvironmentCosmetic("");
      }
      setAuthReady(true);
    };
    supabase.auth
      .getSession()
      .then(({ data }) => void applySession(data.session));
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        setSettingsOpen(true);
        setPasswordStatus("Verified. Enter your new password below.");
      }
      void applySession(session);
    });
    return () => data.subscription.unsubscribe();
  }, [refreshPlayerAccess]);
  useEffect(() => {
    if (!userEmail && !guest) return;
    const verify = () => {
      if (userEmail) void refreshPlayerAccess();
      else void refreshGuestDeviceAccess();
    };
    const interval = window.setInterval(verify, 30_000);
    window.addEventListener("focus", verify);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", verify);
    };
  }, [guest, refreshGuestDeviceAccess, refreshPlayerAccess, userEmail]);
  const submitAuth = async (e: FormEvent) => {
    e.preventDefault();
    setAuthBusy(true);
    setAuthMessage("");
    if (authMode === "signup") {
      if (password !== confirmPassword) {
        setAuthMessage("Passwords do not match.");
        setAuthBusy(false);
        return;
      }
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.origin },
      });
      setAuthMessage(
        error
          ? error.message
          : "Check your email to confirm your account, then return here to sign in.",
      );
    } else {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) setAuthMessage(error.message);
    }
    setAuthBusy(false);
  };
  const sendPasswordReset = async (
    targetEmail: string,
    setStatus: (message: string) => void,
  ) => {
    if (!targetEmail) {
      setStatus("Enter your email address first.");
      return;
    }
    setStatus("Sending recovery email…");
    const { error } = await supabase.auth.resetPasswordForEmail(targetEmail, {
      redirectTo: window.location.origin,
    });
    setStatus(
      error
        ? error.message
        : "Recovery email sent. Open its link to verify your account and choose a new password.",
    );
  };
  const signOut = async () => {
    const shouldLeaveVersus = Boolean(
      userIdRef.current &&
        (versusSearchingRef.current || versusMatchRef.current),
    );
    invalidateVersusSearch();
    resetVersusClientSync();
    closeVersusChannel();
    versusMatchRef.current = null;
    incomingAttacksRef.current = [];
    spawnedAttackIdsRef.current.clear();
    versusAttackBusyRef.current = false;
    setMainView("endless");
    setPlayScope("single");
    setVersusPhase("idle");
    setVersusPoints(0);
    versusPointsRef.current = 0;
    setVersusResult("");
    setVersusAttackBusy(false);
    setVersusIntermissionReady(false);
    setVersusLeaving(false);
    setVersusLeaders([]);
    setVersusLeadersError("");
    setRunning(false);
    setPaused(false);
    setPauseMenuOpen(false);
    setWavePause(false);
    setInvincible(false);
    clearFreezeEffect();
    setAbilityNotice("");
    invincibleUntilRef.current = 0;
    if (invincibilityTimerRef.current) {
      clearTimeout(invincibilityTimerRef.current);
      invincibilityTimerRef.current = null;
    }
    if (abilityNoticeTimerRef.current) {
      clearTimeout(abilityNoticeTimerRef.current);
      abilityNoticeTimerRef.current = null;
    }
    if (waveAnnouncementTimerRef.current) {
      clearTimeout(waveAnnouncementTimerRef.current);
      waveAnnouncementTimerRef.current = null;
    }
    resetCharacterAbilityState();
    botAttackPointsRef.current = 0;
    playerAttacksAgainstBotRef.current = [];
    turnLockedRef.current = false;
    if (delayedMoveTimerRef.current) {
      clearTimeout(delayedMoveTimerRef.current);
      delayedMoveTimerRef.current = null;
    }
    damageLockedRef.current = false;
    setItems([]);
    setOver(false);
    setScore(0);
    setWaveProgress(0);
    setSettingsOpen(false);
    setReportOpen(false);
    setAdminOpen(false);
    setShopOpen(false);
    setInventoryOpen(false);
    setLeaderboardOpen(false);
    setGuest(false);
    setPlayerAccess(null);
    setPlayerAccessError("");
    setPlayerAccessChecking(false);
    setUnlocks([]);
    setPlayerClass("runner");
    setSelectedCharacter("runner_ace");
    setInventoryCharacter({
      classKey: "runner",
      characterKey: "runner_ace",
    });
    userIdRef.current = null;
    audioEngine.stop();
    if (shouldLeaveVersus) await supabase.rpc("leave_1v1");
    if (userEmail) {
      setUserEmail(null);
      await supabase.auth.signOut();
    }
  };
  const playGuest = async () => {
    setAuthMessage("Checking this browser profile…");
    const allowed = await refreshGuestDeviceAccess();
    if (allowed !== true) {
      if (allowed === null)
        setAuthMessage("Could not verify this browser profile. Try again.");
      return;
    }
    setAuthMessage("");
    void audioEngine.start(soundtrack);
    void audioEngine.playSfx("click");
    setGuest(true);
    setUnlocks([]);
    setPlayerClass("runner");
    setSelectedCharacter("runner_ace");
    setInventoryCharacter({
      classKey: "runner",
      characterKey: "runner_ace",
    });
    setPlayerCosmetic("");
    setObstacleCosmetic("");
    setEnvironmentCosmetic("");
    setGems(0);
    setHighScore(0);
    gemsRef.current = 0;
    highScoreRef.current = 0;
  };
  const submitReport = async (e: FormEvent) => {
    e.preventDefault();
    if (!userIdRef.current) return;
    setReportBusy(true);
    setReportStatus("");
    const { error } = await supabase.from("player_reports").insert({
      user_id: userIdRef.current,
      report_type: reportType,
      message: reportMessage.trim(),
    });
    if (error) setReportStatus(error.message);
    else {
      setReportStatus(
        "Report sent. Thank you for helping improve Skyway Sprint!",
      );
      setReportMessage("");
    }
    setReportBusy(false);
  };
  const openReportForm = () => {
    reportPreviousPausedRef.current = state.current.paused;
    setReportStatus("");
    setPauseMenuOpen(false);
    setPaused(true);
    setReportOpen(true);
  };
  const closeReportForm = () => {
    setReportOpen(false);
    setPaused(reportPreviousPausedRef.current);
  };
  const saveUsername = async (e: FormEvent) => {
    e.preventDefault();
    setUsernameStatus("");
    const { data, error } = await supabase.rpc("set_player_username", {
      new_username: usernameInput,
    });
    if (error) setUsernameStatus(error.message);
    else {
      setUsername(data.username);
      setUsernameInput(data.username);
      setUsernameRequired(false);
      setEditUsername(false);
      setUsernameStatus("Username saved. You can change it again in 30 days.");
    }
  };
  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    setPasswordStatus("");
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) setPasswordStatus(error.message);
    else {
      setNewPassword("");
      setEditPassword(false);
      setPasswordStatus("Password updated successfully.");
    }
  };
  const loadReports = async () => {
    const { data } = await supabase
      .from("player_reports")
      .select("*")
      .neq("status", "resolved")
      .order("created_at", { ascending: false });
    setReports((data ?? []) as PlayerReport[]);
    setAdminTab("reports");
    setPauseMenuOpen(false);
    setPaused(true);
    setAdminOpen(true);
  };
  const loadAdmins = async () => {
    const { data, error } = await supabase.rpc("list_admins");
    if (error) setAdminStatus(error.message);
    else setAdmins((data ?? []) as AdminUser[]);
    setAdminTab("admins");
  };
  const manageAdmin = async (
    target: string,
    action: "add" | "promote" | "demote" | "remove",
  ) => {
    setAdminStatus("");
    const { error } = await supabase.rpc("manage_admin", {
      target,
      admin_action: action,
    });
    if (error) {
      setAdminStatus(error.message);
      return;
    }
    setAdminTarget("");
    setAdminStatus(
      action === "remove"
        ? "Co-admin removed."
        : action === "promote"
          ? "Admin promoted to main admin."
          : action === "demote"
            ? "Admin changed to co-admin."
            : "Co-admin added.",
    );
    await loadAdmins();
  };
  const resolveReport = async (id: number) => {
    const { error } = await supabase.rpc("resolve_player_report", {
      report_id: id,
    });
    if (error) {
      setCopyStatus(error.message);
      return;
    }
    setReports((v) => v.filter((r) => r.id !== id));
  };
  const copyOpenReports = async () => {
    const open = reports.filter((r) => r.status !== "resolved");
    if (open.length === 0) {
      setCopyStatus("No open reports to copy.");
      return;
    }
    const text = open
      .map(
        (r, index) =>
          `REPORT ${index + 1}\nType: ${r.report_type}\nDate: ${new Date(r.created_at).toLocaleString()}\nPlayer: ${r.user_id}\nStatus: ${r.status}\n\n${r.message}`,
      )
      .join("\n\n--------------------\n\n");
    await navigator.clipboard.writeText(text);
    setCopyStatus(
      `${open.length} open report${open.length === 1 ? "" : "s"} copied.`,
    );
    setTimeout(() => setCopyStatus(""), 2200);
  };
  const loadCollection = async () => {
    if (guest) return;
    const [{ data: owned }, { data: loadout }] = await Promise.all([
      supabase.from("player_unlocks").select("item_key,item_type,rarity"),
      supabase
        .from("player_loadouts")
        .select(
          "class_key,character_key,player_cosmetic,obstacle_cosmetic,environment_cosmetic",
        )
        .maybeSingle(),
    ]);
    const ownedItems = (owned ?? []) as Unlock[];
    const safeLoadout = normalizeOwnedLoadout(ownedItems, loadout);
    setUnlocks(ownedItems);
    setPlayerClass(safeLoadout.classKey);
    setSelectedCharacter(safeLoadout.characterKey);
    setPlayerCosmetic(safeLoadout.playerCosmetic);
    setObstacleCosmetic(safeLoadout.obstacleCosmetic);
    setEnvironmentCosmetic(safeLoadout.environmentCosmetic);
  };
  const extract = async (option: ExtractionOption) => {
    if (extractBusyRef.current) return;
    if (guest) {
      setShopStatus("Sign in to extract permanent items.");
      return;
    }
    const box = EXTRACTION_BOXES[option];
    const maxQuantity = Math.min(
      EXTRACTION_MAX_QUANTITY,
      Math.floor(gemsRef.current / box.cost),
    );
    const quantity = Math.floor(extractQuantities[option]);
    if (!Number.isFinite(quantity) || quantity < 1 || quantity > maxQuantity) {
      setShopStatus(
        maxQuantity < 1
          ? `You need ♦ ${box.cost} to open this box.`
          : `Choose a QTY from 1 to ${maxQuantity}.`,
      );
      return;
    }
    const startedAt = Date.now();
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    extractBusyRef.current = true;
    setExtractBusy(true);
    setExtractingOption(option);
    setExtractAnimation("shaking");
    setExtractResults([]);
    const totalBoxes = quantity * box.pullCount;
    setShopStatus(
      `Opening ${totalBoxes} normal box${totalBoxes === 1 ? "" : "es"}…`,
    );
    try {
      const { data, error } = await supabase.rpc("extract_items", {
        pull_count: quantity,
        box_type: option,
      });
      if (error) {
        setShopStatus(error.message);
        return;
      }
      const shakeTimeRemaining = reduceMotion
        ? 0
        : Math.max(0, 700 - (Date.now() - startedAt));
      if (shakeTimeRemaining > 0) {
        await new Promise<void>((resolve) =>
          window.setTimeout(resolve, shakeTimeRemaining),
        );
      }
      setExtractAnimation("opening");
      if (!reduceMotion) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 550));
      }
      const results = (data?.results ?? []) as ExtractionResult[];
      setExtractAnimation("idle");
      setExtractingOption(null);
      setExtractResults(results);
      const nextGems = Number(data?.gems ?? gemsRef.current);
      gemsRef.current = nextGems;
      setGems(nextGems);
      setExtractQuantities((current) => ({
        regular: Math.max(
          1,
          Math.min(
            current.regular,
            Math.max(
              1,
              Math.min(
                EXTRACTION_MAX_QUANTITY,
                Math.floor(nextGems / EXTRACTION_BOXES.regular.cost),
              ),
            ),
          ),
        ),
        ten: Math.max(
          1,
          Math.min(
            current.ten,
            Math.max(
              1,
              Math.min(
                EXTRACTION_MAX_QUANTITY,
                Math.floor(nextGems / EXTRACTION_BOXES.ten.cost),
              ),
            ),
          ),
        ),
      }));
      const newCount = results.filter((item) => item.is_new).length;
      const duplicateCount = results.length - newCount;
      setShopStatus(
        `${results.length} ITEM${results.length === 1 ? "" : "S"} REVEALED — ${newCount} NEW · ${duplicateCount} DUPLICATE${duplicateCount === 1 ? "" : "S"}`,
      );
      await loadCollection();
    } catch {
      setShopStatus(
        "The box request could not be confirmed. Check your balance before trying again.",
      );
    } finally {
      extractBusyRef.current = false;
      setExtractBusy(false);
      setExtractingOption(null);
      setExtractAnimation("idle");
    }
  };
  const equipInventoryCharacter = async (
    classKey: keyof typeof CLASS_CHARACTERS,
    characterKey: string,
  ) => {
    if (running) {
      setInventoryStatus("Character changes are only available before a run.");
      return;
    }
    if (
      mode === "impossible" &&
      (classKey !== "runner" || characterKey !== "runner_ace")
    ) {
      setInventoryStatus("Impossible mode always uses the default Runner Ace.");
      return;
    }
    if (
      mode === "hardcore" &&
      (classKey === "medic" || classKey === "tank")
    ) {
      setInventoryStatus("Healer and Tank cannot be used in Hardcore mode.");
      return;
    }
    const owned = isCharacterOwned(unlocks, characterKey);
    if (!owned) {
      setInventoryStatus("That character is locked. Extract it in the Shop first.");
      return;
    }
    if (guest) {
      setPlayerClass(classKey);
      setSelectedCharacter(characterKey);
      setInventoryStatus("Starter equipped for this guest session.");
      return;
    }
    setInventoryStatus("Equipping character…");
    const { error: classError } = await supabase.rpc("set_loadout", {
      p_slot: "class",
      p_item: classKey,
    });
    if (classError) {
      setInventoryStatus(classError.message);
      return;
    }
    const { error: characterError } = await supabase.rpc("set_loadout", {
      p_slot: "character",
      p_item: characterKey,
    });
    if (characterError) {
      setInventoryStatus(characterError.message);
      return;
    }
    setPlayerClass(classKey);
    setSelectedCharacter(characterKey);
    setInventoryStatus(
      `${characterKey.replaceAll("_", " ").toUpperCase()} equipped.`,
    );
  };
  const equipCosmetic = async (item: Unlock) => {
    if (guest) {
      setInventoryStatus("Sign in to equip permanent cosmetics.");
      return;
    }
    const { error } = await supabase.rpc("set_loadout", {
      p_slot: item.item_type,
      p_item: item.item_key,
    });
    if (!error) {
      if (item.item_type === "player") setPlayerCosmetic(item.item_key);
      if (item.item_type === "obstacle") setObstacleCosmetic(item.item_key);
      if (item.item_type === "environment")
        setEnvironmentCosmetic(item.item_key);
    }
    setInventoryStatus(
      error
        ? error.message
        : `${item.item_key.replaceAll("_", " ").toUpperCase()} equipped.`,
    );
  };
  const loadLeaderboard = async () => {
    const { data } = await supabase.rpc("get_leaderboard");
    setLeaders((data ?? []) as Leader[]);
    setLeaderboardOpen(true);
  };
  const loadVersusLeaderboard = async () => {
    if (guest) {
      setVersusLeaders([]);
      setVersusLeadersError("");
      setVersusLeadersLoading(false);
      return;
    }
    setVersusLeadersLoading(true);
    setVersusLeadersError("");
    const { data, error } = await supabase.rpc("get_1v1_leaderboard", {
      p_limit: 50,
      p_offset: 0,
    });
    if (error) {
      setVersusLeaders([]);
      setVersusLeadersError(
        error.message.includes("get_1v1_leaderboard") &&
          error.message.toLowerCase().includes("schema cache")
          ? "1V1 LEADERBOARD DATABASE SETUP IS MISSING · RUN MULTI-DEVICE 03"
          : error.message,
      );
    } else setVersusLeaders((data ?? []) as VersusLeader[]);
    setVersusLeadersLoading(false);
  };
  const ownedPlayerCosmetics = unlocks.filter(
    (item) => item.item_type === "player",
  );
  const ownedObstacleCosmetics = unlocks.filter(
    (item) => item.item_type === "obstacle",
  );
  const ownedEnvironments = unlocks.filter(
    (item) => item.item_type === "environment",
  );
  const focusedCharacter = CLASS_CHARACTERS[
    inventoryCharacter.classKey
  ].find((character) => character.key === inventoryCharacter.characterKey);
  const focusedCharacterOwned = Boolean(
    focusedCharacter && isCharacterOwned(unlocks, focusedCharacter.key),
  );
  const focusedCharacterAbility = focusedCharacter
    ? CHARACTER_ABILITIES[focusedCharacter.key as CharacterKey]
    : null;
  const focusedWeaponScoreLabel = focusedCharacter
    ? getWeaponScoreLabel(focusedCharacter.rarity)
    : "";
  const newExtractResults = extractResults
    .filter((item) => item.is_new)
    .sort(
      (left, right) =>
        RARITY_ORDER[left.rarity] - RARITY_ORDER[right.rarity] ||
        (left.pull_number ?? 0) - (right.pull_number ?? 0),
    );
  useEffect(() => {
    if (
      !shopOpen ||
      (extractAnimation === "idle" && extractResults.length === 0)
    )
      return;
    const frame = window.requestAnimationFrame(() => {
      const reduceMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      extractFeedbackRef.current?.scrollIntoView({
        behavior: reduceMotion ? "auto" : "smooth",
        block: "nearest",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [extractAnimation, extractResults.length, shopOpen]);
  if (!authReady)
    return (
      <main className="auth-shell">
        <div className="auth-card loading">Loading Skyway Sprint…</div>
      </main>
    );
  if (userEmail && playerAccessChecking)
    return (
      <main className="auth-shell">
        <div className="auth-card loading">Verifying account and device…</div>
      </main>
    );
  if ((userEmail || guest) && playerAccessError)
    return (
      <main className="auth-shell">
        <section className="auth-card ban-card access-error-card">
          <div className="auth-logo">?</div>
          <p>ACCESS CHECK</p>
          <h1>COULD NOT VERIFY</h1>
          <span>
            Skyway Sprint could not verify this account or device. No run will
            start until the check succeeds.
          </span>
          <div className="access-error-actions">
            <button
              onClick={() =>
                void (userEmail
                  ? refreshPlayerAccess(true)
                  : refreshGuestDeviceAccess())
              }
            >
              TRY AGAIN
            </button>
            <button onClick={() => void signOut()}>SIGN OUT</button>
          </div>
        </section>
      </main>
    );
  if (userEmail && !playerAccess)
    return (
      <main className="auth-shell">
        <div className="auth-card loading">Verifying account and device…</div>
      </main>
    );
  if (
    playerAccess &&
    (playerAccess.account_banned || playerAccess.device_banned)
  ) {
    const blockingBans = (playerAccess.active_bans ?? []).filter(
      (ban) => ban.scope === "account" || ban.scope === "device",
    );
    return (
      <main className="auth-shell">
        <section className="auth-card ban-card">
          <div className="auth-logo">!</div>
          <p>ACCESS RESTRICTED</p>
          <h1>PLAYER BANNED</h1>
          <span>
            {playerAccess.account_banned
              ? "This account is banned from Skyway Sprint."
              : "This browser device is banned from Skyway Sprint."}
          </span>
          {blockingBans.map((ban) => (
            <article key={ban.id}>
              <b>{ban.scope.toUpperCase()} BAN</b>
              <small>
                {ban.expires_at
                  ? `ENDS ${new Date(ban.expires_at).toLocaleString()}`
                  : "PERMANENT"}
              </small>
              {ban.reason && <p>{ban.reason}</p>}
            </article>
          ))}
          <button
            onClick={() => {
              if (userEmail) void signOut();
              else {
                setPlayerAccess(null);
                setPlayerAccessError("");
                setAuthMessage("");
              }
            }}
          >
            {userEmail ? "SIGN OUT" : "BACK TO SIGN IN"}
          </button>
        </section>
      </main>
    );
  }
  if (!userEmail && !guest)
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <div className="auth-logo">S</div>
          <p>FIVE LANES. NO BRAKES.</p>
          <h1>{authMode === "signin" ? "WELCOME BACK" : "JOIN THE RUN"}</h1>
          <form onSubmit={submitAuth} autoComplete="on">
            <label>
              Email
              <input
                id="login-email"
                name="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="runner@example.com"
                required
                autoComplete="email"
              />
            </label>
            <label>
              Password
              <input
                id="login-password"
                name="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                minLength={6}
                required
                autoComplete={
                  authMode === "signin" ? "current-password" : "new-password"
                }
              />
            </label>
            {authMode === "signup" && (
              <label>
                Confirm Password
                <input
                  id="confirm-password"
                  name="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Enter the same password again"
                  minLength={6}
                  required
                  autoComplete="new-password"
                />
              </label>
            )}
            {authMessage && (
              <div className="auth-message" role="status">
                {authMessage}
              </div>
            )}
            <button disabled={authBusy}>
              {authBusy
                ? "PLEASE WAIT…"
                : authMode === "signin"
                  ? "SIGN IN →"
                  : "CREATE ACCOUNT →"}
            </button>
          </form>
          {authMode === "signin" && (
            <button
              className="forgot-button"
              onClick={() => sendPasswordReset(email, setAuthMessage)}
            >
              FORGOT PASSWORD?
            </button>
          )}
          <button
            className="auth-switch"
            onClick={() => {
              setAuthMode((v) => (v === "signin" ? "signup" : "signin"));
              setAuthMessage("");
            }}
          >
            {authMode === "signin"
              ? "New runner? Create an account"
              : "Already registered? Sign in"}
          </button>
          <div className="guest-divider">
            <span>OR</span>
          </div>
          <button className="guest-button" onClick={playGuest}>
            PLAY AS GUEST
          </button>
          <small className="guest-note">
            Guest gems disappear after every run.
          </small>
        </section>
      </main>
    );
  return (
    <main className={`game-shell mode-${mode} ${flash}`}>
      <div
        className={`game-layout view-${mainView}${!guest ? " has-top-report" : ""}`}
      >
        {!guest && (
          <div className="report-utility-bar">
            <button
              className="top-report-button"
              type="button"
              aria-label={
                isVersusRun
                  ? "Report an issue after the current 1v1 ends"
                  : "Report an issue"
              }
              aria-controls="player-report-dialog"
              disabled={isVersusRun}
              onClick={openReportForm}
            >
              <span aria-hidden="true">!</span>
              <span>
                <b>REPORT</b>
                <small>
                  {isVersusRun ? "AFTER THIS 1V1" : "SEND AN ISSUE"}
                </small>
              </span>
            </button>
          </div>
        )}
        <section className="mode-actions" aria-label="Game modes">
          <button
            id="mode-endless-button"
            className={`mode-endless${mainView === "endless" ? " active" : ""}`}
            aria-pressed={mainView === "endless"}
            aria-controls="main-game-panel"
            aria-label={
              isBotPractice
                ? "Switch to Endless and end bot practice"
                : isOnlineVersus
                ? "Switch to Endless and leave the current 1v1 match"
                : "Switch to Endless"
            }
            disabled={versusLeaving}
            onClick={() => void switchMainView("endless")}
          >
            <span>∞</span>
            <span>
              <b>ENDLESS</b>
              <small>
                {isBotPractice
                  ? "END PRACTICE"
                  : isOnlineVersus
                    ? "LEAVE MATCH · FORFEIT"
                  : "SOLO · CHASE YOUR BEST"}
              </small>
            </span>
          </button>
          <button
            id="mode-versus-button"
            className={`mode-versus${mainView === "versus" ? " active" : ""}`}
            aria-pressed={mainView === "versus"}
            aria-controls="main-game-panel"
            disabled={versusLeaving}
            onClick={() => void switchMainView("versus")}
          >
            <span>⚔</span>
            <span>
              <b>1V1</b>
              <small>REALTIME · OUTLAST A RIVAL</small>
            </span>
          </button>
        </section>
        {mainView === "endless" && (
          <nav className="game-actions" aria-label="Player menus">
          <button
            className="action-leaderboard"
            disabled={isVersusRun}
            onClick={() => {
              void loadLeaderboard();
              setPauseMenuOpen(false);
              setPaused(true);
            }}
          >
            <span className="trophy-icon">🏆</span>
            <b>LEADERBOARD</b>
          </button>
          <button
            className="action-shop"
            disabled={isVersusRun}
            onClick={() => {
              setShopOpen(true);
              setPauseMenuOpen(false);
              setPaused(true);
              setShopStatus("");
              setExtractResults([]);
              void loadCollection();
            }}
          >
            <span className="cart-icon">
              <i />
              <i />
              <i />
            </span>
            <b>SHOP</b>
          </button>
          <button
            className="action-inventory"
            disabled={isVersusRun}
            onClick={() => {
              setInventoryOpen(true);
              setPauseMenuOpen(false);
              setPaused(true);
              setInventoryStatus("");
              setInventoryCharacter({
                classKey: (activeClass in CLASS_CHARACTERS
                  ? activeClass
                  : "runner") as keyof typeof CLASS_CHARACTERS,
                characterKey: activeCharacter,
              });
              void loadCollection();
            }}
          >
            <span className="inventory-icon" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <b>INVENTORY</b>
          </button>
          {!guest && !isVersusRun && (
            <button
              className="action-settings"
              onClick={() => {
                setSettingsOpen(true);
                setPauseMenuOpen(false);
                setPaused(true);
              }}
            >
              <span>⚙</span>
              <b>SETTINGS</b>
            </button>
          )}
          {isAdmin && !guest && !isVersusRun && (
            <button className="action-admin" onClick={loadReports}>
              <span>★</span>
              <b>ADMIN</b>
            </button>
          )}
          </nav>
        )}
        <section
          id="main-game-panel"
          className={`game-card${mainView === "versus" && playScope === "single" ? " versus-hub-card" : ""}`}
          aria-label={
            mainView === "versus" && playScope === "single"
              ? "Skyway Sprint 1v1 hub"
              : "Skyway Sprint runner game"
          }
          aria-labelledby={
            mainView === "versus" && playScope === "single"
              ? "versus-hub-title"
              : undefined
          }
        >
          {mainView === "versus" && playScope === "single" ? (
            <div className="versus-hub">
              <header className="versus-hub-heading">
                <div>
                  <p>MULTI-DEVICE REALTIME</p>
                  <h2 id="versus-hub-title">SKYWAY 1V1</h2>
                </div>
                <strong>OUTLAST YOUR RIVAL</strong>
              </header>
              <div className="versus-hub-scroll">
                <section
                  className="versus-hub-panel versus-matchmaking"
                  aria-labelledby="versus-matchmaking-title"
                  aria-busy={versusPhase === "searching" || versusLeaving}
                >
                  <header>
                    <span>01</span>
                    <div>
                      <small>READY UP</small>
                      <h3 id="versus-matchmaking-title">MATCHMAKING</h3>
                    </div>
                  </header>
                  {versusPhase === "searching" ? (
                    <div className="versus-searching" role="status" aria-live="polite">
                      <div className="matchmaking-spinner" aria-hidden="true">
                        ⚔
                      </div>
                      <b>FINDING AN OPPONENT…</b>
                      <small>Keep this screen open while we pair your account.</small>
                      <button
                        className="versus-cancel"
                        disabled={versusLeaving}
                        onClick={() => void cancelVersus()}
                      >
                        {versusLeaving ? "LEAVING QUEUE…" : "CANCEL SEARCH"}
                      </button>
                    </div>
                  ) : (
                    <div className="versus-ready">
                      <div className="rival-card" aria-label="Match preview">
                        <span>
                          {guest ? "GUEST" : username || "YOU"}
                          <b>READY</b>
                        </span>
                        <strong>VS</strong>
                        <span>
                          RIVAL
                          <b>SEARCHING</b>
                        </span>
                      </div>
                      <button
                        className="versus-primary"
                        onClick={() => void findVersusMatch()}
                        disabled={guest || versusLeaving}
                        aria-describedby={guest ? "versus-signin-note" : undefined}
                      >
                        {versusLeaving ? "FINISHING PREVIOUS MATCH…" : "FIND OPPONENT"}
                      </button>
                      {guest && (
                        <small id="versus-signin-note" className="versus-signin-note">
                          Sign in to enter account-based 1v1 matchmaking.
                        </small>
                      )}
                      <div className="versus-practice-divider" aria-hidden="true">
                        <span>OR</span>
                      </div>
                      <button
                        className="versus-practice"
                        onClick={startBotPractice}
                        disabled={versusLeaving}
                      >
                        <b>PRACTICE VS BOT</b>
                        <small>LOCAL · UNRANKED · NO REWARDS · GUESTS OK</small>
                      </button>
                    </div>
                  )}
                  {versusResult && (
                    <div className="versus-message" role="status" aria-live="polite">
                      {versusResult}
                    </div>
                  )}
                </section>

                <section
                  className="versus-hub-panel versus-rules-panel"
                  aria-labelledby="versus-rules-title"
                >
                  <header>
                    <span>02</span>
                    <div>
                      <small>HOW IT WORKS</small>
                      <h3 id="versus-rules-title">1V1 RULES</h3>
                    </div>
                  </header>
                  <ol className="versus-rule-list">
                    <li>Both runners play separate live five-lane courses.</li>
                    <li>The runner who survives longest wins the match.</li>
                    <li>Each track coin pickup adds <b>2 attack coins</b>.</li>
                    <li>Each completed wave adds <b>3 attack coins</b>.</li>
                    <li>
                      Spend attack coins during the 10-second intermission to
                      send hazards into your rival&apos;s next wave.
                    </li>
                    <li>
                      Bot practice uses the same local rules but never changes
                      ranked wins, losses, or rating.
                    </li>
                  </ol>
                </section>

                <section
                  className="versus-hub-panel versus-armory-panel"
                  aria-labelledby="versus-armory-title"
                >
                  <header>
                    <span>03</span>
                    <div>
                      <small>INTERMISSION SHOP</small>
                      <h3 id="versus-armory-title">ATTACK COIN ARMORY</h3>
                    </div>
                  </header>
                  <p className="versus-armory-note">
                    These prices use match-only attack coins—not permanent gems.
                    Purchases unlock during each intermission.
                  </p>
                  <div className="versus-attack-catalog">
                    {VERSUS_ATTACKS.map((attack) => (
                      <article key={attack.kind}>
                        <span aria-hidden="true">{attack.icon}</span>
                        <div>
                          <b>{attack.label}</b>
                          <small>{attack.description}</small>
                        </div>
                        <strong>◉ {attack.cost} COINS</strong>
                      </article>
                    ))}
                  </div>
                </section>

                <section
                  className="versus-hub-panel versus-leaderboard-panel"
                  aria-labelledby="versus-leaderboard-title"
                >
                  <header>
                    <span>04</span>
                    <div>
                      <small>RANKED RECORDS</small>
                      <h3 id="versus-leaderboard-title">1V1 LEADERBOARD</h3>
                    </div>
                    <button
                      className="versus-refresh"
                      onClick={() => void loadVersusLeaderboard()}
                      disabled={versusLeadersLoading}
                    >
                      {versusLeadersLoading ? "LOADING…" : "REFRESH"}
                    </button>
                  </header>
                  {guest ? (
                    <div className="versus-hub-empty">
                      Sign in to view the ranked 1v1 leaderboard.
                    </div>
                  ) : versusLeadersError ? (
                    <div className="versus-hub-empty error" role="status">
                      {versusLeadersError}
                    </div>
                  ) : versusLeadersLoading && versusLeaders.length === 0 ? (
                    <div className="versus-hub-empty" role="status">
                      Loading ranked records…
                    </div>
                  ) : versusLeaders.length === 0 ? (
                    <div className="versus-hub-empty">No ranked matches yet.</div>
                  ) : (
                    <ol className="versus-leader-list">
                      {versusLeaders.map((entry) => {
                        const winRate = Number(entry.win_rate);
                        return (
                          <li
                            key={`${entry.rank}-${entry.username}`}
                            className={entry.is_self ? "me" : ""}
                          >
                            <b>#{Number(entry.rank)}</b>
                            <span>
                              <strong>{entry.username}</strong>
                              <small>
                                {entry.provisional
                                  ? "PROVISIONAL"
                                  : `${Number.isFinite(winRate) ? winRate.toFixed(1) : "0.0"}% WIN RATE`}
                              </small>
                            </span>
                            <span>
                              <strong>{Number(entry.rating)} RATING</strong>
                              <small>
                                {Number(entry.wins)}W–{Number(entry.losses)}L · BEST WAVE {Number(entry.best_wave)}
                              </small>
                            </span>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </section>
              </div>
            </div>
          ) : (
            <>
          <header className="topbar">
            <div className="brand">
              <span>S</span>
              <div>
                <b>SKYWAY</b>
                <small>SPRINT</small>
              </div>
            </div>
            <div className="stats">
              <div>
                <small>SCORE</small>
                <strong>{score.toString().padStart(6, "0")}</strong>
              </div>
              <div className="high-score-inline">
                <small>HIGH SCORE</small>
                <strong>{guest ? "—" : highScore.toLocaleString()}</strong>
              </div>
              <div className={`gem-total ${gemBump ? "bump" : ""}`}>
                <small>{guest ? "RUN GEMS" : "ALL-TIME GEMS"}</small>
                <strong className="gold">● {gems}</strong>
                {gemBump && <em>+1</em>}
              </div>
              <div>
                <small>WAVE</small>
                <strong>{wave}</strong>
              </div>
            </div>
            <div className="account">
              <span>{guest ? "GUEST RUNNER" : username || userEmail}</span>
            </div>
          </header>
          <div
            className={`playfield${environmentCosmetic ? ` environment-${environmentCosmetic}` : ""}`}
          >
            <div className="sky" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
            <div className="horizon" aria-hidden="true">
              {Array.from({ length: 8 }, (_, index) => (
                <span key={index} />
              ))}
            </div>
            {isVersusRun && (
              <div className="versus-hud">
                <div>
                  <small>YOU</small>
                  <b>{hearts} HP</b>
                </div>
                <strong>⚔</strong>
                <div>
                  <small>{versusOpponent}</small>
                  <b>{versusOpponentHearts} HP</b>
                </div>
                <em aria-label={`${versusPoints} attack coins`}>
                  ◉ {versusPoints}
                </em>
              </div>
            )}
            {isVersusRun &&
              versusResult &&
              !over &&
              versusPhase !== "intermission" && (
                <div
                  className="versus-live-message"
                  role="status"
                  aria-live="polite"
                >
                  {versusResult}
                </div>
              )}
            {waveMessage && (
              <div className="wave-announcement">
                <small>GET READY</small>
                <strong>{waveMessage}</strong>
              </div>
            )}
            <div
              className="active-ability-chip"
              title={`${activeAbility.description} ${activeCharacterDefinition.weapon} adds ${Math.round(activeWeaponScoreBonus * 100)}% distance score.`}
              aria-label={`Passive ability: ${activeAbility.name}. ${activeAbility.description} Weapon: ${activeCharacterDefinition.weapon}. ${getWeaponScoreLabel(activeCharacterDefinition.rarity)}.`}
            >
              <small>PASSIVE</small>
              <b>{activeAbility.name}</b>
              <span>{activeAbility.description}</span>
              <div className="active-weapon-readout">
                <small>WEAPON</small>
                <b>{activeCharacterDefinition.weapon}</b>
                <em>{getWeaponScoreLabel(activeCharacterDefinition.rarity)}</em>
              </div>
            </div>
            {abilityNotice && (
              <div className="ability-proc" role="status" aria-live="polite">
                {abilityNotice}
              </div>
            )}
            <div className="road">
              {[0, 1, 2, 3].map((n) => (
                <i className={`line l${n}`} key={n} />
              ))}
              <div className="wave-chip">
                WAVE {wave}
                <small>
                  SPEED ×{getWaveSpeedMultiplier(wave).toFixed(2)}
                </small>
              </div>
              {items.map((x) => (
                <div
                  key={x.id}
                  className={`item ${x.kind}${
                    obstacleCosmetic && x.kind !== "gem" && x.kind !== "coin"
                      ? ` obstacle-${obstacleCosmetic}`
                      : ""
                  }`}
                  style={{ left: `${(x.lane + 0.5) * 20}%`, top: `${x.y}%` }}
                  aria-label={x.kind}
                >
                  <Obstacle kind={x.kind} />
                </div>
              ))}
              <div
                className={`runner character-${activeCharacter}${playerCosmetic ? ` player-${playerCosmetic}` : ""}${slowed ? " frozen" : ""}${invincible ? " invincible" : ""}`}
                style={{ left: `${(lane + 0.5) * 20}%` }}
              >
                <div className="head" />
                <div className="body" />
                <i className="arm a1" />
                <i className="arm a2" />
                <i className="leg g1" />
                <i className="leg g2" />
                <em />
                <span className="character-weapon" aria-hidden="true" />
              </div>
            </div>
            {!running && (
              <div className="overlay">
                <p>{over ? "RUN OVER" : "FIVE LANES. NO BRAKES."}</p>
                <h1>
                  {over && isVersusRun && versusResult
                    ? versusResult
                    : over
                      ? `${score.toLocaleString()} POINTS`
                      : "DODGE. DASH. SURVIVE."}
                </h1>
                {!over && (
                  <div className="mode-select">
                    <button
                      className={mode === "normal" ? "selected" : ""}
                      onClick={() => setEndlessMode("normal")}
                    >
                      <b>NORMAL</b>
                      <small>
                        Selected class HP, healing, damage, and score rules
                        apply
                      </small>
                    </button>
                    <button
                      className={mode === "hardcore" ? "selected" : ""}
                      onClick={() => setEndlessMode("hardcore")}
                    >
                      <b>HARDCORE</b>
                      <small>
                        1 HP · no healing · no Healer/Tank · 1.75× score
                        before character bonuses
                      </small>
                    </button>
                    <button
                      className={mode === "impossible" ? "selected" : ""}
                      onClick={() => setEndlessMode("impossible")}
                    >
                      <b>IMPOSSIBLE</b>
                      <small>
                        1 HP · no healing · Ace forced · 3.30× total score
                      </small>
                    </button>
                  </div>
                )}
                <button
                  onClick={
                    isVersusRun
                      ? backToMenu
                      : () => reset()
                  }
                >
                  {isVersusRun
                    ? "RETURN TO 1V1 HUB"
                    : over
                      ? "RUN AGAIN"
                      : "START RUN"}{" "}
                  <span>→</span>
                </button>
                {over && (
                  <button className="back-menu" onClick={backToMenu}>
                    BACK TO MENU
                  </button>
                )}
                <small>← → / A D &nbsp; TO SWITCH LANES</small>
              </div>
            )}
            {versusPhase === "intermission" && (
              <div
                className="overlay versus-intermission"
                aria-busy={
                  !versusIntermissionReady || versusCountdown <= 0
                }
              >
                <p>NEXT WAVE IN</p>
                <h1>{versusCountdown}</h1>
                <strong>ATTACK COINS: ◉ {versusPoints}</strong>
                <span className="versus-shop-state" role="status" aria-live="polite">
                  {versusCountdown <= 0
                    ? "LOCKING NEXT WAVE…"
                    : versusIntermissionReady
                      ? "ARMORY OPEN"
                      : "SYNCING ATTACK COINS…"}
                </span>
                <div className="attack-grid">
                  {VERSUS_ATTACKS.map((attack) => (
                    <button
                      key={attack.kind}
                      disabled={
                        !versusIntermissionReady ||
                        versusCountdown <= 0 ||
                        versusAttackBusy ||
                        versusPoints < attack.cost
                      }
                      onClick={() => void sendVersusAttack(attack.kind)}
                      aria-label={`Send ${attack.label} for ${attack.cost} attack coins`}
                    >
                      <span aria-hidden="true">{attack.icon}</span>
                      {attack.label} <small>{attack.cost} COINS</small>
                    </button>
                  ))}
                </div>
                <small>
                  Each track coin adds 2 attack coins. Purchased obstacles attack {versusOpponent} next wave.
                </small>
                {versusResult && (
                  <div className="versus-message" role="status" aria-live="polite">
                    {versusResult}
                  </div>
                )}
              </div>
            )}
            {running && paused && pauseMenuOpen && !isOnlineVersus && (
              <div
                className="overlay compact pause-overlay"
                role="dialog"
                aria-modal="true"
                aria-label="Pause menu"
              >
                <section className="pause-menu">
                  <p>RUN PAUSED</p>
                  <h1>PAUSED</h1>
                  <div className="soundtrack-picker">
                    <h2>SOUNDTRACK</h2>
                    <div className="soundtrack-grid">
                      {SOUNDTRACKS.map((track) => (
                        <button
                          key={track.id}
                          className={soundtrack === track.id ? "selected" : ""}
                          onClick={() => chooseSoundtrack(track.id)}
                          aria-pressed={soundtrack === track.id}
                        >
                          <span aria-hidden="true">{track.icon}</span>
                          <b>{track.name}</b>
                          <small>{track.description}</small>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="audio-controls">
                    <label>
                      <span>
                        <b>MUSIC</b>
                        <output>
                          {musicVolume === 0
                            ? "MUTED"
                            : `${Math.round(musicVolume * 100)}%`}
                        </output>
                      </span>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={musicVolume}
                        onInput={(event) =>
                          changeMusicVolume(Number(event.currentTarget.value))
                        }
                        aria-label="Music volume"
                      />
                    </label>
                    <label>
                      <span>
                        <b>SFX</b>
                        <output>
                          {sfxVolume === 0
                            ? "MUTED"
                            : `${Math.round(sfxVolume * 100)}%`}
                        </output>
                      </span>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={sfxVolume}
                        onInput={(event) =>
                          changeSfxVolume(Number(event.currentTarget.value))
                        }
                        aria-label="SFX volume"
                      />
                    </label>
                  </div>
                  <div className="pause-actions">
                    <button onClick={resumeFromPause}>KEEP RUNNING</button>
                    <button className="pause-home" onClick={returnHomeFromPause}>
                      RETURN HOME
                    </button>
                  </div>
                </section>
              </div>
            )}
          </div>
          <footer>
            <button onClick={() => move(-1)} aria-label="Move left">
              ←
            </button>
            <p>
              <b>SWITCH LANES</b>
              <small>Use arrows, A / D, or tap</small>
            </p>
            <button onClick={() => move(1)} aria-label="Move right">
              →
            </button>
            <div
              className={`health ${mode !== "normal" ? "glass" : ""}`}
              aria-label={`${hearts} hearts`}
            >
              {Array.from({ length: Math.ceil(maxHearts) }, (_, n) => n).map(
                (n) => (
                  <span
                    key={n}
                    className={
                      hearts - n >= 1 ? "" : hearts - n > 0 ? "partial" : "lost"
                    }
                  >
                    ♥
                  </span>
                ),
              )}
            </div>
            <button
              className="pause"
              disabled={
                !running ||
                isOnlineVersus ||
                (paused && !pauseMenuOpen)
              }
              onClick={toggleManualPause}
              aria-label={pauseMenuOpen ? "Resume" : "Pause"}
            >
              {isOnlineVersus ? "⚔" : pauseMenuOpen ? "▶" : "Ⅱ"}
            </button>
          </footer>
            </>
          )}
        </section>
        {reportOpen && !guest && (
          <div
            className="report-backdrop"
            role="dialog"
            aria-modal="true"
            aria-labelledby="player-report-title"
          >
            <section className="report-modal" id="player-report-dialog">
              <button
                className="report-close"
                type="button"
                onClick={closeReportForm}
                aria-label="Close report form"
              >
                ×
              </button>
              <p>PLAYER SUPPORT</p>
              <h2 id="player-report-title">REPORT AN ISSUE</h2>
              <form onSubmit={submitReport}>
                <label>
                  WHAT HAPPENED?
                  <select
                    value={reportType}
                    onChange={(event) => setReportType(event.target.value)}
                  >
                    <option>Bug</option>
                    <option>Gameplay problem</option>
                    <option>Account problem</option>
                    <option>Suggestion</option>
                    <option>Other</option>
                  </select>
                </label>
                <label>
                  DETAILS
                  <textarea
                    value={reportMessage}
                    onChange={(event) => setReportMessage(event.target.value)}
                    minLength={10}
                    maxLength={1500}
                    placeholder="Tell us what happened and what you expected…"
                    required
                  />
                </label>
                <small>{reportMessage.length}/1500</small>
                {reportStatus && (
                  <div className="report-status" role="status">
                    {reportStatus}
                  </div>
                )}
                <button disabled={reportBusy}>
                  {reportBusy ? "SENDING…" : "SEND REPORT →"}
                </button>
              </form>
            </section>
          </div>
        )}
        {(settingsOpen || usernameRequired) && !guest && (
          <div className="report-backdrop" role="dialog" aria-modal="true">
            <section className="settings-modal">
              {!usernameRequired && (
                <button
                  className="report-close"
                  onClick={() => {
                    setSettingsOpen(false);
                    setPaused(false);
                  }}
                >
                  ×
                </button>
              )}
              <p>PLAYER SETTINGS</p>
              <h2>{usernameRequired ? "CHOOSE A USERNAME" : "SETTINGS"}</h2>
              {usernameRequired && (
                <div className="required-note">
                  A username is required before you can play.
                </div>
              )}
              {usernameRequired || editUsername ? (
                <form onSubmit={saveUsername}>
                  <label>
                    USERNAME
                    <input
                      value={usernameInput}
                      onChange={(e) => setUsernameInput(e.target.value)}
                      minLength={3}
                      maxLength={20}
                      pattern="[A-Za-z0-9_]+"
                      placeholder="3-20 letters, numbers, underscores"
                      required
                    />
                  </label>
                  {usernameStatus && (
                    <div className="report-status">{usernameStatus}</div>
                  )}
                  <button>SAVE USERNAME</button>
                  {!usernameRequired && (
                    <button
                      type="button"
                      className="settings-cancel"
                      onClick={() => setEditUsername(false)}
                    >
                      CANCEL
                    </button>
                  )}
                </form>
              ) : (
                <button
                  className="settings-action"
                  onClick={() => {
                    setEditUsername(true);
                    setUsernameStatus("");
                  }}
                >
                  CHANGE USERNAME
                </button>
              )}
              {!usernameRequired && (
                <>
                  {editPassword ? (
                    <form onSubmit={changePassword}>
                      <label>
                        NEW PASSWORD
                        <input
                          id="new-password"
                          name="new-password"
                          autoComplete="new-password"
                          type="password"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          minLength={6}
                          required
                        />
                      </label>
                      {passwordStatus && (
                        <div className="report-status">{passwordStatus}</div>
                      )}
                      <button>SAVE NEW PASSWORD</button>
                      <button
                        type="button"
                        className="forgot-settings"
                        onClick={() =>
                          sendPasswordReset(userEmail || "", setPasswordStatus)
                        }
                      >
                        EMAIL ME A RECOVERY LINK
                      </button>
                      <button
                        type="button"
                        className="settings-cancel"
                        onClick={() => setEditPassword(false)}
                      >
                        CANCEL
                      </button>
                    </form>
                  ) : (
                    <button
                      className="settings-action"
                      onClick={() => {
                        setEditPassword(true);
                        setPasswordStatus("");
                      }}
                    >
                      CHANGE PASSWORD
                    </button>
                  )}
                  <div className="settings-report">
                    <h3>REPORT AN ISSUE</h3>
                    <form onSubmit={submitReport}>
                      <label>
                        TYPE
                        <select
                          value={reportType}
                          onChange={(e) => setReportType(e.target.value)}
                        >
                          <option>Bug</option>
                          <option>Gameplay problem</option>
                          <option>Account problem</option>
                          <option>Suggestion</option>
                          <option>Other</option>
                        </select>
                      </label>
                      <label>
                        DETAILS
                        <textarea
                          value={reportMessage}
                          onChange={(e) => setReportMessage(e.target.value)}
                          minLength={10}
                          maxLength={1500}
                          required
                        />
                      </label>
                      {reportStatus && (
                        <div className="report-status">{reportStatus}</div>
                      )}
                      <button disabled={reportBusy}>
                        {reportBusy ? "SENDING…" : "SEND REPORT"}
                      </button>
                    </form>
                  </div>
                </>
              )}
              {!usernameRequired && (
                <button className="signout-settings" onClick={signOut}>
                  SIGN OUT
                </button>
              )}
            </section>
          </div>
        )}
        {shopOpen && (
          <div className="report-backdrop">
            <section
              className="powerup-modal extraction-shop-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="extraction-shop-title"
            >
              <button
                className="report-close"
                aria-label="Close extraction shop"
                disabled={extractBusy}
                onClick={() => {
                  setShopOpen(false);
                  setPaused(false);
                  setExtractResults([]);
                  setShopStatus("");
                  setExtractAnimation("idle");
                  setExtractingOption(null);
                }}
              >
                ×
              </button>
              <p>GEM SHOP</p>
              <h2 id="extraction-shop-title">EXTRACTION SHOP</h2>
              <div className="extract-actions">
                {(Object.keys(EXTRACTION_BOXES) as ExtractionOption[]).map(
                  (option) => {
                    const box = EXTRACTION_BOXES[option];
                    const batchLimit = EXTRACTION_MAX_QUANTITY;
                    const maxQuantity = Math.min(
                      batchLimit,
                      Math.floor(gems / box.cost),
                    );
                    const quantity = Math.max(
                      1,
                      Math.min(batchLimit, extractQuantities[option]),
                    );
                    const totalCost = quantity * box.cost;
                    const setQuantity = (next: number) =>
                      setExtractQuantities((current) => ({
                        ...current,
                        [option]: Math.max(
                          1,
                          Math.min(
                            Math.max(1, maxQuantity),
                            Math.floor(next) || 1,
                          ),
                        ),
                      }));
                    return (
                      <article
                        key={option}
                        className={`extract-box ${option}`}
                      >
                        <b>{box.name}</b>
                        <small className="box-mix">{box.mix}</small>
                        <small className="box-odds-label">
                          {box.oddsLabel}
                        </small>
                        <span className="rarity-chances">
                          {box.odds.map(([rarity, chance]) => (
                            <small key={rarity} className={rarity}>
                              <b>{rarity}</b>
                              {chance}
                            </small>
                          ))}
                        </span>
                        <div className="extract-quantity">
                          <b>QTY</b>
                          <button
                            type="button"
                            aria-label={`Decrease ${box.name} quantity`}
                            disabled={extractBusy || quantity <= 1}
                            onClick={() => setQuantity(quantity - 1)}
                          >
                            −
                          </button>
                          <input
                            aria-label={`${box.name} quantity`}
                            type="number"
                            inputMode="numeric"
                            min={1}
                            max={Math.max(1, maxQuantity)}
                            value={quantity}
                            disabled={extractBusy || maxQuantity < 1}
                            onChange={(event) =>
                              setQuantity(Number(event.target.value))
                            }
                          />
                          <button
                            type="button"
                            aria-label={`Increase ${box.name} quantity`}
                            disabled={
                              extractBusy ||
                              maxQuantity < 1 ||
                              quantity >= maxQuantity
                            }
                            onClick={() => setQuantity(quantity + 1)}
                          >
                            +
                          </button>
                          <button
                            type="button"
                            className="quantity-max"
                            aria-label={`Set ${box.name} quantity to maximum`}
                            disabled={extractBusy || maxQuantity < 1}
                            onClick={() => setQuantity(maxQuantity)}
                          >
                            MAX
                          </button>
                        </div>
                        <button
                          aria-label={`Open ${quantity * box.pullCount} normal box${quantity * box.pullCount === 1 ? "" : "es"} for ${totalCost} gems`}
                          disabled={
                            extractBusy ||
                            maxQuantity < 1 ||
                            quantity > maxQuantity
                          }
                          onClick={() => extract(option)}
                        >
                          {extractBusy && extractingOption === option
                            ? "OPENING…"
                            : "OPEN"}{" "}
                          <span>TOTAL ♦ {totalCost}</span>
                        </button>
                      </article>
                    );
                  },
                )}
              </div>
              <div ref={extractFeedbackRef} className="extract-feedback">
                {extractAnimation !== "idle" && extractingOption ? (
                  <div
                    className={`extract-opening-stage ${extractAnimation} ${extractingOption}`}
                  >
                    <div
                      className={`opening-crate${extractQuantities[extractingOption] > 1 ? " multi" : ""}`}
                      aria-hidden="true"
                    >
                      <span className="opening-lid" />
                      <span className="opening-body">◇</span>
                      <i />
                      <i />
                      <i />
                    </div>
                    <strong>
                      {extractAnimation === "shaking"
                        ? "OPENING BOXES…"
                        : "ITEMS REVEALED!"}
                    </strong>
                  </div>
                ) : extractResults.length > 0 ? (
                  <section
                    className="extract-new-panel"
                    aria-labelledby="extract-new-title"
                  >
                    <header>
                      <b id="extract-new-title">NEW THIS OPEN</b>
                      <small>{newExtractResults.length} ADDED</small>
                    </header>
                    {newExtractResults.length > 0 ? (
                      <div
                        className={`extract-results new-extract-results${newExtractResults.length > 1 ? " bundle" : ""}`}
                      >
                        {newExtractResults.map((item) => (
                          <span
                            key={item.item_key}
                            className={`${item.rarity}${item.draw_profile === "legendary" ? " legendary-roll" : ""}`}
                          >
                            <b>{item.rarity}</b>
                            {item.display_name ??
                              item.item_key.replaceAll("_", " ")}
                            <small>
                              NEW{" "}
                              {item.item_type === "character"
                                ? "CHARACTER + WEAPON"
                                : `${item.item_type.toUpperCase()} COSMETIC`}
                            </small>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="extract-no-new">
                        NO NEW ITEMS — ALL PULLS WERE DUPLICATES
                      </p>
                    )}
                  </section>
                ) : null}
              </div>
              <strong className="shop-balance">BALANCE: ♦ {gems}</strong>
              {shopStatus && (
                <div className="report-status" role="status" aria-live="polite">
                  {shopStatus}
                </div>
              )}
            </section>
          </div>
        )}
        {inventoryOpen && (
          <div className="report-backdrop inventory-backdrop">
            <section
              className="inventory-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="inventory-title"
            >
              <button
                className="report-close"
                aria-label="Close inventory"
                onClick={() => {
                  setInventoryOpen(false);
                  setPaused(false);
                }}
              >
                ×
              </button>
              <header className="inventory-heading">
                <div>
                  <p>COLLECTION + LOADOUT</p>
                  <h2 id="inventory-title">INVENTORY</h2>
                </div>
                <strong>
                  {guest ? "GUEST COLLECTION" : `${unlocks.length} UNLOCKS`}
                </strong>
              </header>
              <div className="inventory-directory" aria-hidden="true">
                <span>01 OBSTACLE</span>
                {INVENTORY_CLASSES.map(({ label }, classIndex) => (
                  <span key={label}>
                    0{classIndex + 2} {label}
                  </span>
                ))}
              </div>
              <div className="inventory-scroll">
                <details
                  className="inventory-section inventory-obstacles"
                  id="inventory-obstacle"
                >
                  <summary className="inventory-section-heading">
                    <span className="inventory-section-number">01</span>
                    <span className="inventory-section-copy">
                      <strong>OBSTACLE</strong>
                      <small>
                        Equip a collected look across hazards, or change the
                        track around them.
                      </small>
                    </span>
                  </summary>
                  <details className="inventory-subsection">
                    <summary className="inventory-subsection-heading">
                      <span>
                        <b>OBSTACLE LOOKS</b>
                        <small>
                          Visual styles for barrels, logs, rocks, and spikes.
                          Gameplay and hit boxes never change.
                        </small>
                      </span>
                      <em>{ownedObstacleCosmetics.length}</em>
                    </summary>
                    <div
                      className={`inventory-obstacle-preview obstacle-${obstacleCosmetic || "default"}`}
                      aria-hidden="true"
                    >
                      {(["barrel", "log", "rock", "spikes"] as Kind[]).map(
                        (kind) => (
                          <span key={kind} className={`preview-${kind}`}>
                            <Obstacle kind={kind} />
                          </span>
                        ),
                      )}
                    </div>
                    <div className="inventory-cosmetic-grid">
                      {ownedObstacleCosmetics.length === 0 ? (
                        <div className="inventory-empty">
                          {guest
                            ? "Sign in and extract boxes to keep obstacle looks."
                            : "No obstacle cosmetics collected yet. Open a box in the Shop."}
                        </div>
                      ) : (
                        ownedObstacleCosmetics.map((item) => (
                          <button
                            key={item.item_key}
                            className={`rarity-${item.rarity}${
                              obstacleCosmetic === item.item_key
                                ? " equipped"
                                : ""
                            }`}
                            onClick={() => void equipCosmetic(item)}
                          >
                            <span className="cosmetic-swatch">◆</span>
                            <b>{item.item_key.replaceAll("_", " ")}</b>
                            <small>
                              {item.rarity}
                              {obstacleCosmetic === item.item_key
                                ? " · EQUIPPED"
                                : ""}
                            </small>
                          </button>
                        ))
                      )}
                    </div>
                  </details>
                  <details className="inventory-subsection">
                    <summary className="inventory-subsection-heading">
                      <span>
                        <b>TRACK + ENVIRONMENT LOOKS</b>
                        <small>
                          Change the scenery and road style without changing
                          lane positions or gameplay.
                        </small>
                      </span>
                      <em>{ownedEnvironments.length}</em>
                    </summary>
                    <div className="inventory-cosmetic-grid environments">
                      {ownedEnvironments.length === 0 ? (
                        <div className="inventory-empty">
                          No environment cosmetics collected yet.
                        </div>
                      ) : (
                        ownedEnvironments.map((item) => (
                          <button
                            key={item.item_key}
                            className={`rarity-${item.rarity}${
                              environmentCosmetic === item.item_key
                                ? " equipped"
                                : ""
                            }`}
                            onClick={() => void equipCosmetic(item)}
                          >
                            <span className="cosmetic-swatch">▰</span>
                            <b>{item.item_key.replaceAll("_", " ")}</b>
                            <small>
                              {item.rarity}
                              {environmentCosmetic === item.item_key
                                ? " · EQUIPPED"
                                : ""}
                            </small>
                          </button>
                        ))
                      )}
                    </div>
                  </details>
                </details>

                {INVENTORY_CLASSES.map(
                  ({ key: classKey, label, description }, classIndex) => {
                    const roster = CLASS_CHARACTERS[classKey];
                    const includedCharacter = roster.find((character) =>
                      isStarterCharacter(character.key),
                    );
                    const sectionFocused =
                      inventoryCharacter.classKey === classKey;
                    return (
                      <details
                        className={`inventory-section inventory-characters inventory-${classKey}`}
                        id={`inventory-${classKey}`}
                        key={classKey}
                      >
                        <summary className="inventory-section-heading">
                          <span className="inventory-section-number">
                            0{classIndex + 2}
                          </span>
                          <span className="inventory-section-copy">
                            <strong>{label}</strong>
                            <small>{description}</small>
                          </span>
                        </summary>
                        <p className="inventory-kit-note">
                          {includedCharacter ? (
                            <>
                              <b>
                                {includedCharacter.name} is the included default
                                character + weapon kit.
                              </b>{" "}
                              Other {label.toLowerCase()} character + weapon
                              kits stay locked until they are extracted from a
                              box.
                            </>
                          ) : (
                            <>
                              <b>{label} has no included default character.</b>{" "}
                              Every character + weapon kit in this section must
                              be extracted from a box.
                            </>
                          )}
                        </p>
                        <div className="inventory-roster">
                          {roster.map((character) => {
                            const owned = isCharacterOwned(
                              unlocks,
                              character.key,
                            );
                            const focused =
                              sectionFocused &&
                              inventoryCharacter.characterKey === character.key;
                            const equipped =
                              activeClass === classKey &&
                              activeCharacter === character.key;
                            return (
                              <button
                                key={character.key}
                                className={`${focused ? "focused" : ""}${
                                  equipped ? " equipped" : ""
                                }${owned ? "" : " locked"}`}
                                aria-pressed={focused}
                                aria-controls={`inventory-character-detail-${classKey}`}
                                onClick={() => {
                                  setInventoryCharacter({
                                    classKey,
                                    characterKey: character.key,
                                  });
                                  setInventoryStatus("");
                                  requestAnimationFrame(() => {
                                    const detail = document.getElementById(
                                      `inventory-character-detail-${classKey}`,
                                    );
                                    detail?.focus({ preventScroll: true });
                                    detail?.scrollIntoView({
                                      block: "nearest",
                                      behavior: "smooth",
                                    });
                                  });
                                }}
                              >
                                <span
                                  className={`character-portrait ${character.key}`}
                                  aria-hidden="true"
                                >
                                  <i />
                                </span>
                                <span className="inventory-character-name">
                                  <b>{character.name}</b>
                                  <small>{character.weapon}</small>
                                  <em>
                                    {
                                      CHARACTER_ABILITIES[
                                        character.key as CharacterKey
                                      ].name
                                    }
                                    {" · SELECT · PASSIVE BELOW"}
                                  </em>
                                </span>
                                <small
                                  className={`character-rarity ${character.rarity}`}
                                >
                                  {isStarterCharacter(character.key)
                                    ? `STARTER · ${character.rarity}`
                                    : `${owned ? "OWNED" : "LOCKED"} · ${character.rarity}`}
                                </small>
                              </button>
                            );
                          })}
                        </div>
                        {sectionFocused && focusedCharacter && (
                          <div
                            key={focusedCharacter.key}
                            className="inventory-character-detail"
                            id={`inventory-character-detail-${classKey}`}
                            tabIndex={-1}
                            aria-label={`${focusedCharacter.name} character details`}
                          >
                            <div className="inventory-character-summary">
                              <span
                                className={`character-portrait ${focusedCharacter.key}`}
                                aria-hidden="true"
                              >
                                <i />
                              </span>
                              <div>
                                <small>
                                  {focusedCharacterOwned
                                    ? `${label} LOADOUT`
                                    : "LOCKED PREVIEW"}
                                </small>
                                <h4>{focusedCharacter.name}</h4>
                                <p>{focusedCharacter.weapon}</p>
                              </div>
                              <button
                                className="equip-character"
                                disabled={
                                  !focusedCharacterOwned ||
                                  running ||
                                  (mode === "impossible" &&
                                    focusedCharacter.key !== "runner_ace") ||
                                  (mode === "hardcore" &&
                                    (classKey === "medic" ||
                                      classKey === "tank"))
                                }
                                onClick={() =>
                                  void equipInventoryCharacter(
                                    classKey,
                                    focusedCharacter.key,
                                  )
                                }
                              >
                                {activeClass === classKey &&
                                activeCharacter === focusedCharacter.key
                                  ? "EQUIPPED"
                                  : !focusedCharacterOwned
                                    ? "LOCKED · EXTRACT IN SHOP"
                                  : "EQUIP CHARACTER"}
                              </button>
                            </div>
                            <details className="inventory-subsection character-rules-subsection">
                              <summary className="inventory-subsection-heading">
                                <span>
                                  <b>PASSIVE ABILITY</b>
                                  <small>{focusedCharacterAbility?.name}</small>
                                </span>
                              </summary>
                              <article className="passive-ability-showcase">
                                <small>{focusedCharacterAbility?.name}</small>
                                <p>{focusedCharacterAbility?.description}</p>
                              </article>
                            </details>
                            <details className="inventory-subsection character-weapon-subsection">
                              <summary className="inventory-subsection-heading">
                                <span>
                                  <b>WEAPON EFFECT</b>
                                  <small>{focusedWeaponScoreLabel}</small>
                                </span>
                              </summary>
                              <article className="weapon-showcase standalone-weapon-showcase">
                                <span
                                  className={`weapon-showcase-icon character-${focusedCharacter.key}`}
                                  aria-hidden="true"
                                />
                                <div>
                                  <small>
                                    {focusedCharacterOwned
                                      ? "WEAPON BONUS ACTIVE"
                                      : "LOCKED WEAPON BONUS"}
                                  </small>
                                  <b>{focusedCharacter.weapon}</b>
                                  <p>
                                    {focusedWeaponScoreLabel}.{" "}
                                    {isStarterCharacter(focusedCharacter.key)
                                      ? `Included with starter ${focusedCharacter.name}.`
                                      : focusedCharacterOwned
                                        ? `Unlocked together with ${focusedCharacter.name}.`
                                        : `Extract ${focusedCharacter.name} from a box to unlock both the character and this weapon.`}
                                  </p>
                                </div>
                              </article>
                            </details>
                            <details className="inventory-subsection character-cosmetics-subsection">
                              <summary className="inventory-subsection-heading">
                                <span>
                                  <b>
                                    UNIVERSAL CHARACTER COSMETICS
                                  </b>
                                  <small>
                                    Equip any owned look while previewing
                                    {` ${focusedCharacter.name}`}. The same
                                    equipped look applies to every character.
                                  </small>
                                </span>
                                <em>{ownedPlayerCosmetics.length}</em>
                              </summary>
                              <div className="inventory-cosmetic-grid player-looks">
                                {ownedPlayerCosmetics.length === 0 ? (
                                  <div className="inventory-empty">
                                    {guest
                                      ? "Guest loadouts include all four starter characters. Sign in to build a permanent cosmetic collection."
                                      : "No character cosmetics collected yet. Open a box in the Shop."}
                                  </div>
                                ) : (
                                  ownedPlayerCosmetics.map((item) => (
                                    <button
                                      key={item.item_key}
                                      className={`rarity-${item.rarity}${
                                        playerCosmetic === item.item_key
                                          ? " equipped"
                                          : ""
                                      }`}
                                      onClick={() => void equipCosmetic(item)}
                                    >
                                      <span className="cosmetic-swatch">✦</span>
                                      <b>{item.item_key.replaceAll("_", " ")}</b>
                                      <small>
                                        {item.rarity}
                                        {playerCosmetic === item.item_key
                                          ? " · EQUIPPED"
                                          : ""}
                                      </small>
                                    </button>
                                  ))
                                )}
                              </div>
                            </details>
                          </div>
                        )}
                      </details>
                    );
                  },
                )}
              </div>
              {inventoryStatus && (
                <div className="inventory-status" role="status">
                  {inventoryStatus}
                </div>
              )}
            </section>
          </div>
        )}
        {leaderboardOpen && (
          <div className="report-backdrop">
            <section className="leaderboard-modal">
              <button
                className="report-close"
                onClick={() => {
                  setLeaderboardOpen(false);
                  setPaused(false);
                }}
              >
                ×
              </button>
              <p>LEADERBOARD 1</p>
              <h2>TOP RUNNERS</h2>
              <div className="leader-list">
                {leaders.length === 0 ? (
                  <div className="empty-reports">No scores yet.</div>
                ) : (
                  leaders.map((entry) => (
                    <div
                      key={entry.username + entry.rank}
                      className={entry.username === username ? "me" : ""}
                    >
                      <b>#{entry.rank}</b>
                      <span>{entry.username}</span>
                      <strong>{entry.high_score.toLocaleString()}</strong>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        )}
        {isAdmin && (
          <div
            className="report-backdrop"
            aria-hidden={!adminOpen}
            style={adminOpen ? undefined : { display: "none" }}
          >
            <section
              className={`admin-inbox${adminTab === "players" ? " player-editor-shell" : ""}`}
              role="dialog"
              aria-modal="true"
              aria-labelledby="admin-dialog-title"
            >
              <button
                className="report-close"
                aria-label="Close admin controls"
                onClick={() => {
                  setAdminOpen(false);
                  setPaused(false);
                }}
              >
                ×
              </button>
              <p>ADMIN CONTROL</p>
              <h2 id="admin-dialog-title">
                {adminTab === "reports"
                  ? "ADMIN 01 · INBOX"
                  : adminTab === "admins"
                    ? "ADMIN 02 · ADMINS"
                    : "ADMIN 03 · PLAYER LOOKUP + COMMANDS"}
              </h2>
              <div className="admin-tabs">
                <button
                  className={adminTab === "reports" ? "active" : ""}
                  onClick={() => setAdminTab("reports")}
                >
                  01 · INBOX
                </button>
                <button
                  className={adminTab === "admins" ? "active" : ""}
                  onClick={loadAdmins}
                >
                  02 · ADMINS
                </button>
                <button
                  className={adminTab === "players" ? "active" : ""}
                  onClick={() => {
                    setAdminTab("players");
                    setPauseMenuOpen(false);
                    setPaused(true);
                  }}
                >
                  03 · PLAYER LOOKUP
                </button>
              </div>
              {adminTab === "reports" ? (
                <>
                  <div className="admin-toolbar">
                    <button onClick={copyOpenReports}>
                      COPY ALL OPEN REPORTS
                    </button>
                    {copyStatus && <span>{copyStatus}</span>}
                  </div>
                  <h3 className="inbox-heading">
                    OPEN REPORTS <span>{reports.length}</span>
                  </h3>
                  <div className="report-list">
                    {reports.length === 0 ? (
                      <div className="empty-reports">No open reports.</div>
                    ) : (
                      reports.map((r) => (
                        <article key={r.id}>
                          <header>
                            <b>{r.report_type}</b>
                            <span>{r.status.toUpperCase()}</span>
                          </header>
                          <p>{r.message}</p>
                          <small>
                            {new Date(r.created_at).toLocaleString()} ·{" "}
                            {r.user_id.slice(0, 8)}
                          </small>
                          <button onClick={() => resolveReport(r.id)}>
                            RESOLVE & DELETE
                          </button>
                        </article>
                      ))
                    )}
                  </div>
                </>
              ) : adminTab === "admins" ? (
                <div className="admin-team">
                  {adminRole === "main" && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void manageAdmin(adminTarget, "add");
                      }}
                    >
                      <label>
                        ADD BY EMAIL OR USERNAME
                        <input
                          value={adminTarget}
                          onChange={(e) => setAdminTarget(e.target.value)}
                          required
                          placeholder="player@email.com or username"
                        />
                      </label>
                      <button>ADD CO-ADMIN</button>
                    </form>
                  )}
                  {adminStatus && (
                    <div className="report-status">{adminStatus}</div>
                  )}
                  <div className="admin-list">
                    {admins.map((a) => (
                      <article key={a.user_id}>
                        <div>
                          <b>{a.username || "No username"}</b>
                          <small>{a.email}</small>
                        </div>
                        <span>
                          {a.role === "main" ? "MAIN ADMIN" : "CO-ADMIN"}
                        </span>
                        {adminRole === "main" && a.email !== userEmail && (
                          <div className="admin-actions">
                            {a.role === "co_admin" ? (
                              <>
                                <button
                                  onClick={() =>
                                    manageAdmin(a.email, "promote")
                                  }
                                >
                                  PROMOTE
                                </button>
                                <button
                                  onClick={() => manageAdmin(a.email, "remove")}
                                >
                                  KICK
                                </button>
                              </>
                            ) : (
                              <button
                                onClick={() => manageAdmin(a.email, "demote")}
                              >
                                MAKE CO-ADMIN
                              </button>
                            )}
                          </div>
                        )}
                      </article>
                    ))}
                  </div>
                </div>
              ) : null}
              <div hidden={adminTab !== "players"}>
                <AdminPlayerEditor
                  supabase={supabase}
                  isMainAdmin={adminRole === "main"}
                  isActive={adminOpen && adminTab === "players"}
                />
              </div>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
