// Build a guarded, account-preserving transport. This script makes no network
// connection and never applies SQL. The operator must verify the target first.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..'),out=resolve(root,'../../outputs');
const sourcePath=resolve(root,'neon/update-2-3-mastery-management.sql');
const source=readFileSync(sourcePath,'utf8');
assert.equal((source.match(/^begin;$/gm)||[]).length,1);
assert.equal((source.match(/^commit;$/gm)||[]).length,1);
assert.doesNotMatch(source,/\b(?:truncate|vacuum|drop\s+table)\b|set\s+(?:level|xp_in_level|lifetime_xp)\s*=/i);
const payload=source.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,'');
const digest=value=>createHash('sha256').update(value).digest('hex');
const fingerprint=`select count(*),md5(coalesce(string_agg(md5((case when not $3 and $1='app_private' and $2='mastery_sessions' then to_jsonb(t)-'trial_replay' else to_jsonb(t) end)::text),'' order by md5((case when not $3 and $1='app_private' and $2='mastery_sessions' then to_jsonb(t)-'trial_replay' else to_jsonb(t) end)::text)),'')) from %I.%I t`;
const quote=value=>`'${value.replaceAll("'","''")}'`;
const sql=`-- Mastery follow-up: one atomic reviewed source, no player/reset commands.
do $mastery_followup_release$
declare item record;n bigint;h text;had_replay boolean;
begin
 if current_database()<>'neondb' or current_user<>'neondb_owner' then raise exception 'Verified Skyway owner/database required';end if;
 perform set_config('lock_timeout','5s',true);
 perform set_config('statement_timeout','30s',true);
 had_replay:=exists(select 1 from information_schema.columns where table_schema='app_private' and table_name='mastery_sessions' and column_name='trial_replay');
 create temporary table mastery_followup_protected(schema_name text,table_name text,n bigint,h text,acl text,rls boolean,primary key(schema_name,table_name)) on commit drop;
 for item in select ns.nspname schema_name,c.relname table_name,c.relacl::text acl,c.relrowsecurity rls from pg_class c join pg_namespace ns on ns.oid=c.relnamespace
  where c.relkind in('r','p') and (ns.nspname in('public','app_private') or ns.nspname='neon_auth' and c.relname in('user','account')) order by ns.nspname,c.relname loop
  execute format('lock table %I.%I in share row exclusive mode',item.schema_name,item.table_name);
  execute format(${quote(fingerprint)},item.schema_name,item.table_name) into n,h using item.schema_name,item.table_name,had_replay;
  insert into pg_temp.mastery_followup_protected values(item.schema_name,item.table_name,n,h,item.acl,item.rls);
 end loop;
 execute convert_from(decode('${Buffer.from(payload).toString('base64')}','base64'),'UTF8');
 for item in select * from pg_temp.mastery_followup_protected order by schema_name,table_name loop
  execute format(${quote(fingerprint)},item.schema_name,item.table_name) into n,h using item.schema_name,item.table_name,had_replay;
  if n<>item.n or h<>item.h then raise exception 'PLAYER DATA CHANGED: %.%; whole release rolled back',item.schema_name,item.table_name;end if;
  if exists(select 1 from pg_class c join pg_namespace ns on ns.oid=c.relnamespace where ns.nspname=item.schema_name and c.relname=item.table_name and (c.relacl::text is distinct from item.acl or c.relrowsecurity is distinct from item.rls)) then raise exception 'TABLE SECURITY CHANGED: %.%',item.schema_name,item.table_name;end if;
 end loop;
 if not had_replay and exists(select 1 from app_private.mastery_sessions where trial_replay) then raise exception 'Installation changed an existing session to replay';end if;
 raise notice 'MASTERY_FOLLOWUP_APPLIED: %',jsonb_build_object('player_data_preserved',true,'table_security_preserved',true,'xp_reset_not_replayed',true,'protected_tables',(select count(*) from pg_temp.mastery_followup_protected));
end $mastery_followup_release$;
`;
const target=resolve(out,'mastery-followup-release-20261019.sql');
writeFileSync(target,sql,{mode:0o600});
console.log(JSON.stringify({source:sourcePath,sourceSha256:digest(source),transport:target,transportSha256:digest(sql),network:false,applied:false}));
