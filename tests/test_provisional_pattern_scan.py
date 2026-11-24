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

    def test_missing_reference_isolated_and_missing_turnover_not_invented(self):
        raw=TursoParallelPatternTests().fixture()
        target=raw.Date.max()
        day=str(target.date())
        history=raw[raw.Date.lt(target)]
        ref=str(history.Date.max().date())
        now=day+"T15:20:00+09:00"
        quotes=[dict(code=r.Code,day=day,reference_day=ref,observed_at_utc=now,source="KIS_REST_INQUIRE_DAILY_PRICE_PROVISIONAL",market=r.Market,name=r.Name,open=int(r.Open),high=int(r.High),low=int(r.Low),close=int(r.Close),volume=int(r.Volume),amount=int(r.Amount)) for r in raw[raw.Date.eq(target)].itertuples()]
        baseline=scan_provisional(history,quotes,day,ref,now)
        self.assertTrue(baseline["items"])
        quotes[-1]["amount"]=None
        unknown=dict(quotes[0],code="999999")
        wrong_ref=dict(quotes[1],reference_day="2024-01-01")
        invalid_price=dict(quotes[2],low=0)
        actual=scan_provisional(history,[quotes[0],wrong_ref,invalid_price,quotes[-1],unknown],day,ref,now)
        self.assertEqual(actual["excluded_reference"],2)
        self.assertEqual(actual["excluded_ohlcv"],1)
        self.assertEqual(actual["accepted_quotes"],2)
        self.assertEqual(actual["turnover_missing_quotes"],1)
        self.assertEqual(actual["turnover_available_quotes"],1)
        row=next(r for r in actual["items"] if r["code"]==quotes[-1]["code"])
        self.assertFalse(row["turnover_available"])
        self.assertIsNone(row["traded_amount_krw"])
        self.assertIsNone(row["amount_ratio20"])
        expected=next(r for r in baseline["items"] if r["code"]==row["code"])
        self.assertEqual(row["signals"],expected["signals"])
        self.assertEqual(row["close"],expected["close"])
        empty=scan_provisional(history,[unknown],day,ref,now)
        self.assertEqual(empty["excluded_reference"],1)
        self.assertEqual(empty["items"],[])
        with self.assertRaisesRegex(ValueError,"duplicate quote"):
            scan_provisional(history,[unknown,unknown],day,ref,now)
        with self.assertRaisesRegex(ValueError,"invalid quote day"):
            scan_provisional(history,[dict(quotes[0],day=ref)],day,ref,now)

if __name__=="__main__": unittest.main()
