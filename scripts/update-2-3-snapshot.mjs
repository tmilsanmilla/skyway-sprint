// Normalize the read-only Neon editor export for disposable local SQL fixtures.
// This reads function/schema metadata only; it never connects to a database.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

export function readUpdateSnapshot(path) {
  const value = JSON.parse(readFileSync(path, 'utf8'));
  const wrapped = Array.isArray(value) ? value[0]?.audit : value;
  const data = typeof wrapped === 'string' ? JSON.parse(wrapped) : wrapped;
  assert.ok(data && Array.isArray(data.functions) && Array.isArray(data.columns));
  if (data.project) {
    assert.equal(data.project, 'odd-unit-44587143');
    assert.equal(data.branch, 'br-holy-math-axs9gjmb');
    assert.equal(data.database, 'neondb');
    assert.ok(data.captured_at, 'A dated read-only metadata export is required');
  } else {
    assert.equal(data.readOnly, true, 'Only a read-only metadata export is accepted');
  }
  return {
    ...data,
    readOnly: true,
    functions: data.functions.map(fn => ({
      ...fn,
      qualified_signature: fn.signature.startsWith(`${fn.schema}.`)
        ? fn.signature : `${fn.schema}.${fn.signature}`,
      signature: fn.signature.replace(new RegExp(`^${fn.schema}\\.`), ''),
    })),
    constraints: data.constraints.map(c => ({ ...c, conname: c.conname ?? c.name })),
  };
}
