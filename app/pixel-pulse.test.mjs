import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {pixelProfile,validatePixelMetadata,PIXEL_ISSUER,PIXEL_CLIENT_ID} from '../lib/pixel-pulse-rules.ts';
const sub='11111111-1111-4111-8111-111111111111';
const profile={iss:PIXEL_ISSUER,aud:PIXEL_CLIENT_ID,sub,preferred_username:'pixel_runner',email:'player@example.invalid',email_verified:false,profile_version:1,credential_version:2};
test('Pixel identity uses a stable subject and exact canonical profile; verification is never invented',()=>{
 assert.deepEqual(pixelProfile(profile,profile),{subject:sub,username:'pixel_runner',email:'player@example.invalid',emailVerified:false,profileVersion:1,credentialVersion:2});
 for(const invalid of [{...profile,sub:'another'},{...profile,preferred_username:'another_runner'},{...profile,email:'another@example.invalid'},{...profile,email_verified:true}]) assert.throws(()=>pixelProfile(profile,invalid));
});
test('provider metadata rejects alternate issuers, endpoints, algorithms and missing issuer response protection',()=>{
 const metadata={issuer:PIXEL_ISSUER,authorization_response_iss_parameter_supported:true,id_token_signing_alg_values_supported:['EdDSA'],authorization_endpoint:PIXEL_ISSUER+'/oauth2/authorize',token_endpoint:PIXEL_ISSUER+'/oauth2/token',userinfo_endpoint:PIXEL_ISSUER+'/oauth2/userinfo',jwks_uri:PIXEL_ISSUER+'/jwks'};
 assert.equal(validatePixelMetadata(metadata),'EdDSA');
 for(const invalid of [{...metadata,issuer:'https://evil.invalid'},{...metadata,jwks_uri:'https://evil.invalid/keys'},{...metadata,authorization_response_iss_parameter_supported:false},{...metadata,id_token_signing_alg_values_supported:['none']}]) assert.throws(()=>validatePixelMetadata(invalid));
});
test('Pixel and native signing keys coexist, the Pixel token always uses the game UUID and fixed non-admin role',()=>{
 const source=readFileSync(new URL('../lib/pixel-pulse-server.ts',import.meta.url),'utf8');
 assert.match(source,/\.well-known\/jwks\.json/);assert.match(source,/nativeKeys.keys/);
 assert.match(source,/role: "authenticated"/);assert.match(source,/setSubject\(session.user_id\)/);
 assert.doesNotMatch(source,/setSubject\(session.subject\)|role: session\./);
 assert.match(source,/\+ 120/);
});
