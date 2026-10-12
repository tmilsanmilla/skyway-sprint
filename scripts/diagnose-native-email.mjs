// Disposable fixture diagnostic only. Provider may deny email changes; never claim delivery.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {Pool} from 'pg';
import {verifyNativePixelLinkPassword} from '../lib/pixel-pulse-native-proof.ts';
const cli=process.env.NEON_CLI_PATH;assert.ok(cli);
const uri=execFileSync(process.execPath,[cli,'connection-string','br-holy-math-axs9gjmb','--project-id','odd-unit-44587143','--database-name','neondb','--pooled'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const pool=new Pool({connectionString:uri,max:1});
const origin='https://skyway-sprint.vercel.app',name='em_'+randomBytes(8).toString('hex'),email=name+'@example.invalid',newEmail=name+'new@example.invalid',password=randomBytes(32).toString('base64url');
const jar=new Map();let id;
async function request(path,body){const r=await fetch(origin+'/api/auth/'+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:[...jar].map(([k,v])=>k+'='+v).join('; ')},body:JSON.stringify(body)});for(const entry of r.headers.getSetCookie()){const f=entry.split(';')[0],i=f.indexOf('=');if(i>0)jar.set(f.slice(0,i),f.slice(i+1));}return r;}
try{
 const signup=await request('sign-up/email',{name,email,password});assert.equal(signup.status,200);id=(await signup.json()).user.id;
 const proof=await verifyNativePixelLinkPassword('https://ep-tiny-tooth-ax0800jo.neonauth.c-4.us-east-2.aws.neon.tech/neondb/auth',email,password);assert.equal(proof,id);console.log(JSON.stringify({actualNativePasswordProofPassed:true,temporaryProofSessionClosed:true}));
 const start=await request('email-otp/request-email-change',{newEmail});
 const result=await start.json();console.log(JSON.stringify({otpRequestStatus:start.status,accepted:start.ok,errorCode:result.code||null,message:result.message||result.error||null}));
 if(start.ok){const wrong=await request('email-otp/change-email',{newEmail,otp:'invalid'});assert.ok(!wrong.ok,'Incorrect verification code was accepted');const row=(await pool.query('select email from neon_auth."user" where id=$1',[id])).rows[0];assert.equal(row.email,email);console.log(JSON.stringify({newAddressVerificationRequired:true,invalidCodeRejected:true,oldEmailKeptUntilVerified:true,mailboxDeliveryNotTested:true}));}
}finally{await pool.query('delete from neon_auth."user" where name=$1 and email in($2,$3) and($4::uuid is null or id=$4)',[name,email,newEmail,id||null]);await pool.query('delete from neon_auth.verification where identifier like $1',['%'+newEmail+'%']);await pool.end();}
