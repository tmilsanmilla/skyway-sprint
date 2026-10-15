import {
  ATTACK_POINT_COSTS,
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
  | "pumpkin"
  | "car"
  | "log"
  | "snowflake"
  | "current"
  | "rock"
  | "barrel"
  | "spikes"
  | "vortex";

const seconds = (value: number) =>
  `${value.toFixed(Number.isInteger(value) ? 0 : 1)} second${value === 1 ? "" : "s"}`;

export const MAP_GUIDES: Readonly<Record<MapId, MapGuide>> = {
  meadow: {
    name: "Meadow",
    description:
      "Six lanes of grassland with a marked bonus lane: earn 40% more score there, but take double obstacle damage.",
    rules: [
      "Vortex deals 1 HP and pulls adjacent players toward it, preventing movement away for 0.5 seconds.",
      "Snowflakes freeze for 3 seconds; every frozen turn adds 0.25 seconds.",
      "Coins give 3 attack points, or 7 in the bonus lane; each completed wave gives 4.",
    ],
  },
  terminal: {
    name: "Terminal",
    description:
      "Both rivals share one five-lane metro course as Ace, starting with 4 HP and a Sword with 4 durability.",
    rules: [
      "Spikes deal 2 HP. Running in a spike's lane gives 40% extra score, combining with Ace's 10% for 54%.",
      "There are no attack coins or Armory. Melons give 50% more score; extra melons replacing attack coins give another 40%. Wave healing restores 0.5 HP.",
      "Move outward from an edge lane to wrap to the opposite edge once per wave.",
      "Z faces left, X forward, and C right. While facing sideways you cannot move in the opposite direction. Press Q or click SWORD to hit the lane you face: your own lane when forward, or the neighboring lane when sideways. A hit deals 1 HP; a miss costs 0.5 HP and 1 durability.",
      "Every swing gives you a 3-second cooldown; a successful hit gives both swords that cooldown. Rocks and spikes also cost 1 durability. At zero durability your Sword stays broken for the duel.",
    ],
  },
  classic: {
    name: "Classic",
    description:
      "The balanced five-lane arena. Standard health, healing, obstacle density, and every character class are available.",
    rules: [
      "Coins give 6 attack points and each completed wave gives 8.",
      "Logs, spikes, barrels, rocks, and snowflakes can spawn naturally.",
    ],
  },
  ruins: {
    name: "Ruins",
    description:
      "Four lanes of ancient ruins. Starting and maximum HP are reduced by 1.",
    rules: [
      "Healers and Mythics are banned, plus ten random non-starter characters shared by both rivals.",
      "Collect the one Pumpkin in each wave. Missing three in a row is fatal; collecting one resets the counter.",
      "Coins give 7 attack points and each completed wave gives 7.",
      "Barrels and rocks dominate. Snowflakes and Currents cannot be bought here.",
    ],
  },
  desert: {
    name: "Desert",
    description:
      "A wide seven-lane arena with no healing. Only Runners and Tricksters are allowed.",
    rules: [
      "Snowflakes can spawn and be bought. They delay each frozen turn by 0.25 seconds.",
      "Coins give 5 attack points and each completed wave gives 5.",
      "Rocks are the most common natural hazard, followed by barrels.",
    ],
  },
  skyway: {
    name: "Skyway",
    description:
      "A six-lane arena with dangerous Current waves in the four middle lanes. Tricksters are not allowed.",
    rules: [
      `A direct Current hit deals ${CURRENT_RULES.directHitDamage} HP; being beside an edge Current can deal ${CURRENT_RULES.edgeAdjacentDamage} HP.`,
      "Current movement ignores the normal frozen-turn delay.",
      "Snowflakes add a 0.3-second turn delay here. Currents travel 5% faster than before.",
      "Coins give 5 attack points and each completed wave gives 5.",
    ],
  },
  pitch: {
    name: "Pitch",
    description:
      "A six-lane timing arena where every runner receives a risk-and-reward Katana.",
    rules: [
      `Click KATANA or press Q for a ${seconds(PITCH_KATANA_RULES.activeSeconds)} guard. It blocks and reflects one non-rock hazard, then immediately unwields.`,
      `Missing the guard costs ${PITCH_KATANA_RULES.whiffSelfDamage} HP and briefly locks movement. The ${seconds(PITCH_KATANA_RULES.cooldownSeconds)} cooldown starts when the guard ends and resets each wave.`,
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
      "Natural traffic is balanced per lane, with slightly increased density. Cars, spikes and barrels can spawn.",
      "Cars can spawn naturally. Coins and completed waves each give 5 attack points.",
    ],
  },
  grove: {
    name: "Grove",
    description:
      "A five-lane mushroom contest. Both starting and maximum HP gain 1, and healing remains enabled.",
    rules: [
      `Each mushroom gives ${GROVE_RULES.mushroomScore} score. The player with fewer mushrooms after healing loses ${GROVE_RULES.lowerMushroomHealthPenalty} HP.`,
      `The mushroom winner gets ${GROVE_RULES.mushroomWinnerAttackPoints} attack points; a tie gives each player ${GROVE_RULES.mushroomTieAttackPointsPerPlayer}.`,
      "Snowflakes can spawn and be bought; logs make up half of natural hazards.",
    ],
  },
};

export const ITEM_GUIDES: Readonly<Record<GameplayItemId, GuideEntry>> = {
  vortex: {
    name: "Vortex",
    description:
      "Meadow and Volcano hazard worth 1 HP of damage. It moves midway between Log and Spike speed. Passing beside it locks movement away from it for 0.5 seconds.",
  },
  gem: {
    name: "Gem",
    description:
      "Spend Gems in the Shop. A hitless streak raises each pickup from 1 to 5, holds at 5 for five more Gems, then reaches 6 and caps at 7 until you take damage.",
  },
  coin: {
    name: "Attack Coin",
    description: `1v1-only pickup for intermission attacks. Base prices: Snowflake ${ATTACK_POINT_COSTS.snowflake} (12 on Skyway), Log ${ATTACK_POINT_COSTS.log}, Barrel ${ATTACK_POINT_COSTS.barrel}, Current ${ATTACK_POINT_COSTS.current}, Spike ${ATTACK_POINT_COSTS.spike}, Car ${ATTACK_POINT_COSTS.car}, Rock ${ATTACK_POINT_COSTS.rock}. Each obstacle already bought that wave adds 2 to every price. Buy at most four of each type per wave, except Snowflakes. Availability depends on the map. Terminal has no attack coins.`,
  },
  melon: {
    name: "Melon",
    description:
      "Starts at 300 base score in wave 1 and becomes more valuable each wave, before mode and character multipliers. Terminal adds 50%, and its extra replacement melons add another 40%. Melons do not make the wave end sooner.",
  },
  pumpkin: {
    name: "Pumpkin",
    description: "Ruins has one Pumpkin each wave, moving at Melon speed. It awards no score or currency. Collecting it clears your miss counter; missing three in a row ends your run.",
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
    description:
      "Moves faster than a normal hazard and deals 1 HP on contact. Cars can be bought on every map with an Armory.",
  },
  snowflake: {
    name: "Snowflake",
    description:
      "Freezes you for 3 seconds. Every turn is delayed by 0.25 seconds, or 0.3 seconds on Skyway. Snowflakes do not break your Gem streak. In Hardcore Duel, contact is a fatal hit instead.",
  },
  current: {
    name: "Current",
    description: `Skyway-only hazard and purchase: base ${ATTACK_POINT_COSTS.current} attack points. A direct hit deals 0.5 HP; an edge beside it can deal 1 HP. It uses middle lanes and its pull ignores frozen input delay.`,
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
    description:
      "Press E or use the active-ability button. The live kit panel shows its exact state.",
  },
  {
    name: "Secondary ability",
    description:
      "Some characters use R; their live kit panel names the action and cooldown.",
  },
  {
    name: "Map weapon / Pause",
    description:
      "Q activates your map weapon: Katana on Pitch, Sword on Terminal, or Lightsaber in Photon Fury. The bottom-right button shows cooldown in tenths. Space pauses Endless.",
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
