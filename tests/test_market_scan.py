import sys, unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import numpy as np, pandas as pd
from market_scan import body_cross, enrich, scan

class MarketScanTest(unittest.TestCase):
 def fixture(self):
  dates=pd.bdate_range('2025-01-01',periods=320)
  close=np.linspace(200,130,320)
  # Gradually descending bands, with last bar crossing historical prior upper.
  d=pd.DataFrame({'Date':dates,'Code':'005930','Open':close*.997,'High':close*1.02,'Low':close*.98,'Close':close,'Volume':10000,'Amount':100000000,'Market':'KOSPI'})
  return d
 def test_signal_future_invariance(self):
  d=self.fixture();d2=d.copy();last=d.Date.max()
  extra=d.iloc[-1:].copy();extra['Date']=last+pd.Timedelta(days=3);extra['Close']=999999;extra['Open']=900000;extra['High']=1000000;extra['Low']=800000
  a,x=scan(d,last.date().isoformat());b,y=scan(pd.concat([d2,extra],ignore_index=True),last.date().isoformat())
  self.assertEqual(a,b);self.assertEqual(x['matched_stocks'],y['matched_stocks'])
 def test_missing_date_rejected(self):
  with self.assertRaisesRegex(ValueError,'not present'):
   scan(self.fixture(),'2025-01-04')
 def test_indicators_exist(self):
  d=self.fixture().rename(columns=str.lower)
  res=enrich(d)
  for k in ('BB20_UPPER','BB30_UPPER','BB40_UPPER','ENV20_MID','ENV40_MID','slow_14_3_3_gc','slow_12_5_5_gc','slow_20_12_12_gc','prior_high_224'):
   self.assertIn(k,res)
  self.assertIn('BB30_LOWER_RECLAIM_SIGNAL',res)
  self.assertFalse(bool((res['BB30_LOWER_RECLAIM_SIGNAL'] & res['BB30_LOWER_SIGNAL']).any()))
 def test_full_market_indicator_sink_keeps_nonmatching_symbols(self):
  data=self.fixture()
  another=data.copy()
  another['Code']='000660'
  another['Close']=200.
  another['Open']=199.
  another['High']=204.
  another['Low']=195.
  sink=[]
  combined=pd.concat([data,another],ignore_index=True)
  matches,audit=scan(combined,
                     str(data.Date.iloc[-1].date()),indicator_sink=sink)
  baseline,baseline_audit=scan(combined,str(data.Date.iloc[-1].date()))
  self.assertEqual(matches,baseline)
  self.assertEqual(audit,baseline_audit)
  self.assertEqual(audit['observed_stocks'],2)
  self.assertEqual(len(sink),2)
  self.assertEqual({x['code'] for x in sink},{'005930','000660'})
  self.assertTrue(any(x['signal_names']==[] for x in sink))
  self.assertTrue(all('rsi' in x['indicators'] and 'BB20_UPPER' in x['indicators']
                      for x in sink))
 def test_rising_lower_line_reclaim_distinct_from_falling_signal(self):
  # Recreates HMM's 2026-11-12 lower-line geometry, with no future bars.
  d=pd.DataFrame({'open':[20000,20050],'close':[20100,20700]})
  line=pd.Series([20197.063052,20202.115899])
  self.assertTrue(bool(body_cross(d,line,False).iloc[-1]))
  self.assertFalse(bool(body_cross(d,line,True).iloc[-1]))
 def test_historical_no_lookahead(self):
  d=self.fixture().rename(columns=str.lower)
  res=enrich(d)
  alt=d.copy();alt.loc[alt.index[-1],'close']=9999;alt.loc[alt.index[-1],'high']=10000
  res2=enrich(alt)
  self.assertAlmostEqual(res.loc[300,'BB20_UPPER'],res2.loc[300,'BB20_UPPER'])
 def test_market_filter(self):
  d=self.fixture();other=d.copy();other['Code']='123456';other['Market']='KONEX'
  _,a=scan(pd.concat([d,other]));self.assertEqual(a['observed_stocks'],1)
 def test_env20_lower_20_percent_first_touch_is_distinct_from_midline_reclaim(self):
  # Envelope(20,20%) lower-touch research: first real daily candle crossing
  # the lower line, even though it did not finish as a bullish midline cross.
  dates=pd.bdate_range('2025-01-01',periods=280)
  d=pd.DataFrame({'Date':dates,'Code':'225190','Open':100.,'High':102.,
                  'Low':85.,'Close':100.,'Volume':10000,'Amount':100000000,
                  'Market':'KOSDAQ'})
  d.loc[d.index[-1],['Open','High','Low','Close']]=[98.,100.,79.,95.]
  day=str(d.Date.iloc[-1].date())
  matches,_=scan(d,day)
  self.assertEqual([r['code'] for r in matches],['225190'])
  self.assertIn('ENV20_LOWER_TOUCH',matches[0]['signals'].split(','))
  self.assertNotIn('ENV20',matches[0]['signals'].split(','))
  enriched=enrich(d.rename(columns=str.lower))
  self.assertAlmostEqual(float(enriched.iloc[-1].ENV20_LOWER_20PCT),79.8,places=3)
  next_row=d.iloc[-1:].copy()
  next_row['Date']=dates[-1]+pd.Timedelta(days=1)
  next_row.loc[:,['Open','High','Low','Close']]=[95.,100.,79.,96.]
  extended=pd.concat([d,next_row],ignore_index=True)
  later=enrich(extended.rename(columns=str.lower))
  self.assertFalse(bool(later.iloc[-1].ENV20_LOWER_TOUCH_SIGNAL))

if __name__=='__main__':unittest.main()
