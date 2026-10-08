import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolveOneVersusOneScores } from "./arena-map-rules.ts";
test("final score resolves ties to the second finisher without fractional Elo results", () => {
  assert.deepEqual(resolveOneVersusOneScores(11363, 10346, "playerTwo"), { adjustedPlayerOneScore: 11363, adjustedPlayerTwoScore: 11363, winner: "playerTwo", eloActualScores: [0, 1] });
  assert.equal(resolveOneVersusOneScores(10346, 11363, "playerOne").winner, "playerOne");
});
test("new client uses secret server bans, class picker, no practice entry and final-only Hardcore multiplier", async () => {
  const page = await readFile(new URL("./page.tsx", import.meta.url), "utf8");
  assert.match(page, /ban_1v1_map/);
  assert.match(page, /MatchSetupPanel/);
  assert.doesNotMatch(page, /startBotPractice|PRACTICE VS BOT|set_1v1_map_priorities|updateAdminTestMode/);
  assert.match(page, /modeRules = GAME_MODE_RULES\[isVersusRun \? "normal" : mode\]/);
  assert.match(page, /characterKey === rngAssignedCharacterRef.current/);
  assert.match(page, /melonBaseScore\(wave\)/);
});
test("music and map effects are layered on the SFX bus with reusable licensed samples", async () => {
  const audio = await readFile(new URL("./audio-engine.ts", import.meta.url), "utf8");
  assert.match(audio, /MUSIC_TEMPO_MULTIPLIER = 1.3/);
  assert.match(audio, /gain.connect\(this.sfxBus\)/);
  for (const sound of ["katanaBlock", "swordHit", "swordMiss", "swordBreak", "lightsaber", "vortex", "currentWind", "highwayTraffic"]) assert.match(audio, new RegExp(sound));
});
