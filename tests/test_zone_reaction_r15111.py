"""Offline regression tests; no network / KIS / D1 writes."""
import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import pandas as pd
from zone_reaction_r15111 import analyze_zone_reactions,classify_outcome,wilson_interval


def fixture(n=300):
    days=pd.bdate_range('2025-01-01',periods=n)
    # Wider historical bars and an above-close band; zero data leakage.
    return pd.DataFrame({'date':days,'open':[99.0]*n,'high':[105.0]*n,
        'low':[96.0]*n,'close':[100.0]*n,'volume':[1000.0]*n})

class ZoneReactionR15111(unittest.TestCase):
    def test_first_decisive_breakout_after_two_closes(self):
        self.assertEqual(classify_outcome(100,101,[101,102,103,104,104],5),('BREAKOUT',3))
        self.assertEqual(classify_outcome(100,101,[99,103,99,104,100],5),('UNDECIDED',None))

    def test_first_decisive_pullback_before_breakout(self):
        self.assertEqual(classify_outcome(100,101,[96,104,105,105,105],5),('PULLBACK',1))
        self.assertEqual(classify_outcome(100,101,[104,105,96,105,105],5),('BREAKOUT',2))

    def test_incomplete_window_rejected(self):
        with self.assertRaises(ValueError):classify_outcome(100,102,[100],5)

    def test_no_future_bars_at_fixed_asof(self):
        df=fixture(300)
        day=str(df.iloc[295].date.date())
        a=analyze_zone_reactions(df,day)
        future=fixture(5)
        future['date']=pd.bdate_range(df.date.iloc[-1]+pd.Timedelta(days=1),periods=5)
        future['close']=[40.,50.,60.,70.,80.]
        b=analyze_zone_reactions(pd.concat([df,future],ignore_index=True),day)
        self.assertEqual(a,b)

    def test_counts_conserved_and_immature_events_excluded(self):
        df=fixture(295)
        result=analyze_zone_reactions(df,str(df.iloc[-1].date.date()))
        self.assertEqual(result['version'],'R15111_ZONE_REACTION_V1')
        for cohort in result['cohorts'].values():
            for n in ('5','10'):
                summary=cohort['horizons'][n]
                self.assertEqual(summary['n'],sum(summary['counts'].values()))
                self.assertLessEqual(len(summary['cases']),6)
                self.assertTrue(all(case['result_day']<=result['asof'] for case in summary['cases']))

    def test_same_grade_is_subset_of_all_events(self):
        df=fixture(320)
        res=analyze_zone_reactions(df,str(df.iloc[-1].date.date()))
        for horizon in ('5','10'):
            same=res['cohorts']['same_grade']['horizons'][horizon]['n']
            all_cases=res['cohorts']['all']['horizons'][horizon]['n']
            self.assertLessEqual(same,all_cases)

    def test_small_sample_never_has_percentages(self):
        df=fixture(160)
        res=analyze_zone_reactions(df,str(df.iloc[-1].date.date()))
        for cohort in res['cohorts'].values():
            for row in cohort['horizons'].values():
                self.assertEqual(row['sample_status'],'INSUFFICIENT_SAMPLE')
                self.assertTrue(all(value is None for value in row['rates_pct'].values()))

    def test_wilson_interval_properties(self):
        for k,n in ((0,12),(3,12),(6,12),(12,12),(80,100)):
            ci=wilson_interval(k,n)
            self.assertGreaterEqual(ci[0],0);self.assertLessEqual(ci[1],100)
            self.assertLessEqual(ci[0],ci[1])
        self.assertIsNone(wilson_interval(0,0))

    def test_no_upper_zone_does_not_fabricate_current_signal(self):
        df=fixture(160)
        df.loc[df.index[-1],'close']=10000.
        df.loc[df.index[-1],'high']=10010.
        df.loc[df.index[-1],'low']=9990.
        res=analyze_zone_reactions(df,str(df.iloc[-1].date.date()))
        self.assertEqual(res['status'],'NO_UPPER_ZONE')
        self.assertIsNone(res['current'])

if __name__=='__main__':unittest.main()
