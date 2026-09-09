"use client";
import {
  type CSSProperties,
  FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createBrowserClient } from "@supabase/ssr";
import { audioEngine, type Soundtrack } from "./audio-engine";
import { AdminPlayerEditor } from "./admin-player-editor";
import {
  calculateTankDamage,
  generateJesterWaveEffect,
  getCitadelOpeningBlocks,
  getFortuneGemSpawnChance,
  resolveWeaverSnowflake,
  selectSentinelAnalyzedSource,
  type HazardKind,
  type TankCharacterKey,
} from "./character-balance-rules";
import {
  ATTACK_POINT_COSTS,
  CURRENT_RULES,
  GROVE_RULES,
  MAP_IDS,
  MAP_RULES,
  PITCH_KATANA_RULES,
  VOLCANO_RULES,
  activatePitchKatana,
  applyMapHealthModifiers,
  chooseNaturalObstacle,
  createFactoryConveyorState,
  createPitchKatanaState,
  getAttackPointsForCoin,
  getAvailableAttacks,
  getFactoryObstacleSpeedMultiplier,
  getMapRules,
  getNewVolcanoStationaryDamage,
  isCharacterClassAllowed,
  isPitchKatanaMovementLocked,
  resetPitchKatanaAtWaveEnd,
  resolveCurrentInteraction,
  resolvePitchKatanaCollision,
  selectOneVersusOneMap,
  settlePitchKatanaWindow,
  type AttackId,
  type FactoryConveyorState,
  type MapId,
  type MapPriorityList,
  type PitchKatanaState,
} from "./arena-map-rules";
type Kind =
  | "gem"
  | "coin"
  | "melon"
  | "mushroom"
  | "car"
  | "log"
  | "snowflake"
  | "current"
  | "rock"
  | "barrel"
  | "spikes";
type Item = {
  id: number;
  lane: number;
  y: number;
  kind: Kind;
  attackToken?: string;
  attackGroup?: number;
  attackEscapeLane?: number;
  attackSafeLanes?: readonly number[];
  formationSpeed?: number;
  seededUntilWave?: number;
  deactivated?: boolean;
};
type GameMode = "normal" | "hardcore" | "impossible";
type OracleProphecy = "no-hit" | "completion" | "near-death";
const ORACLE_PROPHECY_COPY: Record<
  OracleProphecy,
  { condition: string; reward: string; reducedReward: string }
> = {
  "no-hit": {
    condition: "FINISH WITHOUT CONTACT",
    reward: "NEXT WAVE INVINCIBLE",
    reducedReward: "NEXT WAVE 10-SECOND SHIELD",
  },
  completion: {
    condition: "GET HIT · FINISH ABOVE 1 HP",
    reward: "FULL HEAL",
    reducedReward: "+2 HP",
  },
  "near-death": {
    condition: "FINISH AT 1 HP OR LESS",
    reward: "CHOOSE A HEALER PASSIVE",
    reducedReward: "LEARN A RANDOM HEALER PASSIVE",
  },
};
type AbilityChoice =
  | { kind: "lifeline-lane" }
  | { kind: "pacer-character" }
  | { kind: "oracle-prophecy" }
  | { kind: "oracle-passive"; options: CharacterKey[] }
  | null;
type PulseGameState = {
  hits: number;
  prompt: "A" | "S" | "D" | "F";
  endsAt: number;
  remaining: number;
};
type PlayerReport = {
  id: number;
  user_id: string;
  username: string | null;
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
type BanAppeal = {
  id: number;
  user_id: string;
  username: string | null;
  email: string;
  ban_id: number | null;
  ban_scope: string | null;
  ban_note: string | null;
  player_note: string;
  status: "pending" | "approved" | "denied";
  created_at: string;
  reviewed_at: string | null;
  reviewed_by_username: string | null;
  reviewed_by_email: string | null;
  admin_note: string | null;
  appealed_ban_count: number;
  snapshot_active_ban_count: number;
  active_ban_count: number;
};
type MyBanAppeal = {
  has_active_ban: boolean;
  can_appeal: boolean;
  appeal: {
    id: number;
    ban_id: number | null;
    player_note: string;
    status: "pending" | "approved" | "denied";
    created_at: string;
    reviewed_at: string | null;
    admin_note: string | null;
  } | null;
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
  duplicate_refund?: number;
};
type CatalogItem = Unlock & {
  display_name?: string;
  extractable?: boolean;
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
type VersusMode = "casual" | "ranked";
type PlayerProgression = {
  level: number;
  xp: number;
  xp_required: number;
  lifetime_xp: number;
  completed_runs: number;
  ranked_unlocked: boolean;
  xp_awarded?: number;
};
type RunXpBreakdown = {
  total: number;
  score: number;
  gems: number;
  gem_count: number;
};
const normalizeRunXpBreakdown = (value: unknown): RunXpBreakdown | null => {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const read = (key: keyof RunXpBreakdown) => {
    const amount = Number(record[key]);
    return Number.isFinite(amount) ? Math.max(0, Math.floor(amount)) : 0;
  };
  return {
    total: read("total"),
    score: read("score"),
    gems: read("gems"),
    gem_count: read("gem_count"),
  };
};
type VersusAttackKind = AttackId;
type PendingVersusAttack = {
  id: string;
  kind: Kind;
  lane?: number;
  laneGroup?: number;
  lanePosition?: number;
  escapeLane?: number;
};
type VersusStatePayload = {
  map_rules?: Record<string, unknown> | null;
  wave_rules?: {
    wave?: number;
    conveyor_lane_index?: number | null;
    conveyor_speed_multiplier?: number | null;
  } | null;
  outcome?: string | null;
  match?: {
    status?: string;
    mode?: VersusMode;
    map_key?: string | null;
    map_selection_method?: string | null;
    map_candidates?: string[] | null;
    outcome?: string | null;
    is_draw?: boolean;
    second_death_bonus_points?: number;
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
    current_wave_mushrooms?: number;
    total_mushrooms_collected?: number;
    eliminated_at?: string | null;
    death_order?: number | null;
    second_death_bonus_awarded?: boolean;
    final_score?: number | null;
    katana_broken?: boolean;
    katana_cooldown_until?: string | null;
    katana_cooldown_ends_at?: string | null;
    zenith_time_stop_until?: string | null;
    zenith_time_stop_used?: boolean;
    obstacle_speed_multiplier?: number;
  };
  opponent?: {
    username?: string;
    hearts?: number;
    score?: number;
    status?: string;
    current_wave_mushrooms?: number;
    total_mushrooms_collected?: number;
    eliminated_at?: string | null;
    death_order?: number | null;
    second_death_bonus_awarded?: boolean;
    final_score?: number | null;
    zenith_time_stop_until?: string | null;
    zenith_time_stop_used?: boolean;
    obstacle_speed_multiplier?: number;
  };
  pending_attacks?: Array<{
    id?: string;
    obstacle_type?: string;
    lane_index?: number | null;
    lane_group?: number | null;
    lane_position?: number | null;
    escape_lane_index?: number | null;
    source?: string | null;
  }>;
};
const readFactoryConveyorFromWaveRules = (
  value: VersusStatePayload["wave_rules"],
  laneCount: number,
  expectedWave?: number,
): FactoryConveyorState | null => {
  if (!value) return null;
  const ruleWave = Number(value.wave);
  if (
    expectedWave !== undefined &&
    Number.isFinite(ruleWave) &&
    Math.round(ruleWave) !== expectedWave
  )
    return null;
  const lane = Number(value.conveyor_lane_index);
  const speedMultiplier = Number(value.conveyor_speed_multiplier);
  if (
    !Number.isInteger(lane) ||
    lane < 0 ||
    lane >= laneCount ||
    (speedMultiplier !== 0.5 && speedMultiplier !== 2)
  )
    return null;
  return { lane, speedMultiplier };
};
type MapPriorityPayload = {
  configured?: boolean;
  map_order?: string[];
  catalog?: Array<{ map_key?: string; display_name?: string }>;
};
const isMapId = (value: unknown): value is MapId =>
  typeof value === "string" && (MAP_IDS as readonly string[]).includes(value);
const normalizeMapId = (value: unknown): MapId =>
  isMapId(value) ? value : "classic";
const DEFAULT_MAP_PRIORITY: MapPriorityList = [...MAP_IDS];
const MAP_SUMMARIES: Readonly<Record<MapId, string>> = {
  classic: "5 lanes · standard rules",
  alley: "3 lanes · dense traffic · double starting/max HP",
  desert: "7 lanes · no healing · Runner or Trickster only",
  skyway: "6 lanes · Current hazards · no Trickster",
  pitch: "6 lanes · risk/reward Katana",
  volcano: "7 lanes · Ace only · move before the heat hits",
  factory: "4 lanes · changing conveyor speeds",
  grove: "6 lanes · +1 HP · mushroom contest",
};
const TRACK_LANES = [0, 1, 2, 3, 4] as const;
const getTrackLanes = (laneCount: number) =>
  Array.from({ length: Math.max(1, Math.round(laneCount)) }, (_, lane) => lane);
const AMBIENT_HAZARDS: ReadonlyArray<Kind> = [
  "log",
  "snowflake",
  "rock",
  "barrel",
  "spikes",
];
const MAX_HAZARD_LANES = TRACK_LANES.length - 1;
const MAX_SAME_HAZARD_STREAK = 4;
// The largest obstacle art (a spiked rock) extends well beyond its body box.
// Keep a full visual footprint between any legacy/carried same-lane items.
const MIN_SAME_LANE_GAP = 24;
const HORIZON_PREVIEW_SIZE = 12;
const WAVE_HAZARD_PLAN_SIZE = 128;
const isHazardKind = (kind: Kind) =>
  kind !== "gem" &&
  kind !== "coin" &&
  kind !== "melon" &&
  kind !== "mushroom";
const appendSafeAttackWave = (
  current: Item[],
  hazards: readonly Kind[],
  nextId: () => number,
  spacing: number,
  playerLane: number,
  laneCount: number = TRACK_LANES.length,
  random: () => number = Math.random,
) => {
  if (hazards.length === 0) return current;
  const safeSpacing = Math.max(MIN_SAME_LANE_GAP, spacing);
  const trackLanes = getTrackLanes(laneCount);
  const maxHazardLanes = Math.max(
    1,
    Math.min(MAX_HAZARD_LANES, trackLanes.length - 1),
  );
  const startingLane = Math.max(
    0,
    Math.min(trackLanes.length - 1, Math.round(playerLane)),
  );
  const firstEscapeLanes = trackLanes.filter(
    (lane) => Math.abs(lane - startingLane) === 1,
  );
  let safeLane =
    firstEscapeLanes[Math.floor(random() * firstEscapeLanes.length)] ?? 2;
  let attackLanes: number[] = [];
  let previousSafeLane = startingLane;
  const shuffle = (lanes: readonly number[]) => {
    const shuffled = [...lanes];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(random() * (index + 1));
      [shuffled[index], shuffled[swapIndex]] = [
        shuffled[swapIndex],
        shuffled[index],
      ];
    }
    return shuffled;
  };
  const attackItems = hazards.map((kind, index): Item => {
    if (index % maxHazardLanes === 0) {
      if (index > 0) {
        previousSafeLane = safeLane;
        const lastSafeLane = previousSafeLane;
        const reachableSafeLanes = trackLanes.filter(
          (lane) => Math.abs(lane - lastSafeLane) === 1,
        );
        safeLane =
          reachableSafeLanes[
            Math.floor(random() * reachableSafeLanes.length)
          ];
      }
      attackLanes = shuffle(trackLanes.filter((lane) => lane !== safeLane));
      // Make every later group close the last group's escape lane first. The
      // new escape remains one move away, so the pressure cannot be camped but
      // still leaves a reachable route through the pattern. For the first
      // group, the previous safe lane is the player's current lane, so even
      // one purchased obstacle makes a stationary player react.
      attackLanes = [
        previousSafeLane,
        ...attackLanes.filter((lane) => lane !== previousSafeLane),
      ];
    }
    return {
      id: nextId(),
      lane: attackLanes[index % maxHazardLanes],
      // One purchase group arrives as a wall, not a single-file stream. The
      // first wall closes the runner's current lane; each later wall closes
      // the previous escape lane while leaving an adjacent route open.
      y: -10 - Math.floor(index / maxHazardLanes) * safeSpacing,
      kind,
      attackEscapeLane: safeLane,
      attackSafeLanes: [safeLane],
    };
  });
  const coordinatedAttacks = attackItems.map((item, index) => {
    const groupStart = Math.floor(index / maxHazardLanes) * maxHazardLanes;
    const groupSize = Math.min(
      maxHazardLanes,
      attackItems.length - groupStart,
    );
    return {
      ...item,
      attackGroup: Math.floor(index / maxHazardLanes),
      // Keeping the route on every member makes the opening persist while
      // later ambient objects are being spawned.
      attackEscapeLane: attackItems[groupStart]?.attackEscapeLane,
      attackSafeLanes: attackItems[groupStart]?.attackSafeLanes,
      formationSpeed:
        groupSize > 1 || attackItems.length > maxHazardLanes ? 1 : undefined,
    };
  });
  return [...current, ...coordinatedAttacks];
};
const appendServerAttackGroups = (
  current: Item[],
  attacks: readonly PendingVersusAttack[],
  nextId: () => number,
  laneCount: number,
  playerLane: number,
  spacing: number,
) => {
  if (attacks.length === 0) return current;
  const normalizedLaneCount = Math.max(1, Math.round(laneCount));
  const safeSpacing = Math.max(MIN_SAME_LANE_GAP, spacing);
  const orderedAttacks = [...attacks].sort(
    (left, right) =>
      (left.laneGroup ?? 0) - (right.laneGroup ?? 0) ||
      (left.lanePosition ?? 0) - (right.lanePosition ?? 0),
  );
  // New map RPCs already assign a complete server-owned formation. Rebuild a
  // checkerboard only for legacy rows that predate that metadata; otherwise a
  // client could silently replace the authoritative lanes and reopen a free
  // camping lane.
  const hasAuthoritativeFormation = orderedAttacks.every(
    (attack) =>
      Number.isInteger(attack.lane) &&
      Number.isInteger(attack.laneGroup) &&
      Number.isInteger(attack.lanePosition),
  );
  const canUseCheckerboard =
    !hasAuthoritativeFormation &&
    orderedAttacks.every((attack) => attack.kind !== "current");
  const orderedGroups: Array<[number, PendingVersusAttack[]]> = [];
  if (canUseCheckerboard) {
    const trackLanes = getTrackLanes(normalizedLaneCount);
    let cursor = 0;
    let routeLane = Math.max(
      0,
      Math.min(normalizedLaneCount - 1, Math.round(playerLane)),
    );
    let wallParity = routeLane % 2;
    while (cursor < orderedAttacks.length) {
      const wallLanes = trackLanes.filter(
        (lane) => lane % 2 === wallParity,
      );
      // A partial final wall closes the lane the runner should currently be
      // using first, then the nearest prior openings. Full walls alternate
      // parity, so every opening from one wall is covered by the next one.
      const prioritizedWallLanes = [...wallLanes].sort((left, right) => {
        if (left === routeLane) return -1;
        if (right === routeLane) return 1;
        return (
          Math.abs(left - routeLane) - Math.abs(right - routeLane) ||
          left - right
        );
      });
      const groupSize = Math.min(
        prioritizedWallLanes.length,
        orderedAttacks.length - cursor,
      );
      const occupiedLanes = prioritizedWallLanes.slice(0, groupSize);
      const safeLanes = trackLanes.filter(
        (lane) => !occupiedLanes.includes(lane),
      );
      const reachableSafeLanes = safeLanes.filter(
        (lane) => Math.abs(lane - routeLane) === 1,
      );
      const nextRouteLane =
        reachableSafeLanes[orderedGroups.length % reachableSafeLanes.length] ??
        safeLanes.sort(
          (left, right) =>
            Math.abs(left - routeLane) - Math.abs(right - routeLane) ||
            left - right,
        )[0] ??
        routeLane;
      const group = orderedAttacks.slice(cursor, cursor + groupSize).map(
        (attack, index) => ({
          ...attack,
          lane: occupiedLanes[index],
          laneGroup: orderedGroups.length,
          lanePosition: index,
          escapeLane: nextRouteLane,
        }),
      );
      orderedGroups.push([orderedGroups.length, group]);
      cursor += groupSize;
      routeLane = nextRouteLane;
      wallParity = wallParity === 0 ? 1 : 0;
    }
  } else {
    const grouped = new Map<number, PendingVersusAttack[]>();
    orderedAttacks.forEach((attack, fallbackIndex) => {
      const group = Number.isInteger(attack.laneGroup)
        ? Number(attack.laneGroup)
        : fallbackIndex;
      const values = grouped.get(group) ?? [];
      values.push(attack);
      grouped.set(group, values);
    });
    orderedGroups.push(
      ...Array.from(grouped.entries()).sort(([left], [right]) => left - right),
    );
  }
  const spawned = orderedGroups.flatMap(([, group], groupIndex) => {
    const occupied = new Set(group.map((attack) => Number(attack.lane)));
    const declaredEscapeLane = group.find((attack) =>
      Number.isInteger(attack.escapeLane),
    )?.escapeLane;
    const rawSafeLanes = canUseCheckerboard
      ? getTrackLanes(normalizedLaneCount).filter(
          (lane) => !occupied.has(lane),
        )
      : Array.from(
          new Set(
            group.flatMap((attack) =>
              Number.isInteger(attack.escapeLane)
                ? [Number(attack.escapeLane)]
                : [],
            ),
          ),
        );
    const safeLanes = Number.isInteger(declaredEscapeLane)
      ? [
          Number(declaredEscapeLane),
          ...rawSafeLanes.filter(
            (lane) => lane !== Number(declaredEscapeLane),
          ),
        ]
      : rawSafeLanes;
    return [...group]
      .sort(
        (left, right) =>
          (left.lanePosition ?? 0) - (right.lanePosition ?? 0),
      )
      .map((attack): Item => ({
        id: nextId(),
        lane: Math.max(
          0,
          Math.min(
            normalizedLaneCount - 1,
            Number.isInteger(attack.lane) ? Number(attack.lane) : 0,
          ),
        ),
        y: -12 - groupIndex * safeSpacing,
        kind: attack.kind,
        attackToken: attack.id,
        attackGroup: groupIndex,
        attackEscapeLane: safeLanes[0],
        attackSafeLanes: safeLanes,
        formationSpeed:
          group.length > 1 || orderedGroups.length > 1 ? 1 : undefined,
      }));
  });
  return [...current, ...spawned];
};

const splitLaneUniqueAttackGroups = (items: readonly Item[]) => {
  const grouped = new Map<number, Item[]>();
  items.forEach((item, fallbackIndex) => {
    const groupKey = item.attackGroup ?? fallbackIndex;
    const group = grouped.get(groupKey) ?? [];
    group.push(item);
    grouped.set(groupKey, group);
  });
  const result: Item[][] = [];
  grouped.forEach((group) => {
    let batch: Item[] = [];
    let occupiedLanes = new Set<number>();
    group.forEach((item) => {
      if (occupiedLanes.has(item.lane)) {
        result.push(batch);
        batch = [];
        occupiedLanes = new Set<number>();
      }
      batch.push({ ...item, y: -12 });
      occupiedLanes.add(item.lane);
    });
    if (batch.length > 0) result.push(batch);
  });
  return result;
};

const countKinds = (kinds: readonly Kind[]) => {
  const counts = new Map<Kind, number>();
  kinds.forEach((kind) => counts.set(kind, (counts.get(kind) ?? 0) + 1));
  return Array.from(counts.entries()).map(
    ([kind, count]) => `${kind.toUpperCase()} ×${count}`,
  );
};

const buildWaveHazardPlan = (
  mapId: MapId,
  versusRun: boolean,
  sameHazardLimit: number,
  startingStreak: { kind: Kind | null; count: number },
  random: () => number = Math.random,
) => {
  const kinds: Kind[] = [];
  let streak = { ...startingStreak };
  for (let index = 0; index < WAVE_HAZARD_PLAN_SIZE; index += 1) {
    let selected: Kind = "log";
    if (versusRun) {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const natural = chooseNaturalObstacle(mapId, random);
        selected = natural === "spike" ? "spikes" : natural;
        if (streak.count < sameHazardLimit || selected !== streak.kind) break;
      }
      if (streak.count >= sameHazardLimit && selected === streak.kind) {
        const weightedFallback = Object.entries(
          getMapRules(mapId).naturalObstacleWeights,
        ).find(
          ([obstacle, weight]) =>
            Number(weight) > 0 &&
            (obstacle === "spike" ? "spikes" : obstacle) !== streak.kind,
        )?.[0];
        if (weightedFallback)
          selected = weightedFallback === "spike" ? "spikes" : weightedFallback as Kind;
      }
    } else {
      const choices =
        streak.count >= sameHazardLimit
          ? AMBIENT_HAZARDS.filter((hazard) => hazard !== streak.kind)
          : AMBIENT_HAZARDS;
      selected = choices[Math.floor(random() * choices.length)] ?? "log";
    }
    kinds.push(selected);
    streak =
      streak.kind === selected
        ? { kind: selected, count: streak.count + 1 }
        : { kind: selected, count: 1 };
  }
  return kinds;
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
  cost: 6 | 7 | 8;
  icon: string;
  description: string;
}> = [
  {
    kind: "barrel",
    label: "BARREL",
    cost: ATTACK_POINT_COSTS.barrel,
    icon: "◉",
    description: "Fast roll · 0.5 HP",
  },
  {
    kind: "log",
    label: "LOG",
    cost: ATTACK_POINT_COSTS.log,
    icon: "▬",
    description: "Steady obstacle · 1 HP",
  },
  {
    kind: "car",
    label: "CAR",
    cost: ATTACK_POINT_COSTS.car,
    icon: "▰",
    description: "Fast lane pressure",
  },
  {
    kind: "snowflake",
    label: "SNOWFLAKE",
    cost: ATTACK_POINT_COSTS.snowflake,
    icon: "❄",
    description: "3-second freeze · every turn delayed 0.25 seconds",
  },
  {
    kind: "current",
    label: "CURRENT",
    cost: ATTACK_POINT_COSTS.current,
    icon: "≈",
    description: "Skyway only · pushes or damages nearby runners",
  },
  {
    kind: "spike",
    label: "SPIKES",
    cost: ATTACK_POINT_COSTS.spike,
    icon: "▲",
    description: "Warning flash · ground trap",
  },
  {
    kind: "rock",
    label: "ROCK",
    cost: ATTACK_POINT_COSTS.rock,
    icon: "◆",
    description: "Slow threat · 2 HP",
  },
];
const VERSUS_INTERMISSION_SECONDS = 10;
const VERSUS_MAX_HEARTS = 12;
const createVersusPickupNonce = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
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
const normalizeVersusHearts = (value: number) => {
  const finiteValue = Number.isFinite(value) ? value : 0;
  return Math.min(VERSUS_MAX_HEARTS, Math.max(0, finiteValue));
};
// Preserve the exact hidden total at the network boundary; only the HUD rounds.
const normalizeVersusHeartsForServer = (value: number) =>
  normalizeVersusHearts(value);
const getDisplayedHearts = (value: number) =>
  Math.max(0, Math.ceil((Number.isFinite(value) ? value : 0) * 2) / 2);
const getDisplayedAttackPoints = (value: number) =>
  Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
