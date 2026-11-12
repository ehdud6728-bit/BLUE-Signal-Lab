"""R159 unit checks; offline only. These never call KIS or mutate D1."""
import sys, unittest, math, json, tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'scripts'))
import numpy as np
import pandas as pd
from market_scan import normalise, enrich
from chart_research_r10 import _feature_matrix, backtest, chart_rows, _case_examples
from market_scan_r08_diagnostics import ma_event_diagnostics
from csv_to_d1 import pattern_highlights


def sample(count=300, final=150):
    dates=pd.bdate_range('2025-01-02',periods=count)
    close=np.full(count,100.,dtype=float)
    close[-1]=final
    return pd.DataFrame({'Date':dates,'Code':['005930']*count,
        'Open':[x*.995 for x in close], 'High':[x*1.02 for x in close],
        'Low':[x*.98 for x in close],'Close':close,
        'Volume':[1000000]*count,'Amount':[100000000]*count,'Market':['KOSPI']*count})

class R159(unittest.TestCase):
    def test_cross_and_up_transition_use_both_dates(self):
        s=normalise(sample())
        d=enrich(s)
        actual=ma_event_diagnostics(d)
        self.assertTrue(actual['ma_to_up'])
        self.assertTrue(actual['ma112_cross'])
        self.assertTrue(actual['ma224_cross'])
        self.assertFalse(actual['ma_down'])
        features,anchors=_feature_matrix(d)
        for key in ('MA_TO_UP','MA112_CROSS','MA224_CROSS'):
            self.assertIn(key,anchors)
            self.assertTrue(features[key][-1],key)
            self.assertFalse(features[key][-2],key)

    def test_case_dates_and_matured_outcomes(self):
        s=normalise(sample(final=115))
        ix=np.array([250,260,280,299],dtype=np.int64)
        rows=_case_examples(s,ix,10)
        self.assertEqual(len(rows),3)
        self.assertEqual(rows[0]['signal_day'],str(s.date.iloc[250].date()))
        self.assertEqual(rows[0]['entry_day'],str(s.date.iloc[251].date()))
        self.assertEqual(rows[0]['exit_day'],str(s.date.iloc[260].date()))
        self.assertTrue(all(x['exit_day']<=str(s.date.iloc[-1].date()) for x in rows))

    def test_chart_data_has_ma112_and_ma224(self):
        s=normalise(sample())
        chart=chart_rows(s,str(s.date.iloc[-1].date()))
        self.assertGreater(chart['bars'][-1]['ma112'],0)
        self.assertGreater(chart['bars'][-1]['ma224'],0)

    def test_pattern_highlights_from_three_real_cases(self):
        with tempfile.TemporaryDirectory() as t:
            folder=Path(t)
            setups=[{'label':'high but tiny','horizons':{'10':{'n':4,'up_pct':100,'mean_return_pct':8,'median_return_pct':7}}},
                    {'label':'qualified','horizons':{'10':{'n':10,'up_pct':70,'mean_return_pct':3,'median_return_pct':2}}}]
            (folder/'chart_snapshots.jsonl').write_text(json.dumps({'code':'005930','day':'2026-11-11','stats':{'setups':setups}})+'\n',encoding='utf-8')
            val=pattern_highlights(folder)
            self.assertEqual(val[('005930','2026-11-11')]['r159_pattern_up_10d'],100)
            self.assertEqual(val[('005930','2026-11-11')]['r159_pattern_n_10d'],4)
            setups.pop()
            (folder/'chart_snapshots.jsonl').write_text(json.dumps({'code':'005930','day':'2026-11-11','stats':{'setups':setups}})+'\n',encoding='utf-8')
            self.assertEqual(pattern_highlights(folder)[('005930','2026-11-11')]['r159_pattern_n_10d'],4)
            # Two cases remain below the verified analysis floor even when the user opts into 3.
            setups[:]=[{'label':'too few','horizons':{'10':{'n':2,'up_pct':100}}}]
            (folder/'chart_snapshots.jsonl').write_text(json.dumps({'code':'005930','day':'2026-11-11','stats':{'setups':setups}})+'\n',encoding='utf-8')
            self.assertEqual(pattern_highlights(folder),{})

    def test_asof_no_lookahead(self):
        s=normalise(sample())
        asof=str(s.date.iloc[-2].date())
        full=backtest(s,asof)
        cut=backtest(s.iloc[:-1],asof)
        self.assertEqual(full,cut)

if __name__=='__main__':unittest.main()
