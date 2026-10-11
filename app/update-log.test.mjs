import assert from "node:assert/strict";
import test from "node:test";

import {
  UPDATE_LOG,
  LATEST_UPDATE_VERSION,
  VISIBLE_UPDATE_LIMIT,
  getRecentUpdates,
  validateUpdateLog,
} from "./update-log.ts";

test("update log launches with a newest-first release archive", () => {
  assert.deepEqual(validateUpdateLog(), []);
  assert.ok(UPDATE_LOG.length >= 10);
  assert.ok(UPDATE_LOG.some((entry) => /account recovery/i.test(entry.title)));
  assert.ok(
    UPDATE_LOG.some((entry) => entry.changes.some((change) => /Continue with Google/i.test(change))),
  );
  assert.ok(
    UPDATE_LOG.some((entry) =>
      entry.changes.some((change) => /Scribe.*Epic/i.test(change)),
    ),
  );
});

test("every update has a unique timestamped player summary", () => {
  assert.equal(new Set(UPDATE_LOG.map(({ id }) => id)).size, UPDATE_LOG.length);
  for (const entry of UPDATE_LOG) {
    assert.ok(Number.isFinite(Date.parse(entry.publishedAt)));
    assert.ok(entry.title.length >= 4);
    assert.ok(entry.changes.every((change) => change.endsWith(".")));
  }
});

test("players see only the latest ten updates while the source archive is kept", () => {
  const recent = getRecentUpdates();
  assert.equal(VISIBLE_UPDATE_LIMIT, 10);
  assert.equal(recent.length, 10);
  assert.ok(UPDATE_LOG.length > recent.length);
  assert.deepEqual(recent.map(({ id }) => id), UPDATE_LOG.slice(0, 10).map(({ id }) => id));
  assert.equal(getRecentUpdates([]).length, 0);
  assert.equal(getRecentUpdates(UPDATE_LOG.slice(0, 3)).length, 3);
});

test("release numbers begin at 2.0 then 1.9, not the archive count or 27", () => {
  assert.equal(LATEST_UPDATE_VERSION, "2.0");
  assert.equal(getRecentUpdates()[1].id, "2026-10-10-character-switching");
  assert.deepEqual(getRecentUpdates().map(({ version }) => version), [
    "2.0", "1.9", "1.8", "1.7", "1.6", "1.5", "1.4", "1.3", "1.2", "1.1",
  ]);
  assert.ok(getRecentUpdates().every(({ title }) => !/^UPDATE \d+:/.test(title)));
});
