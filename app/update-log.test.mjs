import assert from "node:assert/strict";
import test from "node:test";

import { UPDATE_LOG, validateUpdateLog } from "./update-log.ts";

test("update log launches with a newest-first release archive", () => {
  assert.deepEqual(validateUpdateLog(), []);
  assert.ok(UPDATE_LOG.length >= 10);
  assert.match(UPDATE_LOG[0].title, /character/i);
  assert.ok(
    UPDATE_LOG[0].changes.some((change) => /Scribe.*Epic/i.test(change)),
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