const normalizeVersusObstacle = (value: unknown): Kind | null => {
  if (value === "spike" || value === "spikes") return "spikes";
  if (
    value === "barrel" ||
    value === "log" ||
    value === "car" ||
    value === "snowflake" ||
    value === "current" ||
    value === "rock"
  )
    return value;
  return null;
};
const BOT_MAX_HEARTS = 3;
const STRIDE_SHIELD_MS = 250;
const BLITZ_COOLDOWN_MS = 10000;
const VERSUS_ATTACK_DAMAGE: Readonly<Record<VersusAttackKind, number>> = {
  barrel: 0.5,
  log: 1,
  car: 1,
  snowflake: 0,
  current: 0.5,
  spike: 1,
  rock: 2,
};
const simulateBotWave = (
  currentHearts: number,
  attacks: readonly VersusAttackKind[],
  waveNumber: number,
  maximumHearts: number = BOT_MAX_HEARTS,
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
  const heartsAfterDamage = Math.max(0, nextHearts);
  const heartsAfterHealing =
    heartsAfterDamage > 0
      ? Math.min(maximumHearts, heartsAfterDamage + 1)
      : 0;
  return {
    hearts: heartsAfterDamage,
    heartsAfterDamage,
    heartsAfterHealing,
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
  | "idle"
  | "searching"
  | "ready"
  | "playing"
  | "intermission"
  | "eliminated"
  | "finished";
const CLASS_CHARACTERS = {
  runner: [
    { key: "runner_ace", name: "Ace", weapon: "Baton", rarity: "common" },
    { key: "runner_dash", name: "Dash", weapon: "Jet Baton", rarity: "common" },
    { key: "runner_stride", name: "Stride", weapon: "Pace Blades", rarity: "common" },
    { key: "tank_glacier", name: "Glacier", weapon: "Frost Shield", rarity: "rare" },
    { key: "runner_courier", name: "Courier", weapon: "Parcel Staff", rarity: "uncommon" },
    { key: "runner_tempo", name: "Tempo", weapon: "Rhythm Rod", rarity: "uncommon" },
    { key: "tank_reactor", name: "Reactor", weapon: "Core Maul", rarity: "rare" },
    { key: "runner_vector", name: "Vector", weapon: "Arrow Lance", rarity: "rare" },
    { key: "runner_blitz", name: "Blitz", weapon: "Volt Cleats", rarity: "rare" },
    { key: "medic_halo", name: "Halo", weapon: "Sun Staff", rarity: "epic" },
    { key: "runner_orbit", name: "Orbit", weapon: "Ring Blades", rarity: "epic" },
    { key: "runner_relay", name: "Relay", weapon: "Circuit Baton", rarity: "epic" },
    { key: "runner_horizon", name: "Horizon", weapon: "Skyline Disc", rarity: "legendary" },
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
    { key: "medic_revive", name: "Revive", weapon: "Phoenix Feather", rarity: "legendary" },
    { key: "medic_oracle", name: "Oracle", weapon: "Fate Sensor", rarity: "mythic" },
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
    { key: "trickster_flicker", name: "Flicker", weapon: "Blink Knives", rarity: "rare" },
    { key: "runner_flare", name: "Flare", weapon: "Signal Spear", rarity: "epic" },
    { key: "trickster_pickpocket", name: "Pickpocket", weapon: "Coin Dagger", rarity: "rare" },
    { key: "trickster_switch", name: "Switch", weapon: "Twin Coins", rarity: "rare" },
    { key: "trickster_gambit", name: "Gambit", weapon: "Loaded Cards", rarity: "legendary" },
    { key: "medic_vial", name: "Vial", weapon: "Tonic Flask", rarity: "epic" },
    { key: "trickster_mirage", name: "Mirage", weapon: "Prism Fans", rarity: "epic" },
    { key: "runner_comet", name: "Comet", weapon: "Star Spear", rarity: "legendary" },
    { key: "trickster_hex", name: "Hex", weapon: "Void Chakram", rarity: "mythic" },
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
    name: "JET DASH",
    description: "Moves 6% faster and earns 6% more running score. Press E to burst forward with a brief shield.",
  },
  runner_stride: {
    name: "FLOW STRIDE",
    description: "Every third lane change grants a 0.25-second dodge shield.",
  },
  runner_courier: {
    name: "SPECIAL DELIVERY",
    description: "Earns 25% more running score for 4 seconds after collecting a gem, Melon, or 1v1 coin.",
  },
  runner_tempo: {
    name: "SWING TEMPO",
    description: "Odd waves are 15% faster with +15% score; even waves are 15% slower with -15% score.",
  },
  runner_vector: {
    name: "EDGE VECTOR",
    description: "Earns 12% more score in an outside lane and blocks its first hit there each wave.",
  },
  runner_blitz: {
    name: "VOLT CLEAVE",
    description: "Press E to dash and destroy the nearest non-rock obstacle in the current lane. Cooldown: 10 seconds.",
  },
  runner_horizon: {
    name: "FAR HORIZON",
    description: "Previews incoming obstacles before every wave and reveals rival purchases in 1v1.",
  },
  runner_velocity: {
    name: "FULL VELOCITY",
    description: "Each hitless second adds 1% speed and 2% score, up to +100% speed and +200% score. A hit resets it.",
  },
  runner_zenith: {
    name: "ZENITH CLIMB",
    description: "Adds 2% running score per completed wave and inherits Runner abilities as it climbs. Time Stop unlocks on wave 15.",
  },
  runner_scout: {
    name: "QUICKSTEP",
    description:
      "Cuts freeze to 1.5 seconds. Press E and repeat the timed input to make the next snowflake heal 0.5 HP; 50-second cooldown.",
  },
  runner_drift: {
    name: "SLIPSTREAM",
    description:
      "Lane changes within 0.5 seconds stack +15% score and hazard speed, up to +200%; taking damage resets the chain.",
  },
  runner_ranger: {
    name: "PICKUP ZIP",
    description: "Press E every 30 seconds to zip to an on-screen pickup. Melons award double score.",
  },
  runner_fortune: {
    name: "FORTUNE FINDER",
    description: "Each gem collected this run adds 1 percentage point to gem spawn chance, up to +100%.",
  },
  runner_relay: {
    name: "OVERCHARGE RELAY",
    description: "Every two completed waves overcharges a heart. Its discharge clears the closest obstacle in every lane.",
  },
  runner_comet: {
    name: "HEATFEAST",
    description:
      "Halves 1v1 obstacle prices, doubles sent amounts, and stores both players' spending in shared HEATFEAST thresholds.",
  },
  runner_pacer: {
    name: "WAVE RUSH",
    description:
      "Makes hazards 3× faster with 5× score for each wave's first 15 seconds. On death, pass the baton to a non-Runner once.",
  },
  runner_vault: {
    name: "HAZARD VAULT",
    description: "Vaults over the first spike or log hit each wave.",
  },
  runner_spark: {
    name: "CRYSTAL CHARGE",
    description:
      "Every gem collected adds a permanent 1% score boost for the current run.",
  },
  runner_flare: {
    name: "SIGNAL FLARE",
    description:
      "Press E to burn logs, barrels, and snowflakes in one lane for 15 seconds; every 10 burns shortens its cooldown.",
  },
  runner_orbit: {
    name: "LANE ORBIT",
    description:
      "Can wrap from one outside lane to the other by moving outward. Cooldown: 3 seconds.",
  },
  medic_patch: {
    name: "FIELD DRESSING",
    description: "Heals 1.5 HP after each wave and can reach 4 HP.",
  },
  medic_salve: {
    name: "DEEP SALVE",
    description: "Heals 1.5 HP after a wave only when at 1 HP or less.",
  },
  medic_sprout: {
    name: "SEED WARD",
    description: "Press E once per wave to seed an obstacle for two waves, reducing its damage by 0.5 HP. Barrels resist seeds.",
  },
  medic_tonic: {
    name: "FIELD ALCHEMY",
    description: "Gems become ingredients. Brew one 1–3 HP potion and press E to drink it; wave healing is 0.5 HP.",
  },
  medic_beacon: {
    name: "BEACON HEART",
    description: "Can reach 5.5 HP. Reaching 1 HP lights a beacon that disables spikes and slows obstacles by 50%.",
  },
  medic_revive: {
    name: "PHOENIX REVIVE",
    description: "Survives one lethal hit at 0.5 HP and takes flight: +50% speed and score, with logs and spikes harmless.",
  },
  medic_oracle: {
    name: "THREE PROPHECIES",
    description: "Chooses a wave prophecy. Success grants its reward and +5% permanent score; failure costs 1 HP.",
  },
  medic_bloom: {
    name: "HEALING BLOOM",
    description: "Can heal 0.5 HP with the first gem collected each wave.",
  },
  medic_mercy: {
    name: "GRACE GUARD",
    description:
      "The first hit each wave deals half damage; after every protected hit there is a 25% chance the protection continues.",
  },
  medic_pulse: {
    name: "LAST PULSE",
    description: "On death, complete a 10-second timed-key rescue: 10 hits restores 1 HP, 20 restores 2, and 30 restores full HP.",
  },
  medic_suture: {
    name: "TRIAGE CYCLE",
    description: "Restores HP to 5 after every third completed wave, but otherwise heals 1 HP only every two waves.",
  },
  medic_vial: {
    name: "SWITCH ALLEGIANCE",
    description: "Gems cost 1 HP and each wave heals to full. Press E once to reverse obstacle effects for 30 seconds.",
  },
  medic_lifeline: {
    name: "LIFELINE",
    description:
      "Once per run, lethal damage restores full HP and makes that obstacle type harmless. Rescue Hook can zip to another lane three times.",
  },
  medic_seraph: {
    name: "SERAPHIC SHIFT",
    description: "Evades a hit by teleporting to an empty lane, starting at 100% chance and losing 5% per activation. Divine Recovery follows when depleted.",
  },
  medic_remedy: {
    name: "COLD REMEDY",
    description:
      "Can heal 1 HP from the first snowflake collected each wave.",
  },
  medic_reserve: {
    name: "RESERVE DOSE",
    description:
      "Stores one 0.5 HP heal when a wave ends at full HP. Press E to use it when needed.",
  },
  medic_mender: {
    name: "STEADY MEND",
    description:
      "Can heal 0.5 HP once each wave after avoiding damage for 20 seconds.",
  },
  medic_halo: {
    name: "RADIANT PACE",
    description: "Can earn 15% more score while at full HP.",
  },
  tank_bulwark: {
    name: "HEAVY PLATE",
    description:
      "Takes 20% less damage from every source and reduces the first heavy hit of each wave by another 0.5 HP.",
  },
  tank_guard: {
    name: "GUARDED PACE",
    description: "Takes 30% less damage from every source and earns 10% less score.",
  },
  tank_ironclad: {
    name: "IRON SHELL",
    description: "Takes no log damage and takes 50% more damage from every other source.",
  },
  tank_warden: {
    name: "SPIKE LOCK",
    description: "Can reach 4 HP, takes 25% less damage, and can click or tap spikes to deactivate them.",
  },
  tank_citadel: {
    name: "FLAWLESS WALL",
    description: "Ignores 1–3 opening obstacles based on consecutive flawless waves.",
  },
  tank_colossus: {
    name: "COLOSSUS FRAME",
    description: "Can reach 10 HP, heals 2 HP only after flawless waves, and gains score, slowdown, and rock resistance from excess HP.",
  },
  tank_glacier: {
    name: "FROST ARMOR",
    description: "Can ignore snowflake freeze.",
  },
  tank_brace: {
    name: "SPIKE BRACE",
    description: "Takes no spike damage and takes 50% more damage from every other source.",
  },
  tank_hammer: {
    name: "DEMOLITION",
    description:
      "Takes 10% less damage. Press E to destroy the nearest non-rock in the current lane and its neighboring lanes.",
  },
  tank_anchor: {
    name: "GROUND HOOK",
    description: "Press E to lock lane movement and take 75% less damage for 5 seconds.",
  },
  tank_rampart: {
    name: "LASTING RAMPART",
    description: "Takes 20–50% less damage as exact HP falls from 2 to 0.5.",
  },
  tank_sentinel: {
    name: "ANALYZE",
    description: "Analyzes the run's highest-damage hazard each wave, ignores its first hit, then takes 75% less damage from it. E slows barrels for 15 seconds.",
  },
  tank_atlas: {
    name: "WORLD BEARER",
    description: "Can reach 7 HP and heal 1 HP each wave. Every obstacle hit shortens Sky Crush by 0.5 seconds, down to 1 second.",
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
    description: "Missing HP progressively raises speed and score, up to +40% speed and +30% score.",
  },
  tank_bastion: {
    name: "HOLD GROUND",
    description:
      "Gains 5% damage reduction per full second in one lane, up to one fully blocked hit after 20 seconds. Moving or being hit resets it.",
  },
  trickster_rogue: {
    name: "SHADOWSTEP",
    description:
      "Grazes charge a meter once every 5 seconds. Press E at 2, 5, or 10 charges for a shield, full clear, or 5-second shield.",
  },
  trickster_echo: {
    name: "THE MIRROR",
    description: "Completes sequential Mirror quests to earn shards and borrow passives; its final realm reflects damage and changes death rules.",
  },
  trickster_flicker: {
    name: "FATE FLICKER",
    description:
      "Press E once per wave to turn the closest hazard in every lane into a gem, Melon, or attack coin.",
  },
  trickster_switch: {
    name: "LANE COUNT",
    description:
      "At 50 lane changes gains 10% score; at 100, each change grants a delayed 0.25-second shield.",
  },
  trickster_gambit: {
    name: "COUNTING CARDS",
    description:
      "Draws five cards each wave and turns poker hands into temporary, permanent, healing, defense, and 1v1 rewards.",
  },
  trickster_jester: {
    name: "WILD ENCORE",
    description: "Rolls one positive, matched score-and-speed, or negative modifier at the start of every wave.",
  },
  trickster_mirage: {
    name: "MIRAGE INVASION",
    description:
      "Press E once per wave to invade for 5 seconds while invincible, then lose 1 HP on return.",
  },
  trickster_hex: {
    name: "VOID REALM",
    description:
      "Enters the Void on even waves to collect Damnation, unlock damage reduction and souls, and eventually challenge Hades.",
  },
  trickster_phantom: {
    name: "MOON PHASE",
    description: "Ignores the first hit of each hazard kind. Nights add 50% speed, double score, block two of each kind and snowflakes; Bloodmoons turn two red hazard kinds into +2 HP and snowflakes into +1 HP. LORDSDOWN grants 10 HP and death ascends into a 6-HP LORD with hit negation and Eviscerate.",
  },
  trickster_smoke: {
    name: "SMOKE BOMB",
    description:
      "Press E every 20 seconds to teleport to a currently safe lane.",
  },
  trickster_clockwork: {
    name: "CLOCKWORK SLOW",
    description:
      "Starts with hazards 10% slower and adds 0.5% slow each second, up to 60%.",
  },
  trickster_pickpocket: {
    name: "DOUBLE TAKE",
    description: "Doubles all score and gem income; in 1v1, E can steal 10% of rival attack coins once per wave.",
  },
  trickster_wildcard: {
    name: "LUCKY DRAW",
    description:
      "Can draw one wave-long bonus: 15% more score, 50% more gem spawns, or 15% slower hazards.",
  },
  misc_nomad: {
    name: "SURVIVAL INSTINCT",
    description: "A lethal hit has a 50% one-time chance to leave 0.5 HP and permanently slow hazards by 20%.",
  },
  misc_tinker: {
    name: "INSPIRATION",
    description: "Click each spike once for inspiration; at 3, press E to launch a handmade spike that destroys a projectile.",
  },
  misc_broker: {
    name: "MARKET FUNDS",
    description: "Stores gems, coins, and Melons in separate funds that move by 1–50% each wave with a 60% chance to rise.",
  },
  misc_prospector: {
    name: "GEM SURVEY",
    description: "Warns 5 seconds before each gem appears and highlights its future lane.",
  },
  misc_lantern: {
    name: "FLASH OF LIGHT",
    description: "Press E to freeze every hazard for 2 seconds.",
  },
  misc_scribe: {
    name: "HAZARD CAP",
    description: "At wave end, chooses one hazard to cap at at least 1 and otherwise wave divided by 10 spawns next wave.",
  },
  misc_weaver: {
    name: "THAWING JACKET",
    description: "After 5 snowflakes, press E for permanent freeze immunity; every second later snowflake heals 0.5 HP once per wave.",
  },
  misc_mimic: {
    name: "COPYCAT",
    description: "Copies a non-Mythic rival in 1v1; in Endless, selects two Rare-or-lower passives for the run.",
  },
  misc_catalyst: {
    name: "FLUX FIELD",
    description: "Far pickups move 50% slower and nearby pickups 50% faster. Press E to collect every pickup on screen.",
  },
  misc_harvester: {
    name: "HARVEST",
    description: "Every pickup fund unlocks its own E power at 10 collected and a much stronger version at 50.",
  },
  misc_muse: {
    name: "RHYTHM BREAK",
    description: "Caps the screen at 5 hazards and uses a one-time 30-second rhythm challenge to unlock lasting music, defense, score, healing, and revive tiers.",
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
  characterKey === "trickster_phantom"
    ? 3
    : characterKey === "medic_patch"
    ? 4
    : characterKey === "tank_atlas"
    ? 7
    : characterKey === "tank_colossus"
      ? 10
    : characterKey === "medic_beacon"
      ? 5.5
      : characterKey === "medic_suture" || characterKey === "tank_hammer"
          ? 5
          : characterClass === "tank"
            ? 4
            : characterClass === "trickster"
              ? 2
              : 3;
const getCharacterStartingHearts = (
  characterKey: string,
  characterClass: string,
) =>
  characterKey === "trickster_phantom"
    ? 3
    : characterClass === "tank"
      ? 4
      : characterClass === "trickster"
        ? 2
        : 3;
const PHANTOM_BLOODMOON_HAZARDS: readonly Kind[] = [
  "car",
  "log",
  "rock",
  "barrel",
  "spikes",
  "current",
];
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
const UNIQUE_WEAPON_EFFECTS: Partial<Record<CharacterKey, string>> = {
  runner_velocity: "+5% BASE SPEED · +10% RUNNING SCORE",
  runner_pacer: "+10 SCORE ON EVERY LANE CHANGE",
  medic_lifeline: "RESCUE HOOK · 3 TIME-STOP LANE ZIPS",
  medic_seraph: "10% GEM CHANCE · HEAL 1 HP",
  tank_atlas: "HALF DAMAGE FOR 2 SECONDS AFTER A LANE CHANGE",
  medic_revive: "AFTER A HIT · DESTROY THE FIRST OBSTACLE EACH WAVE",
  medic_oracle: "1ST HIT 0 DAMAGE · 2ND HIT HALF · THEN FULL",
  tank_brace: "+15% DISTANCE SCORE",
};
const getCharacterWeaponScoreBonus = (
  characterKey: CharacterKey,
  rarity: Rarity,
) =>
  characterKey === "runner_velocity"
    ? 0.1
    : characterKey === "tank_brace"
      ? 0.15
    : UNIQUE_WEAPON_EFFECTS[characterKey]
      ? 0
      : getWeaponScoreBonus(rarity);
const getCharacterWeaponLabel = (
  characterKey: CharacterKey,
  rarity: Rarity,
) => UNIQUE_WEAPON_EFFECTS[characterKey] ?? getWeaponScoreLabel(rarity);
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
const ATTACK_COIN_SPAWN_CHANCE = 0.27;
const MELON_BASE_SCORE = 200;
const WAVE_SPEED_STEP = 0.25;
const getWaveSpeedMultiplier = (waveNumber: number) =>
  1 + Math.max(0, waveNumber - 1) * WAVE_SPEED_STEP;
const MIN_ATTACK_DODGE_WINDOW_MS = 300;
const MAX_FORMATION_CHARACTER_SPEED_MULTIPLIER = 1.5;
const getAttackGroupSpacing = (waveNumber: number) =>
  Math.max(
    22,
    Math.ceil(
      BASE_ITEM_SPEED *
        getWaveSpeedMultiplier(waveNumber) *
        MAX_FORMATION_CHARACTER_SPEED_MULTIPLIER *
        MIN_ATTACK_DODGE_WINDOW_MS,
    ),
  );
const GAME_MODE_RULES = {
  normal: { scoreMultiplier: 1, hazardLaneLimit: MAX_HAZARD_LANES },
  hardcore: { scoreMultiplier: 1.75, hazardLaneLimit: 3 },
  impossible: { scoreMultiplier: 3, hazardLaneLimit: MAX_HAZARD_LANES },
} as const satisfies Record<
  GameMode,
  { scoreMultiplier: number; hazardLaneLimit: number }
>;
const RANKED_UNLOCK_LEVEL = 20;
const LEVEL_XP_BASE = 5_000_000;
const getCumulativeXpForLevel = (level: number) => {
  const normalizedLevel = Math.max(0, Math.floor(level));
  return LEVEL_XP_BASE * normalizedLevel * (normalizedLevel + 1);
};
const createEmptyPlayerProgression = (): PlayerProgression => ({
  level: 0,
  xp: 0,
  xp_required: getCumulativeXpForLevel(1),
  lifetime_xp: 0,
  completed_runs: 0,
  ranked_unlocked: false,
});
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
const EXTRACTION_UNIT_COST = 3;
const EXTRACTION_MAX_QUANTITY = 100;
const DIRECT_UNLOCK_COSTS: Readonly<Record<Rarity, number>> = {
  common: 5,
  uncommon: 10,
  rare: 15,
  epic: 25,
  legendary: 175,
  mythic: 2000,
};
const DUPLICATE_REFUNDS: Readonly<Record<Rarity, number>> = {
  common: 1,
  uncommon: 1,
  rare: 1,
  epic: 1,
  legendary: 2,
  mythic: 3,
};
const EXTRACTION_BOXES = {
  regular: {
    name: "NORMAL BOX",
    cost: EXTRACTION_UNIT_COST,
    pullCount: 1,
    icon: "◇",
    mix: "5% CHARACTER + WEAPON · 95% COSMETIC",
    oddsLabel: "NORMAL PULL ODDS",
    note:
      "DUPLICATES REFUND BY RARITY · EVERY 10TH ITEM IN ONE MULTI-OPEN USES THE 10× BONUS ODDS",
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
    note: "DUPLICATES REFUND BY RARITY · THE 10TH PULL IS NOT GUARANTEED NEW",
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
  if (kind === "melon") return <span aria-hidden="true">🍉</span>;
  if (kind === "mushroom") return <span aria-hidden="true">🍄</span>;
  if (kind === "current") return <span aria-hidden="true">≈</span>;

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
    [directPurchaseKey, setDirectPurchaseKey] = useState(""),
    [directPurchaseBusy, setDirectPurchaseBusy] = useState(false),
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
    [sfxVolume, setSfxVolume] = useState(0.7),
    [runCharacterOverride, setRunCharacterOverride] = useState<CharacterKey | null>(null),
    [abilityChoice, setAbilityChoice] = useState<AbilityChoice>(null),
    [abilityStateVersion, setAbilityStateVersion] = useState(0),
    [tonicIngredients, setTonicIngredients] = useState(0),
    [tonicPotion, setTonicPotion] = useState<0 | 1 | 2 | 3>(0),
    [oracleProphecies, setOracleProphecies] = useState<OracleProphecy[]>([]),
    [oracleCompleted, setOracleCompleted] = useState(0),
    [pulseGame, setPulseGame] = useState<PulseGameState | null>(null),
    [waveForecast, setWaveForecast] = useState<string[]>([]),
    [waveForecastCollapsed, setWaveForecastCollapsed] = useState(false),
    [deferredAttackGroups, setDeferredAttackGroups] = useState<Item[][]>([]),
    [velocityDisplayPercent, setVelocityDisplayPercent] = useState(0),
    [phantomHealthCap, setPhantomHealthCap] = useState(3),
    [phantomLord, setPhantomLord] = useState(false);
  const id = useRef(0),
    last = useRef(0),
    itemsSnapshotRef = useRef<Item[]>(items),
    deferredAttackGroupsRef = useRef<Item[][]>(deferredAttackGroups),
    userIdRef = useRef<string | null>(null),
    gemsRef = useRef(0),
    gemStreakRef = useRef(0),
    gemStreakResetPendingRef = useRef(false),
    gemClaimQueueRef = useRef<Promise<void>>(Promise.resolve()),
    scoreRef = useRef(0),
    waveRef = useRef(1),
    highScoreRef = useRef(0),
    scoreCarryRef = useRef(0),
    currentCoinMultiplierRef = useRef(1),
    pacerRushRemainingRef = useRef(0),
    pacerRevivalUsedRef = useRef(false),
    courierBoostRemainingRef = useRef(0),
    dashBoostRemainingRef = useRef(0),
    dashCooldownRemainingRef = useRef(0),
    blitzBoostRemainingRef = useRef(0),
    blitzCooldownRemainingRef = useRef(0),
    strideMoveCountRef = useRef(0),
    vectorBlockWaveRef = useRef(0),
    haloPartsRef = useRef(0),
    relayChargesRef = useRef(0),
    velocityChargeMsRef = useRef(0),
    velocityMilestoneRef = useRef(0),
    velocityDisplayPercentRef = useRef(0),
    waveSpawnPlanRef = useRef<{
      wave: number;
      kinds: Kind[];
      cursor: number;
    } | null>(null),
    timeStopUsedRef = useRef(false),
    timeStopRemainingRef = useRef(0),
    timeStopDeadlineRef = useRef(0),
    permanentObstacleSlowRef = useRef(1),
    collisionWaveRef = useRef(0),
    damageTakenWaveRef = useRef(0),
    driftBoostRemainingRef = useRef(0),
    driftLastMoveAtRef = useRef(0),
    driftStackPercentRef = useRef(0),
    sparkBoostRemainingRef = useRef(0),
    sparkGemCountRef = useRef(0),
    fortuneGemCountRef = useRef(0),
    flareDamageWaveRef = useRef(0),
    flareBoostWaveRef = useRef(0),
    orbitCooldownRemainingRef = useRef(0),
    cometChargeRemainingRef = useRef(8000),
    cometChargedRef = useRef(false),
    invincibleUntilRef = useRef(0),
    invincibilityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null),
    abilityNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null),
    waveAnnouncementTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
      null,
    ),
    rogueGrazeCooldownUntilRef = useRef(0),
    rogueGrazeMeterRef = useRef(0),
    rogueGrazedItemIdsRef = useRef<Set<number>>(new Set()),
    bloomGemWaveRef = useRef(0),
    sproutSeedWaveRef = useRef(0),
    remedySnowflakeWaveRef = useRef(0),
    reserveHealStoredRef = useRef(false),
    beaconActiveRef = useRef(false),
    menderChargeRemainingRef = useRef(20000),
    menderHealedWaveRef = useRef(0),
    lifelineUsedRef = useRef(false),
    lifelineHookUsesRef = useRef(0),
    lifelineImmuneKindsRef = useRef<Set<Kind>>(new Set()),
    seraphTeleportChanceRef = useRef(100),
    atlasLaneElapsedRef = useRef(0),
    atlasLaneLimitRef = useRef(5000),
    lastLaneChangeAtRef = useRef(0),
    reviveUsedRef = useRef(false),
    reviveFlyingRef = useRef(false),
    phoenixFeatherActiveRef = useRef(false),
    phoenixFeatherReadyWaveRef = useRef(0),
    pulseUsedRef = useRef(false),
    oracleHitCountRef = useRef(0),
    oracleInvincibleWaveRef = useRef(0),
    oracleShieldWaveRef = useRef(0),
    oracleBorrowedAbilitiesRef = useRef<Set<CharacterKey>>(new Set()),
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
    mercyChainActiveRef = useRef(true),
    hammerBreakWaveRef = useRef(0),
    wardenBlockWaveRef = useRef(0),
    citadelBlockWaveRef = useRef(0),
    bastionChargeRemainingRef = useRef(6000),
    bastionArmorChargedRef = useRef(false),
    citadelFlawlessStreakRef = useRef(0),
    citadelBlocksRemainingRef = useRef(1),
    sentinelDamageByKindRef = useRef<Partial<Record<Kind, number>>>({}),
    sentinelAnalyzedKindRef = useRef<Kind | null>(null),
    sentinelAnalyzedBlockWaveRef = useRef(0),
    sentinelBarrelSlowUntilRef = useRef(0),
    sentinelActionWaveRef = useRef(0),
    anchorGuardUntilRef = useRef(0),
    anchorLaneLockedRef = useRef(false),
    jesterEffectRef = useRef<{
      kind: "first-zero" | "half" | "barrel-zero" | "neutral" | "first-double" | "more" | "barrel-double";
      percent: number;
      firstUsed: boolean;
    }>({ kind: "first-zero", percent: 0, firstUsed: false }),
    sentinelLastStandUsedRef = useRef(false),
    phantomPhaseWaveRef = useRef(0),
    phantomKindHitsRef = useRef<Partial<Record<Kind, number>>>({}),
    phantomBloodmoonKindsRef = useRef<Set<Kind>>(new Set()),
    phantomHealthCapRef = useRef(3),
    phantomLordRef = useRef(false),
    phantomLordNegationStreakRef = useRef(0),
    smokeSlowRemainingRef = useRef(0),
    smokeCooldownUntilRef = useRef(0),
    clockworkMoveCountRef = useRef(0),
    clockworkSlowRemainingRef = useRef(0),
    clockworkCooldownRemainingRef = useRef(0),
    clockworkElapsedMsRef = useRef(0),
    pickpocketPassedCountRef = useRef(0),
    pickpocketUsedWaveRef = useRef(0),
    switchLaneChangesRef = useRef(0),
    flickerUsedWaveRef = useRef(0),
    flareLaneRef = useRef<number | null>(null),
    flareActiveUntilRef = useRef(0),
    flareCooldownUntilRef = useRef(0),
    flareBurnCountRef = useRef(0),
    vialAllegianceUntilRef = useRef(0),
    vialUsedRef = useRef(false),
    mirageUsedWaveRef = useRef(0),
    obstacleFreezeUntilRef = useRef(0),
    lanternCooldownUntilRef = useRef(0),
    scoutInputWindowUntilRef = useRef(0),
    scoutSnowflakeHealReadyRef = useRef(false),
    scoutCooldownUntilRef = useRef(0),
    dragChainRef = useRef<{ wave: number; lane: number } | null>(null),
    nomadSurvivalUsedRef = useRef(false),
    tinkerInspirationRef = useRef(0),
    tinkerClickedSpikeIdsRef = useRef<Set<number>>(new Set()),
    rangerCooldownUntilRef = useRef(0),
    brokerFundsRef = useRef({ gems: 0, coins: 0, melons: 0 }),
    prospectorNoticeWaveRef = useRef(0),
    weaverSnowflakeCountRef = useRef(0),
    weaverJacketRef = useRef(false),
    weaverHealWaveRef = useRef(0),
    weaverHealedAmountRef = useRef(0),
    harvesterCountsRef = useRef({ gems: 0, coins: 0, melons: 0 }),
    harvesterCooldownUntilRef = useRef(0),
    wildcardBuffRef = useRef<"score" | "gems" | "slow" | null>(null),
    ambientHazardStreakRef = useRef<{ kind: Kind | null; count: number }>({
      kind: null,
      count: 0,
    }),
    versusMatchRef = useRef<string | null>(null),
    versusMapRef = useRef<MapId>("classic"),
    versusSearchingRef = useRef(false),
    versusSearchTokenRef = useRef(0),
    versusPollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null),
    versusAttackBusyRef = useRef(false),
    realtimeRef = useRef<ReturnType<typeof supabase.channel> | null>(null),
    incomingAttacksRef = useRef<PendingVersusAttack[]>([]),
    spawnedAttackIdsRef = useRef<Set<string>>(new Set()),
    queuedAttackTokenIdsRef = useRef<Set<string>>(new Set()),
    processedPickupIdsRef = useRef<Set<number>>(new Set()),
    pendingVersusCoinPickupIdsRef = useRef<Set<string>>(new Set()),
    versusPickupNonceRef = useRef(createVersusPickupNonce()),
    versusFinishedRef = useRef(false),
    versusSelfEliminatedRef = useRef(false),
    pitchKatanaRef = useRef<PitchKatanaState>(createPitchKatanaState()),
    pitchKatanaArmingRef = useRef(false),
    pendingKatanaReflectionIdsRef = useRef<Set<number>>(new Set()),
    pitchKatanaTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null),
    volcanoStationaryMsRef = useRef(0),
    factoryConveyorRef = useRef<FactoryConveyorState>(
      createFactoryConveyorState(),
    ),
    versusPointsRef = useRef(0),
    versusCoinSyncBusyRef = useRef(false),
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
    progressionRunIdRef = useRef<string | null>(null),
    progressionAwardedRunIdRef = useRef<string | null>(null),
    progressionResetIntentRef = useRef(0),
    progressionStartIntentRef = useRef(0),
    progressionStartPromiseRef = useRef<{
      intent: number;
      promise: Promise<string | null>;
    } | null>(null),
    progressionHeartbeatQueueRef = useRef<Promise<void>>(Promise.resolve()),
    progressionAwardPromiseRef = useRef<Promise<void> | null>(null),
    progressionOwnerUserIdRef = useRef<string | null>(null),
    extractBusyRef = useRef(false),
    extractFeedbackRef = useRef<HTMLDivElement | null>(null),
    botAttackPointsRef = useRef(0),
    botScoreRef = useRef(0),
    botScoreCarryRef = useRef(0),
    practiceBotMaxHeartsRef = useRef(BOT_MAX_HEARTS),
    practiceBotNextWaveHeartsRef = useRef<number | null>(null),
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
  itemsSnapshotRef.current = items;
  deferredAttackGroupsRef.current = deferredAttackGroups;
  gemsRef.current = gems;
  scoreRef.current = score;
  waveRef.current = wave;
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
      if (pitchKatanaTimerRef.current)
        clearTimeout(pitchKatanaTimerRef.current);
      versusSearchingRef.current = false;
      versusSearchTokenRef.current += 1;
      if (versusPollTimerRef.current)
        clearTimeout(versusPollTimerRef.current);
      if (realtimeRef.current) void supabase.removeChannel(realtimeRef.current);
    },
    [],
  );
  const enqueueDeferredAttackItems = useCallback((attackItems: Item[]) => {
    const unseenItems = attackItems.filter(
      (item) =>
        !item.attackToken ||
        (!spawnedAttackIdsRef.current.has(item.attackToken) &&
          !queuedAttackTokenIdsRef.current.has(item.attackToken)),
    );
    const groups = splitLaneUniqueAttackGroups(unseenItems);
    if (groups.length === 0) return;
    groups.forEach((group) =>
      group.forEach((item) => {
        if (item.attackToken)
          queuedAttackTokenIdsRef.current.add(item.attackToken);
      }),
    );
    const nextGroups = [...deferredAttackGroupsRef.current, ...groups];
    deferredAttackGroupsRef.current = nextGroups;
    setDeferredAttackGroups(nextGroups);
  }, []);
  useEffect(() => {
    const group = deferredAttackGroups[0];
    if (!group) return;
    const groupIds = new Set(group.map((item) => item.id));
    const inserted = group.every((candidate) =>
      items.some((item) => item.id === candidate.id),
    );
    if (inserted) {
      group.forEach((item) => {
        if (!item.attackToken) return;
        queuedAttackTokenIdsRef.current.delete(item.attackToken);
        spawnedAttackIdsRef.current.add(item.attackToken);
      });
      const remainingGroups = deferredAttackGroups.slice(1);
      deferredAttackGroupsRef.current = remainingGroups;
      setDeferredAttackGroups(remainingGroups);
      return;
    }
    const occupiedLanes = new Set(items.map((item) => item.lane));
    if (group.some((item) => occupiedLanes.has(item.lane))) return;
    setItems((current) => {
      if (current.some((item) => groupIds.has(item.id))) return current;
      const currentOccupiedLanes = new Set(current.map((item) => item.lane));
      if (group.some((item) => currentOccupiedLanes.has(item.lane)))
        return current;
      return [...current, ...group];
    });
  }, [deferredAttackGroups, items]);
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
    [adminOpen, setAdminOpen] = useState(false),
    [isAdmin, setIsAdmin] = useState(false),
    [adminRole, setAdminRole] = useState<string | null>(null),
    [adminTab, setAdminTab] = useState<
      "reports" | "admins" | "players" | "appeals"
    >("reports"),
    [admins, setAdmins] = useState<AdminUser[]>([]),
    [adminTarget, setAdminTarget] = useState(""),
    [adminStatus, setAdminStatus] = useState(""),
    [reports, setReports] = useState<PlayerReport[]>([]),
    [copyStatus, setCopyStatus] = useState(""),
    [reportType, setReportType] = useState("Bug"),
    [reportMessage, setReportMessage] = useState(""),
    [reportStatus, setReportStatus] = useState(""),
    [reportBusy, setReportBusy] = useState(false);
  const [myBanAppeal, setMyBanAppeal] = useState<MyBanAppeal | null>(null),
    [appealNote, setAppealNote] = useState(""),
    [appealStatus, setAppealStatus] = useState(""),
    [appealBusy, setAppealBusy] = useState(false),
    [adminAppeals, setAdminAppeals] = useState<BanAppeal[]>([]),
    [appealFilter, setAppealFilter] = useState<
      "pending" | "approved" | "denied" | "all"
    >("pending"),
    [adminAppealStatus, setAdminAppealStatus] = useState(""),
    [adminAppealBusyId, setAdminAppealBusyId] = useState<number | null>(null),
    [adminAppealNotes, setAdminAppealNotes] = useState<Record<number, string>>(
      {},
    );
  const [username, setUsername] = useState(""),
    [usernameInput, setUsernameInput] = useState(""),
    [usernameRequired, setUsernameRequired] = useState(false),
    [usernameStatus, setUsernameStatus] = useState(""),
    [newPassword, setNewPassword] = useState(""),
    [passwordStatus, setPasswordStatus] = useState("");
  const [editUsername, setEditUsername] = useState(false),
    [editPassword, setEditPassword] = useState(false);
  const [playerProgression, setPlayerProgression] =
      useState<PlayerProgression>(createEmptyPlayerProgression),
    [progressionRunVersion, setProgressionRunVersion] = useState(0),
    [lastRunXpBreakdown, setLastRunXpBreakdown] =
      useState<RunXpBreakdown | null>(null);
  const [endlessMode, setEndlessMode] = useState<GameMode>("normal");
  const [mainView, setMainView] = useState<MainView>("endless"),
    [playScope, setPlayScope] = useState<PlayScope>("single"),
    [versusMode, setVersusMode] = useState<VersusMode>("casual"),
    [versusMap, setVersusMap] = useState<MapId>("classic"),
    [practiceMapChoice, setPracticeMapChoice] = useState<MapId | "random">(
      "random",
    ),
    [mapPriority, setMapPriority] = useState<MapId[]>([
      ...DEFAULT_MAP_PRIORITY,
    ]),
    [mapPriorityConfigured, setMapPriorityConfigured] = useState(false),
    [mapPriorityBusy, setMapPriorityBusy] = useState(false),
    [mapPriorityStatus, setMapPriorityStatus] = useState(""),
    [versusPhase, setVersusPhase] = useState<VersusPhase>("idle"),
    [versusOpponent, setVersusOpponent] = useState("WAITING…"),
    [versusPoints, setVersusPoints] = useState(0),
    [versusCountdown, setVersusCountdown] = useState(
      VERSUS_INTERMISSION_SECONDS,
    ),
    [versusOpponentHearts, setVersusOpponentHearts] = useState(3),
    [versusOpponentScore, setVersusOpponentScore] = useState(0),
    [versusSelfMushrooms, setVersusSelfMushrooms] = useState(0),
    [versusOpponentMushrooms, setVersusOpponentMushrooms] = useState(0),
    [versusSelfEliminated, setVersusSelfEliminated] = useState(false),
    [pitchKatanaVersion, setPitchKatanaVersion] = useState(0),
    [factoryConveyor, setFactoryConveyor] = useState<FactoryConveyorState>(
      factoryConveyorRef.current,
    ),
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
  versusMapRef.current = versusMap;
  versusSelfEliminatedRef.current = versusSelfEliminated;
  const applyProgressionPayload = useCallback(
    (value: unknown, requestUserId: string) => {
      if (userIdRef.current !== requestUserId) return;
      if (!value || typeof value !== "object") return;
      const payload = value as Partial<PlayerProgression>;
      const level = Math.max(0, Math.floor(Number(payload.level) || 0));
      const xp = Math.max(0, Math.floor(Number(payload.xp) || 0));
      const levelXpRequired =
        getCumulativeXpForLevel(level + 1) -
        getCumulativeXpForLevel(level);
      const xpRequired = Math.max(
        1,
        Math.floor(Number(payload.xp_required) || levelXpRequired),
      );
      const nextProgression: PlayerProgression = {
        level,
        xp: Math.min(xp, xpRequired - 1),
        xp_required: xpRequired,
        lifetime_xp: Math.max(
          0,
          Math.floor(Number(payload.lifetime_xp) || 0),
        ),
        completed_runs: Math.max(
          0,
          Math.floor(Number(payload.completed_runs) || 0),
        ),
        ranked_unlocked:
          payload.ranked_unlocked === true || level >= RANKED_UNLOCK_LEVEL,
        xp_awarded:
          payload.xp_awarded === undefined
            ? undefined
            : Math.max(0, Math.floor(Number(payload.xp_awarded) || 0)),
      };
      // Gem and coin saves can finish in a different order. Never let an older
      // response visually roll a signed-in player's level or XP backwards.
      setPlayerProgression((current) => {
        if (userIdRef.current !== requestUserId) return current;
        const belongsToCurrentAccount =
          progressionOwnerUserIdRef.current === requestUserId;
        if (
          belongsToCurrentAccount &&
          nextProgression.lifetime_xp < current.lifetime_xp
        )
          return current;
        progressionOwnerUserIdRef.current = requestUserId;
        return nextProgression;
      });
    },
    [],
  );
  const refreshProgression = useCallback(async (expectedUserId?: string) => {
    const requestUserId = expectedUserId ?? userIdRef.current;
    if (!requestUserId || userIdRef.current !== requestUserId) return;
    const { data, error } = await supabase.rpc("get_player_progression");
    if (userIdRef.current !== requestUserId) return;
    if (error) {
      console.error("Could not load player progression:", error.message);
      return;
    }
    applyProgressionPayload(data, requestUserId);
  }, [applyProgressionPayload]);
  const startProgressionRun = useCallback(async function requestRunStart(): Promise<
    string | null
  > {
    const inFlight = progressionStartPromiseRef.current;
    if (inFlight) {
      if (inFlight.intent === progressionStartIntentRef.current)
        return inFlight.promise;
      await inFlight.promise;
      if (progressionStartPromiseRef.current === inFlight)
        progressionStartPromiseRef.current = null;
      return requestRunStart();
    }
    const intent = progressionStartIntentRef.current + 1;
    progressionStartIntentRef.current = intent;
    const pending = (async () => {
      progressionRunIdRef.current = null;
      progressionAwardedRunIdRef.current = null;
      const requestUserId = userIdRef.current;
      if (!requestUserId) return null;
      const { data, error } = await supabase.rpc("start_progression_run");
      if (
        intent !== progressionStartIntentRef.current ||
        userIdRef.current !== requestUserId
      )
        return null;
      if (error || typeof data !== "string") {
        console.error(
          "Could not start account XP run:",
          error?.message ?? "invalid run receipt",
        );
        return null;
      }
      progressionRunIdRef.current = data;
      setProgressionRunVersion((value) => value + 1);
      return data;
    })();
    const attempt = { intent, promise: pending };
    progressionStartPromiseRef.current = attempt;
    void pending.finally(() => {
      if (progressionStartPromiseRef.current === attempt)
        progressionStartPromiseRef.current = null;
    });
    return pending;
  }, []);
  const cancelPendingProgressionStart = useCallback(() => {
    progressionResetIntentRef.current += 1;
    if (!progressionStartPromiseRef.current) return;
    progressionStartIntentRef.current += 1;
    progressionRunIdRef.current = null;
    progressionAwardedRunIdRef.current = null;
  }, []);
  useEffect(() => {
    const runId = progressionRunIdRef.current;
    if (
      !runId ||
      !running ||
      paused ||
      wavePause ||
      guest ||
      playScope === "practice"
    )
      return;
    let active = true;
    const syncHeartbeat = (isActive: boolean) => {
      const task = async () => {
        const rpcName =
          playScope === "versus"
            ? "sync_1v1_progression"
            : "sync_progression_run";
        const identifiers =
          playScope === "versus"
            ? { p_match_id: runId }
            : { p_run_id: runId };
        return supabase.rpc(rpcName, {
          ...identifiers,
          p_wave: waveRef.current,
          p_active: isActive,
        });
      };
      const queued = progressionHeartbeatQueueRef.current.then(task, task);
      progressionHeartbeatQueueRef.current = queued.then(
        () => undefined,
        () => undefined,
      );
      return queued;
    };
    const sendHeartbeat = async () => {
      if (
        !active ||
        progressionRunIdRef.current !== runId ||
        document.visibilityState !== "visible"
      )
        return;
      const { error } = await syncHeartbeat(true);
      if (
        error &&
        !/schema cache|sync_(?:1v1_)?progression|pgrst202/i.test(error.message)
      )
        console.error("Could not sync active run time:", error.message);
    };
    void sendHeartbeat();
    const timer = setInterval(() => void sendHeartbeat(), 5000);
    const syncVisibility = () => {
      if (document.visibilityState === "visible") void sendHeartbeat();
      else void syncHeartbeat(false);
    };
    document.addEventListener("visibilitychange", syncVisibility);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", syncVisibility);
      void syncHeartbeat(false);
    };
  }, [
    guest,
    paused,
    playScope,
    progressionRunVersion,
    running,
    wavePause,
  ]);
  const applyAuthoritativeVersusPoints = useCallback((value: unknown) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    const points = Math.max(0, parsed);
    versusPointsRef.current = points;
    setVersusPoints(points);
  }, []);
  const loadMapPriority = useCallback(async () => {
    const requestUserId = userIdRef.current;
    if (!requestUserId) return;
    setMapPriorityBusy(true);
    setMapPriorityStatus("");
    const { data, error } = await supabase.rpc("get_1v1_map_priorities");
    if (userIdRef.current !== requestUserId) return;
    setMapPriorityBusy(false);
    if (error) {
      setMapPriorityStatus("MAP PRIORITY DATABASE SETUP IS MISSING");
      return;
    }
    const payload = (data ?? {}) as MapPriorityPayload;
    const order = (payload.map_order ?? []).filter(isMapId);
    if (order.length === MAP_IDS.length && new Set(order).size === MAP_IDS.length)
      setMapPriority(order);
    else setMapPriority([...DEFAULT_MAP_PRIORITY]);
    setMapPriorityConfigured(payload.configured === true);
  }, []);
  const saveMapPriority = useCallback(async () => {
    if (!userIdRef.current || mapPriorityBusy) return;
    setMapPriorityBusy(true);
    setMapPriorityStatus("SAVING PRIORITY LIST…");
    const { data, error } = await supabase.rpc("set_1v1_map_priorities", {
      p_map_order: mapPriority,
    });
    setMapPriorityBusy(false);
    if (error) {
      setMapPriorityStatus(error.message);
      return;
    }
    const payload = (data ?? {}) as MapPriorityPayload;
    const order = (payload.map_order ?? mapPriority).filter(isMapId);
    if (order.length === MAP_IDS.length) setMapPriority(order);
    setMapPriorityConfigured(true);
    setMapPriorityStatus("PRIORITY LIST SAVED");
  }, [mapPriority, mapPriorityBusy]);
  const moveMapPriority = useCallback((index: number, direction: -1 | 1) => {
    const destination = index + direction;
    if (destination < 0 || destination >= MAP_IDS.length) return;
    setMapPriority((current) => {
      const next = [...current];
      [next[index], next[destination]] = [next[destination], next[index]];
      return next;
    });
    setMapPriorityConfigured(false);
    setMapPriorityStatus("UNSAVED CHANGES");
  }, []);
  useEffect(() => {
    if (mainView === "versus" && userEmail && !guest)
      void loadMapPriority();
  }, [guest, loadMapPriority, mainView, userEmail]);
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
    pendingVersusCoinPickupIdsRef.current.clear();
    versusCoinSyncBusyRef.current = false;
    pendingKatanaReflectionIdsRef.current.clear();
    versusPickupNonceRef.current = createVersusPickupNonce();
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
  const queueOnlineCoinAward = useCallback(
    (matchId: string, pickupId: number) => {
      if (!userIdRef.current || versusMatchRef.current !== matchId) return;
      const pickupClaimId = `coin:${versusPickupNonceRef.current}:${pickupId}`;
      if (pendingVersusCoinPickupIdsRef.current.has(pickupClaimId)) return;
      pendingVersusCoinPickupIdsRef.current.add(pickupClaimId);

      // Coins are collected instantly for responsive play, but their receipts
      // are intentionally sent to Supabase only after this wave enters its
      // intermission. The server replaces this preview with the exact balance.
      const previewAward =
        getAttackPointsForCoin(versusMapRef.current) *
        currentCoinMultiplierRef.current;
      versusPointsRef.current += previewAward;
      setVersusPoints(versusPointsRef.current);
    },
    [],
  );
  const syncIntermissionCoinClaims = useCallback(
    async (matchId: string) => {
      const requestUserId = userIdRef.current;
      const pickupIds = Array.from(pendingVersusCoinPickupIdsRef.current);
      if (!requestUserId || pickupIds.length === 0) return true;
      try {
        const { data, error } = await supabase.rpc(
          "sync_1v1_intermission_coins",
          { p_match_id: matchId, p_pickup_ids: pickupIds },
        );
        if (
          userIdRef.current !== requestUserId ||
          versusMatchRef.current !== matchId
        )
          return false;
        if (error) {
          if (isCoinSetupError(error.message))
            setVersusResult("1V1 COIN DATABASE SETUP IS MISSING");
          return false;
        }
        pickupIds.forEach((pickupId) =>
          pendingVersusCoinPickupIdsRef.current.delete(pickupId),
        );
        applyAuthoritativeVersusPoints(data?.obstacle_points);
        void refreshProgression(requestUserId);
        return true;
      } catch {
        return false;
      }
    },
    [applyAuthoritativeVersusPoints, refreshProgression],
  );
  const isOnlineVersus = playScope === "versus";
  const isBotPractice = playScope === "practice";
  const isVersusRun = playScope !== "single";
  const mode: GameMode = mainView === "versus" ? "normal" : endlessMode;
  const modeRules = GAME_MODE_RULES[mode];
  const activeMapId: MapId = isVersusRun ? versusMap : "classic";
  const activeMapRules = getMapRules(activeMapId);
  const activeLaneCount = activeMapRules.laneCount;
  const activeCenterLane = Math.floor(activeLaneCount / 2);
  const healingEnabled = activeMapRules.health.healingMultiplier > 0;
  const [selectedCharacter, setSelectedCharacter] = useState("runner_ace"),
    [inventoryCharacter, setInventoryCharacter] = useState<{
      classKey: keyof typeof CLASS_CHARACTERS;
      characterKey: string;
    }>({ classKey: "runner", characterKey: "runner_ace" }),
    [playerCosmetic, setPlayerCosmetic] = useState(""),
    [obstacleCosmetic, setObstacleCosmetic] = useState(""),
    [environmentCosmetic, setEnvironmentCosmetic] = useState(""),
    [unlocks, setUnlocks] = useState<Unlock[]>([]),
    [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]),
    [extractResults, setExtractResults] = useState<ExtractionResult[]>([]);
  // Treat the four included starter kits as the only client-side defaults.
  // Every other character must have a matching account unlock before it can
  // affect gameplay, even if stale loadout or multiplayer state names it.
  const selectedCharacterOwned = isCharacterOwned(unlocks, selectedCharacter);
  const availableCharacter = selectedCharacterOwned
    ? selectedCharacter
    : "runner_ace";
  const availableClass = getCharacterClassKey(availableCharacter);
  const classBlockedByGameMode =
    mode === "impossible" ||
    (mode === "hardcore" &&
      (availableClass === "medic" || availableClass === "tank"));
  const classBlockedByMap =
    isVersusRun &&
    !isCharacterClassAllowed(activeMapId, availableClass);
  const forcedMapCharacter = isVersusRun
    ? activeMapRules.forcedCharacterId
    : null;
  const equippedCharacter =
    mode === "impossible" || classBlockedByGameMode || classBlockedByMap
      ? "runner_ace"
      : forcedMapCharacter ?? availableCharacter;
  const activeCharacter = (runCharacterOverride ?? equippedCharacter) as CharacterKey;
  const activeClass = getCharacterClassKey(activeCharacter);
  const hasCharacterAbility = useCallback((characterKey: CharacterKey) => {
    if (activeCharacter === characterKey) return true;
    if (
      activeCharacter === "medic_oracle" &&
      oracleBorrowedAbilitiesRef.current.has(characterKey)
    )
      return true;
    if (activeCharacter !== "runner_zenith") return false;
    const unlockWave: Partial<Record<CharacterKey, number>> = {
      runner_orbit: 5,
      medic_halo: 7,
      runner_horizon: 9,
      runner_relay: 10,
      tank_glacier: 12,
      runner_ace: 12,
      runner_dash: 12,
      runner_stride: 12,
    };
    const requiredWave = unlockWave[characterKey];
    return requiredWave !== undefined && wave >= requiredWave;
  }, [activeCharacter, wave]);
  const baseStartingHearts = getCharacterStartingHearts(
    activeCharacter,
    activeClass,
  );
  const baseCharacterMaxHearts = getCharacterMaxHearts(
    activeCharacter,
    activeClass,
  );
  const mapHealth = isVersusRun
    ? applyMapHealthModifiers(
        activeMapId,
        baseStartingHearts,
        baseCharacterMaxHearts,
      )
    : { startingHp: baseStartingHearts, maxHp: baseCharacterMaxHearts };
  const startingHearts =
    mode === "impossible" || mode === "hardcore"
      ? 1
      : mapHealth.startingHp;
  const localMaxHearts =
    mode === "impossible" || mode === "hardcore"
      ? 1
      : mapHealth.maxHp;
  const maxHearts =
    activeCharacter === "trickster_phantom"
      ? phantomHealthCap
      : isOnlineVersus && versusServerMaxHearts !== null
      ? versusServerMaxHearts
      : localMaxHearts;
  const phantomNightActive =
    activeCharacter === "trickster_phantom" &&
    !phantomLord &&
    wave % 2 === 0;
  const phantomBloodmoonActive =
    activeCharacter === "trickster_phantom" && wave % 5 === 0;
  const phantomLordsdownActive =
    activeCharacter === "trickster_phantom" &&
    !phantomLord &&
    wave % 10 === 0;
  const modeMultiplier = modeRules.scoreMultiplier;
  const classScoreMultiplier =
    activeClass === "trickster" && mode === "normal" ? 1.15 : 1;
  const activeAbility =
    CHARACTER_ABILITIES[activeCharacter as CharacterKey] ??
    CHARACTER_ABILITIES.runner_ace;
  const activeCharacterDefinition = getCharacterDefinition(activeCharacter);
  const activeWeaponScoreBonus = getCharacterWeaponScoreBonus(
    activeCharacter as CharacterKey,
    activeCharacterDefinition.rarity,
  );
  const activeWeaponLabel = getCharacterWeaponLabel(
    activeCharacter as CharacterKey,
    activeCharacterDefinition.rarity,
  );
  const activeWeaponScoreMultiplier = 1 + activeWeaponScoreBonus;
  useEffect(() => {
    const awardUserId = userIdRef.current;
    if (
      !over ||
      guest ||
      !awardUserId ||
      playScope !== "single" ||
      !progressionRunIdRef.current ||
      progressionAwardedRunIdRef.current === progressionRunIdRef.current
    )
      return;

    const runId = progressionRunIdRef.current;
    progressionAwardedRunIdRef.current = runId;
    const awardRun = async () => {
      await gemClaimQueueRef.current.catch(() => undefined);
      if (
        userIdRef.current !== awardUserId ||
        progressionRunIdRef.current !== runId
      )
        return;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (userIdRef.current !== awardUserId) return;
        const scope = "endless";
        await supabase.rpc("sync_progression_run", {
          p_run_id: runId,
          p_wave: waveRef.current,
          p_active: false,
        });
        if (userIdRef.current !== awardUserId) return;
        let result = await supabase.rpc("award_completed_run_v2", {
          p_run_id: runId,
          p_score: Math.max(0, Math.floor(scoreRef.current)),
          p_scope: scope,
        });
        if (
          result.error &&
          /award_completed_run_v2|schema cache|pgrst202/i.test(
            result.error.message,
          )
        ) {
          result = await supabase.rpc("award_completed_run", {
            p_run_id: runId,
            p_score: Math.max(0, Math.floor(scoreRef.current)),
            p_scope: scope,
          });
        }
        if (userIdRef.current !== awardUserId) return;
        const { data, error } = result;
        if (!error) {
          applyProgressionPayload(data, awardUserId);
          setLastRunXpBreakdown(
            normalizeRunXpBreakdown(
              (data as { xp_breakdown?: unknown } | null)?.xp_breakdown,
            ),
          );
          const savedHighScore = Number(
            (data as { high_score?: unknown } | null)?.high_score,
          );
          if (Number.isFinite(savedHighScore) && savedHighScore >= 0) {
            highScoreRef.current = Math.floor(savedHighScore);
            setHighScore(Math.floor(savedHighScore));
          }
          return;
        }
        if (attempt === 2) {
          console.error("Could not save run XP:", error.message);
          if (
            userIdRef.current === awardUserId &&
            progressionRunIdRef.current === runId
          )
            progressionAwardedRunIdRef.current = null;
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
      }
    };
    const pendingAward = awardRun();
    progressionAwardPromiseRef.current = pendingAward;
    void pendingAward.finally(() => {
      if (progressionAwardPromiseRef.current === pendingAward)
        progressionAwardPromiseRef.current = null;
    });
  }, [
    applyProgressionPayload,
    guest,
    over,
    playScope,
    progressionRunVersion,
  ]);
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
  const queueGemClaim = useCallback(
    (contextId: string, pickupId: number, requestUserId: string) => {
      const claim = async () => {
        if (userIdRef.current !== requestUserId) return;
        if (
          gemStreakResetPendingRef.current &&
          progressionRunIdRef.current === contextId
        ) {
          const { error: resetError } = await supabase.rpc(
            "reset_endless_gem_streak",
            { p_run_id: contextId },
          );
          if (resetError) {
            console.error(
              "Could not reset gem streak before pickup:",
              resetError.message,
            );
            const { data: stats } = await supabase
              .from("player_stats")
              .select("total_gems")
              .eq("user_id", requestUserId)
              .maybeSingle();
            if (userIdRef.current !== requestUserId) return;
            const savedGems = Number(stats?.total_gems);
            if (Number.isFinite(savedGems)) {
              gemsRef.current = Math.max(0, savedGems);
              setGems(gemsRef.current);
            }
            return;
          }
          gemStreakResetPendingRef.current = false;
        }
        const { data, error } = await supabase.rpc("claim_player_gem", {
          p_context_id: contextId,
          p_pickup_id: String(pickupId),
        });
        if (userIdRef.current !== requestUserId) return;
        if (error) {
          console.error("Could not save gem:", error.message);
          const { data: stats } = await supabase
            .from("player_stats")
            .select("total_gems")
            .eq("user_id", requestUserId)
            .maybeSingle();
          if (userIdRef.current !== requestUserId) return;
          const savedGems = Number(stats?.total_gems);
          if (!Number.isFinite(savedGems)) return;
          gemsRef.current = Math.max(0, savedGems);
          setGems(gemsRef.current);
          return;
        }
        const totalGems = Number(data?.total_gems);
        if (Number.isFinite(totalGems)) {
          gemsRef.current = Math.max(0, totalGems);
          setGems(gemsRef.current);
        }
        const awarded = Number(data?.gems_awarded);
        const authoritativeStreak = Number(data?.streak);
        if (Number.isFinite(authoritativeStreak))
          gemStreakRef.current = Math.max(0, Math.floor(authoritativeStreak));
        if (Number.isFinite(awarded) && awarded > 1)
          showAbilityNotice(
            `GEM STREAK ×${Math.floor(awarded)} · +${Math.floor(awarded)} GEMS`,
            950,
          );
        applyProgressionPayload(data?.progression, requestUserId);
      };
      const queued = gemClaimQueueRef.current.then(claim, claim);
      gemClaimQueueRef.current = queued.catch(() => undefined);
    },
    [applyProgressionPayload, showAbilityNotice],
  );
  const queueEndlessGemStreakReset = useCallback(
    (nextWave?: number) => {
      gemStreakRef.current = 0;
      const runId = progressionRunIdRef.current;
      const requestUserId = userIdRef.current;
      if (!runId || !requestUserId) return;
      gemStreakResetPendingRef.current = true;
      const resetStreak = async () => {
        if (
          userIdRef.current !== requestUserId ||
          progressionRunIdRef.current !== runId
        ) {
          gemStreakResetPendingRef.current = false;
          return;
        }
        let lastError = "";
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const { error: syncError } = await supabase.rpc(
            "sync_progression_run",
            {
              p_run_id: runId,
              p_wave: nextWave ?? waveRef.current,
              p_active: true,
            },
          );
          const { error } = await supabase.rpc("reset_endless_gem_streak", {
            p_run_id: runId,
          });
          if (!error) {
            gemStreakResetPendingRef.current = false;
            return;
          }
          lastError = error.message;
          if (syncError)
            console.error(
              "Could not sync gem streak wave:",
              syncError.message,
            );
          if (attempt < 2)
            await new Promise<void>((resolve) =>
              window.setTimeout(resolve, 200 * (attempt + 1)),
            );
        }
        console.error("Could not reset gem streak:", lastError);
      };
      const queued = gemClaimQueueRef.current.then(resetStreak, resetStreak);
      gemClaimQueueRef.current = queued.catch(() => undefined);
    },
    [],
  );
  const applyVersusTimeStopState = useCallback(
    (
      payload: {
        zenith_time_stop_until?: string | null;
        time_stop_until?: string | null;
        zenith_time_stop_used?: boolean;
        time_stop_used?: boolean;
        obstacle_speed_multiplier?: number;
      },
      announce = false,
    ) => {
      const deadlineValue =
        payload.zenith_time_stop_until ?? payload.time_stop_until;
      const deadline =
        typeof deadlineValue === "string" ? Date.parse(deadlineValue) : NaN;
      const remaining = Number.isFinite(deadline)
        ? Math.max(0, deadline - Date.now())
        : 0;
      const wasStopped = timeStopRemainingRef.current > 0;
      let changed = false;
      if (remaining > timeStopRemainingRef.current + 25) {
        timeStopDeadlineRef.current = Math.max(
          timeStopDeadlineRef.current,
          deadline,
        );
        timeStopRemainingRef.current = Math.max(
          timeStopRemainingRef.current,
          remaining,
        );
        changed = true;
      }
      const requestedSlow = Number(payload.obstacle_speed_multiplier);
      if (
        Number.isFinite(requestedSlow) &&
        requestedSlow > 0 &&
        requestedSlow < permanentObstacleSlowRef.current
      ) {
        permanentObstacleSlowRef.current = Math.min(
          permanentObstacleSlowRef.current,
          Math.min(1, requestedSlow),
        );
        changed = true;
      }
      if (
        (payload.zenith_time_stop_used || payload.time_stop_used) &&
        !timeStopUsedRef.current
      ) {
        timeStopUsedRef.current = true;
        changed = true;
      }
      if (changed) setAbilityStateVersion((value) => value + 1);
      if (announce && remaining > 0 && !wasStopped)
        showAbilityNotice("TIME STOP · BOTH ARENA RUNS FROZEN", 1800);
    },
    [showAbilityNotice],
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
  const preserveFreezeThroughHit = useCallback((recoveryMs = 500) => {
    const remaining = frozenUntilRef.current - Date.now();
    if (remaining > 0) applyFreezeEffect(remaining + recoveryMs);
  }, [applyFreezeEffect]);
  const resetCharacterAbilityState = useCallback(
    (restoredWave?: number) => {
      const restoring = restoredWave !== undefined;
      const now = Date.now();
      firstGuardWaveRef.current = restoring ? restoredWave : 0;
      hammerBreakWaveRef.current = restoring ? restoredWave : 0;
      sentinelLastStandUsedRef.current = restoring;
      phantomPhaseWaveRef.current = restoring ? restoredWave : 0;
      scoreCarryRef.current = 0;
      currentCoinMultiplierRef.current = 1;
      pacerRushRemainingRef.current = 0;
      pacerRevivalUsedRef.current = restoring;
      courierBoostRemainingRef.current = 0;
      dashBoostRemainingRef.current = 0;
      dashCooldownRemainingRef.current = restoring ? 5000 : 0;
      blitzBoostRemainingRef.current = 0;
      blitzCooldownRemainingRef.current = restoring ? BLITZ_COOLDOWN_MS : 0;
      strideMoveCountRef.current = 0;
      vectorBlockWaveRef.current = restoring ? restoredWave : 0;
      haloPartsRef.current = 0;
      relayChargesRef.current = 0;
      velocityChargeMsRef.current = 0;
      velocityMilestoneRef.current = 0;
      velocityDisplayPercentRef.current = 0;
      setVelocityDisplayPercent(0);
      waveSpawnPlanRef.current = null;
      timeStopUsedRef.current = restoring;
      timeStopRemainingRef.current = 0;
      timeStopDeadlineRef.current = 0;
      permanentObstacleSlowRef.current = 1;
      pitchKatanaArmingRef.current = false;
      collisionWaveRef.current = restoring ? restoredWave : 0;
      damageTakenWaveRef.current = restoring ? restoredWave : 0;
      driftBoostRemainingRef.current = 0;
      driftLastMoveAtRef.current = 0;
      driftStackPercentRef.current = 0;
      sparkBoostRemainingRef.current = 0;
      sparkGemCountRef.current = 0;
      fortuneGemCountRef.current = 0;
      flareDamageWaveRef.current = restoring ? restoredWave : 0;
      flareBoostWaveRef.current = 0;
      gemStreakRef.current = 0;
      gemStreakResetPendingRef.current = false;
      orbitCooldownRemainingRef.current = restoring ? 3000 : 0;
      cometChargeRemainingRef.current = 8000;
      cometChargedRef.current = false;
      rogueGrazeCooldownUntilRef.current = restoring ? now + 2500 : 0;
      rogueGrazeMeterRef.current = 0;
      rogueGrazedItemIdsRef.current.clear();
      bloomGemWaveRef.current = restoring ? restoredWave : 0;
      sproutSeedWaveRef.current = restoring ? restoredWave : 0;
      remedySnowflakeWaveRef.current = restoring ? restoredWave : 0;
      reserveHealStoredRef.current = false;
      beaconActiveRef.current = false;
      menderChargeRemainingRef.current = 20000;
      menderHealedWaveRef.current = restoring ? restoredWave : 0;
      lifelineUsedRef.current = restoring;
      lifelineHookUsesRef.current = restoring ? 3 : 0;
      lifelineImmuneKindsRef.current.clear();
      seraphTeleportChanceRef.current = restoring ? 0 : 100;
      atlasLaneElapsedRef.current = 0;
      atlasLaneLimitRef.current = 5000;
      lastLaneChangeAtRef.current = now;
      reviveUsedRef.current = restoring;
      reviveFlyingRef.current = false;
      phoenixFeatherActiveRef.current = false;
      phoenixFeatherReadyWaveRef.current = 0;
      pulseUsedRef.current = restoring;
      oracleHitCountRef.current = 0;
      oracleInvincibleWaveRef.current = 0;
      oracleShieldWaveRef.current = 0;
      oracleBorrowedAbilitiesRef.current.clear();
      rampartCollisionCountRef.current = 0;
      mercyChainActiveRef.current = true;
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
      bastionChargeRemainingRef.current = 20000;
      bastionArmorChargedRef.current = false;
      citadelFlawlessStreakRef.current = 0;
      citadelBlocksRemainingRef.current = restoring ? 0 : 1;
      sentinelDamageByKindRef.current = {};
      sentinelAnalyzedKindRef.current = null;
      sentinelAnalyzedBlockWaveRef.current = 0;
      sentinelBarrelSlowUntilRef.current = 0;
      sentinelActionWaveRef.current = restoring ? restoredWave : 0;
      anchorGuardUntilRef.current = 0;
      anchorLaneLockedRef.current = false;
      jesterEffectRef.current = {
        kind: "first-zero",
        percent: 0,
        firstUsed: false,
      };
      phantomKindHitsRef.current = {};
      phantomBloodmoonKindsRef.current.clear();
      phantomHealthCapRef.current = 3;
      phantomLordRef.current = false;
      phantomLordNegationStreakRef.current = 0;
      setPhantomHealthCap(3);
      setPhantomLord(false);
      smokeSlowRemainingRef.current = 0;
      smokeCooldownUntilRef.current = restoring ? now + 20000 : 0;
      clockworkMoveCountRef.current = 0;
      clockworkSlowRemainingRef.current = 0;
      clockworkCooldownRemainingRef.current = restoring ? 5000 : 0;
      clockworkElapsedMsRef.current = 0;
      pickpocketPassedCountRef.current = 0;
      pickpocketUsedWaveRef.current = restoring ? restoredWave : 0;
      switchLaneChangesRef.current = 0;
      flickerUsedWaveRef.current = restoring ? restoredWave : 0;
      flareLaneRef.current = null;
      flareActiveUntilRef.current = 0;
      flareCooldownUntilRef.current = restoring ? now + 30000 : 0;
      flareBurnCountRef.current = 0;
      vialAllegianceUntilRef.current = 0;
      vialUsedRef.current = restoring;
      mirageUsedWaveRef.current = restoring ? restoredWave : 0;
      obstacleFreezeUntilRef.current = 0;
      lanternCooldownUntilRef.current = restoring ? now + 10000 : 0;
      scoutInputWindowUntilRef.current = 0;
      scoutSnowflakeHealReadyRef.current = false;
      scoutCooldownUntilRef.current = restoring ? now + 50000 : 0;
      dragChainRef.current = null;
      nomadSurvivalUsedRef.current = restoring;
      tinkerInspirationRef.current = 0;
      tinkerClickedSpikeIdsRef.current.clear();
      rangerCooldownUntilRef.current = restoring ? now + 30000 : 0;
      brokerFundsRef.current = { gems: 0, coins: 0, melons: 0 };
      prospectorNoticeWaveRef.current = 0;
      weaverSnowflakeCountRef.current = 0;
      weaverJacketRef.current = false;
      weaverHealWaveRef.current = 0;
      weaverHealedAmountRef.current = 0;
      harvesterCountsRef.current = { gems: 0, coins: 0, melons: 0 };
      harvesterCooldownUntilRef.current = 0;
      wildcardBuffRef.current = null;
      setAbilityChoice(null);
      setTonicIngredients(0);
      setTonicPotion(0);
      setOracleProphecies([]);
      setOracleCompleted(0);
      setPulseGame(null);
      setWaveForecast([]);
      setWaveForecastCollapsed(false);
      setAbilityStateVersion((value) => value + 1);
    },
    [],
  );
  const announceWave = useCallback(
    (
      number: number,
      applyCharacterEffects = true,
      characterOverride?: string,
      mapOverride?: MapId,
      versusRunOverride?: boolean,
    ) => {
      const announcedCharacter = characterOverride ?? activeCharacter;
      const announcedAbility =
        CHARACTER_ABILITIES[announcedCharacter as CharacterKey] ??
        CHARACTER_ABILITIES.runner_ace;
      oracleHitCountRef.current = 0;
      const forecastMapId = mapOverride ?? activeMapId;
      const forecastVersusRun = versusRunOverride ?? isVersusRun;
      const sameHazardLimit =
        announcedCharacter === "misc_muse"
          ? 2
          : announcedCharacter === "misc_scribe"
            ? 3
            : MAX_SAME_HAZARD_STREAK;
      const plannedKinds = buildWaveHazardPlan(
        forecastMapId,
        forecastVersusRun,
        sameHazardLimit,
        ambientHazardStreakRef.current,
      );
      waveSpawnPlanRef.current = {
        wave: number,
        kinds: plannedKinds,
        cursor: 0,
      };
      if (
        applyCharacterEffects &&
        announcedCharacter === "trickster_phantom"
      ) {
        const isLord = phantomLordRef.current;
        const isBloodmoon = number % 5 === 0;
        const isLordsdown = !isLord && number % 10 === 0;
        if (isBloodmoon) {
          const availableKinds = [...PHANTOM_BLOODMOON_HAZARDS];
          for (let index = availableKinds.length - 1; index > 0; index -= 1) {
            const swapIndex = Math.floor(Math.random() * (index + 1));
            [availableKinds[index], availableKinds[swapIndex]] = [
              availableKinds[swapIndex],
              availableKinds[index],
            ];
          }
          phantomBloodmoonKindsRef.current = new Set(
            availableKinds.slice(0, 2),
          );
        } else {
          phantomBloodmoonKindsRef.current.clear();
        }
        const nextCap = isLord ? 6 : isBloodmoon ? 10 : 3;
        phantomHealthCapRef.current = nextCap;
        setPhantomHealthCap(nextCap);
        if (isLordsdown) {
          state.current.hearts = 10;
          setHearts(10);
        } else if (state.current.hearts > nextCap) {
          state.current.hearts = nextCap;
          setHearts(nextCap);
        }
      }
      const canForecast =
        announcedCharacter === "runner_horizon" ||
        announcedCharacter === "medic_oracle" ||
        (announcedCharacter === "runner_zenith" && number >= 9);
      if (canForecast) {
        const carriedNatural = itemsSnapshotRef.current.filter(
          (item) => isHazardKind(item.kind) && !item.attackToken,
        );
        const carriedPurchased = itemsSnapshotRef.current.filter(
          (item) => isHazardKind(item.kind) && Boolean(item.attackToken),
        );
        const queuedPurchased = new Map<string, Kind>();
        deferredAttackGroupsRef.current.flat().forEach((item) =>
          queuedPurchased.set(
            item.attackToken ?? `local:${item.id}`,
            item.kind,
          ),
        );
        incomingAttacksRef.current.forEach((attack) =>
          queuedPurchased.set(attack.id, attack.kind),
        );
        const section = (label: string, kinds: Kind[]) =>
          kinds.length > 0
            ? [`${label} · ${kinds.length}`, ...countKinds(kinds)]
            : [`${label} · NONE`];
        const naturalPreview = plannedKinds.slice(0, HORIZON_PREVIEW_SIZE);
        setWaveForecast([
          `WAVE ${number} · EXACT NEXT ${naturalPreview.length}`,
          ...section("NEXT NATURAL HAZARDS", naturalPreview),
          ...section(
            "CARRIED NATURAL HAZARDS",
            carriedNatural.map((item) => item.kind),
          ),
          ...section(
            "CARRIED RIVAL HAZARDS",
            carriedPurchased.map((item) => item.kind),
          ),
          ...section(
            "QUEUED RIVAL HAZARDS",
            Array.from(queuedPurchased.values()),
          ),
        ]);
      } else {
        setWaveForecast([]);
      }
      if (
        applyCharacterEffects &&
        number === 1 &&
        announcedCharacter === "trickster_jester"
      ) {
        const rolled = generateJesterWaveEffect(
          `${versusMatchRef.current ?? "solo"}:${userIdRef.current ?? "guest"}`,
          number,
        );
        jesterEffectRef.current = {
          kind:
            rolled.kind === "first-hit-zero"
              ? "first-zero"
              : rolled.kind === "half-damage"
                ? "half"
                : rolled.kind === "barrel-immunity"
                  ? "barrel-zero"
                  : rolled.kind === "score-and-speed"
                    ? "neutral"
                    : rolled.kind === "first-hit-double"
                      ? "first-double"
                      : rolled.kind === "fifty-percent-more-damage"
                        ? "more"
                        : "barrel-double",
          percent:
            rolled.kind === "score-and-speed" ? rolled.percent / 100 : 0,
          firstUsed: false,
        };
        showAbilityNotice(
          `JESTER ROLL · ${rolled.kind.replaceAll("-", " ").toUpperCase()}${rolled.kind === "score-and-speed" ? ` ${rolled.percent}%` : ""}`,
          1500,
        );
      }
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
        if (oracleShieldWaveRef.current === number) {
          oracleShieldWaveRef.current = 0;
          grantInvincibility(10000);
          showAbilityNotice("MERGED NO-HIT REWARD · 10 SECOND SHIELD", 1500);
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
        if (announcedCharacter === "trickster_phantom") {
          const isLord = phantomLordRef.current;
          const isNight = !isLord && number % 2 === 0;
          const isBloodmoon = number % 5 === 0;
          const isLordsdown = !isLord && number % 10 === 0;
          if (isNight) grantInvincibility(5000);
          if (isLordsdown)
            showAbilityNotice(
              "LORDSDOWN · 10 HP · NIGHT + BLOODMOON · 5 SECOND SHIELD",
              2200,
            );
          else if (isBloodmoon)
            showAbilityNotice(
              `BLOODMOON · ${Array.from(
                phantomBloodmoonKindsRef.current,
              )
                .map((kind) => kind.toUpperCase())
                .join(" + ")} HEAL 2 HP · SNOWFLAKES HEAL 1 HP`,
              2200,
            );
          else if (isNight)
            showAbilityNotice(
              "NIGHT WAVE · SPEED ×1.5 · SCORE ×2 · SNOWFLAKE IMMUNITY · 5 SECOND SHIELD",
              2000,
            );
          else if (isLord)
            showAbilityNotice(
              "LORD · MAX 6 HP · 50% HIT NEGATION · EVISCERATE READY",
              1800,
            );
        }
        waveAnnouncementTimerRef.current = null;
      }, 1250);
    },
    [
      activeCharacter,
      activeMapId,
      grantInvincibility,
      isVersusRun,
      showAbilityNotice,
    ],
  );
  const reset = useCallback(async (
    trackProgression = true,
    mapOverride?: MapId,
  ) => {
    const resetIntent = progressionResetIntentRef.current + 1;
    progressionResetIntentRef.current = resetIntent;
    setRunCharacterOverride(null);
    if (trackProgression && progressionAwardPromiseRef.current)
      await progressionAwardPromiseRef.current;
    if (resetIntent !== progressionResetIntentRef.current) return;
    if (trackProgression && userIdRef.current) {
      const startingUserId = userIdRef.current;
      const pendingStart = startProgressionRun();
      const runId = await pendingStart;
      if (
        resetIntent !== progressionResetIntentRef.current ||
        startingUserId !== userIdRef.current ||
        (runId !== null && progressionRunIdRef.current !== runId)
      )
        return;
      if (!runId) {
        showAbilityNotice("ACCOUNT XP CONNECTION ERROR · TRY AGAIN", 1800);
        return;
      }
    } else {
      progressionStartIntentRef.current += 1;
      progressionRunIdRef.current = null;
      progressionAwardedRunIdRef.current = null;
    }
    const runMapId = mapOverride ?? activeMapId;
    const runMapRules = getMapRules(runMapId);
    const candidateCharacter = availableCharacter;
    const candidateClass = getCharacterClassKey(candidateCharacter);
    const candidateBlockedByMode =
      mode === "impossible" ||
      (mode === "hardcore" &&
        (candidateClass === "medic" || candidateClass === "tank"));
    const runCharacter =
      candidateBlockedByMode
        ? "runner_ace"
        : runMapRules.forcedCharacterId ??
          (isCharacterClassAllowed(runMapId, candidateClass)
            ? candidateCharacter
            : "runner_ace");
    const runClass = getCharacterClassKey(runCharacter);
    const runBaseStartingHearts = getCharacterStartingHearts(
      runCharacter,
      runClass,
    );
    const runMapHealth = applyMapHealthModifiers(
      runMapId,
      runBaseStartingHearts,
      getCharacterMaxHearts(runCharacter, runClass),
    );
    const runStartingHearts =
      mode === "normal" ? runMapHealth.startingHp : 1;
    const runCenterLane = Math.floor(runMapRules.laneCount / 2);
    resetVersusClientSync();
    incomingAttacksRef.current = [];
    spawnedAttackIdsRef.current.clear();
    queuedAttackTokenIdsRef.current.clear();
    deferredAttackGroupsRef.current = [];
    setDeferredAttackGroups([]);
    ambientHazardStreakRef.current = { kind: null, count: 0 };
    setLastRunXpBreakdown(null);
    setLane(runCenterLane);
    state.current.lane = runCenterLane;
    itemsSnapshotRef.current = [];
    setItems([]);
    setScore(0);
    setWaveProgress(0);
    setHearts(runStartingHearts);
    setWave(1);
    setOver(false);
    setVersusSelfEliminated(false);
    versusSelfEliminatedRef.current = false;
    setVersusSelfMushrooms(0);
    setVersusOpponentMushrooms(0);
    pitchKatanaRef.current = createPitchKatanaState();
    setPitchKatanaVersion((value) => value + 1);
    volcanoStationaryMsRef.current = 0;
    const nextConveyor = createFactoryConveyorState();
    factoryConveyorRef.current = nextConveyor;
    setFactoryConveyor(nextConveyor);
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
    botScoreRef.current = 0;
    botScoreCarryRef.current = 0;
    practiceBotNextWaveHeartsRef.current = null;
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
    announceWave(1, true, runCharacter, runMapId, mapOverride !== undefined);
    if (runCharacter === "medic_oracle") {
      setPaused(true);
      setAbilityChoice({ kind: "oracle-prophecy" });
    }
  }, [
    activeMapId,
    announceWave,
    availableCharacter,
    clearFreezeEffect,
    mode,
    resetCharacterAbilityState,
    resetVersusClientSync,
    showAbilityNotice,
    soundtrack,
    startProgressionRun,
  ]);
  const resetGameToMenu = () => {
    cancelPendingProgressionStart();
    progressionStartIntentRef.current += 1;
    progressionRunIdRef.current = null;
    progressionAwardedRunIdRef.current = null;
    resetVersusClientSync();
    incomingAttacksRef.current = [];
    spawnedAttackIdsRef.current.clear();
    queuedAttackTokenIdsRef.current.clear();
    deferredAttackGroupsRef.current = [];
    setDeferredAttackGroups([]);
    setLastRunXpBreakdown(null);
    setRunning(false);
    setPaused(false);
    setPauseMenuOpen(false);
    setOver(false);
    itemsSnapshotRef.current = [];
    setItems([]);
    setLane(activeCenterLane);
    state.current.lane = activeCenterLane;
    setScore(0);
    setWaveProgress(0);
    setWave(1);
    setHearts(startingHearts);
    setVersusSelfEliminated(false);
    versusSelfEliminatedRef.current = false;
    setVersusSelfMushrooms(0);
    setVersusOpponentMushrooms(0);
    pitchKatanaRef.current = createPitchKatanaState();
    setPitchKatanaVersion((value) => value + 1);
    volcanoStationaryMsRef.current = 0;
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
    botScoreRef.current = 0;
    botScoreCarryRef.current = 0;
    practiceBotMaxHeartsRef.current = BOT_MAX_HEARTS;
    practiceBotNextWaveHeartsRef.current = null;
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
      setVersusOpponentScore(0);
      setVersusResult("");
      setVersusIntermissionReady(false);
    }
  };
  const applyCharacterSelfDamage = useCallback(
    (damage: number, notice: string) => {
      const safeDamage = Math.max(0, damage);
      const nextHearts = Math.max(0, state.current.hearts - safeDamage);
      state.current.hearts = nextHearts;
      setHearts(nextHearts);
      void audioEngine.playSfx("hit");
      setFlash(safeDamage <= 0.5 ? "life-half" : safeDamage >= 2 ? "life-two" : "life-lost");
      showAbilityNotice(notice, 1100);
      setTimeout(() => {
        setFlash((current) =>
          current === "life-half" ||
          current === "life-two" ||
          current === "life-lost"
            ? ""
            : current,
        );
      }, 480);
      if (nextHearts > 0) return false;
      setRunning(false);
      setPaused(false);
      setPauseMenuOpen(false);
      setOver(true);
      if (isBotPractice) {
        setVersusResult("PRACTICE DEFEAT");
        setVersusPhase("finished");
        setVersusIntermissionReady(false);
      } else if (isOnlineVersus) {
        setVersusSelfEliminated(true);
        versusSelfEliminatedRef.current = true;
        setVersusPhase("eliminated");
        setVersusIntermissionReady(false);
        setVersusResult("RUN COMPLETE · RIVAL STILL RUNNING");
      } else if (guest) {
        gemsRef.current = 0;
        setGems(0);
      } else {
        const best = Math.max(highScoreRef.current, scoreRef.current);
        highScoreRef.current = best;
        setHighScore(best);
      }
      return true;
    },
    [guest, isBotPractice, isOnlineVersus, showAbilityNotice],
  );
  const applyDirectMapDamage = useCallback(
    (damage: number, notice: string) => {
      if (
        damage <= 0 ||
        damageLockedRef.current ||
        !state.current.running ||
        state.current.hearts <= 0
      )
        return;
      damageLockedRef.current = true;
      preserveFreezeThroughHit(260);
      if (playScope === "single") queueEndlessGemStreakReset();
      const nextHearts = Math.max(0, state.current.hearts - damage);
      state.current.hearts = nextHearts;
      setHearts(nextHearts);
      void audioEngine.playSfx("hit");
      setFlash(damage <= 0.5 ? "life-half" : "life-lost");
      showAbilityNotice(notice, 900);
      if (nextHearts <= 0) {
        setRunning(false);
        setPaused(false);
        setPauseMenuOpen(false);
        setOver(true);
        if (isBotPractice) {
          setVersusResult("PRACTICE RUN COMPLETE");
          setVersusPhase("finished");
        } else if (isOnlineVersus) {
          setVersusSelfEliminated(true);
          versusSelfEliminatedRef.current = true;
          setVersusPhase("eliminated");
          setVersusIntermissionReady(false);
          setVersusResult("RUN COMPLETE · RIVAL STILL RUNNING");
        } else if (guest) {
          gemsRef.current = 0;
          setGems(0);
        } else {
          const best = Math.max(highScoreRef.current, scoreRef.current);
          highScoreRef.current = best;
          setHighScore(best);
        }
      }
      setTimeout(() => {
        setFlash("");
        damageLockedRef.current = false;
      }, 240);
    },
    [
      guest,
      isBotPractice,
      isOnlineVersus,
      playScope,
      preserveFreezeThroughHit,
      queueEndlessGemStreakReset,
      showAbilityNotice,
    ],
  );
  const triggerPitchKatana = useCallback(() => {
    if (
      activeMapId !== "pitch" ||
      !state.current.running ||
      state.current.paused ||
      state.current.wavePause
    )
      return;
    const preflight = activatePitchKatana(
      pitchKatanaRef.current,
      Date.now(),
      frozenUntilRef.current > Date.now(),
    );
    if (!preflight.activated) {
      const message =
        preflight.reason === "broken"
          ? "KATANA BROKEN FOR THIS MATCH"
          : preflight.reason === "frozen"
            ? "KATANA LOCKED WHILE FROZEN"
            : preflight.reason === "cooldown"
              ? "KATANA RECHARGING"
              : "KATANA ALREADY ACTIVE";
      showAbilityNotice(message, 850);
      return;
    }
    const beginGuard = (authoritativeCooldown?: unknown) => {
      const activation = activatePitchKatana(
        pitchKatanaRef.current,
        Date.now(),
        frozenUntilRef.current > Date.now(),
      );
      if (!activation.activated) {
        showAbilityNotice("KATANA COULD NOT ARM", 900);
        return;
      }
      const parsedCooldown =
        typeof authoritativeCooldown === "string"
          ? Date.parse(authoritativeCooldown)
          : NaN;
      pitchKatanaRef.current = {
        ...activation.state,
        cooldownUntilMs: Number.isFinite(parsedCooldown)
          ? parsedCooldown
          : activation.state.cooldownUntilMs,
      };
      setPitchKatanaVersion((value) => value + 1);
      void audioEngine.playSfx("shield");
      showAbilityNotice("KATANA ACTIVE · 0.4 SECOND GUARD", 650);
      if (pitchKatanaTimerRef.current)
        clearTimeout(pitchKatanaTimerRef.current);
      pitchKatanaTimerRef.current = setTimeout(() => {
        const settled = settlePitchKatanaWindow(
          pitchKatanaRef.current,
          Date.now(),
        );
        pitchKatanaRef.current = settled.state;
        setPitchKatanaVersion((value) => value + 1);
        if (settled.selfDamage > 0)
          applyDirectMapDamage(
            settled.selfDamage,
            "KATANA MISSED · 0.5 HP LOST",
          );
        pitchKatanaTimerRef.current = null;
      }, (PITCH_KATANA_RULES.activeSeconds + 0.02) * 1000);
    };
    if (isOnlineVersus && versusMatchRef.current) {
      if (pitchKatanaArmingRef.current) return;
      pitchKatanaArmingRef.current = true;
      const matchId = versusMatchRef.current;
      showAbilityNotice("KATANA ARMING…", 650);
      void supabase
        .rpc("activate_1v1_katana", { p_match_id: matchId })
        .then(({ data, error }) => {
          pitchKatanaArmingRef.current = false;
          if (versusMatchRef.current !== matchId) return;
          if (error) {
            setVersusResult(error.message);
            showAbilityNotice("KATANA COULD NOT ARM", 1000);
            void hydrateVersusStateRef.current?.(matchId, true);
            return;
          }
          beginGuard(
            data?.katana_cooldown_until ?? data?.katana_cooldown_ends_at,
          );
        });
      return;
    }
    beginGuard();
  }, [
    activeMapId,
    applyDirectMapDamage,
    isOnlineVersus,
    showAbilityNotice,
  ]);
  const completeMove = useCallback(
    (destination: number, direction: number) => {
      state.current.lane = destination;
      setLane(destination);
      volcanoStationaryMsRef.current = 0;
      if (isOnlineVersus && versusMatchRef.current)
        void supabase.rpc("update_1v1_position", {
          p_match_id: versusMatchRef.current,
          p_lane_index: destination,
        });
      void audioEngine.playSfx("move");
      const now = Date.now();
      lastLaneChangeAtRef.current = now;
      if (hasCharacterAbility("tank_atlas")) atlasLaneElapsedRef.current = 0;
      if (activeCharacter === "runner_pacer") {
        scoreRef.current += 10;
        setScore(scoreRef.current);
        showAbilityNotice("RELAY ROD · +10 SCORE", 600);
      }
      if (hasCharacterAbility("runner_stride")) {
        strideMoveCountRef.current += 1;
        if (strideMoveCountRef.current % 3 === 0) {
          grantInvincibility(STRIDE_SHIELD_MS);
          showAbilityNotice("FLOW STRIDE · 0.25 SECOND SHIELD", 650);
        }
      }
      if (
        activeCharacter === "tank_bastion"
      ) {
        bastionChargeRemainingRef.current = 20000;
        bastionArmorChargedRef.current = false;
      }
      if (activeCharacter === "runner_drift") {
        driftStackPercentRef.current =
          now - driftLastMoveAtRef.current <= 500
            ? Math.min(2, driftStackPercentRef.current + 0.15)
            : 0.15;
        driftLastMoveAtRef.current = now;
        driftBoostRemainingRef.current = 500;
        showAbilityNotice(
          `SLIPSTREAM · SCORE +${Math.round(driftStackPercentRef.current * 100)}% · HAZARD SPEED +${Math.round(driftStackPercentRef.current * 100)}%`,
          700,
        );
      }
      if (activeCharacter === "trickster_switch") {
        switchLaneChangesRef.current += 1;
        if (switchLaneChangesRef.current >= 100)
          window.setTimeout(() => grantInvincibility(250), 10);
        switchLastDirectionRef.current = direction;
        setAbilityStateVersion((value) => value + 1);
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
                  item.kind !== "melon" &&
                  item.kind !== "snowflake",
              )
              .sort((left, right) => right.y - left.y)[0];
            return target
              ? current.filter((item) => item.id !== target.id)
              : current;
          });
        }
      }
    },
    [
      activeCharacter,
      grantInvincibility,
      hasCharacterAbility,
      isOnlineVersus,
      showAbilityNotice,
    ],
  );
  const move = useCallback(
    (d: number) => {
      if (
        !state.current.running ||
        state.current.paused ||
        state.current.wavePause ||
        turnLockedRef.current ||
        (anchorLaneLockedRef.current && anchorGuardUntilRef.current > Date.now()) ||
        (activeCharacter === "trickster_rogue" &&
          invincibleUntilRef.current > Date.now()) ||
        (activeMapId === "pitch" &&
          isPitchKatanaMovementLocked(pitchKatanaRef.current, Date.now()))
      )
        return;
      const orbitWrap =
        hasCharacterAbility("runner_orbit") &&
        orbitCooldownRemainingRef.current <= 0 &&
        ((state.current.lane === 0 && d < 0) ||
          (state.current.lane === activeLaneCount - 1 && d > 0));
      const destination = orbitWrap
        ? state.current.lane === 0
          ? activeLaneCount - 1
          : 0
        : Math.max(
            0,
            Math.min(activeLaneCount - 1, state.current.lane + d),
          );
      if (destination === state.current.lane) return;
      const finishMove = () => {
        completeMove(destination, d);
        if (orbitWrap) {
          orbitCooldownRemainingRef.current = 3000;
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
              !state.current.wavePause &&
              !(
                activeCharacter === "trickster_rogue" &&
                invincibleUntilRef.current > Date.now()
              )
            )
              finishMove();
            turnLockedRef.current = false;
            delayedMoveTimerRef.current = null;
          },
          250,
        );
        return;
      }
      if (activeMapId === "volcano") {
        turnLockedRef.current = true;
        delayedMoveTimerRef.current = setTimeout(() => {
          if (
            state.current.running &&
            !state.current.paused &&
            !state.current.wavePause &&
            !(
              activeCharacter === "trickster_rogue" &&
              invincibleUntilRef.current > Date.now()
            )
          )
            finishMove();
          turnLockedRef.current = false;
          delayedMoveTimerRef.current = null;
        }, VOLCANO_RULES.turnDelaySeconds * 1000);
        return;
      }
      finishMove();
    },
    [
      activeLaneCount,
      activeCharacter,
      activeMapId,
      completeMove,
      hasCharacterAbility,
      showAbilityNotice,
    ],
  );
  const triggerCharacterAction = useCallback(() => {
    if (
      !state.current.running ||
      state.current.paused ||
      state.current.wavePause ||
      abilityChoice ||
      pulseGame
    )
      return;
    if (
      activeCharacter === "runner_zenith" &&
      wave >= 15 &&
      !timeStopUsedRef.current
    ) {
      timeStopUsedRef.current = true;
      if (isOnlineVersus && versusMatchRef.current) {
        const matchId = versusMatchRef.current;
        showAbilityNotice("TIME STOP · SYNCHRONIZING BOTH RUNS", 1200);
        void supabase
          .rpc("activate_1v1_zenith_time_stop", {
            p_match_id: matchId,
            p_score: Math.floor(scoreRef.current),
          })
          .then(({ data, error }) => {
            if (versusMatchRef.current !== matchId) return;
            if (error) {
              timeStopUsedRef.current = false;
              setVersusResult(error.message);
              showAbilityNotice("TIME STOP COULD NOT ACTIVATE", 1300);
              void hydrateVersusStateRef.current?.(matchId, true);
              return;
            }
            const authoritativeScore = Number(data?.score);
            const authoritativeHearts = Number(data?.hearts);
            if (Number.isFinite(authoritativeScore)) {
              scoreRef.current = Math.max(0, authoritativeScore);
              setScore(scoreRef.current);
            }
            if (Number.isFinite(authoritativeHearts)) {
              state.current.hearts = Math.max(
                0,
                Math.min(maxHearts, authoritativeHearts),
              );
              setHearts(state.current.hearts);
            }
            applyVersusTimeStopState(data ?? {}, true);
            void audioEngine.playSfx("shield");
          });
        return;
      }
      timeStopRemainingRef.current = 10000;
      timeStopDeadlineRef.current = Date.now() + 10000;
      permanentObstacleSlowRef.current = Math.min(
        permanentObstacleSlowRef.current,
        0.75,
      );
      scoreRef.current += 15000;
      setScore(scoreRef.current);
      state.current.hearts = maxHearts;
      setHearts(maxHearts);
      setAbilityStateVersion((value) => value + 1);
      showAbilityNotice("TIME STOP · FULL HP · +15,000 SCORE", 1800);
      void audioEngine.playSfx("shield");
      return;
    }
    if (activeCharacter === "runner_blitz") {
      if (blitzCooldownRemainingRef.current > 0) {
        showAbilityNotice("VOLT CLEAVE · RECHARGING", 700);
        return;
      }
      let destroyed = false;
      setItems((current) => {
        const target = current
          .filter(
            (item) =>
              item.lane === state.current.lane &&
              item.y >= -10 &&
              item.y < 91 &&
              isHazardKind(item.kind) &&
              item.kind !== "rock",
          )
          .sort((left, right) => right.y - left.y)[0];
        if (!target) return current;
        destroyed = true;
        return current.filter((item) => item.id !== target.id);
      });
      blitzBoostRemainingRef.current = 750;
      blitzCooldownRemainingRef.current = BLITZ_COOLDOWN_MS;
      grantInvincibility(400);
      showAbilityNotice(
        destroyed ? "VOLT CLEAVE · OBSTACLE DESTROYED" : "VOLT CLEAVE · DASH",
        950,
      );
      void audioEngine.playSfx("shield");
      return;
    }
    if (hasCharacterAbility("runner_dash")) {
      if (dashCooldownRemainingRef.current > 0) {
        showAbilityNotice("JET DASH · RECHARGING", 700);
        return;
      }
      dashBoostRemainingRef.current = 1000;
      dashCooldownRemainingRef.current = 5000;
      grantInvincibility(350);
      showAbilityNotice("JET DASH · SPEED BURST + DODGE SHIELD", 950);
      void audioEngine.playSfx("move");
      return;
    }
    if (activeCharacter === "tank_hammer") {
      const currentLane = state.current.lane;
      const neighboring = getTrackLanes(activeLaneCount).filter(
        (candidate) => Math.abs(candidate - currentLane) === 1,
      );
      let destroyed = 0;
      setItems((current) => {
        const eligible = (lane: number) =>
          current
            .filter(
              (item) =>
                item.lane === lane &&
                item.y >= -10 &&
                item.y < 91 &&
                isHazardKind(item.kind) &&
                item.kind !== "rock",
            )
            .sort((left, right) => right.y - left.y);
        const targets = [eligible(currentLane)[0], ...neighboring.map((lane) => eligible(lane)[0])]
          .filter(Boolean) as Item[];
        if (neighboring.length === 1)
          targets.push(eligible(neighboring[0])[1]);
        const targetIds = new Set(targets.filter(Boolean).map((item) => item.id));
        destroyed = targetIds.size;
        return current.filter((item) => !targetIds.has(item.id));
      });
      showAbilityNotice(
        destroyed > 0
          ? `HAMMER · ${destroyed} OBSTACLE${destroyed === 1 ? "" : "S"} DESTROYED`
          : "HAMMER · NO NON-ROCK TARGETS",
        1000,
      );
      return;
    }
    if (activeCharacter === "tank_anchor") {
      anchorGuardUntilRef.current = Date.now() + 5000;
      anchorLaneLockedRef.current = true;
      showAbilityNotice("GROUND HOOK · LANE LOCKED · DAMAGE -75% · 5 SECONDS", 1300);
      return;
    }
    if (
      activeCharacter === "tank_sentinel" &&
      sentinelActionWaveRef.current !== wave
    ) {
      sentinelActionWaveRef.current = wave;
      sentinelBarrelSlowUntilRef.current = Date.now() + 15000;
      showAbilityNotice("STEEL SPEAR · BARRELS 75% SLOWER · 15 SECONDS", 1200);
      return;
    }
    if (activeCharacter === "trickster_smoke") {
      if (smokeCooldownUntilRef.current > Date.now()) {
        showAbilityNotice("SMOKE BOMB · RECHARGING", 700);
        return;
      }
      const occupied = new Set(
        itemsSnapshotRef.current
          .filter(
            (item) =>
              isHazardKind(item.kind) && item.y >= 42 && item.y <= 104,
          )
          .map((item) => item.lane),
      );
      const safeLanes = getTrackLanes(activeLaneCount).filter(
        (candidate) => !occupied.has(candidate),
      );
      const destination =
        safeLanes[Math.floor(Math.random() * safeLanes.length)] ??
        state.current.lane;
      state.current.lane = destination;
      setLane(destination);
      grantInvincibility(350);
      smokeCooldownUntilRef.current = Date.now() + 20000;
      showAbilityNotice(`SMOKE BOMB · TELEPORTED TO LANE ${destination + 1}`, 1000);
      return;
    }
    if (activeCharacter === "trickster_rogue") {
      const meter = rogueGrazeMeterRef.current;
      if (meter >= 10) {
        rogueGrazeMeterRef.current -= 10;
        grantInvincibility(5000);
        showAbilityNotice("SHADOW METER ×10 · 5 SECOND SHIELD · LANES LOCKED", 1300);
      } else if (meter >= 5) {
        rogueGrazeMeterRef.current -= 5;
        setItems((current) => current.filter((item) => !isHazardKind(item.kind)));
        showAbilityNotice("SHADOW METER ×5 · ALL OBSTACLES CLEARED", 1200);
      } else if (meter >= 2) {
        rogueGrazeMeterRef.current -= 2;
        grantInvincibility(450);
        showAbilityNotice("SHADOW METER ×2 · 0.45 SECOND SHIELD", 900);
      } else showAbilityNotice(`SHADOW METER · ${meter}/2 GRAZES`, 750);
      setAbilityStateVersion((value) => value + 1);
      return;
    }
    if (
      activeCharacter === "trickster_flicker" &&
      flickerUsedWaveRef.current !== wave
    ) {
      flickerUsedWaveRef.current = wave;
      setItems((current) => {
        const closest = new Map<number, Item>();
        current.forEach((item) => {
          if (!isHazardKind(item.kind) || item.y >= 91) return;
          const previous = closest.get(item.lane);
          if (!previous || item.y > previous.y) closest.set(item.lane, item);
        });
        const targets = new Set(Array.from(closest.values()).map((item) => item.id));
        const pickups: Kind[] = isVersusRun
          ? ["gem", "coin"]
          : ["gem", "melon"];
        return current.map((item) =>
          targets.has(item.id)
            ? { ...item, kind: pickups[Math.floor(Math.random() * pickups.length)] }
            : item,
        );
      });
      showAbilityNotice("FLICKER · CLOSEST HAZARD IN EVERY LANE TRANSFORMED", 1200);
      return;
    }
    if (activeCharacter === "runner_flare") {
      if (flareCooldownUntilRef.current > Date.now()) {
        showAbilityNotice("SIGNAL FLARE · RECHARGING", 700);
        return;
      }
      flareLaneRef.current = state.current.lane;
      flareActiveUntilRef.current = Date.now() + 15000;
      flareCooldownUntilRef.current =
        Date.now() + Math.max(15000, 30000 - Math.floor(flareBurnCountRef.current / 10) * 5000);
      showAbilityNotice(`SIGNAL FLARE · LANE ${state.current.lane + 1} BURNS FOR 15 SECONDS`, 1200);
      return;
    }
    if (activeCharacter === "trickster_phantom" && phantomLordRef.current) {
      let destroyed = 0;
      setItems((current) => {
        const retained = current.filter((item) => {
          const projectile =
            isHazardKind(item.kind) &&
            item.kind !== "rock" &&
            item.kind !== "spikes" &&
            item.kind !== "current";
          if (projectile) destroyed += 1;
          return !projectile;
        });
        return retained;
      });
      showAbilityNotice(
        `EVISCERATE · ${destroyed} PROJECTILE${destroyed === 1 ? "" : "S"} ERASED`,
        1100,
      );
      void audioEngine.playSfx("shield");
      return;
    }
    if (activeCharacter === "medic_vial" && !vialUsedRef.current) {
      vialUsedRef.current = true;
      vialAllegianceUntilRef.current = Date.now() + 30000;
      showAbilityNotice("SWITCH ALLEGIANCE · OBSTACLE EFFECTS REVERSED · 30 SECONDS", 1400);
      return;
    }
    if (
      activeCharacter === "trickster_mirage" &&
      mirageUsedWaveRef.current !== wave
    ) {
      mirageUsedWaveRef.current = wave;
      grantInvincibility(5000);
      showAbilityNotice("MIRAGE INVASION · INVINCIBLE FOR 5 SECONDS", 1200);
      window.setTimeout(() => {
        if (!state.current.running) return;
        state.current.hearts = Math.max(0, state.current.hearts - 1);
        setHearts(state.current.hearts);
        showAbilityNotice("MIRAGE RETURN · -1 HP", 900);
      }, 5000);
      return;
    }
    if (activeCharacter === "runner_scout") {
      const now = Date.now();
      if (scoutInputWindowUntilRef.current > now) {
        scoutInputWindowUntilRef.current = 0;
        scoutSnowflakeHealReadyRef.current = true;
        scoutCooldownUntilRef.current = now + 50000;
        showAbilityNotice("TIMED INPUT PERFECT · NEXT SNOWFLAKE HEALS 0.5 HP", 1200);
      } else if (scoutCooldownUntilRef.current <= now) {
        scoutInputWindowUntilRef.current = now + 1500;
        showAbilityNotice("QUICKSTEP INPUT · PRESS E AGAIN WITHIN 1.5 SECONDS", 1500);
      } else showAbilityNotice("QUICKSTEP INPUT · RECHARGING", 700);
      return;
    }
    if (activeCharacter === "tank_drag") {
      if (!dragChainRef.current || dragChainRef.current.wave !== wave) {
        dragChainRef.current = { wave, lane: state.current.lane };
        showAbilityNotice(`CHAIN SET · LANE ${state.current.lane + 1}`, 850);
      } else {
        state.current.lane = dragChainRef.current.lane;
        setLane(dragChainRef.current.lane);
        grantInvincibility(700);
        dragChainRef.current = null;
        showAbilityNotice("CHAIN RETURN · COLLISION-PROOF PULL", 1000);
      }
      return;
    }
    if (activeCharacter === "misc_tinker") {
      if (tinkerInspirationRef.current < 3) {
        showAbilityNotice(`INSPIRATION · ${tinkerInspirationRef.current}/3`, 750);
        return;
      }
      tinkerInspirationRef.current -= 3;
      setItems((current) => {
        const target = current
          .filter(
            (item) =>
              item.lane === state.current.lane &&
              isHazardKind(item.kind) &&
              item.kind !== "rock" &&
              item.y < 91,
          )
          .sort((left, right) => right.y - left.y)[0];
        return target ? current.filter((item) => item.id !== target.id) : current;
      });
      showAbilityNotice("HANDMADE SPIKE · FIRST PROJECTILE DESTROYED", 1000);
      return;
    }
    if (activeCharacter === "runner_ranger") {
      if (rangerCooldownUntilRef.current > Date.now()) {
        showAbilityNotice("PICKUP ZIP · RECHARGING", 700);
        return;
      }
      const target = itemsSnapshotRef.current
        .filter((item) => ["gem", "coin", "melon"].includes(item.kind))
        .sort((left, right) => right.y - left.y)[0];
      if (!target) {
        showAbilityNotice("PICKUP ZIP · NO PICKUP ON SCREEN", 700);
        return;
      }
      state.current.lane = target.lane;
      setLane(target.lane);
      grantInvincibility(300);
      rangerCooldownUntilRef.current = Date.now() + 30000;
      showAbilityNotice(`PICKUP ZIP · LANE ${target.lane + 1}`, 900);
      return;
    }
    if (activeCharacter === "misc_lantern") {
      if (lanternCooldownUntilRef.current > Date.now()) {
        showAbilityNotice("FLASH OF LIGHT · RECHARGING", 700);
        return;
      }
      obstacleFreezeUntilRef.current = Date.now() + 2000;
      lanternCooldownUntilRef.current = Date.now() + 10000;
      showAbilityNotice("FLASH OF LIGHT · ALL HAZARDS FROZEN FOR 2 SECONDS", 1100);
      return;
    }
    if (activeCharacter === "misc_weaver") {
      if (weaverSnowflakeCountRef.current < 5) {
        showAbilityNotice(`THREAD · ${weaverSnowflakeCountRef.current}/5 SNOWFLAKES`, 750);
        return;
      }
      weaverJacketRef.current = true;
      weaverSnowflakeCountRef.current = 0;
      weaverHealWaveRef.current = wave;
      weaverHealedAmountRef.current = 0;
      showAbilityNotice("THAWING JACKET · SNOWFLAKE IMMUNITY ACTIVE", 1100);
      return;
    }
    if (activeCharacter === "misc_catalyst") {
      setItems((current) =>
        current.map((item) =>
          ["gem", "coin", "melon"].includes(item.kind)
            ? { ...item, lane: state.current.lane, y: 90 }
            : item,
        ),
      );
      showAbilityNotice("FLUX PULL · ALL PICKUPS COLLECTED", 1000);
      return;
    }
    if (activeCharacter === "misc_harvester") {
      const entries = Object.entries(harvesterCountsRef.current) as Array<
        [keyof typeof harvesterCountsRef.current, number]
      >;
      const [source, amount] = entries.sort((left, right) => right[1] - left[1])[0];
      if (amount < 10 || harvesterCooldownUntilRef.current > Date.now()) {
        showAbilityNotice("HARVEST · NEED 10 OF ONE PICKUP TYPE", 800);
        return;
      }
      harvesterCooldownUntilRef.current = Date.now() + (amount >= 50 && source === "melons" ? 45000 : 30000);
      if (source === "gems") {
        grantInvincibility(amount >= 50 ? 20000 : 10000);
        showAbilityNotice(`GEM HARVEST · DEFLECTION ${amount >= 50 ? 20 : 10} SECONDS`, 1100);
      } else if (source === "melons") {
        setItems((current) => {
          if (amount >= 50) return current.filter((item) => !isHazardKind(item.kind));
          const closest = new Map<number, Item>();
          current.forEach((item) => {
            if (!isHazardKind(item.kind)) return;
            const old = closest.get(item.lane);
            if (!old || item.y > old.y) closest.set(item.lane, item);
          });
          const ids = new Set(Array.from(closest.values()).map((item) => item.id));
          return current.filter((item) => !ids.has(item.id));
        });
        showAbilityNotice("MELON HARVEST · LANE FRONTS CLEARED", 1100);
      } else {
        versusPointsRef.current += amount >= 50 ? 20 : 10;
        setVersusPoints(versusPointsRef.current);
        showAbilityNotice(`COIN HARVEST · +${amount >= 50 ? 20 : 10} ATTACK COINS`, 1000);
      }
      return;
    }
    if (
      activeCharacter === "medic_lifeline" &&
      lifelineHookUsesRef.current < 3
    ) {
      setPaused(true);
      setAbilityChoice({ kind: "lifeline-lane" });
      showAbilityNotice("RESCUE HOOK · CHOOSE ANOTHER LANE", 1000);
      return;
    }
    if (
      hasCharacterAbility("medic_reserve") &&
      reserveHealStoredRef.current
    ) {
      reserveHealStoredRef.current = false;
      const healed = Math.min(maxHearts, state.current.hearts + 0.5);
      state.current.hearts = healed;
      setHearts(healed);
      setAbilityStateVersion((value) => value + 1);
      showAbilityNotice("RESERVE DOSE · +0.5 HP", 950);
      return;
    }
    if (hasCharacterAbility("medic_tonic") && tonicPotion > 0) {
      if (reviveFlyingRef.current) {
        showAbilityNotice("FLIGHT PREVENTS ALL HEALING", 900);
        return;
      }
      const healed = Math.min(maxHearts, state.current.hearts + tonicPotion);
      state.current.hearts = healed;
      setHearts(healed);
      showAbilityNotice(`POTION · +${tonicPotion} HP`, 950);
      setTonicPotion(0);
      return;
    }
    if (
      hasCharacterAbility("medic_sprout") &&
      sproutSeedWaveRef.current !== wave
    ) {
      let planted = false;
      setItems((current) => {
        const activeSeeds = current.filter(
          (item) => (item.seededUntilWave ?? 0) >= wave,
        ).length;
        if (activeSeeds >= 2) return current;
        const target = current
          .filter(
            (item) =>
              isHazardKind(item.kind) &&
              item.kind !== "barrel" &&
              item.y >= -10 &&
              item.y < 91 &&
              !item.seededUntilWave,
          )
          .sort((left, right) => {
            const lanePriority =
              Number(right.lane === state.current.lane) -
              Number(left.lane === state.current.lane);
            return lanePriority || right.y - left.y;
          })[0];
        if (!target) return current;
        planted = true;
        return current.map((item) =>
          item.id === target.id
            ? { ...item, seededUntilWave: wave + 2 }
            : item,
        );
      });
      if (planted) sproutSeedWaveRef.current = wave;
      showAbilityNotice(
        planted ? "SEED WARD · DAMAGE -0.5 HP" : "SEED WARD · NO VALID OBSTACLE",
        950,
      );
      return;
    }
    showAbilityNotice(
      hasCharacterAbility("medic_tonic")
        ? "BREW A POTION FROM THE LEFT-SIDE MENU"
        : "NO ACTIVE ABILITY READY",
      800,
    );
  }, [
    abilityChoice,
    activeLaneCount,
    activeCharacter,
    applyVersusTimeStopState,
    grantInvincibility,
    hasCharacterAbility,
    isOnlineVersus,
    isVersusRun,
    maxHearts,
    pulseGame,
    showAbilityNotice,
    tonicPotion,
    wave,
  ]);
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
            lane_index?: number | null;
            lane_group?: number | null;
            lane_position?: number | null;
            escape_lane_index?: number | null;
          };
          if (attack.target_user_id === userIdRef.current) {
            const kind = normalizeVersusObstacle(attack.obstacle_type);
            if (
              kind &&
              !incomingAttacksRef.current.some(
                (pending) => pending.id === attack.id,
              )
            )
              incomingAttacksRef.current.push({
                id: attack.id,
                kind,
                lane:
                  Number.isInteger(attack.lane_index) &&
                  attack.lane_index !== null
                    ? Number(attack.lane_index)
                    : undefined,
                laneGroup:
                  Number.isInteger(attack.lane_group) &&
                  attack.lane_group !== null
                    ? Number(attack.lane_group)
                    : undefined,
                lanePosition:
                  Number.isInteger(attack.lane_position) &&
                  attack.lane_position !== null
                    ? Number(attack.lane_position)
                    : undefined,
                escapeLane:
                  Number.isInteger(attack.escape_lane_index) &&
                  attack.escape_lane_index !== null
                    ? Number(attack.escape_lane_index)
                    : undefined,
              });
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
            score?: number;
            current_wave_mushrooms?: number;
            obstacle_points?: number;
            username?: string;
            zenith_time_stop_until?: string | null;
            zenith_time_stop_used?: boolean;
            obstacle_speed_multiplier?: number;
          };
          if (player.user_id === userIdRef.current) {
            applyVersusTimeStopState(player, true);
            return;
          }
          setVersusOpponentHearts(Number(player.hearts));
          if (Number.isFinite(Number(player.score)))
            setVersusOpponentScore(Math.max(0, Number(player.score)));
          if (Number.isFinite(Number(player.current_wave_mushrooms)))
            setVersusOpponentMushrooms(
              Math.max(0, Number(player.current_wave_mushrooms)),
            );
          if (player.username) setVersusOpponent(player.username);
          if (player.status === "eliminated") {
            setVersusOpponentHearts(0);
            if (!versusSelfEliminatedRef.current)
              setVersusResult("RIVAL FINISHED · KEEP RUNNING FOR SCORE");
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
            is_draw?: boolean;
            intermission_ends_at?: string | null;
          };
          if (match.status === "finished") {
            versusFinishedRef.current = true;
            setVersusResult(
              match.is_draw
                ? "DRAW"
                : match.winner_user_id === userIdRef.current
                  ? "VICTORY"
                  : "DEFEAT",
            );
            setVersusPhase("finished");
            setVersusIntermissionReady(false);
            setRunning(false);
            setOver(true);
            void hydrateVersusStateRef.current?.(matchId, true);
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
            setVersusResult(remaining > 0 ? "INTERMISSION" : "STARTING NEXT WAVE");
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
    const restoredMap = normalizeMapId(snapshot.match?.map_key);
    const restoredMapRules = getMapRules(restoredMap);
    const restoredCenterLane = Math.floor(restoredMapRules.laneCount / 2);
    versusMapRef.current = restoredMap;
    setVersusMap(restoredMap);
    const validatedCharacter = getValidatedVersusCharacter(
      snapshot.self?.character_key,
      snapshot.self?.character_class,
    );
    const restoredCandidate =
      isCharacterOwned(unlocks, validatedCharacter.characterKey) &&
      isCharacterClassAllowed(
        restoredMap,
        getCharacterClassKey(validatedCharacter.characterKey),
      )
        ? validatedCharacter.characterKey
        : "runner_ace";
    const characterKey =
      restoredMapRules.forcedCharacterId ?? restoredCandidate;
    const characterClass = getCharacterClassKey(characterKey);
    const rawMaxHearts = Number(snapshot.self?.max_hearts);
    const restoredMaxHearts =
      Number.isFinite(rawMaxHearts) &&
      rawMaxHearts >= 1 &&
      rawMaxHearts <= VERSUS_MAX_HEARTS &&
      characterKey === validatedCharacter.characterKey
        ? normalizeVersusHearts(rawMaxHearts)
        : applyMapHealthModifiers(
            restoredMap,
            characterClass === "tank"
              ? 4
              : characterClass === "trickster"
                ? 2
                : 3,
            getCharacterMaxHearts(characterKey, characterClass),
          ).maxHp;
    const restoredWave = Math.max(1, Number(snapshot.self?.wave) || 1);
    const restoredScore = Math.max(0, Number(snapshot.self?.score) || 0);
    const restoredHearts = Math.min(
      restoredMaxHearts,
      normalizeVersusHearts(Number(snapshot.self?.hearts) || 0),
    );
    const authoritativeConveyor =
      restoredMap === "factory"
        ? readFactoryConveyorFromWaveRules(
            snapshot.wave_rules,
            restoredMapRules.laneCount,
            restoredWave,
          )
        : null;
    const matchStatus = snapshot.match?.status ?? "playing";
    if (snapshot.match?.mode === "casual" || snapshot.match?.mode === "ranked")
      setVersusMode(snapshot.match.mode);
    const selfEliminated = snapshot.self?.status === "eliminated";
    const matchFinished = matchStatus === "finished";

    setSelectedCharacter(characterKey);
    setVersusServerMaxHearts(restoredMaxHearts);
    if (!preserveRunState) {
      setLane(restoredCenterLane);
      state.current.lane = restoredCenterLane;
      void supabase.rpc("update_1v1_position", {
        p_match_id: matchId,
        p_lane_index: restoredCenterLane,
      });
      itemsSnapshotRef.current = [];
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
      pitchKatanaRef.current = createPitchKatanaState();
      volcanoStationaryMsRef.current = 0;
      const restoredConveyor =
        authoritativeConveyor ?? createFactoryConveyorState();
      factoryConveyorRef.current = restoredConveyor;
      setFactoryConveyor(restoredConveyor);
    } else if (authoritativeConveyor) {
      factoryConveyorRef.current = authoritativeConveyor;
      setFactoryConveyor(authoritativeConveyor);
    }
    if (!preserveRunState)
      timeStopUsedRef.current = Boolean(
        snapshot.self?.zenith_time_stop_used,
      );
    applyVersusTimeStopState(snapshot.self ?? {});
    setScore(restoredScore);
    setWave(restoredWave);
    setHearts(restoredHearts);
    // A mid-wave poll must not erase locally collected coins that are waiting
    // for the intermission-only batch receipt. The authoritative balance is
    // applied immediately after that batch succeeds.
    if (pendingVersusCoinPickupIdsRef.current.size === 0)
      applyAuthoritativeVersusPoints(snapshot.self?.obstacle_points ?? 0);
    setVersusOpponent(snapshot.opponent?.username || "RIVAL");
    setVersusOpponentHearts(
      Math.max(0, Number(snapshot.opponent?.hearts) || 0),
    );
    setVersusOpponentScore(
      Math.max(
        0,
        Number(
          snapshot.opponent?.final_score ?? snapshot.opponent?.score,
        ) || 0,
      ),
    );
    setVersusSelfMushrooms(
      Math.max(0, Number(snapshot.self?.current_wave_mushrooms) || 0),
    );
    setVersusOpponentMushrooms(
      Math.max(0, Number(snapshot.opponent?.current_wave_mushrooms) || 0),
    );
    setVersusSelfEliminated(selfEliminated);
    versusSelfEliminatedRef.current = selfEliminated;
    const restoredKatanaCooldownValue =
      snapshot.self?.katana_cooldown_until ??
      snapshot.self?.katana_cooldown_ends_at;
    const restoredKatanaCooldown =
      typeof restoredKatanaCooldownValue === "string"
        ? Date.parse(restoredKatanaCooldownValue)
        : NaN;
    pitchKatanaRef.current = {
      ...pitchKatanaRef.current,
      broken:
        pitchKatanaRef.current.broken ||
        Boolean(snapshot.self?.katana_broken),
      activeUntilMs: snapshot.self?.katana_broken
        ? 0
        : pitchKatanaRef.current.activeUntilMs,
      cooldownUntilMs: Number.isFinite(restoredKatanaCooldown)
        ? Math.max(
            pitchKatanaRef.current.cooldownUntilMs,
            restoredKatanaCooldown,
          )
        : pitchKatanaRef.current.cooldownUntilMs,
    };
    setPitchKatanaVersion((value) => value + 1);
    setPlayScope("versus");
    setOver(selfEliminated || matchFinished);
    setRunning(!selfEliminated && !matchFinished);

    const pending = (snapshot.pending_attacks ?? []).flatMap(
      (attack): PendingVersusAttack[] => {
        const kind = normalizeVersusObstacle(attack.obstacle_type);
        if (!attack.id || !kind) return [];
        return [
          {
            id: attack.id,
            kind,
            lane:
              Number.isInteger(attack.lane_index) && attack.lane_index !== null
                ? Number(attack.lane_index)
                : undefined,
            laneGroup:
              Number.isInteger(attack.lane_group) && attack.lane_group !== null
                ? Number(attack.lane_group)
                : undefined,
            lanePosition:
              Number.isInteger(attack.lane_position) &&
              attack.lane_position !== null
                ? Number(attack.lane_position)
                : undefined,
            escapeLane:
              Number.isInteger(attack.escape_lane_index) &&
              attack.escape_lane_index !== null
                ? Number(attack.escape_lane_index)
                : undefined,
          },
        ];
      },
    );
    const mergedPending = new Map(
      incomingAttacksRef.current.map((attack) => [attack.id, attack]),
    );
    pending.forEach((attack) => mergedPending.set(attack.id, attack));
    incomingAttacksRef.current = Array.from(mergedPending.values());

    if (matchFinished) {
      setPaused(false);
      setVersusPhase("finished");
      setVersusIntermissionReady(false);
      versusFinishedRef.current = true;
      const finalSelfScore = Number(snapshot.self?.final_score);
      if (Number.isFinite(finalSelfScore)) {
        scoreRef.current = Math.max(0, finalSelfScore);
        setScore(scoreRef.current);
      }
      const outcome = String(
        snapshot.outcome ?? snapshot.match?.outcome ?? "",
      ).toLowerCase();
      setVersusResult(
        snapshot.match?.is_draw || outcome === "draw"
          ? "DRAW"
          : outcome === "win" ||
              snapshot.match?.winner_user_id === userIdRef.current
            ? "VICTORY"
            : "DEFEAT",
      );
    } else if (selfEliminated) {
      setPaused(false);
      setVersusPhase("eliminated");
      setVersusIntermissionReady(false);
      setVersusResult("RUN COMPLETE · RIVAL STILL RUNNING");
    } else if (matchStatus === "intermission") {
      const remaining = secondsUntil(
        snapshot.match?.intermission_ends_at,
        VERSUS_INTERMISSION_SECONDS,
      );
      setVersusCountdown(remaining);
      setVersusPhase("intermission");
      setVersusIntermissionReady(true);
      setVersusResult("INTERMISSION");
      setPaused(true);
    } else if (snapshot.self?.status === "intermission") {
      setVersusCountdown(VERSUS_INTERMISSION_SECONDS);
      setVersusPhase("intermission");
      setVersusIntermissionReady(false);
      setVersusResult("WAITING FOR RIVAL");
      setPaused(true);
    } else {
      const attacks = Array.from(mergedPending.values()).filter(
        (attack) =>
          !spawnedAttackIdsRef.current.has(attack.id) &&
          !queuedAttackTokenIdsRef.current.has(attack.id),
      );
      incomingAttacksRef.current = [];
      if (attacks.length > 0) {
        const hasServerFormation = attacks.every(
          (attack) =>
            Number.isInteger(attack.lane) &&
            Number.isInteger(attack.laneGroup),
        );
        enqueueDeferredAttackItems(
          hasServerFormation
            ? appendServerAttackGroups(
                [], attacks, () => id.current++, restoredMapRules.laneCount,
                preserveRunState ? state.current.lane : restoredCenterLane,
                getAttackGroupSpacing(restoredWave),
              )
            : appendSafeAttackWave(
                [], attacks.map((attack) => attack.kind), () => id.current++,
                getAttackGroupSpacing(restoredWave),
                preserveRunState ? state.current.lane : restoredCenterLane,
                restoredMapRules.laneCount,
              ),
        );
      }
      setVersusPhase("playing");
      setVersusIntermissionReady(false);
      setPaused(false);
      void audioEngine.start(soundtrack);
      if (!preserveRunState)
        announceWave(restoredWave, freshMatch, characterKey, restoredMap, true);
      else if (!versusTransitionBusyRef.current)
        announceWave(restoredWave, true, characterKey, restoredMap, true);
    }
    return true;
  };
  hydrateVersusStateRef.current = hydrateVersusState;
  const beginVersusMatch = async (
    matchId: string,
    opponent: string,
    serverStatus?: string,
    serverMap?: unknown,
  ) => {
    cancelPendingProgressionStart();
    resetVersusClientSync();
    setLastRunXpBreakdown(null);
    progressionStartIntentRef.current += 1;
    progressionRunIdRef.current = matchId;
    progressionAwardedRunIdRef.current = null;
    setProgressionRunVersion((value) => value + 1);
    versusMatchRef.current = matchId;
    const joinedMap = normalizeMapId(serverMap);
    versusMapRef.current = joinedMap;
    setVersusMap(joinedMap);
    versusFinishedRef.current = false;
    versusSelfEliminatedRef.current = false;
    setVersusSelfEliminated(false);
    setMainView("versus");
    setVersusOpponent(opponent || "RIVAL");
    setVersusOpponentHearts(3);
    setVersusOpponentScore(0);
    setVersusSelfMushrooms(0);
    setVersusOpponentMushrooms(0);
    pitchKatanaRef.current = createPitchKatanaState();
    setPitchKatanaVersion((value) => value + 1);
    setVersusPoints(0);
    versusPointsRef.current = 0;
    setVersusResult("");
    setVersusIntermissionReady(false);
    incomingAttacksRef.current = [];
    spawnedAttackIdsRef.current.clear();
    queuedAttackTokenIdsRef.current.clear();
    deferredAttackGroupsRef.current = [];
    setDeferredAttackGroups([]);
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
    if (versusMode === "ranked" && !playerProgression.ranked_unlocked) {
      setVersusResult(
        `RANKED 1V1 UNLOCKS AT LEVEL ${RANKED_UNLOCK_LEVEL}`,
      );
      return;
    }
    if (
      versusMode === "ranked" &&
      getCharacterDefinition(equippedCharacter).rarity === "mythic"
    ) {
      setVersusResult(
        "MYTHIC CHARACTERS ARE DISABLED IN RANKED · CHOOSE ANOTHER CHARACTER",
      );
      return;
    }
    if (versusSearchingRef.current || versusLeaving) return;
    invalidateVersusSearch();
    const searchToken = versusSearchTokenRef.current;
    if (!preserveResult) setVersusResult("");
    setVersusPhase("searching");
    versusSearchingRef.current = true;
    const poll = async () => {
      const { data, error } = await supabase.rpc("join_1v1_queue", {
        p_mode: versusMode,
      });
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
        if (data.mode === "casual" || data.mode === "ranked")
          setVersusMode(data.mode);
        versusSearchingRef.current = false;
        if (versusPollTimerRef.current) {
          clearTimeout(versusPollTimerRef.current);
          versusPollTimerRef.current = null;
        }
        void beginVersusMatch(
          data.match_id,
          data.opponent_username,
          data.status,
          data.map_key,
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
    cancelPendingProgressionStart();
    invalidateVersusSearch();
    closeVersusChannel();
    versusMatchRef.current = null;
    versusFinishedRef.current = false;
    incomingAttacksRef.current = [];
    spawnedAttackIdsRef.current.clear();
    queuedAttackTokenIdsRef.current.clear();
    deferredAttackGroupsRef.current = [];
    setDeferredAttackGroups([]);
    botAttackPointsRef.current = 0;
    playerAttacksAgainstBotRef.current = [];
    progressionRunIdRef.current = null;
    progressionAwardedRunIdRef.current = null;
    const practiceMap =
      practiceMapChoice === "random"
        ? selectOneVersusOneMap({
            playerOnePriority: mapPriorityConfigured ? mapPriority : null,
            playerTwoPriority: null,
          })
        : practiceMapChoice;
    versusMapRef.current = practiceMap;
    setVersusMap(practiceMap);
    const practiceBotHealth = applyMapHealthModifiers(
      practiceMap,
      BOT_MAX_HEARTS,
      BOT_MAX_HEARTS,
    );
    practiceBotMaxHeartsRef.current = practiceBotHealth.maxHp;
    practiceBotNextWaveHeartsRef.current = null;
    botScoreRef.current = 0;
    botScoreCarryRef.current = 0;
    setMainView("versus");
    setPlayScope("practice");
    setVersusPhase("playing");
    setVersusOpponent("TRAINING BOT");
    setVersusOpponentHearts(practiceBotHealth.startingHp);
    setVersusOpponentScore(0);
    setVersusPoints(0);
    versusPointsRef.current = 0;
    setVersusCountdown(VERSUS_INTERMISSION_SECONDS);
    setVersusResult("");
    setVersusIntermissionReady(false);
    reset(false, practiceMap);
  };
  const clearVersusLocalSession = () => {
    resetVersusClientSync();
    versusMatchRef.current = null;
    closeVersusChannel();
    incomingAttacksRef.current = [];
    spawnedAttackIdsRef.current.clear();
    queuedAttackTokenIdsRef.current.clear();
    deferredAttackGroupsRef.current = [];
    setDeferredAttackGroups([]);
    versusAttackBusyRef.current = false;
    botAttackPointsRef.current = 0;
    botScoreRef.current = 0;
    botScoreCarryRef.current = 0;
    practiceBotMaxHeartsRef.current = BOT_MAX_HEARTS;
    practiceBotNextWaveHeartsRef.current = null;
    playerAttacksAgainstBotRef.current = [];
    setVersusAttackBusy(false);
    setVersusIntermissionReady(false);
    setPlayScope("single");
    versusMapRef.current = "classic";
    setVersusMap("classic");
    setVersusPhase("idle");
    setPaused(false);
    setVersusPoints(0);
    versusPointsRef.current = 0;
    setVersusOpponent("WAITING…");
    setVersusOpponentHearts(3);
    setVersusOpponentScore(0);
    setVersusSelfMushrooms(0);
    setVersusOpponentMushrooms(0);
    setVersusSelfEliminated(false);
    versusSelfEliminatedRef.current = false;
    pitchKatanaRef.current = createPitchKatanaState();
    setPitchKatanaVersion((value) => value + 1);
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
      cancelPendingProgressionStart();
      progressionStartIntentRef.current += 1;
      progressionRunIdRef.current = null;
      progressionAwardedRunIdRef.current = null;
      if (running && playScope === "single") resetGameToMenu();
      setPaused(false);
      setMainView("versus");
      if (versusMode === "ranked") void loadVersusLeaderboard();
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
        if (versusMode === "ranked") void loadVersusLeaderboard();
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
      !getAvailableAttacks(activeMapId).includes(kind) ||
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
      if (pulseGame) {
        e.preventDefault();
        const pressed = e.key.toUpperCase();
        setPulseGame((current) => {
          if (!current || pressed !== current.prompt) return current;
          const keys = ["A", "S", "D", "F"] as const;
          let nextPrompt = keys[Math.floor(Math.random() * keys.length)];
          if (nextPrompt === current.prompt)
            nextPrompt = keys[(keys.indexOf(nextPrompt) + 1) % keys.length];
          return { ...current, hits: current.hits + 1, prompt: nextPrompt };
        });
        void audioEngine.playSfx("click");
        return;
      }
      if (["ArrowLeft", "a", "A"].includes(e.key)) {
        e.preventDefault();
        move(-1);
      }
      if (["ArrowRight", "d", "D"].includes(e.key)) {
        e.preventDefault();
        move(1);
      }
      if (
        e.key === " " &&
        state.current.running &&
        activeMapId === "pitch" &&
        isVersusRun
      ) {
        e.preventDefault();
        triggerPitchKatana();
      } else if (e.key === " " && state.current.running && !isOnlineVersus) {
        e.preventDefault();
        toggleManualPause();
      }
      if (e.key === "e" || e.key === "E") {
        e.preventDefault();
        triggerCharacterAction();
      }
      if (
        e.key === "Enter" &&
        !state.current.running &&
        mainView === "endless" &&
        !settingsOpen &&
        !shopOpen &&
        !inventoryOpen &&
        !leaderboardOpen &&
        !adminOpen &&
        !usernameRequired
      )
        reset();
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [
    adminOpen,
    activeMapId,
    inventoryOpen,
    isOnlineVersus,
    isVersusRun,
    leaderboardOpen,
    mainView,
    move,
    pulseGame,
    reset,
    settingsOpen,
    shopOpen,
    toggleManualPause,
    triggerPitchKatana,
    triggerCharacterAction,
    usernameRequired,
  ]);
  useEffect(() => {
    if (!pulseGame) return;
    const timer = setInterval(() => {
      const remaining = Math.max(0, pulseGame.endsAt - Date.now());
      if (remaining > 0) {
        setPulseGame((current) =>
          current ? { ...current, remaining } : current,
        );
        return;
      }
      clearInterval(timer);
      const restoredHearts =
        pulseGame.hits >= 30
          ? maxHearts
          : pulseGame.hits >= 20
            ? Math.min(maxHearts, 2)
            : pulseGame.hits >= 10
              ? Math.min(maxHearts, 1)
              : 0;
      setPulseGame(null);
      state.current.hearts = restoredHearts;
      setHearts(restoredHearts);
      if (restoredHearts > 0) {
        setPaused(false);
        setRunning(true);
        showAbilityNotice(
          `LAST PULSE · ${pulseGame.hits} HITS · ${restoredHearts} HP`,
          1600,
        );
      } else {
        setPaused(false);
        setRunning(false);
        setOver(true);
        if (isBotPractice) {
          setVersusResult("PRACTICE DEFEAT");
          setVersusPhase("finished");
        } else if (isOnlineVersus) {
          setVersusSelfEliminated(true);
          versusSelfEliminatedRef.current = true;
          setVersusPhase("eliminated");
          setVersusResult("RUN COMPLETE · RIVAL STILL RUNNING");
        }
        showAbilityNotice("LAST PULSE · RESCUE FAILED", 1600);
      }
    }, 100);
    return () => clearInterval(timer);
  }, [
    isBotPractice,
    isOnlineVersus,
    maxHearts,
    pulseGame,
    showAbilityNotice,
  ]);
  useEffect(() => {
    if (!running || paused || wavePause) return;
    let raf = 0,
      prev = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(32, now - prev);
      prev = now;
      if (activeCharacter === "trickster_clockwork")
        clockworkElapsedMsRef.current += dt;
      if (
        anchorLaneLockedRef.current &&
        anchorGuardUntilRef.current <= Date.now()
      ) {
        anchorLaneLockedRef.current = false;
        showAbilityNotice("GROUND HOOK RELEASED · LANE MOVEMENT RESTORED", 900);
      }
      if (timeStopDeadlineRef.current > 0) {
        timeStopRemainingRef.current = Math.max(
          0,
          timeStopDeadlineRef.current - Date.now(),
        );
        if (timeStopRemainingRef.current === 0) {
          timeStopDeadlineRef.current = 0;
          setAbilityStateVersion((value) => value + 1);
          showAbilityNotice(
            permanentObstacleSlowRef.current < 1
              ? "TIME RESUMED · OBSTACLES PERMANENTLY 25% SLOWER"
              : "TIME RESUMED",
            1800,
          );
        }
        raf = requestAnimationFrame(tick);
        return;
      }
      const currentSpeedMultiplier = getWaveSpeedMultiplier(wave);
      const pacerRushActive =
        activeCharacter === "runner_pacer" &&
        pacerRushRemainingRef.current > 0;
      const mimicPhase = (wave - 1) % 3;
      if (activeCharacter === "runner_velocity") {
        velocityChargeMsRef.current = Math.min(
          100000,
          velocityChargeMsRef.current + dt,
        );
        const displayPercent = Math.min(
          100,
          Math.floor(velocityChargeMsRef.current / 1000),
        );
        if (displayPercent !== velocityDisplayPercentRef.current) {
          velocityDisplayPercentRef.current = displayPercent;
          setVelocityDisplayPercent(displayPercent);
        }
        const milestone = Math.min(
          100,
          Math.floor(velocityChargeMsRef.current / 10000) * 10,
        );
        if (milestone > velocityMilestoneRef.current) {
          velocityMilestoneRef.current = milestone;
          setAbilityStateVersion((value) => value + 1);
          showAbilityNotice(
            milestone === 100
              ? "MAXIMUM VELOCITY · SCORE ×3 · SPEED ×2"
              : milestone === 50
                ? "VELOCITY 50% · UPBEAT MIX ENGAGED"
                : `VELOCITY ${milestone}% · MOMENTUM RISING`,
            1100,
          );
          if (milestone >= 50) audioEngine.setTrack("energetic");
        }
      }
      const missingHealthRatio = Math.max(
        0,
        Math.min(1, 1 - state.current.hearts / Math.max(0.5, maxHearts)),
      );
      let characterSpeedMultiplier = 1;
      if (pacerRushActive) characterSpeedMultiplier *= 3;
      if (hasCharacterAbility("runner_dash"))
        characterSpeedMultiplier *= 1.06;
      if (dashBoostRemainingRef.current > 0)
        characterSpeedMultiplier *= 1.5;
      if (blitzBoostRemainingRef.current > 0)
        characterSpeedMultiplier *= 2;
      if (activeCharacter === "runner_tempo")
        characterSpeedMultiplier *= wave % 2 === 1 ? 1.15 : 0.85;
      if (activeCharacter === "tank_reactor")
        characterSpeedMultiplier *= 1 + missingHealthRatio * 0.4;
      if (activeCharacter === "runner_velocity")
        characterSpeedMultiplier *=
          1.05 + Math.min(1, velocityChargeMsRef.current / 100000);
      if (reviveFlyingRef.current) characterSpeedMultiplier *= 1.5;
      if (
        activeCharacter === "trickster_phantom" &&
        !phantomLordRef.current &&
        wave % 2 === 0
      )
        characterSpeedMultiplier *= 1.5;
      const obstacleSpeedMultiplier =
        currentSpeedMultiplier * characterSpeedMultiplier;
      if (activeMapId === "volcano") {
        const previousStationaryMs = volcanoStationaryMsRef.current;
        const nextStationaryMs = previousStationaryMs + dt;
        volcanoStationaryMsRef.current = nextStationaryMs;
        const stationaryDamage = getNewVolcanoStationaryDamage(
          previousStationaryMs / 1000,
          nextStationaryMs / 1000,
        );
        if (stationaryDamage > 0)
          applyDirectMapDamage(
            stationaryDamage,
            "VOLCANO HEAT · KEEP SWITCHING LANES",
          );
      }
      if (hasCharacterAbility("tank_atlas")) {
        atlasLaneElapsedRef.current += dt;
        if (atlasLaneElapsedRef.current >= atlasLaneLimitRef.current) {
          atlasLaneElapsedRef.current = 0;
          const nextHearts = Math.max(0, state.current.hearts - 2);
          const finalCrush = nextHearts <= 0;
          state.current.hearts = nextHearts;
          setHearts(nextHearts);
          void audioEngine.playSfx("hit");
          setFlash("life-two");
          setTimeout(() => setFlash(""), 240);
          showAbilityNotice(
            finalCrush
              ? "WORLD BEARER · THE SKY CRUSHED ATLAS"
              : "WORLD BEARER · SKY CRUSH · -2 HP",
            1200,
          );
          if (finalCrush) {
            setRunning(false);
            setPaused(false);
            setOver(true);
            if (isOnlineVersus) {
              setVersusSelfEliminated(true);
              versusSelfEliminatedRef.current = true;
              setVersusPhase("eliminated");
            }
          }
        }
      }
      if (
        now - last.current >
          Math.max(330, 980 - wave * 55) /
            activeMapRules.totalObstacleMultiplier
      ) {
        last.current = now;
        const r = Math.random(),
          danger = Math.min(0.82, 0.59 + wave * 0.025),
          baseGemChance =
            mode === "impossible" ? 0.14 : mode === "hardcore" ? 0.1 : 0.06,
          characterGemMultiplier =
            (activeCharacter === "misc_broker" ? 1.25 : 1) *
            (activeCharacter === "misc_prospector" ? 1.6 : 1) *
            (activeCharacter === "misc_mimic" && mimicPhase === 1
              ? 1.75
              : 1) *
            (activeCharacter === "trickster_wildcard" &&
            wildcardBuffRef.current === "gems"
              ? 1.5
              : 1),
          gemChance =
            activeCharacter === "runner_fortune"
              ? getFortuneGemSpawnChance(
                  baseGemChance,
                  fortuneGemCountRef.current,
                )
              : Math.min(0.3, baseGemChance * characterGemMultiplier),
          gemThreshold = 1 - gemChance,
          versusGemThreshold =
            1 -
            (activeCharacter === "runner_fortune"
              ? getFortuneGemSpawnChance(
                  0.025,
                  fortuneGemCountRef.current,
                )
              : 0.025 * characterGemMultiplier),
          attackPickupChance =
            activeCharacter === "misc_broker"
              ? ATTACK_COIN_SPAWN_CHANCE * 1.25
              : ATTACK_COIN_SPAWN_CHANCE,
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
        const randomHazard = () => {
          const plannedWave = waveSpawnPlanRef.current;
          if (
            plannedWave?.wave === wave &&
            plannedWave.cursor < plannedWave.kinds.length
          )
            return plannedWave.kinds[plannedWave.cursor];
          if (!isVersusRun)
            return hazardChoices[
              Math.floor(Math.random() * hazardChoices.length)
            ];
          let selected: Kind = "log";
          for (let attempt = 0; attempt < 8; attempt += 1) {
            const natural = chooseNaturalObstacle(activeMapId);
            selected = natural === "spike" ? "spikes" : natural;
            if (
              ambientHazardStreakRef.current.count < sameHazardLimit ||
              selected !== ambientHazardStreakRef.current.kind
            )
              break;
          }
          return selected;
        };
        let kind: Kind;
        if (isVersusRun && r < attackPickupChance) kind = "coin";
        else if (!isVersusRun && r < attackPickupChance) kind = "melon";
        else if (isVersusRun && r > versusGemThreshold) kind = "gem";
        else if (r < danger || isVersusRun) kind = randomHazard();
        else if (r > gemThreshold) kind = "gem";
        else kind = randomHazard();
        const advancePlannedHazard = () => {
          const plannedWave = waveSpawnPlanRef.current;
          if (
            plannedWave?.wave === wave &&
            plannedWave.kinds[plannedWave.cursor] === kind
          )
            plannedWave.cursor += 1;
        };
        if (
          isHazardKind(kind) &&
          phoenixFeatherActiveRef.current &&
          phoenixFeatherReadyWaveRef.current === wave
        ) {
          phoenixFeatherReadyWaveRef.current = wave + 1;
          advancePlannedHazard();
          showAbilityNotice("PHOENIX FEATHER · FIRST OBSTACLE DESTROYED", 900);
        } else {
          const currentItems = itemsSnapshotRef.current;
          const reservedAttackSafeLanes = new Set(
            currentItems
              .filter(
                (item) =>
                  item.attackGroup !== undefined && item.y < 91,
              )
              .flatMap((item) =>
                item.attackSafeLanes
                  ? [...item.attackSafeLanes]
                  : Number.isInteger(item.attackEscapeLane)
                    ? [Number(item.attackEscapeLane)]
                    : [],
              ),
          );
          const queuedAttackLanes = new Set(
            (deferredAttackGroupsRef.current[0] ?? []).map(
              (item) => item.lane,
            ),
          );
          const hazardLanes = new Set(
            currentItems
              .filter(
                (item) => isHazardKind(item.kind) && item.y < 18,
              )
              .map((item) => item.lane),
          );
          const hazardLaneLimitReached =
            isHazardKind(kind) &&
            hazardLanes.size >=
              (isVersusRun
                ? Math.max(1, activeLaneCount - 1)
                : modeRules.hazardLaneLimit);
          // A lane stays occupied until its current object leaves the track.
          // This prevents fast barrels or snowflakes from overtaking rocks,
          // gems, and every other slower object in the same lane.
          const blocked = new Set(
            currentItems
              .filter((item) => item.y < 108)
              .map((item) => item.lane),
          );
          const spawnableLanes =
            kind === "current" && activeMapId === "skyway"
              ? [...CURRENT_RULES.allowedLaneIndexes]
              : getTrackLanes(activeLaneCount);
          const lanes = hazardLaneLimitReached
            ? []
            : spawnableLanes.filter(
                (lane) =>
                  !blocked.has(lane) &&
                  !queuedAttackLanes.has(lane) &&
                  (!isHazardKind(kind) ||
                    !reservedAttackSafeLanes.has(lane)),
              );
          if (lanes.length > 0) {
            const spawnLane = lanes[Math.floor(Math.random() * lanes.length)];
            advancePlannedHazard();
            if (isHazardKind(kind)) {
              const previous = ambientHazardStreakRef.current;
              ambientHazardStreakRef.current =
                previous.kind === kind
                  ? { kind, count: previous.count + 1 }
                  : { kind, count: 1 };
            }
            const nextItems = [
              ...currentItems,
              { id: id.current++, lane: spawnLane, y: -10, kind },
            ];
            itemsSnapshotRef.current = nextItems;
            setItems(nextItems);
          }
        }
      }
      setItems((old) => {
        let clearRecoveryZone = false;
        let clearDamagedLane = false;
        let relayDischarge = false;
        const getItemSpeedFactor = (item: Item) => {
          const isHazard = isHazardKind(item.kind);
          let speedFactor =
            item.formationSpeed !== undefined
              ? item.formationSpeed
              : item.kind === "barrel"
              ? 1.75
              : item.kind === "current"
                ? 1.75 * CURRENT_RULES.barrelSpeedMultiplier
              : item.kind === "car"
                ? 1.28
                : item.kind === "log"
                  ? 0.72
                  : item.kind === "rock"
                  ? 0.3
                  : 1;
          if (isHazard) {
            speedFactor *= permanentObstacleSlowRef.current;
            if (beaconActiveRef.current) speedFactor *= 0.5;
            if (obstacleFreezeUntilRef.current > Date.now()) speedFactor = 0;
            if (activeCharacter === "runner_drift")
              speedFactor *= 1 + driftStackPercentRef.current;
            if (activeCharacter === "trickster_clockwork") {
              const slow = Math.min(
                0.6,
                0.1 + (clockworkElapsedMsRef.current / 1000) * 0.005,
              );
              speedFactor *= 1 - slow;
            }
            if (
              activeCharacter === "tank_colossus" &&
              state.current.hearts > 3
            )
              speedFactor *= Math.max(
                0.2,
                1 - (state.current.hearts - 3) * 0.05,
              );
            if (
              activeCharacter === "trickster_jester" &&
              jesterEffectRef.current.kind === "neutral"
            )
              speedFactor *= 1 + jesterEffectRef.current.percent;
          }
          if (
            isHazard &&
            item.formationSpeed === undefined &&
            activeMapId === "factory"
          )
            speedFactor *= getFactoryObstacleSpeedMultiplier(
              item.lane,
              factoryConveyorRef.current,
            );
          if (
            item.formationSpeed === undefined &&
            activeCharacter === "tank_drag" &&
            (item.kind === "barrel" || item.kind === "log")
          )
            speedFactor *= 0.85;
          if (isHazard && activeCharacter === "misc_nomad")
            speedFactor *= 0.93;
          if (
            item.formationSpeed === undefined &&
            item.kind === "spikes" &&
            activeCharacter === "misc_tinker"
          )
            speedFactor *= 0.75;
          if (
            item.formationSpeed === undefined &&
            (item.kind === "rock" || item.kind === "spikes") &&
            activeCharacter === "misc_lantern"
          )
            speedFactor *= 0.85;
          if (
            item.formationSpeed === undefined &&
            item.kind === "snowflake" &&
            activeCharacter === "misc_weaver"
          )
            speedFactor *= 0.65;
          if (
            isHazard &&
            activeCharacter === "misc_mimic" &&
            mimicPhase === 0
          )
            speedFactor *= 0.82;
          if (
            (item.kind === "gem" ||
              item.kind === "coin" ||
              item.kind === "melon") &&
            activeCharacter === "misc_mimic" &&
            mimicPhase === 2
          )
            speedFactor *= 0.65;
          if (
            (item.kind === "gem" ||
              item.kind === "coin" ||
              item.kind === "melon") &&
            activeCharacter === "misc_catalyst"
          )
            speedFactor *=
              Math.abs(item.lane - state.current.lane) >= 2 ? 0.5 : 1.5;
          if (
            (item.kind === "gem" ||
              item.kind === "coin" ||
              item.kind === "melon") &&
            activeCharacter === "misc_harvester"
          )
            speedFactor *= 0.55;
          if (isHazard && activeCharacter === "misc_muse")
            speedFactor *= 0.82;
          if (
            item.formationSpeed === undefined &&
            item.kind === "barrel" &&
            activeCharacter === "tank_sentinel" &&
            sentinelBarrelSlowUntilRef.current > Date.now()
          )
            speedFactor *= 0.25;
          if (
            isHazard &&
            activeCharacter === "trickster_wildcard" &&
            wildcardBuffRef.current === "slow"
          )
            speedFactor *= 0.85;
          // Purchased formations start from one shared speed so mixed obstacle
          // types keep the same readable safe route. Global character effects
          // still apply, including freeze, Drift, Clockwork, and Jester.
          return speedFactor;
        };
        const nextYById = new Map<number, number>();
        const itemsByLane = new Map<number, Item[]>();
        old.forEach((item) => {
          const laneItems = itemsByLane.get(item.lane) ?? [];
          laneItems.push(item);
          itemsByLane.set(item.lane, laneItems);
        });
        itemsByLane.forEach((laneItems) => {
          let frontY = Number.POSITIVE_INFINITY;
          [...laneItems]
            .sort((left, right) => right.y - left.y || left.id - right.id)
            .forEach((item) => {
              const proposedY = pendingKatanaReflectionIdsRef.current.has(
                item.id,
              )
                ? 65
                : item.y +
                  BASE_ITEM_SPEED *
                    obstacleSpeedMultiplier *
                    getItemSpeedFactor(item) *
                    dt;
              const separatedY = Number.isFinite(frontY)
                ? Math.min(proposedY, frontY - MIN_SAME_LANE_GAP)
                : proposedY;
              nextYById.set(item.id, separatedY);
              frontY = separatedY;
            });
        });
        const advanced = old.flatMap((item) => {
          const isHazard = isHazardKind(item.kind);
          const n = {
            ...item,
            y: nextYById.get(item.id) ?? item.y,
          };
          if (
            activeCharacter === "runner_flare" &&
            flareActiveUntilRef.current > Date.now() &&
            n.lane === flareLaneRef.current &&
            (n.kind === "log" ||
              n.kind === "barrel" ||
              n.kind === "snowflake")
          ) {
            flareBurnCountRef.current += 1;
            if (n.attackToken && isOnlineVersus && versusMatchRef.current)
              void supabase.rpc("reflect_1v1_attack", {
                p_match_id: versusMatchRef.current,
                p_reflection_id: `flare:${versusPickupNonceRef.current}:${wave}:${n.id}`,
                p_obstacle_type: n.kind,
              });
            if (flareBurnCountRef.current % 10 === 0)
              showAbilityNotice(
                `FLARE MASTERED · COOLDOWN ${Math.max(15, 30 - Math.floor(flareBurnCountRef.current / 10) * 5)}s`,
                900,
              );
            return [];
          }
          if (pendingKatanaReflectionIdsRef.current.has(n.id))
            return [n];
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
              rogueGrazeCooldownUntilRef.current = Date.now() + 5000;
              rogueGrazeMeterRef.current += 1;
              setAbilityStateVersion((value) => value + 1);
              showAbilityNotice(
                `SHADOW METER · ${rogueGrazeMeterRef.current} GRAZE${rogueGrazeMeterRef.current === 1 ? "" : "S"}`,
                850,
              );
            }
            if (
              activeCharacter === "trickster_echo" &&
              echoGrazeCooldownUntilRef.current <= Date.now()
            ) {
              echoGrazeCooldownUntilRef.current = Date.now() + 2000;
              grantInvincibility(650);
              const echoScore = 40 + 10 * wave;
              setScore((value) => value + echoScore);
              showAbilityNotice(
                `ECHO GRAZE · SHIELD +${echoScore} SCORE`,
                1000,
              );
            }
          }
          const rangerPickup =
            activeCharacter === "runner_ranger" &&
            (n.kind === "gem" ||
              n.kind === "coin" ||
              n.kind === "melon") &&
            Math.abs(n.lane - state.current.lane) <= 1;
          const rangerPulled =
            rangerPickup && n.lane !== state.current.lane;
          const currentInteraction =
            n.kind === "current" && activeMapId === "skyway"
              ? resolveCurrentInteraction(state.current.lane, n.lane)
              : null;
          const currentContact =
            currentInteraction !== null && currentInteraction.kind !== "none";
          if (
            !damageLockedRef.current &&
            (n.lane === state.current.lane || rangerPickup || currentContact) &&
            crossedRunnerBand
          ) {
            let phantomIgnore = false;
            if (isHazard) {
              collisionWaveRef.current = wave;
              if (activeCharacter === "medic_oracle")
                oracleHitCountRef.current += 1;
              if (activeCharacter === "runner_velocity") {
                velocityChargeMsRef.current = 0;
                velocityMilestoneRef.current = 0;
                velocityDisplayPercentRef.current = 0;
                setVelocityDisplayPercent(0);
                setAbilityStateVersion((value) => value + 1);
                showAbilityNotice("FULL VELOCITY · MOMENTUM RESET", 800);
              }
              if (activeCharacter === "trickster_phantom") {
                const priorHits = phantomKindHitsRef.current[n.kind] ?? 0;
                const ignoreCount =
                  !phantomLordRef.current && wave % 2 === 0 ? 2 : 1;
                phantomKindHitsRef.current[n.kind] = priorHits + 1;
                phantomIgnore = priorHits < ignoreCount;
              }
            }
            if (rangerPulled)
              showAbilityNotice("PICKUP MAGNET · ADJACENT PICKUP");
            if (
              n.kind === "gem" ||
              n.kind === "coin" ||
              n.kind === "melon" ||
              n.kind === "mushroom"
            ) {
              if (processedPickupIdsRef.current.has(n.id)) return [];
              processedPickupIdsRef.current.add(n.id);
              if (hasCharacterAbility("runner_courier")) {
                courierBoostRemainingRef.current = 4000;
                showAbilityNotice("SPECIAL DELIVERY · SCORE ×1.25", 900);
              }
            }
            if (
              isHazard &&
              lifelineImmuneKindsRef.current.has(n.kind)
            ) {
              void audioEngine.playSfx("shield");
              showAbilityNotice(`LIFELINE · ${n.kind.toUpperCase()} IMMUNE`, 850);
              return [];
            }
            if (
              isHazard &&
              beaconActiveRef.current &&
              n.kind === "spikes"
            ) {
              void audioEngine.playSfx("shield");
              showAbilityNotice("BEACON · SPIKES DEACTIVATED", 850);
              return [];
            }
            if (
              isHazard &&
              reviveFlyingRef.current &&
              (n.kind === "log" || n.kind === "spikes")
            ) {
              showAbilityNotice("FLIGHT · OBSTACLE CLEARED", 750);
              return [];
            }
            if (
              isHazard &&
              hasCharacterAbility("medic_seraph") &&
              seraphTeleportChanceRef.current > 0 &&
              Math.random() * 100 < seraphTeleportChanceRef.current
            ) {
              const occupiedLanes = new Set(
                old
                  .filter(
                    (candidate) =>
                      candidate.id !== n.id &&
                      isHazardKind(candidate.kind) &&
                      candidate.y >= 48 &&
                      candidate.y <= 102,
                  )
                  .map((candidate) => candidate.lane),
              );
              const emptyLanes = getTrackLanes(activeLaneCount).filter(
                (candidateLane) =>
                  candidateLane !== state.current.lane &&
                  !occupiedLanes.has(candidateLane),
              );
              if (emptyLanes.length > 0) {
                const destination =
                  emptyLanes[Math.floor(Math.random() * emptyLanes.length)];
                state.current.lane = destination;
                setLane(destination);
                seraphTeleportChanceRef.current = Math.max(
                  0,
                  seraphTeleportChanceRef.current - 5,
                );
                setAbilityStateVersion((value) => value + 1);
                if (isOnlineVersus && versusMatchRef.current)
                  void supabase.rpc("update_1v1_position", {
                    p_match_id: versusMatchRef.current,
                    p_lane_index: destination,
                  });
                showAbilityNotice(
                  `SERAPHIC SHIFT · ${seraphTeleportChanceRef.current}% REMAINS`,
                  1000,
                );
                void audioEngine.playSfx("shield");
                return [];
              }
            }
            if (
              isHazard &&
              hasCharacterAbility("runner_vector") &&
              (state.current.lane === 0 ||
                state.current.lane === activeLaneCount - 1) &&
              vectorBlockWaveRef.current !== wave
            ) {
              vectorBlockWaveRef.current = wave;
              showAbilityNotice("EDGE VECTOR · FIRST EDGE HIT BLOCKED", 900);
              void audioEngine.playSfx("shield");
              return [];
            }
            if (
              isHazard &&
              activeCharacter === "medic_oracle" &&
              oracleInvincibleWaveRef.current === wave
            ) {
              showAbilityNotice("NO-HIT PROPHECY · INVINCIBLE", 800);
              return [];
            }
            if (isHazard && activeMapId === "pitch") {
              const attackKind: AttackId =
                n.kind === "spikes" ? "spike" : (n.kind as AttackId);
              const katanaCollision = resolvePitchKatanaCollision(
                pitchKatanaRef.current,
                attackKind,
                Date.now(),
              );
              if (katanaCollision.kind !== "inactive") {
                pitchKatanaRef.current = katanaCollision.state;
                setPitchKatanaVersion((value) => value + 1);
                const reflectionId = `katana:${versusPickupNonceRef.current}:${n.attackToken ?? n.id}`;
                if (isOnlineVersus && versusMatchRef.current) {
                  const matchId = versusMatchRef.current;
                  const waitsForServer =
                    katanaCollision.kind === "deflected";
                  if (waitsForServer)
                    pendingKatanaReflectionIdsRef.current.add(n.id);
                  const reflectionArgs = n.attackToken
                    ? {
                        p_match_id: matchId,
                        p_reflection_id: reflectionId,
                        p_obstacle_type: attackKind,
                        p_source_attack_id: n.attackToken,
                      }
                    : {
                        p_match_id: matchId,
                        p_reflection_id: reflectionId,
                        p_obstacle_type: attackKind,
                      };
                  void supabase
                    .rpc("reflect_1v1_attack", reflectionArgs)
                    .then(({ data, error }) => {
                      pendingKatanaReflectionIdsRef.current.delete(n.id);
                      if (versusMatchRef.current !== matchId) return;
                      if (error) {
                        setVersusResult(error.message);
                        if (waitsForServer) {
                          pitchKatanaRef.current = {
                            ...pitchKatanaRef.current,
                            activeUntilMs: 0,
                            hitDuringActivation: true,
                            whiffSettled: true,
                          };
                          setPitchKatanaVersion((value) => value + 1);
                          showAbilityNotice(
                            "KATANA REFLECTION REJECTED",
                            1100,
                          );
                        }
                        return;
                      }
                      const cooldownValue =
                        data?.katana_cooldown_until ??
                        data?.katana_cooldown_ends_at;
                      const cooldown =
                        typeof cooldownValue === "string"
                          ? Date.parse(cooldownValue)
                          : NaN;
                      pitchKatanaRef.current = {
                        ...pitchKatanaRef.current,
                        broken:
                          pitchKatanaRef.current.broken ||
                          Boolean(data?.katana_broken),
                        activeUntilMs: data?.katana_broken
                          ? 0
                          : pitchKatanaRef.current.activeUntilMs,
                        cooldownUntilMs: Number.isFinite(cooldown)
                          ? cooldown
                          : pitchKatanaRef.current.cooldownUntilMs,
                      };
                      setPitchKatanaVersion((value) => value + 1);
                      if (waitsForServer) {
                        setItems((current) =>
                          current.filter((candidate) => candidate.id !== n.id),
                        );
                        void audioEngine.playSfx("shield");
                        setFlash("shield");
                        setTimeout(() => setFlash(""), 150);
                        showAbilityNotice(
                          `${attackKind.toUpperCase()} REFLECTED`,
                          900,
                        );
                      }
                    });
                  if (waitsForServer) return [{ ...n, y: 65 }];
                } else if (
                  isBotPractice &&
                  katanaCollision.sendToOpponent
                )
                  playerAttacksAgainstBotRef.current.push(attackKind);
                if (
                  katanaCollision.kind === "deflected" &&
                  !isOnlineVersus
                ) {
                  void audioEngine.playSfx("shield");
                  setFlash("shield");
                  setTimeout(() => setFlash(""), 150);
                  showAbilityNotice(
                    `${attackKind.toUpperCase()} REFLECTED`,
                    900,
                  );
                  return [];
                }
                showAbilityNotice("ROCK SHATTERED YOUR KATANA", 1300);
              }
            }
            if (
              activeCharacter === "trickster_phantom" &&
              wave % 5 === 0 &&
              phantomBloodmoonKindsRef.current.has(n.kind)
            ) {
              state.current.hearts = Math.min(
                phantomHealthCapRef.current,
                state.current.hearts + 2,
              );
              setHearts(state.current.hearts);
              void audioEngine.playSfx("shield");
              showAbilityNotice(
                `BLOODMOON ${n.kind.toUpperCase()} · +2 HP`,
                1000,
              );
              return [];
            }
            const vialAllegianceActive =
              activeCharacter === "medic_vial" &&
              vialAllegianceUntilRef.current > Date.now();
            if (vialAllegianceActive && n.kind === "current") {
              const previousLane = state.current.lane;
              if (previousLane !== n.lane) {
                state.current.lane += Math.sign(n.lane - previousLane);
                setLane(state.current.lane);
                if (isOnlineVersus && versusMatchRef.current)
                  void supabase.rpc("update_1v1_position", {
                    p_match_id: versusMatchRef.current,
                    p_lane_index: state.current.lane,
                  });
                showAbilityNotice("SWITCHED CURRENT · PULLED ONE LANE CLOSER", 950);
              } else {
                showAbilityNotice("SWITCHED CURRENT · NO EFFECT IN ITS LANE", 850);
              }
              return [];
            }
            if (vialAllegianceActive && n.kind === "snowflake") {
              state.current.hearts = Math.min(
                maxHearts,
                state.current.hearts + 1,
              );
              setHearts(state.current.hearts);
              clearFreezeEffect();
              showAbilityNotice("SWITCHED SNOWFLAKE · +1 HP", 900);
              return [];
            }
            if (vialAllegianceActive && isHazard) {
              const healing =
                n.kind === "rock" ? 2 : n.kind === "barrel" ? 0.5 : 1;
              state.current.hearts = Math.min(
                maxHearts,
                state.current.hearts + healing,
              );
              setHearts(state.current.hearts);
              showAbilityNotice(
                `SWITCHED ${n.kind.toUpperCase()} · +${healing} HP`,
                900,
              );
              return [];
            }
            if (n.kind === "mushroom") {
              void audioEngine.playSfx("gem");
              scoreRef.current += GROVE_RULES.mushroomScore;
              setScore(scoreRef.current);
              setVersusSelfMushrooms((value) => value + 1);
              showAbilityNotice(
                `MUSHROOM · +${GROVE_RULES.mushroomScore} SCORE`,
                900,
              );
              const matchId = versusMatchRef.current;
              if (isOnlineVersus && matchId)
                void supabase
                  .rpc("award_1v1_mushroom", {
                    p_match_id: matchId,
                    p_wave: wave,
                    p_pickup_id: `mushroom:${versusPickupNonceRef.current}:${n.id}`,
                  })
                  .then(({ data, error }) => {
                    if (error || versusMatchRef.current !== matchId) {
                      if (error) setVersusResult(error.message);
                      return;
                    }
                    const authoritativeScore = Number(data?.score);
                    if (Number.isFinite(authoritativeScore)) {
                      scoreRef.current = Math.max(
                        scoreRef.current,
                        Math.max(0, authoritativeScore),
                      );
                      setScore(scoreRef.current);
                    }
                    const authoritativeMushrooms = Number(
                      data?.current_wave_mushrooms ?? data?.wave_mushrooms,
                    );
                    if (Number.isFinite(authoritativeMushrooms))
                      setVersusSelfMushrooms(
                        Math.max(0, authoritativeMushrooms),
                      );
                    applyAuthoritativeVersusPoints(data?.obstacle_points);
                  });
            } else if (n.kind === "gem") {
              void audioEngine.playSfx("gem");
              if (!isBotPractice) {
                const gemAward = isVersusRun
                  ? 1
                  : (gemStreakRef.current += 1);
                const adjustedGemAward =
                  activeCharacter === "trickster_pickpocket"
                    ? gemAward * 2
                    : gemAward;
                const total = gemsRef.current + adjustedGemAward;
                gemsRef.current = total;
                setGems(total);
                setGemBump(false);
                requestAnimationFrame(() => setGemBump(true));
                setTimeout(() => setGemBump(false), 500);
                if (guest && adjustedGemAward > 1)
                  showAbilityNotice(
                    `GEM STREAK · +${adjustedGemAward} GEMS`,
                    950,
                  );
              }
              if (activeCharacter === "runner_spark") {
                sparkGemCountRef.current += 1;
                setAbilityStateVersion((value) => value + 1);
                showAbilityNotice(
                  `CRYSTAL CHARGE · PERMANENT RUN SCORE +${sparkGemCountRef.current}%`,
                  900,
                );
              }
              if (activeCharacter === "runner_fortune") {
                fortuneGemCountRef.current += 1;
                setAbilityStateVersion((value) => value + 1);
                showAbilityNotice(
                  `FORTUNE FINDER · +${fortuneGemCountRef.current}% GEM CHANCE`,
                  900,
                );
              }
              if (activeCharacter === "misc_broker")
                brokerFundsRef.current.gems += 1;
              if (activeCharacter === "misc_harvester")
                harvesterCountsRef.current.gems += 1;
              if (
                healingEnabled &&
                hasCharacterAbility("medic_bloom") &&
                !reviveFlyingRef.current &&
                bloomGemWaveRef.current !== wave
              ) {
                bloomGemWaveRef.current = wave;
                setHearts((value) => {
                  const healed = Math.min(maxHearts, value + 0.5);
                  state.current.hearts = healed;
                  return healed;
                });
                showAbilityNotice("HEALING BLOOM · +0.5 HP", 850);
              }
              if (hasCharacterAbility("medic_tonic")) {
                setTonicIngredients((value) => value + 1);
                showAbilityNotice("FIELD ALCHEMY · +1 INGREDIENT", 750);
              }
              if (
                healingEnabled &&
                activeCharacter === "medic_seraph" &&
                !reviveFlyingRef.current &&
                Math.random() < 0.1
              ) {
                setHearts((value) => {
                  const healed = Math.min(maxHearts, value + 1);
                  state.current.hearts = healed;
                  return healed;
                });
                showAbilityNotice("HALO STAFF · +1 HP", 900);
              }
              if (activeCharacter === "medic_vial") {
                const vialDamage =
                  vialAllegianceUntilRef.current > Date.now() ? 2 : 1;
                applyCharacterSelfDamage(
                  vialDamage,
                  `VIAL GEM COST · -${vialDamage} HP`,
                );
              }
              const gemContextId = progressionRunIdRef.current;
              const gemRequestUserId = userIdRef.current;
              if (!isBotPractice && gemRequestUserId && gemContextId)
                queueGemClaim(gemContextId, n.id, gemRequestUserId);
            } else if (n.kind === "melon") {
              void audioEngine.playSfx("gem");
              const melonScore = Math.max(
                0,
                Math.floor(
                  MELON_BASE_SCORE *
                    currentCoinMultiplierRef.current *
                    (activeCharacter === "runner_ranger" ? 2 : 1),
                  ),
              );
              if (vialAllegianceActive) {
                scoreRef.current = Math.max(0, scoreRef.current - melonScore);
                setScore(scoreRef.current);
                applyCharacterSelfDamage(
                  1,
                  `SWITCHED MELON · -1 HP · -${melonScore} SCORE`,
                );
              } else {
                scoreRef.current += melonScore;
                setScore(scoreRef.current);
                showAbilityNotice(`MELON · +${melonScore} SCORE`, 900);
                if (activeCharacter === "misc_broker")
                  brokerFundsRef.current.melons += melonScore;
                if (activeCharacter === "misc_harvester")
                  harvesterCountsRef.current.melons += 1;
              }
            } else if (n.kind === "coin") {
              void audioEngine.playSfx("gem");
              if (isBotPractice) {
                versusPointsRef.current +=
                  getAttackPointsForCoin(activeMapId) *
                  currentCoinMultiplierRef.current;
                setVersusPoints(versusPointsRef.current);
              } else if (isOnlineVersus && versusMatchRef.current) {
                queueOnlineCoinAward(versusMatchRef.current, n.id);
              }
              if (activeCharacter === "misc_broker")
                brokerFundsRef.current.coins += 1;
              if (activeCharacter === "misc_harvester")
                harvesterCountsRef.current.coins += 1;
            } else if (
              n.kind === "current" &&
              currentInteraction?.kind === "push"
            ) {
              state.current.lane = currentInteraction.nextLane;
              setLane(currentInteraction.nextLane);
              if (isOnlineVersus && versusMatchRef.current)
                void supabase.rpc("update_1v1_position", {
                  p_match_id: versusMatchRef.current,
                  p_lane_index: currentInteraction.nextLane,
                });
              void audioEngine.playSfx("move");
              showAbilityNotice("CURRENT · FORCED LANE PUSH", 850);
              return [];
            } else if (n.kind === "snowflake") {
              if (activeCharacter === "trickster_phantom") {
                if (wave % 5 === 0) {
                  state.current.hearts = Math.min(
                    phantomHealthCapRef.current,
                    state.current.hearts + 1,
                  );
                  setHearts(state.current.hearts);
                  clearFreezeEffect();
                  showAbilityNotice("BLOODMOON SNOWFLAKE · +1 HP", 900);
                  return [];
                }
                if (!phantomLordRef.current && wave % 2 === 0) {
                  clearFreezeEffect();
                  void audioEngine.playSfx("shield");
                  showAbilityNotice("NIGHT VEIL · SNOWFLAKE BLOCKED", 850);
                  return [];
                }
              }
              if (activeCharacter === "runner_scout" && scoutSnowflakeHealReadyRef.current) {
                scoutSnowflakeHealReadyRef.current = false;
                state.current.hearts = Math.min(maxHearts, state.current.hearts + 0.5);
                setHearts(state.current.hearts);
                showAbilityNotice("QUICKSTEP CATCH · +0.5 HP", 900);
              }
              if (activeCharacter === "misc_weaver") {
                if (weaverJacketRef.current) {
                  if (weaverHealWaveRef.current !== wave) {
                    weaverHealWaveRef.current = wave;
                    weaverHealedAmountRef.current = 0;
                  }
                  const resolved = resolveWeaverSnowflake(
                    {
                      snowflakesSinceJacket:
                        weaverSnowflakeCountRef.current,
                      healedThisWave: weaverHealedAmountRef.current,
                    },
                    true,
                  );
                  weaverSnowflakeCountRef.current =
                    resolved.state.snowflakesSinceJacket;
                  weaverHealedAmountRef.current =
                    resolved.state.healedThisWave;
                  if (resolved.healing > 0) {
                    state.current.hearts = Math.min(
                      maxHearts,
                      state.current.hearts + resolved.healing,
                    );
                    setHearts(state.current.hearts);
                    showAbilityNotice(
                      `THAWING JACKET · +${resolved.healing} HP`,
                      900,
                    );
                  } else
                    showAbilityNotice(
                      "THAWING JACKET · FREEZE BLOCKED",
                      800,
                    );
                  setAbilityStateVersion((value) => value + 1);
                  return [];
                }
                weaverSnowflakeCountRef.current += 1;
                setAbilityStateVersion((value) => value + 1);
              }
              if (
                healingEnabled &&
                hasCharacterAbility("medic_remedy") &&
                !reviveFlyingRef.current &&
                remedySnowflakeWaveRef.current !== wave
              ) {
                remedySnowflakeWaveRef.current = wave;
                setHearts((value) => {
                  const healed = Math.min(maxHearts, value + 1);
                  state.current.hearts = healed;
                  return healed;
                });
                showAbilityNotice("COLD REMEDY · +1 HP", 900);
              }
              if (hasCharacterAbility("tank_glacier")) {
                void audioEngine.playSfx("shield");
                clearFreezeEffect();
                showAbilityNotice("FROST ARMOR · FREEZE BLOCKED");
              } else {
                void audioEngine.playSfx("freeze");
                applyFreezeEffect(
                  activeCharacter === "runner_scout" ? 1500 : 3000,
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
              (n.kind === "spikes" || n.kind === "log") &&
              wardenBlockWaveRef.current !== wave
            ) {
              wardenBlockWaveRef.current = wave;
              void audioEngine.playSfx("shield");
              setFlash("shield");
              setTimeout(() => setFlash(""), 150);
              showAbilityNotice(`VAULT · FIRST ${n.kind.toUpperCase()} BLOCKED`);
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
            } else if (n.kind === "spikes" && n.deactivated) {
              void audioEngine.playSfx("shield");
              setFlash("shield");
              setTimeout(() => setFlash(""), 150);
              showAbilityNotice("DEACTIVATED SPIKES · 0 DAMAGE");
              return [];
            } else if (
              activeCharacter === "tank_citadel" &&
              citadelBlocksRemainingRef.current > 0
            ) {
              citadelBlocksRemainingRef.current -= 1;
              void audioEngine.playSfx("shield");
              setFlash("shield");
              setTimeout(() => setFlash(""), 150);
              showAbilityNotice(
                `CITADEL · OBSTACLE IGNORED · ${citadelBlocksRemainingRef.current} LEFT`,
              );
              return [];
            } else if (phantomIgnore) {
              void audioEngine.playSfx("shield");
              setFlash("shield");
              setTimeout(() => setFlash(""), 150);
              showAbilityNotice(
                `${wave % 2 === 0 ? "NIGHT VEIL" : "PHASE VEIL"} · ${n.kind.toUpperCase()} IGNORED`,
              );
              return [];
            } else if (
              activeCharacter === "trickster_phantom" &&
              phantomLordRef.current &&
              phantomLordNegationStreakRef.current < 3 &&
              Math.random() < 0.5
            ) {
              phantomLordNegationStreakRef.current += 1;
              void audioEngine.playSfx("shield");
              setFlash("shield");
              setTimeout(() => setFlash(""), 150);
              showAbilityNotice(
                `LORD VEIL · HIT NEGATED · ${phantomLordNegationStreakRef.current}/3 CHAIN`,
                950,
              );
              return [];
            } else {
              if (
                activeCharacter === "trickster_phantom" &&
                phantomLordRef.current
              )
                phantomLordNegationStreakRef.current = 0;
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
              const rawDamage =
                mode === "impossible"
                  ? 1
                  : n.kind === "current"
                    ? currentInteraction?.damage ??
                      CURRENT_RULES.directHitDamage
                  : n.kind === "rock"
                    ? 2
                    : n.kind === "barrel"
                      ? 0.5
                      : 1;
              let abilityAdjustedDamage = rawDamage;
              if (
                activeClass === "tank" ||
                activeCharacter === "medic_mercy"
              ) {
                const tankResult = calculateTankDamage({
                  character: activeCharacter as TankCharacterKey,
                  source: n.kind as HazardKind,
                  baseDamage: rawDamage,
                  currentHearts: state.current.hearts,
                  bulwarkPlateAvailable:
                    firstGuardWaveRef.current !== wave,
                  mercyPassiveActive: mercyChainActiveRef.current,
                  mercyContinuationRoll: Math.random(),
                  spikeDeactivated: Boolean(n.deactivated),
                  bastionSecondsInLane:
                    (20000 - bastionChargeRemainingRef.current) / 1000,
                  citadelBlocksRemaining: 0,
                  sentinelAnalyzedSource:
                    sentinelAnalyzedKindRef.current as HazardKind | null,
                  sentinelFirstAnalyzedHitAvailable:
                    sentinelAnalyzedBlockWaveRef.current !== wave,
                  titanMaulEquipped: true,
                });
                abilityAdjustedDamage = tankResult.damage;
                if (tankResult.consumed.bulwarkPlate)
                  firstGuardWaveRef.current = wave;
                if (tankResult.consumed.mercyPassive)
                  mercyChainActiveRef.current =
                    tankResult.mercyPassiveActiveAfterHit;
                if (tankResult.consumed.sentinelFirstAnalyzedHit)
                  sentinelAnalyzedBlockWaveRef.current = wave;
                if (tankResult.consumed.bastionCharge) {
                  bastionArmorChargedRef.current = false;
                  bastionChargeRemainingRef.current = 20000;
                }
                if (tankResult.reasons.length > 0)
                  showAbilityNotice(
                    tankResult.reasons
                      .map((reason) => reason.replaceAll("-", " ").toUpperCase())
                      .join(" · "),
                    1000,
                  );
              }
              if (
                activeCharacter === "tank_anchor" &&
                anchorGuardUntilRef.current > Date.now()
              )
                abilityAdjustedDamage *= 0.25;
              if (activeCharacter === "trickster_jester") {
                const effect = jesterEffectRef.current;
                if (effect.kind === "first-zero" && !effect.firstUsed)
                  abilityAdjustedDamage = 0;
                else if (effect.kind === "half")
                  abilityAdjustedDamage *= 0.5;
                else if (effect.kind === "barrel-zero" && n.kind === "barrel")
                  abilityAdjustedDamage = 0;
                else if (effect.kind === "first-double" && !effect.firstUsed)
                  abilityAdjustedDamage *= 2;
                else if (effect.kind === "more")
                  abilityAdjustedDamage *= 1.5;
                else if (effect.kind === "barrel-double" && n.kind === "barrel")
                  abilityAdjustedDamage *= 2;
                effect.firstUsed = true;
              }
              if (
                n.seededUntilWave !== undefined &&
                n.seededUntilWave >= wave &&
                n.kind !== "barrel"
              ) {
                abilityAdjustedDamage = Math.max(
                  0,
                  abilityAdjustedDamage - 0.5,
                );
                showAbilityNotice("SEED WARD · 0.5 HP BLOCKED", 900);
              }
              if (
                hasCharacterAbility("tank_atlas") &&
                Date.now() - lastLaneChangeAtRef.current <= 2000
              ) {
                abilityAdjustedDamage *= 0.5;
                showAbilityNotice("WORLD MAUL · DAMAGE HALVED", 900);
              }
              if (activeCharacter === "medic_oracle") {
                if (oracleHitCountRef.current === 1) {
                  abilityAdjustedDamage = 0;
                  showAbilityNotice("FATE SENSOR · FIRST HIT BLOCKED", 900);
                } else if (oracleHitCountRef.current === 2) {
                  abilityAdjustedDamage *= 0.5;
                  showAbilityNotice("FATE SENSOR · SECOND HIT HALVED", 900);
                }
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
              preserveFreezeThroughHit();
              if (activeCharacter === "runner_drift") {
                driftStackPercentRef.current = 0;
                driftLastMoveAtRef.current = 0;
                showAbilityNotice("SLIPSTREAM · CHAIN RESET", 800);
              }
              if (playScope === "single")
                queueEndlessGemStreakReset();
              void audioEngine.playSfx("hit");
              damageTakenWaveRef.current = wave;
              if (hasCharacterAbility("medic_mender"))
                menderChargeRemainingRef.current = 20000;
              if (hasCharacterAbility("medic_revive")) {
                phoenixFeatherActiveRef.current = true;
                phoenixFeatherReadyWaveRef.current = Math.max(
                  phoenixFeatherReadyWaveRef.current,
                  wave + 1,
                );
              }
              let nextHearts = state.current.hearts - damage;
              if (
                nextHearts <= 0 &&
                activeCharacter === "trickster_phantom" &&
                !phantomLordRef.current &&
                wave % 10 === 0
              ) {
                phantomLordRef.current = true;
                phantomLordNegationStreakRef.current = 0;
                phantomHealthCapRef.current = 6;
                setPhantomLord(true);
                setPhantomHealthCap(6);
                nextHearts = 6;
                showAbilityNotice(
                  "LORDSDOWN · PHANTOM ASCENDED · REVIVED AT 6 HP",
                  1800,
                );
              }
              if (hasCharacterAbility("tank_atlas")) {
                atlasLaneLimitRef.current = Math.max(
                  1000,
                  atlasLaneLimitRef.current - 500,
                );
                setAbilityStateVersion((value) => value + 1);
                showAbilityNotice(
                  `WORLD BEARER · SKY TIMER ${(atlasLaneLimitRef.current / 1000).toFixed(1)}s`,
                  1100,
                );
              }
              if (activeCharacter === "tank_sentinel")
                sentinelDamageByKindRef.current[n.kind] =
                  (sentinelDamageByKindRef.current[n.kind] ?? 0) + damage;
              if (
                nextHearts <= 0 &&
                activeCharacter === "misc_nomad" &&
                !nomadSurvivalUsedRef.current &&
                Math.random() < 0.5
              ) {
                nomadSurvivalUsedRef.current = true;
                permanentObstacleSlowRef.current = Math.min(
                  permanentObstacleSlowRef.current,
                  0.8,
                );
                nextHearts = 0.5;
                showAbilityNotice(
                  "SURVIVAL INSTINCT · 0.5 HP · HAZARDS PERMANENTLY 20% SLOWER",
                  1500,
                );
              }
              if (
                nextHearts <= 0 &&
                hasCharacterAbility("medic_lifeline") &&
                !lifelineUsedRef.current
              ) {
                lifelineUsedRef.current = true;
                lifelineImmuneKindsRef.current.add(n.kind);
                nextHearts = maxHearts;
                showAbilityNotice(
                  `LIFELINE · FULL HP · ${n.kind.toUpperCase()} IMMUNITY`,
                  1600,
                );
              }
              if (
                nextHearts <= 0 &&
                hasCharacterAbility("medic_halo") &&
                haloPartsRef.current >= 3
              ) {
                haloPartsRef.current -= 3;
                nextHearts = 1;
                setAbilityStateVersion((value) => value + 1);
                showAbilityNotice("HALO RESTORED · REVIVED AT 1 HP", 1500);
              }
              if (
                nextHearts <= 0 &&
                hasCharacterAbility("medic_revive") &&
                !reviveUsedRef.current
              ) {
                reviveUsedRef.current = true;
                reviveFlyingRef.current = true;
                nextHearts = 0.5;
                setAbilityStateVersion((value) => value + 1);
                showAbilityNotice(
                  "PHOENIX REVIVE · 0.5 HP · FLIGHT ACTIVE",
                  1500,
                );
              }
              const triggerPacerPass =
                nextHearts <= 0 &&
                activeCharacter === "runner_pacer" &&
                !pacerRevivalUsedRef.current;
              if (triggerPacerPass) {
                pacerRevivalUsedRef.current = true;
                nextHearts = 0.5;
                setAbilityChoice({ kind: "pacer-character" });
                showAbilityNotice("PASS THE BATON · CHOOSE A NON-RUNNER", 1500);
              }
              const triggerPulseRescue =
                nextHearts <= 0 &&
                hasCharacterAbility("medic_pulse") &&
                !pulseUsedRef.current;
              if (triggerPulseRescue) {
                pulseUsedRef.current = true;
                nextHearts = 0.5;
                setPulseGame({
                  hits: 0,
                  prompt: "A",
                  endsAt: Date.now() + 10000,
                  remaining: 10000,
                });
                showAbilityNotice("LAST PULSE · FOLLOW THE KEYS", 1200);
              }
              if (
                relayChargesRef.current > 0 &&
                nextHearts < state.current.hearts
              ) {
                relayChargesRef.current -= 1;
                relayDischarge = true;
                setAbilityStateVersion((value) => value + 1);
                showAbilityNotice("OVERCHARGE RELAY · ALL LANES DISCHARGED", 1200);
              }
              if (
                nextHearts > 0 &&
                nextHearts <= 1 &&
                hasCharacterAbility("medic_beacon") &&
                !beaconActiveRef.current
              ) {
                beaconActiveRef.current = true;
                setAbilityStateVersion((value) => value + 1);
                showAbilityNotice("BEACON LIT · SPIKES OFF · HAZARDS 50% SLOWER", 1500);
              }
              if (nextHearts > 0 && activeCharacter === "tank_plow") {
                clearDamagedLane = true;
                showAbilityNotice("LANE PLOW · LANE CLEARED", 1000);
              }
              state.current.hearts = Math.max(0, nextHearts);
              setHearts(state.current.hearts);
              if (nextHearts <= 0) {
                setRunning(false);
                setPauseMenuOpen(false);
                setOver(true);
                if (isBotPractice) {
                  setVersusResult("PRACTICE DEFEAT");
                  setVersusPhase("finished");
                  setVersusIntermissionReady(false);
                } else if (isOnlineVersus) {
                  setVersusSelfEliminated(true);
                  versusSelfEliminatedRef.current = true;
                  setVersusPhase("eliminated");
                  setVersusIntermissionReady(false);
                  setVersusResult("RUN COMPLETE · RIVAL STILL RUNNING");
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
                if (!triggerPacerPass && !triggerPulseRescue)
                  setPaused(false);
                damageLockedRef.current = false;
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
              const pickpocketScore = 50 + 10 * wave;
              setScore((value) => value + pickpocketScore);
              showAbilityNotice(
                `CLOSE COUNT · +${pickpocketScore} SCORE`,
                950,
              );
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
                item.kind === "coin" ||
                item.kind === "melon" ||
                item.kind === "mushroom",
            )
          : recoveryRetained;
        let relayRetained = retained;
        if (relayDischarge) {
          const closestByLane = new Map<number, Item>();
          retained.forEach((item) => {
            if (!isHazardKind(item.kind) || item.y >= 91) return;
            const closest = closestByLane.get(item.lane);
            if (!closest || item.y > closest.y)
              closestByLane.set(item.lane, item);
          });
          const discharged = [...closestByLane.values()];
          const dischargedIds = new Set(discharged.map((item) => item.id));
          relayRetained = retained.filter(
            (item) => !dischargedIds.has(item.id),
          );
          discharged.forEach((item) => {
            const attackKind: AttackId =
              item.kind === "spikes" ? "spike" : (item.kind as AttackId);
            if (isBotPractice) {
              playerAttacksAgainstBotRef.current.push(attackKind);
            } else if (isOnlineVersus && versusMatchRef.current) {
              void supabase.rpc("reflect_1v1_attack", {
                p_match_id: versusMatchRef.current,
                p_reflection_id: `relay:${versusPickupNonceRef.current}:${wave}:${item.id}`,
                p_obstacle_type: attackKind,
              });
            }
          });
        }
        const retainedIds = new Set(relayRetained.map((item) => item.id));
        rogueGrazedItemIdsRef.current.forEach((itemId) => {
          if (!retainedIds.has(itemId))
            rogueGrazedItemIdsRef.current.delete(itemId);
        });
        return relayRetained;
      });
      const rawProgressGain = (dt / 12) * (1 + wave * 0.01);
      const waveProgressGain = Math.max(1, Math.round(rawProgressGain));
      let characterScoreMultiplier = 1;
      if (hasCharacterAbility("runner_ace"))
        characterScoreMultiplier *= 1.1;
      if (hasCharacterAbility("runner_dash"))
        characterScoreMultiplier *= 1.06;
      if (
        hasCharacterAbility("runner_courier") &&
        courierBoostRemainingRef.current > 0
      )
        characterScoreMultiplier *= 1.25;
      if (activeCharacter === "runner_tempo")
        characterScoreMultiplier *= wave % 2 === 1 ? 1.15 : 0.85;
      if (
        hasCharacterAbility("runner_vector") &&
        (state.current.lane === 0 ||
          state.current.lane === activeLaneCount - 1)
      )
        characterScoreMultiplier *= 1.12;
      if (activeCharacter === "runner_zenith")
        characterScoreMultiplier *=
          1 + Math.min(0.6, Math.max(0, wave - 1) * 0.02);
      if (pacerRushActive) characterScoreMultiplier *= 5;
      if (
        activeCharacter === "runner_drift" &&
        driftStackPercentRef.current > 0
      )
        characterScoreMultiplier *= 1 + driftStackPercentRef.current;
      if (activeCharacter === "runner_spark")
        characterScoreMultiplier *= 1 + sparkGemCountRef.current * 0.01;
      if (activeCharacter === "trickster_pickpocket")
        characterScoreMultiplier *= 2;
      if (
        activeCharacter === "trickster_switch" &&
        switchLaneChangesRef.current >= 50
      )
        characterScoreMultiplier *= 1.1;
      if (activeCharacter === "tank_guard")
        characterScoreMultiplier *= 0.9;
      if (activeCharacter === "tank_colossus")
        characterScoreMultiplier *=
          1 + Math.max(0, state.current.hearts - 3) * 0.05;
      if (
        activeCharacter === "trickster_jester" &&
        jesterEffectRef.current.kind === "neutral"
      )
        characterScoreMultiplier *= 1 + jesterEffectRef.current.percent;
      if (
        activeCharacter === "trickster_phantom" &&
        !phantomLordRef.current &&
        wave % 2 === 0
      )
        characterScoreMultiplier *= 2;
      if (
        hasCharacterAbility("medic_halo") &&
        state.current.hearts >= maxHearts
      )
        characterScoreMultiplier *= 1.15;
      if (
        activeCharacter === "tank_reactor" &&
        missingHealthRatio > 0
      )
        characterScoreMultiplier *= 1 + missingHealthRatio * 0.3;
      if (activeCharacter === "runner_velocity")
        characterScoreMultiplier *=
          1 + Math.min(2, velocityChargeMsRef.current / 50000);
      if (reviveFlyingRef.current)
        characterScoreMultiplier *= 1.5;
      if (activeCharacter === "medic_oracle" && oracleCompleted > 0)
        characterScoreMultiplier *= 1 + oracleCompleted * 0.05;
      if (
        activeCharacter === "trickster_wildcard" &&
        wildcardBuffRef.current === "score"
      )
        characterScoreMultiplier *= 1.15;
      const totalScoreMultiplier =
        modeMultiplier *
        classScoreMultiplier *
        characterScoreMultiplier *
        activeWeaponScoreMultiplier;
      currentCoinMultiplierRef.current = totalScoreMultiplier;
      scoreCarryRef.current +=
        rawProgressGain *
        obstacleSpeedMultiplier *
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
      if (dashBoostRemainingRef.current > 0)
        dashBoostRemainingRef.current = Math.max(
          0,
          dashBoostRemainingRef.current - dt,
        );
      if (dashCooldownRemainingRef.current > 0)
        dashCooldownRemainingRef.current = Math.max(
          0,
          dashCooldownRemainingRef.current - dt,
        );
      if (blitzBoostRemainingRef.current > 0)
        blitzBoostRemainingRef.current = Math.max(
          0,
          blitzBoostRemainingRef.current - dt,
        );
      if (blitzCooldownRemainingRef.current > 0)
        blitzCooldownRemainingRef.current = Math.max(
          0,
          blitzCooldownRemainingRef.current - dt,
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
          showAbilityNotice("HOLD GROUND · NEXT HIT FULLY NEGATED", 1100);
        }
      }
      if (
        healingEnabled &&
        hasCharacterAbility("medic_mender") &&
        !reviveFlyingRef.current &&
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
      if (isBotPractice && versusOpponentHearts > 0) {
        botScoreCarryRef.current +=
          rawProgressGain * currentSpeedMultiplier;
        const botScoreGain = Math.floor(botScoreCarryRef.current);
        if (botScoreGain > 0) {
          botScoreCarryRef.current -= botScoreGain;
          botScoreRef.current += botScoreGain;
          setVersusOpponentScore(botScoreRef.current);
        }
      }
      setWaveProgress((value) => value + waveProgressGain);
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
    activeLaneCount,
    activeMapId,
    activeMapRules,
    healingEnabled,
    maxHearts,
    activeClass,
    activeCharacter,
    playScope,
    isBotPractice,
    versusOpponentHearts,
    isOnlineVersus,
    isVersusRun,
    modeMultiplier,
    modeRules.hazardLaneLimit,
    classScoreMultiplier,
    activeWeaponScoreMultiplier,
    hasCharacterAbility,
    oracleCompleted,
    grantInvincibility,
    applyFreezeEffect,
    clearFreezeEffect,
    preserveFreezeThroughHit,
    showAbilityNotice,
    queueGemClaim,
    queueEndlessGemStreakReset,
    queueOnlineCoinAward,
    applyAuthoritativeVersusPoints,
    applyProgressionPayload,
    applyDirectMapDamage,
    applyCharacterSelfDamage,
    activeAbility.name,
  ]);
  useEffect(() => {
    if (!running) return;
    const next = Math.floor(waveProgress / 2250) + 1;
    if (next !== wave) {
      const completedWave = next - 1;
      setWave(next);
      if (playScope === "single") queueEndlessGemStreakReset(next);
      else gemStreakRef.current = 0;
      volcanoStationaryMsRef.current = 0;
      if (activeMapId === "pitch") {
        pitchKatanaRef.current = resetPitchKatanaAtWaveEnd(
          pitchKatanaRef.current,
          Date.now(),
        );
        setPitchKatanaVersion((value) => value + 1);
      }
      if (activeMapId === "factory" && !isOnlineVersus) {
        const nextConveyor = createFactoryConveyorState();
        factoryConveyorRef.current = nextConveyor;
        setFactoryConveyor(nextConveyor);
      }
      wildcardBuffRef.current = null;
      mercyChainActiveRef.current = true;
      phantomKindHitsRef.current = {};
      if (activeCharacter === "tank_citadel") {
        citadelFlawlessStreakRef.current =
          collisionWaveRef.current === completedWave
            ? 0
            : citadelFlawlessStreakRef.current + 1;
        citadelBlocksRemainingRef.current = getCitadelOpeningBlocks(
          citadelFlawlessStreakRef.current,
        );
      }
      if (activeCharacter === "tank_sentinel") {
        sentinelAnalyzedKindRef.current =
          selectSentinelAnalyzedSource(
            sentinelDamageByKindRef.current as Partial<
              Record<HazardKind, number>
            >,
          ) as Kind | null;
        sentinelAnalyzedBlockWaveRef.current = 0;
      }
      if (activeCharacter === "trickster_jester") {
        const rolled = generateJesterWaveEffect(
          `${versusMatchRef.current ?? "solo"}:${userIdRef.current ?? "guest"}`,
          next,
        );
        const mappedKind =
          rolled.kind === "first-hit-zero"
            ? "first-zero"
            : rolled.kind === "half-damage"
              ? "half"
              : rolled.kind === "barrel-immunity"
                ? "barrel-zero"
                : rolled.kind === "score-and-speed"
                  ? "neutral"
                  : rolled.kind === "first-hit-double"
                    ? "first-double"
                    : rolled.kind === "fifty-percent-more-damage"
                      ? "more"
                      : "barrel-double";
        jesterEffectRef.current = {
          kind: mappedKind,
          percent:
            rolled.kind === "score-and-speed" ? rolled.percent / 100 : 0,
          firstUsed: false,
        };
        showAbilityNotice(
          `JESTER ROLL · ${rolled.kind.replaceAll("-", " ").toUpperCase()}${rolled.kind === "score-and-speed" ? ` ${rolled.percent}%` : ""}`,
          1500,
        );
      }
      if (hasCharacterAbility("medic_mender")) {
        menderChargeRemainingRef.current = 20000;
        menderHealedWaveRef.current = 0;
      }
      if (
        hasCharacterAbility("medic_halo") &&
        collisionWaveRef.current !== completedWave
      ) {
        haloPartsRef.current = Math.min(3, haloPartsRef.current + 1);
        setAbilityStateVersion((value) => value + 1);
        showAbilityNotice(
          `HALO FORGED · ${haloPartsRef.current}/3 HIT-LESS WAVES`,
          1200,
        );
      }
      if (
        hasCharacterAbility("runner_relay") &&
        completedWave % 2 === 0
      ) {
        relayChargesRef.current = Math.min(
          Math.ceil(maxHearts),
          relayChargesRef.current + 1,
        );
        setAbilityStateVersion((value) => value + 1);
        showAbilityNotice(
          `OVERCHARGE RELAY · ${relayChargesRef.current} HEART${relayChargesRef.current === 1 ? "" : "S"} READY`,
          1200,
        );
      }
      if (
        mode === "normal" &&
        healingEnabled &&
        hasCharacterAbility("medic_reserve") &&
        state.current.hearts >= maxHearts &&
        !reserveHealStoredRef.current
      ) {
        reserveHealStoredRef.current = true;
        showAbilityNotice("RESERVE DOSE · 0.5 HP STORED", 1100);
      }
      const waveEndHearts = state.current.hearts;
      if (mode === "normal" && healingEnabled) {
        const sutureFullRestore =
          hasCharacterAbility("medic_suture") && completedWave % 3 === 0;
        const healAmount =
          activeCharacter === "medic_vial"
            ? maxHearts
          : activeCharacter === "medic_patch"
            ? 1.5
            : hasCharacterAbility("medic_salve")
              ? state.current.hearts <= 1
                ? 1.5
                : 0
            : hasCharacterAbility("medic_tonic")
              ? 0.5
            : hasCharacterAbility("medic_suture")
              ? completedWave % 2 === 0
                ? 1
                : 0
            : hasCharacterAbility("medic_seraph")
              ? seraphTeleportChanceRef.current <= 0
                ? 1.5
                : 0
            : reviveFlyingRef.current
              ? 0
            : activeCharacter === "tank_atlas"
              ? 1
            : activeCharacter === "tank_colossus"
              ? collisionWaveRef.current === completedWave
                ? 0
                : 2
            : activeClass === "tank"
              ? 0.5
              : 1;
        if (
          activeCharacter === "medic_patch" &&
          state.current.hearts < maxHearts
        )
          showAbilityNotice("FIELD DRESSING · +1.5 HP", 1200);
        if (
          hasCharacterAbility("medic_salve") &&
          state.current.hearts <= 1 &&
          state.current.hearts < maxHearts
        )
          showAbilityNotice("DEEP SALVE · +1.5 HP", 1200);
        if (
          sutureFullRestore &&
          state.current.hearts < maxHearts
        )
          showAbilityNotice("TRIAGE CYCLE · HP RESTORED TO 5", 1200);
        if (
          hasCharacterAbility("medic_seraph") &&
          seraphTeleportChanceRef.current <= 0 &&
          state.current.hearts < maxHearts
        )
          showAbilityNotice("DIVINE RECOVERY · +1.5 HP", 1200);
        if (
          activeCharacter === "tank_atlas" &&
          state.current.hearts < maxHearts
        )
          showAbilityNotice("WORLD BEARER · +1 HP", 1200);
        const healedHearts =
          activeCharacter === "medic_vial"
            ? maxHearts
          : sutureFullRestore
          ? maxHearts
          : Math.min(maxHearts, state.current.hearts + healAmount);
        state.current.hearts = healedHearts;
        setHearts(healedHearts);
      }
      if (
        activeCharacter === "medic_oracle" &&
        oracleProphecies.length > 0
      ) {
        let passiveChoiceOpened = false;
        const fulfilled = oracleProphecies.filter((prophecy) =>
          prophecy === "no-hit"
            ? collisionWaveRef.current !== completedWave
            : prophecy === "completion"
              ? collisionWaveRef.current === completedWave && waveEndHearts > 1
              : waveEndHearts <= 1,
        );
        if (fulfilled.length === 0) {
          state.current.hearts = Math.max(0, state.current.hearts - 1);
          setHearts(state.current.hearts);
          showAbilityNotice("PROPHECY FAILED · -1 HP", 1400);
          if (state.current.hearts <= 0) {
            setRunning(false);
            setPaused(false);
            setOver(true);
            if (isBotPractice) {
              setVersusResult("PRACTICE DEFEAT");
              setVersusPhase("finished");
            } else if (isOnlineVersus) {
              setVersusSelfEliminated(true);
              versusSelfEliminatedRef.current = true;
              setVersusPhase("eliminated");
              setVersusResult("PROPHECY FAILED · RIVAL STILL RUNNING");
            }
            return;
          }
        } else {
          const normalReward = fulfilled[0];
          const reducedRewards = oracleProphecies.filter(
            (prophecy) => prophecy !== normalReward,
          );
          setOracleCompleted((value) => value + 1);
          if (normalReward === "no-hit")
            oracleInvincibleWaveRef.current = next;
          if (normalReward === "completion") {
            state.current.hearts = maxHearts;
            setHearts(maxHearts);
          }
          const healerPool = CLASS_CHARACTERS.medic
            .map((character) => character.key as CharacterKey)
            .filter(
              (character) =>
                character !== "medic_oracle" &&
                !oracleBorrowedAbilitiesRef.current.has(character),
            )
            .sort(() => Math.random() - 0.5);
          if (normalReward === "near-death" && healerPool.length > 0) {
            passiveChoiceOpened = true;
            setAbilityChoice({
              kind: "oracle-passive",
              options: healerPool.slice(0, 2),
            });
          }
          reducedRewards.forEach((prophecy) => {
            if (prophecy === "no-hit") oracleShieldWaveRef.current = next;
            if (prophecy === "completion") {
              state.current.hearts = Math.min(
                maxHearts,
                state.current.hearts + 2,
              );
              setHearts(state.current.hearts);
            }
            if (prophecy === "near-death" && healerPool.length > 0) {
              oracleBorrowedAbilitiesRef.current.add(healerPool[0]);
              setAbilityStateVersion((value) => value + 1);
            }
          });
          const earnedRewards = [
            ORACLE_PROPHECY_COPY[normalReward].reward,
            ...reducedRewards.map(
              (prophecy) => ORACLE_PROPHECY_COPY[prophecy].reducedReward,
            ),
            "PERMANENT SCORE +5%",
          ];
          showAbilityNotice(
            `PROPHECY COMPLETE · ${earnedRewards.join(" · ")}`,
            2200,
          );
        }
        setOracleProphecies([]);
        setPaused(true);
        if (!passiveChoiceOpened)
          setAbilityChoice({ kind: "oracle-prophecy" });
      }
      if (isBotPractice) {
        const queuedAttacks = playerAttacksAgainstBotRef.current;
        playerAttacksAgainstBotRef.current = [];
        const outcome = simulateBotWave(
          versusOpponentHearts,
          queuedAttacks,
          next - 1,
          practiceBotMaxHeartsRef.current,
        );
        practiceBotNextWaveHeartsRef.current = outcome.heartsAfterHealing;
        setVersusOpponentHearts(outcome.heartsAfterDamage);
        if (outcome.heartsAfterDamage <= 0) {
          setVersusResult("PRACTICE VICTORY");
          setVersusPhase("finished");
          setVersusIntermissionReady(false);
          setPaused(false);
          setRunning(false);
          setOver(true);
          return;
        }
        const waveReward =
          activeMapRules.waveAttackReward.kind === "fixed"
            ? activeMapRules.waveAttackReward.points
            : activeMapRules.waveAttackReward.tiedPlayerPoints;
        const simulatedBotCoinPickups =
          Math.floor(Math.random() * 3) *
          getAttackPointsForCoin(activeMapId);
        botAttackPointsRef.current += waveReward + simulatedBotCoinPickups;
        versusPointsRef.current +=
          waveReward * currentCoinMultiplierRef.current;
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
    activeMapId,
    activeMapRules,
    healingEnabled,
    maxHearts,
    activeClass,
    activeCharacter,
    hasCharacterAbility,
    oracleCompleted,
    oracleProphecies,
    playScope,
    isBotPractice,
    isOnlineVersus,
    versusOpponentHearts,
    showAbilityNotice,
    acknowledgeSpawnedVersusAttacks,
    queueEndlessGemStreakReset,
  ]);
  useEffect(() => {
    if (
      playScope !== "versus" ||
      versusPhase !== "intermission" ||
      !versusIntermissionReady ||
      versusCountdown <= 1 ||
      pendingVersusCoinPickupIdsRef.current.size === 0 ||
      versusCoinSyncBusyRef.current
    )
      return;
    const matchId = versusMatchRef.current;
    if (!matchId) return;
    versusCoinSyncBusyRef.current = true;
    void syncIntermissionCoinClaims(matchId).finally(() => {
      versusCoinSyncBusyRef.current = false;
    });
  }, [
    playScope,
    versusPhase,
    versusIntermissionReady,
    versusCountdown,
    syncIntermissionCoinClaims,
  ]);
  useEffect(() => {
    if (versusPhase !== "intermission") return;
    if (versusCountdown <= 0) {
      if (isBotPractice) {
        let botBudget = botAttackPointsRef.current;
        const botAttacks: VersusAttackKind[] = [];
        const attackLimit = Math.min(6, 1 + Math.ceil(wave / 3));
        const availableAttackIds = getAvailableAttacks(activeMapId);
        while (botBudget >= 6 && botAttacks.length < attackLimit) {
          const affordable = VERSUS_ATTACKS.filter(
            (attack) =>
              availableAttackIds.includes(attack.kind) &&
              attack.cost <= botBudget,
          );
          if (affordable.length === 0) break;
          const chosen = affordable[Math.floor(Math.random() * affordable.length)];
          botAttacks.push(chosen.kind);
          botBudget -= chosen.cost;
        }
        botAttackPointsRef.current = botBudget;
        if (botAttacks.length > 0)
          enqueueDeferredAttackItems(
            appendSafeAttackWave(
              [],
              botAttacks.map((attack) =>
                attack === "spike" ? "spikes" : attack,
              ),
              () => id.current++,
              getAttackGroupSpacing(wave),
              state.current.lane,
              activeLaneCount,
            ),
          );
        setVersusResult(
          botAttacks.length > 0
            ? `TRAINING BOT SENT ${botAttacks.length} HAZARD${botAttacks.length === 1 ? "" : "S"}`
            : "TRAINING BOT SAVED ITS ATTACK COINS",
        );
        if (practiceBotNextWaveHeartsRef.current !== null) {
          setVersusOpponentHearts(practiceBotNextWaveHeartsRef.current);
          practiceBotNextWaveHeartsRef.current = null;
        }
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
        // The secure coin endpoint is deliberately never called after the
        // shared intermission expires. Any receipts that could not reach the
        // server during the ten-second window are discarded; the state update
        // below reconciles the optimistic HUD with the authoritative balance.
        pendingVersusCoinPickupIdsRef.current.clear();
        if (versusMatchRef.current !== matchId) return;
        await enqueueVersusStateSync(async () => {
          if (versusMatchRef.current !== matchId) return;
          const { data, error } = await supabase.rpc("update_1v1_state", {
            p_match_id: matchId,
            p_hearts: normalizeVersusHeartsForServer(state.current.hearts),
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
          const authoritativeConveyor =
            activeMapId === "factory"
              ? readFactoryConveyorFromWaveRules(
                  data?.wave_rules,
                  activeLaneCount,
                  wave,
                )
              : null;
          if (authoritativeConveyor) {
            factoryConveyorRef.current = authoritativeConveyor;
            setFactoryConveyor(authoritativeConveyor);
          }
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
            lane_index?: number | null;
            lane_group?: number | null;
            lane_position?: number | null;
            escape_lane_index?: number | null;
          }>;
          serverPending.forEach((attack) => {
            const kind = normalizeVersusObstacle(attack.obstacle_type);
            if (
              attack.id &&
              (spawnedAttackIdsRef.current.has(attack.id) ||
                queuedAttackTokenIdsRef.current.has(attack.id))
            ) return;
            if (attack.id && kind)
              pending.set(attack.id, {
                id: attack.id,
                kind,
                lane:
                  Number.isInteger(attack.lane_index) &&
                  attack.lane_index !== null
                    ? Number(attack.lane_index)
                    : undefined,
                laneGroup:
                  Number.isInteger(attack.lane_group) &&
                  attack.lane_group !== null
                    ? Number(attack.lane_group)
                    : undefined,
                lanePosition:
                  Number.isInteger(attack.lane_position) &&
                  attack.lane_position !== null
                    ? Number(attack.lane_position)
                    : undefined,
                escapeLane:
                  Number.isInteger(attack.escape_lane_index) &&
                  attack.escape_lane_index !== null
                    ? Number(attack.escape_lane_index)
                    : undefined,
              });
          });
          const attacks = Array.from(pending.values());
          incomingAttacksRef.current = [];
          if (attacks.length > 0) {
            const hasServerFormation = attacks.every(
              (attack) =>
                Number.isInteger(attack.lane) &&
                Number.isInteger(attack.laneGroup),
            );
            enqueueDeferredAttackItems(
              hasServerFormation
                ? appendServerAttackGroups(
                    [],
                    attacks,
                    () => id.current++,
                    activeLaneCount,
                    state.current.lane,
                    getAttackGroupSpacing(wave),
                  )
                : appendSafeAttackWave(
                    [],
                    attacks.map((attack) => attack.kind),
                    () => id.current++,
                    getAttackGroupSpacing(wave),
                    state.current.lane,
                    activeLaneCount,
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
    activeLaneCount,
    activeMapId,
    isBotPractice,
    isOnlineVersus,
    versusIntermissionReady,
    enqueueDeferredAttackItems,
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
    if (playScope !== "versus" || versusPhase !== "eliminated") return;
    const matchId = versusMatchRef.current;
    if (!matchId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const pollResult = async () => {
      await hydrateVersusStateRef.current?.(matchId, true);
      if (
        stopped ||
        versusMatchRef.current !== matchId ||
        versusFinishedRef.current
      )
        return;
      timer = setTimeout(() => void pollResult(), 2000);
    };
    timer = setTimeout(() => void pollResult(), 1200);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [playScope, versusPhase]);
  useEffect(() => {
    if (
      playScope !== "versus" ||
      !versusMatchRef.current ||
      !versusRunHydratedRef.current ||
      (versusPhase !== "playing" &&
        versusPhase !== "intermission" &&
        versusPhase !== "eliminated" &&
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
            p_hearts: normalizeVersusHeartsForServer(hearts),
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
        // Keep the pickup preview while waiting for the rival. The dedicated
        // intermission effect claims the batch only after the shared ten-second
        // server intermission is active.
        if (pendingVersusCoinPickupIdsRef.current.size === 0)
          applyAuthoritativeVersusPoints(data?.self?.obstacle_points);
        const serverStatus = String(data?.match?.status ?? "");
        if (serverStatus === "finished") {
          versusFinishedRef.current = true;
          setVersusResult(
            data?.match?.is_draw ||
              String(data?.outcome ?? data?.match?.outcome).toLowerCase() ===
                "draw"
              ? "DRAW"
              : data?.match?.winner_user_id === userIdRef.current ||
                  String(
                    data?.outcome ?? data?.match?.outcome,
                  ).toLowerCase() === "win"
                ? "VICTORY"
                : "DEFEAT",
          );
          setVersusPhase("finished");
          setVersusIntermissionReady(false);
          setRunning(false);
          setOver(true);
          return;
        }
        if (nextStatus === "eliminated") {
          setVersusSelfEliminated(true);
          versusSelfEliminatedRef.current = true;
          setVersusPhase("eliminated");
          setVersusIntermissionReady(false);
          setVersusResult("RUN COMPLETE · RIVAL STILL RUNNING");
          setRunning(false);
          setPaused(false);
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
      const nextUserId = user?.id ?? null;
      if (userIdRef.current !== nextUserId) {
        progressionOwnerUserIdRef.current = null;
        setPlayerProgression(createEmptyPlayerProgression());
      }
      userIdRef.current = nextUserId;
      if (user) {
        setPlayerAccess(null);
        setPlayerAccessError("");
        setPlayerAccessChecking(true);
      }
      setUserEmail(user?.email ?? null);
      if (user) {
        const sessionUserId = user.id;
        await refreshPlayerAccess();
        const [
          { data: stats, error: statsError },
          { data: profile },
          { data: admin },
          { data: role },
          { data: owned },
          { data: loadout },
          { data: progression },
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
          supabase.rpc("get_player_progression"),
        ]);
        if (userIdRef.current !== sessionUserId) return;
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
        setSelectedCharacter(safeLoadout.characterKey);
        setPlayerCosmetic(safeLoadout.playerCosmetic);
        setObstacleCosmetic(safeLoadout.obstacleCosmetic);
        setEnvironmentCosmetic(safeLoadout.environmentCosmetic);
        applyProgressionPayload(progression, sessionUserId);
      } else {
        setPlayerAccess(null);
        setPlayerAccessError("");
        setPlayerAccessChecking(false);
        setUsername("");
        setUsernameRequired(false);
        setIsAdmin(false);
        setAdminRole(null);
        setUnlocks([]);
        setSelectedCharacter("runner_ace");
        setInventoryCharacter({
          classKey: "runner",
          characterKey: "runner_ace",
        });
        setPlayerCosmetic("");
        setObstacleCosmetic("");
        setEnvironmentCosmetic("");
        progressionOwnerUserIdRef.current = null;
        setPlayerProgression(createEmptyPlayerProgression());
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
  }, [applyProgressionPayload, refreshPlayerAccess]);
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
    const signingOutUserId = userIdRef.current;
    cancelPendingProgressionStart();
    progressionStartIntentRef.current += 1;
    progressionRunIdRef.current = null;
    progressionAwardedRunIdRef.current = null;
    const shouldLeaveVersus = Boolean(
      signingOutUserId &&
        (versusSearchingRef.current || versusMatchRef.current),
    );
    userIdRef.current = null;
    progressionOwnerUserIdRef.current = null;
    setPlayerProgression(createEmptyPlayerProgression());
    invalidateVersusSearch();
    resetVersusClientSync();
    closeVersusChannel();
    versusMatchRef.current = null;
    incomingAttacksRef.current = [];
    spawnedAttackIdsRef.current.clear();
    queuedAttackTokenIdsRef.current.clear();
    deferredAttackGroupsRef.current = [];
    setDeferredAttackGroups([]);
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
    botScoreRef.current = 0;
    botScoreCarryRef.current = 0;
    practiceBotNextWaveHeartsRef.current = null;
    playerAttacksAgainstBotRef.current = [];
    turnLockedRef.current = false;
    if (delayedMoveTimerRef.current) {
      clearTimeout(delayedMoveTimerRef.current);
      delayedMoveTimerRef.current = null;
    }
    damageLockedRef.current = false;
    itemsSnapshotRef.current = [];
    setItems([]);
    setOver(false);
    setScore(0);
    setWaveProgress(0);
    setLastRunXpBreakdown(null);
    setSettingsOpen(false);
    setAdminOpen(false);
    setShopOpen(false);
    setInventoryOpen(false);
    setLeaderboardOpen(false);
    setGuest(false);
    setPlayerAccess(null);
    setPlayerAccessError("");
    setPlayerAccessChecking(false);
    setMyBanAppeal(null);
    setAppealNote("");
    setAppealStatus("");
    setAdminAppeals([]);
    setAdminAppealStatus("");
    setAdminAppealNotes({});
    setUnlocks([]);
    setSelectedCharacter("runner_ace");
    setInventoryCharacter({
      classKey: "runner",
      characterKey: "runner_ace",
    });
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
  const loadMyBanAppeal = useCallback(async () => {
    if (!userIdRef.current) {
      setMyBanAppeal(null);
      return;
    }
    const { data, error } = await supabase.rpc("get_my_ban_appeal");
    if (error) {
      setAppealStatus(error.message);
      return;
    }
    setAppealStatus("");
    setMyBanAppeal((data ?? null) as MyBanAppeal | null);
  }, []);
  useEffect(() => {
    if (!userEmail || !(playerAccess?.active_bans?.length ?? 0)) {
      setMyBanAppeal(null);
      setAppealNote("");
      setAppealStatus("");
      return;
    }
    void loadMyBanAppeal();
  }, [loadMyBanAppeal, playerAccess?.active_bans, userEmail]);
  const submitBanAppeal = async (event: FormEvent) => {
    event.preventDefault();
    if (!userIdRef.current) return;
    setAppealBusy(true);
    setAppealStatus("");
    const { error } = await supabase.rpc("submit_ban_appeal", {
      p_note: appealNote.trim(),
    });
    if (error) setAppealStatus(error.message);
    else {
      setAppealNote("");
      await loadMyBanAppeal();
      setAppealStatus("Appeal submitted. An admin will review your note.");
    }
    setAppealBusy(false);
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
    cancelPendingProgressionStart();
    const { data, error } = await supabase.rpc("get_admin_reports");
    if (error) {
      setReports([]);
      setCopyStatus(error.message);
    } else {
      setReports((data ?? []) as PlayerReport[]);
      setCopyStatus("");
    }
    setAdminTab("reports");
    setPauseMenuOpen(false);
    setPaused(true);
    setAdminOpen(true);
  };
  const loadAppeals = async (
    status: "pending" | "approved" | "denied" | "all" = appealFilter,
  ) => {
    setAdminAppealStatus("");
    const { data, error } = await supabase.rpc("get_admin_ban_appeals", {
      p_status: status,
    });
    if (error) {
      setAdminAppeals([]);
      setAdminAppealStatus(error.message);
    } else setAdminAppeals((data ?? []) as BanAppeal[]);
    setAppealFilter(status);
    setAdminTab("appeals");
    setPauseMenuOpen(false);
    setPaused(true);
  };
  const resolveBanAppeal = async (
    appealId: number,
    action: "approve" | "deny",
  ) => {
    setAdminAppealBusyId(appealId);
    setAdminAppealStatus("");
    const { data, error } = await supabase.rpc("resolve_ban_appeal", {
      p_appeal_id: appealId,
      p_action: action,
      p_admin_note: adminAppealNotes[appealId]?.trim() || null,
    });
    if (error) setAdminAppealStatus(error.message);
    else {
      const result = data as { revoked_count?: number } | null;
      setAdminAppealStatus(
        action === "approve"
          ? `Appeal approved. ${result?.revoked_count ?? 0} active ban${result?.revoked_count === 1 ? "" : "s"} removed.`
          : "Appeal denied. The ban remains active.",
      );
      setAdminAppealNotes((current) => {
        const next = { ...current };
        delete next[appealId];
        return next;
      });
      const { data: refreshed, error: refreshError } = await supabase.rpc(
        "get_admin_ban_appeals",
        { p_status: appealFilter },
      );
      if (refreshError) setAdminAppealStatus(refreshError.message);
      else setAdminAppeals((refreshed ?? []) as BanAppeal[]);
    }
    setAdminAppealBusyId(null);
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
          `REPORT ${index + 1}\nType: ${r.report_type}\nDate: ${new Date(r.created_at).toLocaleString()}\nPlayer: ${r.username ? `${r.username} (${r.user_id})` : r.user_id}\nStatus: ${r.status}\n\n${r.message}`,
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
    const sessionUserId = userIdRef.current;
    if (!sessionUserId) return;
    const [ownedResult, loadoutResult, catalogResult] = await Promise.all([
      supabase
        .from("player_unlocks")
        .select("item_key,item_type,rarity")
        .eq("user_id", sessionUserId),
      supabase
        .from("player_loadouts")
        .select(
          "class_key,character_key,player_cosmetic,obstacle_cosmetic,environment_cosmetic",
        )
        .eq("user_id", sessionUserId)
        .maybeSingle(),
      supabase
        .from("extraction_catalog")
        .select("item_key,item_type,rarity,display_name,extractable")
        .eq("active", true),
    ]);
    if (userIdRef.current !== sessionUserId) return;
    const collectionError =
      ownedResult.error ?? loadoutResult.error ?? catalogResult.error;
    if (collectionError) {
      setInventoryStatus(`Could not load inventory: ${collectionError.message}`);
      return;
    }
    const owned = ownedResult.data;
    const loadout = loadoutResult.data;
    const catalog = catalogResult.data;
    const ownedItems = (owned ?? []) as Unlock[];
    const availableCatalog = (catalog ?? []) as CatalogItem[];
    const lockedCatalog = availableCatalog.filter(
      (item) =>
        item.extractable !== false &&
        !ownedItems.some(
          (ownedItem) =>
            ownedItem.item_key === item.item_key &&
            ownedItem.item_type === item.item_type,
        ),
    );
    const safeLoadout = normalizeOwnedLoadout(ownedItems, loadout);
    setUnlocks(ownedItems);
    setCatalogItems(availableCatalog);
    setDirectPurchaseKey((current) =>
      lockedCatalog.some((item) => item.item_key === current)
        ? current
        : lockedCatalog[0]?.item_key ?? "",
    );
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
      const duplicateRefund = Math.max(
        0,
        Number(
          data?.refund ??
            results.reduce(
              (total, item) =>
                total +
                (item.is_new
                  ? 0
                  : Number.isFinite(Number(item.duplicate_refund))
                    ? Number(item.duplicate_refund)
                    : DUPLICATE_REFUNDS[item.rarity]),
              0,
            ),
        ) || 0,
      );
      setShopStatus(
        `${results.length} ITEM${results.length === 1 ? "" : "S"} REVEALED — ${newCount} NEW · ${duplicateCount} DUPLICATE${duplicateCount === 1 ? "" : "S"} · ♦ ${duplicateRefund} REFUNDED`,
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
  const equipDefaultCosmetic = async (
    slot: "player" | "obstacle" | "environment",
  ) => {
    const applyDefault = () => {
      if (slot === "player") setPlayerCosmetic("");
      if (slot === "obstacle") setObstacleCosmetic("");
      if (slot === "environment") setEnvironmentCosmetic("");
    };
    if (guest) {
      applyDefault();
      setInventoryStatus(`DEFAULT ${slot.toUpperCase()} LOOK EQUIPPED.`);
      return;
    }
    const { error } = await supabase.rpc("set_loadout", {
      p_slot: slot,
      p_item: "",
    });
    if (!error) applyDefault();
    setInventoryStatus(
      error
        ? error.message
        : `DEFAULT ${slot.toUpperCase()} LOOK EQUIPPED.`,
    );
  };
  const purchaseCatalogItem = async () => {
    if (guest || !userIdRef.current) {
      setInventoryStatus("Sign in to unlock a permanent item.");
      return;
    }
    if (directPurchaseBusy) return;
    const item = catalogItems.find(
      (catalogItem) =>
        catalogItem.item_key === directPurchaseKey &&
        catalogItem.extractable !== false &&
        !unlocks.some(
          (ownedItem) =>
            ownedItem.item_key === catalogItem.item_key &&
            ownedItem.item_type === catalogItem.item_type,
        ),
    );
    if (!item) {
      setInventoryStatus("Choose a locked item first.");
      return;
    }
    const cost = DIRECT_UNLOCK_COSTS[item.rarity];
    if (gemsRef.current < cost) {
      setInventoryStatus(`You need ♦ ${cost} to unlock this item.`);
      return;
    }
    setDirectPurchaseBusy(true);
    setInventoryStatus(`Unlocking ${item.display_name ?? item.item_key}…`);
    try {
      const { data, error } = await supabase.rpc("purchase_catalog_item", {
        p_item_key: item.item_key,
      });
      if (error) {
        setInventoryStatus(error.message);
        return;
      }
      const nextGems = Number(data?.total_gems ?? data?.gems);
      if (Number.isFinite(nextGems)) {
        gemsRef.current = Math.max(0, nextGems);
        setGems(gemsRef.current);
      }
      await loadCollection();
      const chargedCost = Math.max(0, Number(data?.cost) || 0);
      setInventoryStatus(
        data?.already_owned
          ? `${(item.display_name ?? item.item_key).toUpperCase()} WAS ALREADY OWNED · NO GEMS SPENT.`
          : `${(item.display_name ?? item.item_key).toUpperCase()} UNLOCKED FOR ♦ ${chargedCost}.`,
      );
    } catch {
      setInventoryStatus(
        "The direct unlock could not be confirmed. Check your balance before trying again.",
      );
    } finally {
      setDirectPurchaseBusy(false);
    }
  };
  const loadLeaderboard = async () => {
    cancelPendingProgressionStart();
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
  const lockedCatalogItems = catalogItems
    .filter(
      (item) =>
        item.extractable !== false &&
        !unlocks.some(
          (ownedItem) =>
            ownedItem.item_key === item.item_key &&
            ownedItem.item_type === item.item_type,
        ),
    )
    .sort(
      (left, right) =>
        RARITY_ORDER[left.rarity] - RARITY_ORDER[right.rarity] ||
        (left.display_name ?? left.item_key).localeCompare(
          right.display_name ?? right.item_key,
        ),
    );
  const directPurchaseItem =
    lockedCatalogItems.find((item) => item.item_key === directPurchaseKey) ??
    lockedCatalogItems[0] ??
    null;
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
    ? getCharacterWeaponLabel(
        focusedCharacter.key as CharacterKey,
        focusedCharacter.rarity,
      )
    : "";
  const pacerCharacterOptions = CHARACTER_ROSTER.filter(
    (character) =>
      getCharacterClassKey(character.key) !== "runner" &&
      isCharacterOwned(unlocks, character.key),
  );
  const brewTonic = (strength: 1 | 2 | 3) => {
    const cost = strength * 5;
    if (tonicPotion > 0 || tonicIngredients < cost) return;
    setTonicIngredients((value) => value - cost);
    setTonicPotion(strength);
    showAbilityNotice(`${strength} HP POTION BREWED · PRESS E`, 1100);
    void audioEngine.playSfx("click");
  };
  const chooseLifelineLane = (destination: number) => {
    if (
      abilityChoice?.kind !== "lifeline-lane" ||
      destination === state.current.lane
    )
      return;
    lifelineHookUsesRef.current += 1;
    completeMove(destination, Math.sign(destination - state.current.lane));
    setAbilityStateVersion((value) => value + 1);
    setAbilityChoice(null);
    setPaused(false);
    showAbilityNotice(
      `RESCUE HOOK · ${3 - lifelineHookUsesRef.current} USES LEFT`,
      1000,
    );
  };
  const choosePacerCharacter = (characterKey: CharacterKey) => {
    if (
      abilityChoice?.kind !== "pacer-character" ||
      getCharacterClassKey(characterKey) === "runner" ||
      !isCharacterOwned(unlocks, characterKey)
    )
      return;
    setRunCharacterOverride(characterKey);
    setAbilityChoice(null);
    setPaused(false);
    setRunning(true);
    showAbilityNotice(
      `BATON PASSED · ${getCharacterDefinition(characterKey).name.toUpperCase()}`,
      1500,
    );
  };
  const chooseOraclePassive = (characterKey: CharacterKey) => {
    if (
      abilityChoice?.kind !== "oracle-passive" ||
      !abilityChoice.options.includes(characterKey)
    )
      return;
    oracleBorrowedAbilitiesRef.current.add(characterKey);
    setAbilityStateVersion((value) => value + 1);
    setAbilityChoice({ kind: "oracle-prophecy" });
    showAbilityNotice(
      `ORACLE LEARNED · ${CHARACTER_ABILITIES[characterKey].name}`,
      1400,
    );
  };
  const oracleChoiceSets: OracleProphecy[][] =
    oracleCompleted >= 20
      ? [["no-hit", "completion", "near-death"]]
      : oracleCompleted >= 5
        ? [
            ["no-hit", "completion"],
            ["no-hit", "near-death"],
            ["completion", "near-death"],
          ]
        : [["no-hit"], ["completion"], ["near-death"]];
  const chooseOracleProphecy = (prophecies: OracleProphecy[]) => {
    if (abilityChoice?.kind !== "oracle-prophecy") return;
    setOracleProphecies(prophecies);
    setAbilityChoice(null);
    setPaused(isVersusRun && versusPhase === "intermission");
    showAbilityNotice(
      `PROPHECY SET · ${prophecies.map((value) => value.replace("-", " ").toUpperCase()).join(" + ")}`,
      1400,
    );
  };
  const interactWithSpike = (itemId: number) => {
    if (activeCharacter === "tank_warden") {
      setItems((current) =>
        current.map((item) =>
          item.id === itemId && item.kind === "spikes"
            ? { ...item, deactivated: true }
            : item,
        ),
      );
      showAbilityNotice("WARDEN · SPIKES DEACTIVATED", 850);
      return;
    }
    if (
      activeCharacter === "misc_tinker" &&
      !tinkerClickedSpikeIdsRef.current.has(itemId)
    ) {
      tinkerClickedSpikeIdsRef.current.add(itemId);
      tinkerInspirationRef.current += 1;
      setAbilityStateVersion((value) => value + 1);
      showAbilityNotice(
        `INSPIRATION · ${tinkerInspirationRef.current}/3`,
        850,
      );
    }
  };
  const abilityAction = (() => {
    if (
      activeCharacter === "runner_zenith" &&
      wave >= 15 &&
      !timeStopUsedRef.current
    )
      return { label: "TIME STOP", status: "READY · ONCE PER RUN", ready: true };
    if (activeCharacter === "runner_blitz")
      return {
        label: "VOLT CLEAVE",
        status:
          blitzCooldownRemainingRef.current > 0
            ? `${Math.ceil(blitzCooldownRemainingRef.current / 1000)}s COOLDOWN`
            : "READY · CLEARS FIRST NON-ROCK",
        ready: blitzCooldownRemainingRef.current <= 0,
      };
    if (hasCharacterAbility("runner_dash"))
      return {
        label: "JET DASH",
        status:
          dashCooldownRemainingRef.current > 0
            ? `${Math.ceil(dashCooldownRemainingRef.current / 1000)}s COOLDOWN`
            : "READY · BURST + SHIELD",
        ready: dashCooldownRemainingRef.current <= 0,
      };
    if (activeCharacter === "tank_hammer")
      return { label: "HAMMER", status: "CLEARS CURRENT + NEIGHBOR LANES", ready: true };
    if (activeCharacter === "tank_anchor")
      return {
        label: "GROUND HOOK",
        status:
          anchorGuardUntilRef.current > Date.now()
            ? "ACTIVE · LANE LOCKED · DAMAGE -75%"
            : "READY · 5 SECOND GUARD",
        ready: anchorGuardUntilRef.current <= Date.now(),
      };
    if (activeCharacter === "tank_sentinel")
      return {
        label: "STEEL SPEAR",
        status: sentinelActionWaveRef.current === wave ? "USED THIS WAVE" : "BARRELS -75% SPEED · 15s",
        ready: sentinelActionWaveRef.current !== wave,
      };
    if (activeCharacter === "trickster_smoke")
      return {
        label: "SMOKE BOMB",
        status:
          smokeCooldownUntilRef.current > Date.now()
            ? `${Math.ceil((smokeCooldownUntilRef.current - Date.now()) / 1000)}s COOLDOWN`
            : "TELEPORT TO A SAFE LANE",
        ready: smokeCooldownUntilRef.current <= Date.now(),
      };
    if (activeCharacter === "trickster_rogue")
      return {
        label: "SHADOW METER",
        status: `${rogueGrazeMeterRef.current} GRAZES · 2 / 5 / 10`,
        ready: rogueGrazeMeterRef.current >= 2,
      };
    if (activeCharacter === "trickster_flicker")
      return {
        label: "FLICKER",
        status: flickerUsedWaveRef.current === wave ? "USED THIS WAVE" : "TRANSFORM EACH LANE'S CLOSEST HAZARD",
        ready: flickerUsedWaveRef.current !== wave,
      };
    if (activeCharacter === "runner_flare")
      return {
        label: "SIGNAL FLARE",
        status:
          flareCooldownUntilRef.current > Date.now()
            ? `${Math.ceil((flareCooldownUntilRef.current - Date.now()) / 1000)}s COOLDOWN`
            : "BURN THIS LANE FOR 15s",
        ready: flareCooldownUntilRef.current <= Date.now(),
      };
    if (activeCharacter === "trickster_phantom" && phantomLord)
      return {
        label: "EVISCERATE",
        status: "ERASE ALL PROJECTILES ON SCREEN",
        ready: true,
      };
    if (activeCharacter === "medic_vial")
      return {
        label: "SWITCH ALLEGIANCE",
        status: vialUsedRef.current ? "USED THIS RUN" : "REVERSE EFFECTS FOR 30s",
        ready: !vialUsedRef.current,
      };
    if (activeCharacter === "trickster_mirage")
      return {
        label: "MIRAGE INVASION",
        status: mirageUsedWaveRef.current === wave ? "USED THIS WAVE" : "5s INVASION · -1 HP ON RETURN",
        ready: mirageUsedWaveRef.current !== wave,
      };
    if (activeCharacter === "runner_scout")
      return {
        label: "QUICKSTEP INPUT",
        status:
          scoutInputWindowUntilRef.current > Date.now()
            ? "PRESS AGAIN NOW"
            : scoutCooldownUntilRef.current > Date.now()
              ? `${Math.ceil((scoutCooldownUntilRef.current - Date.now()) / 1000)}s COOLDOWN`
              : "READY · ARM SNOWFLAKE HEAL",
        ready:
          scoutInputWindowUntilRef.current > Date.now() ||
          scoutCooldownUntilRef.current <= Date.now(),
      };
    if (activeCharacter === "tank_drag")
      return {
        label: "CHAIN ANCHOR",
        status: dragChainRef.current?.wave === wave ? "RETURN TO SAVED LANE" : "SET RETURN POINT",
        ready: true,
      };
    if (activeCharacter === "misc_tinker")
      return {
        label: "HANDMADE SPIKE",
        status: `${tinkerInspirationRef.current}/3 INSPIRATION`,
        ready: tinkerInspirationRef.current >= 3,
      };
    if (activeCharacter === "runner_ranger")
      return {
        label: "PICKUP ZIP",
        status:
          rangerCooldownUntilRef.current > Date.now()
            ? `${Math.ceil((rangerCooldownUntilRef.current - Date.now()) / 1000)}s COOLDOWN`
            : "ZIP TO THE NEAREST PICKUP",
        ready: rangerCooldownUntilRef.current <= Date.now(),
      };
    if (activeCharacter === "misc_lantern")
      return {
        label: "FLASH OF LIGHT",
        status:
          lanternCooldownUntilRef.current > Date.now()
            ? `${Math.ceil((lanternCooldownUntilRef.current - Date.now()) / 1000)}s COOLDOWN`
            : "FREEZE ALL HAZARDS · 2s",
        ready: lanternCooldownUntilRef.current <= Date.now(),
      };
    if (activeCharacter === "misc_weaver")
      return {
        label: "WEAVE JACKET",
        status: weaverJacketRef.current ? "JACKET ACTIVE" : `${weaverSnowflakeCountRef.current}/5 SNOWFLAKES`,
        ready: !weaverJacketRef.current && weaverSnowflakeCountRef.current >= 5,
      };
    if (activeCharacter === "misc_catalyst")
      return { label: "FLUX PULL", status: "COLLECT EVERY PICKUP ON SCREEN", ready: true };
    if (activeCharacter === "misc_harvester") {
      const highest = Math.max(...Object.values(harvesterCountsRef.current));
      return {
        label: "HARVEST",
        status: `${highest}/10 CHARGE${harvesterCooldownUntilRef.current > Date.now() ? " · COOLDOWN" : ""}`,
        ready: highest >= 10 && harvesterCooldownUntilRef.current <= Date.now(),
      };
    }
    if (activeCharacter === "medic_lifeline")
      return {
        label: "RESCUE HOOK",
        status: `${Math.max(0, 3 - lifelineHookUsesRef.current)} USES LEFT`,
        ready: lifelineHookUsesRef.current < 3,
      };
    if (hasCharacterAbility("medic_reserve"))
      return {
        label: "RESERVE DOSE",
        status: reserveHealStoredRef.current ? "READY · +0.5 HP" : "NO DOSE STORED",
        ready: reserveHealStoredRef.current,
      };
    if (hasCharacterAbility("medic_tonic"))
      return {
        label: "DRINK POTION",
        status: tonicPotion > 0 ? `READY · +${tonicPotion} HP` : "BREW FROM THE MENU",
        ready: tonicPotion > 0,
      };
    if (hasCharacterAbility("medic_sprout"))
      return {
        label: "SEED WARD",
        status:
          sproutSeedWaveRef.current === wave
            ? "PLANTED THIS WAVE"
            : "READY · CHOOSES NEAREST",
        ready: sproutSeedWaveRef.current !== wave,
      };
    return null;
  })();
  const atlasTimerRemaining = Math.max(
    0,
    atlasLaneLimitRef.current - atlasLaneElapsedRef.current,
  );
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
          {userEmail && (
            <section className="ban-appeal-panel">
              <h2>APPEAL THIS BAN</h2>
              {myBanAppeal?.appeal?.status === "pending" ? (
                <div className="appeal-pending" role="status">
                  <b>APPEAL PENDING</b>
                  <span>
                    Sent {new Date(
                      myBanAppeal.appeal.created_at,
                    ).toLocaleString()}
                  </span>
                  <p>{myBanAppeal.appeal.player_note}</p>
                </div>
              ) : myBanAppeal && !myBanAppeal.can_appeal ? (
                <div className="appeal-denied" role="status">
                  <b>
                    APPEAL {myBanAppeal.appeal?.status?.toUpperCase() ?? "SENT"}
                  </b>
                  {myBanAppeal.appeal?.admin_note && (
                    <p>{myBanAppeal.appeal.admin_note}</p>
                  )}
                </div>
              ) : (
                <form onSubmit={submitBanAppeal}>
                  <label>
                    YOUR NOTE
                    <textarea
                      value={appealNote}
                      onChange={(event) => setAppealNote(event.target.value)}
                      minLength={10}
                      maxLength={1500}
                      placeholder="Explain why this ban should be reviewed…"
                      required
                    />
                  </label>
                  <small>{appealNote.length}/1500</small>
                  <button disabled={appealBusy}>
                    {appealBusy ? "SENDING…" : "SUBMIT APPEAL"}
                  </button>
                </form>
              )}
              {appealStatus && (
                <div className="report-status" role="status">
                  {appealStatus}
                </div>
              )}
            </section>
          )}
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
  const renderedKatanaState = pitchKatanaRef.current;
  const katanaCooldownSeconds = Math.max(
    0,
    Math.ceil((renderedKatanaState.cooldownUntilMs - Date.now()) / 1000),
  );
  const katanaActive = renderedKatanaState.activeUntilMs > Date.now();
  const waitingForVersusResult =
    isOnlineVersus &&
    versusSelfEliminated &&
    versusPhase !== "finished";
  const showPlayerLevel =
    !guest &&
    mainView === "endless" &&
    playScope === "single" &&
    !running &&
    !over &&
    !settingsOpen &&
    !shopOpen &&
    !inventoryOpen &&
    !leaderboardOpen &&
    !adminOpen &&
    !usernameRequired;
  return (
    <main className={`game-shell mode-${mode} ${flash}`}>
      <div
        className={`game-layout view-${mainView}${showPlayerLevel ? " has-player-level" : ""}`}
      >
        {showPlayerLevel && (
          <div className="report-utility-bar">
            <div
              className="player-level-card"
              role="status"
              aria-live="polite"
              aria-atomic="true"
              aria-label={`Level ${playerProgression.level}, ${playerProgression.xp} of ${playerProgression.xp_required} XP`}
            >
              <span className="player-level-number">
                <small>LEVEL</small>
                <b>{playerProgression.level}</b>
              </span>
              <span className="player-xp-meter">
                <span>
                  <b>XP</b>
                  <small>
                    {playerProgression.xp.toLocaleString()} /{" "}
                    {playerProgression.xp_required.toLocaleString()}
                  </small>
                </span>
                <i aria-hidden="true">
                  <u
                    style={{
                      width: `${Math.min(
                        100,
                        (playerProgression.xp /
                          playerProgression.xp_required) *
                          100,
                      )}%`,
                    }}
                  />
                </i>
                <small className="player-xp-sources">
                  ENDLESS SCORE² ÷ 4 · +100,000 PER GEM
                </small>
                <em>
                  {playerProgression.ranked_unlocked
                    ? "RANKED 1V1 UNLOCKED"
                    : `${Math.max(0, RANKED_UNLOCK_LEVEL - playerProgression.level)} LEVELS TO RANKED`}
                </em>
              </span>
            </div>
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
              cancelPendingProgressionStart();
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
              cancelPendingProgressionStart();
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
                cancelPendingProgressionStart();
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
                  <h2 id="versus-hub-title">
                    {versusMode === "ranked" ? "RANKED 1V1" : "CASUAL 1V1"}
                  </h2>
                </div>
                <strong>
                  {versusMode === "ranked" ? "ELO ON THE LINE" : "NO ELO · JUST PLAY"}
                </strong>
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
                  <div className="versus-mode-picker" aria-label="1v1 queue type">
                    <button
                      className={versusMode === "casual" ? "selected" : ""}
                      aria-pressed={versusMode === "casual"}
                      disabled={versusPhase === "searching" || versusLeaving}
                      onClick={() => {
                        setVersusMode("casual");
                        setVersusResult("");
                      }}
                    >
                      <b>CASUAL</b>
                      <small>NO ELO · OPEN TO EVERY LEVEL</small>
                    </button>
                    <button
                      className={versusMode === "ranked" ? "selected" : ""}
                      aria-pressed={versusMode === "ranked"}
                      disabled={
                        versusPhase === "searching" ||
                        versusLeaving ||
                        !playerProgression.ranked_unlocked ||
                        getCharacterDefinition(equippedCharacter).rarity ===
                          "mythic"
                      }
                      onClick={() => {
                        setVersusMode("ranked");
                        setVersusResult("");
                        void loadVersusLeaderboard();
                      }}
                    >
                      <b>RANKED</b>
                      <small>
                        {playerProgression.ranked_unlocked
                          ? getCharacterDefinition(equippedCharacter).rarity ===
                            "mythic"
                            ? "MYTHIC EQUIPPED · CHOOSE A NON-MYTHIC"
                            : "ELO ENABLED · COMPETITIVE"
                          : `LOCKED · REACH LEVEL ${RANKED_UNLOCK_LEVEL} (LVL ${playerProgression.level})`}
                      </small>
                    </button>
                  </div>
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
                        {versusLeaving
                          ? "FINISHING PREVIOUS MATCH…"
                          : `FIND ${versusMode.toUpperCase()} OPPONENT`}
                      </button>
                      {guest && (
                        <small id="versus-signin-note" className="versus-signin-note">
                          Sign in to enter account-based 1v1 matchmaking.
                        </small>
                      )}
                      <div className="versus-practice-divider" aria-hidden="true">
                        <span>OR</span>
                      </div>
                      <label className="practice-map-picker">
                        <span>PRACTICE MAP</span>
                        <select
                          value={practiceMapChoice}
                          disabled={versusLeaving}
                          onChange={(event) =>
                            setPracticeMapChoice(
                              event.target.value as MapId | "random",
                            )
                          }
                        >
                          <option value="random">RANDOM ARENA</option>
                          {MAP_IDS.map((mapId) => (
                            <option key={mapId} value={mapId}>
                              {MAP_RULES[mapId].name.toUpperCase()}
                            </option>
                          ))}
                        </select>
                      </label>
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
                  className="versus-hub-panel versus-map-priority-panel"
                  aria-labelledby="versus-map-priority-title"
                >
                  <header>
                    <span>02</span>
                    <div>
                      <small>YOUR MATCHMAKING PREFERENCE</small>
                      <h3 id="versus-map-priority-title">MAP PRIORITY</h3>
                    </div>
                  </header>
                  <p className="versus-map-priority-note">
                    Rank every Arena map from favorite to least favorite. The
                    match combines both players&apos; lists; an unsaved list is
                    treated as random.
                  </p>
                  {guest ? (
                    <div className="versus-hub-empty">
                      Sign in to save your map priority.
                    </div>
                  ) : (
                    <>
                      <ol className="versus-map-priority-list">
                        {mapPriority.map((mapId, index) => (
                          <li key={mapId}>
                            <strong>{index + 1}</strong>
                            <span>
                              <b>{MAP_RULES[mapId].name}</b>
                              <small>{MAP_SUMMARIES[mapId]}</small>
                            </span>
                            <div>
                              <button
                                type="button"
                                aria-label={`Move ${MAP_RULES[mapId].name} higher`}
                                disabled={
                                  mapPriorityBusy ||
                                  versusPhase === "searching" ||
                                  index === 0
                                }
                                onClick={() => moveMapPriority(index, -1)}
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                aria-label={`Move ${MAP_RULES[mapId].name} lower`}
                                disabled={
                                  mapPriorityBusy ||
                                  versusPhase === "searching" ||
                                  index === mapPriority.length - 1
                                }
                                onClick={() => moveMapPriority(index, 1)}
                              >
                                ↓
                              </button>
                            </div>
                          </li>
                        ))}
                      </ol>
                      <button
                        type="button"
                        className="versus-save-priority"
                        disabled={mapPriorityBusy || versusPhase === "searching"}
                        onClick={() => void saveMapPriority()}
                      >
                        {mapPriorityBusy ? "SAVING…" : "SAVE MAP PRIORITY"}
                      </button>
                      <small
                        className={`versus-priority-status${mapPriorityConfigured ? " saved" : ""}`}
                        role="status"
                      >
                        {mapPriorityStatus ||
                          (mapPriorityConfigured
                            ? "SAVED TO THIS ACCOUNT"
                            : "NOT SAVED · RANDOM PRIORITY WILL BE USED")}
                      </small>
                    </>
                  )}
                </section>

                <section
                  className="versus-hub-panel versus-rules-panel"
                  aria-labelledby="versus-rules-title"
                >
                  <header>
                    <span>03</span>
                    <div>
                      <small>HOW IT WORKS</small>
                      <h3 id="versus-rules-title">1V1 RULES</h3>
                    </div>
                  </header>
                  <ol className="versus-rule-list">
                    <li>Both runners play the same selected Arena map.</li>
                    <li>
                      When one runner falls, the other keeps playing until
                      their run ends too.
                    </li>
                    <li>
                      The second runner to fall receives <b>+280 score</b>, then
                      the higher final score wins. Equal scores are a draw.
                    </li>
                    <li>
                      Coins and completed waves award map-specific attack
                      points.
                    </li>
                    <li>
                      Spend attack coins during the 10-second intermission to
                      send hazards into your rival&apos;s next wave.
                    </li>
                    <li>
                      Bot practice uses the same local rules but never changes
                      wins, losses, XP, or rating.
                    </li>
                    <li>
                      Casual never shows or changes Elo. Ranked unlocks at level
                      25, starts every player at 1500 Elo, and displays ratings
                      as whole numbers.
                    </li>
                  </ol>
                </section>

                <section
                  className="versus-hub-panel versus-armory-panel"
                  aria-labelledby="versus-armory-title"
                >
                  <header>
                    <span>04</span>
                    <div>
                      <small>INTERMISSION SHOP</small>
                      <h3 id="versus-armory-title">ATTACK COIN ARMORY</h3>
                    </div>
                  </header>
                  <p className="versus-armory-note">
                    These prices use match-only attack points—not permanent
                    gems. Every formation targets where the rival is standing,
                    then rotates its safe lane so camping does not work. Map
                    restrictions still apply.
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

                {versusMode === "ranked" && (
                <section
                  className="versus-hub-panel versus-leaderboard-panel"
                  aria-labelledby="versus-leaderboard-title"
                >
                  <header>
                    <span>05</span>
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
                        const rating = Number(entry.rating);
                        const roundedRating = Number.isFinite(rating)
                          ? Math.round(rating)
                          : 1500;
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
                              <strong>{roundedRating} RATING</strong>
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
                )}
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
            className={`playfield map-${activeMapId}${environmentCosmetic ? ` environment-${environmentCosmetic}` : ""}${phantomNightActive ? " phantom-night" : ""}${phantomBloodmoonActive ? " phantom-bloodmoon" : ""}${phantomLordsdownActive ? " phantom-lordsdown" : ""}${phantomLord ? " phantom-lord" : ""}`}
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
                  <b>{getDisplayedHearts(hearts)} HP · {score.toLocaleString()}</b>
                </div>
                <strong>⚔</strong>
                <div>
                  <small>{versusOpponent}</small>
                  <b>
                    {getDisplayedHearts(versusOpponentHearts)} HP · {versusOpponentScore.toLocaleString()}
                  </b>
                </div>
                <em aria-label={`${getDisplayedAttackPoints(versusPoints)} attack coins`}>
                  ◉ {getDisplayedAttackPoints(versusPoints)}
                </em>
              </div>
            )}
            {isVersusRun && (
              <div className="arena-map-badge">
                <small>ARENA MAP</small>
                <b>{activeMapRules.name.toUpperCase()}</b>
                <span>{activeLaneCount} LANES</span>
                {activeMapId === "grove" && (
                  <em>
                    🍄 {versusSelfMushrooms} — {versusOpponentMushrooms} 🍄
                  </em>
                )}
              </div>
            )}
            {isVersusRun &&
              versusResult &&
              !over &&
              (versusPhase !== "intermission" ||
                !versusIntermissionReady) && (
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
              title={`${activeAbility.description} ${activeCharacterDefinition.weapon}: ${activeWeaponLabel}. Running score is the score earned continuously while surviving and moving forward.`}
              aria-label={`Passive ability: ${activeAbility.name}. ${activeAbility.description} Weapon: ${activeCharacterDefinition.weapon}. ${activeWeaponLabel}.`}
            >
              <small>PASSIVE</small>
              <b>{activeAbility.name}</b>
              <span>{activeAbility.description}</span>
              <div className="active-weapon-readout">
                <small>WEAPON</small>
                <b>{activeCharacterDefinition.weapon}</b>
                <em>{activeWeaponLabel}</em>
              </div>
              <small className="running-score-help">
                DISTANCE / RUNNING SCORE = SCORE EARNED CONTINUOUSLY WHILE YOU SURVIVE
              </small>
            </div>
            {running && abilityAction && (
              <button
                type="button"
                className={`ability-action-button ${abilityAction.ready ? "ready" : "cooldown"}`}
                disabled={!abilityAction.ready || paused || wavePause}
                onClick={triggerCharacterAction}
                data-ability-version={abilityStateVersion}
              >
                <kbd className="ability-action-key">E</kbd>
                <span className="ability-action-copy">
                  <small>ACTIVE ABILITY</small>
                  <b>{abilityAction.label}</b>
                  <em>{abilityAction.status}</em>
                </span>
              </button>
            )}
            {running &&
              (hasCharacterAbility("medic_tonic") ||
                waveForecast.length > 0 ||
                activeCharacter === "runner_velocity" ||
                hasCharacterAbility("medic_halo") ||
                hasCharacterAbility("runner_relay") ||
                hasCharacterAbility("medic_seraph")) && (
                <aside className="ability-side-panel" data-ability-version={abilityStateVersion}>
                  <header>
                    <div><small>LIVE KIT</small><b>ABILITY STATUS</b></div>
                  </header>
                  <div className="ability-panel-body">
                    {hasCharacterAbility("medic_tonic") && (
                      <>
                        <p className="ability-panel-note">
                          {tonicIngredients} INGREDIENTS · {tonicPotion > 0 ? `${tonicPotion} HP POTION READY` : "NO POTION BREWED"}
                        </p>
                        <div className="ability-option-grid">
                          {([1, 2, 3] as const).map((strength) => (
                            <button key={strength} className="ability-option" disabled={tonicPotion > 0 || tonicIngredients < strength * 5} onClick={() => brewTonic(strength)}>
                              <span>{strength}</span><span><b>+{strength} HP</b><small>{strength * 5} INGREDIENTS</small></span>
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                    {activeCharacter === "runner_velocity" && (
                      <div className={`ability-meter velocity-meter ${velocityDisplayPercent >= 100 ? "max" : velocityDisplayPercent >= 50 ? "charged" : velocityDisplayPercent > 0 ? "charging" : ""}`}><div className="ability-meter-label"><b>VELOCITY</b><span>{velocityDisplayPercent}%</span></div><span className="ability-meter-track"><i className="ability-meter-fill" style={{ width: `${velocityDisplayPercent}%` }} /></span></div>
                    )}
                    {hasCharacterAbility("medic_halo") && (
                      <div className="ability-meter"><div className="ability-meter-label"><b>HALO REVIVE</b><span>{haloPartsRef.current}/3</span></div><div className="ability-pips">{[1, 2, 3].map((part) => <i key={part} className={haloPartsRef.current >= part ? "filled" : ""} />)}</div></div>
                    )}
                    {hasCharacterAbility("runner_relay") && <p className="ability-panel-note">OVERCHARGED HEARTS · {relayChargesRef.current}</p>}
                    {hasCharacterAbility("medic_seraph") && <p className="ability-panel-note">TELEPORT CHANCE · {seraphTeleportChanceRef.current}%</p>}
                    {waveForecast.length > 0 && (
                      <section className="horizon-forecast">
                        <button
                          type="button"
                          className="horizon-forecast-toggle"
                          aria-expanded={!waveForecastCollapsed}
                          aria-controls="horizon-forecast-results"
                          onClick={() => setWaveForecastCollapsed((value) => !value)}
                        >
                          <span><small>EXACT NEXT 12</small><b>HORIZON FORECAST</b></span>
                          <strong aria-hidden="true">{waveForecastCollapsed ? "+" : "−"}</strong>
                        </button>
                        {!waveForecastCollapsed && (
                          <div id="horizon-forecast-results" className="ability-preview-grid">
                            {waveForecast.map((entry, index) => <div className="ability-preview-card" key={`${index}:${entry}`}><small>{entry}</small></div>)}
                          </div>
                        )}
                      </section>
                    )}
                  </div>
                </aside>
              )}
            {running && hasCharacterAbility("tank_atlas") && (
              <div className={`ability-timer ${atlasTimerRemaining <= 1000 ? "danger" : ""}`}><small>SWITCH LANES BEFORE SKY CRUSH</small><b>{(atlasTimerRemaining / 1000).toFixed(1)}s</b></div>
            )}
            {running && hasCharacterAbility("tank_atlas") && atlasTimerRemaining <= 1000 && <div className="ability-danger-vignette" />}
            {abilityNotice && (
              <div className="ability-proc" role="status" aria-live="polite">
                {abilityNotice}
              </div>
            )}
            <div className={`road road-${activeMapId}`}>
              {Array.from({ length: activeLaneCount - 1 }, (_, n) => (
                <i
                  className="line lane-divider"
                  style={{ left: `${((n + 1) / activeLaneCount) * 100}%` }}
                  key={n}
                />
              ))}
              {activeMapId === "factory" && (
                <div
                  className={`factory-conveyor ${factoryConveyor.speedMultiplier > 1 ? "fast" : "slow"}`}
                  style={{
                    left: `${(factoryConveyor.lane / activeLaneCount) * 100}%`,
                    width: `${100 / activeLaneCount}%`,
                  }}
                  aria-label={`Conveyor lane ${factoryConveyor.lane + 1} at ${factoryConveyor.speedMultiplier} times speed`}
                >
                  {(factoryConveyor.lane === 0 || factoryConveyor.lane === 3) && (
                    <span>CONVEYOR ×{factoryConveyor.speedMultiplier}</span>
                  )}
                </div>
              )}
              {activeMapId === "factory" &&
                (factoryConveyor.lane === 1 || factoryConveyor.lane === 2) && (
                  <div
                    className={`factory-conveyor-top-label ${factoryConveyor.speedMultiplier > 1 ? "fast" : "slow"}`}
                    style={{
                      left: `${((factoryConveyor.lane + 0.5) / activeLaneCount) * 100}%`,
                    }}
                  >
                    CONVEYOR ×{factoryConveyor.speedMultiplier}
                  </div>
                )}
              <div className="wave-chip">
                WAVE {wave}
                <small>
                  SPEED ×{getWaveSpeedMultiplier(wave).toFixed(2)}
                </small>
                {mode !== "normal" && (
                  <small>SCORE ×{modeMultiplier.toFixed(2)}</small>
                )}
              </div>
              {activeCharacter === "runner_flare" &&
                flareLaneRef.current !== null &&
                flareActiveUntilRef.current > Date.now() && (
                  <div
                    className="character-flare-zone"
                    style={{
                      left: `${(flareLaneRef.current / activeLaneCount) * 100}%`,
                      width: `${100 / activeLaneCount}%`,
                    }}
                    aria-label={`Signal flare burning lane ${flareLaneRef.current + 1}`}
                  />
                )}
              {items.map((x) => (
                <div
                  key={x.id}
                  className={`item ${x.kind}${
                    obstacleCosmetic && isHazardKind(x.kind)
                      ? ` obstacle-${obstacleCosmetic}`
                      : ""
                  }${(x.seededUntilWave ?? 0) >= wave ? " seeded" : ""}${x.deactivated ? " deactivated" : ""}${activeCharacter === "tank_sentinel" && x.kind === sentinelAnalyzedKindRef.current ? " analyzed" : ""}${phantomBloodmoonActive && phantomBloodmoonKindsRef.current.has(x.kind) ? " bloodmoon-friendly" : ""}`}
                  style={{
                    left: `${((x.lane + 0.5) / activeLaneCount) * 100}%`,
                    top: `${x.y}%`,
                  }}
                  aria-label={x.kind}
                  role={
                    x.kind === "spikes" &&
                    (activeCharacter === "tank_warden" ||
                      activeCharacter === "misc_tinker")
                      ? "button"
                      : undefined
                  }
                  tabIndex={
                    x.kind === "spikes" &&
                    (activeCharacter === "tank_warden" ||
                      activeCharacter === "misc_tinker")
                      ? 0
                      : undefined
                  }
                  onClick={() => {
                    if (x.kind === "spikes") interactWithSpike(x.id);
                  }}
                  onKeyDown={(event) => {
                    if (
                      x.kind === "spikes" &&
                      (event.key === "Enter" || event.key === " ")
                    ) {
                      event.preventDefault();
                      interactWithSpike(x.id);
                    }
                  }}
                >
                  <Obstacle kind={x.kind} />
                </div>
              ))}
              <div
                className={`runner character-${activeCharacter}${playerCosmetic ? ` player-${playerCosmetic}` : ""}${slowed ? " frozen" : ""}${invincible ? " invincible" : ""}${beaconActiveRef.current ? " beacon-active" : ""}${reviveFlyingRef.current ? " flight-active" : ""}${haloPartsRef.current >= 3 ? " halo-ready" : ""}${phantomLord ? " phantom-lord-form" : ""}${activeCharacter === "runner_velocity" && velocityDisplayPercent > 0 ? velocityDisplayPercent >= 100 ? " velocity-max" : velocityDisplayPercent >= 50 ? " velocity-charged" : " velocity-charging" : ""}`}
                style={{ left: `${((lane + 0.5) / activeLaneCount) * 100}%` }}
              >
                {hasCharacterAbility("medic_halo") && haloPartsRef.current > 0 && <i className="runner-halo" data-pieces={haloPartsRef.current} />}
                {beaconActiveRef.current && <i className="runner-beacon" />}
                {reviveFlyingRef.current && <i className="flight-wings" />}
                {activeCharacter === "runner_velocity" && velocityDisplayPercent > 0 && <i className="velocity-trail" aria-hidden="true" />}
                <div className="head" />
                <div className="body" />
                <i className="arm a1" />
                <i className="arm a2" />
                <i className="leg g1" />
                <i className="leg g2" />
                <em />
                <span className="character-weapon" aria-hidden="true" />
              </div>
              {activeMapId === "pitch" && isVersusRun && (
                <button
                  type="button"
                  className={`pitch-katana${katanaActive ? " active" : ""}${renderedKatanaState.broken ? " broken" : ""}`}
                  data-version={pitchKatanaVersion}
                  disabled={
                    !running ||
                    paused ||
                    renderedKatanaState.broken ||
                    katanaCooldownSeconds > 0
                  }
                  onClick={triggerPitchKatana}
                >
                  <span aria-hidden="true">刀</span>
                  <b>KATANA</b>
                  <small>
                    {renderedKatanaState.broken
                      ? "BROKEN"
                      : katanaActive
                        ? "GUARDING"
                        : katanaCooldownSeconds > 0
                          ? `${katanaCooldownSeconds}s`
                          : "READY"}
                  </small>
                </button>
              )}
            </div>
            {abilityChoice?.kind === "lifeline-lane" && (
              <div className="ability-overlay" role="dialog" aria-modal="true" aria-label="Choose a Rescue Hook lane">
                <section className="ability-panel healer-panel">
                  <header><div><small>TIME STOPPED</small><b>RESCUE HOOK</b></div></header>
                  <div className="ability-panel-body"><p className="ability-panel-note">Choose any lane except your current lane. This zip is immune to collisions.</p><div className="ability-lane-grid" style={{ "--lane-count": activeLaneCount } as CSSProperties}>{getTrackLanes(activeLaneCount).map((targetLane) => <button key={targetLane} className={`ability-option ${targetLane === lane ? "current-lane" : ""}`} disabled={targetLane === lane} onClick={() => chooseLifelineLane(targetLane)}><span>{targetLane + 1}</span><b>LANE {targetLane + 1}</b></button>)}</div></div>
                </section>
              </div>
            )}
            {abilityChoice?.kind === "pacer-character" && (
              <div className="ability-overlay" role="dialog" aria-modal="true" aria-label="Pass the baton">
                <section className="ability-panel runner-panel"><header><div><small>ONE LAST RELAY</small><b>PASS THE BATON</b></div></header><div className="ability-panel-body"><p className="ability-panel-note">Continue from this wave as any owned non-Runner character.</p><div className="ability-option-grid">{pacerCharacterOptions.map((character) => <button key={character.key} className="ability-option" onClick={() => choosePacerCharacter(character.key as CharacterKey)}><span>↗</span><span><b>{character.name}</b><small>{getCharacterClassKey(character.key).toUpperCase()} · {character.rarity.toUpperCase()}</small></span></button>)}</div></div></section>
              </div>
            )}
            {abilityChoice?.kind === "oracle-prophecy" && (
              <div className="ability-overlay" role="dialog" aria-modal="true" aria-label="Choose an Oracle prophecy">
                <section className="ability-panel mythic-panel"><header><div><small>{oracleCompleted} COMPLETED</small><b>CHOOSE THE NEXT PROPHECY</b></div></header><div className="ability-panel-body"><p className="ability-panel-note">Success gives the reward shown plus a permanent 5% score bonus. Failure costs 1 HP and can be lethal.</p><div className="ability-option-grid">{oracleChoiceSets.map((choice) => <button key={choice.join("-")} className="ability-option reward" onClick={() => chooseOracleProphecy(choice)}><span>✦</span><span><b>{choice.map((value) => value.replace("-", " ").toUpperCase()).join(" + ")}</b><small>{choice.map((value, index) => `${ORACLE_PROPHECY_COPY[value].condition} → ${index === 0 ? ORACLE_PROPHECY_COPY[value].reward : ORACLE_PROPHECY_COPY[value].reducedReward}`).join(" · ")}</small></span></button>)}</div></div></section>
              </div>
            )}
            {abilityChoice?.kind === "oracle-passive" && (
              <div className="ability-overlay" role="dialog" aria-modal="true" aria-label="Choose a Healer passive">
                <section className="ability-panel mythic-panel"><header><div><small>NEAR-DEATH REWARD</small><b>TAKE A HEALER PASSIVE</b></div></header><div className="ability-panel-body"><div className="ability-option-grid">{abilityChoice.options.map((characterKey) => { const definition = getCharacterDefinition(characterKey); return <button key={characterKey} className="ability-option reward" onClick={() => chooseOraclePassive(characterKey)}><span>+</span><span><b>{definition.name}</b><small>{CHARACTER_ABILITIES[characterKey].name}</small><em>KEEP FOR THIS RUN</em></span></button>; })}</div></div></section>
              </div>
            )}
            {pulseGame && (
              <div className="ability-overlay" role="dialog" aria-modal="true" aria-label="Last Pulse timed key challenge">
                <section className="ability-panel healer-panel"><header><div><small>{(pulseGame.remaining / 1000).toFixed(1)} SECONDS LEFT</small><b>LAST PULSE · {pulseGame.hits} HITS</b></div></header><div className="ability-panel-body"><p className="ability-panel-note">Press or tap the highlighted key. 10 = 1 HP · 20 = 2 HP · 30 = FULL HP.</p><div className="ability-key-sequence">{(["A", "S", "D", "F"] as const).map((key) => <button key={key} className={`ability-option ${pulseGame.prompt === key ? "selected" : ""}`} onClick={() => { if (pulseGame.prompt !== key) return; setPulseGame((current) => current ? { ...current, hits: current.hits + 1, prompt: (["A", "S", "D", "F"] as const).filter((nextKey) => nextKey !== key)[Math.floor(Math.random() * 3)] } : current); }}><kbd>{key}</kbd></button>)}</div></div></section>
              </div>
            )}
            {!running && (
              <div className="overlay">
                <p>
                  {waitingForVersusResult
                    ? "YOUR RUN IS COMPLETE"
                    : over
                      ? "RUN OVER"
                      : "FIVE LANES. NO BRAKES."}
                </p>
                <h1>
                  {waitingForVersusResult
                    ? "RIVAL STILL RUNNING"
                    : over && isVersusRun && versusResult
                    ? versusResult
                    : over
                      ? `${score.toLocaleString()} POINTS`
                      : "DODGE. DASH. SURVIVE."}
                </h1>
                {isOnlineVersus &&
                  (waitingForVersusResult || versusPhase === "finished") && (
                  <div className="versus-final-scoreboard" role="status">
                    <span>
                      <small>YOUR FINAL SCORE</small>
                      <b>{score.toLocaleString()}</b>
                    </span>
                    <strong>VS</strong>
                    <span>
                      <small>{versusOpponent}</small>
                      <b>{versusOpponentScore.toLocaleString()}</b>
                    </span>
                    <em>
                      {waitingForVersusResult
                        ? "The second runner to finish receives +280, then the final scores decide the match."
                        : "Final scores include the +280 second-finish bonus. Equal scores finish as a draw."}
                    </em>
                  </div>
                )}
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
                {over && !guest && lastRunXpBreakdown && (
                  <div className="run-xp-summary" aria-label="Run XP earned">
                    <strong>
                      +{lastRunXpBreakdown.total.toLocaleString()} XP
                    </strong>
                    <small>
                      SCORE² ÷ 4 +
                      {lastRunXpBreakdown.score.toLocaleString()} ·{" "}
                      {lastRunXpBreakdown.gem_count.toLocaleString()} GEM
                      {lastRunXpBreakdown.gem_count === 1 ? "" : "S"} +
                      {lastRunXpBreakdown.gems.toLocaleString()}
                    </small>
                  </div>
                )}
                {!waitingForVersusResult && (
                  <button
                    onClick={isVersusRun ? backToMenu : () => reset()}
                  >
                    {isVersusRun
                      ? "RETURN TO 1V1 HUB"
                      : over
                        ? "RUN AGAIN"
                        : "START RUN"}{" "}
                    <span>→</span>
                  </button>
                )}
                {over && !isVersusRun && (
                  <button className="back-menu" onClick={backToMenu}>
                    BACK TO MENU
                  </button>
                )}
                {!waitingForVersusResult && (
                  <small>← → / A D &nbsp; TO SWITCH LANES</small>
                )}
              </div>
            )}
            {versusPhase === "intermission" &&
              versusIntermissionReady && (
                <div
                  className="overlay versus-intermission"
                  aria-busy={versusCountdown <= 0}
                >
                  <p>NEXT WAVE IN</p>
                  <h1>{versusCountdown}</h1>
                  <strong>
                    ATTACK COINS: ◉ {getDisplayedAttackPoints(versusPoints)}
                  </strong>
                  <span
                    className="versus-shop-state"
                    role="status"
                    aria-live="polite"
                  >
                    {versusCountdown <= 0
                      ? "STARTING NEXT WAVE…"
                      : "ARMORY OPEN"}
                  </span>
                  <div className="attack-grid">
                    {VERSUS_ATTACKS.filter((attack) =>
                      getAvailableAttacks(activeMapId).includes(attack.kind),
                    ).map((attack) => (
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
                    Each track coin adds {getAttackPointsForCoin(activeMapId)} attack
                    points. {activeMapRules.waveAttackReward.kind === "fixed"
                      ? `Completing the wave adds ${activeMapRules.waveAttackReward.points}.`
                      : "The mushroom winner gets 14; a tie gives both players 7."}{" "}
                    Purchased formations target {versusOpponent}&apos;s lane and
                    rotate the opening next wave.
                  </small>
                  {versusResult && (
                    <div
                      className="versus-message"
                      role="status"
                      aria-live="polite"
                    >
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
              aria-label={`${getDisplayedHearts(hearts)} displayed hearts`}
            >
              {Array.from({ length: Math.ceil(maxHearts) }, (_, n) => n).map(
                (n) => {
                  const displayedHearts = getDisplayedHearts(hearts);
                  const visibleHeartCount = Math.ceil(displayedHearts);
                  const visibleOvercharges = Math.min(
                    relayChargesRef.current,
                    visibleHeartCount,
                  );
                  const overcharged =
                    hasCharacterAbility("runner_relay") &&
                    n >= visibleHeartCount - visibleOvercharges &&
                    n < visibleHeartCount;
                  const fillClass =
                    displayedHearts - n >= 1
                      ? ""
                      : displayedHearts - n > 0
                        ? "partial"
                        : "lost";
                  return (
                    <span
                      key={n}
                      className={`heart-slot${overcharged ? " overcharged" : ""}`}
                    >
                      <span className={`heart-glyph ${fillClass}`}>♥</span>
                      {overcharged && <i aria-hidden="true">↯</i>}
                    </span>
                  );
                },
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
                  {(playerAccess?.active_bans?.length ?? 0) > 0 && (
                    <div className="settings-appeal">
                      <h3>APPEAL A BAN</h3>
                      {myBanAppeal?.appeal?.status === "pending" ? (
                        <div className="appeal-pending" role="status">
                          <b>APPEAL PENDING</b>
                          <span>
                            Sent {new Date(
                              myBanAppeal.appeal.created_at,
                            ).toLocaleString()}
                          </span>
                          <p>{myBanAppeal.appeal.player_note}</p>
                        </div>
                      ) : myBanAppeal && !myBanAppeal.can_appeal ? (
                        <div className="appeal-denied" role="status">
                          <b>
                            APPEAL {myBanAppeal.appeal?.status?.toUpperCase() ??
                              "SENT"}
                          </b>
                          {myBanAppeal.appeal?.admin_note && (
                            <p>{myBanAppeal.appeal.admin_note}</p>
                          )}
                        </div>
                      ) : (
                        <form onSubmit={submitBanAppeal}>
                          <label>
                            YOUR NOTE
                            <textarea
                              value={appealNote}
                              onChange={(event) =>
                                setAppealNote(event.target.value)
                              }
                              minLength={10}
                              maxLength={1500}
                              placeholder="Explain why this ban should be reviewed…"
                              required
                            />
                          </label>
                          <small>{appealNote.length}/1500</small>
                          <button disabled={appealBusy}>
                            {appealBusy ? "SENDING…" : "SUBMIT APPEAL"}
                          </button>
                        </form>
                      )}
                      {appealStatus && (
                        <div className="report-status" role="status">
                          {appealStatus}
                        </div>
                      )}
                    </div>
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
                        <small className="box-note">{box.note}</small>
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
              <div className="duplicate-refund-chart">
                <b>DUPLICATE REFUNDS</b>
                {(Object.keys(DUPLICATE_REFUNDS) as Rarity[]).map((rarity) => (
                  <span key={rarity} className={rarity}>
                    {rarity.toUpperCase()} +♦ {DUPLICATE_REFUNDS[rarity]}
                  </span>
                ))}
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
                {!guest && (
                  <section className="inventory-direct-unlock">
                    <header>
                      <div>
                        <small>CHOOSE EXACTLY WHAT YOU WANT</small>
                        <h3>DIRECT UNLOCK</h3>
                      </div>
                      <strong>♦ {gems} BALANCE</strong>
                    </header>
                    <div className="direct-unlock-prices" aria-label="Direct unlock prices">
                      {(Object.keys(DIRECT_UNLOCK_COSTS) as Rarity[]).map(
                        (rarity) => (
                          <span key={rarity} className={rarity}>
                            <b>{rarity}</b>
                            <small>♦ {DIRECT_UNLOCK_COSTS[rarity]}</small>
                          </span>
                        ),
                      )}
                    </div>
                    {directPurchaseItem ? (
                      <div className="direct-unlock-picker">
                        <label>
                          LOCKED ITEM
                          <select
                            value={directPurchaseItem.item_key}
                            disabled={directPurchaseBusy}
                            onChange={(event) => {
                              setDirectPurchaseKey(event.target.value);
                              setInventoryStatus("");
                            }}
                          >
                            {lockedCatalogItems.map((item) => (
                              <option key={item.item_key} value={item.item_key}>
                                {(item.display_name ?? item.item_key).toUpperCase()} ·{" "}
                                {item.item_type.toUpperCase()} · {item.rarity.toUpperCase()} · ♦{" "}
                                {DIRECT_UNLOCK_COSTS[item.rarity]}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          type="button"
                          disabled={
                            directPurchaseBusy ||
                            gems < DIRECT_UNLOCK_COSTS[directPurchaseItem.rarity]
                          }
                          onClick={() => void purchaseCatalogItem()}
                        >
                          {directPurchaseBusy
                            ? "UNLOCKING…"
                            : `UNLOCK FOR ♦ ${DIRECT_UNLOCK_COSTS[directPurchaseItem.rarity]}`}
                        </button>
                      </div>
                    ) : (
                      <p className="direct-unlock-complete">
                        EVERY AVAILABLE ITEM IS ALREADY UNLOCKED.
                      </p>
                    )}
                  </section>
                )}
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
                      <button
                        className={`default-look${
                          obstacleCosmetic === "" ? " equipped" : ""
                        }`}
                        onClick={() => void equipDefaultCosmetic("obstacle")}
                      >
                        <span className="cosmetic-swatch">◆</span>
                        <b>default obstacles</b>
                        <small>
                          INCLUDED
                          {obstacleCosmetic === "" ? " · EQUIPPED" : ""}
                        </small>
                      </button>
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
                      <button
                        className={`default-look${
                          environmentCosmetic === "" ? " equipped" : ""
                        }`}
                        onClick={() => void equipDefaultCosmetic("environment")}
                      >
                        <span className="cosmetic-swatch">▰</span>
                        <b>default track</b>
                        <small>
                          INCLUDED
                          {environmentCosmetic === "" ? " · EQUIPPED" : ""}
                        </small>
                      </button>
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
                                    {owned
                                      ? " · SELECT · PASSIVE BELOW"
                                      : " · PREVIEW PASSIVE BELOW"}
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
                                <button
                                  className={`default-look${
                                    playerCosmetic === "" ? " equipped" : ""
                                  }`}
                                  onClick={() =>
                                    void equipDefaultCosmetic("player")
                                  }
                                >
                                  <span className="cosmetic-swatch">✦</span>
                                  <b>default runner</b>
                                  <small>
                                    INCLUDED
                                    {playerCosmetic === ""
                                      ? " · EQUIPPED"
                                      : ""}
                                  </small>
                                </button>
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
              className={`admin-inbox${adminTab === "players" ? " player-editor-shell" : adminTab === "appeals" ? " appeals-shell" : ""}`}
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
                    : adminTab === "players"
                      ? "ADMIN 03 · PLAYER LOOKUP + COMMANDS"
                      : "ADMIN 04 · APPEALS + BANS"}
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
                <button
                  className={adminTab === "appeals" ? "active" : ""}
                  onClick={() => void loadAppeals(appealFilter)}
                >
                  04 · APPEALS
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
                            {r.username ?? r.user_id.slice(0, 8)}
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
              ) : adminTab === "appeals" ? (
                <div className="admin-appeals">
                  {adminRole !== "main" && (
                    <div className="appeal-read-only" role="note">
                      CO-ADMIN VIEW ONLY · A MAIN ADMIN MUST APPROVE, DENY, OR
                      UNBAN.
                    </div>
                  )}
                  <div className="appeal-filter" aria-label="Appeal filter">
                    {(["pending", "approved", "denied", "all"] as const).map(
                      (filter) => (
                        <button
                          key={filter}
                          className={appealFilter === filter ? "active" : ""}
                          onClick={() => void loadAppeals(filter)}
                        >
                          {filter.toUpperCase()}
                        </button>
                      ),
                    )}
                  </div>
                  {adminAppealStatus && (
                    <div className="report-status" role="status">
                      {adminAppealStatus}
                    </div>
                  )}
                  <div className="appeal-list">
                    {adminAppeals.length === 0 ? (
                      <div className="empty-reports">
                        No {appealFilter === "all" ? "" : `${appealFilter} `}
                        appeals.
                      </div>
                    ) : (
                      adminAppeals.map((appeal) => (
                        <article key={appeal.id}>
                          <header>
                            <div>
                              <b>{appeal.username || "NO USERNAME"}</b>
                              <small>{appeal.email}</small>
                            </div>
                            <span className={`appeal-state ${appeal.status}`}>
                              {appeal.status.toUpperCase()}
                            </span>
                          </header>
                          <dl>
                            <div>
                              <dt>BAN</dt>
                              <dd>
                                {(appeal.ban_scope || "unknown").toUpperCase()}
                                {` · ${appeal.snapshot_active_ban_count}/${appeal.appealed_ban_count} APPEALED BANS ACTIVE`}
                                {appeal.active_ban_count >
                                  appeal.snapshot_active_ban_count &&
                                  ` · ${appeal.active_ban_count - appeal.snapshot_active_ban_count} NEWER`}
                              </dd>
                            </div>
                            <div>
                              <dt>SUBMITTED</dt>
                              <dd>{new Date(appeal.created_at).toLocaleString()}</dd>
                            </div>
                          </dl>
                          {appeal.ban_note && (
                            <div className="appeal-note ban-note">
                              <b>ADMIN BAN NOTE</b>
                              <p>{appeal.ban_note}</p>
                            </div>
                          )}
                          <div className="appeal-note player-note">
                            <b>PLAYER APPEAL</b>
                            <p>{appeal.player_note}</p>
                          </div>
                          {appeal.status === "pending" &&
                          adminRole === "main" ? (
                            <div className="appeal-review">
                              <label>
                                RESPONSE NOTE <span>OPTIONAL · SHOWN TO PLAYER</span>
                                <textarea
                                  value={adminAppealNotes[appeal.id] ?? ""}
                                  onChange={(event) =>
                                    setAdminAppealNotes((current) => ({
                                      ...current,
                                      [appeal.id]: event.target.value,
                                    }))
                                  }
                                  maxLength={500}
                                  placeholder="Optional response explaining this decision…"
                                />
                              </label>
                              <div>
                                <button
                                  disabled={adminAppealBusyId !== null}
                                  onClick={() =>
                                    void resolveBanAppeal(appeal.id, "approve")
                                  }
                                >
                                  APPROVE &amp; UNBAN
                                </button>
                                <button
                                  disabled={adminAppealBusyId !== null}
                                  onClick={() =>
                                    void resolveBanAppeal(appeal.id, "deny")
                                  }
                                >
                                  DENY
                                </button>
                              </div>
                            </div>
                          ) : appeal.status === "pending" ? (
                            <div className="appeal-card-read-only">
                              READ ONLY · WAITING FOR A MAIN ADMIN
                            </div>
                          ) : (
                            <footer>
                              Reviewed {appeal.reviewed_at
                                ? new Date(appeal.reviewed_at).toLocaleString()
                                : "—"}
                              {appeal.reviewed_by_username ||
                              appeal.reviewed_by_email
                                ? ` by ${appeal.reviewed_by_username || appeal.reviewed_by_email}`
                                : ""}
                              {appeal.admin_note
                                ? ` · Note: ${appeal.admin_note}`
                                : ""}
                            </footer>
                          )}
                        </article>
                      ))
                    )}
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
