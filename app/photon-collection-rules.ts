import {
  PHOTON_CHARACTERS,
  type PhotonCharacterKey,
} from "./photon-fury-rules";
export const PHOTON_BOX_COST = 200;
/** Independent rarity/type rolls; duplicate ownership never changes these odds. */
export const PHOTON_BOX_ODDS = {
  traditional: [48, 29, 23],
  twoBonusCharacters: 35,
  rush: [41, 33, 26],
  strategic: [57, 32, 11],
  wild: [26, 18, 11, 45],
  skins: [53, 35, 8, 3, 1],
  partC: [72, 24, 4],
  themes: [4000, 3000, 1510, 1140, 330, 20],
} as const;
export const PHOTON_SKIN_TIERS = ["intermediate", "pro", "ascendant", "divine", "immortal"] as const;
export type PhotonSkinTier = (typeof PHOTON_SKIN_TIERS)[number];
export type PhotonThemeRarity =
  "common" | "uncommon" | "rare" | "epic" | "legendary" | "mythic";
const SKIN_SIGNATURES: Record<PhotonCharacterKey, readonly [string, string, string, string, string]> = {
  photon_magician: ["Arcane Apprentice", "Holo Illusionist", "Astral Sovereign", "#bd80ff", "✧"],
  photon_tick: ["Quartz Clockwork", "Chrono Pilot", "Eternal Hour", "#a8e5ff", "◷"],
  photon_trumpet: ["Brass Cadet", "Solar Fanfare", "Golden Anthem", "#ffe073", "♬"],
  photon_saxophone: ["Copper Session", "Midnight Solo", "Celestial Jazz", "#ffad61", "♪"],
  photon_wizard: ["Rune Walker", "Portal Adept", "Cosmic Archmage", "#7f9bff", "⌁"],
  photon_nuclear: ["Isotope Suit", "Fusion Reactor", "Stellar Detonation", "#d5ff54", "☢"],
  photon_burner: ["Ember Suit", "Plasma Inferno", "Phoenix Corona", "#ff7660", "♨"],
  photon_bull: ["Iron Horn", "Titan Charger", "Nebula Minotaur", "#ffba83", "⋔"],
  photon_bluff: ["Decoy Suit", "Mirror Operator", "Quantum Mirage", "#64e4c3", "◇"],
  photon_magnet: ["Polar Coat", "Flux Commander", "Gravity Sovereign", "#fa83df", "⊂"],
  photon_bear: ["Alloy Cub", "Ursine Sentinel", "Aurora Guardian", "#d8c6a4", "✦"],
  photon_wrench: ["Chrome Mechanic", "Circuit Architect", "Divine Machine", "#86c5db", "⚙"],
  photon_bell: ["Silver Chime", "Resonance Halo", "Empyrean Peal", "#fff0a1", "♧"],
  photon_static: ["Ion Spark", "Storm Conductor", "Thunder Ascendant", "#eaff88", "ϟ"],
  photon_oyster: ["Pearl Shell", "Iridescent Reef", "Galactic Pearl", "#f5b7e3", "◉"],
  photon_spade: ["Carbon Suit", "Obsidian Dealer", "Astral Ace", "#c9a0ff", "♠"],
};
export const PHOTON_SKINS = Object.entries(PHOTON_CHARACTERS).flatMap(
  ([key, c]) =>
    PHOTON_SKIN_TIERS.map((tier) => ({
      key: `${key}_${tier}`,
      character: key as PhotonCharacterKey,
      tier,
      name: tier === "ascendant" ? `${c.name} Starforged` : tier === "immortal" ? `${c.name} Eternity` : SKIN_SIGNATURES[key as PhotonCharacterKey][tier === "intermediate" ? 0 : tier === "pro" ? 1 : 2],
      color: SKIN_SIGNATURES[key as PhotonCharacterKey][3],
      emblem: SKIN_SIGNATURES[key as PhotonCharacterKey][4],
      description:
        tier === "intermediate"
          ? `${c.name}'s ion-plated suit and signature crest. Cosmetic only.`
          : tier === "pro"
            ? `${c.name}'s holographic armor, illuminated circuitry and orbiting emitter. Cosmetic only.`
            : tier === "ascendant"
              ? `${c.name}'s starforged suit channels bright comet trails through radiant crystal pauldrons and a floating constellation crest. Cosmetic only.`
              : tier === "immortal"
                ? `${c.name}'s eternal regalia surrounds an eclipse-dark core with a luminous halo, sweeping aurora ribbons and an orbit of tiny stars. Cosmetic only.`
                : `${c.name}'s prismatic astral armor, luminous crown and starfield trail. Cosmetic only.`,
    })),
);
export const PHOTON_THEMES = [
  {
    key: "photon_theme_cobalt",
    name: "Cobalt Circuit",
    rarity: "common",
    floor: "#091b31",
    glow: "#41d9ff",
    accent: "#18587a",
  },
  {
    key: "photon_theme_hangar",
    name: "Orbital Hangar",
    rarity: "common",
    floor: "#152027",
    glow: "#94ffa2",
    accent: "#405965",
  },
  {
    key: "photon_theme_terminal",
    name: "Neon Terminal",
    rarity: "common",
    floor: "#181025",
    glow: "#fa8bff",
    accent: "#544077",
  },
  {
    key: "photon_theme_reactor",
    name: "Reactor Core",
    rarity: "uncommon",
    floor: "#17270f",
    glow: "#d0ff43",
    accent: "#547a17",
  },
  {
    key: "photon_theme_polar",
    name: "Polar Array",
    rarity: "uncommon",
    floor: "#132532",
    glow: "#e0faff",
    accent: "#4588ad",
  },
  {
    key: "photon_theme_sunset",
    name: "Solar Dock",
    rarity: "uncommon",
    floor: "#32141c",
    glow: "#ffa474",
    accent: "#9f4159",
  },
  {
    key: "photon_theme_abyss",
    name: "Abyssal Relay",
    rarity: "rare",
    floor: "#050d25",
    glow: "#686bff",
    accent: "#373484",
  },
  {
    key: "photon_theme_quartz",
    name: "Quantum Quartz",
    rarity: "rare",
    floor: "#251334",
    glow: "#e6b7ff",
    accent: "#895bc2",
  },
  {
    key: "photon_theme_mars",
    name: "Martian Outpost",
    rarity: "rare",
    floor: "#301b16",
    glow: "#ff7549",
    accent: "#8d4634",
  },
  {
    key: "photon_theme_storm",
    name: "Tesla Storm",
    rarity: "epic",
    floor: "#111133",
    glow: "#bde8ff",
    accent: "#634de0",
  },
  {
    key: "photon_theme_void",
    name: "Void Cathedral",
    rarity: "epic",
    floor: "#160c23",
    glow: "#f647e9",
    accent: "#61235b",
  },
  {
    key: "photon_theme_garden",
    name: "Bio-Neon Garden",
    rarity: "epic",
    floor: "#06231e",
    glow: "#47ffc8",
    accent: "#178662",
  },
  {
    key: "photon_theme_nova",
    name: "Supernova Station",
    rarity: "legendary",
    floor: "#35100d",
    glow: "#ffe35a",
    accent: "#ec542a",
  },
  {
    key: "photon_theme_chrono",
    name: "Chronosphere",
    rarity: "legendary",
    floor: "#161e36",
    glow: "#77ffef",
    accent: "#896cff",
  },
  {
    key: "photon_theme_prism",
    name: "Prism Citadel",
    rarity: "legendary",
    floor: "#242037",
    glow: "#fff4f9",
    accent: "#ff71c9",
  },
  {
    key: "photon_theme_singularity",
    name: "Singularity",
    rarity: "mythic",
    floor: "#020207",
    glow: "#e8d6ff",
    accent: "#7140ce",
  },
  {
    key: "photon_theme_celestial",
    name: "Celestial Engine",
    rarity: "mythic",
    floor: "#101735",
    glow: "#ffe6a0",
    accent: "#5c92d9",
  },
  { key: "photon_theme_arcade", name: "Arcade Atrium", rarity: "common", floor: "#122420", glow: "#65f5bd", accent: "#40756b" },
  { key: "photon_theme_tidal", name: "Tidal Generator", rarity: "uncommon", floor: "#081d35", glow: "#5ce2ff", accent: "#276c8a" },
  { key: "photon_theme_blossom", name: "Ion Blossom", rarity: "rare", floor: "#32102e", glow: "#ffb4e9", accent: "#9c477e" },
  { key: "photon_theme_eclipse", name: "Eclipse Observatory", rarity: "epic", floor: "#100c22", glow: "#ffb24c", accent: "#684c9c" },
  { key: "photon_theme_aurora", name: "Aurora Palace", rarity: "legendary", floor: "#07242d", glow: "#cdffd9", accent: "#9575ec" },
  { key: "photon_theme_infinity", name: "Infinity Spire", rarity: "mythic", floor: "#090722", glow: "#f4dfff", accent: "#d96bff" },
  { key: "photon_theme_elysium", name: "Elysium Gate", rarity: "mythic", floor: "#211d06", glow: "#fff7a2", accent: "#b6a9ef" },
] as const;
export const DEFAULT_PHOTON_THEME = {
  key: "default",
  name: "Laserdrome",
  rarity: "default",
  floor: "#080e25",
  glow: "#3cf4ff",
  accent: "#7b46ed",
} as const;
export type PhotonBoxItem = {
  kind: "character" | "skin" | "theme" | "gems" | "stardust";
  key: string;
  amount?: number;
  part: "A" | "B" | "C";
};
const keys = Object.keys(PHOTON_CHARACTERS) as PhotonCharacterKey[];
const rarities: PhotonThemeRarity[] = [
  "common",
  "uncommon",
  "rare",
  "epic",
  "legendary",
  "mythic",
];
const unit = (random: () => number) => {
  const n = random();
  if (!Number.isFinite(n) || n < 0 || n >= 1)
    throw new Error("Invalid box roll");
  return n;
};
const index = (length: number, random: () => number) => Math.floor(unit(random) * length);
const pick = (values: readonly string[], random: () => number) =>
  values[index(values.length, random)];
