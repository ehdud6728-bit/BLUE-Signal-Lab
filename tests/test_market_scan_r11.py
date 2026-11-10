"""No-network tests for BLUE same-day KRX EOD provider and date guards."""
import sys
import unittest
from datetime import date, datetime, timezone, timedelta
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from market_scan_r11 import (SourcePending, ensure_eod_request, pykrx_verified_day,
                             openapi_verified_day, selected_provider, upgraded_history)

KST = timezone(timedelta(hours=9))


class FakeStock:
    def __init__(self, bad_date=False, missing_market=False, mismatch=False):
        self.bad_date = bad_date
        self.missing_market = missing_market
        self.mismatch = mismatch

    def get_market_ohlcv_by_ticker(self, stamp, market='KOSPI', alternative=False):
        if self.missing_market and market == 'KOSDAQ':
            return pd.DataFrame()
        codes = [f'{i+(0 if market == "KOSPI" else 100000):06d}' for i in range(600)]
        codes.append('005930' if market == 'KOSPI' else '086520')
        values = [{'시가': 100, '고가': 120, '저가': 90, '종가': 110,
                   '거래량': 1000, '거래대금': 100000} for _ in codes]
        return pd.DataFrame(values, index=codes)

    def get_market_ohlcv_by_date(self, begin, end, code, adjusted=False):
        d = '2026-11-09' if self.bad_date else '2026-11-10'
        return pd.DataFrame([{'종가': 111 if self.mismatch else 110, '거래량': 1000}],
                            index=[pd.Timestamp(d)])

    def get_index_ohlcv_by_date(self, begin, end, code):
        return pd.DataFrame([{'종가': 4000}], index=[pd.Timestamp('2026-11-10')])


