"""Offline parity proof for bounded 500-symbol process-parallel pattern research."""
import sys
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from market_scan_r08_diagnostics import scan_r08
from turso_parallel_pattern_scan import partition_codes, scan_r08_parallel


class TursoParallelPatternTests(unittest.TestCase):
    def fixture(self):
        days = pd.bdate_range('2025-01-01', periods=260)
        frames = []
        for n, code in enumerate(['000660', '005930', '086520', '225190']):
            close = np.full(len(days), 100. + n)
            data = pd.DataFrame({'Date': days, 'Code': code, 'Name': f'Stock {code}',
                                 'Open': close, 'High': close + 2, 'Low': close - 2,
                                 'Close': close, 'Volume': 10000 + n * 100,
                                 'Amount': 100000000 + n * 10000,
                                 'Market': 'KOSPI' if n < 2 else 'KOSDAQ'})
            if code == '225190':
                data.loc[data.index[-1], ['Open', 'High', 'Low', 'Close']] = [98., 100., 79., 95.]
            frames.append(data)
        return pd.concat(frames, ignore_index=True)

    def test_parallel_full_payload_and_indicators_are_identical_to_serial(self):
        frame = self.fixture()
        date = str(frame.Date.max().date())
        sequential = []
        baseline, audit = scan_r08(frame, date, indicator_sink=sequential)
        parallel = []
        observed, checked = scan_r08_parallel(frame, date, workers=2,
                                             chunk_size=2, indicator_sink=parallel)
        self.assertEqual(observed, baseline)
        self.assertEqual(checked, audit)
        self.assertEqual(parallel, sequential)
        self.assertEqual([row['code'] for row in observed], ['225190'])
        self.assertEqual([row['code'] for row in parallel],
                         ['000660', '005930', '086520', '225190'])

    def test_parallel_preserves_original_future_day_audit_with_no_lookahead(self):
        raw = self.fixture()
        target = str(raw.Date.max().date())
        extra = raw.loc[raw.Code.eq('005930')].iloc[-1:].copy()
        extra['Date'] = raw.Date.max() + pd.Timedelta(days=3)
        extra[['Open', 'High', 'Low', 'Close']] = [900., 1000., 800., 950.]
        source = pd.concat([raw, extra], ignore_index=True)
        baseline, audit = scan_r08(source, target)
        parallel, checked = scan_r08_parallel(source, target, workers=2, chunk_size=2)
        self.assertEqual(parallel, baseline)
        self.assertEqual(checked, audit)
        self.assertNotEqual(checked['source_latest_date'], target)

    def test_one_worker_is_the_unchanged_serial_rollback(self):
        raw = self.fixture()
        target = str(raw.Date.max().date())
        indicators = []
        baseline_indicators = []
        baseline = scan_r08(raw, target, indicator_sink=baseline_indicators)
        rollback = scan_r08_parallel(raw, target, workers=1,
                                     indicator_sink=indicators)
        self.assertEqual(rollback, baseline)
        self.assertEqual(indicators, baseline_indicators)

    def test_500_symbol_chunks_do_not_skip_or_repeat_a_code(self):
        raw = pd.DataFrame({'Date': pd.Timestamp('2026-11-19'),
                            'Code': [f'{n:06d}' for n in range(1001)],
                            'Open': 100, 'High': 105, 'Low': 95, 'Close': 100,
                            'Volume': 10, 'Amount': 1000000, 'Market': 'KOSPI'})
        chunks = partition_codes(raw, '2026-11-19', 500)
        self.assertEqual([len(chunk) for chunk in chunks], [500, 500, 1])
        self.assertEqual([code for chunk in chunks for code in chunk],
                         [f'{n:06d}' for n in range(1001)])

    def test_invalid_inputs_fail_closed(self):
        raw = self.fixture()
        target = str(raw.Date.max().date())
        for workers in (0, 5, -1):
            with self.assertRaisesRegex(ValueError, 'INVALID_PATTERN_WORKER_COUNT'):
                scan_r08_parallel(raw, target, workers=workers)
        for size in (0, -1, 1001):
            with self.assertRaisesRegex(ValueError, 'INVALID_PATTERN_CHUNK_SIZE'):
                partition_codes(raw, target, size)
        with self.assertRaisesRegex(ValueError, 'PATTERN_DATE_NOT_AVAILABLE'):
            partition_codes(raw, '2026-11-01')


if __name__ == '__main__':
    unittest.main()
