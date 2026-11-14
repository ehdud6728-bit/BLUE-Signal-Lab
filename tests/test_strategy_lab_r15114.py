"""Research-only regression. All synthetic prices explicitly labeled fixtures."""
import sys,unittest
from pathlib import Path
from datetime import datetime,timedelta
from zoneinfo import ZoneInfo
import pandas as pd
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from research.strategy_lab_r15114.daily import (StudyConfig,validate_daily,run_daily_study,detect_signals_single)
from research.strategy_lab_r15114.intraday import aggregate_intervals,run_intraday_study


def day_fixture(n=270):
    dates=pd.bdate_range('2025-01-01',periods=n)
    rows=[]
    for i,day in enumerate(dates):
        o=c=100.0;l=99.0;h=101.0;amt=1_000_000_000
        if i==230:
            h=145.;c=105.;amt=60_000_000_000
        if i==232:
            l=98.8;c=100.
        if i==250:
            amt=60_000_000_000
        rows.append({'code':'000001','date':day,'open':o,'high':max(h,o,c),
            'low':min(l,o,c),'close':c,'volume':1000.,'amount':amt})
    return pd.DataFrame(rows)


def mins(n=40,first_amount=3_500_000_000):
    start=datetime(2026,11,13,9,0,tzinfo=ZoneInfo('Asia/Seoul'))
    arr=[]
    for i in range(n):
        amount=first_amount if i<3 else 1_000_000
        price=100+i*.1
        arr.append({'code':'000001','timestamp':(start+timedelta(minutes=i)).isoformat(),
            'open':price,'high':price+.2,'low':price-.2,'close':price,
            'volume':100,'amount_krw':amount})
    return arr


class DailyStudy(unittest.TestCase):
    def test_traded_amount_is_input_not_close_times_volume(self):
        d=day_fixture();asof=str(d.iloc[-1].date.date())
        result=run_daily_study(d,asof)
        observed=[x for x in result['events'] if x['strategy']=='AMOUNT_500EOK']
        self.assertTrue(any(x['day']==str(d.iloc[230].date.date()) for x in observed))
        self.assertTrue(all(x['amount_krw']>=50_000_000_000 for x in observed))

    def test_source_env20_40_is_upper_not_center(self):
        d=validate_daily(day_fixture())
        signals=detect_signals_single(d,str(d.iloc[-1].date.date()))
        pull=[x for x in signals if x['strategy']=='AMOUNT_ENV_PULLBACK']
        self.assertTrue(any(x['touch_day']==str(d.iloc[230].date.date()) for x in pull),pull)
        self.assertTrue(any(x['day']==str(d.iloc[232].date.date()) for x in pull),pull)

    def test_future_bars_never_change_fixed_asof_output(self):
        d=day_fixture(270);asof=str(d.iloc[254].date.date())
        fixed=run_daily_study(d,asof)
        extra=d.iloc[-1:].copy();extra['date']=pd.Timestamp('2028-01-01');extra['high']=9999.;extra['close']=9999.;extra['open']=9999.;extra['low']=9999.
        new=run_daily_study(pd.concat([d,extra],ignore_index=True),asof)
        self.assertEqual(fixed,new)
        self.assertTrue(all(x['day']<=asof for x in fixed['events']))

    def test_immature_horizon_excluded(self):
        d=day_fixture();asof=str(d.iloc[252].date.date())
        out=run_daily_study(d,asof)
        today=[x for x in out['events'] if x['day']==asof and x['strategy']=='ENV20_40_PULLBACK']
        self.assertTrue(today)
        self.assertEqual(today[0]['horizons'],{})

    def test_invalid_duplicate_and_amount(self):
        d=day_fixture(200)
        with self.assertRaises(ValueError):validate_daily(pd.concat([d,d.iloc[:1]],ignore_index=True))
        d.loc[0,'amount']=-1
        with self.assertRaises(ValueError):validate_daily(d)

    def test_no_silent_asof_fallback(self):
        with self.assertRaisesRegex(ValueError,'asof absent'):
            run_daily_study(day_fixture(270),'2026-11-13')

    def test_source_amount_signal_independent_of_env(self):
        d=day_fixture();r=run_daily_study(d,str(d.iloc[-1].date.date()))
        self.assertTrue(r['per_symbol']['000001']['AMOUNT_500EOK']['5']['n_signal_events']>=2)
        self.assertIn('BASELINE_20_STEP',r['per_symbol']['000001'])
        self.assertEqual(r['pooled']['AMOUNT_500EOK']['horizons']['5']['n_signal_events'],
                         r['per_symbol']['000001']['AMOUNT_500EOK']['5']['n_signal_events'])


class MinuteStudy(unittest.TestCase):
    def test_3min_100eok_vs_2min_70eok(self):
        data=mins(first_amount=3_400_000_000)
        two=aggregate_intervals(data,2);three=aggregate_intervals(data,3)
        self.assertEqual(two[0]['amount_krw'],6_800_000_000)
        self.assertEqual(three[0]['amount_krw'],10_200_000_000)
        result=run_intraday_study(data)
        self.assertEqual(result['studies']['2MIN_70EOK']['10']['n_triggers'],0)
        self.assertEqual(result['studies']['3MIN_100EOK']['10']['n_triggers'],1)
        self.assertEqual(result['studies']['3MIN_150EOK']['10']['n_triggers'],0)

    def test_2min_signal_when_each_first_35eok(self):
        result=run_intraday_study(mins())
        self.assertEqual(result['studies']['2MIN_70EOK']['10']['n_triggers'],1)

    def test_partial_3min_window_rejected(self):
        self.assertEqual(aggregate_intervals(mins(2),3),[])

    def test_missing_minute_never_filled(self):
        data=mins();data.pop(1)
        r=run_intraday_study(data)
        self.assertEqual(r['studies']['3MIN_100EOK']['10']['n_triggers'],0)
        self.assertEqual(r['studies']['2MIN_70EOK']['10']['n_triggers'],0)

    def test_missing_future_window_rejected(self):
        data=mins(15)
        r=run_intraday_study(data)
        self.assertEqual(r['studies']['3MIN_100EOK']['10']['n_completed'],1)
        self.assertEqual(r['studies']['3MIN_100EOK']['30']['n_completed'],0)

    def test_timezone_required_and_duplicated(self):
        data=mins()
        data[0]['timestamp']='2026-11-13T09:00:00'
        with self.assertRaisesRegex(ValueError,'timezone-aware'):run_intraday_study(data)
        data=mins();data.append(dict(data[0]))
        with self.assertRaisesRegex(ValueError,'Duplicate'):run_intraday_study(data)

    def test_no_session_spanning_followup(self):
        start=datetime(2026,11,13,15,16,tzinfo=ZoneInfo('Asia/Seoul'))
        data=[{'code':'000001','timestamp':(start+timedelta(minutes=i)).isoformat(),
              'open':100,'high':101,'low':99,'close':100,'volume':1,'amount_krw':5_000_000_000}
              for i in range(3)]
        r=run_intraday_study(data)
        self.assertEqual(r['studies']['3MIN_100EOK']['10']['n_completed'],0)

if __name__=='__main__':unittest.main()
