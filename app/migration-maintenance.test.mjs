import assert from "node:assert/strict";
import test from "node:test";

import { resolveMigrationMaintenanceMode } from "./migration-maintenance.ts";

test("migration maintenance accepts explicit enabled values", () => {
  for (const value of ["1", "true", "TRUE", " yes ", "on"])
    assert.equal(resolveMigrationMaintenanceMode(value), true);
});

test("migration maintenance stays off for missing or unexpected values", () => {
  for (const value of [undefined, "", "0", "false", "off", "maintenance"])
    assert.equal(resolveMigrationMaintenanceMode(value), false);
});
