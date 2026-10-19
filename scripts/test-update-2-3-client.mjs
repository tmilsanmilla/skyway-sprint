import {run} from 'node:test';
import {readdirSync} from 'node:fs';
const files=readdirSync(new URL('../app/',import.meta.url)).filter(n=>n.endsWith('.test.mjs')).map(n=>new URL(`../app/${n}`,import.meta.url).pathname);
let pass=0,fail=0;
for await(const e of run({files,concurrency:true})){
 if(e.type==='test:pass')pass++;
 if(e.type==='test:fail'){fail++;const d=e.data;console.log(JSON.stringify({failure:d.name,file:d.file,line:d.line,error:d.details?.error?.message?.split('\n')[0]}));}
}
console.log(JSON.stringify({pass,fail}));
process.exitCode=fail?1:0;
