import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {encryptKisToken} from './kis-token-steward.mjs';
import {
  BridgeFailure, ENDPOINT, REQUIRED_DATES, executeBridge,
  fixedQuoteGet, obtainExistingToken, parseDailyBars, quoteUrl, sha256,
} from './stockhunter-r9-kis-bridge.mjs';

const NOW = new Date('2026-11-20T02:00:00Z');
const ENV = {KIS_APP_KEY: 'mock-key', KIS_APP_SECRET: 'mock-secret',
  TURSO_DATABASE_URL: 'libsql://test.example', TURSO_AUTH_TOKEN: 'fake-turso-token',
  GITHUB_SHA: 'a'.repeat(40), GITHUB_RUN_ID: '44644444444'};

const daily = (dates = REQUIRED_DATES, price = 1000) => ({rt_cd: '0', output2: dates.map(date => ({
  stck_bsop_date: date.replaceAll('-', ''), stck_oprc: String(price),
  stck_hgpr: String(price + 30), stck_lwpr: String(price - 20),
  stck_clpr: String(price + 5), acml_vol: '1000',
}))});
const bytes = value => Buffer.from(JSON.stringify(value));

async function withDir(callback) {
  const dir = await mkdtemp(join(tmpdir(), 'blue-r9-bridge-'));
  try { await callback(dir); } finally { await rm(dir, {recursive: true, force: true}); }
}

test('default dry run never reads a token or sends quotes', async () => {
  await withDir(async dir => {
    const result = await executeBridge(dir, {}, {
      tokenReader: () => assert.fail('no SQL allowed'),
      quoteGet: () => assert.fail('no HTTP allowed'), now: NOW,
    });
    assert.equal(result.status, 'DRY_RUN_NO_REMOTE_REQUESTS');
    assert.equal(result.kis_token_issuance_count, 0);
    assert.deepEqual(await readdir(dir), ['BLUE_R9_SUMMARY.json']);
  });
});

test('capture without BLUE secrets fails closed before any remote request', async () => {
  await withDir(async dir => {
    const result = await executeBridge(dir, {}, {mode: 'capture', now: NOW,
      tokenReader: () => assert.fail('token requested'),
      quoteGet: () => assert.fail('quotes requested')});
    assert.equal(result.error_code, 'EXISTING_BLUE_SECRETS_MISSING');
  });
});

test('invalid mode rejected before remote request', async () => {
  await withDir(async dir => {
    const result = await executeBridge(dir, ENV, {mode: 'issue', now: NOW,
      tokenReader: () => assert.fail('token requested')});
    assert.equal(result.error_code, 'MODE_NOT_ALLOWED');
  });
});

test('read-only Turso SELECT uses encrypted existing token and closes client', async () => {
  const ciphertext = encryptKisToken('fake-opaque-access-token', ENV.KIS_APP_KEY, ENV.KIS_APP_SECRET);
  const queries = []; let closes = 0;
  const token = await obtainExistingToken(ENV, {now: NOW, clientFactory: () => ({
    async execute(query) {
      queries.push(query);
      return {rows: [{ciphertext, saved_at_utc: '2026-11-19T14:00:00Z',
        expires_at_utc: '2026-11-20T14:00:00Z'}]};
    },
    close() { closes++; },
  })});
  assert.equal(token, 'fake-opaque-access-token');
  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /^SELECT ciphertext, expires_at_utc, saved_at_utc/);
  assert.equal(queries[0].args.length, 1);
  assert.equal(closes, 1);
});

test('expired existing token refuses price requests; no tokenP fallback', async () => {
  const ciphertext = encryptKisToken('fake-opaque-access-token', ENV.KIS_APP_KEY, ENV.KIS_APP_SECRET);
  await assert.rejects(obtainExistingToken(ENV, {now: NOW, clientFactory: () => ({
    execute: async () => ({rows: [{ciphertext, saved_at_utc: '2026-11-18T01:00:00Z',
      expires_at_utc: '2026-11-20T01:00:00Z'}]}), close() {},
  })}), err => err instanceof BridgeFailure && err.code === 'EXISTING_TURSO_TOKEN_EXPIRED');
});

test('focal dates, duplicates, invalid prices and malformed response fail closed', () => {
  assert.equal(parseDailyBars(daily()).length, 5);
  assert.throws(() => parseDailyBars(daily(REQUIRED_DATES.slice(0, 4))), /KIS_REQUIRED_FIVE_DATES_MISSING/);
  assert.throws(() => parseDailyBars(daily([...REQUIRED_DATES, REQUIRED_DATES[0]])), /KIS_DATE_INVALID_OR_DUPLICATE/);
  assert.throws(() => parseDailyBars({rt_cd: '9'}), /KIS_HISTORICAL_API_REJECTED/);
  const invalid = daily(); invalid.output2[0].stck_hgpr = '9';
  assert.throws(() => parseDailyBars(invalid), /KIS_OHLC_SHAPE_INVALID/);
  const impossibleDate = daily(); impossibleDate.output2[0].stck_bsop_date = '20230931';
  assert.throws(() => parseDailyBars(impossibleDate), /KIS_DATE_INVALID_OR_DUPLICATE/);
});

