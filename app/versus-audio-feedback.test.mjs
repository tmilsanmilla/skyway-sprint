import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("1v1 audio reacts to opponent HP and important match actions", async () => {
  const page = await readFile(new URL("./page.tsx", import.meta.url), "utf8");
  const engine = await readFile(
    new URL("./audio-engine.ts", import.meta.url),
    "utf8",
  );

  assert.match(page, /versusOpponentHearts < previousHearts/);
  assert.match(page, /versusOpponentHearts <= 0[\s\S]*?"rivalDown"/);
  assert.match(page, /versusOpponentHearts <= 1[\s\S]*?"rivalCritical"/);
  assert.match(page, /audioEngine\.playSfx\("attackSent"\)/);
  assert.match(page, /audioEngine\.playSfx\("intermission"\)/);
  assert.match(page, /hearts > previousHearts[\s\S]*?playSfx\("heal"\)/);

  for (const cue of [
    "heal",
    "intermission",
    "attackSent",
    "rivalHit",
    "rivalCritical",
    "rivalDown",
  ])
    assert.match(engine, new RegExp(`case "${cue}"`));
});
