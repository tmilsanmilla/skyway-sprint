import {
  CURRENT_RULES,
  FACTORY_RULES,
  GROVE_RULES,
  MAP_IDS,
  PITCH_KATANA_RULES,
  VOLCANO_RULES,
  type MapId,
} from "./arena-map-rules";

export interface GuideEntry {
  readonly name: string;
  readonly description: string;
}

export interface MapGuide extends GuideEntry {
  readonly rules: readonly string[];
}

export type GameplayItemId =
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

const seconds = (value: number) =>
  `${value.toFixed(Number.isInteger(value) ? 0 : 1)} second${value === 1 ? "" : "s"}`;

export const MAP_GUIDES: Readonly<Record<MapId, MapGuide>> = {
  classic: {
    name: "Classic",
    description:
      "The balanced five-lane arena. Standard health, healing, obstacle density, and every character class are available.",
    rules: [
      "Coins give 6 attack points and each completed wave gives 8.",
      "Logs, spikes, barrels, rocks, and snowflakes can spawn naturally.",
    ],
  },
  alley: {
    name: "Alley",
    description:
      "Only three lanes carry the same total traffic as Classic, so every lane is busier. Starting HP and maximum HP are doubled.",
    rules: [
      "Every character class is allowed.",
      "Coins give 7 attack points and each completed wave gives 7.",
      "Logs are most common; snowflakes are rare but still possible.",
    ],
  },
  desert: {
    name: "Desert",
    description:
      "A wide seven-lane arena with no healing. Only Runners and Tricksters are allowed.",
    rules: [
      "Snowflakes do not spawn and cannot be bought here.",
      "Coins give 5 attack points and each completed wave gives 5.",
      "Barrels are the most common natural hazard.",
    ],
  },
  skyway: {
    name: "Skyway",
    description:
      "A six-lane arena with dangerous Current waves in the four middle lanes. Tricksters are not allowed.",
    rules: [
      `A direct Current hit deals ${CURRENT_RULES.directHitDamage} HP; being beside an edge Current can deal ${CURRENT_RULES.edgeAdjacentDamage} HP.`,
      "Current movement ignores the normal frozen-turn delay.",
      "Coins give 5 attack points and each completed wave gives 5.",
    ],
  },
  pitch: {
    name: "Pitch",
    description:
      "A six-lane timing arena where every runner receives a risk-and-reward Katana.",
    rules: [
      `Click KATANA or press Space for a ${seconds(PITCH_KATANA_RULES.activeSeconds)} guard. A timed hit blocks and reflects every non-rock hazard.`,
      `Missing the guard costs ${PITCH_KATANA_RULES.whiffSelfDamage} HP and briefly locks movement. The cooldown is ${seconds(PITCH_KATANA_RULES.cooldownSeconds)} and resets each wave.`,
      "The Katana cannot activate while frozen. A rock breaks it for the rest of the match and still deals damage.",
      "Coins give 6 attack points and each completed wave gives 6.",
    ],
  },
  volcano: {
    name: "Volcano",
    description:
      "A seven-lane survival arena that forces Ace. Staying in one lane too long lets the heat catch you.",
    rules: [
      `After ${seconds(VOLCANO_RULES.graceSecondsInLane)} without moving, heat deals ${VOLCANO_RULES.damagePerTick} HP every ${seconds(VOLCANO_RULES.damageTickSeconds)}.`,
      "There are no snowflakes; rocks are the most common natural hazard.",
      "Coins give 5 attack points and each completed wave gives 5.",
    ],
  },
  factory: {
    name: "Factory",
    description:
      "A compact four-lane arena with one conveyor lane that changes every wave.",
    rules: [
      `The marked conveyor makes hazards either ${FACTORY_RULES.slowMultiplier}× or ${FACTORY_RULES.fastMultiplier}× speed. Its label is shown above the lane.`,
      "Natural traffic is balanced per lane, so the total field is slightly lighter than Classic.",
      "Cars can spawn naturally. Coins and completed waves each give 5 attack points.",
    ],
  },
  grove: {
    name: "Grove",
    description:
      "A six-lane mushroom contest. Both starting and maximum HP gain 1, and healing remains enabled.",
    rules: [
      `Each mushroom gives ${GROVE_RULES.mushroomScore} score. The player with fewer mushrooms after healing loses ${GROVE_RULES.lowerMushroomHealthPenalty} HP.`,
      `The mushroom winner gets ${GROVE_RULES.mushroomWinnerAttackPoints} attack points; a tie gives each player ${GROVE_RULES.mushroomTieAttackPointsPerPlayer}.`,
      "Snowflakes do not spawn and cannot be bought here.",
    ],
  },
};

