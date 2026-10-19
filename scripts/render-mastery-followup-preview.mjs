// Local visual QA only: synthetic SSR markup, no server, browser script or account access.
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const previousTs = require.extensions[".ts"], previousTsx = require.extensions[".tsx"];
const compile = (module, filename) => module._compile(ts.transpileModule(readFileSync(filename, "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX }, fileName: filename,
}).outputText, filename);
let ActiveMasteryQuest, MasteryShop, CharacterMastery, AdminMasteryInventory;
try {
  require.extensions[".ts"] = compile;
  require.extensions[".tsx"] = compile;
  ({ ActiveMasteryQuest, MasteryShop, CharacterMastery } = require(resolve(root, "app/mastery-menu.tsx")));
  ({ AdminMasteryInventory } = require(resolve(root, "app/admin-player-editor.tsx")));
} finally {
  if (previousTs) require.extensions[".ts"] = previousTs; else delete require.extensions[".ts"];
  if (previousTsx) require.extensions[".tsx"] = previousTsx; else delete require.extensions[".tsx"];
}

const noop = () => {};
const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));
const dash = { quest: 1, progress: [2], complete: false, mastered: false, masteryEnabled: false, flairRewriteEnabled: false };
const guard = { quest: 3, progress: [100], complete: true, mastered: true, masteryEnabled: false, flairRewriteEnabled: false };
const state = { active: "runner_dash", quests: { runner_dash: dash, tank_guard: guard } };
const liveState = { ...state, quests: { ...state.quests, runner_dash: { ...dash, progress: [5] } } };
const tracked = render(ActiveMasteryQuest, { state, liveState, character: "runner_dash", syncStatus: "pending", onRetry: noop });
const shop = render(MasteryShop, { state, liveState, syncStatus: "pending", photons: 550, ownedCharacters: ["runner_dash", "tank_guard"], onPurchase: noop, onActivate: noop });
const character = render(CharacterMastery, { character: "tank_guard", state, onToggle: noop, onTrial: noop });
const admin = render(AdminMasteryInventory, {
  masteries: [{ ...dash, character_key: "runner_dash", progress: [5] }, { ...guard, character_key: "tank_guard" }],
  ownedCharacters: ["runner_dash", "tank_guard"], isMainAdmin: true, busy: false, onCommand: noop,
});
// Include the existing application styles without Tailwind's build-only import.
// These CSS files have no external asset references; the CSP also blocks requests.
const styles = readFileSync(resolve(root, "app/globals.css"), "utf8").replace(/^@import\s+"tailwindcss";\s*/u, "")
  + "\n" + readFileSync(resolve(root, "app/mastery.css"), "utf8");
assert.doesNotMatch(styles, /@import\b|url\(/i);
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>Mastery follow-up · SYNTHETIC QA ONLY</title><style>${styles}
body{margin:0;background:#eee8da;color:#18293b;font:16px/1.5 Arial,sans-serif}.qa-shell{width:min(1120px,100%);margin:auto;padding:18px}.qa-banner{position:sticky;top:0;z-index:10;padding:10px 14px;border:3px solid #18293b;background:#ffe59a;font-weight:800}.qa-block{margin:22px 0;padding:16px;border:2px solid #687998;background:#fffaf0;border-radius:8px}.qa-block>h2{margin:0 0 10px}.qa-game{height:190px;display:grid;grid-template-columns:repeat(5,1fr);background:#31404f;color:#fff;text-align:center}.qa-game>span{padding-top:80px;border-right:2px dashed #f2e8c4}.qa-game>span:last-child{border:0}.qa-shell button{cursor:default}.qa-shell button:disabled{cursor:not-allowed}.qa-caption{margin:8px 0;color:#59442b}.qa-block .player-inventory-group{color:#18293b}@media(max-width:560px){.qa-shell{padding:9px}.qa-block{padding:9px}.qa-game{height:130px}.qa-game>span{padding-top:45px}}
</style></head><body><main class="qa-shell"><div class="qa-banner">SYNTHETIC VISUAL QA · no real account, database or network connection. Buttons are inert.</div>
<section class="qa-block"><h2>Active quest · live progress waiting to save</h2><p class="qa-caption">Dash quest 2: last saved 2/10; live 5/10. Expand Details to inspect the save label. The quest panel stays above these five illustrative lanes.</p>${tracked}<div class="qa-game" aria-label="Illustrative play area"><span>Lane 1</span><span>Lane 2</span><span>Lane 3</span><span>Lane 4</span><span>Lane 5</span></div></section>
<section class="qa-block"><h2>Quest shop</h2><p class="qa-caption">Only Dash and Guard are owned in this synthetic sample.</p>${shop}</section>
<section class="qa-block"><h2>Mastered Guard · replay trial</h2><p class="qa-caption">Both independent settings start OFF. Replay is practice-only and does not change these settings.</p>${character}</section>
<section class="qa-block"><h2>Admin mastery inventory</h2><p class="qa-caption">Expand MASTERIES. Dash is owned and can be granted a mastery; Guard is already mastered. Real buttons only prepare an audited command and require RUN.</p>${admin}</section>
</main></body></html>`;
assert.match(html, /SYNTHETIC VISUAL QA/);
assert.doesNotMatch(html, /<script\b|\bhttps?:\/\//i);
const output = resolve(root, "outputs/mastery-followup-preview.html");
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, html, { mode: 0o600 });
console.log(JSON.stringify({ output, synthetic: true, network: false, components: ["ActiveMasteryQuest", "MasteryShop", "CharacterMastery", "AdminMasteryInventory"] }));
