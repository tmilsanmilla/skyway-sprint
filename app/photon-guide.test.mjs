import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PHOTON_GUIDE } from "./photon-guide.ts";

test("Photon's beginner guide explains controls, the Lightsaber, and its currency without formulas", () => {
  assert.equal(PHOTON_GUIDE.steps.length, 3);
  const copy = [PHOTON_GUIDE.introduction, ...PHOTON_GUIDE.steps.map(step => `${step.title} ${step.text}`), PHOTON_GUIDE.needle].join(" ");
  assert.match(copy, /four lanes/i);
  assert.match(copy, /press Q or tap LIGHTSABER/i);
  assert.match(copy, /one obstacle.*point/i);
  assert.match(copy, /half a heart/i);
  assert.match(copy, /cars wear down.*breaks/i);
  assert.match(copy, /Photons are this mode’s currency/i);
  assert.match(copy, /points turn into Photons.*end of the run/i);
  assert.match(copy, /at least 4 points; 7 points earn 10 Photons/i);
  assert.doesNotMatch(copy, /formula|\d+%|\*|cooldown|durability|spawn chances/i);
  assert.ok(copy.split(/\s+/).length < 160);
});

test("both modes share obstacle art, while Photon keeps its own lane-aligned runner and hazards", () => {
  const normal = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
  const photon = readFileSync(new URL("./photon-fury.tsx", import.meta.url), "utf8");
  const sprites = readFileSync(new URL("./obstacle-sprite.tsx", import.meta.url), "utf8");
  for (const view of [normal, photon]) assert.match(view, /import \{ Obstacle \} from "\.\/obstacle-sprite"/);
  for (const shape of ["rock-shape", "car-shape", "log-shape", "barrel-shape", "ground-spike-shape"]) assert.match(sprites, new RegExp(shape));
  assert.match(sprites, /kind === "spikes" \|\| kind === "spike"/);
  assert.match(photon, /className=\{`runner photon-runner/);
  assert.match(photon, /className="playfield photon-playfield"/);
  assert.match(photon, /\[1, 2, 3\]\.map\(lane/);
  assert.match(photon, /left: `\$\{\(item.lane \+ .5\) \* 25\}%`/);
  assert.match(photon, /<Obstacle kind=\{item.kind\}/);
  const footer = photon.slice(photon.indexOf('<footer className="photon-footer">'));
  assert.match(footer, /className="photon-abilities"/);
  assert.match(footer, /heart-glyph/);
  assert.match(footer, /PHOTON_GUIDE.steps/);
});
