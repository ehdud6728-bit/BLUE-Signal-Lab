/**
 * BLUE -> Stock-Hunter R8/R9 independent-price-source bridge (RESEARCH_ONLY).
 *
 * This program NEVER calls KIS tokenP, never writes Turso/D1, and never calls
 * any trading/order endpoint. It reads ONE already-valid encrypted Turso token
 * and performs TWO fixed, historical KIS quote GET requests for Samsung SDI.
 * Credentials, plaintext tokens, DB URLs and raw response bodies are not saved.
 */
import {createClient} from '@libsql/client';
import {createHash} from 'node:crypto';
import {mkdir, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {decryptKisToken, scopeFor} from './kis-token-steward.mjs';

export const ENDPOINT = '/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice';
export const ORIGIN = 'https://openapi.koreainvestment.com:9443';
export const REQUIRED_DATES = ['2023-09-19', '2023-10-18', '2023-11-02', '2023-11-03', '2023-11-06'];
export const SYMBOL = '006400';
export const START = '20230901';
export const END = '20231106';
const MAX_RESPONSE_BYTES = 2_000_000;
const PRICE_FIELDS = ['open', 'high', 'low', 'close'];
const CSV_FIELDS = ['code', 'date', ...PRICE_FIELDS, 'volume'];

export class BridgeFailure extends Error {
  constructor(code) { super(code); this.name = 'BridgeFailure'; this.code = code; }
}

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function readVaultRow(row, key, secret, now = new Date()) {
  if (!row) throw new BridgeFailure('EXISTING_TURSO_TOKEN_MISSING');
  const saved = Date.parse(String(row.saved_at_utc ?? ''));
  const expires = Date.parse(String(row.expires_at_utc ?? ''));
  if (!Number.isFinite(saved) || !Number.isFinite(expires) ||
      saved > now.getTime() + 300_000 || expires <= saved) {
    throw new BridgeFailure('EXISTING_TOKEN_METADATA_INVALID');
  }
  if (expires <= now.getTime() + 300_000) {
    throw new BridgeFailure('EXISTING_TURSO_TOKEN_EXPIRED');
  }
  try {
    return decryptKisToken(String(row.ciphertext ?? ''), key, secret);
  } catch {
    throw new BridgeFailure('EXISTING_TOKEN_DECRYPT_UNAVAILABLE');
  }
}

export async function obtainExistingToken(env, {clientFactory = createClient, now = new Date()} = {}) {
  const key = env.KIS_APP_KEY?.trim();
  const secret = env.KIS_APP_SECRET?.trim();
  const url = env.TURSO_DATABASE_URL?.trim();
  const authToken = env.TURSO_AUTH_TOKEN?.trim();
  if (!key || !secret || !url || !authToken) {
    throw new BridgeFailure('EXISTING_BLUE_SECRETS_MISSING');
  }
  let client;
  try {
    client = clientFactory({url, authToken});
    // This query is intentionally the sole SQL request. Do not add DDL or writes.
    const rows = await client.execute({
      sql: 'SELECT ciphertext, expires_at_utc, saved_at_utc FROM blue_turso_kis_vault_v1 WHERE scope=? LIMIT 1',
      args: [scopeFor(key)],
    });
    return readVaultRow(rows.rows?.[0], key, secret, now);
  } catch (err) {
    if (err instanceof BridgeFailure) throw err;
    throw new BridgeFailure('EXISTING_TURSO_TOKEN_READ_UNAVAILABLE');
  } finally {
    try { client?.close(); } catch { /* never log connection details */ }
  }
}

export function parseDailyBars(response) {
  if (String(response?.rt_cd) !== '0') throw new BridgeFailure('KIS_HISTORICAL_API_REJECTED');
  const output = response.output2;
  if (!Array.isArray(output) || output.length === 0 || output.length > 100) {
    throw new BridgeFailure('KIS_HISTORICAL_BARS_UNAVAILABLE');
  }
  const parsed = [], seen = new Set();
  for (const bar of output) {
    if (!bar || typeof bar !== 'object') throw new BridgeFailure('KIS_BAR_OBJECT_INVALID');
    const compactDate = String(bar.stck_bsop_date ?? '');
    if (!/^20\d{6}$/.test(compactDate) || compactDate < START || compactDate > END) {
      throw new BridgeFailure('KIS_DATE_OUTSIDE_PINNED_RANGE');
    }
    const date = `${compactDate.slice(0,4)}-${compactDate.slice(4,6)}-${compactDate.slice(6,8)}`;
    const checkedDate = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(checkedDate.getTime()) || checkedDate.toISOString().slice(0, 10) !== date || seen.has(date)) {
      throw new BridgeFailure('KIS_DATE_INVALID_OR_DUPLICATE');
    }
    seen.add(date);
    const source = {
      open: bar.stck_oprc, high: bar.stck_hgpr, low: bar.stck_lwpr,
      close: bar.stck_clpr, volume: bar.acml_vol,
    };
    const row = {code: SYMBOL, date};
    for (const field of [...PRICE_FIELDS, 'volume']) {
      const value = String(source[field] ?? '');
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
        throw new BridgeFailure('KIS_PRICE_FIELD_INVALID');
      }
      row[field] = Number(value);
    }
    if (PRICE_FIELDS.some(field => row[field] <= 0) ||
        row.high < Math.max(row.open, row.close) || row.low > Math.min(row.open, row.close) ||
        row.low > row.high) {
      throw new BridgeFailure('KIS_OHLC_SHAPE_INVALID');
    }
    parsed.push(row);
  }
  parsed.sort((a, b) => a.date.localeCompare(b.date));
  if (REQUIRED_DATES.some(date => !seen.has(date))) {
    throw new BridgeFailure('KIS_REQUIRED_FIVE_DATES_MISSING');
  }
  return parsed;
}

