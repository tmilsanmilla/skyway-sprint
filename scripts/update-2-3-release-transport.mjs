// One-statement Neon SQL editor transport. The decoded migration remains ONE
// atomic transaction: no BEGIN/COMMIT is executed inside the outer DO block.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function makeUpdate23Transport(sql) {
  assert.equal([...sql.matchAll(/^begin;\s*$/gm)].length, 1);
  assert.equal([...sql.matchAll(/^commit;\s*$/gm)].length, 1);
  const body = sql.replace(/^begin;\s*$/m, '').replace(/^commit;\s*$/m, '');
  const encoded = Buffer.from(body, 'utf8').toString('base64');
  assert.match(encoded, /^[A-Za-z0-9+/=]+$/);
  return `-- Update 2.3: SINGLE atomic statement, aggregate proof only.\n-- On ANY error this entire statement rolls back. No partial commit exists.\ndo $update23_transport$\ndeclare proof jsonb;\nbegin\n execute convert_from(decode('${encoded}','base64'),'UTF8') into proof;\n if (proof->>'protected_data_preserved')::boolean is not true or (proof->>'accounts_preserved')::boolean is not true or proof->>'update' is distinct from '2.3' then raise exception 'Update 2.3 preservation proof missing; entire statement rolled back';end if;\n raise notice 'UPDATE_2_3_PROTECTED: %',proof;\nend $update23_transport$;\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outputs = resolve(import.meta.dirname, '../../../outputs');
  const input = resolve(process.argv[2] ?? resolve(outputs, 'update-2-3-release-20261019.sql'));
  const target = resolve(process.argv[3] ?? resolve(outputs, 'update-2-3-release-transport-20261019.sql'));
  assert.ok(input.startsWith(outputs + '/') && target.startsWith(outputs + '/'));
  const source = readFileSync(input, 'utf8');
  const transport = makeUpdate23Transport(source);
  writeFileSync(target, transport, { mode: 0o600 });
  console.log(JSON.stringify({ path: target, bytes: Buffer.byteLength(transport), sha256: createHash('sha256').update(transport).digest('hex'), source_sha256: createHash('sha256').update(source).digest('hex') }, null, 2));
}
