import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the shared in-game ability popup can be minimized without hiding its restore control", async () => {
  const source = await readFile(new URL("./page.tsx", import.meta.url), "utf8");
  const styles = await readFile(
    new URL("./globals.css", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /\[abilitySidePanelCollapsed, setAbilitySidePanelCollapsed\]/,
  );
  assert.match(
    source,
    /className={`ability-side-panel \$\{abilitySidePanelCollapsed \? "minimized" : ""\}`}/,
  );
  assert.match(source, /aria-label=\{[\s\S]*?"Expand ability status"[\s\S]*?"Minimize ability status"/);
  assert.match(source, /\{!abilitySidePanelCollapsed && \([\s\S]*?id="ability-side-panel-body"/);
  assert.match(styles, /\.ability-side-panel\.minimized\{[^}]*overflow:hidden/);
});
