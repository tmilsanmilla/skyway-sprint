import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as commandRules from "./admin-command-rules.ts";
import * as masteryRules from "./mastery-rules.ts";

// Deterministic component/hook fixture, not an authenticated browser test.
function fixture(rpc) {
  const cells = [], timers = new Map();
  let index = 0, pending = [], writes = 0, nextTimer = 1;
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const effect = (callback, deps, layout) => {
    const slot = index++, old = cells[slot];
    if (old && same(old.deps, deps)) return;
    cells[slot] = { deps, effect: true, layout };
    pending.push(() => { old?.cleanup?.(); cells[slot].cleanup = callback(); });
  };
  const react = {
    useState(initial) {
      const slot = index++;
      if (!(slot in cells)) cells[slot] = typeof initial === "function" ? initial() : initial;
      return [cells[slot], (value) => { writes++; cells[slot] = typeof value === "function" ? value(cells[slot]) : value; }];
    },
    useRef(initial) { const slot = index++; return cells[slot] ??= { current: initial }; },
    useCallback(callback, deps) {
      const slot = index++, old = cells[slot];
      if (old && same(old.deps, deps)) return old.callback;
      cells[slot] = { callback, deps }; return callback;
    },
    useMemo(callback, deps) {
      const slot = index++, old = cells[slot];
      if (old && same(old.deps, deps)) return old.value;
      const value = callback(); cells[slot] = { value, deps }; return value;
    },
    useLayoutEffect(callback, deps) { effect(callback, deps, true); },
    useEffect(callback, deps) { effect(callback, deps, false); },
  };
  const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
  const modules = {
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
    "./admin-command-rules": commandRules,
    "./mastery-rules": masteryRules,
    "./photon-fury-rules": { PHOTON_CHARACTERS: {} },
    "./photon-collection-rules": { PHOTON_THEMES: [] },
  };
  const compiled = ts.transpileModule(readFileSync(new URL("./admin-player-editor.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, require(name) { if (name in modules) return modules[name]; throw new Error(`Unexpected module: ${name}`); },
    Promise, Error, Number, Math, Date,
    window: {
      setTimeout(callback) { const id = nextTimer++; timers.set(id, callback); return id; },
      clearTimeout(id) { timers.delete(id); },
    },
  });
  return {
    render() {
      index = 0; pending = [];
      const tree = exports.AdminPlayerEditor({ supabase: { rpc }, isMainAdmin: true, isActive: true });
      for (const callback of pending) callback();
      return tree;
    },
    unmount() {
      // React layout cleanups happen during unmount, before passive effects.
      for (const layout of [true, false])
        for (const cell of cells) if (cell?.effect && cell.layout === layout) cell.cleanup?.();
    },
    timers,
    get writes() { return writes; },
  };
}

const deferred = () => { let resolve; const promise = new Promise((yes) => { resolve = yes; }); return { promise, resolve }; };
const tick = () => new Promise((resolve) => setImmediate(resolve));
const target = { user_id: "synthetic-target", username: "Target", email: "target@example.invalid" };
const find = (tree, predicate) => {
  if (!tree || typeof tree !== "object") return undefined;
  if (predicate(tree)) return tree;
  for (const child of [tree.props?.children].flat(Infinity)) { const result = find(child, predicate); if (result) return result; }
  return undefined;
};
function prepareCommand(f, command) {
  let tree = f.render();
  find(tree, (element) => element.type === "input" && element.props["aria-label"] === "Admin player command")
    .props.onChange({ target: { value: command } });
  tree = f.render();
  // Find the command form by its labelled input rather than a hook position.
  const commandForm = find(tree, (element) => element.type === "form" && Boolean(
    find({ props: { children: element.props.children } }, (node) => node.type === "input" && node.props["aria-label"] === "Admin player command"),
  ));
  assert.ok(commandForm);
  return commandForm.props.onSubmit({ preventDefault() {} });
}
const validDetails = { account: { email: target.email }, profile: { username: target.username }, unlocks: [], devices: [], masteries: [] };

test("unmount/account switch aborts mastery dispatch after pending target resolution", async () => {
  const held = deferred(), calls = [];
  const f = fixture(async (name, args) => {
    calls.push({ name, args });
    if (name === "admin_player_search") return held.promise;
    throw new Error(`Unexpected call after retired account: ${name}`);
  });
  const command = prepareCommand(f, "/grant mastery [Dash] Target");
  assert.equal(calls[0].name, "admin_player_search");
  f.unmount(); const writes = f.writes;
  held.resolve({ data: [target], error: null }); await command;
  assert.deepEqual(calls.map((call) => call.name), ["admin_player_search"]);
  assert.equal(f.writes, writes);
  assert.equal(f.timers.size, 0);
});

test("unmount/account switch aborts legacy dispatch after pending item resolution", async () => {
  const held = deferred(), calls = [];
  const f = fixture(async (name, args) => {
    calls.push({ name, args });
    if (name === "admin_player_search") return { data: [target], error: null };
    if (name === "admin_command_suggestions") return held.promise;
    throw new Error(`Unexpected call after retired account: ${name}`);
  });
  const command = prepareCommand(f, "/grant cosmetic [Dark Caves] Target");
  await tick();
  assert.equal(calls.at(-1).name, "admin_command_suggestions");
  f.unmount(); const writes = f.writes;
  held.resolve({ data: { items: [{ item_key: "dark_caves", display_name: "Dark Caves", command_kind: "cosmetic" }] }, error: null });
  await command;
  assert.deepEqual(calls.map((call) => call.name), ["admin_player_search", "admin_command_suggestions"]);
  assert.equal(f.writes, writes);
});

test("already-issued command completion cannot reopen lookup after unmount", async () => {
  const held = deferred(), calls = [];
  const f = fixture(async (name, args) => {
    calls.push({ name, args });
    if (name === "admin_player_search") return { data: [target], error: null };
    if (name === "admin_player_command_v23") return held.promise;
    throw new Error(`Unexpected refresh after retired account: ${name}`);
  });
  const command = prepareCommand(f, "/grant mastery [Dash] Target"); await tick();
  assert.equal(calls.at(-1).name, "admin_player_command_v23");
  f.unmount(); const writes = f.writes;
  held.resolve({ data: { ok: true }, error: null }); await command;
  assert.equal(calls.length, 2);
  assert.equal(f.writes, writes);
});

test("mounted positive control dispatches exactly one mastery command then refreshes own lookup", async () => {
  const calls = [];
  const f = fixture(async (name, args) => {
    calls.push({ name, args });
    if (name === "admin_player_search") return { data: [target], error: null };
    if (name === "admin_player_command_v23") return { data: { ok: true }, error: null };
    if (name === "admin_get_player") return { data: validDetails, error: null };
    if (name === "admin_get_player_record") return { data: { bans: [], commands: [] }, error: null };
    throw new Error(name);
  });
  await prepareCommand(f, "/grant mastery [Dash] Target");
  const commands = calls.filter((call) => call.name === "admin_player_command_v23");
  assert.equal(commands.length, 1);
  assert.equal(commands[0].args.p_item_key, "runner_dash");
  assert.equal(commands[0].args.p_target_user_id, target.user_id);
  assert.deepEqual(calls.slice(-2).map((call) => call.name), ["admin_get_player", "admin_get_player_record"]);
  f.unmount();
});
