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

test("players can read the complete archive without a ten-entry cap", () => {
  assert.equal(VISIBLE_UPDATE_LIMIT, Infinity);
  assert.deepEqual(getRecentUpdates().map(e=>e.id), UPDATE_LOG.map(e=>e.id));
  assert.equal(getRecentUpdates([]).length,0);
  assert.equal(getRecentUpdates(UPDATE_LOG.slice(0,3)).length,3);
});
test("integer release numbers cover the entire archive newest first",()=>{
  assert.equal(LATEST_UPDATE_VERSION,String(UPDATE_LOG.length));
  assert.equal(getRecentUpdates()[0].id,'2026-11-25-road-and-inventory');
  assert.deepEqual(getRecentUpdates().map(e=>e.version),UPDATE_LOG.map((_,i)=>String(UPDATE_LOG.length-i)));
});
