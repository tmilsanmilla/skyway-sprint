import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page=readFileSync(new URL("./page.tsx",import.meta.url),"utf8");
const css=readFileSync(new URL("./globals.css",import.meta.url),"utf8");
const sql=readFileSync(new URL("../neon/remove-inventory-flairs.sql",import.meta.url),"utf8");
test("Inventory flairs, equipment state, sprites, and bonuses are removed",()=>{
  assert.doesNotMatch(page,/WeaponInventory|selectedWeapon|activeWeapon|weapon_key|hasWeaponEffect|set_player_weapon|weapon:|WEAPONS \/ FLAIRS/);
  assert.doesNotMatch(css,/character-weapon|weapon-showcase|weapon-roster|active-weapon-readout|weapon-symbol|weapon-color/);
});
test("all 80 characters, their active skills, and map weapons remain",()=>{
  assert.equal([...page.matchAll(/key: "(?:runner|medic|tank|trickster|misc)_[^"]+",\s*name:/g)].length,80);
  assert.match(page,/hasCharacterAbility\("medic_lifeline"\)/);
  assert.match(page,/hasCharacterAbility\("trickster_hex"\)/);
  assert.match(page,/throwHexChakram/);
  assert.match(page,/terminalSwordRef/);
  assert.match(page,/renderedKatanaState/);
  const photon=readFileSync(new URL("./photon-fury.tsx",import.meta.url),"utf8");
  assert.match(photon,/LIGHTSABER/);
});
test("flair-only stat and health extras do not survive without equipment",()=>{
  assert.doesNotMatch(page,/RELAY ROD · \+10 SCORE|HALO STAFF · \+1 HP|WORLD MAUL · DAMAGE HALVED|FATE SENSOR · (?:FIRST|SECOND)|PHOENIX FEATHER · FIRST OBSTACLE/);
});
test("server rewards have no flair factor and account data is not purged",()=>{
  assert.doesNotMatch(sql,/delete from|truncate|drop table|drop column|update public\.player_(?:stats|unlocks)/i);
  assert.doesNotMatch(sql,/v_weapon_bonus|v_multiplier \* \(1 \+/);
  assert.match(sql,/select 0::numeric/);
  assert.match(sql,/public\.set_player_weapon\(text\) from public,anon,anonymous,authenticated/);
  assert.match(sql,/when 'runner_ace' then 1\.10/);
  assert.match(sql,/when 'runner_pacer'.*then 5 else 1/);
  assert.match(sql,/v:=v\*\(1\+gems\*\.01\)/);
});