test('dated KIS endpoint limits queries to 006400, 2023 and flags 1/0', () => {
  for (const flag of ['1', '0']) {
    const url = new URL(quoteUrl(flag));
    assert.equal(url.pathname, ENDPOINT);
    assert.equal(url.searchParams.get('FID_ORG_ADJ_PRC'), flag);
    assert.equal(url.searchParams.get('FID_INPUT_ISCD'), '006400');
    assert.equal(url.searchParams.get('FID_INPUT_DATE_1'), '20230901');
    assert.equal(url.searchParams.get('FID_INPUT_DATE_2'), '20231106');
  }
  assert.throws(() => quoteUrl('2'), /KIS_ADJUSTMENT_FLAG_INVALID/);
});

test('KIS quote requests use GET only, and raw response hash is recorded', async () => {
  const body = bytes(daily()); let requests = 0;
  const fetchFn = async (url, options) => {
    requests++;
    assert.equal(options.method, 'GET');
    assert.equal(new URL(url).searchParams.get('FID_ORG_ADJ_PRC'), '1');
    assert.equal(options.headers.appkey, ENV.KIS_APP_KEY);
    return {ok: true, async arrayBuffer() { return body; }};
  };
  const result = await fixedQuoteGet('1', ENV.KIS_APP_KEY, ENV.KIS_APP_SECRET,
    'fake-token', {fetchFn});
  assert.equal(requests, 1);
  assert.equal(result.responseSha256, sha256(body));
  assert.equal(result.bars.length, 5);
});

test('successful capture produces exactly R8-compatible CSVs and manifests', async () => {
  await withDir(async dir => {
    const requested = [];
    const result = await executeBridge(dir, ENV, {mode: 'capture', now: NOW,
      tokenReader: async () => 'fake-token',
      quoteGet: async flag => {
        requested.push(flag);
        return {bars: parseDailyBars(daily(REQUIRED_DATES, flag === '1' ? 1000 : 979)),
          responseSha256: 'b'.repeat(64)};
      }});
    assert.equal(result.status, 'CAPTURE_COMPLETE_READY_FOR_STOCKHUNTER_R8_AUDIT');
    assert.deepEqual(requested, ['1', '0']);
    assert.equal((await readdir(dir)).length, 5);
    for (const [label, flag] of [['raw', '1'], ['adjusted', '0']]) {
      const prefix = `KIS_006400_202309_202311_${label}`;
      const csv = await readFile(join(dir, `${prefix}.csv`));
      const manifest = JSON.parse(await readFile(join(dir, `${prefix}_manifest.json`)));
      assert.equal(manifest.fid_org_adj_prc, flag);
      assert.equal(manifest.csv_sha256, sha256(csv));
      assert.equal(manifest.provider, 'KIS');
      assert.equal(manifest.endpoint, ENDPOINT);
      assert.equal(manifest.captured_at_utc, '2026-11-20T02:00:00Z');
    }
    assert.equal(JSON.stringify(result).includes('fake-token'), false);
  });
});

test('mismatched raw/adjusted date sets cannot produce price artifacts', async () => {
  await withDir(async dir => {
    const extra = '2023-09-20';
    const result = await executeBridge(dir, ENV, {mode: 'capture', now: NOW,
      tokenReader: async () => 'fake-token',
      quoteGet: async flag => ({bars: parseDailyBars(daily(flag === '1'
        ? REQUIRED_DATES : [...REQUIRED_DATES, extra])), responseSha256: 'a'.repeat(64)})});
    assert.equal(result.error_code, 'RAW_ADJUSTED_DATE_SET_MISMATCH');
    assert.deepEqual(await readdir(dir), ['BLUE_R9_SUMMARY.json']);
  });
});

test('invalid ciphertext and Turso SELECT failures never surface secret text', async () => {
  const env = {...ENV, KIS_APP_SECRET: 'VERY_PRIVATE_SECRET'};
  await assert.rejects(obtainExistingToken(env, {clientFactory: () => ({
    execute: async () => {throw new Error('VERY_PRIVATE_SECRET');}, close() {},
  })}), err => err.code === 'EXISTING_TURSO_TOKEN_READ_UNAVAILABLE' &&
    !err.message.includes('VERY_PRIVATE_SECRET'));
});
