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
  skins: [2, 52, 34, 8, 3, 1],
  partC: [71, 27, 2],
  themes: [4000, 3000, 1520, 1120, 330, 30],
} as const;
export const PHOTON_SKIN_TIERS = ["simplistic", "intermediate", "pro", "ascendant", "divine", "immortal"] as const;
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
const LEGACY_PHOTON_SKINS = Object.entries(PHOTON_CHARACTERS).flatMap(
  ([key, c]) =>
    PHOTON_SKIN_TIERS.filter(tier=>tier!=="simplistic").map((tier) => ({
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
export interface PhotonSkin { key:string;character:PhotonCharacterKey;tier:PhotonSkinTier;name:string;color:string;emblem:string;description:string;variant?:number; }
const SECOND_SKIN_STORIES: Record<PhotonCharacterKey,readonly[string,string,string]> = {
 photon_magician:["Backstage", "A street illusionist who learned to split light in the abandoned theaters of Laserdrome", "segmented violet coat, diamond cuffs and twin orbiting cards"],
 photon_tick:["Pendulum", "A clockkeeper guarding the last mechanical observatory between the stars", "brass pendulum, luminous dial and a ring of numbered sparks"],
 photon_trumpet:["Procession", "The lone herald of a fleet that returned from the far side of the sun", "flared shoulder bells, gold braiding and a fanfare crest"],
 photon_saxophone:["Afterhours", "A wandering soloist whose midnight broadcasts guide ships through the dark", "copper lapels, a moonlit scarf and drifting musical notes"],
 photon_wizard:["Wayfinder", "A scholar who charted stable passages through the shifting nebulae", "split rune mantle, glass compass and an angular portal crown"],
 photon_nuclear:["Containment", "An engineer who keeps a miniature star alive inside a portable containment rig", "layered reactor shielding, chartreuse vents and isotope rings"],
 photon_burner:["Cinderwake", "A courier who carries the first flame from a world remade by its own sunrise", "charred armor edges, ember ribbons and a rising flame plume"],
 photon_bull:["Ironbound", "A guardian raised in the zero-gravity foundries of the outer moons", "swept bronze horns, plated shoulders and a comet-shaped buckle"],
 photon_bluff:["Refraction", "A decoy specialist who escaped a mirrored city by inventing a second shadow", "split teal visor, checker panels and offset hologram fins"],
 photon_magnet:["Northstar", "A navigator following the magnetic memory left inside a shattered planet", "asymmetric pole gauntlets, rose field lines and a floating compass"],
 photon_bear:["Winterwatch", "A sentinel who watches over the hibernation gardens on an icebound station", "ivory shoulder fur, aurora claws and a triangular lantern"],
 photon_wrench:["Blueprint", "A mechanic rebuilding a lost spaceport from the diagrams sewn into a work coat", "layered tool belt, cyan schematics and a rotating gear crest"],
 photon_bell:["Eveningstar", "A keeper whose chimes mark safe passages across the station's silent rings", "silver bell collar, crescent epaulets and a luminous sound halo"],
 photon_static:["Stormglass", "A collector who traps harmless lightning inside polished glass armor", "forked antennae, pale electric panels and branching spark trails"],
 photon_oyster:["Moonreef", "A diver who found a living pearl reef beneath an artificial lunar ocean", "layered shell plates, opal ribbons and a small orbiting pearl"],
 photon_spade:["Nightdeal", "A cardrunner carrying the final hand from a tournament held beyond the event horizon", "split obsidian tails, lilac suit marks and a fan of crystal cards"],
};
const variants = ["intermediate","pro","ascendant","divine","immortal"] as const;
export const PHOTON_SKINS: readonly PhotonSkin[] = Object.entries(PHOTON_CHARACTERS).flatMap(([raw,c])=>{
 const key=raw as PhotonCharacterKey,[title,story,look]=SECOND_SKIN_STORIES[key],signature=SKIN_SIGNATURES[key];
 const simple:PhotonSkin={key:`${key}_simplistic`,character:key,tier:"simplistic",name:`${c.name} First Light`,color:signature[3],emblem:signature[4],variant:0,description:`${story}. This early uniform uses a plain fitted suit, a small signature crest and ${look.split(",")[0]}. Its restrained details mark the start of ${c.name}'s journey. Cosmetic only.`};
 return [simple,...variants.flatMap((tier,index)=>[LEGACY_PHOTON_SKINS.find(s=>s.character===key&&s.tier===tier)!,{key:`${key}_${tier}_2`,character:key,tier,name:`${c.name} ${title} ${["Circuit","Vanguard","Constellation","Sanctum","Infinity"][index]}`,color:signature[3],emblem:signature[4],variant:2,description:`${story}. The ${tier} edition adds ${look}, ${["a stitched luminous border","articulated light plates","a constellation of crystal highlights","a radiant ceremonial crown","an eclipse core surrounded by star ribbons"][index]}. Each detail recalls a chapter of the same journey while keeping the character's familiar silhouette. Cosmetic only.`}])];
});
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
  {"key": "photon_theme_switchyard", "name": "Switchyard Nine", "rarity": "common", "floor": "#071a13", "glow": "#7dffb3", "accent": "#3d7b62"},
  {"key": "photon_theme_harbor", "name": "Starlight Harbor", "rarity": "common", "floor": "#180c25", "glow": "#cb98ff", "accent": "#644383"},
  {"key": "photon_theme_tram", "name": "Moon Tram Depot", "rarity": "common", "floor": "#12151d", "glow": "#b5e2e1", "accent": "#426b76"},
  {"key": "photon_theme_market", "name": "Night Market", "rarity": "common", "floor": "#1d1021", "glow": "#ff9cde", "accent": "#844474"},
  {"key": "photon_theme_relay_deck", "name": "Relay Deck", "rarity": "common", "floor": "#1e1908", "glow": "#ffe59b", "accent": "#9b754a"},
  {"key": "photon_theme_orchard", "name": "Plasma Orchard", "rarity": "uncommon", "floor": "#180c25", "glow": "#cb98ff", "accent": "#644383"},
  {"key": "photon_theme_greenhouse", "name": "Orbital Greenhouse", "rarity": "uncommon", "floor": "#12151d", "glow": "#b5e2e1", "accent": "#426b76"},
  {"key": "photon_theme_foundry", "name": "Violet Foundry", "rarity": "uncommon", "floor": "#1d1021", "glow": "#ff9cde", "accent": "#844474"},
  {"key": "photon_theme_reservoir", "name": "Ion Reservoir", "rarity": "uncommon", "floor": "#1e1908", "glow": "#ffe59b", "accent": "#9b754a"},
  {"key": "photon_theme_courtyard", "name": "Satellite Courtyard", "rarity": "uncommon", "floor": "#071a13", "glow": "#7dffb3", "accent": "#3d7b62"},
  {"key": "photon_theme_spectrum", "name": "Spectrum Causeway", "rarity": "rare", "floor": "#12151d", "glow": "#b5e2e1", "accent": "#426b76"},
  {"key": "photon_theme_hollow", "name": "Crystal Hollow", "rarity": "rare", "floor": "#1d1021", "glow": "#ff9cde", "accent": "#844474"},
  {"key": "photon_theme_turbine", "name": "Aurora Turbine", "rarity": "rare", "floor": "#1e1908", "glow": "#ffe59b", "accent": "#9b754a"},
  {"key": "photon_theme_vault", "name": "Magnetic Vault", "rarity": "rare", "floor": "#071a13", "glow": "#7dffb3", "accent": "#3d7b62"},
  {"key": "photon_theme_catwalk", "name": "Lunar Catwalk", "rarity": "rare", "floor": "#180c25", "glow": "#cb98ff", "accent": "#644383"},
  {"key": "photon_theme_tesseract", "name": "Tesseract Hall", "rarity": "epic", "floor": "#1d1021", "glow": "#ff9cde", "accent": "#844474"},
  {"key": "photon_theme_supercell", "name": "Supercell Lab", "rarity": "epic", "floor": "#1e1908", "glow": "#ffe59b", "accent": "#9b754a"},
  {"key": "photon_theme_geode", "name": "Living Geode", "rarity": "epic", "floor": "#071a13", "glow": "#7dffb3", "accent": "#3d7b62"},
  {"key": "photon_theme_spire", "name": "Thunder Spire", "rarity": "epic", "floor": "#180c25", "glow": "#cb98ff", "accent": "#644383"},
  {"key": "photon_theme_equinox", "name": "Equinox Pavilion", "rarity": "epic", "floor": "#12151d", "glow": "#b5e2e1", "accent": "#426b76"},
  {"key": "photon_theme_solstice", "name": "Solstice Crown", "rarity": "legendary", "floor": "#1e1908", "glow": "#ffe59b", "accent": "#9b754a"},
  {"key": "photon_theme_meridian", "name": "Celestial Meridian", "rarity": "legendary", "floor": "#071a13", "glow": "#7dffb3", "accent": "#3d7b62"},
  {"key": "photon_theme_heliosphere", "name": "Heliosphere", "rarity": "legendary", "floor": "#180c25", "glow": "#cb98ff", "accent": "#644383"},
  {"key": "photon_theme_parallax", "name": "Parallax Palace", "rarity": "legendary", "floor": "#12151d", "glow": "#b5e2e1", "accent": "#426b76"},
  {"key": "photon_theme_firmament", "name": "Glass Firmament", "rarity": "legendary", "floor": "#1d1021", "glow": "#ff9cde", "accent": "#844474"},
  {"key": "photon_theme_eventide", "name": "Eventide Nexus", "rarity": "mythic", "floor": "#071a13", "glow": "#7dffb3", "accent": "#3d7b62"},
  {"key": "photon_theme_genesis", "name": "Genesis Well", "rarity": "mythic", "floor": "#180c25", "glow": "#cb98ff", "accent": "#644383"},
  {"key": "photon_theme_omnidrome", "name": "Omnidrome", "rarity": "mythic", "floor": "#12151d", "glow": "#b5e2e1", "accent": "#426b76"},
  {"key": "photon_theme_eternity", "name": "Eternity Fold", "rarity": "mythic", "floor": "#1d1021", "glow": "#ff9cde", "accent": "#844474"},
  {"key": "photon_theme_zenith", "name": "Zenith Beyond", "rarity": "mythic", "floor": "#1e1908", "glow": "#ffe59b", "accent": "#9b754a"},
] as const;
export const DEFAULT_PHOTON_THEME = {
  key: "default",
  name: "Laserdrome",
  rarity: "default",
  floor: "#08090c",
  glow: "#6bff82",
  accent: "#793fc3",
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
export const rollPhotonSkin = (
  random: () => number,
  intermediateOnly = false,
  part: "B" | "C" = "B",
): PhotonBoxItem => ({
  kind: "skin",
  part,
  key: (()=>{const character=pick(keys,random),tier=intermediateOnly?"simplistic":weighted(PHOTON_SKIN_TIERS,PHOTON_BOX_ODDS.skins,random);return pick(PHOTON_SKINS.filter(s=>s.character===character&&s.tier===tier).map(s=>s.key),random);})(),
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
    results.push(key === "skin" ? rollPhotonSkin(random) : { kind: "character", key, part: "B" });
  }
  for (let i = 0; i < (twoCharacters ? 1 : 2); i++) results.push(rollPhotonSkin(random));
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
  else if (c < (PHOTON_BOX_ODDS.partC[0] + PHOTON_BOX_ODDS.partC[1]) / 100) results.push(rollPhotonSkin(random, true, "C"));
  else results.push({ kind: "stardust", key: "stardust_85", amount: 85, part: "C" });
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
