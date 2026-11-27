import unittest
from copy import deepcopy
from datetime import date,timedelta
from pattern_performance_landmark import study,registry
from pattern_performance_audited import analyze
class AllPatterns(unittest.TestCase):
    def fixture(self):
        ds=[(date(2026,11,1)+timedelta(days=i)).isoformat() for i in range(25)]
        bars=[dict(day=d,code=c,market='KOSPI',open=100,high=110,low=90,close=105,amount=100,volume=10) for d in ds for c in ('000001','000002')]
        source=dict(format='BLUE_TURSO_EXIT_SOURCE_V1',audits_readback_verified=True,asof_day=ds[-1],research_audited_days=1,research_excluded_days=[],research_audited_dates=[ds[0]],eod_days=[dict(day=d,expected=2,actual=2) for d in ds],signals=[dict(day=ds[0],code='000001',names=['ENV20','BB30']),dict(day=ds[0],code='000002',names=['ENV40'])],bars=bars)
        snap=dict(asof=ds[-1],rows={'ENV20':[],'BB30':[],'ENV40':[],'BB40':[]},recommendations=[dict(group='candle_rankings',pattern='ENV40|BULL',horizon_trading_days=h,tier='SHORT_RECOMMENDATION') for h in (3,5)]+[dict(group='candle_rankings',pattern='BB30|BULL',horizon_trading_days=3,tier='WATCH')])
        return source,snap
    def test_all_bases_exact_recommendations_and_no_watch_promotion(self):
        s,p=self.fixture();r=study(s,p);m={(x['group'],x['pattern']):x for x in r['inventory']}
        self.assertEqual(len(m),5);self.assertEqual(r['unique_case_count'],2)
        self.assertEqual(m['rankings','BB40']['status'],'NO_MATCHING_CASES')
        self.assertEqual(m['candle_rankings','ENV40|BULL']['matched_cases'],1)
        self.assertEqual(m['candle_rankings','ENV40|BULL']['recommendation_horizons'],[3,5])
        self.assertEqual(r['watch_not_promoted'],{'WATCH':1})
        self.assertNotIn(('candle_rankings','BB30|BULL'),m)
    def test_capture_does_not_change_original_report(self):
        s,_=self.fixture();g={};self.assertEqual(analyze(s),analyze(s,cohort_sink=g.update))
        self.assertEqual(len(g['rankings']),3)
    def test_missing_bar_does_not_skip_forward(self):
        s,p=self.fixture();s['bars']=[b for b in s['bars'] if not (b['code']=='000002' and b['day']=='2026-11-03')]
        r=study(s,p);q=next(x for x in r['inventory'] if x['pattern']=='ENV40|BULL')
        self.assertEqual(q['path_end_reasons'],{'MISSING_OR_INVALID_PATH':1})
        self.assertFalse(any(x['pattern']=='ENV40|BULL' for x in r['rows']))
    def test_unsupported_condition_not_silently_treated_as_base(self):
        s,p=self.fixture();p['recommendations'][0]['pattern']='ENV40|DOJI'
        q=next(x for x in study(s,p)['inventory'] if x['pattern']=='ENV40|DOJI')
        self.assertEqual(q['matched_cases'],0)
    def test_no_future_selection_or_unaudited_signal(self):
        s,p=self.fixture();p['asof']='2026-12-01'
        with self.assertRaisesRegex(ValueError,'SELECTION_AFTER_SOURCE'):study(s,p)
        s,p=self.fixture();s['research_audited_dates']=[]
        with self.assertRaisesRegex(ValueError,'SIGNAL_AUDIT_MISSING'):study(s,p)
if __name__=='__main__':unittest.main()
