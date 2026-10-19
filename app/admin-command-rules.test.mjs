import assert from "node:assert/strict";
import test from "node:test";
import { parseAdminCommand, isV23AdminCommand, BASE_ADMIN_COMMANDS, ADMIN_BALANCE_LIMIT, ADMIN_BAN_MINUTES_LIMIT } from "./admin-command-rules.ts";

test("set/check currencies retain existing value-before-account grammar", () => {
  for (const stat of ["gems", "photons", "stardust"]) {
    assert.deepEqual(parseAdminCommand(`/set ${stat} 123 [Player Name]`), { action: "set", statKey: stat, value: 123, targetText: "Player Name" });
    assert.deepEqual(parseAdminCommand(`/check ${stat} player@example.com`), { action: "check", statKey: stat, targetText: "player@example.com" });
  }
  assert.equal(parseAdminCommand("/set high score 123").statKey, "high_score");
  assert.equal(parseAdminCommand(`/set photons ${ADMIN_BALANCE_LIMIT}`).value, ADMIN_BALANCE_LIMIT);
  for (const amount of ["-1", "1.5", "Infinity", "NaN", "1e3", String(ADMIN_BALANCE_LIMIT + 1), "9007199254740993"])
    assert.throws(() => parseAdminCommand(`/set photons ${amount} name`));
});

test("ban is account-only whole integer minutes; zero means permanent", () => {
  assert.deepEqual(parseAdminCommand("/ban [Player Name] 1440"), { action: "ban", targetText: "Player Name", banScopes: ["account"], durationSeconds: 86400, permanent: false });
  assert.equal(parseAdminCommand("/ban name 0").permanent, true);
  assert.equal(parseAdminCommand("/ban 1", true).durationSeconds, 60);
  assert.equal(parseAdminCommand(`/ban name ${ADMIN_BAN_MINUTES_LIMIT}`).durationSeconds, ADMIN_BAN_MINUTES_LIMIT * 60);
  for (const command of ["/bann name 1", "/ban name -1", "/ban name 1.2", "/ban name 1 hour", `/ban name ${ADMIN_BAN_MINUTES_LIMIT + 1}`]) assert.throws(() => parseAdminCommand(command));
  assert.equal(parseAdminCommand("/unban [Player Name]").targetText, "Player Name");
});

test("report allow/ban are target commands and clear has no accidental default target", () => {
  assert.deepEqual(parseAdminCommand("/rpta [Player Name]"), { action: "rpta", targetText: "Player Name" });
  assert.deepEqual(parseAdminCommand("/rptb name"), { action: "rptb", targetText: "name" });
  assert.deepEqual(parseAdminCommand("/rptc"), { action: "rptc" });
  assert.throws(() => parseAdminCommand("/rptc name"));
});

test("Photon character/skin/theme commands accept exact bracketed names and selected-target defaults", () => {
  assert.deepEqual(parseAdminCommand("/upfch [Player Name] [Burner]"), { action: "photon_grant", targetText: "Player Name", itemKind: "photon_character", itemName: "Burner", characterName: undefined });
  assert.equal(parseAdminCommand("/lpfch [Burner]", true).action, "photon_revoke");
  for (const tier of ["intermediate", "pro", "ascendant", "divine", "immortal"]) {
    const parsed = parseAdminCommand(`/upfski name [Burner] ${tier}`);
    assert.equal(parsed.itemName, tier);
    assert.equal(parsed.characterName, "Burner");
    assert.equal(parsed.itemKind, "photon_skin");
  }
  assert.equal(parseAdminCommand("/lpfth [Player Name] [Cobalt Circuit]").itemName, "Cobalt Circuit");
  for (const command of ["/upfch Burner", "/upfski name Burner default", "/lpfski name Burner uncommon", "/upfth name [Bad [Nested]]"])
    assert.throws(() => parseAdminCommand(command));
});

test("legacy item syntax survives and no command grants match coins", () => {
  assert.deepEqual(parseAdminCommand("/revoke cosmetic [Dark Caves] from Player"), { action: "revoke", itemKind: "cosmetic", itemName: "Dark Caves", targetText: "Player" });
  for (const stat of ["coins", "attack coins", "obstacle_points", "versus points", "melons"])
    assert.throws(() => parseAdminCommand(`/set ${stat} 100 name`));
  assert.equal(BASE_ADMIN_COMMANDS.some((line) => /\/bann\b/.test(line)), false);
  assert.equal(isV23AdminCommand(parseAdminCommand("/check photons name")), true);
  assert.equal(isV23AdminCommand(parseAdminCommand("/set gems 1 name")), false);
  assert.equal(isV23AdminCommand(parseAdminCommand("/set photons 1 name")), true);
});
