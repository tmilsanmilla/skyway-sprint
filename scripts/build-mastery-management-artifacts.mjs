// Package SQL source/read-only verification, never execute against production.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const outputs=resolve(import.meta.dirname,'../../../outputs');
const metadata=JSON.parse(readFileSync(resolve(outputs,'mastery-management-verified-functions-20261019.json'),'utf8'));
assert.equal(metadata.localFixtureVerified,true);assert.equal(metadata.productionApplied,false);
const source=readFileSync(new URL('../neon/update-2-3-mastery-management.sql',import.meta.url),'utf8');
assert.ok(!/update\s+public\.player_stats|insert\s+into\s+app_private\.progression_resets|grant\s+execute/i.test(source));
const quote=s=>`'${s.replaceAll("'","''")}'`;
const values=metadata.functions.map(f=>`(${quote(f.signature)},${quote(f.md5)},${f.authenticated})`);
for(const[signature,md5]of Object.entries(metadata.unchangedControls))values.push(`(${quote(signature)},${quote(md5)},${!signature.startsWith('app_private.')&&!signature.startsWith('public.is_main_admin(')})`);
const readback=`-- Read-only exact function/ACL/column verification; no player rows.\nwith expected(signature,body_md5,authenticated_execute) as(values\n${values.join(',\n')}\n),checks as(select e.*,md5(pg_get_functiondef(to_regprocedure(e.signature))) actual_md5,\n exists(select 1 from pg_proc p where p.oid=to_regprocedure(e.signature) and p.prosecdef and 'search_path=""'=any(p.proconfig)) secure,\n has_function_privilege('authenticated',e.signature,'EXECUTE') actual_authenticated,\n has_function_privilege('anon',e.signature,'EXECUTE') anon,has_function_privilege('anonymous',e.signature,'EXECUTE') anonymous from expected e)\nselect jsonb_build_object(\n 'functions_passed',bool_and(actual_md5=body_md5 and secure and actual_authenticated=authenticated_execute and not anon and not anonymous),\n 'function_mismatches',coalesce(jsonb_agg(jsonb_build_object('signature',signature,'actual_md5',actual_md5,'expected_md5',body_md5,'authenticated',actual_authenticated,'anon',anon,'anonymous',anonymous)) filter(where actual_md5 is distinct from body_md5 or not secure or actual_authenticated is distinct from authenticated_execute or anon or anonymous),'[]'::jsonb),\n 'trial_replay_shape',exists(select 1 from pg_attribute a join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid='app_private.mastery_sessions'::regclass and a.attname='trial_replay' and not a.attisdropped and a.atttypid='boolean'::regtype and a.attnotnull and pg_get_expr(d.adbin,d.adrelid)='false'),\n 'mastery_tables_private',(select bool_and(c.relrowsecurity and not has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') and not has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') and not has_table_privilege('anonymous',c.oid,'SELECT,INSERT,UPDATE,DELETE')) from pg_class c where c.oid in('app_private.mastery_sessions'::regclass,'app_private.player_mastery_quests'::regclass,'app_private.player_mastery_preferences'::regclass))\n) as mastery_management_proof from checks;\n`;
const result={};for(const[name,text]of Object.entries({source,readback})){
 const path=resolve(outputs,`mastery-management-${name}-20261019.sql`);writeFileSync(path,text,{mode:0o600});
 result[name]={path,sha256:createHash('sha256').update(text).digest('hex'),bytes:Buffer.byteLength(text)};
}
console.log(JSON.stringify(result,null,2));
