// Shared local-test setup only. This never reads DATABASE_URL or remote keys.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
export async function createRuntimeLocalFixture(topic) {
  assert.match(topic,/^[a-z_]{1,20}$/);
  const suffix=randomBytes(8).toString('hex');
  const database=`skyway_pixel_${topic}_${suffix}`;
  const roles=Object.fromEntries(['authenticated','anon','anonymous','skyway_server_api'].map(r=>[r,`pixel_${suffix}_${r}`]));
  const options={host:'/tmp',port:5432,user:'junfeng'};
  const admin=new pg.Client({...options,database:'postgres'});
  const created=[];let owned=false,db;
  const close=async()=>{
    if(db){await db.query('rollback').catch(()=>{});await db.end();}
    if(owned)await admin.query(`drop database "${database}"`);
    for(const role of created.reverse())await admin.query(`drop role "${role}"`);
    await admin.end();
  };
  try {
    await admin.connect();
    const status=(await admin.query("select current_setting('server_version') as version,inet_server_addr() is null as local,rolcreatedb,rolcreaterole from pg_roles where rolname=current_user")).rows[0];
    assert.equal(status.local,true);assert.match(status.version,/^17\./);assert.equal(status.rolcreatedb,true);assert.equal(status.rolcreaterole,true);
    for(const role of Object.values(roles)){
      assert.equal((await admin.query('select 1 from pg_roles where rolname=$1',[role])).rowCount,0);
      await admin.query(`create role "${role}" nologin`);created.push(role);
    }
    await admin.query(`create database "${database}"`);owned=true;
    db=new pg.Client({...options,database});await db.connect();
    return {db,roles,database,close,
      roleSql:text=>text.replace(/\b(authenticated|anonymous|anon|skyway_server_api)\b/g,m=>roles[m]),
      asRole:async(role,query,params=[])=>{
        assert.ok(roles[role]);await db.query(`set role "${roles[role]}"`);
        try{return await db.query(query,params);}finally{await db.query('reset role');}
      }};
  }catch(error){await close().catch(()=>{});throw error;}
}
