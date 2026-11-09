import sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import pandas as pd
from market_scan_r06 import scan_r06,nearest_upper_supply

class R06Tests(unittest.TestCase):
 def test_name_and_future_invariance(self):
  d=pd.DataFrame({'Date':pd.bdate_range('2025-01-01',periods=270),'Code':'005930','Name':'샘플','Open':90.,'High':110.,'Low':80.,'Close':100.,'Volume':1000,'Amount':100000,'Market':'KOSPI'})
  day=d.Date.iloc[-1].strftime('%Y-%m-%d')
  a,aa=scan_r06(d,day)
  later=d.tail(1).copy();later['Date']=d.Date.iloc[-1]+pd.Timedelta(days=4);later['Close']=1000;later['High']=1100
  b,bb=scan_r06(pd.concat([d,later],ignore_index=True),day)
  self.assertEqual(a,b)
  self.assertEqual(aa['matched_stocks'],bb['matched_stocks'])
 def test_no_prior_history(self):
  d=pd.DataFrame({'date':[pd.Timestamp('2026-11-05')],'high':[110],'low':[90],'close':[100],'volume':[10]})
  self.assertIsNone(nearest_upper_supply(d,pd.Timestamp('2026-11-05')))
if __name__=='__main__':unittest.main()
