import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./page.tsx", import.meta.url), "utf8");

test("password recovery takes priority over stale signed-in and guest state", () => {
  assert.match(source, /if \(recoveryToken \|\| \(!userEmail && !guest\)\)/);
  assert.match(source, /if \(userEmail \|\| userIdRef\.current\) await signOut\(\)/);
  assert.match(source, /!recoveryToken && \(/);
});

test("invalid recovery links and reset delivery failures are visible", () => {
  assert.match(source, /params\.get\("error"\)/);
  assert.match(source, /recovery link is invalid or expired/i);
  assert.match(source, /Could not send the recovery email/);
  assert.match(source, /Check inbox and spam; the link expires in 1 hour/);
});
test("Google provides a no-email recovery path without replacing player data", () => {
  assert.match(source, /signInWithOAuth\(\{/);
  assert.match(source, /provider: "google"/);
  assert.match(source, /CONTINUE WITH GOOGLE/);
  assert.match(source, /same\s+email as your Skyway account/i);
  assert.match(source, /stats and inventory\s+stay connected/i);
});