const weighted = (
  names: readonly string[],
  weights: readonly number[],
  random: () => number,
) => {
  const total = weights.reduce((a, b) => a + b, 0);
  const roll = unit(random);
  let cumulative = 0;
  for (let i = 0; i < names.length; i++) {
    cumulative += weights[i];
    if (roll < cumulative / total) return names[i];
  }
  throw new Error("Invalid box odds");
};
const skin = (
  random: () => number,
  intermediateOnly = false,
  part: "B" | "C" = "B",
): PhotonBoxItem => ({
  kind: "skin",
  part,
  key: `${pick(keys, random)}_${intermediateOnly ? "intermediate" : weighted(PHOTON_SKIN_TIERS, PHOTON_BOX_ODDS.skins, random)}`,
});
export const rollPhotonMysteryBox = (
  random: () => number = Math.random,
): PhotonBoxItem[] => {
  const results: PhotonBoxItem[] = [
    {
      kind: "character",
      part: "A",
      key: weighted(
        ["photon_tick", "photon_trumpet", "photon_saxophone"],
        PHOTON_BOX_ODDS.traditional,
        random,
      ),
    },
  ];
  const twoCharacters = unit(random) < PHOTON_BOX_ODDS.twoBonusCharacters / 100;
  const categories = ["rush", "strategic", "wild"];
  for (let i = 0; i < (twoCharacters ? 2 : 1); i++) {
    const category = categories.splice(index(categories.length, random), 1)[0];
    const key =
      category === "rush"
        ? weighted(
            ["photon_bull", "photon_nuclear", "photon_burner"],
            PHOTON_BOX_ODDS.rush,
            random,
          )
        : category === "strategic"
          ? weighted(
              ["photon_wrench", "photon_bear", "photon_magnet"],
              PHOTON_BOX_ODDS.strategic,
              random,
            )
          : weighted(
              ["photon_oyster", "photon_static", "photon_spade", "skin"],
              PHOTON_BOX_ODDS.wild,
              random,
            );
    results.push(key === "skin" ? skin(random) : { kind: "character", key, part: "B" });
  }
  for (let i = 0; i < (twoCharacters ? 1 : 2); i++) results.push(skin(random));
  const c = unit(random);
  if (c < PHOTON_BOX_ODDS.partC[0] / 100)
    for (let i = 0; i < 2; i++) {
      const rarity = weighted(
        rarities,
        PHOTON_BOX_ODDS.themes,
        random,
      );
      results.push({
        kind: "theme",
        part: "C",
        key: pick(
          PHOTON_THEMES.filter((t) => t.rarity === rarity).map((t) => t.key),
          random,
        ),
      });
    }
  else if (c < (PHOTON_BOX_ODDS.partC[0] + PHOTON_BOX_ODDS.partC[1]) / 100) results.push(skin(random, true, "C"));
  else results.push({ kind: "stardust", key: "stardust_75", amount: 75, part: "C" });
  return results;
};
/** All owned character/skin/theme duplicates return the same 10 Gems. */
export const photonDuplicateGems = (kind: PhotonBoxItem["kind"], part: PhotonBoxItem["part"] = "B") => {
  void part; // Kept for receipt compatibility; refunds no longer depend on part.
  return ["skin", "character", "theme"].includes(kind) ? 10 : 0;
};

/** Mirrors the atomic SQL receipt, including duplicates within this same box. */
export const settlePhotonMysteryBox = (items: readonly PhotonBoxItem[], existingKeys: readonly string[]) => {
  const owned = new Set(existingKeys);
  let gems = 0, stardust = 0;
  const results = items.map((item) => {
    const currency = item.kind === "gems" || item.kind === "stardust";
    const isNew = currency || !owned.has(item.key);
    const duplicateGems = currency || isNew ? 0 : photonDuplicateGems(item.kind, item.part);
    if (isNew && !currency) owned.add(item.key);
    gems += item.kind === "gems" ? item.amount ?? 0 : duplicateGems;
    if (item.kind === "stardust") stardust += item.amount ?? 0;
    return { ...item, is_new: isNew, duplicate_gems: duplicateGems };
  });
  return { results, gems, stardust, ownedKeys: [...owned] };
};