export const ITEM_GUIDES: Readonly<Record<GameplayItemId, GuideEntry>> = {
  gem: {
    name: "Gem",
    description:
      "Permanent shop currency for signed-in players. A hitless streak carries between waves: rewards climb from 1 to 5, stay at 5 for five more gems, then reach 6 and cap at 7 until damage.",
  },
  coin: {
    name: "Attack Coin",
    description:
      "1v1-only pickup. It adds the current map's attack-point amount to this match so you can buy hazards during intermission.",
  },
  melon: {
    name: "Melon",
    description:
      "Endless-only pickup worth 200 base score before mode and character multipliers. It does not make the wave end sooner.",
  },
  mushroom: {
    name: "Mushroom",
    description:
      "Grove-only pickup worth 120 score. Collect more than your rival to win the wave's mushroom bonus and avoid the health penalty.",
  },
  barrel: {
    name: "Barrel",
    description: "Rolls very quickly and deals 0.5 HP on contact.",
  },
  log: {
    name: "Log",
    description: "Moves slowly and deals 1 HP on contact.",
  },
  car: {
    name: "Car",
    description: "Moves faster than a normal hazard and deals 1 HP on contact.",
  },
  snowflake: {
    name: "Snowflake",
    description:
      "Deals no direct HP damage. It freezes movement for 3 seconds and adds a 0.25-second delay to every turn during the freeze.",
  },
  current: {
    name: "Current",
    description:
      "Skyway-only moving wave. A direct hit deals 0.5 HP; an edge beside it can deal 1 HP, and its pull ignores frozen input delay.",
  },
  rock: {
    name: "Rock",
    description: "Moves extremely slowly but deals 2 HP on contact.",
  },
  spikes: {
    name: "Spikes",
    description:
      "A metal warning plate flashes red before the spikes rise. Contact deals 1 HP.",
  },
};

export const CONTROL_GUIDES: readonly GuideEntry[] = [
  {
    name: "Move",
    description:
      "Use A/D, Left/Right, or the on-screen arrows to change one lane. On mobile, swipe to move one lane or tap a lane to step one lane toward it.",
  },
  {
    name: "Character ability",
    description: "Press E or use the active-ability button. The live kit panel shows its exact state.",
  },
  {
    name: "Secondary ability",
    description: "Some characters use R; their live kit panel names the action and cooldown.",
  },
  {
    name: "Pause / Katana",
    description: "Space pauses Endless. On Pitch, Space activates the Katana instead.",
  },
];

export const validateGameplayGuide = (): readonly string[] => {
  const errors: string[] = [];
  for (const mapId of MAP_IDS) {
    const guide = MAP_GUIDES[mapId];
    if (!guide.name.trim() || !guide.description.trim())
      errors.push(`${mapId} is missing guide copy.`);
    if (guide.rules.length === 0 || guide.rules.some((rule) => !rule.trim()))
      errors.push(`${mapId} is missing map rules.`);
  }
  for (const [itemId, guide] of Object.entries(ITEM_GUIDES)) {
    if (!guide.name.trim() || !guide.description.trim())
      errors.push(`${itemId} is missing item guide copy.`);
  }
  return errors;
};
