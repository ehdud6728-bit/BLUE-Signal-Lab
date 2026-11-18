import {createClient} from '@libsql/client/web';

// Phase 1 of a Turso mirror: only the 5-minute full collector's already
// validated quotes are mirrored. No D1 SELECT, API read switching, or backfill.
export function tursoMirrorEnabled(env) {
  return String(env?.TURSO_MIRROR_ENABLED || 'false').toLowerCase() === 'true';
}

export function buildTursoMirrorStatements(quotes) {
  if (!Array.isArray(quotes) || !quotes.length) throw Error('TURSO_MIRROR_EMPTY_BATCH');
  const statements=[];
  const seen=new Set();
  for (const q of quotes) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(q?.trade_date_kst || '') ||
        !['J','NX'].includes(q?.market) ||
        !/^\d{6}$/.test(q?.code || '') ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(q?.received_at_utc || '') ||
        !Number.isSafeInteger(q?.price) || q.price <= 0 ||
        !Number.isSafeInteger(q?.accumulated_volume) || q.accumulated_volume < 0 ||
        typeof q?.phase !== 'string' || !q.phase) {
      throw Error('TURSO_MIRROR_INVALID_QUOTE');
    }
    const key=`${q.trade_date_kst}:${q.market}:${q.code}`;
    if (seen.has(key)) throw Error('TURSO_MIRROR_DUPLICATE_KEY');
    seen.add(key);
    statements.push({
      sql:`INSERT INTO blue_kis_live_quotes_r141
        (trade_date,market,code,received_at_utc,payload_json) VALUES(?,?,?,?,?)
        ON CONFLICT(trade_date,market,code) DO UPDATE SET
          received_at_utc=excluded.received_at_utc,
          payload_json=excluded.payload_json
        WHERE excluded.received_at_utc > blue_kis_live_quotes_r141.received_at_utc`,
      args:[q.trade_date_kst,q.market,q.code,q.received_at_utc,JSON.stringify(q)]
    });
    statements.push({
      sql:`INSERT OR IGNORE INTO blue_kis_live_history_r141
        (trade_date,market,code,received_at_utc,price,volume,phase) VALUES(?,?,?,?,?,?,?)`,
      args:[q.trade_date_kst,q.market,q.code,q.received_at_utc,q.price,q.accumulated_volume,q.phase]
    });
  }
  return statements;
}

export async function mirrorQuotesToTurso(env,quotes,{createClientFn=createClient}={}) {
  if (!tursoMirrorEnabled(env)) return {status:'DISABLED',saved:0};
  const url=env.TURSO_DATABASE_URL?.trim();
  const authToken=env.TURSO_AUTH_TOKEN?.trim();
  if (!url || !authToken) return {status:'MISSING_SECRETS',saved:0};
  if (!url.startsWith('libsql://') && !url.startsWith('https://')) return {status:'BAD_URL',saved:0};
  const statements=buildTursoMirrorStatements(quotes);
  const client=createClientFn({url,authToken});
  try {
    // One transaction: never save a latest quote without its matching history.
    await client.batch(statements,'write');
    return {status:'OK',saved:quotes.length};
  } finally {
    client.close();
  }
}
