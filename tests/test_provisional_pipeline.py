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
