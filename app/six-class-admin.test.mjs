import assert from "node:assert/strict";
import test from "node:test";
import { parseAdminCommand, isOverhaulAdminCommand, formatRankedAdminValue } from "./admin-command-rules.ts";

test("appeal commands have no implicit player and reject extra arguments", () => {
  for (const [text, action] of [["/rejapp", "appeal_reject_all"], ["/accapp", "appeal_accept_all"], ["/numapp", "appeal_count"]]) {
    assert.deepEqual(parseAdminCommand(text), { action });
    assert.equal(isOverhaulAdminCommand(parseAdminCommand(text)), true);
    assert.throws(() => parseAdminCommand(text + " someone"));
  }
});
test("ranked reads resolve one exact account without changing rating", () => {
  assert.deepEqual(parseAdminCommand("/elo [Player With Spaces]"), { action: "ranked_elo", targetText: "Player With Spaces" });
  assert.deepEqual(parseAdminCommand("/ownsr Ted"), { action: "ranked_owned", targetText: "Ted" });
  assert.deepEqual(parseAdminCommand("/numrg", true), { action: "ranked_games", targetText: undefined });
  assert.throws(() => parseAdminCommand("/elo"));
  assert.throws(() => parseAdminCommand("/elo Ted Alice"));
});
test("provisional Elo appears only for games five through twenty", () => {
  for (const n of [0, 4]) assert.equal(formatRankedAdminValue(true, n, 1488), null);
  for (const n of [5, 20]) assert.equal(formatRankedAdminValue(true, n, 1488), "1488P");
  assert.equal(formatRankedAdminValue(true, 21, 1488), "1488");
  assert.equal(formatRankedAdminValue(false, 30, 1488), null);
});
test("Photon weapon actions support exact names but never change Lightsaber", () => {
  assert.deepEqual(parseAdminCommand("/upfw Ted [Photon Blaster]"), { action: "photon_grant", itemKind: "photon_weapon", itemName: "Photon Blaster", targetText: "Ted" });
  assert.equal(parseAdminCommand("/rpfw [Concentrated Laser]", true).targetText, undefined);
  for (const text of ["/upfw Ted Lightsaber", "/rpfw Ted [light saber]", "/upfw Ted [light-saber]", "/upfw Weapon"])
    assert.throws(() => parseAdminCommand(text));
});
test("mastery reset stays a distinct action from revoke", () => {
  assert.deepEqual(parseAdminCommand("/resetmastery Ted Dash"), { action: "mastery_reset", itemKind: "mastery", itemName: "Dash", targetText: "Ted" });
  assert.equal(parseAdminCommand("/revoke mastery [Dash] Ted").action, "revoke");
  assert.throws(() => parseAdminCommand("/resetmastery Ted [Dash"));
});
