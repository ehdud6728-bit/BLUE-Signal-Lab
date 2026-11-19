import csv
import json
from pathlib import Path
import tempfile
import unittest

from scripts.export_turso_signal_snapshot import export_snapshot


class ExportDualDbSignalSnapshotTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.src = Path(self.temp.name) / 'source'
        self.dst = Path(self.temp.name) / 'turso'
        self.src.mkdir()
        self.day = '2026-11-18'
        self.audit = dict(asof=self.day, observed_stocks=1800, eligible_stocks=1790,
            matched_stocks=2, signal_events=3, intraday_verified=False,
            same_day_eod=False, data_phase='HISTORICAL_EOD',
            target_day_source='KRX_PYKRX_EXACT_DAY_VERIFIED',
            source_sha256_by_year={'2026': 'a' * 64})
        self._save_audit()
        with (self.src / 'signals.csv').open('w', encoding='utf-8', newline='') as f:
            w = csv.DictWriter(f, fieldnames=['code', 'date', 'signals', 'close',
                'distance_to_nearest_supply_pct', 'ma224_cross', 'amount_ratio20'])
            w.writeheader()
            w.writerow(dict(code='005930', date=self.day, signals='BB20,ENV20',
                close='194700', ma224_cross='True', amount_ratio20='1.5'))
            w.writerow(dict(code='000660', date=self.day, signals='BB40',
                close='1144000', ma224_cross='False', amount_ratio20='2.0'))
        self.charts = [dict(code=code, day=self.day,
            chart=dict(version='R10_CHART_V1', asof=self.day,
                bars=[dict(t=self.day, c=close, h=close+1000, l=close-1000)]),
            stats=dict(setups=[])) for code, close in [('005930', 194700), ('000660', 1144000)]]
        self._save_charts()

    def _save_audit(self):
        (self.src / 'AUDIT.json').write_text(json.dumps(self.audit), encoding='utf-8')

    def _save_charts(self):
        (self.src / 'chart_snapshots.jsonl').write_text(
            ''.join(json.dumps(r) + '\n' for r in self.charts), encoding='utf-8')

    def test_export_contains_exact_d1_research_fields_and_provenance(self):
        manifest = export_snapshot(self.src, self.dst)
        self.assertEqual(manifest['matched_stocks'], 2)
        self.assertEqual(manifest['signal_events'], 3)
        self.assertEqual(manifest['run_id'], 'blue_market_20261118')
        rows = [json.loads(x) for x in (self.dst / 'records.jsonl').read_text().splitlines()]
        self.assertEqual([r['code'] for r in rows], ['000660', '005930'])
        self.assertEqual(rows[1]['signal_names'], 'BB20,ENV20')
        self.assertEqual(rows[1]['extras']['ma224_cross'], 'True')
        self.assertEqual(rows[1]['close_price'], 194700)
        self.assertEqual(rows[1]['chart']['asof'], self.day)
        self.assertEqual(rows[1]['stats']['setups'], [])
        self.assertEqual(manifest, export_snapshot(self.src, self.dst))

    def test_reverification_timestamp_does_not_invalidate_same_source(self):
        self.audit['source_verified_at_kst'] = '2026-11-18T19:00:00+09:00'
        self._save_audit()
        first = export_snapshot(self.src, self.dst)
        self.audit['source_verified_at_kst'] = '2026-11-19T10:00:00+09:00'
        self._save_audit()
        second = export_snapshot(self.src, self.dst)
        self.assertEqual(first['source_audit_sha256'], second['source_audit_sha256'])
        self.assertEqual(first['payload_sha256'], second['payload_sha256'])

    def test_change_in_stable_market_audit_is_not_ignored(self):
        first = export_snapshot(self.src, self.dst)
        self.audit['source_sha256_by_year'] = {'2026': 'b'*64}
        self._save_audit()
        second = export_snapshot(self.src, self.dst)
        self.assertNotEqual(first['source_audit_sha256'], second['source_audit_sha256'])

    def test_rejects_audit_mismatch(self):
        self.audit['matched_stocks'] = 3
        self._save_audit()
        with self.assertRaisesRegex(ValueError, 'SIGNAL_AUDIT_COUNT_MISMATCH'):
            export_snapshot(self.src, self.dst)

    def test_rejects_missing_or_future_chart_evidence(self):
        self.charts[0]['chart']['bars'][-1]['t'] = '2026-11-19'
        self._save_charts()
        with self.assertRaisesRegex(ValueError, 'INVALID_SIGNAL_CHART_EVIDENCE'):
            export_snapshot(self.src, self.dst)

    def test_rejects_same_day_without_verified_krx(self):
        self.audit['same_day_eod'] = True
        self.audit['data_phase'] = 'SAME_DAY_EOD_VERIFIED'
        self.audit['target_day_source'] = 'FinanceData/marcap daily'
        self._save_audit()
        with self.assertRaisesRegex(ValueError, 'UNVERIFIED_SAME_DAY_SIGNAL_AUDIT'):
            export_snapshot(self.src, self.dst)


if __name__ == '__main__':
    unittest.main()
