"""Offline tests for fail-closed KRX daily range export."""
from datetime import date, datetime, timezone
import hashlib
import sys
from pathlib import Path
import unittest

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from turso_verified_eod_range import (build_range, canonical_day, target_dates,
                                      openapi_full_day, safe_block_reason, SourcePending)


NOW = datetime(2026, 11, 18, 9, 0, tzinfo=timezone.utc)
SOURCE = "KRX_PYKRX_EXACT_DAY_VERIFIED"


def fake_day(day):
    return pd.DataFrame([
        {"Date": pd.Timestamp(day), "Code": f"{n:06d}",
         "Market": "KOSPI" if n < 850 else "KOSDAQ", "Name": "",
         "Open": 100, "High": 110, "Low": 90, "Close": 105,
         "Volume": 1000, "Amount": 105000}
        for n in range(1700)
    ])


class VerifiedEodRangeTests(unittest.TestCase):
    def test_combined_provider_failure_reports_both_reasons_safely(self):
        blocked = SourcePending(
            'KRX_BOTH_PROVIDERS_PENDING: 2026-11-20 '
            'primary=KRX_EXACT_DAY_UNVERIFIED: KOSPI; '
            'alternate=KRX_DATE_NOT_AVAILABLE: 2026-11-20 KOSDAQ')
        self.assertEqual(safe_block_reason(blocked),
                         'KRX_BOTH_PROVIDERS_PENDING DAY=2026-11-20 '
                         'PRIMARY=KRX_EXACT_DAY_UNVERIFIED:KOSPI '
                         'ALTERNATE=KRX_DATE_NOT_AVAILABLE:KOSDAQ')

    def test_failure_reason_hides_untrusted_provider_body_and_secrets(self):
        message = 'KRX_OPENAPI_UNAVAILABLE: KOSPI sensitive_token=secret_value'
        self.assertEqual(safe_block_reason(SourcePending(message)),
                         'KRX_OPENAPI_UNAVAILABLE:KOSPI')
        self.assertEqual(safe_block_reason(ValueError('INCOMPLETE_KRX_DAILY')),
                         'INCOMPLETE_KRX_DAILY')
        self.assertEqual(safe_block_reason(OSError('Request with credential secret_value')),
                         'OSError')
        self.assertEqual(safe_block_reason(ValueError('https://provider/?key=secret')),
                         'UNCLASSIFIED_SOURCE_FAILURE')

    def test_requested_window_has_eight_weekdays(self):
        result = target_dates(date(2026, 11, 9), date(2026, 11, 18), NOW)
        self.assertEqual(len(result), 8)
        self.assertEqual((result[0], result[-1]), (date(2026, 11, 9), date(2026, 11, 18)))

    def test_future_and_unverified_current_day_blocked(self):
        with self.assertRaisesRegex(Exception, "Current-day EOD"):
            target_dates(date(2026, 11, 18), date(2026, 11, 18),
                         datetime(2026, 11, 18, 6, 0, tzinfo=timezone.utc))
        with self.assertRaisesRegex(Exception, "Future"):
            target_dates(date(2026, 11, 19), date(2026, 11, 19), NOW)

    def test_canonical_day_rejects_wrong_date(self):
        frame = fake_day(date(2026, 11, 9))
        frame.loc[0, "Date"] = pd.Timestamp("2026-11-10")
        with self.assertRaisesRegex(ValueError, "DATE_OR_TICKER_MISMATCH"):
            canonical_day(frame, date(2026, 11, 9), SOURCE)

    def test_canonical_day_rejects_duplicate_or_bad_ohlc(self):
        frame = fake_day(date(2026, 11, 9))
        frame.loc[1, "Code"] = frame.loc[0, "Code"]
        with self.assertRaisesRegex(ValueError, "DATE_OR_TICKER_MISMATCH"):
            canonical_day(frame, date(2026, 11, 9), SOURCE)
        frame = fake_day(date(2026, 11, 9))
        frame.loc[0, "High"] = 80
        with self.assertRaisesRegex(ValueError, "INVALID_DAILY_OHLC"):
            canonical_day(frame, date(2026, 11, 9), SOURCE)

    def test_zero_trade_rows_are_not_fabricated_as_candles(self):
        frame = fake_day(date(2026, 11, 9))
        extra = pd.DataFrame([{"Date": pd.Timestamp("2026-11-09"), "Code": "900000",
                               "Market": "KOSPI", "Name": "Suspended", "Open": 0,
                               "High": 0, "Low": 0, "Close": 0,
                               "Volume": 0, "Amount": 0}])
        frame = pd.concat([frame, extra], ignore_index=True)
        self.assertEqual(len(canonical_day(frame, date(2026, 11, 9), SOURCE)), 1700)
        frame.loc[1700, "Amount"] = 100
        with self.assertRaisesRegex(ValueError, "INVALID_VOLUME_AMOUNT_PAIR"):
            canonical_day(frame, date(2026, 11, 9), SOURCE)

    def test_source_missing_blocks_entire_range(self):
        def fetch(day, provider, key):
            if day == date(2026, 11, 10):
                raise ValueError("NO_KRX_DATA")
            return fake_day(day), SOURCE
        with self.assertRaisesRegex(ValueError, "NO_KRX_DATA"):
            build_range(date(2026, 11, 9), date(2026, 11, 10), NOW, "pykrx", "", fetch)

    def test_openapi_keeps_alphanumeric_codes_and_requires_exact_bas_dd(self):
        class Response:
            def __init__(self, data):
                self.data = data
            def raise_for_status(self):
                return None
            def json(self):
                return {"OutBlock_1": self.data}
        class Session:
            def get(self, url, params, headers, timeout):
                if url.endswith("ksq_bydd_trd"):
                    return Response([{**row, "ISU_CD": "10088K" if row["ISU_CD"] == "00088K"
                                      else f"{int(row['ISU_CD'])+1000:06d}"} for row in rows])
                return Response(rows)
        rows = [{"BAS_DD": "20261109", "ISU_CD": f"{n:06d}", "ISU_NM": "Stock",
                 "TDD_OPNPRC": "100", "TDD_HGPRC": "110", "TDD_LWPRC": "90",
                 "TDD_CLSPRC": "105", "ACC_TRDVOL": "1,000", "ACC_TRDVAL": "105,000"}
                for n in range(900)]
        rows[0]["ISU_CD"] = "00088K"
        frame = openapi_full_day(date(2026, 11, 9), "fake", session=Session())
        self.assertEqual(len(frame), 1800)
        self.assertIn("00088K", set(frame.Code))
        rows[0]["BAS_DD"] = "20261106"
        with self.assertRaisesRegex(Exception, "EXACT_DAY_UNVERIFIED"):
            openapi_full_day(date(2026, 11, 9), "fake", session=Session())

    def test_manifest_and_bytes_are_deterministic_and_complete(self):
        def fetch(day, provider, key):
            return fake_day(day), SOURCE
        manifest, payload = build_range(date(2026, 11, 9), date(2026, 11, 10),
                                        NOW, "pykrx", "", fetch)
        self.assertEqual(manifest["total_rows"], 3400)
        self.assertEqual(len(manifest["days"]), 2)
        self.assertEqual(manifest["data_sha256"], hashlib.sha256(payload).hexdigest())
        self.assertEqual(len(payload.splitlines()), 3400)


if __name__ == "__main__":
    unittest.main()
