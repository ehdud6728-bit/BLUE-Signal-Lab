"""Offline parity checks for reusing the already audited KRX EOD range."""
from datetime import date, datetime, timezone
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from market_scan_r11 import merge_verified_days
from turso_history_replay_source import load_verified_day
from turso_verified_eod_range import build_range


DAY = date(2026, 11, 9)
SOURCE = 'KRX_PYKRX_EXACT_DAY_VERIFIED'


def day_frame(day):
    return pd.DataFrame([{
        'Date': pd.Timestamp(day), 'Code': f'{n:06d}',
        'Market': 'KOSPI' if n < 850 else 'KOSDAQ', 'Name': '',
        'Open': 100, 'High': 110, 'Low': 90, 'Close': 105,
        'Volume': 1000, 'Amount': 105000,
    } for n in range(1700)])


class HistoryReplaySourceTest(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.manifest, self.payload = build_range(
            DAY, date(2026, 11, 10),
            datetime(2026, 11, 20, 3, tzinfo=timezone.utc),
            'pykrx', '', lambda day, provider, key: (day_frame(day), SOURCE))
        self.write_fixture()

    def write_fixture(self):
        (self.root / 'manifest.json').write_text(json.dumps(self.manifest), encoding='utf-8')
        (self.root / 'daily.jsonl').write_bytes(self.payload)

    def test_reuses_exact_krx_day_without_provider_calls_and_replaces_only_target(self):
        audited, source = load_verified_day(self.root, DAY)
        self.assertEqual(len(audited), 1700)
        self.assertEqual(source, SOURCE)
        self.assertEqual(audited.loc[0, 'Close'], 105)
        older = day_frame(date(2026, 11, 6))
        older['Name'] = 'Known historical name'
        stale = day_frame(DAY).iloc[:1650].copy()
        stale['Close'] = 50
        baseline = pd.concat([older, stale], ignore_index=True)
        replaced = merge_verified_days(baseline, DAY, [audited], [DAY.isoformat()])
        self.assertEqual(len(replaced[replaced.Date.dt.date.eq(DAY)]), 1700)
        self.assertEqual(len(replaced[replaced.Date.dt.date.eq(date(2026, 11, 6))]), 1700)
        self.assertTrue(replaced.loc[replaced.Date.dt.date.eq(DAY), 'Close'].eq(105).all())
        self.assertEqual(replaced.loc[replaced.Code.eq('000000') & replaced.Date.dt.date.eq(DAY),
                                  'Name'].iloc[0], 'Known historical name')

    def test_selects_the_requested_day_not_other_audited_day(self):
        other, _ = load_verified_day(self.root, date(2026, 11, 10))
        self.assertEqual(set(other.Date.dt.date), {date(2026, 11, 10)})
        with self.assertRaisesRegex(ValueError, 'DATE_NOT_VERIFIED'):
            load_verified_day(self.root, date(2026, 11, 11))

    def test_rejects_modified_price_even_when_manifest_day_remains_unchanged(self):
        self.payload = self.payload.replace(b'"close":"105"', b'"close":"106"', 1)
        self.write_fixture()
        with self.assertRaisesRegex(ValueError, 'SOURCE_INVALID'):
            load_verified_day(self.root, DAY)

    def test_rejects_untrusted_source_and_missing_day_rows(self):
        self.manifest['days'][0]['source'] = 'FinanceData/marcap daily'
        self.write_fixture()
        with self.assertRaisesRegex(ValueError, 'DAY_AUDIT_INVALID'):
            load_verified_day(self.root, DAY)
        self.manifest['days'][0]['source'] = SOURCE
        self.manifest['days'][0]['rows'] = 1650
        self.write_fixture()
        with self.assertRaisesRegex(ValueError, 'DAY_AUDIT_INVALID'):
            load_verified_day(self.root, DAY)


if __name__ == '__main__':
    unittest.main()
