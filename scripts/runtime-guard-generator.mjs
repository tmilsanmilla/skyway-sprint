// Mechanical, offline generator. It consumes a fresh read-only metadata export,
// never credentials or account rows. Unknown callable functions fail closed.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { reviewedRuntimeRpcs,reviewedRuntimeInvokerRpcs,anonymousRuntimeReaders } from './runtime-guard-rpc-inventory.mjs';
import { reviewedRuntimeSourcePins } from './runtime-guard-source-pins.mjs';

export const md5 = value => createHash('md5').update(value).digest('hex');
const q = value => `'${String(value).replaceAll("'", "''")}'`;
const qi = value => `"${String(value).replaceAll('"', '""')}"`;
const normalized = signature => signature.replaceAll(/\s*,\s*/g, ',').replace(/^public\./, '');
export function guardFunctionDefinition(fn,{guestRead=false}={}) {
  assert.equal(fn.schema, 'public');
  if (fn.security_definer !== true) {
    const signature=normalized(fn.signature),pin=reviewedRuntimeSourcePins[signature];
    assert.equal(fn.security_definer, false, `Review non-definer RPC ${fn.signature}`);
    assert.ok(reviewedRuntimeRpcs.has(signature) && reviewedRuntimeInvokerRpcs.has(signature), `Review non-definer RPC ${fn.signature}`);
    assert.ok(pin?.definition && md5(fn.definition)===pin.definition, `Unreviewed security-invoker RPC ${fn.signature}`);
    assert.equal(fn.language, 'sql', `Review security-invoker language ${fn.signature}`);
    assert.equal(guestRead, false, `Review anonymous security-invoker RPC ${fn.signature}`);
  }
  assert.ok(fn.config?.includes('search_path=""'), `Review search_path ${fn.signature}`);
  assert.ok(['s', 'v'].includes(fn.volatility), `Review cached RPC ${fn.signature}`);
  const match = /\bAS (\$[a-zA-Z_0-9]*\$)([\s\S]*)\1\s*$/.exec(fn.definition);
  assert.ok(match, `Review body quoting ${fn.signature}`);
  const source = match[2];
  assert.equal(source.trim(), fn.source.trim());
  let body;
  let definition = fn.definition;
  // Invokers retain caller privileges and cannot access app_private. The
  // argument-free public boolean exposes only this caller's admission result.
  const admission=fn.security_definer
    ? (guestRead ? 'if auth.uid() is not null then perform app_private.require_pixel_runtime();end if;'
      : 'perform app_private.require_pixel_runtime();')
    : "if not public.skyway_runtime_admitted() then raise exception 'Sign in again with Pixel Pulse to continue' using errcode='42501';end if;";
  if (fn.language === 'plpgsql') {
    assert.ok(!/^\s*#/m.test(source), `Review compiler directives ${fn.signature}`);
    assert.match(source.trim(), /^(declare\b|begin\b|<<)/i);
    body = `\nbegin\n  -- Pixel runtime boundary: before original variable initializers or writes.\n  ${admission}\n  <<skyway_original>>\n${source.trim().replace(/;?\s*$/, ';')}\nend\n`;
  } else if (fn.language === 'sql') {
    assert.match(source.trim(), /^(select|with)\b/i);
    const query = source.trim().replace(/;\s*$/, '');
    body = `\n#variable_conflict use_column\nbegin\n  ${admission}\n  ${fn.returns_set ? 'return query ' : 'return ('}${query}${fn.returns_set ? ';' : ');'}\nend\n`;
    definition = definition.replace(/\bLANGUAGE sql\b/, 'LANGUAGE plpgsql');
  } else throw new Error(`Review RPC language ${fn.signature}`);
  const start = definition.indexOf(match[0]);
  definition = definition.slice(0, start) + `AS $runtime_guard$${body}$runtime_guard$\n`;
  return { ...fn, guardedDefinition: definition, guardedSource: body,
    beforeDefinitionMd5: md5(fn.definition), afterSourceMd5: md5(body) };
}

export function runtimeHelpers(nativeIssuer) {
  const issuer = new URL(nativeIssuer);
  assert.equal(issuer.protocol, 'https:');
  assert.ok(!issuer.username && !issuer.password && !issuer.search && !issuer.hash);
  assert.notEqual(nativeIssuer, 'https://skyway-sprint.vercel.app/api/pixel-pulse');
  return `
create or replace function app_private.pixel_native_admission(p_user_id uuid)
returns boolean language sql stable security definer set search_path='' as $native$
 select p_user_id is not null and exists(select 1 from neon_auth."user" u where u.id=p_user_id
   and(not coalesce(u.banned,false) or(u."banExpires" is not null and u."banExpires"<clock_timestamp())))
 and not exists(select 1 from app_private.pixel_links l where l.user_id=p_user_id)
$native$;
revoke all on function app_private.pixel_native_admission(uuid) from public,anon,anonymous,authenticated;
grant execute on function app_private.pixel_native_admission(uuid) to skyway_server_api;

create or replace function app_private.pixel_runtime_admitted()
returns boolean language plpgsql stable security definer set search_path='' as $admission$
declare claims jsonb:=auth.jwt();u uuid:=auth.uid();stamp numeric:=extract(epoch from clock_timestamp());cv numeric;
begin
 if u is null or jsonb_typeof(claims)<>'object' or claims->>'sub' is distinct from u::text then return false;end if;
 if claims->>'iss'=${q(nativeIssuer)} then
   if claims?'skyway_auth' or claims?'pixel_subject' or claims?'pixel_session_hash' or claims?'pixel_credential_version' then return false;end if;
   return app_private.pixel_native_admission(u);
 end if;
 if claims->>'iss' is distinct from 'https://skyway-sprint.vercel.app/api/pixel-pulse'
  or claims->>'skyway_auth' is distinct from 'pixel' or claims->>'role' is distinct from 'authenticated'
  or jsonb_typeof(claims->'aud') is distinct from 'array'
  or not(claims->'aud' ? 'https://skyway-sprint.vercel.app')
  or jsonb_typeof(claims->'iat') is distinct from 'number' or jsonb_typeof(claims->'exp') is distinct from 'number'
  or coalesce(claims->>'pixel_session_hash','')!~'^[a-f0-9]{64}$'
  or jsonb_typeof(claims->'pixel_credential_version') is distinct from 'number'
  or coalesce(claims->>'pixel_credential_version','')!~'^[0-9]{1,16}$' then return false;end if;
 cv:=(claims->>'pixel_credential_version')::numeric;
 if cv>9007199254740991 or (claims->>'iat')::numeric>stamp+10
  or (claims->>'iat')::numeric<stamp-130 or (claims->>'exp')::numeric<=stamp
  or (claims->>'exp')::numeric>(claims->>'iat')::numeric+120 then return false;end if;
 return exists(select 1 from app_private.pixel_sessions s
  join app_private.pixel_links l using(issuer,subject) join neon_auth."user" a on a.id=l.user_id
  where l.user_id=u and l.issuer='https://pixel-pulse-websites.vercel.app/api/sso'
   and l.subject::text=claims->>'pixel_subject' and l.credential_version=cv
   and s.token_hash=claims->>'pixel_session_hash' and s.credential_version=cv
   and s.expires_at>clock_timestamp() and s.runtime_lease_until>clock_timestamp()
   and s.runtime_lease_until<=clock_timestamp()+interval '35 seconds'
   and(not coalesce(a.banned,false) or(a."banExpires" is not null and a."banExpires"<clock_timestamp())));
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end $admission$;
revoke all on function app_private.pixel_runtime_admitted() from public,anon,anonymous,authenticated,skyway_server_api;

create or replace function app_private.require_pixel_runtime()
returns void language plpgsql stable security definer set search_path='' as $require$
begin
 if not app_private.pixel_runtime_admitted() then
  raise exception 'Sign in again with Pixel Pulse to continue' using errcode='42501';
 end if;
end $require$;
revoke all on function app_private.require_pixel_runtime() from public,anon,anonymous,authenticated,skyway_server_api;

-- This is the sole new player-callable helper. No UUID arguments, profile data,
-- session IDs, role import or private schema access: only the caller's admission.
create or replace function public.skyway_runtime_admitted()
returns boolean language sql stable security definer set search_path='' as $public_admission$
 select app_private.pixel_runtime_admitted()
$public_admission$;
revoke all on function public.skyway_runtime_admitted() from public,anon,anonymous;
grant execute on function public.skyway_runtime_admitted() to authenticated;
`;
}

export function buildRuntimeMigration(snapshot, nativeIssuer, { fixture = false } = {}) {
  assert.equal(snapshot.readOnly, true);
  assert.equal(snapshot.database, fixture ? 'skyway_runtime_fixture' : 'neondb');
  if (!fixture) {
    assert.equal(snapshot.project, 'odd-unit-44587143');
    assert.equal(snapshot.branch, 'br-holy-math-axs9gjmb');
    assert.ok(snapshot.captured_at);
    assert.equal(snapshot.role_boundary?.superuser,false,'Player role is superuser');
    assert.equal(snapshot.role_boundary?.bypass_rls,false,'Player role bypasses RLS');
    assert.equal(snapshot.role_boundary?.public_create,false,'Player may replace public functions');
    assert.equal(snapshot.role_boundary?.private_usage,false,'Player has private schema access');
    assert.equal(snapshot.role_boundary?.private_create,false,'Player may create private functions');
  }
  const functions = snapshot.functions.filter(f => f.schema === 'public' && f.authenticated
    && f.name !== 'skyway_runtime_admitted').map(fn=>{
      if(!fixture){
        const signature=normalized(fn.signature),pin=reviewedRuntimeSourcePins[signature];
        assert.ok(reviewedRuntimeRpcs.has(signature),`Unclassified callable RPC ${fn.signature}`);
        assert.equal(fn.owner,'neondb_owner',`Review RPC owner ${fn.signature}`);
        assert.ok(pin&&(pin.definition?md5(fn.definition)===pin.definition:md5(fn.source)===pin.source),`Unreviewed installed RPC body ${fn.signature}`);
      }
      const guestRead=Boolean(fn.anon||fn.anonymous);
      if(guestRead)assert.ok(anonymousRuntimeReaders.has(normalized(fn.signature)),`Unclassified anonymous RPC ${fn.signature}`);
      return guardFunctionDefinition(fn,{guestRead});
    });
  assert.ok(functions.length >= (fixture ? 2 : 90), 'Incomplete current RPC inventory');
  for (const fn of snapshot.functions) {
    if (fn.schema === 'app_private') assert.equal(fn.authenticated, false, `Private RPC exposed: ${fn.signature}`);
    if (fn.schema === 'public'&&(fn.anon||fn.anonymous)) {
      assert.ok(anonymousRuntimeReaders.has(normalized(fn.signature)),`Review anonymous public RPC ${fn.signature}`);
    }
  }
  const tables = snapshot.tables.filter(t => t.schema === 'public');
  for (const t of tables) {
    assert.ok(!t.authenticated_truncate, `Unprotected truncate: ${t.name}`);
    if (t.authenticated_select || t.authenticated_insert || t.authenticated_update || t.authenticated_delete)
      assert.equal(t.rls, true, `Review non-RLS exposed table ${t.name}`);
  }
  const policies = snapshot.policies.filter(p => p.schemaname === 'public'
    && p.policyname !== 'skyway_pixel_runtime_admission');
  const manifest = functions.map(f => ({ signature: `public.${normalized(f.signature)}`,
    before: f.beforeDefinitionMd5, after: f.afterSourceMd5, acl: f.acl, volatility: f.volatility,
    strict: f.strict, returns_set: f.returns_set, security_definer: f.security_definer }));
  const expectedNames = functions.map(f => `public.${normalized(f.signature)}`).sort();
  const body = functions.map(f => `
 if md5(pg_get_functiondef(${q(`public.${normalized(f.signature)}`)}::regprocedure))=${q(f.beforeDefinitionMd5)} then
  execute ${q(f.guardedDefinition)};
 elsif (select md5(prosrc) from pg_proc where oid=${q(`public.${normalized(f.signature)}`)}::regprocedure)<>${q(f.afterSourceMd5)} then
  raise exception 'Unreviewed RPC source: %',${q(f.signature)};
 end if;`).join('\n');
  const guardPolicies = tables.filter(t => t.rls).map(t => `
 if not exists(select 1 from pg_policy where polrelid=${q(`public.${t.name}`)}::regclass and polname='skyway_pixel_runtime_admission') then
  execute ${q(`create policy skyway_pixel_runtime_admission on public.${qi(t.name)} as restrictive for all to authenticated using ((select public.skyway_runtime_admitted())) with check ((select public.skyway_runtime_admitted()))`)};
 end if;
 if not exists(select 1 from pg_policy where polrelid=${q(`public.${t.name}`)}::regclass and polname='skyway_pixel_runtime_admission'
  and not polpermissive and polcmd='*' and polroles=array[(select oid from pg_roles where rolname='authenticated')]
  and replace(pg_get_expr(polqual,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)'
  and replace(pg_get_expr(polwithcheck,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)') then
   raise exception 'Unreviewed runtime policy: %',${q(t.name)};
 end if;`).join('\n');
  return {
    manifest,
    sql: `-- Generated from a reviewed, complete read-only metadata export.
-- Application-owned admission only; managed auth.uid/auth.jwt are NEVER changed.
-- No accounts, passwords, balances, ownership, roles or history are modified.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $runtime_preflight$
declare actual jsonb;
begin
 if current_database()<>${q(fixture ? 'skyway_runtime_fixture' : 'neondb')} ${fixture ? '' : "or current_user<>'neondb_owner' or current_setting('neon.branch_id',true)<>'br-holy-math-axs9gjmb'"} then
  raise exception 'Exact reviewed Skyway database required';end if;
 if not exists(select 1 from information_schema.columns where table_schema='app_private' and table_name='pixel_sessions'
  and column_name='runtime_lease_until' and udt_name='timestamptz') then raise exception 'Apply the bounded Pixel session lease migration first';end if;
 if exists(select 1 from pg_roles where rolname='authenticated' and(rolsuper or rolbypassrls))
  or has_schema_privilege('authenticated','public','CREATE') or has_schema_privilege('authenticated','app_private','USAGE,CREATE')
  or exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in('r','p')
   and pg_has_role('authenticated',c.relowner,'MEMBER')) then raise exception 'Player schema/role boundary changed';end if;
 select jsonb_agg('public.'||p.proname||'('||replace(oidvectortypes(p.proargtypes),', ',',')||')'
  order by 'public.'||p.proname||'('||replace(oidvectortypes(p.proargtypes),', ',',')||')') into actual
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f'
  and p.proname<>'skyway_runtime_admitted' and has_function_privilege('authenticated',p.oid,'EXECUTE');
 if actual is distinct from ${q(JSON.stringify(expectedNames))}::jsonb then raise exception 'Current callable RPC inventory changed; review before installation';end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private'
  and p.prokind='f' and has_function_privilege('authenticated',p.oid,'EXECUTE')) then raise exception 'Private RPC is exposed';end if;
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in('r','p')
  and(has_table_privilege('authenticated',c.oid,'TRUNCATE') or(not c.relrowsecurity and
   (has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') or has_any_column_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE'))))) then
  raise exception 'Unprotected player table privileges changed';end if;
 select coalesce(jsonb_agg(to_jsonb(p) order by p.schemaname,p.tablename,p.policyname),'[]'::jsonb) into actual
 from pg_policies p where p.schemaname='public' and p.policyname<>'skyway_pixel_runtime_admission';
 if actual is distinct from ${q(JSON.stringify(policies))}::jsonb then raise exception 'Existing RLS policies changed; review before installation';end if;
 select coalesce(jsonb_agg(jsonb_build_object('name',c.relname,'rls',c.relrowsecurity) order by c.relname),'[]'::jsonb) into actual
 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in('r','p');
 if actual is distinct from ${q(JSON.stringify(tables.map(t => ({ name: t.name, rls: t.rls })).sort((a,b) => a.name.localeCompare(b.name))))}::jsonb then
  raise exception 'Player table inventory changed; review before installation';end if;
end $runtime_preflight$;
${runtimeHelpers(nativeIssuer)}
do $runtime_install$
declare item jsonb;
begin
${body}
${guardPolicies}
 for item in select * from jsonb_array_elements(${q(JSON.stringify(manifest))}::jsonb) loop
  if not exists(select 1 from pg_proc p where p.oid=(item->>'signature')::regprocedure and p.prosecdef=(item->>'security_definer')::boolean and p.prolang=(select oid from pg_language where lanname='plpgsql')
   and p.proconfig=array['search_path=""'] and p.proacl::text is not distinct from item->>'acl'
   and p.provolatile::text=item->>'volatility' and p.proisstrict=(item->>'strict')::boolean and p.proretset=(item->>'returns_set')::boolean
   and md5(p.prosrc)=item->>'after') then raise exception 'RPC attributes or permissions changed: %',item->>'signature';end if;
 end loop;
 raise notice 'PIXEL_RUNTIME_GUARD: %',jsonb_build_object('guarded_rpcs',${functions.length},'rls_tables',${tables.filter(t => t.rls).length},'native_linked_blocked',true,'managed_helpers_changed',false);
end $runtime_install$;
notify pgrst,'reload schema';
commit;
`, policies,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const [input, nativeIssuer, output] = process.argv.slice(2);
  assert.ok(input && nativeIssuer && output, 'Usage: node scripts/runtime-guard-generator.mjs METADATA_JSON NATIVE_ISSUER OUTPUT_SQL');
  const raw = JSON.parse(readFileSync(input, 'utf8'));
  const snapshot = Array.isArray(raw) ? raw[0]?.runtime_guard_metadata : raw.runtime_guard_metadata ?? raw;
  const result = buildRuntimeMigration(typeof snapshot === 'string' ? JSON.parse(snapshot) : snapshot, nativeIssuer);
  writeFileSync(output, result.sql, { mode: 0o600 });
  console.log(JSON.stringify({ generated: output, guardedRpcs: result.manifest.length, sqlSha256: createHash('sha256').update(result.sql).digest('hex') }));
}
