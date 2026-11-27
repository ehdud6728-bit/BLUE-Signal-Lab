import json,unittest,tempfile
from copy import deepcopy
from pathlib import Path
import test_pattern_performance_landmark as fixtures
from pattern_performance_landmark import study
from pattern_performance_chart_evidence import EvidenceCollector,validate,render,packed,observation
class ChartEvidence(unittest.TestCase):
    def fixture(self):return fixtures.AllPatterns().fixture()
    def build(self,s,p):
        c=EvidenceCollector({'source':'a'*64,'snapshot':'b'*64});report=study(s,p,case_sink=c.capture);return report,c.bundle(s['asof_day'],p['asof'])
    def test_exact_cohort_and_original_output_unchanged(self):
        s,p=self.fixture();r,b=self.build(s,p);self.assertEqual(r,study(s,p))
        self.assertEqual(len(b['cohorts']),5);self.assertEqual(next(x for x in b['cohorts'] if x['pattern']=='BB40')['selected'],[])
        self.assertEqual({x['payload']['code'] for x in b['cases'].values()},{'000001','000002'})
    def test_order_independent_real_prices_and_private_write(self):
        s,p=self.fixture();r,b=self.build(s,p);s['signals'].reverse();_,reverse=self.build(s,p);self.assertEqual(b,reverse)
        text=render(b);self.assertIn('연속 거래일 검증 전',text);self.assertIn('실제 저장 OHLC 표',text)
        with tempfile.TemporaryDirectory() as d:
            c=EvidenceCollector({'source':'a'*64,'snapshot':'b'*64});study(s,p,case_sink=c.capture);c.write(Path(d)/'private.json',s['asof_day'],p['asof']);self.assertTrue((Path(d)/'private.html').exists())
    def test_tampering_rejected_and_incomplete_not_miss(self):
        s,p=self.fixture();_,b=self.build(s,p);a=next(iter(b['cases'].values()));a['payload']['post_bars'][0]['close']+=1
        with self.assertRaisesRegex(ValueError,'CASE_HASH_MISMATCH'):validate(b)
        self.assertEqual(observation([])['status'],'INCOMPLETE')
    def test_fixed_sampling_covers_hit_miss_incomplete(self):
        s,p=self.fixture();s['signals'].append(dict(day=s['asof_day'],code='000001',names=['ENV20']));s['research_audited_dates'].append(s['asof_day'])
        _,b=self.build(s,p);c=next(x for x in b['cohorts'] if x['pattern']=='ENV20');self.assertEqual({x['status'] for x in c['selected']},{'HIT5','INCOMPLETE'})
        s['bars']=[{**z,'high':104,'close':102} for z in s['bars']];_,b=self.build(s,p);self.assertIn('MISS5',{x['status'] for x in next(z for z in b['cohorts'] if z['pattern']=='ENV20')['selected']})
    def test_bundle_dates_and_hash_metadata_rejected(self):
        s,p=self.fixture();_,b=self.build(s,p);b['input_sha256']['source']='wrong'
        with self.assertRaisesRegex(ValueError,'BAD_SOURCE_HASHES'):validate(b)
        _,b=self.build(s,p);b['selection_asof']='2026-12-01'
        with self.assertRaisesRegex(ValueError,'BUNDLE_DATES'):validate(b)
        _,b=self.build(s,p);b['asof']=b['selection_asof']='2026-11-01'
        with self.assertRaisesRegex(ValueError,'CASE_AFTER_ASOF'):validate(b)
if __name__=='__main__':unittest.main()
