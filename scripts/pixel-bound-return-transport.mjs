// Prepare, but NEVER execute, individual statements for an atomic transaction
// tool. No credentials, database connection or raw account rows are read here.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

function codeStart(statement){
  let at=0;
  while(at<statement.length){
    if(/\s/.test(statement[at])){at++;continue;}
    if(statement.startsWith('--',at)){const end=statement.indexOf('\n',at+2);at=end<0?statement.length:end+1;continue;}
    if(statement.startsWith('/*',at)){
      let depth=1;at+=2;
      while(depth&&at<statement.length){if(statement.startsWith('/*',at)){depth++;at+=2;}else if(statement.startsWith('*/',at)){depth--;at+=2;}else at++;}
      if(depth)throw new Error('Unterminated SQL block comment');continue;
    }
    break;
  }
  return statement.slice(at).trim();
}

// PostgreSQL statement boundaries, including nested block comments, E strings,
// quoted identifiers and both $$ / $tag$ function bodies. Source text is kept.
export function splitPostgresStatements(source){
  if(typeof source!=='string')throw new Error('SQL source must be text');
  const statements=[];let start=0,at=0,mode='plain',depth=0,tag='',escaped=false;
  while(at<source.length){
    const character=source[at],next=source[at+1];
    if(mode==='line'){if(character==='\n')mode='plain';at++;continue;}
    if(mode==='block'){
      if(character==='/'&&next==='*'){depth++;at+=2;}
      else if(character==='*'&&next==='/'){depth--;at+=2;if(!depth)mode='plain';}else at++;
      continue;
    }
    if(mode==='single'){
      if(escaped&&character==='\\'){at+=Math.min(2,source.length-at);continue;}
      if(character==="'"&&next==="'"){at+=2;continue;}
      if(character==="'")mode='plain';at++;continue;
    }
    if(mode==='double'){
      if(character==='"'&&next==='"'){at+=2;continue;}
      if(character==='"')mode='plain';at++;continue;
    }
    if(mode==='dollar'){if(source.startsWith(tag,at)){at+=tag.length;mode='plain';}else at++;continue;}
    if(character==='-'&&next==='-'){mode='line';at+=2;continue;}
    if(character==='/'&&next==='*'){mode='block';depth=1;at+=2;continue;}
    if(character==="'"){
      escaped=/[Ee]/.test(source[at-1]||'')&&!/[A-Za-z0-9_$]/.test(source[at-2]||'');mode='single';at++;continue;
    }
    if(character==='"'){mode='double';at++;continue;}
    if(character==='$'&&!/[A-Za-z0-9_$]/.test(source[at-1]||'')){
      const found=source.slice(at).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/);
      if(found){tag=found[0];mode='dollar';at+=tag.length;continue;}
    }
    if(character===';'){
      const statement=source.slice(start,at+1).trim();if(codeStart(statement).replace(/;$/,'').trim())statements.push(statement);
      start=at+1;
    }
    at++;
  }
  if(!['plain','line'].includes(mode))throw new Error('Unterminated SQL quote or comment');
  const remaining=source.slice(start).trim();if(codeStart(remaining))statements.push(remaining);
  return statements;
}

const inventory=`select c.oid,n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname in('public','neon_auth','app_private') and c.relkind in('r','p')`;
const fingerprint=`select count(*)::bigint,md5(coalesce(string_agg(row_hash,'' order by row_hash collate "C"),''))
 from(select md5(to_jsonb(t)::text)as row_hash from only %I.%I t)hashed`;
const snapshotTable=`create temporary table skyway_pixel_return_preserve(
 relation_oid oid primary key,schema_name text not null,table_name text not null,row_count bigint not null,row_digest text not null
)on commit drop;`;
const snapshotRows=`do $pixel_return_snapshot$
declare item record;amount bigint;digest text;
begin
 for item in ${inventory} order by n.nspname,c.relname loop
  execute format('lock table only %I.%I in share row exclusive mode',item.nspname,item.relname);
  execute format($fingerprint$${fingerprint}$fingerprint$,item.nspname,item.relname)into amount,digest;
  insert into pg_temp.skyway_pixel_return_preserve values(item.oid,item.nspname,item.relname,amount,digest);
 end loop;
 if not exists(select 1 from pg_temp.skyway_pixel_return_preserve)then raise exception 'No protected tables found';end if;
end $pixel_return_snapshot$;`;
const assertRows=`do $pixel_return_preserved$
declare item record;amount bigint;digest text;
begin
 if exists(select 1 from(${inventory})current_inventory
  full join pg_temp.skyway_pixel_return_preserve original on current_inventory.oid=original.relation_oid
  where current_inventory.oid is null or original.relation_oid is null
   or current_inventory.nspname<>original.schema_name or current_inventory.relname<>original.table_name)
 then raise exception 'Protected table inventory changed';end if;
 for item in select * from pg_temp.skyway_pixel_return_preserve order by schema_name,table_name loop
  execute format($fingerprint$${fingerprint}$fingerprint$,item.schema_name,item.table_name)into amount,digest;
  if amount<>item.row_count or digest is distinct from item.row_digest
  then raise exception 'Protected rows changed: %.%',item.schema_name,item.table_name;end if;
 end loop;
end $pixel_return_preserved$;`;
const proof=`select jsonb_build_object('migration','pixel05-bound-return','protected_data_preserved',true,
 'protected_tables',count(*),'protected_rows',coalesce(sum(row_count),0))as preservation
 from pg_temp.skyway_pixel_return_preserve;`;

export function makePixelBoundReturnTransaction(source){
  const parsed=splitPostgresStatements(source);
  assert.match(codeStart(parsed[0]||''),/^begin\s*;?$/i,'One outer BEGIN is required');
  assert.match(codeStart(parsed.at(-1)||''),/^commit\s*;?$/i,'One outer COMMIT is required');
  const body=parsed.slice(1,-1);
  assert.equal(body.length,7,'Only the reviewed seven-statement Pixel05 patch is supported');
  for(const statement of body)assert.doesNotMatch(codeStart(statement),/^(?:begin|commit|rollback|savepoint|release|end)\b/i,'Inner transaction control is forbidden');
  assert.match(codeStart(body[0]),/^set\s+local\s+lock_timeout\s*=\s*'5s'\s*;$/i);
  assert.match(codeStart(body[1]),/^set\s+local\s+statement_timeout\s*=\s*'30s'\s*;$/i);
  assert.match(codeStart(body[2]),/^select\s+pg_advisory_xact_lock\(20261024,5\)\s*;$/i);
  // The transaction tool supplies BEGIN/COMMIT. Preserve every exact source
  // statement, adding only temporary aggregate protection around the DDL.
  return {source_sha256:createHash('sha256').update(source).digest('hex'),
    sql_statements:[...body.slice(0,3),snapshotTable,snapshotRows,...body.slice(3),assertRows,proof]};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const path=resolve(import.meta.dirname,'../neon/pixel-pulse-05-bound-return.sql');
  console.log(JSON.stringify(makePixelBoundReturnTransaction(readFileSync(path,'utf8')),null,2));
}
