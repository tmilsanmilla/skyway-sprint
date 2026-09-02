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
    { key: "runner_ace", name: "Ace", weapon: "Baton" },
    { key: "runner_scout", name: "Scout", weapon: "Twin Blades" },
    { key: "runner_ranger", name: "Ranger", weapon: "Pixel Bow" },
    { key: "runner_pacer", name: "Pacer", weapon: "Relay Rod" },
  ],
  medic: [
    { key: "medic_patch", name: "Patch", weapon: "Med Staff" },
    { key: "medic_mercy", name: "Mercy", weapon: "Injector" },
    { key: "medic_vial", name: "Vial", weapon: "Tonic Flask" },
    { key: "medic_suture", name: "Suture", weapon: "Pulse Thread" },
  ],
  tank: [
    { key: "tank_bulwark", name: "Bulwark", weapon: "Tower Shield" },
    { key: "tank_hammer", name: "Hammer", weapon: "War Hammer" },
    { key: "tank_sentinel", name: "Sentinel", weapon: "Steel Spear" },
    { key: "tank_anchor", name: "Anchor", weapon: "Ground Hook" },
  ],
  trickster: [
    { key: "trickster_rogue", name: "Rogue", weapon: "Daggers" },
    { key: "trickster_jester", name: "Jester", weapon: "Card Fan" },
    { key: "trickster_phantom", name: "Phantom", weapon: "Moon Scythe" },
    { key: "trickster_mirage", name: "Mirage", weapon: "Prism Fans" },
  ],
} as const;
const CHARACTER_ABILITIES = {
  runner_ace: {
    name: "MOMENTUM",
    description:
      "All run score is multiplied by 1.10. This stacks with the selected mode bonus but does not make waves arrive sooner.",
  },
  runner_scout: {
    name: "QUICKSTEP",
    description:
      "Snowflakes never apply their 3-second freeze or 0.25-second turn delay. A snowflake also grants 1 second of invincibility when QUICKSTEP is ready; its shield has a 4-second cooldown.",
  },
  runner_ranger: {
    name: "PICKUP MAGNET",
    description:
      "Gems are collected from your lane or either neighboring lane. In 1v1, attack-point coins must still be collected in your current lane.",
  },
  runner_pacer: {
    name: "WAVE RUSH",
    description:
      "For the first 8 seconds of every wave, run score is multiplied by 1.35. The timer pauses with gameplay and bonus score does not make waves arrive sooner.",
  },
  medic_patch: {
    name: "FIELD DRESSING",
    description:
      "After every Normal wave, heal 1.5 HP instead of 1 HP. Healing can overheal from the Healer's 3 starting HP up to 5 HP.",
  },
  medic_mercy: {
    name: "GRACE GUARD",
    description:
      "The first hit above 0.5 HP each wave deals 0.5 less damage, to a minimum of 0.5 HP. A 0.5-HP barrel does not consume the guard.",
  },
  medic_vial: {
    name: "CRYSTAL TONIC",
    description:
      "Collecting a gem grants 2 seconds of invincibility. The gem is still added permanently when signed in.",
  },
  medic_suture: {
    name: "TRIAGE CYCLE",
    description:
      "After every third completed Normal wave, heal 2.5 HP instead of 1 HP. Healing can overheal up to 5 HP.",
  },
  tank_bulwark: {
    name: "HEAVY PLATE",
    description:
      "The first hit above 0.5 HP each wave deals 0.5 less damage, to a minimum of 0.5 HP. A 0.5-HP barrel does not consume the plate.",
  },
  tank_hammer: {
    name: "DEMOLITION",
    description:
      "Max HP is 5. Every log deals only 0.5 HP. The first barrel hit each wave is destroyed for 0 damage; later barrels deal 0.5 HP.",
  },
  tank_sentinel: {
    name: "LAST STAND",
    description:
      "Once per run, a lethal hit leaves you at 0.5 HP. The triggering obstacle is removed normally.",
  },
  tank_anchor: {
    name: "STONEGUARD",
    description:
      "Rocks deal 1 HP instead of 2 HP. Barrels deal 0.5 HP, logs/cars/spikes deal 1 HP, and snowflakes deal 0 HP.",
  },
  trickster_rogue: {
    name: "SHADOWSTEP",
    description:
      "Graze a hazard as it crosses the runner line in an adjacent lane to gain 0.45 seconds of invincibility. Each hazard can trigger this once, with a 1.25-second cooldown.",
  },
  trickster_jester: {
    name: "ENCORE",
    description: "Start every wave with 2.5 seconds of invincibility.",
  },
  trickster_phantom: {
    name: "PHASE VEIL",
    description:
      "The first damaging obstacle each wave passes through you and deals 0 damage.",
  },
  trickster_mirage: {
    name: "AFTERIMAGE",
    description:
      "After taking a damaging hit and surviving, gain 2 seconds of invincibility when the hit pause ends. The triggering hit still deals full damage; the shield timer continues during any later pause.",
  },
} as const;
type CharacterKey = keyof typeof CHARACTER_ABILITIES;
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
  const inferredClass = characterKey.split("_")[0];
  const classKey =
    inferredClass in CLASS_CHARACTERS ? inferredClass : "runner";
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
const BASE_DAMAGE_DESCRIPTION =
  "DAMAGE BEFORE PASSIVES: barrel 0.5 HP · log/car/spikes 1 HP · rock 2 HP · snowflake 0 HP plus a 3-second freeze that delays every turn by 0.25 seconds.";
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
    description:
      `NORMAL: 3 starting/max HP · heal 1 HP after each wave · 1.00× class score. ${BASE_DAMAGE_DESCRIPTION} HARDCORE: 1 HP · no healing · same damage values. IMPOSSIBLE: 1 HP · no healing · Ace forced · every damaging obstacle deals 1 HP.`,
  },
  {
    key: "medic",
    label: "HEALER",
    description:
      `NORMAL ONLY: start at 3 HP · overheal up to 5 HP · heal 1 HP after each wave before the character's special healing rule. ${BASE_DAMAGE_DESCRIPTION} Healers are unavailable in Hardcore and Impossible.`,
  },
  {
    key: "tank",
    label: "TANK",
    description:
      `NORMAL ONLY: 4 starting/max HP, except Hammer has 5 max HP · heal only 0.5 HP after each wave. ${BASE_DAMAGE_DESCRIPTION} Hammer always takes 0.5 HP from logs and destroys the first barrel each wave for 0 damage. Tanks are unavailable in Hardcore and Impossible.`,
  },
  {
    key: "trickster",
    label: "TRICKSTER",
    description:
      `NORMAL: 2 starting/max HP · heal 1 HP after each wave · 1.15× class score, which does not change wave timing. ${BASE_DAMAGE_DESCRIPTION} HARDCORE: 1 HP · no healing · class score bonus disabled · same damage values.`,
  },
];
const EXTRACTION_BOXES = {
  regular: {
    name: "NORMAL BOX",
    cost: 2,
    pullCount: 1,
    icon: "◇",
    mix: "5% CHARACTER · 95% COSMETIC",
    oddsLabel: "NORMAL PULL ODDS",
    note: "DUPLICATES AWARD NOTHING · LISTED RARITY WEIGHTS ARE NORMALIZED",
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
    name: "10× NORMAL BOX",
    cost: 20,
    pullCount: 10,
    icon: "◇×10",
    mix: "9 NORMAL PULLS · 1 LEGENDARY-ODDS PULL",
    oddsLabel: "10TH: 20% CHARACTER · 80% COSMETIC",
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
    scoutShieldCooldownUntilRef = useRef(0),
    invincibleUntilRef = useRef(0),
    invincibilityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null),
    abilityNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null),
    waveAnnouncementTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
      null,
    ),
    rogueGrazeCooldownUntilRef = useRef(0),
    rogueGrazedItemIdsRef = useRef<Set<number>>(new Set()),
    turnLockedRef = useRef(false),
    delayedMoveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null),
    freezeEffectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null),
    damageLockedRef = useRef(false),
    frozenUntilRef = useRef(0),
    firstGuardWaveRef = useRef(0),
    hammerBreakWaveRef = useRef(0),
    sentinelLastStandUsedRef = useRef(false),
    phantomPhaseWaveRef = useRef(0),
    versusMatchRef = useRef<string | null>(null),
    versusSearchingRef = useRef(false),
    versusSearchTokenRef = useRef(0),
    versusPollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null),
    versusAttackBusyRef = useRef(false),
    realtimeRef = useRef<ReturnType<typeof supabase.channel> | null>(null),
    incomingAttacksRef = useRef<PendingVersusAttack[]>([]),
    spawnedAttackIdsRef = useRef<Set<string>>(new Set()),
    versusFinishedRef = useRef(false),
    versusPointsRef = useRef(0),
    extractBusyRef = useRef(false),
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
  const [mode, setMode] = useState<GameMode>("normal");
  const [mainView, setMainView] = useState<MainView>("endless"),
    [playScope, setPlayScope] = useState<PlayScope>("single"),
    [versusPhase, setVersusPhase] = useState<VersusPhase>("idle"),
    [versusOpponent, setVersusOpponent] = useState("WAITING…"),
    [versusPoints, setVersusPoints] = useState(0),
    [versusCountdown, setVersusCountdown] = useState(15),
    [versusOpponentHearts, setVersusOpponentHearts] = useState(3),
    [versusResult, setVersusResult] = useState(""),
    [versusAttackBusy, setVersusAttackBusy] = useState(false),
    [versusIntermissionReady, setVersusIntermissionReady] = useState(false),
    [versusLeaving, setVersusLeaving] = useState(false),
    [versusLeaders, setVersusLeaders] = useState<VersusLeader[]>([]),
    [versusLeadersLoading, setVersusLeadersLoading] = useState(false),
    [versusLeadersError, setVersusLeadersError] = useState("");
  versusPointsRef.current = versusPoints;
  const isOnlineVersus = playScope === "versus";
  const isBotPractice = playScope === "practice";
  const isVersusRun = playScope !== "single";
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
  const maxHearts =
    mode === "impossible" || mode === "hardcore"
      ? 1
      : activeCharacter === "tank_hammer" || activeClass === "medic"
        ? 5
        : baseHearts;
  const modeMultiplier =
    mode === "impossible" ? 3 : mode === "hardcore" ? 1.75 : 1;
  const classScoreMultiplier =
    activeClass === "trickster" && mode === "normal" ? 1.15 : 1;
  const activeAbility =
    CHARACTER_ABILITIES[activeCharacter as CharacterKey] ??
    CHARACTER_ABILITIES.runner_ace;
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
  const announceWave = useCallback(
    (number: number) => {
      void audioEngine.playSfx("wave");
      setWaveMessage(`WAVE ${number}`);
      setWavePause(true);
      if (waveAnnouncementTimerRef.current)
        clearTimeout(waveAnnouncementTimerRef.current);
      waveAnnouncementTimerRef.current = setTimeout(() => {
        setWaveMessage("");
        setWavePause(false);
        if (number === 1)
          showAbilityNotice(`${activeAbility.name} · ACTIVE`, 1400);
        if (activeCharacter === "runner_ace")
          showAbilityNotice("MOMENTUM · SCORE ×1.10", 1400);
        if (activeCharacter === "runner_pacer") {
          pacerRushRemainingRef.current = 8000;
          showAbilityNotice("WAVE RUSH · SCORE ×1.35 FOR 8 SECONDS", 1600);
        }
        if (activeCharacter === "trickster_jester") {
          grantInvincibility(2500);
          showAbilityNotice("ENCORE · 2.5 SECOND SHIELD", 1400);
        }
        waveAnnouncementTimerRef.current = null;
      }, 1250);
    },
    [activeAbility.name, activeCharacter, grantInvincibility, showAbilityNotice],
  );
  const reset = useCallback(() => {
    setLane(2);
    setItems([]);
    setScore(0);
    setWaveProgress(0);
    setHearts(startingHearts);
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
    firstGuardWaveRef.current = 0;
    hammerBreakWaveRef.current = 0;
    sentinelLastStandUsedRef.current = false;
    phantomPhaseWaveRef.current = 0;
    scoreCarryRef.current = 0;
    pacerRushRemainingRef.current = 0;
    scoutShieldCooldownUntilRef.current = 0;
    rogueGrazeCooldownUntilRef.current = 0;
    rogueGrazedItemIdsRef.current.clear();
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
    announceWave(1);
  }, [announceWave, clearFreezeEffect, soundtrack, startingHearts]);
  const resetGameToMenu = () => {
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
    firstGuardWaveRef.current = 0;
    hammerBreakWaveRef.current = 0;
    sentinelLastStandUsedRef.current = false;
    phantomPhaseWaveRef.current = 0;
    scoreCarryRef.current = 0;
    pacerRushRemainingRef.current = 0;
    scoutShieldCooldownUntilRef.current = 0;
    rogueGrazeCooldownUntilRef.current = 0;
    rogueGrazedItemIdsRef.current.clear();
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
  const move = useCallback((d: number) => {
    if (
      !state.current.running ||
      state.current.paused ||
      state.current.wavePause ||
      turnLockedRef.current
    )
      return;
    const destination = Math.max(0, Math.min(4, state.current.lane + d));
    if (destination === state.current.lane) return;
    if (frozenUntilRef.current > Date.now()) {
      turnLockedRef.current = true;
      delayedMoveTimerRef.current = setTimeout(() => {
        if (
          state.current.running &&
          !state.current.paused &&
          !state.current.wavePause
        ) {
          setLane(destination);
          void audioEngine.playSfx("move");
        }
        turnLockedRef.current = false;
        delayedMoveTimerRef.current = null;
      }, 250);
      return;
    }
    setLane(destination);
    void audioEngine.playSfx("move");
  }, []);
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
          const player = payload.new as {
            user_id: string;
            hearts: number;
            status: string;
            obstacle_points?: number;
            username?: string;
          };
          if (player.user_id === userIdRef.current) {
            if (typeof player.obstacle_points === "number")
              setVersusPoints(player.obstacle_points);
            return;
          }
          setVersusOpponentHearts(Number(player.hearts));
          if (player.username) setVersusOpponent(player.username);
          if (player.status === "eliminated") {
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
          const match = payload.new as {
            status: string;
            winner_user_id: string | null;
          };
          if (match.status === "finished") {
            setVersusResult(
              match.winner_user_id === userIdRef.current ? "VICTORY" : "DEFEAT",
            );
            setVersusPhase("finished");
            setVersusIntermissionReady(false);
            setRunning(false);
            setOver(true);
          }
        },
      )
      .subscribe();
    realtimeRef.current = channel;
  };
  const hydrateVersusState = async (matchId: string) => {
    const { data, error } = await supabase.rpc("get_1v1_state", {
      p_match_id: matchId,
    });
    if (versusMatchRef.current !== matchId) return false;
    if (error || !data) {
      setVersusResult(error?.message ?? "COULD NOT RESTORE THIS MATCH");
      return false;
    }
    const snapshot = data as {
      match?: {
        status?: string;
        intermission_ends_at?: string | null;
        winner_user_id?: string | null;
      };
      self?: {
        hearts?: number;
        wave?: number;
        score?: number;
        obstacle_points?: number;
        status?: string;
      };
      opponent?: {
        username?: string;
        hearts?: number;
        status?: string;
      };
      pending_attacks?: Array<{ id?: string; obstacle_type?: string }>;
    };
    const restoredWave = Math.max(1, Number(snapshot.self?.wave) || 1);
    const restoredScore = Math.max(0, Number(snapshot.self?.score) || 0);
    const restoredHearts = Math.max(0, Number(snapshot.self?.hearts) || 0);
    const matchStatus = snapshot.match?.status ?? "playing";
    const eliminated =
      snapshot.self?.status === "eliminated" || matchStatus === "finished";

    setLane(2);
    setItems([]);
    scoreCarryRef.current = 0;
    setScore(restoredScore);
    setWaveProgress((restoredWave - 1) * 2250);
    setWave(restoredWave);
    setHearts(restoredHearts);
    setVersusPoints(
      Math.max(0, Number(snapshot.self?.obstacle_points) || 0),
    );
    setVersusOpponent(snapshot.opponent?.username || "RIVAL");
    setVersusOpponentHearts(
      Math.max(0, Number(snapshot.opponent?.hearts) || 0),
    );
    setPlayScope("versus");
    setOver(eliminated);
    setRunning(!eliminated);
    setPauseMenuOpen(false);
    setInvincible(false);
    clearFreezeEffect();
    if (delayedMoveTimerRef.current) {
      clearTimeout(delayedMoveTimerRef.current);
      delayedMoveTimerRef.current = null;
    }
    turnLockedRef.current = false;
    setAbilityNotice("");
    last.current = 0;

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
      const remaining = secondsUntil(snapshot.match?.intermission_ends_at, 15);
      setVersusCountdown(remaining);
      setVersusPhase("intermission");
      setVersusIntermissionReady(remaining > 0);
      setPaused(true);
    } else {
      const attacks = Array.from(mergedPending.values()).filter(
        (attack) => !spawnedAttackIdsRef.current.has(attack.id),
      );
      const acknowledgementIds = Array.from(mergedPending.keys());
      incomingAttacksRef.current = [];
      attacks.forEach((attack) =>
        spawnedAttackIdsRef.current.add(attack.id),
      );
      if (attacks.length > 0)
        setItems((current) => [
          ...current,
          ...attacks.map((attack, index) => ({
            id: id.current++,
            lane: Math.floor(Math.random() * 5),
            y: -10 - index * 9,
            kind: attack.kind,
          })),
        ]);
      if (acknowledgementIds.length > 0)
        void acknowledgeSpawnedVersusAttacks(
          matchId,
          acknowledgementIds,
        );
      setVersusPhase("playing");
      setVersusIntermissionReady(false);
      setPaused(false);
      void audioEngine.start(soundtrack);
      announceWave(restoredWave);
    }
    return true;
  };
  const beginVersusMatch = async (
    matchId: string,
    opponent: string,
    serverStatus?: string,
  ) => {
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
    if (serverStatus && serverStatus !== "countdown") {
      const restored = await hydrateVersusState(matchId);
      if (!restored && versusMatchRef.current === matchId) {
        closeVersusChannel();
        versusMatchRef.current = null;
        setPlayScope("single");
        setVersusPhase("idle");
      }
      return;
    }
    setVersusPhase("playing");
    setPlayScope("versus");
    reset();
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
    setVersusCountdown(15);
    setVersusResult("");
    setVersusIntermissionReady(false);
    reset();
  };
  const clearVersusLocalSession = () => {
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
      const { data } = await supabase.rpc("get_1v1_state", {
        p_match_id: matchId,
      });
      if (versusMatchRef.current !== matchId) return;
      const authoritativePoints = Number(data?.self?.obstacle_points);
      if (Number.isFinite(authoritativePoints))
        setVersusPoints(Math.max(0, authoritativePoints));
      const remaining = secondsUntil(data?.match?.intermission_ends_at, 0);
      setVersusCountdown(remaining);
      setVersusIntermissionReady(
        data?.match?.status === "intermission" && remaining > 0,
      );
    };
    versusAttackBusyRef.current = true;
    setVersusAttackBusy(true);
    try {
      const { data, error } = await supabase.rpc("send_1v1_attack", {
        p_match_id: matchId,
        p_obstacle_type: kind,
      });
      if (versusMatchRef.current !== matchId) return;
      if (error) {
        setVersusResult(error.message);
        await refreshAttackCoins();
        return;
      }
      if (typeof data?.remaining_points === "number")
        setVersusPoints(data.remaining_points);
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
      if (now - last.current > Math.max(330, 980 - wave * 55)) {
        last.current = now;
        const r = Math.random(),
          danger = Math.min(0.82, 0.59 + wave * 0.025),
          gemThreshold =
            mode === "impossible" ? 0.86 : mode === "hardcore" ? 0.9 : 0.94;
        let kind: Kind;
        if (isVersusRun && r < 0.27) kind = "coin";
        else if (isOnlineVersus && r > 0.975) kind = "gem";
        else if (r < danger || isVersusRun)
          kind = (["log", "snowflake", "rock", "barrel", "spikes"] as Kind[])[
            Math.floor(Math.random() * 5)
          ];
        else if (r > gemThreshold) kind = "gem";
        else
          kind = (["log", "snowflake", "rock", "barrel", "spikes"] as Kind[])[
            Math.floor(Math.random() * 5)
          ];
        setItems((v) => {
          const blocked = new Set(v.map((x) => x.lane));
          const lanes = [0, 1, 2, 3, 4].filter((l) => !blocked.has(l));
          if (!lanes.length) return v;
          const spawnLane = lanes[Math.floor(Math.random() * lanes.length)];
          return [...v, { id: id.current++, lane: spawnLane, y: -10, kind }];
        });
      }
      setItems((old) => {
        let clearRecoveryZone = false;
        const advanced = old.flatMap((item) => {
          const speedFactor =
            item.kind === "barrel"
              ? 1.75
              : item.kind === "car"
                ? 1.28
                : item.kind === "log"
                  ? 0.72
                  : item.kind === "rock"
                    ? 0.3
                    : 1;
          const n = {
            ...item,
            y:
              item.y +
              BASE_ITEM_SPEED *
                currentSpeedMultiplier *
                speedFactor *
                dt,
          };
          const isHazard = n.kind !== "gem" && n.kind !== "coin";
          const crossedRunnerBand = item.y < 91 && n.y >= 65;
          const rogueGraze =
            activeCharacter === "trickster_rogue" &&
            isHazard &&
            Math.abs(n.lane - state.current.lane) === 1 &&
            crossedRunnerBand &&
            !rogueGrazedItemIdsRef.current.has(n.id);
          if (rogueGraze) {
            rogueGrazedItemIdsRef.current.add(n.id);
            if (rogueGrazeCooldownUntilRef.current <= Date.now()) {
              rogueGrazeCooldownUntilRef.current = Date.now() + 1250;
              grantInvincibility(450);
              showAbilityNotice("SHADOWSTEP · GRAZE SHIELD");
            }
          }
          const rangerPickup =
            activeCharacter === "runner_ranger" &&
            (n.kind === "gem" ||
              (n.kind === "coin" && !isVersusRun)) &&
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
            if (n.kind === "gem") {
              void audioEngine.playSfx("gem");
              const total = gemsRef.current + 1;
              gemsRef.current = total;
              setGems(total);
              setGemBump(false);
              requestAnimationFrame(() => setGemBump(true));
              setTimeout(() => setGemBump(false), 500);
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
              void audioEngine.playSfx("coin");
              if (isBotPractice) {
                versusPointsRef.current += 2;
                setVersusPoints(versusPointsRef.current);
              } else if (isOnlineVersus && versusMatchRef.current) {
                setVersusPoints((v) => v + 2);
                void supabase
                  .rpc("award_1v1_points", {
                    p_match_id: versusMatchRef.current,
                    p_source: "coin",
                    p_amount: 1,
                  })
                  .then(({ data, error }) => {
                    if (error) {
                      setVersusResult(error.message);
                      return;
                    }
                    if (typeof data?.obstacle_points === "number")
                      setVersusPoints(data.obstacle_points);
                  });
              }
            } else if (n.kind === "snowflake") {
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
                applyFreezeEffect(3000);
                setFlash("freeze-hit");
                setTimeout(() => {
                  setFlash((value) =>
                    value === "freeze-hit" ? "" : value,
                  );
                }, 700);
              }
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
              activeCharacter === "trickster_phantom" &&
              phantomPhaseWaveRef.current !== wave
            ) {
              phantomPhaseWaveRef.current = wave;
              void audioEngine.playSfx("shield");
              setFlash("shield");
              setTimeout(() => setFlash(""), 150);
              showAbilityNotice("PHASE VEIL · HIT PHASED");
              return [];
            } else {
              clearRecoveryZone = true;
              damageLockedRef.current = true;
              void audioEngine.playSfx("hit");
              const rawDamage =
                mode === "impossible"
                  ? 1
                  : n.kind === "rock"
                    ? 2
                    : n.kind === "barrel"
                      ? 0.5
                      : activeCharacter === "tank_hammer" && n.kind === "log"
                        ? 0.5
                      : 1;
              let abilityAdjustedDamage =
                activeCharacter === "tank_anchor" && n.kind === "rock"
                  ? 1
                  : rawDamage;
              if (
                activeCharacter === "tank_anchor" &&
                n.kind === "rock" &&
                rawDamage > abilityAdjustedDamage
              )
                showAbilityNotice("STONEGUARD · ROCK DAMAGE 1 HP");
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
              const damage = abilityAdjustedDamage;
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
              const triggerMirageShield =
                nextHearts > 0 && activeCharacter === "trickster_mirage";
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
                if (triggerMirageShield) {
                  grantInvincibility(2000);
                  showAbilityNotice("AFTERIMAGE · 2 SECOND SHIELD", 1400);
                }
              }, 480);
              return [];
            }
            return [];
          }
          if (n.y < 108) return [n];
          rogueGrazedItemIdsRef.current.delete(n.id);
          return [];
        });
        // Keep the runner in place and clear every nearby object after impact.
        const retained = clearRecoveryZone
          ? advanced.filter((item) => item.y <= 45 || item.y >= 105)
          : advanced;
        const retainedIds = new Set(retained.map((item) => item.id));
        rogueGrazedItemIdsRef.current.forEach((itemId) => {
          if (!retainedIds.has(itemId))
            rogueGrazedItemIdsRef.current.delete(itemId);
        });
        return retained;
      });
      const rawProgressGain = (dt / 12) * (1 + wave * 0.01);
      const waveProgressGain = Math.max(1, Math.round(rawProgressGain));
      const pacerRushActive =
        activeCharacter === "runner_pacer" &&
        pacerRushRemainingRef.current > 0;
      const characterScoreMultiplier =
        activeCharacter === "runner_ace"
          ? 1.1
          : pacerRushActive
            ? 1.35
            : 1;
      const totalScoreMultiplier =
        classScoreMultiplier * characterScoreMultiplier;
      scoreCarryRef.current +=
        rawProgressGain *
        currentSpeedMultiplier *
        modeMultiplier *
        totalScoreMultiplier;
      const scoreGain = Math.floor(scoreCarryRef.current);
      scoreCarryRef.current -= scoreGain;
      if (pacerRushActive)
        pacerRushRemainingRef.current = Math.max(
          0,
          pacerRushRemainingRef.current - dt,
        );
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
    grantInvincibility,
    applyFreezeEffect,
    clearFreezeEffect,
    showAbilityNotice,
    activeAbility.name,
  ]);
  useEffect(() => {
    if (!running) return;
    const next = Math.floor(waveProgress / 2250) + 1;
    if (next !== wave) {
      setWave(next);
      if (mode === "normal") {
        const completedWave = next - 1;
        const healAmount =
          activeCharacter === "medic_patch"
            ? 1.5
            : activeCharacter === "medic_suture" && completedWave % 3 === 0
              ? 2.5
              : activeClass === "tank"
                ? 0.5
                : 1;
        if (
          activeCharacter === "medic_patch" &&
          state.current.hearts < maxHearts
        )
          showAbilityNotice("FIELD DRESSING · +1.5 HP", 1200);
        if (
          activeCharacter === "medic_suture" &&
          completedWave % 3 === 0 &&
          state.current.hearts < maxHearts
        )
          showAbilityNotice("TRIAGE CYCLE · +2.5 HP", 1200);
        setHearts((v) => Math.min(maxHearts, v + healAmount));
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
        setVersusCountdown(15);
        setVersusPhase("intermission");
        setVersusIntermissionReady(true);
        setVersusResult(
          queuedAttacks.length === 0
            ? "THE BOT SURVIVED THE WAVE"
            : `BOT WAVE: ${outcome.landed} HIT · ${outcome.dodged} DODGED`,
        );
        setPaused(true);
      } else if (isOnlineVersus && versusMatchRef.current) {
        setVersusPoints((v) => v + 3);
        setVersusCountdown(15);
        setVersusPhase("intermission");
        setVersusIntermissionReady(false);
        setPaused(true);
        void supabase
          .rpc("award_1v1_points", {
            p_match_id: versusMatchRef.current,
            p_source: "wave",
            p_amount: next - 1,
          })
          .then(({ data }) => {
            if (typeof data?.obstacle_points === "number")
              setVersusPoints(data.obstacle_points);
          });
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
        if (botAttacks.length > 0) {
          const shuffledLanes = [0, 1, 2, 3, 4].sort(
            () => Math.random() - 0.5,
          );
          setItems((current) => [
            ...current,
            ...botAttacks.map((attack, index): Item => ({
              id: id.current++,
              lane: shuffledLanes[index % shuffledLanes.length],
              y: -10 - index * 18,
              kind: attack === "spike" ? "spikes" : attack,
            })),
          ]);
        }
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
      const matchId = versusMatchRef.current;
      if (matchId)
        void supabase
          .rpc("update_1v1_state", {
            p_match_id: matchId,
            p_hearts: hearts,
            p_wave: wave,
            p_score: scoreRef.current,
            p_status: "playing",
          })
          .then(({ data, error }) => {
            if (versusMatchRef.current !== matchId) return;
            if (error) {
              setVersusCountdown(1);
              return;
            }
            const pending = new Map(
              incomingAttacksRef.current.map((attack) => [attack.id, attack]),
            );
            const serverPending = (data?.pending_attacks ?? []) as Array<{
              id?: string;
              obstacle_type?: string;
            }>;
            const acknowledgementIds = new Set<string>();
            serverPending.forEach((attack) => {
              const kind = normalizeVersusObstacle(attack.obstacle_type);
              if (attack.id && spawnedAttackIdsRef.current.has(attack.id)) {
                acknowledgementIds.add(attack.id);
                return;
              }
              if (attack.id && kind)
                pending.set(attack.id, { id: attack.id, kind });
            });
            const attacks = Array.from(pending.values());
            incomingAttacksRef.current = [];
            if (attacks.length > 0) {
              attacks.forEach((attack) => {
                spawnedAttackIdsRef.current.add(attack.id);
                acknowledgementIds.add(attack.id);
              });
              setItems((current) => [
                ...current,
                ...attacks.map((attack, index) => ({
                  id: id.current++,
                  lane: Math.floor(Math.random() * 5),
                  y: -10 - index * 9,
                  kind: attack.kind,
                })),
              ]);
            }
            if (acknowledgementIds.size > 0) {
              void acknowledgeSpawnedVersusAttacks(
                matchId,
                Array.from(acknowledgementIds),
              );
            }
            setVersusPhase("playing");
            setPaused(false);
            announceWave(wave);
          });
      return;
    }
    const timer = setTimeout(() => setVersusCountdown((v) => v - 1), 1000);
    return () => clearTimeout(timer);
  }, [
    versusPhase,
    versusCountdown,
    announceWave,
    acknowledgeSpawnedVersusAttacks,
    wave,
    hearts,
    isBotPractice,
  ]);
  useEffect(() => {
    if (playScope !== "versus" || !versusMatchRef.current) return;
    const matchId = versusMatchRef.current;
    const nextStatus = over
      ? "eliminated"
      : versusPhase === "intermission"
        ? "intermission"
        : "playing";
    void supabase.rpc("update_1v1_state", {
      p_match_id: matchId,
      p_hearts: hearts,
      p_wave: wave,
      p_score: scoreRef.current,
      p_status: nextStatus,
    }).then(({ data, error }) => {
      if (versusMatchRef.current !== matchId) return;
      if (error) {
        setVersusResult(error.message);
        return;
      }
      const authoritativePoints = Number(data?.self?.obstacle_points);
      if (Number.isFinite(authoritativePoints))
        setVersusPoints(Math.max(0, authoritativePoints));
      if (nextStatus === "intermission") {
        const remaining = secondsUntil(data?.match?.intermission_ends_at, 15);
        setVersusCountdown(remaining);
        setVersusIntermissionReady(remaining > 0);
      }
    });
    if (over && !versusFinishedRef.current) {
      versusFinishedRef.current = true;
      void supabase.rpc("finish_1v1", { p_match_id: versusMatchRef.current });
    }
  }, [hearts, wave, over, playScope, versusPhase]);
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
      if (!matchId) return;
      void supabase.rpc("sync_1v1_score", {
        p_match_id: matchId,
        p_score: scoreRef.current,
      });
    };
    syncScore();
    const timer = window.setInterval(syncScore, 1000);
    return () => window.clearInterval(timer);
  }, [over, playScope, running, versusPhase]);
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
    firstGuardWaveRef.current = 0;
    hammerBreakWaveRef.current = 0;
    sentinelLastStandUsedRef.current = false;
    phantomPhaseWaveRef.current = 0;
    scoreCarryRef.current = 0;
    pacerRushRemainingRef.current = 0;
    scoutShieldCooldownUntilRef.current = 0;
    rogueGrazeCooldownUntilRef.current = 0;
    rogueGrazedItemIdsRef.current.clear();
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
    extractBusyRef.current = true;
    setExtractBusy(true);
    setExtractResults([]);
    setShopStatus(`Opening ${box.name.toLowerCase()}…`);
    try {
      const { data, error } = await supabase.rpc("extract_items", {
        pull_count: box.pullCount,
        box_type: "regular",
      });
      if (error) {
        setShopStatus(error.message);
        return;
      }
      const results = (data?.results ?? []) as ExtractionResult[];
      setExtractResults(results);
      gemsRef.current = data.gems;
      setGems(data.gems);
      const newCount = results.filter((item) => item.is_new).length;
      const duplicateCount = results.length - newCount;
      setShopStatus(
        box.pullCount === 10
          ? `${box.name} OPENED — ${newCount} NEW · ${duplicateCount} DUPLICATE${duplicateCount === 1 ? "" : "S"}`
          : newCount === 0
            ? "Duplicate pulled — nothing was added to your collection."
            : `${box.name} OPENED — NEW ITEM UNLOCKED!`,
      );
      await loadCollection();
    } finally {
      extractBusyRef.current = false;
      setExtractBusy(false);
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
      <div className={`game-layout view-${mainView}`}>
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
                      Spend attack coins during the 15-second intermission to
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
              title={activeAbility.description}
              aria-label={`Active ability: ${activeAbility.name}. ${activeAbility.description}`}
            >
              <small>ABILITY</small>
              <b>{activeAbility.name}</b>
              <span>{activeAbility.description}</span>
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
                      onClick={() => setMode("normal")}
                    >
                      <b>NORMAL</b>
                      <small>
                        Selected class HP, healing, damage, and score rules
                        apply
                      </small>
                    </button>
                    <button
                      className={mode === "hardcore" ? "selected" : ""}
                      onClick={() => setMode("hardcore")}
                    >
                      <b>HARDCORE</b>
                      <small>
                        1 HP · no healing · no Healer/Tank · 1.75× score
                        before character bonuses
                      </small>
                    </button>
                    <button
                      className={mode === "impossible" ? "selected" : ""}
                      onClick={() => setMode("impossible")}
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
                      : reset
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
            <section className="powerup-modal">
              <button
                className="report-close"
                disabled={extractBusy}
                onClick={() => {
                  setShopOpen(false);
                  setPaused(false);
                  setExtractResults([]);
                  setShopStatus("");
                }}
              >
                ×
              </button>
              <p>GEM SHOP</p>
              <h2>EXTRACTION SHOP</h2>
              <div className="extract-actions">
                {(Object.keys(EXTRACTION_BOXES) as ExtractionOption[]).map(
                  (option) => {
                    const box = EXTRACTION_BOXES[option];
                    return (
                      <article
                        key={option}
                        className={`extract-box ${option}`}
                      >
                        <span className="box-icon" aria-hidden="true">
                          {box.icon}
                        </span>
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
                        <button
                          disabled={extractBusy}
                          onClick={() => extract(option)}
                        >
                          {extractBusy
                            ? "OPENING…"
                            : `OPEN ${box.pullCount}`}{" "}
                          <span>♦ {box.cost}</span>
                        </button>
                      </article>
                    );
                  },
                )}
              </div>
              {extractResults.length > 0 && (
                <div
                  className={`extract-results${extractResults.length > 1 ? " bundle" : ""}`}
                >
                  {extractResults.map((item, index) => (
                    <span
                      key={item.item_key + index}
                      className={`${item.rarity}${item.is_new ? "" : " duplicate"}${item.draw_profile === "legendary" ? " legendary-roll" : ""}`}
                    >
                      <b>
                        {item.pull_number
                          ? `#${item.pull_number} · `
                          : ""}
                        {item.rarity}
                      </b>
                      {item.display_name ?? item.item_key.replaceAll("_", " ")}
                      <small>
                        {item.draw_profile === "legendary"
                          ? "10TH · LEGENDARY ODDS · "
                          : ""}
                        {item.is_new
                          ? `NEW ${item.category}`
                          : "DUPLICATE · NOTHING ADDED"}
                      </small>
                    </span>
                  ))}
                </div>
              )}
              <strong className="shop-balance">BALANCE: ♦ {gems}</strong>
              {shopStatus && <div className="report-status">{shopStatus}</div>}
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
                <span>02 RUNNER</span>
                <span>03 HEALER</span>
                <span>04 TANK</span>
                <span>05 TRICKSTER</span>
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
                          <b>{roster[0].name} is the included default kit.</b>{" "}
                          Other {label.toLowerCase()} variants stay locked until
                          they are extracted from a box.
                        </p>
                        <div className="inventory-roster">
                          {roster.map((character) => {
                            const unlock = unlocks.find(
                              (item) =>
                                item.item_type === "character" &&
                                item.item_key === character.key,
                            );
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
                                    {" · SELECT · RULES BELOW"}
                                  </em>
                                </span>
                                <small
                                  className={`character-rarity ${unlock?.rarity ?? "common"}`}
                                >
                                  {isStarterCharacter(character.key)
                                    ? "STARTER"
                                    : unlock?.rarity ?? "LOCKED"}
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
                                  <small>
                                    HP, healing, damage, score, weapon, and
                                    passive ability.
                                  </small>
                                </span>
                              </summary>
                              <article className="class-rules-showcase">
                                <small>{label} CLASS RULES</small>
                                <b>{focusedCharacter.name}</b>
                                <p>{description}</p>
                              </article>
                              <div className="inventory-inspection">
                                <article className="weapon-showcase">
                                  <span
                                    className={`weapon-showcase-icon character-${focusedCharacter.key}`}
                                    aria-hidden="true"
                                  />
                                  <div>
                                    <small>WEAPON PREVIEW</small>
                                    <b>{focusedCharacter.weapon}</b>
                                    <p>
                                      Visual only — weapons unlock with their
                                      character and add no separate stats.
                                    </p>
                                  </div>
                                </article>
                                <article className="ability-showcase">
                                  <small>PASSIVE ABILITY</small>
                                  <b>{focusedCharacterAbility?.name}</b>
                                  <p>{focusedCharacterAbility?.description}</p>
                                </article>
                              </div>
                            </details>
                            <details className="inventory-subsection character-cosmetics-subsection">
                              <summary className="inventory-subsection-heading">
                                <span>
                                  <b>
                                    UNIVERSAL RUNNER COSMETICS
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
                                      : "No runner cosmetics collected yet. Open a box in the Shop."}
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
