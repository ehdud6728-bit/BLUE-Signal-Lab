import sys,unittest,math,json,sqlite3,tempfile
from unittest.mock import patch
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import pandas as pd
import numpy as np
from market_scan import normalise, enrich
from chart_research_r10 import backtest,chart_rows,generate,_outcomes,_feature_matrix
from append_chart_sql_r10 import append

def fixture(count=455):
    days=pd.bdate_range('2025-01-01',periods=count)
    closes=[100+0.08*i+9*math.sin(i/11)+5*math.sin(i/27) for i in range(count)]
    return pd.DataFrame({'Date':days,'Code':['005930']*count,'Name':['샘플']*count,
       'Open':[v*.997 for v in closes],'High':[v*1.012 for v in closes],
       'Low':[v*.988 for v in closes],'Close':closes,
       'Volume':[1000000+(i%30)*1200 for i in range(count)],
       'Amount':[v*1000000 for v in closes], 'Market':['KOSPI']*count})

class R10(unittest.TestCase):
 def test_no_future_asof(self):
    raw=fixture();asof=str(raw.Date.iloc[-16].date())
    d=normalise(raw)
    x=chart_rows(d,asof);y=backtest(d,asof)
    future=raw.tail(1).copy();future.loc[:,'Date']=raw.Date.iloc[-1]+pd.Timedelta(days=6)
    future.loc[:,'Close']=90000;future.loc[:,'High']=95000;future.loc[:,'Open']=89990;future.loc[:,'Low']=85000
    more=normalise(pd.concat([raw,future],ignore_index=True))
    self.assertEqual(x,chart_rows(more,asof));self.assertEqual(y,backtest(more,asof))
    self.assertEqual(x['bars'][-1]['t'],asof)
    self.assertLessEqual(len(x['bars']),180)
 def test_dynamic_features_not_two_hardcoded_patterns(self):
    d=normalise(fixture());base=enrich(d)
    f,anchors=_feature_matrix(base)
    self.assertIn('BB20',anchors);self.assertIn('MACD_GC',anchors)
    for k in ['VOLUME_SURGE','AMOUNT_SURGE','NEAR_SUPPLY','MA_UP','MACD_POSITIVE','ENV40_DOWN']:
       self.assertIn(k,f)
    self.assertEqual(len(next(iter(f.values()))),len(d))
    # Test automatic construction with an arbitrary anchor + context blend.
    stub={key:np.zeros(len(d),dtype=bool) for key in f}
    for pos in range(270,len(d),17):stub['MACD_GC'][pos]=True
    stub['MACD_GC'][-1]=True
    for k in ['VOLUME_SURGE','MA_UP','RSI_ABOVE50']:
       for pos in range(270,len(d),17):stub[k][pos]=True
       stub[k][-1]=True
    with patch('chart_research_r10._feature_matrix',return_value=(stub,anchors)):
       result=backtest(d,str(d.date.iloc[-1].date()))
    codes=[x['code'] for x in result['setups']]
    self.assertTrue(any('MACD_GC' in x and 'MA_UP' in x for x in codes),codes)
    self.assertGreater(result['candidate_count'],3)
    self.assertTrue(all(x['quality'] in ('EXPLORATORY','INSUFFICIENT_SAMPLE') for x in result['setups']))
 def test_matured_outcomes_only(self):
    d=normalise(fixture(300));a,b,c=_outcomes(d,np.array([275,290,299]),20)
    self.assertEqual(len(a),1);self.assertEqual(len(b),1);self.assertEqual(len(c),1)
    self.assertTrue(np.all(np.isfinite(a)))
 def test_horizons_and_sector_not_fabricated(self):
    d=normalise(fixture());r=backtest(d,str(d.date.iloc[-1].date()))
    self.assertEqual(r['sector_lag']['status'],'NOT_AVAILABLE')
    self.assertIn('baseline',r)
    for s in r['setups']:
        for h in (5,10,20):self.assertLessEqual(s['horizons'][str(h)]['n'],s['total_signals_seen'])
 def test_sql_import_and_run_id(self):
    raw=fixture();asof=str(raw.Date.iloc[-1].date())
    with tempfile.TemporaryDirectory() as td:
      folder=Path(td)
      self.assertEqual(generate(raw,[{'code':'005930'}],asof,str(folder/'chart_snapshots.jsonl')),1)
      (folder/'import.sql').write_text('')
      self.assertEqual(append(folder/'chart_snapshots.jsonl',folder/'import.sql','blue_market_20261109'),1)
      conn=sqlite3.connect(':memory:')
      try:
        conn.executescript((folder/'import.sql').read_text())
        row=conn.execute('SELECT code,chart_json,stats_json FROM chart_snapshots').fetchone()
      finally:conn.close()
      self.assertEqual(row[0],'005930')
      self.assertEqual(json.loads(row[1])['asof'],asof)
      self.assertEqual(json.loads(row[2])['version'],'R10_MULTIFACTOR_V2')
      for stmt in (folder/'import.sql').read_text().split(';'):
        self.assertLess(len(stmt.encode('utf-8')),100000)
if __name__=='__main__':unittest.main()