export function quoteUrl(flag) {
  if (flag !== '0' && flag !== '1') throw new BridgeFailure('KIS_ADJUSTMENT_FLAG_INVALID');
  const params = new URLSearchParams({
    FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: SYMBOL,
    FID_INPUT_DATE_1: START, FID_INPUT_DATE_2: END,
    FID_PERIOD_DIV_CODE: 'D', FID_ORG_ADJ_PRC: flag,
  });
  return `${ORIGIN}${ENDPOINT}?${params}`;
}

export async function fixedQuoteGet(flag, key, secret, token, {fetchFn = fetch} = {}) {
  const url = quoteUrl(flag);
  let response, bytes, payload;
  try {
    response = await fetchFn(url, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${token}`, appkey: key, appsecret: secret,
        tr_id: 'FHKST03010100', custtype: 'P', accept: 'application/json',
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new BridgeFailure('KIS_HTTP_UNAVAILABLE');
    bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_RESPONSE_BYTES) throw new BridgeFailure('KIS_RESPONSE_OVERSIZE');
    payload = JSON.parse(bytes.toString('utf8'));
  } catch (err) {
    if (err instanceof BridgeFailure) throw err;
    throw new BridgeFailure('KIS_QUOTE_NETWORK_OR_JSON_UNAVAILABLE');
  }
  return {bars: parseDailyBars(payload), responseSha256: sha256(bytes)};
}

export const csvFor = bars => Buffer.from(
  `${CSV_FIELDS.join(',')}\n${bars.map(row => CSV_FIELDS.map(field => row[field]).join(',')).join('\n')}\n`,
  'utf8',
);

const baseSummary = (env, mode) => ({
  revision: 'BLUE_STOCKHUNTER_R9_KIS_PRICE_BRIDGE_RESEARCH_ONLY',
  research_only: true,
  mode,
  symbol: SYMBOL,
  request_date_range: [START, END],
  required_dates: REQUIRED_DATES,
  endpoint: ENDPOINT,
  raw_flag: '1', adjusted_flag: '0',
  source_repo: 'ehdud6728-bit/BLUE-Signal-Lab',
  source_commit: /^[0-9a-f]{40}$/.test(env.GITHUB_SHA ?? '') ? env.GITHUB_SHA : null,
  source_run_id: /^\d+$/.test(env.GITHUB_RUN_ID ?? '') ? env.GITHUB_RUN_ID : null,
  turso_select_count_max: 1, kis_quote_get_count_max: 2,
  kis_token_issuance_count: 0, turso_or_d1_write_count: 0,
  credentials_exported: false, token_exported: false,
  stockhunter_full_r116_replay_certified: false,
});

export async function executeBridge(outDir, env = process.env, {
  mode = 'dry_run', tokenReader = obtainExistingToken, quoteGet = fixedQuoteGet,
  now = new Date(),
} = {}) {
  const summary = baseSummary(env, mode);
  await mkdir(outDir, {recursive: true});
  try {
    if (mode === 'dry_run') {
      summary.status = 'DRY_RUN_NO_REMOTE_REQUESTS';
      return summary;
    }
    if (mode !== 'capture') throw new BridgeFailure('MODE_NOT_ALLOWED');
    const key = env.KIS_APP_KEY?.trim(), secret = env.KIS_APP_SECRET?.trim();
    if (!key || !secret || !env.TURSO_DATABASE_URL || !env.TURSO_AUTH_TOKEN) {
      throw new BridgeFailure('EXISTING_BLUE_SECRETS_MISSING');
    }
    const token = await tokenReader(env, {now});
    // Historical dated-range endpoint: '1' means original, '0' adjusted.
    const raw = await quoteGet('1', key, secret, token);
    const adjusted = await quoteGet('0', key, secret, token);
    const rawDays = raw.bars.map(bar => bar.date);
    if (rawDays.join(',') !== adjusted.bars.map(bar => bar.date).join(',')) {
      throw new BridgeFailure('RAW_ADJUSTED_DATE_SET_MISMATCH');
    }
    const captured = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
    for (const [label, flag, value] of [['raw', '1', raw], ['adjusted', '0', adjusted]]) {
      const prefix = `KIS_006400_202309_202311_${label}`;
      const csv = csvFor(value.bars);
      const manifest = {
        provider: 'KIS', endpoint: ENDPOINT, symbol: SYMBOL, period: 'D',
        fid_org_adj_prc: flag, csv_sha256: sha256(csv),
        api_response_sha256: value.responseSha256, captured_at_utc: captured,
        request_date_range: [START, END],
        source_repo: summary.source_repo, source_commit: summary.source_commit,
        source_run_id: summary.source_run_id,
        normalization: 'source stck_bsop_date/oprc/hgpr/lwpr/clpr/acml_vol to CSV',
      };
      await writeFile(resolve(outDir, `${prefix}.csv`), csv);
      await writeFile(resolve(outDir, `${prefix}_manifest.json`), `${JSON.stringify(manifest, null, 2)}\n`);
    }
    summary.status = 'CAPTURE_COMPLETE_READY_FOR_STOCKHUNTER_R8_AUDIT';
    summary.rows = {raw: raw.bars.length, adjusted: adjusted.bars.length};
    summary.captured_at_utc = captured;
  } catch (err) {
    summary.status = 'SOURCE_UNAVAILABLE_FAIL_CLOSED';
    // Never render arbitrary exceptions: they may contain a URL or credential.
    summary.error_code = err instanceof BridgeFailure ? err.code : 'UNEXPECTED_BRIDGE_FAILURE';
  } finally {
    await writeFile(resolve(outDir, 'BLUE_R9_SUMMARY.json'), `${JSON.stringify(summary, null, 2)}\n`);
  }
  return summary;
}

async function main() {
  const mode = process.argv[2] ?? 'dry_run';
  const outDir = process.argv[3] ?? 'output/stockhunter_r9_kis_bridge';
  const summary = await executeBridge(outDir, process.env, {mode});
  console.log(`BLUE_R9_BRIDGE_STATUS=${summary.status}`);
  if (summary.error_code) console.log(`BLUE_R9_BRIDGE_CODE=${summary.error_code}`);
  if (!['DRY_RUN_NO_REMOTE_REQUESTS', 'CAPTURE_COMPLETE_READY_FOR_STOCKHUNTER_R8_AUDIT'].includes(summary.status)) {
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
