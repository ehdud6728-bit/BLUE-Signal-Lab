import {createInterface} from 'node:readline';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

// Only recognize audited status summaries. Never echo unfiltered Wrangler
// output, provider responses, SQL, request URLs, or secret values.
const collectorStatuses='(?:STARTED|SKIPPED_LOCKED|PAUSED_NO_FRESH_CANDIDATES|PAUSED_MISSING_SECRETS|PAUSED_TOKEN_EXPIRED_OR_MISSING|NO_VALID_QUOTES|COLLECTOR_ERROR|PARTIAL_QUOTES|OK)';
const collectorReasons='(?:NONE|NO_VERIFIED_CANDIDATES|STALE_OR_FUTURE_EOD|SANITIZED_RUNTIME_FAILURE)';
const collectorPattern=new RegExp(`^BLUE_R142 status=(${collectorStatuses})(?: reason=(${collectorReasons}))? attempted=(\\d+) saved=(\\d+) rejected=(\\d+)$`);
const mirrorPattern=/^BLUE_TURSO_MIRROR status=(OK|DISABLED|MISSING_SECRETS|BAD_URL) mode=(OFF|PILOT|FULL) saved=(\d+)$/;
const providerPattern=/^BLUE_QUOTE_SHARED provider_calls=(\d+) reused_calls=(\d+)$/;
const warnings=new Set([
  'BLUE_TURSO_MIRROR_WRITE_FAILED',
  'BLUE_TURSO_MIRROR_SCHEDULE_FAILED',
  'BLUE_R142_LOG_WRITE_FAILED',
  'BLUE_R142_LOCK_RELEASE_FAILED',
  'BLUE_R154_FIRST_SEEN_SAVE_UNAVAILABLE'
]);

export function safeTailRecords(line) {
  if(typeof line!=='string'||line.length>256*1024)return [];
  let entry;
  try {entry=JSON.parse(line);} catch {return [];}
  if(!Array.isArray(entry?.logs))return [];
  const at=Number.isFinite(entry.eventTimestamp) && Math.abs(entry.eventTimestamp)<=8.64e15
    ?new Date(entry.eventTimestamp).toISOString():'UNKNOWN';
  const results=[];
  for(const log of entry.logs){
    const msg=Array.isArray(log?.message)?log.message.join(' '):log?.message;
    if(typeof msg!=='string')continue;
    const c=collectorPattern.exec(msg);
    if(c){results.push({kind:'collector',status:c[1],message:`at_utc=${at} BLUE_R142 status=${c[1]} reason=${c[2]||'UNKNOWN'} attempted=${c[3]} saved=${c[4]} rejected=${c[5]}`});continue;}
    const m=mirrorPattern.exec(msg);
    if(m){results.push({kind:'mirror',status:m[1],message:`at_utc=${at} BLUE_TURSO_MIRROR status=${m[1]} mode=${m[2]} saved=${m[3]}`});continue;}
    const p=providerPattern.exec(msg);
    if(p){results.push({kind:'provider',status:'SUMMARY',message:`at_utc=${at} BLUE_QUOTE_SHARED provider_calls=${p[1]} reused_calls=${p[2]}`});continue;}
    if(warnings.has(msg)){results.push({kind:'warning',status:msg,message:`at_utc=${at} ${msg}`});}
  }
  return results;
}

async function main(){
  const counts={collector:0,mirror:0,provider:0,warning:0};
  const states=new Map();
  let shown=0;
  for await(const line of createInterface({input:process.stdin,crlfDelay:Infinity})){
    for(const record of safeTailRecords(line)){
      counts[record.kind]++;
      states.set(record.status,(states.get(record.status)||0)+1);
      if(shown++<75)console.log(`BLUE_COLLECTOR_TAIL ${record.message}`);
    }
  }
  console.log(`BLUE_COLLECTOR_TAIL_SUMMARY full_runs=${counts.collector} mirror_events=${counts.mirror} provider_summaries=${counts.provider} warnings=${counts.warning}`);
  for(const [status,count] of [...states.entries()].sort((a,b)=>a[0].localeCompare(b[0])))
    console.log(`BLUE_COLLECTOR_TAIL_COUNT status=${status} count=${count}`);
  if(!counts.collector)console.log('BLUE_COLLECTOR_TAIL_NO_FULL_RUN: capture again during KST market hours including a five-minute boundary; check Cron/permissions if repeated.');
  if(!counts.mirror)console.log('BLUE_COLLECTOR_TAIL_NO_MIRROR_EVENT: no successful Turso mirror result observed in this capture.');
  console.log('BLUE_COLLECTOR_TAIL_READ_ONLY: No D1 SQL or KIS quote requests executed by this diagnostic.');
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  await main();
}
