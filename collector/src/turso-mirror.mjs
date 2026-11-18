import {createClient} from '@libsql/client/web';

// Only KIS quotes validated by the existing collector can be mirrored. The
// separate time-boxed pilot is opt-in and never enables full mirror. D1 may
// reject a write later; Turso never reads D1 or fabricates a missing quote.
const PILOT_MAX_DURATION_MS=30*60*1000;
const PILOT_MAX_QUOTES_PER_RUN=2;

export function tursoMirrorMode(env,now=new Date()) {
  if (String(env?.TURSO_MIRROR_ENABLED || 'false').toLowerCase() === 'true') return 'FULL';
  const deadline=String(env?.TURSO_MIRROR_PILOT_UNTIL_UTC || '');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(deadline)) return 'OFF';
  const remaining=Date.parse(deadline)-now.getTime();
  return remaining > 0 && remaining <= PILOT_MAX_DURATION_MS ? 'PILOT' : 'OFF';
}

export function tursoMirrorEnabled(env,now=new Date()) {
  return tursoMirrorMode(env,now)!=='OFF';
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

export async function mirrorQuotesToTurso(env,quotes,{createClientFn=createClient,now=new Date()}={}) {
  const mode=tursoMirrorMode(env,now);
  if (mode==='OFF') return {status:'DISABLED',saved:0};
  const url=env.TURSO_DATABASE_URL?.trim();
  const authToken=env.TURSO_AUTH_TOKEN?.trim();
  if (!url || !authToken) return {status:'MISSING_SECRETS',saved:0};
  if (!url.startsWith('libsql://') && !url.startsWith('https://')) return {status:'BAD_URL',saved:0};
  const selected=mode==='PILOT' ? quotes.slice(0,PILOT_MAX_QUOTES_PER_RUN) : quotes;
  const statements=buildTursoMirrorStatements(selected);
  const client=createClientFn({url,authToken});
  try {
    // One transaction: never save a latest quote without its matching history.
    await client.batch(statements,'write');
    return {status:'OK',saved:selected.length,mode};
  } finally {
    client.close();
  }
}
