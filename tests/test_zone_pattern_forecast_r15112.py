"""R1.5.10.12 offline safeguards: no price lookahead; conservative small-n projections."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import pandas as pd
from zone_pattern_forecast_r15112 import (comparable_events,pattern_features,forecast_horizons)
from zone_reaction_r15111 import analyze_zone_reactions

RESULTS=('BREAKOUT','PULLBACK','UNDECIDED')


def cohort(n,br,pb,und):
    assert n==br+pb+und
    return {'n':n,'counts':{'BREAKOUT':br,'PULLBACK':pb,'UNDECIDED':und}}


def fixture(n=290):
    days=pd.bdate_range('2025-01-01',periods=n)
    return pd.DataFrame({'date':days, 'open':[99.]*n, 'high':[106.]*n,
      'low':[96.]*n, 'close':[100.]*n, 'volume':[1000.]*n})


class PatternOutlookTests(unittest.TestCase):
    def test_pattern_event_filter_is_subset_of_original_event_list(self):
        h=fixture(240)
        events=[{'index':i,'grade':'중'} for i in range(125,225,11)]
        selected,context=comparable_events(h,events,{'grade':'중'})
        self.assertLessEqual(len(selected),len(events))
        self.assertEqual(set(x['index'] for x in selected)&set(x['index'] for x in events),set(x['index'] for x in selected))
        self.assertEqual(set(context),{'trend','momentum','volume'})

    def test_no_future_information_in_features(self):
        h=fixture(250)
        a=pattern_features(h)
        future=fixture(5)
        future['date']=pd.bdate_range(h.date.iloc[-1]+pd.Timedelta(days=1),periods=5)
        future['close']=[300,400,500,600,700]
        b=pattern_features(pd.concat([h,future],ignore_index=True))
        self.assertEqual(a,b[:len(h)])

    def test_subtwelve_all_cases_still_has_numeric_estimate(self):
        p={'5':cohort(2,2,0,0),'10':cohort(1,1,0,0)}
        g={'5':cohort(3,1,2,0),'10':cohort(2,1,1,0)}
        a={'5':cohort(5,3,2,0),'10':cohort(4,2,1,1)}
        x=forecast_horizons(p,g,a,{'trend':True,'momentum':True,'volume':False},{'grade':'중'})
        self.assertEqual(x['5']['status'],'EXPLORATORY_SMOOTHED')
        self.assertEqual(x['5']['source'],'PATTERN_SIMILAR')
        self.assertEqual(x['5']['confidence'],'매우 낮음')
        self.assertEqual(sum(x['5']['estimated_pct'].values()),100)
        self.assertLess(x['5']['estimated_pct']['BREAKOUT'],100)

    def test_grade_then_all_fallback(self):
        p={'5':cohort(0,0,0,0),'10':cohort(0,0,0,0)}
        g={'5':cohort(1,1,0,0),'10':cohort(0,0,0,0)}
        a={'5':cohort(3,1,2,0),'10':cohort(4,1,1,2)}
        x=forecast_horizons(p,g,a,{'trend':False,'momentum':False,'volume':False},{'grade':'약'})
        self.assertEqual(x['5']['source'],'SAME_DENSITY')
        self.assertEqual(x['10']['source'],'ALL_APPROACHES')
        self.assertLess(x['5']['estimated_pct']['BREAKOUT'],100)

    def test_no_completed_examples_returns_qualitative_not_invented_percentages(self):
        z={p:cohort(0,0,0,0) for p in ('5','10')}
        x=forecast_horizons(z,z,z,{'trend':True,'momentum':True,'volume':True},{'grade':'중'})
        self.assertEqual(x['5']['status'],'QUALITATIVE_ONLY')
        self.assertIsNone(x['5']['estimated_pct'])
        self.assertIn('상승',x['5']['direction'])

    def test_no_overhead_zone_refuses_forecast(self):
        z={p:cohort(0,0,0,0) for p in ('5','10')}
        x=forecast_horizons(z,z,z,None,None)
        self.assertEqual(x['10']['status'],'NO_UPPER_ZONE')

    def test_history_after_asof_not_used_by_full_analyzer(self):
        h=fixture(330)
        d=str(h.date.iloc[-4].date())
        a=analyze_zone_reactions(h,d)
        altered=h.copy()
        altered.loc[altered.index[-3:],'close']=[800,900,1000]
        altered.loc[altered.index[-3:],'volume']=[10000,20000,30000]
        b=analyze_zone_reactions(altered,d)
        self.assertEqual(a,b)
        self.assertIn('pattern_outlook',a)

    def test_pattern_studies_have_monotonic_subsets(self):
        h=fixture(360)
        x=analyze_zone_reactions(h,str(h.date.iloc[-1].date()))
        for period in ('5','10'):
            self.assertLessEqual(x['cohorts']['pattern_similar']['horizons'][period]['n'],x['cohorts']['all']['horizons'][period]['n'])
            y=x['pattern_outlook']['horizons'][period]
            if y['estimated_pct'] is not None:
                self.assertAlmostEqual(sum(y['estimated_pct'].values()),100,places=1)

if __name__=='__main__':unittest.main()
