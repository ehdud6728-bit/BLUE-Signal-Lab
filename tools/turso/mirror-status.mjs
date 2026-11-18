import {createClient} from '@libsql/client/web';

// Manual Turso-only status: no Cloudflare credential, D1 query, or stock payload.
const url=process.env.TURSO_DATABASE_URL?.trim();
const authToken=process.env.TURSO_AUTH_TOKEN?.trim();
if(!url || !authToken || (!url.startsWith('libsql://') && !url.startsWith('https://'))){
  console.error('TURSO_MIRROR_STATUS_CONFIG_MISSING');
  process.exit(1);
}

const kstDay=new Date(Date.now()+9*60*60*1000).toISOString().slice(0,10);
const client=createClient({url,authToken});
try{
  // Both tables have a trade_date-leading primary key. Today's bounded counts
  // are intentionally preferred over a full-history scan.
  const latest=await client.execute({
    sql:'SELECT COUNT(*) AS n, MAX(received_at_utc) AS newest FROM blue_kis_live_quotes_r141 WHERE trade_date=?',
    args:[kstDay]
  });
  const history=await client.execute({
    sql:'SELECT COUNT(*) AS n FROM blue_kis_live_history_r141 WHERE trade_date=?',
    args:[kstDay]
  });
  const newest=latest.rows[0]?.newest;
  const ageMinutes=newest ? Math.max(0,Math.round((Date.now()-Date.parse(String(newest)))/60000)) : 'NONE';
  console.log(`TURSO_MIRROR_STATUS_OK day_kst=${kstDay} latest_symbols=${latest.rows[0]?.n ?? 0} history_rows=${history.rows[0]?.n ?? 0} newest_collector_receipt_utc=${newest || 'NONE'} age_minutes=${ageMinutes}`);
  console.log('NOTE: Collector receipt time is not independently verified exchange tick time. D1 parity and historical completeness are not established by this test.');
}catch{
  console.error('TURSO_MIRROR_STATUS_FAILED: Confirm schema and credentials.');
  process.exitCode=1;
}finally{
  client.close();
}
