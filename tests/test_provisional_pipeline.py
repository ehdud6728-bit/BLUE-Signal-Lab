import json,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import pandas as pd
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from provisional_pipeline import run
class PipelineTests(unittest.TestCase):
    def test_reference_gate_and_metadata(self):
        with tempfile.TemporaryDirectory() as tmp:
            h=Path(tmp)/"history.csv"; q=Path(tmp)/"quotes"; out=Path(tmp)/"result.json"
            pd.DataFrame({"Code":["000001"]}).to_csv(h,index=False)
            Path(str(h)+".meta.json").write_text(json.dumps({"reference":"2026-11-23"}))
            Path(str(q)+".meta.json").write_text(json.dumps({"reference":"2026-11-22"}))
            Path(str(q)+".quotes.json").write_text('[{"code":"000001"}]')
            with self.assertRaisesRegex(ValueError,"REFERENCE_MISMATCH"):
                run(h,q,"2026-11-24","2026-11-24T15:00:00+09:00",out)
            Path(str(q)+".meta.json").write_text(json.dumps({"reference":"2026-11-23"}))
            with patch("provisional_pipeline.scan_provisional",return_value={"items":[]}) as scan:
                result=run(h,q,"2026-11-24","2026-11-24T15:00:00+09:00",out)
                self.assertEqual(scan.call_args.args[0].Code.iloc[0],"000001")
                self.assertFalse(result["pattern_confirmed"])
                self.assertEqual(json.loads(out.read_text()),result)

    def test_real_csv_pipeline_with_registered_corporate_action(self):
        # Match the live workflow: CSV history is read as strings while the
        # current KIS candle is a Timestamp. Include an active action registry
        # entry (225190) and dates both before and after its first session.
        from test_turso_parallel_pattern_scan import TursoParallelPatternTests
        from provisional_pattern_scan import scan_provisional
        raw=TursoParallelPatternTests().fixture()
        target=pd.Timestamp("2026-11-24")
        raw["Date"]=raw.Date+(target-raw.Date.max())
        day=str(target.date())
        history=raw[raw.Date.lt(target)].copy()
        ref=str(history.Date.max().date())
        now=day+"T20:50:00+09:00"
        quotes=[dict(code=r.Code,day=day,reference_day=ref,
                     observed_at_utc=now,source="KIS_REST_INQUIRE_DAILY_PRICE_PROVISIONAL",
                     market=r.Market,name=r.Name,open=int(r.Open),high=int(r.High),
                     low=int(r.Low),close=int(r.Close),volume=int(r.Volume),
                     amount=None if r.Code=="225190" else int(r.Amount))
                for r in raw[raw.Date.eq(target)].itertuples()]
        expected=scan_provisional(history,quotes,day,ref,now)
        self.assertTrue(expected["items"])
        with tempfile.TemporaryDirectory() as tmp:
            h=Path(tmp)/"history.csv"; q=Path(tmp)/"quotes"; out=Path(tmp)/"result.json"
            history.to_csv(h,index=False)
            meta={"reference":ref}
            Path(str(h)+".meta.json").write_text(json.dumps(meta))
            Path(str(q)+".meta.json").write_text(json.dumps(meta))
            Path(str(q)+".quotes.json").write_text(json.dumps(quotes))
            self.assertIsInstance(pd.read_csv(h,dtype={"Code":str}).Date.iloc[0],str)
            result=run(h,q,day,now,out)
            self.assertEqual(result["items"],expected["items"])
            self.assertEqual(result["audit"],expected["audit"])
            self.assertEqual(result["accepted_quotes"],4)
            self.assertEqual(result["turnover_missing_quotes"],1)
            row=next(r for r in result["items"] if r["code"]=="225190")
            self.assertIsNone(row["traded_amount_krw"])
            self.assertFalse(row["pattern_confirmed"])
            self.assertEqual(json.loads(out.read_text()),result)
