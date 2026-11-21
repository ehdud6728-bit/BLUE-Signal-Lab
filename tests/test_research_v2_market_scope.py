import sys
import unittest
from datetime import date
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))

from market_scan import normalise
from research_v2_market_scope import GLOBAL_CODES, SCOPE, project_v2_market
from research_v2_targeted_history import EXACT_MARCAP_HASHES
from research_v2_history_coverage import measure_coverage


DAY = date(2026, 11, 10)


def row(code, day, market):
    return {'Date': pd.Timestamp(day), 'Code': code, 'Name': '', 'Market': market,
            'Open': 100, 'High': 110, 'Low': 95, 'Close': 102,
            'Volume': 1000, 'Amount': 100000}


def frames():
    # The real pinned parquet shows 50 GLOBAL members on the target day;
    # the old research filter lost their whole valid historical series.
    days = pd.bdate_range(end=DAY, periods=250)
    raw = pd.DataFrame([row(code, stamp, 'KOSDAQ GLOBAL')
                        for code in sorted(GLOBAL_CODES) for stamp in days])
    raw = pd.concat([raw, pd.DataFrame([row('005930', DAY, 'KOSPI')])], ignore_index=True)
    verified = pd.DataFrame([row(code, DAY, 'KOSDAQ') for code in sorted(GLOBAL_CODES)] +
                            [row('005930', DAY, 'KOSPI')])
    return raw, verified


class ResearchV2MarketScopeTest(unittest.TestCase):
    def test_50_global_members_are_not_missing_and_prices_are_unchanged(self):
        raw, verified = frames()
        self.assertEqual(len(GLOBAL_CODES), 50)
        self.assertEqual(len(normalise(raw)), 1)  # legacy behavior unchanged
        result, proof = project_v2_market(raw, verified, DAY, EXACT_MARCAP_HASHES)
        self.assertEqual(len(normalise(result)), 50 * 250 + 1)
        self.assertEqual(proof['research_market_scope'], SCOPE)
        self.assertEqual(proof['market_scope_code_count'], 50)
        self.assertEqual(proof['market_scope_reclassified_rows'], 50 * 250)
        self.assertEqual(result['Close'].tolist(), raw['Close'].tolist())
        self.assertEqual(result['Date'].tolist(), raw['Date'].tolist())
        self.assertEqual(raw.iloc[0]['Market'], 'KOSDAQ GLOBAL')
        self.assertEqual(result.iloc[-1]['Market'], 'KOSPI')

    def test_exact_sources_and_krx_membership_are_required(self):
        raw, verified = frames()
        with self.assertRaisesRegex(ValueError, 'SOURCE_OR_DAY_CHANGED'):
            project_v2_market(raw, verified, DAY, {'2025': 'bad', '2026': 'bad'})
        tampered = verified.copy()
        tampered.loc[tampered.Code.eq(sorted(GLOBAL_CODES)[0]), 'Market'] = 'KONEX'
        with self.assertRaisesRegex(ValueError, 'KRX_MARKET_MISMATCH'):
            project_v2_market(raw, tampered, DAY, EXACT_MARCAP_HASHES)
        truncated = raw.loc[~raw.Code.eq(sorted(GLOBAL_CODES)[0])]
        with self.assertRaisesRegex(ValueError, 'SOURCE_UNIVERSE_CHANGED'):
            project_v2_market(truncated, verified, DAY, EXACT_MARCAP_HASHES)

    def test_coverage_recovered_from_source_without_kis_collection(self):
        raw, verified = frames()
        # 1,700 other original source symbols + 50 Global tickers in KRX EOD.
        other = [row(f'{i:06d}', DAY, 'KOSPI') for i in range(700000, 701699)]
        raw = pd.concat([raw, pd.DataFrame(other)], ignore_index=True)
        verified = pd.concat([verified, pd.DataFrame(other)], ignore_index=True)
        report = measure_coverage(raw, verified, DAY, EXACT_MARCAP_HASHES,
                                  research_v2_global_scope=True)
        self.assertEqual(report['status'], 'PASS')
        self.assertEqual(report['candidate_count'], 50)
        self.assertEqual(report['min_candidate_bars'], 250)
        self.assertEqual(report['research_market_scope'], SCOPE)
        self.assertNotIn('targeted_history_sha256', report)
        # The original research code still excludes these historical markets.
        self.assertEqual(len(normalise(raw)), 1700)


if __name__ == '__main__':
    unittest.main()
