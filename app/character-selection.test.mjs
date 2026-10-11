import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./page.tsx", import.meta.url), "utf8");

test("Endless and server-confirmed 1v1 characters have separate state", () => {
  assert.match(source, /const scopedCharacter = isVersusRun \? versusCharacter : selectedCharacter/);
  const hydration = source.slice(source.indexOf("const hydrateVersusState ="), source.indexOf("const submitMatchChoice ="));
  assert.match(hydration, /setVersusCharacter\(characterKey\)/);
  assert.doesNotMatch(hydration, /setSelectedCharacter\(/);
  assert.match(source, /selfCharacter=\{getCharacterDefinition\(versusCharacter\)\.name\}/);
  assert.match(source, /selected=\{versusCharacter\}/);
  const collection = source.slice(source.indexOf("const loadCollection ="), source.indexOf("const extract ="));
  assert.match(collection, /setSelectedCharacter\(safeLoadout.characterKey\)/);
  assert.doesNotMatch(collection, /setVersusCharacter\(/);
});

test("equipping saves character and class in one request and rejects stale account responses", () => {
  const equip = source.slice(source.indexOf("const equipInventoryCharacter ="), source.indexOf("const equipCosmetic ="));
  assert.equal((equip.match(/supabase\.rpc\("set_loadout"/g) ?? []).length, 1);
  assert.match(equip, /p_slot: "character"/);
  assert.doesNotMatch(equip, /p_slot: "class"/);
  assert.match(equip, /if \(characterEquipBusy\) return/);
  assert.match(equip, /if \(userIdRef.current !== equipUserId\) return/);
  assert.match(equip, /finally \{\s*setCharacterEquipBusy\(false\)/);
  assert.match(equip, /setRunCharacterOverride\(null\)/);
});

test("temporary character forms are cleared on home and fresh match hydration", () => {
  const menu = source.slice(source.indexOf("const resetGameToMenu ="), source.indexOf("const settleBrokerAtRunEnd ="));
  assert.match(menu, /setRunCharacterOverride\(null\)/);
  assert.match(source, /if \(!preserveRunState\) setRunCharacterOverride\(null\)/);
});

test("loadout repair grants only the audited own-account endpoint", async () => {
  const sql = await readFile(new URL("../neon/character-selection-access.sql", import.meta.url), "utf8");
  assert.match(sql, /Own-account loadout guard failed verification/);
  assert.match(sql, /Character is not unlocked/);
  assert.match(sql, /where user_id=v_uid/);
  assert.match(sql, /revoke all on function public\.set_loadout\(text,text\) from public,anon,anonymous/);
  assert.match(sql, /grant execute on function public\.set_loadout\(text,text\) to authenticated/);
  assert.match(sql, /Own-match leave guard failed verification/);
  assert.match(sql, /revoke all on function public\.leave_1v1\(\) from public,anon,anonymous/);
  assert.match(sql, /grant execute on function public\.leave_1v1\(\) to authenticated/);
  assert.doesNotMatch(sql, /grant .*on all|grant .*on table|grant .*app_private/i);
  assert.doesNotMatch(sql, /\b(?:insert into|update|delete from)\s+(?:public\.)?player_/i);
});

test("leaving a duel is visible and cannot restart matchmaking or clear a different account", () => {
  const leave = source.slice(source.indexOf("const leaveVersusSession ="), source.indexOf("const cancelVersus ="));
  assert.match(leave, /if \(versusLeavingRef.current\) return false/);
  assert.match(leave, /userIdRef.current !== leavingUserId/);
  assert.doesNotMatch(leave, /findVersusMatch\(/);
  assert.match(leave, /versusSearchingRef.current = true/);
  assert.match(source, /LEAVE 1V1 · FORFEIT/);
  assert.match(source, /busy=\{characterPickBusy \|\| versusLeaving\}/);
  assert.match(source, /onLeave=\{backToMenu\}/);
});
