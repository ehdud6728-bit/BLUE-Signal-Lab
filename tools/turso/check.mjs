import { createClient } from '@libsql/client/web';

// This intentionally never logs the URL, token, error text or stack.
const url = process.env.TURSO_DATABASE_URL?.trim();
const authToken = process.env.TURSO_AUTH_TOKEN?.trim();

if (!url || !authToken) {
  console.error('TURSO_SECRETS_MISSING: Set both repository Actions secrets.');
  process.exit(1);
}

if (!url.startsWith('libsql://') && !url.startsWith('https://')) {
  console.error('TURSO_URL_INVALID: Expected a libsql:// or https:// URL.');
  process.exit(1);
}

let client;
try {
  client = createClient({ url, authToken });
  const result = await client.execute('SELECT 1 AS connection_ok');
  if (Number(result.rows[0]?.connection_ok) !== 1) {
    throw new Error('Unexpected connection probe result');
  }
  console.log('TURSO_CONNECTION_OK: read-only SELECT 1 returned the expected value.');
} catch {
  console.error('TURSO_CONNECTION_FAILED: Check Turso DB type, URL, token, and availability.');
  process.exitCode = 1;
} finally {
  try {
    client?.close();
  } catch {
    // Do not reveal credentials via client error messages.
  }
}
