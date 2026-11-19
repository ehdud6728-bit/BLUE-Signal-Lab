"""Full universe indicators are separate from matched-only research evidence."""
from datetime import date
from pathlib import Path
from tempfile import TemporaryDirectory
import hashlib
import json
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from export_turso_indicator_snapshot import export_indicator_snapshot


class FullMarketIndicatorExportTests(unittest.TestCase):
    def fixture(self):
        rows = []
        for n in range(1700):
            rows.append({
                'trade_day': '2026-11-19', 'code': f'{n:06d}',
                'market': 'KOSPI' if n < 850 else 'KOSDAQ',
                'close_price': 10000 + n, 'history_bars': 260,
                'indicators': {'ma20': 9999, 'rsi': 55.5},
                'crosses': {'rsi_gc': False},
                'eligibility': 'ELIGIBLE',
                'signal_names': ['BB20'] if n == 12 else [],
            })
        audit = {
            'asof': '2026-11-19', 'intraday_verified': False,
            'data_phase': 'HISTORICAL_EOD', 'target_day_source': 'KRX pykrx verified daily',
            'observed_stocks': 1700, 'matched_stocks': 1,
            'source_sha256_by_year': {'2026': 'abc'},
            'source_verified_at_kst': '2026-11-19T22:00:00+09:00',
        }
        return rows, audit

    def test_exports_all_1700_not_only_matching_one(self):
        rows, audit = self.fixture()
        with TemporaryDirectory() as temp:
            manifest = export_indicator_snapshot(rows, audit, temp)
            data = (Path(temp) / 'records.jsonl').read_bytes()
            self.assertEqual(manifest['row_count'], 1700)
            self.assertEqual(manifest['matched_stocks'], 1)
            self.assertEqual(hashlib.sha256(data).hexdigest(), manifest['payload_sha256'])
            self.assertEqual(len(data.splitlines()), 1700)
            self.assertEqual(json.loads(data.splitlines()[0])['signal_names'], [])
            self.assertEqual(json.loads(data.splitlines()[12])['signal_names'], ['BB20'])

    def test_timestamp_only_change_does_not_make_source_conflict(self):
        rows, audit = self.fixture()
        with TemporaryDirectory() as temp:
            original = export_indicator_snapshot(rows, audit, temp)
            audit['source_verified_at_kst'] = '2026-11-19T23:00:00+09:00'
            repeat = export_indicator_snapshot(rows, audit, temp)
            self.assertEqual(original, repeat)

    def test_invalid_source_and_incomplete_market_fail_closed(self):
        rows, audit = self.fixture()
        with TemporaryDirectory() as temp:
            with self.assertRaisesRegex(ValueError, 'INDICATOR_AUDIT'):
                export_indicator_snapshot(rows[:-1], audit, temp)
            audit['target_day_source'] = 'FinanceData/marcap daily'
            with self.assertRaisesRegex(ValueError, 'INDICATOR_AUDIT'):
                export_indicator_snapshot(rows, audit, temp)

    def test_bad_code_or_nonfinite_data_fails_before_file_creation(self):
        rows, audit = self.fixture()
        with TemporaryDirectory() as temp:
            rows[0]['indicators']['rsi'] = float('nan')
            with self.assertRaises(ValueError):
                export_indicator_snapshot(rows, audit, temp)


if __name__ == '__main__':
    unittest.main()