class SameDayTests(unittest.TestCase):
    def test_today_pre_close_blocked(self):
        with self.assertRaisesRegex(SourcePending, '15:40'):
            ensure_eod_request(date(2026, 11, 10), datetime(2026, 11, 10, 15, 39, tzinfo=KST))

    def test_today_post_close_eligible_but_not_automatically_ready(self):
        self.assertTrue(ensure_eod_request(date(2026, 11, 10),
                                           datetime(2026, 11, 10, 15, 40, tzinfo=KST)))

    def test_future_and_weekend_blocked(self):
        at = datetime(2026, 11, 10, 21, tzinfo=KST)
        with self.assertRaisesRegex(SourcePending, 'Future'):
            ensure_eod_request(date(2026, 11, 11), at)
        with self.assertRaisesRegex(SourcePending, 'Weekend'):
            ensure_eod_request(date(2026, 11, 7), at)

    def test_account_provider_only_when_pair_present(self):
        self.assertEqual(selected_provider('auto', '', True), 'pykrx')
        self.assertEqual(selected_provider('auto', 'key', False), 'openapi')
        with self.assertRaisesRegex(SourcePending, 'MISSING_IN_BLUE_REPO'):
            selected_provider('auto', '', False)

    def test_full_market_exact_date(self):
        df = pykrx_verified_day(date(2026, 11, 10), FakeStock())
        self.assertEqual(len(df), 1202)
        self.assertEqual(set(df.Market), {'KOSPI', 'KOSDAQ'})
        self.assertEqual(df.Date.dt.date.nunique(), 1)

    def test_old_day_disguised_as_today_fails(self):
        with self.assertRaisesRegex(SourcePending, 'KRX_EXACT_DAY_UNVERIFIED'):
            pykrx_verified_day(date(2026, 11, 10), FakeStock(bad_date=True))

    def test_price_disagreement_fails(self):
        with self.assertRaisesRegex(SourcePending, 'KRX_SAMPLE_PRICE_MISMATCH'):
            pykrx_verified_day(date(2026, 11, 10), FakeStock(mismatch=True))

    def test_alphanumeric_preferred_ticker_is_valid_and_preserved(self):
        class KRXWithPreferred(FakeStock):
            def get_market_ohlcv_by_ticker(self, stamp, market='KOSPI', alternative=False):
                df = super().get_market_ohlcv_by_ticker(stamp, market=market, alternative=alternative)
                if market == 'KOSPI':
                    ids = list(df.index)
                    ids[4] = '00088K'  # valid 6-character preferred-share short code
                    df.index = ids
                return df
        result = pykrx_verified_day(date(2026, 11, 10), KRXWithPreferred())
        self.assertIn('00088K', result.Code.tolist())
        self.assertEqual(len(result), 1202)

    def test_no_trade_zero_bar_is_excluded_with_positive_traded_bars_intact(self):
        class KRXWithSuspended(FakeStock):
            def get_market_ohlcv_by_ticker(self, stamp, market='KOSPI', alternative=False):
                df = super().get_market_ohlcv_by_ticker(stamp, market=market, alternative=alternative)
                row = df.index[10]
                for c in ('시가','고가','저가','종가','거래량','거래대금'):
                    df.loc[row,c] = 0
                return df
        result = pykrx_verified_day(date(2026, 11, 10), KRXWithSuspended())
        self.assertEqual(len(result), 1200)
        self.assertFalse((result.Volume <= 0).any())
        self.assertFalse((result.Close <= 0).any())

    def test_traded_zero_price_is_rejected_not_silently_discarded(self):
        class KRXBadPrice(FakeStock):
            def get_market_ohlcv_by_ticker(self, stamp, market='KOSPI', alternative=False):
                df=super().get_market_ohlcv_by_ticker(stamp, market=market, alternative=alternative)
                df.loc[df.index[7],'종가']=0
                return df
        with self.assertRaisesRegex(SourcePending,'KRX_TRADED_OHLC_INVALID'):
            pykrx_verified_day(date(2026,11,10),KRXBadPrice())

    def test_invalid_or_duplicate_code_rejected_with_counts_only(self):
        class KRXBadSymbol(FakeStock):
            def get_market_ohlcv_by_ticker(self, stamp, market='KOSPI', alternative=False):
                df=super().get_market_ohlcv_by_ticker(stamp, market=market, alternative=alternative)
                df.index = ['INVALID!' if i == 5 else v for i,v in enumerate(df.index)]
                return df
        with self.assertRaisesRegex(SourcePending,'KRX_TICKERS_INVALID: KOSPI invalid=1'):
            pykrx_verified_day(date(2026,11,10),KRXBadSymbol())

    def test_duplicate_normalized_ticker_is_rejected(self):
        class KRXDup(FakeStock):
            def get_market_ohlcv_by_ticker(self, stamp, market='KOSPI', alternative=False):
                df = super().get_market_ohlcv_by_ticker(stamp, market=market, alternative=alternative)
                codes = list(df.index)
                codes[2] = codes[1]
                df.index = codes
                return df
        with self.assertRaisesRegex(SourcePending, r'KRX_TICKERS_INVALID: KOSPI invalid=0 duplicate=1'):
            pykrx_verified_day(date(2026, 11, 10), KRXDup())

    def test_positive_volume_requires_positive_trading_amount(self):
        class KRXBadAmount(FakeStock):
            def get_market_ohlcv_by_ticker(self, stamp, market='KOSPI', alternative=False):
                df = super().get_market_ohlcv_by_ticker(stamp, market=market, alternative=alternative)
                df.loc[df.index[11], '거래대금'] = 0
                return df
        with self.assertRaisesRegex(SourcePending, r'KRX_AMOUNT_VOLUME_MISMATCH: KOSPI'):
            pykrx_verified_day(date(2026, 11, 10), KRXBadAmount())

    def test_incomplete_market_fails(self):
        with self.assertRaisesRegex(SourcePending, 'KRX_DATE_NOT_AVAILABLE'):
            pykrx_verified_day(date(2026, 11, 10), FakeStock(missing_market=True))

    @staticmethod
    def marcap_fixture(today_included=False):
        rows = []
        for stamp in (['2026-11-09', '2026-11-10'] if today_included else ['2026-11-09']):
            for i in range(2000):
                rows.append({'Date': pd.Timestamp(stamp), 'Code': f'{i:06d}',
                             'Name': 'Seed ' + str(i), 'Open': 100, 'High': 120,
                             'Low': 90, 'Close': 110, 'Volume': 1000,
                             'Amount': 100000, 'Market': 'KOSPI' if i < 1000 else 'KOSDAQ'})
        return pd.DataFrame(rows)

    def test_today_forces_krx_even_when_marcap_has_today(self):
        baseline = self.marcap_fixture(True)
        out, days, source = upgraded_history(baseline, date(2026, 11, 10), True,
                                             'pykrx', '', stock_module=FakeStock())
        self.assertEqual(days, ['2026-11-10'])
        self.assertIn('pykrx', source)
        today = out.loc[out.Date.dt.date.eq(date(2026, 11, 10))]
        self.assertEqual(len(today), 1202)
        self.assertEqual(int((out.Date.dt.date.eq(date(2026, 11, 9))).sum()), 2000)

    def test_historical_complete_marcap_unchanged(self):
        old = self.marcap_fixture(False)
        out, days, source = upgraded_history(old, date(2026, 11, 9), False,
                                             'pykrx', '', stock_module=FakeStock())
        self.assertEqual(days, [])
        self.assertEqual(len(out), 2000)
        self.assertIn('marcap', source)


if __name__ == '__main__':
    unittest.main()
