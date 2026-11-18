import {readFile} from 'node:fs/promises';
import {createClient} from '@libsql/client/web';

const url=process.env.TURSO_DATABASE_URL?.trim();
const authToken=process.env.TURSO_AUTH_TOKEN?.trim();
if (!url || !authToken || (!url.startsWith('libsql://') && !url.startsWith('https://'))) {
  console.error('TURSO_MIRROR_SCHEMA_CONFIG_MISSING_OR_INVALID');
  process.exit(1);
}
const schema=await readFile(new URL('./mirror-schema.sql',import.meta.url),'utf8');
const client=createClient({url,authToken});
try {
  await client.executeMultiple(schema);
  // Verify by constant-name lookups; the only mutations are IF NOT EXISTS DDL.
  const r=await client.execute("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name IN ('blue_kis_live_quotes_r141','blue_kis_live_history_r141')");
  if (Number(r.rows[0]?.n) !== 2) throw Error('Schema verification failed');
  console.log('TURSO_MIRROR_SCHEMA_READY: two tables verified, no stock rows inserted.');
} catch {
  console.error('TURSO_MIRROR_SCHEMA_FAILED: Check Turso credentials and DB permissions.');
  process.exitCode=1;
} finally {
  client.close();
}
