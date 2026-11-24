import unittest
from tempfile import TemporaryDirectory
from pathlib import Path
import json
from pattern_performance_archive import stage

class ArchiveTest(unittest.TestCase):
    def test_archive(self):
        with TemporaryDirectory() as tmp:
            root=Path(tmp)
            a=dict(asof="2026-11-20",audited_sessions=28,rows={"ENV20":[[3,30,5,70,1,1]]},recommendations=[])
            b={**a,"asof":"2026-11-23"}
            self.assertTrue(stage(a,root))
            self.assertTrue(stage(b,root))
            self.assertFalse(stage(a,root))
            self.assertFalse(stage(b,root))
            self.assertEqual(json.loads((root/"latest.json").read_text()),b)
            self.assertEqual(json.loads((root/"2026-11-20.json").read_text()),a)
            self.assertEqual(json.loads((root/"changes.json").read_text())["previous_asof"],a["asof"])
if __name__=="__main__":
    unittest.main()
