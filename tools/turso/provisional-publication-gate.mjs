/** Bounded read-only preflight for scheduled/manual provisional publication. */
import {createClient} from '@libsql/client';
import {appendFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {publicationGate} from '../../collector/src/provisional-publication-gate.mjs';
export {publicationGate};
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const db=createClient({url:process.env.TURSO_DATABASE_URL,authToken:process.env.TURSO_AUTH_TOKEN,intMode:'string'});
 try{
  const r=await publicationGate(db,new Date(),{scheduled:process.env.GITHUB_EVENT_NAME==='schedule'||process.env.PUBLISH_RECOVERY==='true'});
  console.log('BLUE_PROVISIONAL_PUBLICATION_GATE',JSON.stringify(r));
  if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,'ready='+String(r.ready)+'\n');
 }finally{db.close();}
}
