import json
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import Mock

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from blue_toss_market_probe import (ProbeError, MockAPI, TossReadOnlyAPI, batches,
   parse_market_items, parse_price_items, probe, is_close_window, KST)

NOW=datetime(2026,11,11,15,0,tzinfo=KST)


class MarketProbeTest(unittest.TestCase):
    def test_batches_max_200(self):
        a=list(batches(list(range(2662))))
        self.assertEqual(len(a),14)
        self.assertTrue(all(len(x)<=200 for x in a))
        self.assertEqual(sum(map(len,a)),2662)
    def test_universe_alphanumeric(self):
        items={"result":[{"symbol":"0101N0","securityType":"STOCK"},
                         {"symbol":"069500","securityType":"ETF"}]}
        got,excluded=parse_market_items(items,"KOSPI")
        self.assertEqual(list(got),["0101N0"])
        self.assertEqual(excluded,1)
    def test_duplicate_rejected(self):
        with self.assertRaisesRegex(ProbeError,"UNIVERSE_DUPLICATE"):
            parse_market_items({"result":[{"symbol":"005930","securityType":"STOCK"}]*2},"KOSPI")
    def test_price_stale_is_not_current(self):
        old=(NOW-timedelta(minutes=5)).isoformat()
        got=parse_price_items({"result":[{"symbol":"005930","lastPrice":"72000","timestamp":old}]},["005930"],NOW,90)
        self.assertEqual(got["005930"]["quality"],"STALE")
    def test_price_missing_is_not_silent(self):
        got=parse_price_items({"result":[]},["005930"],NOW,90)
        self.assertEqual(got,{})
    def test_price_duplicate_rejected(self):
        x={"symbol":"005930","lastPrice":"72000","timestamp":NOW.isoformat()}
        with self.assertRaisesRegex(ProbeError,"DUPLICATE_PRICE_CODE"):
            parse_price_items({"result":[x,x]},["005930"],NOW,90)
    def test_wrong_symbol_rejected(self):
        x={"symbol":"000660","lastPrice":"72000","timestamp":NOW.isoformat()}
        with self.assertRaisesRegex(ProbeError,"UNREQUESTED_PRICE_CODE"):
            parse_price_items({"result":[x]},["005930"],NOW,90)
    def test_invalid_price(self):
        for x in ("0","NaN","-1"):
            with self.subTest(x=x),self.assertRaises(ProbeError):
                parse_price_items({"result":[{"symbol":"005930","lastPrice":x,"timestamp":NOW.isoformat()}]},["005930"],NOW,90)
    def test_close_window(self):
        self.assertTrue(is_close_window(NOW))
        self.assertFalse(is_close_window(datetime(2026,11,11,21,0,tzinfo=KST)))
    def test_mock_report_explicitly_not_live(self):
        with tempfile.TemporaryDirectory() as d:
            x=probe(MockAPI((4,6)),mode="mock",out_dir=Path(d),now_fn=lambda:NOW)
            self.assertEqual(x["status"],"SIMULATION_PASS")
            self.assertEqual(x["requested_universe"],10)
            self.assertEqual(x["quote_count"],10)
            self.assertEqual(x["source"],"SIMULATED")
            self.assertTrue(x["research_only"])
            self.assertFalse(x["d1_written"])
            saved=json.loads((Path(d)/"METADATA.json").read_text())
            self.assertEqual(saved["status"],"SIMULATION_PASS")
    def test_mock_missing_quote_fails_coverage(self):
        class Partial(MockAPI):
            def prices(self,symbols):
                r=super().prices(symbols)
                r.payload["result"]=r.payload["result"][:-1]
                return r
        with tempfile.TemporaryDirectory() as d:
            x=probe(Partial((6,6)),mode="live",out_dir=Path(d),now_fn=lambda:NOW)
            self.assertEqual(x["status"],"LIVE_DATA_INCOMPLETE_OR_STALE")
            self.assertEqual(x["missing_count"],1)
    def test_no_order_api_possible(self):
        client=TossReadOnlyAPI("id","secret",session=Mock(),sleep=lambda _:None)
        with self.assertRaisesRegex(ProbeError,"FORBIDDEN_ENDPOINT"):
            client._call("POST","/api/v1/orders")
    def test_retry_after_429_and_recover(self):
        first=Mock(); first.status_code=429; first.headers={"Retry-After":"1"}
        second=Mock(); second.status_code=200; second.headers={}; second.json.return_value={"result":[]}
        session=Mock(); session.request.side_effect=[first,second]
        sleeps=[]
        api=TossReadOnlyAPI("id","secret",session=session,sleep=sleeps.append,
                             monotonic=lambda:0.0,pace_seconds=0)
        api.token="never-log-token"
        res=api.prices(["005930"])
        self.assertEqual(res.status_code,200)
        self.assertEqual(api.rate_limit_429,1)
        self.assertEqual(api.issued_calls,2)
        self.assertIn(1.0,sleeps)

    def test_403_has_safe_error_code(self):
        fake=Mock(); response=Mock(); response.status_code=403
        response.headers={}; response.text="super-secret-credential"; fake.request.return_value=response
        api=TossReadOnlyAPI("client","secret",session=fake,sleep=lambda _:None,pace_seconds=0)
        api.token="never-log-token"
        with self.assertRaisesRegex(ProbeError,"TOSS_AUTH_OR_IP_DENIED_HTTP_403") as cm:
            api.prices(["005930"])
        self.assertNotIn("super-secret",str(cm.exception))

    def test_auth_headers_redacted_from_metadata(self):
        fake=Mock()
        response=Mock()
        response.status_code=200
        response.headers={}
        response.json.return_value={"access_token":"very-secret-token"}
        fake.request.return_value=response
        a=TossReadOnlyAPI("secret-id","very-secret-client",session=fake,sleep=lambda _:None,pace_seconds=0)
        a.auth()
        self.assertEqual(a.token,"very-secret-token")
        self.assertIn("very-secret-client",fake.request.call_args.kwargs["data"]["client_secret"])
        with tempfile.TemporaryDirectory() as d:
            x=probe(MockAPI((2,2)),mode="mock",out_dir=Path(d),now_fn=lambda:NOW)
            self.assertNotIn("secret",(Path(d)/"METADATA.json").read_text())

if __name__=="__main__":unittest.main()
