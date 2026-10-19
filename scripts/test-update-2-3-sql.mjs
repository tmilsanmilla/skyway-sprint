// One disposable Unix-socket-only PostgreSQL cluster per fixture. No remote
// credentials, real account rows, outbound mail, or production writes are used.
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const root = realpathSync(resolve(import.meta.dirname, '..'));
const snapshot = resolve(process.argv[2] ?? join(root, '../../outputs/update-2-3-live-audit-20261019.json'));
const bin = process.env.MASTERY_TEST_PG_BIN ?? '/opt/homebrew/opt/postgresql@17/bin';
const env = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith('PG') || key.includes('DATABASE_URL')) delete env[key];
const run = (command, args, extraEnv = {}) => {
  const p = spawnSync(command, args, { cwd: root, encoding: 'utf8', env: { ...env, ...extraEnv }, maxBuffer: 8 * 1024 * 1024 });
  if (p.status !== 0) throw new Error(`${command} failed: ${p.stderr || p.stdout || p.error}`);
  if (p.stdout) process.stdout.write(p.stdout);
};
run(process.execPath, ['scripts/build-update-2-3-release.mjs']);
run(process.execPath, ['scripts/build-update-2-3-profile-release.mjs']);
run(process.execPath, ['scripts/build-update-2-3-profile-acl-audit.mjs']);
run(process.execPath, ['scripts/build-update-2-3-profile-readback-current.mjs']);
for (const fixture of [
  { prefix: 'skyway-admin-23.', database: 'admin_fixture', port: 55443,
    scripts: ['neon/update-2-3-admin.test.mjs', 'neon/update-2-3-duel-access.test.mjs'] },
  { prefix: 'skyway-map-sql.', database: 'economy_update_23', port: 55444,
    scripts: ['scripts/test-update-2-3-economy-sql.mjs'] },
  { prefix: 'skyway-profile-23.', database: 'profile_update_23', port: 55445,
    scripts: ['scripts/test-update-2-3-profile-sql.mjs'] },
]) {
  const dir = mkdtempSync(join('/private/tmp', fixture.prefix));
  const socket = realpathSync(dir), data = join(dir, 'data');
  assert.ok(socket.startsWith('/private/tmp/'));
  let started = false;
  try {
    run(join(bin, 'initdb'), ['-D', data, '-A', 'trust', '--no-locale', '-E', 'UTF8']);
    run(join(bin, 'pg_ctl'), ['-D', data, '-l', join(dir, 'postgres.log'), '-o', `-k ${socket} -h '' -p ${fixture.port}`, '-w', 'start']);
    started = true;
    run(join(bin, 'createdb'), ['-h', socket, '-p', String(fixture.port), fixture.database]);
    for (const script of fixture.scripts) {
      const args = /economy-sql|profile-sql/.test(script) ? [script, socket, String(fixture.port), snapshot] : [script];
      run(process.execPath, args, { ADMIN_TEST_PG_SOCKET: socket, ADMIN_TEST_PG_DATABASE: fixture.database, ADMIN_TEST_INSTALLED_SNAPSHOT: snapshot });
    }
  } finally {
    if (started) run(join(bin, 'pg_ctl'), ['-D', data, '-m', 'fast', '-w', 'stop']);
    rmSync(dir, { recursive: true, force: true });
  }
}
