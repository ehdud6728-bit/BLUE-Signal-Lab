import sys, unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import numpy as np, pandas as pd
from market_scan import enrich, scan

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
 def test_historical_no_lookahead(self):
  d=self.fixture().rename(columns=str.lower)
  res=enrich(d)
  alt=d.copy();alt.loc[alt.index[-1],'close']=9999;alt.loc[alt.index[-1],'high']=10000
  res2=enrich(alt)
  self.assertAlmostEqual(res.loc[300,'BB20_UPPER'],res2.loc[300,'BB20_UPPER'])
 def test_market_filter(self):
  d=self.fixture();other=d.copy();other['Code']='123456';other['Market']='KONEX'
  _,a=scan(pd.concat([d,other]));self.assertEqual(a['observed_stocks'],1)

if __name__=='__main__':unittest.main()
