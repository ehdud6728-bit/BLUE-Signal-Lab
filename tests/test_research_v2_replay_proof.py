import hashlib
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1] / 'scripts'))
from research_v2_replay_proof import replay_proof


DAY='2026-11-10'
SHA='c'*64
SOURCE='KRX_PYKRX_EXACT_DAY_VERIFIED'


def example():
    audit={'asof':DAY,'observed_stocks':2662,'matched_stocks':99,
           'signal_events':111,'supplemental_rows':2662,
           'target_day_source':SOURCE,'supplemental_dates':[DAY],
           'data_phase':'HISTORICAL_EOD','intraday_verified':False,
           'source_verified_at_kst':'2026-11-21T08:00:00+09:00',
           'source_sha256_by_year':{'2025':SHA,'2026':SHA}}
    data=json.dumps({k:v for k,v in audit.items() if k!='source_verified_at_kst'},
                    ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()
    source_hash=hashlib.sha256(data).hexdigest()
    eod={'format':'BLUE_TURSO_VERIFIED_EOD_RANGE_V1',
         'start_day':DAY,'end_day':DAY,'total_rows':2662,'data_sha256':SHA,
         'days':[{'day':DAY,'rows':2662,'source':SOURCE,'sha256':SHA}]}
    snapshot={'format':'BLUE_TURSO_SIGNAL_SNAPSHOT_V1','day':DAY,
              'observed_stocks':2662,'matched_stocks':99,'signal_events':111,
              'source':SOURCE,'payload_sha256':SHA,'source_audit_sha256':source_hash}
    coverage={'format':'BLUE_RESEARCH_V2_HISTORY_COVERAGE_V1','day':DAY,
              'status':'PASS','all_50_have_250_valid_bars':True,
              'candidate_count':50,'min_candidate_bars':250,
              'eod_day_sha256':SHA,'verified_source':SOURCE,
              'eod_count':2662,'source_sha256_by_year':{'2025':SHA,'2026':SHA},
              'missing_candidates':[{'code':f'{i:06d}','history_bars':250,
                'meets_250_bar_threshold':True} for i in range(50)]}
    return audit,eod,snapshot,coverage


class ReplayProofTest(unittest.TestCase):
    def test_binds_replay_to_source_and_preserves_v1(self):
        proof=replay_proof(*example())
        self.assertEqual(proof['eod_row_count'],2662)
        self.assertEqual(proof['eod_day_sha256'],SHA)
        self.assertTrue(proof['all_50_histories_ready'])
        self.assertTrue(proof['v1_original_unchanged'])

    def test_rejects_original_partial_research_count(self):
        audit,eod,snapshot,coverage=example()
        audit['observed_stocks']=2612
        with self.assertRaisesRegex(ValueError,'PROVENANCE_MISMATCH'):
            replay_proof(audit,eod,snapshot,coverage)

    def test_rejects_mutated_or_unverified_research(self):
        audit,eod,snapshot,coverage=example()
        audit['signal_events']=112
        with self.assertRaisesRegex(ValueError,'PROVENANCE_MISMATCH'):
            replay_proof(audit,eod,snapshot,coverage)
        audit,eod,snapshot,coverage=example()
        snapshot['source_audit_sha256']=SHA
        with self.assertRaisesRegex(ValueError,'SIGNAL_AUDIT_HASH_MISMATCH'):
            replay_proof(audit,eod,snapshot,coverage)

    def test_rejects_wrong_day_or_krx_provider(self):
        audit,eod,snapshot,coverage=example()
        eod['days'][0]['source']='KIS_PROVISIONAL'
        with self.assertRaisesRegex(ValueError,'PROVENANCE_MISMATCH'):
            replay_proof(audit,eod,snapshot,coverage)

    def test_rejects_incomplete_50_history(self):
        audit,eod,snapshot,coverage=example()
        coverage['min_candidate_bars']=249
        coverage['all_50_have_250_valid_bars']=False
        with self.assertRaisesRegex(ValueError,'50_HISTORY_INCOMPLETE'):
            replay_proof(audit,eod,snapshot,coverage)


if __name__=='__main__':
    unittest.main()
