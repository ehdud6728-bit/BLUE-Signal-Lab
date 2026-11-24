import unittest
from test_turso_parallel_pattern_scan import TursoParallelPatternTests
from provisional_pattern_scan import scan_provisional
from corporate_actions import adjust_verified_actions
from market_scan_r08_diagnostics import scan_r08

class ProvisionalTests(unittest.TestCase):
    def test_exact_engine_parity(self):
        raw=TursoParallelPatternTests().fixture()
        target=raw.Date.max()
        day=str(target.date())
        history=raw[raw.Date.lt(target)]
        ref=str(history.Date.max().date())
        now=day+"T15:20:00+09:00"
        quotes=[dict(code=r.Code,day=day,reference_day=ref,observed_at_utc=now,source="KIS_REST_INQUIRE_PRICE_PROVISIONAL",market=r.Market,name=r.Name,open=int(r.Open),high=int(r.High),low=int(r.Low),close=int(r.Close),volume=int(r.Volume),amount=int(r.Amount)) for r in raw[raw.Date.eq(target)].itertuples()]
        adjusted,_=adjust_verified_actions(raw,target.date())
        expected,_=scan_r08(adjusted,day)
        self.assertTrue(expected)
        actual=scan_provisional(history,quotes,day,ref,now)
        self.assertEqual(len(actual["items"]),len(expected))
        for a,b in zip(actual["items"],expected):
            for k in b:
                if k not in ("source","data_frequency","provisional","pattern_confirmed","observed_at_utc"):
                    self.assertEqual(a[k],b[k],k)
        self.assertTrue(all(r["provisional"] and not r["pattern_confirmed"] for r in actual["items"]))
        with self.assertRaises(ValueError):
            scan_provisional(history,quotes+quotes[:1],day,ref,now)
        with self.assertRaises(ValueError):
            scan_provisional(raw,quotes,day,ref,now)
        quotes[0]["observed_at_utc"]=day+"T15:21:00+09:00"
        with self.assertRaises(ValueError):
            scan_provisional(history,quotes,day,ref,now)

if __name__=="__main__": unittest.main()
