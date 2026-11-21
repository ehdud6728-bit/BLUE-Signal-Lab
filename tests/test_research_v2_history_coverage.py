import sys
import unittest
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from research_v2_history_coverage import evaluate_candidates


DAY='2026-11-10'
EOD={f'{i:06d}' for i in range(1,2663)}
OLD={f'{i:06d}' for i in range(51,2663)}
MISSING=EOD-OLD


class HistoryCoverageTest(unittest.TestCase):
    def test_all_50_histories_250_bars_can_pass(self):
        data=evaluate_candidates(DAY,OLD,EOD,{code:250 for code in MISSING},
                                 {'2025':'a'*64,'2026':'b'*64})
        self.assertEqual(data['candidate_count'],50)
        self.assertEqual(data['status'],'PASS')
        self.assertTrue(data['all_50_have_250_valid_bars'])

    def test_one_50_candidate_with_249_bars_blocks_all(self):
        bars={code:250 for code in MISSING}
        bars[sorted(MISSING)[0]]=249
        data=evaluate_candidates(DAY,OLD,EOD,bars,{'2025':'a'*64,'2026':'b'*64})
        self.assertEqual(data['min_candidate_bars'],249)
        self.assertEqual(data['status'],'BLOCKED_INSUFFICIENT_HISTORY')
        self.assertFalse(data['all_50_have_250_valid_bars'])

    def test_count_match_with_replaced_ticker_is_not_original_50(self):
        replaced=set(OLD)
        replaced.remove('000051')
        replaced.add('999999')
        with self.assertRaisesRegex(ValueError,'SOURCE_UNIVERSE_CHANGED'):
            evaluate_candidates(DAY,replaced,EOD,{}, {})

    def test_new_source_went_missing_a_fifty_first_ticker(self):
        with self.assertRaisesRegex(ValueError,'SOURCE_UNIVERSE_CHANGED'):
            evaluate_candidates(DAY,OLD-{'000051'},EOD,{}, {})


if __name__=='__main__':
    unittest.main()
