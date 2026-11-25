import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const workflow=readFileSync(new URL('../.github/workflows/blue_web_gateway_deploy.yml',import.meta.url),'utf8');
const block=workflow.split('      - name: Validate scope and explicit authorization')[1].split('      - name: Offline gateway authentication tests')[0].split('        run: |\n')[1].split('\n').map(s=>s.slice(10)).join('\n');
const base={...process.env,GITHUB_REPOSITORY:'ehdud6728-bit/BLUE-Signal-Lab',GITHUB_REF:'refs/heads/main',MODE:'deploy_web',TEAM:'KEEP_EXISTING',AUD:'KEEP_EXISTING',CONFIRM:'KEEP_EXISTING'};
const run=(vars={})=>spawnSync('bash',['-c',block],{env:{...base,...vars},encoding:'utf8'});
test('all routine release modes accept existing configuration defaults',()=>{
 for(const MODE of ['verify_only','deploy_web','deploy_api','deploy_api_and_web'])assert.equal(run({MODE}).status,0,MODE);
 assert.equal((workflow.match(/default: KEEP_EXISTING/g)||[]).length,3);
 assert.match(workflow,/default: verify_only/);
});
test('explicit config replacement requires full deployment and policy confirmation',()=>{
 const newConfig={TEAM:'test.cloudflareaccess.com',AUD:'a'.repeat(64),CONFIRM:'WEB_API_ACCESS_POLICY_VERIFIED'};
 assert.equal(run({...newConfig,MODE:'deploy_api_and_web'}).status,0);
 for(const MODE of ['deploy_web','deploy_api'])assert.notEqual(run({...newConfig,MODE}).status,0);
 assert.notEqual(run({...newConfig,MODE:'deploy_api_and_web',CONFIRM:'KEEP_EXISTING'}).status,0);
 assert.notEqual(run({MODE:'deploy_api_and_web',TEAM:'test.cloudflareaccess.com'}).status,0);
 assert.notEqual(run({MODE:'deploy_api_and_web',TEAM:'test.invalid',AUD:'a'.repeat(64),CONFIRM:'WEB_API_ACCESS_POLICY_VERIFIED'}).status,0);
});
test('wrong target or mode cannot deploy',()=>{
 assert.notEqual(run({GITHUB_REF:'refs/heads/test'}).status,0);
 assert.notEqual(run({GITHUB_REPOSITORY:'other/repo'}).status,0);
 assert.notEqual(run({MODE:'unknown'}).status,0);
});
test('separate deploy targets preserve settings and require current service binding',()=>{
 assert.match(workflow,/if: inputs.mode == 'deploy_api' \|\| inputs.mode == 'deploy_api_and_web'/);
 assert.match(workflow,/if: inputs.mode == 'deploy_web' \|\| inputs.mode == 'deploy_api_and_web'/);
 assert.match(workflow,/BLOCKED: routine deployment requires existing same-origin service binding/);
 assert.match(workflow,/BLOCKED: existing gateway Access variables missing or invalid/);
 assert.match(workflow,/npx wrangler deploy --keep-vars\n/);
});
