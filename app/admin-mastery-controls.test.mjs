import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const previousTs = require.extensions[".ts"], previousTsx = require.extensions[".tsx"];
const compile = (module, filename) => module._compile(ts.transpileModule(readFileSync(filename, "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX }, fileName: filename,
}).outputText, filename);
let AdminMasteryInventory;
try {
  require.extensions[".ts"] = compile;
  require.extensions[".tsx"] = compile;
  ({ AdminMasteryInventory } = require("./admin-player-editor.tsx"));
} finally {
  if (previousTs) require.extensions[".ts"] = previousTs; else delete require.extensions[".ts"];
  if (previousTsx) require.extensions[".tsx"] = previousTsx; else delete require.extensions[".tsx"];
}
const render = (props = {}) => renderToStaticMarkup(React.createElement(AdminMasteryInventory, {
  masteries: [], ownedCharacters: ["runner_dash"], isMainAdmin: true, busy: false, onCommand: () => {}, ...props,
}));

test("admin mastery inventory displays all implemented masteries with no instant grant side effect", () => {
  const html = render();
  assert.match(html, /^<details/);
  assert.match(html, /MASTERIES/);
  assert.equal((html.match(/GRANT MASTERY/g) ?? []).length, 8);
  assert.equal((html.match(/REVOKE MASTERY/g) ?? []).length, 8);
  // Seven unowned grants and all eight unavailable revokes are disabled.
  assert.equal((html.match(/disabled=""/g) ?? []).length, 15);
  assert.match(html, /Unlock this character before granting its mastery/);
  assert.match(html, /aria-label="Prepare grant Dash mastery command"/);
});

test("lookup shows quest progress, unlocked toggles and distinct revoke controls", () => {
  const html = render({
    masteries: [
      { character_key: "runner_dash", quest: 1, progress: [4], complete: false, mastered: false },
      { character_key: "tank_guard", quest: 3, progress: [100], complete: true, mastered: true, masteryEnabled: false, flairRewriteEnabled: true },
    ], ownedCharacters: ["runner_dash", "tank_guard"],
  });
  assert.match(html, /QUEST 2\/3/);
  assert.match(html, /Dash 10 times without taking a hit · 4\/10/);
  assert.match(html, /Mastery OFF · Flair rewrite ON/);
  assert.match(html, /1\/8/);
  const guard = html.slice(html.indexOf("<strong>Guard</strong>"));
  assert.match(guard, /disabled="">GRANT MASTERY/);
  assert.match(guard, /aria-label="Prepare revoke Guard mastery command">REVOKE MASTERY/);
});

test("co-admin lookup is read-only and in-flight commands disable every mastery action", () => {
  assert.doesNotMatch(render({ isMainAdmin: false }), /GRANT MASTERY|REVOKE MASTERY/);
  assert.equal((render({ busy: true }).match(/disabled=""/g) ?? []).length, 16);
});
