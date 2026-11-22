import unittest

import numpy as np
import pandas as pd

from scripts.blue_dot_2026_research import STAGES, build_blue_signals
from scripts.market_scan import enrich, normalise
from tests.test_env20_rebound_comparison import fixture


class BlueDot2026Test(unittest.TestCase):
    def test_shifted_bb_lines_and_strict_signals_match_existing_scanner(self):
        raw, _ = fixture()
        d, dates = build_blue_signals(raw)
        self.assertEqual(len(dates), 280)
        reference = normalise(raw)
        for code in ('000001', '000002'):
            src = enrich(reference[reference.code == code].copy())
            actual = d[d.code == code].reset_index(drop=True)
            for n in (20, 30):
                for kind in ('UPPER', 'LOWER'):
                    line = f'BB{n}_{kind}'
                    np.testing.assert_allclose(
                        actual[f'{line}_SHIFT26'], src[line],
                        equal_nan=True, rtol=1e-12, atol=1e-10)
                self.assertEqual(
                    actual[f'U{n}'].iloc[249:].tolist(),
                    src[f'BB{n}_UPPER_SIGNAL'].iloc[249:].tolist())
                self.assertTrue((~actual[f'U{n}'] | actual[f'G{n}']).all())

    def test_two_shifted_upper_lines_are_not_env20_proxy(self):
        raw, _ = fixture()
        d, _ = build_blue_signals(raw)
        self.assertEqual(set(STAGES),
                         {'U20', 'U30', 'G20', 'G30', 'L20', 'L30', 'D'})
        self.assertTrue((d.D == (d.U20 & d.U30)).all())
        self.assertTrue(pd.isna(d.BB20_UPPER_SHIFT26.iloc[0]))
        self.assertTrue(pd.isna(d.BB30_UPPER_SHIFT26.iloc[0]))


if __name__ == '__main__':
    unittest.main()
