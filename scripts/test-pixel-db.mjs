import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
const cli=process.env.NEON_CLI_PATH;
const connectionString = process.env.SKYWAY_TEST_DATABASE_URL || execFileSync(cli?process.execPath:'neon', [...(cli?[cli]:[]),'connection-string','br-holy-math-axs9gjmb','--project-id','odd-unit-44587143','--database-name','neondb','--pooled'], {encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const pool = new Pool({connectionString,max:1,connectionTimeoutMillis:10000});
const client = await pool.connect();
const fingerprint = `select md5(coalesce(string_agg(to_jsonb(s)::text,'|' order by user_id),'empty')) as fingerprint from public.player_stats s`;
try {
  const branch = (await client.query("select current_setting('neon.branch_id',true) as branch")).rows[0].branch;
  if(branch!=='br-holy-math-axs9gjmb')throw new Error('Wrong Skyway database branch');
  const before = (await client.query(fingerprint)).rows[0].fingerprint;
  await client.query('begin');
  for (const filename of ['pixel-pulse-01-sessions.sql','pixel-pulse-02-link.sql']) {
    const sql = readFileSync(new URL('../neon/'+filename,import.meta.url),'utf8').replace(/^begin;$/m,'').replace(/^commit;$/m,'');
    await client.query(sql);
  }
  const results = await client.query(readFileSync(new URL('../neon/pixel-pulse.test.sql',import.meta.url),'utf8'));
  await client.query('rollback');
  const after = (await client.query(fingerprint)).rows[0].fingerprint;
  if(before!==after)throw new Error('Player data changed during rollback-only test');
  console.log(JSON.stringify({passed:true,rolledBack:true,playerDataUnchanged:true,checks:results.at(-1)?.rows||results.rows}));
} catch(error) {
  await client.query('rollback');console.error(error.message);process.exitCode=1;
} finally {client.release();await pool.end();}
