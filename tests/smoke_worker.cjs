const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const vm=require('node:vm');
const source=fs.readFileSync(path.resolve(__dirname,'../worker/src/index.ts'),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const moduleExports={};
vm.runInNewContext(js,{exports:moduleExports,Response,Request,URL,Date,Intl,JSON,console,fetch:async()=>new Response('{}')});
const app=moduleExports.default;
const env={CORS_ORIGIN:'https://blue-signal-lab.ehdud6728.workers.dev',SCAN_ADMIN_KEY:'A'.repeat(32),GITHUB_TOKEN:'TOKEN',
 DB:{prepare(){throw Error('DB should not be used by these negative tests')}}};
async function assertStatus(url,options,expected){
  const r=await app.fetch(new Request(url,options),env);
  if(r.status!==expected)throw Error(`${url}: ${r.status} != ${expected}, ${await r.text()}`);
  console.log('PASS',options?.method||'GET',url,expected);
}
(async()=>{
 const base='https://blue-signal-lab-api-v2.ehdud6728.workers.dev';
 await assertStatus(base+'/api/health',undefined,200);
 await assertStatus(base+'/api/scan/status?date=2026-11-09',undefined,401);
 await assertStatus(base+'/api/scan',{method:'POST',headers:{Origin:'https://untrusted.example','X-Scan-Key':'A'.repeat(32)}},403);
 await assertStatus(base+'/api/scan',{method:'POST',headers:{Origin:env.CORS_ORIGIN,'X-Scan-Key':'wrong'}},401);
 await assertStatus(base+'/api/scan',{method:'OPTIONS',headers:{Origin:env.CORS_ORIGIN}},204);
})().catch(e=>{console.error(e);process.exitCode=1});
