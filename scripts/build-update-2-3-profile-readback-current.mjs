// Preserve the original read-scope expectations visibly, but distinguish them
// from the actual own-row security boundary. No migration or grants occur.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const outputs=resolve(import.meta.dirname,'../../../outputs');
const original=readFileSync(resolve(outputs,'update-2-3-profile-readback-20261019.sql'),'utf8');
assert.ok(original.trim().endsWith("where p.oid='public.set_player_username(text)'::regprocedure;"));
const sql=`-- READ ONLY: original expectations remain visible, not silently relabeled.\n-- Existing own-row table SELECT is allowed by the approved row-isolation scope.\n-- Historical grant timing cannot be inferred from current PostgreSQL ACLs.\nwith original as(\n${original.trim().replace(/;$/,'')}\n)\nselect jsonb_build_object(\n 'verified_security_checks',(profile_access_proof-'no_whole_table_select'-'created_at_not_exposed')||jsonb_build_object(\n  'authenticated_is_rls_subject',exists(select 1 from pg_roles r join pg_class c on c.oid='public.player_profiles'::regclass where r.rolname='authenticated' and not r.rolsuper and not r.rolbypassrls and not pg_has_role(r.oid,c.relowner,'MEMBER'))),\n 'observed_existing_read_scope',jsonb_build_object(\n  'authenticated_table_select',not (profile_access_proof->>'no_whole_table_select')::boolean,\n  'authenticated_created_at_select',not (profile_access_proof->>'created_at_not_exposed')::boolean),\n 'original_readback_expectations',jsonb_build_object(\n  'no_whole_table_select',profile_access_proof->'no_whole_table_select',\n  'created_at_not_exposed',profile_access_proof->'created_at_not_exposed'),\n 'scope_note','Repair source grants only the three named SELECT columns; it neither grants nor revokes table-level SELECT. Existing own-row read access is retained. Exact own-row RLS, non-owner/non-BYPASS role and no direct-write boundary remain required.',\n 'historical_acl_timing_proven',false\n) as profile_access_current_proof from original;\n`;
const path=resolve(outputs,'update-2-3-profile-readback-current-20261019.sql');writeFileSync(path,sql,{mode:0o600});
console.log(JSON.stringify({path,sha256:createHash('sha256').update(sql).digest('hex'),bytes:Buffer.byteLength(sql)},null,2));
