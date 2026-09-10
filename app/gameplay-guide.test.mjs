import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

import {
  CURRENT_RULES,
  FACTORY_RULES,
  GROVE_RULES,
  MAP_IDS,
  PITCH_KATANA_RULES,
  VOLCANO_RULES,
} from "./arena-map-rules.ts";
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      specifier === "./arena-map-rules" &&
      context.parentURL?.endsWith("/gameplay-guide.ts")
    )
      return nextResolve("./arena-map-rules.ts", context);
    return nextResolve(specifier, context);
  },
});

const {
  CONTROL_GUIDES,
  ITEM_GUIDES,
  MAP_GUIDES,
  validateGameplayGuide,
} = await import("./gameplay-guide.ts");

test("every arena, item, and control has usable guide copy", () => {
  assert.deepEqual(validateGameplayGuide(), []);
  assert.deepEqual(Object.keys(MAP_GUIDES), [...MAP_IDS]);
  assert.deepEqual(Object.keys(ITEM_GUIDES).sort(), [
    "barrel",
    "car",
    "coin",
    "current",
    "gem",
    "log",
    "melon",
    "mushroom",
    "rock",
    "snowflake",
    "spikes",
  ]);
  assert.ok(CONTROL_GUIDES.every((entry) => entry.name && entry.description));
  assert.equal(
    new Set(CONTROL_GUIDES.map(({ name }) => name)).size,
    CONTROL_GUIDES.length,
  );
});

test("Pitch guide explains every dangerous Katana rule", () => {
  const copy = [MAP_GUIDES.pitch.description, ...MAP_GUIDES.pitch.rules].join(" ");
  assert.match(copy, new RegExp(String(PITCH_KATANA_RULES.activeSeconds)));
  assert.match(copy, new RegExp(String(PITCH_KATANA_RULES.cooldownSeconds)));
  assert.match(copy, new RegExp(String(PITCH_KATANA_RULES.whiffSelfDamage)));
  assert.match(copy, /frozen/i);
  assert.match(copy, /rock breaks/i);
  assert.match(copy, /reflect/i);
});

test("item guide includes the exact core hazard and pickup behavior", () => {
  assert.match(ITEM_GUIDES.rock.description, /2 HP/);
  assert.match(ITEM_GUIDES.barrel.description, /0\.5 HP/);
  assert.match(ITEM_GUIDES.snowflake.description, /3 seconds/);
  assert.match(ITEM_GUIDES.snowflake.description, /0\.25-second/);
  assert.match(ITEM_GUIDES.melon.description, /200 base score/);
  assert.match(ITEM_GUIDES.coin.description, /1v1-only/);
  assert.match(ITEM_GUIDES.gem.description, /stay at 5 for five more gems/);
  assert.match(ITEM_GUIDES.gem.description, /cap at 7 until damage/);
  assert.match(
    CONTROL_GUIDES.find(({ name }) => name === "Move")?.description ?? "",
    /swipe to move one lane.*tap a lane to step one lane toward it/i,
  );
});

test("special-map guides expose their authoritative numeric mechanics", () => {
  const skyway = [MAP_GUIDES.skyway.description, ...MAP_GUIDES.skyway.rules].join(" ");
  assert.match(skyway, new RegExp(String(CURRENT_RULES.directHitDamage)));
  assert.match(skyway, new RegExp(String(CURRENT_RULES.edgeAdjacentDamage)));

  const volcano = [MAP_GUIDES.volcano.description, ...MAP_GUIDES.volcano.rules].join(" ");
  assert.match(volcano, new RegExp(String(VOLCANO_RULES.graceSecondsInLane)));
  assert.match(volcano, new RegExp(String(VOLCANO_RULES.damagePerTick)));
  assert.match(volcano, new RegExp(String(VOLCANO_RULES.damageTickSeconds)));

  const factory = [MAP_GUIDES.factory.description, ...MAP_GUIDES.factory.rules].join(" ");
  assert.match(factory, new RegExp(String(FACTORY_RULES.slowMultiplier)));
  assert.match(factory, new RegExp(String(FACTORY_RULES.fastMultiplier)));

  const grove = [MAP_GUIDES.grove.description, ...MAP_GUIDES.grove.rules].join(" ");
  assert.match(grove, new RegExp(String(GROVE_RULES.mushroomScore)));
  assert.match(
    grove,
    new RegExp(String(GROVE_RULES.lowerMushroomHealthPenalty)),
  );
});
