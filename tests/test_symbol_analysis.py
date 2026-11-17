"""No-network, no-D1-write checks for independent historical diagnostics."""
import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

import pandas as pd

SRC=Path(__file__).resolve().parents[1]/'scripts'
sys.path.insert(0,str(SRC))
from market_scan_r11 import build_symbol_snapshot
from append_symbol_analysis_sql import statements, write_sql


def history(with_gap=False):
    dates=pd.bdate_range('2025-01-01',periods=290)
    prices=[100.0]*len(dates)
    if with_gap:
        prices[230:]=[500.0]*(len(prices)-230)
    rows=pd.DataFrame({'Date':dates,'Code':'225190','Open':prices,
      'High':[v*1.02 for v in prices], 'Low':[v*.98 for v in prices],
      'Close':prices,'Volume':10000,'Amount':1_000_000_000,'Market':'KOSDAQ'})
    return rows


class Tests(unittest.TestCase):
    def test_unmatched_symbol_has_independent_chart_without_future_bars(self):
        d=history()
        day=str(d.Date.iloc[280].date())
        d.loc[d.index[-1],'Close']=100
        snap=build_symbol_snapshot(d,day,'225190',[], 'TEST_DAILY')
        self.assertFalse(snap['diagnosis']['matched'])
        self.assertEqual(snap['diagnosis']['reason'],'NO_ENABLED_SIGNAL_ON_TARGET_DAY')
        self.assertEqual(snap['chart']['bars'][-1]['t'],day)
        self.assertTrue(all(b['t']<=day for b in snap['chart']['bars']))
        self.assertIsNotNone(snap['stats'])
    def test_corporate_action_gap_suppresses_historical_statistics(self):
        d=history(with_gap=True);day=str(d.Date.iloc[-1].date())
        snap=build_symbol_snapshot(d,day,'225190',[], 'TEST_DAILY')
        self.assertTrue(snap['diagnosis']['large_historical_gap_review'])
        self.assertEqual(snap['quality_status'],'CORPORATE_ACTION_REVIEW_REQUIRED')
        self.assertIsNone(snap['stats'])
    def test_closing_breakout_hypotheses_are_asof_only(self):
        d=history()
        target=270
        d.loc[target,['Open','High','Low','Close','Amount']]=[105,108,103,107,60_000_000_000]
        day=str(d.Date.iloc[target].date())
        # Later extreme price/turnover must not change an earlier day's diagnosis.
        d.loc[target+1,['Open','High','Low','Close','Amount']]=[500,520,480,510,900_000_000_000]
        first=build_symbol_snapshot(d,day,'225190',[], 'TEST_DAILY')['diagnosis']
        d.loc[target+1,['Open','High','Low','Close','Amount']]=[50,55,45,51,1_000_000]
        second=build_symbol_snapshot(d,day,'225190',[], 'TEST_DAILY')['diagnosis']
        self.assertEqual(first['additional_predicates'],second['additional_predicates'])
        self.assertTrue(first['additional_predicates']['BREAK_45_PRIOR_HIGH'])
        self.assertTrue(first['additional_predicates']['BREAK_55_PRIOR_HIGH'])
        self.assertTrue(first['additional_predicates']['AMOUNT_500_EOK'])
        self.assertTrue(first['additional_predicates']['AMOUNT_OVER_2X_PRIOR20'])
        self.assertTrue(first['additional_predicates']['CLOSE_IN_TOP_20PCT'])
        self.assertEqual(first['research_features']['prior_45_day_high'],102)
    def test_isolated_d1_sql_roundtrip_preserves_existing_signals(self):
        d=history();day=str(d.Date.iloc[-1].date())
        item=build_symbol_snapshot(d,day,'225190',[], 'TEST_DAILY')
        with tempfile.TemporaryDirectory() as folder:
            src=Path(folder)/'snapshot.json';dst=Path(folder)/'import.sql'
            src.write_text(json.dumps(item,ensure_ascii=False),encoding='utf-8')
            self.assertGreater(write_sql(str(src),str(dst),'test_run_01'),2)
            db=sqlite3.connect(':memory:')
            db.execute('CREATE TABLE signals (run_id TEXT, code TEXT, day TEXT)')
            db.execute("INSERT INTO signals VALUES('old','225190','2026-11-06')")
            db.executescript(dst.read_text(encoding='utf-8'))
            record=db.execute('SELECT diagnosis_json,chart_json,stats_json FROM blue_symbol_analysis_v1').fetchone()
            self.assertEqual(json.loads(record[0])['asof'],day)
            self.assertEqual(json.loads(record[1])['bars'][-1]['t'],day)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM signals').fetchone()[0],1)
    def test_future_chart_rejected_before_d1_sql(self):
        day='2026-11-06'
        bad={'code':'225190','day':day,'source':'TEST','quality_status':'UNADJUSTED_RESEARCH_ONLY',
          'diagnosis':{'code':'225190','asof':day},
          'chart':{'asof':day,'bars':[{'t':'2026-11-09'}]},'stats':None}
        with self.assertRaisesRegex(ValueError,'Future'):
            statements(bad,'test01')

if __name__=='__main__':unittest.main()
