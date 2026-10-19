import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTIVE_VERSUS_SESSION_STORAGE_KEY,
  isResumableVersusMatchStatus,
  isTerminalVersusMatchStatus,
  parseActiveVersusSessionStorageValue,
  serializeActiveVersusSession,
  shouldAnnounceHydratedVersusWave,
  shouldBlockNonVersusStart,
  shouldNotifyServerBeforeVersusExit,
  reconcileVersusProgress,
} from "./versus-session-rules.ts";

const MATCH_ID = "7a6f803f-8124-4ddd-8d90-a59fda1bd3b5";
const STORED_SESSION = { matchId: MATCH_ID, status: "playing" };

test("a failed score heartbeat followed by an older snapshot cannot wrap score to zero", () => {
  for (const localScore of [199, 201, 400, 2_000_000]) {
    assert.deepEqual(reconcileVersusProgress({ preserveRunState: true,
      localScore, localWave: 3, savedScore: 0, savedWave: 2 }),
    { score: localScore, wave: 3 });
  }
  assert.deepEqual(reconcileVersusProgress({ preserveRunState: false,
    localScore: 1000, localWave: 10, savedScore: 300, savedWave: 3 }),
  { score: 300, wave: 3 });
  assert.deepEqual(reconcileVersusProgress({ preserveRunState: true,
    localScore: 1000, localWave: 10, savedScore: 1200, savedWave: 11 }),
  { score: 1200, wave: 11 });
});

test("persists only resumable tab-scoped 1v1 sessions", () => {
  assert.equal(
    ACTIVE_VERSUS_SESSION_STORAGE_KEY,
    "skyway-sprint:active-1v1-session:v1",
  );
  const serialized = serializeActiveVersusSession(STORED_SESSION);
  assert.deepEqual(parseActiveVersusSessionStorageValue(serialized), STORED_SESSION);
  assert.equal(
    serializeActiveVersusSession({ matchId: MATCH_ID, status: "finished" }),
    null,
  );
  assert.equal(parseActiveVersusSessionStorageValue("not-json"), null);
});

test("classifies every resumable and terminal server status", () => {
  for (const status of ["countdown", "playing", "intermission"])
    assert.equal(isResumableVersusMatchStatus(status), true);
  for (const status of ["finished", "cancelled"])
    assert.equal(isTerminalVersusMatchStatus(status), true);
  assert.equal(isResumableVersusMatchStatus("eliminated"), false);
  assert.equal(isTerminalVersusMatchStatus("playing"), false);
});

test("a storage-only restored match still requires a server leave", () => {
  assert.equal(
    shouldNotifyServerBeforeVersusExit(true, {
      activeMatchId: null,
      searching: false,
      storedSession: STORED_SESSION,
    }),
    true,
  );
  assert.equal(
    shouldNotifyServerBeforeVersusExit(false, {
      storedSession: STORED_SESSION,
    }),
    false,
  );
});

test("Endless and Practice remain blocked throughout restoration", () => {
  assert.equal(
    shouldBlockNonVersusStart({ storedSession: STORED_SESSION }),
    true,
  );
  assert.equal(
    shouldBlockNonVersusStart({ storedSession: null, reconnecting: true }),
    true,
  );
  assert.equal(
    shouldBlockNonVersusStart({ storedSession: null, reconnecting: false }),
    false,
  );
});

test("background hydration announces only a newly authoritative wave", () => {
  assert.equal(
    shouldAnnounceHydratedVersusWave({
      preserveRunState: true,
      previousWave: 8,
      restoredWave: 8,
    }),
    false,
  );
  assert.equal(
    shouldAnnounceHydratedVersusWave({
      preserveRunState: true,
      previousWave: 8,
      restoredWave: 9,
    }),
    true,
  );
});

test("initial hydration still announces the restored wave", () => {
  assert.equal(
    shouldAnnounceHydratedVersusWave({
      preserveRunState: false,
      previousWave: 1,
      restoredWave: 1,
    }),
    true,
  );
});
