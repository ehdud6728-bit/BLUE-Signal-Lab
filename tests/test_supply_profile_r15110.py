"""Independent synthetic-data tests for OHLC-range volume allocation."""
import json
import math
import sys
import unittest
from pathlib import Path

import pandas as pd
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
# Local test also supports running before copying into the BLUE repository.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from supply_profile_r15110 import METHOD, estimate_supply_profile


def frame(bars=121, close=100, low=101, high=102, volume=1000):
    return pd.DataFrame({'low':[low]*(bars-1)+[close-1],
                         'high':[high]*(bars-1)+[close+1],
                         'close':[close]*(bars),
                         'volume':[volume]*(bars)})


class SupplyProfileTests(unittest.TestCase):
    def test_no_arbitrary_strength_on_short_data(self):
        r=estimate_supply_profile(frame(90))
        self.assertEqual('INSUFFICIENT_HISTORY', r['supply_profile_status'])
        self.assertEqual('미확인', r['supply_strength_grade'])
        self.assertEqual('', r['supply_volume_est_shares'])

    def test_known_volume_allocations_and_grade(self):
        f=frame()
        r=estimate_supply_profile(f)
        self.assertEqual('READY',r['supply_profile_status'])
        self.assertEqual('강',r['supply_strength_grade'])
        self.assertEqual(120000,r['supply_volume_total_shares'])
        self.assertAlmostEqual(120000,r['supply_volume_est_shares'],delta=1)
        self.assertAlmostEqual(100,r['supply_bin_share_pct'],places=2)
        self.assertAlmostEqual(100,r['supply_strength_relative_pct'],places=2)
        self.assertEqual(METHOD,r['supply_strength_method'])
        self.assertTrue(json.loads(r['supply_profile_bins_json']))

    def test_exclude_current_day_volume_and_ignore_future_bars(self):
        f=frame(); r=estimate_supply_profile(f)
        f.loc[len(f)-1,'volume']=50000000
        again=estimate_supply_profile(f)
        self.assertEqual(r,again)
        # Historical scan is already sliced to selected date; changes after it
        # must not change previously calculated as-of snapshots.
        later=frame();later.loc[len(later)-1,'volume']=50000000
        self.assertEqual(again,estimate_supply_profile(later))

    def test_no_above_price_marked_missing(self):
        f=frame(close=110,low=99,high=100)
        r=estimate_supply_profile(f)
        self.assertEqual('NO_UPPER_CONCENTRATION',r['supply_profile_status'])
        self.assertEqual('미확인',r['supply_strength_grade'])
        self.assertEqual('',r['supply_reference_price'])

    def test_volume_conservation_for_distributed_candles(self):
        # Synthetic range 101~103 straddles several 1% price bins.
        r=estimate_supply_profile(frame(close=100,low=101,high=103,volume=1000))
        self.assertEqual('READY',r['supply_profile_status'])
        bins=json.loads(r['supply_profile_bins_json'])
        self.assertAlmostEqual(120000,sum(b['volume_shares'] for b in bins),delta=3)


if __name__=='__main__':unittest.main()
