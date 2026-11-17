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
from market_scan_r11 import build_symbol_snapshot, build_symbol_directory
from append_symbol_analysis_sql import (statements, write_sql, directory_statements,
                                        append_directory_only)


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

    def test_stock_names_are_asof_only_and_published_without_touching_signals(self):
        day='2026-11-06'
        items=pd.DataFrame({
          'Date':[day]*1350+['2026-11-09'],
          'Code':[f'{n:06d}' for n in range(1350)]+['001349'],
          'Name':['LK삼양' if n==1 else f'기업{n}' for n in range(1350)]+['미래이름'],
          'Market':['KOSDAQ']*1351})
        directory=build_symbol_directory(items,day)
        self.assertEqual(len(directory['symbols']),1350)
        self.assertEqual(directory['symbols'][1]['name'],'LK삼양')
        self.assertEqual(directory['symbols'][-1]['name'],'기업1349')
        sql=directory_statements(directory)
        self.assertLess(len(sql),60)
        db=sqlite3.connect(':memory:')
        db.execute('CREATE TABLE signals (code TEXT,name TEXT)')
        db.execute("INSERT INTO signals VALUES('000001','기존 데이터')")
        from append_symbol_analysis_sql import SCHEMA
        db.executescript(SCHEMA+'\n'+'\n'.join(sql))
        self.assertEqual(db.execute('SELECT COUNT(*) FROM blue_symbol_directory_v1').fetchone()[0],1350)
        self.assertEqual(db.execute("SELECT name FROM signals WHERE code='000001'").fetchone()[0],'기존 데이터')
        later={**directory,'asof':'2026-11-05','symbols':[
          {**item,'name':'이전이름'} for item in directory['symbols']]}
        db.executescript('\n'.join(directory_statements(later)))
        self.assertEqual(db.execute("SELECT name FROM blue_symbol_directory_v1 WHERE code='000001'").fetchone()[0],'LK삼양')

    def test_directory_validation_rejects_duplicate_stock_codes(self):
        same={'code':'225190','name':'LK삼양','market':'KOSDAQ'}
        with self.assertRaisesRegex(ValueError,'duplicate'):
            directory_statements({'asof':'2026-11-06','symbols':[same]*1300})

    def test_daily_directory_refresh_is_additive_and_preserves_older_names(self):
        with tempfile.TemporaryDirectory() as folder:
            sql=Path(folder)/'verified_eod.sql'
            index=Path(folder)/'names.json'
            sql.write_text('CREATE TABLE daily_audit (day TEXT);\n'
                           "INSERT INTO daily_audit VALUES('2026-11-17');\n",encoding='utf-8')
            directory={'asof':'2026-11-17','symbols':[
                {'code':f'{n:06d}','name':f'종목{n}', 'market':'KOSPI'}
                for n in range(1300)]}
            index.write_text(json.dumps(directory,ensure_ascii=False),encoding='utf-8')
            self.assertGreater(append_directory_only(str(index),str(sql)),40)
            db=sqlite3.connect(':memory:')
            db.executescript(sql.read_text(encoding='utf-8'))
            self.assertEqual(db.execute('SELECT COUNT(*) FROM blue_symbol_directory_v1').fetchone()[0],1300)
            self.assertEqual(db.execute('SELECT day FROM daily_audit').fetchone()[0],'2026-11-17')
            self.assertEqual(db.execute("SELECT name FROM blue_symbol_directory_v1 WHERE code='000002'").fetchone()[0], '종목2')
            with self.assertRaisesRegex(ValueError, 'must exist'):
                append_directory_only(str(index),str(Path(folder)/'missing.sql'))

if __name__=='__main__':unittest.main()
