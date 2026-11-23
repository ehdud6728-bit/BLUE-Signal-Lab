import unittest

from scripts.blue_dot_slope_study import (
    slope_context, summarize_cases, assert_parity)


def fake(day, code, reason, net, slope='STEEP', trend='STABLE',
         supply='NEAR', market='DOWN', full=True):
    return {'day':day,'code':code,'name':'TEST','reason':reason,'net':net,
            'full':full,'slope_bin':slope,'trend_bin':trend,
            'supply_bin':supply,'market5':market,'touch_day':day,
            'slope_pct_per_session':-0.4,
            'previous_slope_pct_per_session':-0.5,
            'slope_change_pct_points_per_session':0.1,
            'line_last_six_krw':[10,9,8,7,6,5],
            'signal_open':4,'signal_close':6}


class BlueDotSlopeTest(unittest.TestCase):
    def test_falling_three_moves_accelerating(self):
        x=slope_context([100,99.8,99.6,99.4,98.4,97.4,96.4],3)
        self.assertEqual(x['slope_bin'],'STEEP')
        self.assertEqual(x['trend_bin'],'STEEPENING')

    def test_falling_three_moves_decelerating(self):
        x=slope_context([100,99,98,97,96.8,96.6,96.4],3)
        self.assertEqual(x['slope_bin'],'MODERATE')
        self.assertEqual(x['trend_bin'],'FLATTENING')

    def test_five_moves_same_steepness(self):
        x=slope_context([110,109,108,107,106,105,104,103,102,101,100],5)
        self.assertEqual(x['slope_bin'],'STEEP')
        self.assertEqual(x['trend_bin'],'STABLE')

    def test_invalid_or_unknown_prior(self):
        x=slope_context([100,99,98,97,96,95,94],3,
                        previous_contiguous=False)
        self.assertEqual(x['trend_bin'],'UNKNOWN')
        self.assertIsNone(x['previous_slope_pct_per_session'])
        with self.assertRaises(ValueError):
            slope_context([100,99,98,97,96,97,94],3)
        with self.assertRaises(ValueError):
            slope_context([100,99,98,97,96],3)

    def test_censored_not_zeroed(self):
        c=[fake('2026-10-10','A','TAKE',2.2),
           fake('2026-10-11','B','STOP_GAP',-11.2),
           fake('2026-10-12','C','NO_TOUCH',None,
                slope='GENTLE',trend='UNKNOWN',
                supply='UNKNOWN',full=False)]
        s=summarize_cases(c)
        self.assertEqual(s['total']['stats']['n'],3)
        self.assertEqual(s['total']['stats']['unresolved_no_touch_count'],1)
        self.assertEqual(s['total']['resolved_unit_stakes'][
            'unresolved_or_review_count'],1)
        self.assertAlmostEqual(s['total']['resolved_unit_stakes'][
            'modeled_total_resolved_net_pct_points_equal_stakes'],-9.0)
        self.assertEqual(len(s['first_stop_examples']),1)
        self.assertEqual(sum(x['stats']['n'] for x in s['by_slope'].values()),3)

    def test_prior_strict_counts_are_required(self):
        with self.assertRaises(ValueError):
            assert_parity([],{})
        with self.assertRaises(ValueError):
            assert_parity([],
              {'strict_falling_3_5':{
                  'schema':'BLUE_DOT_FALLING_3_5_MODEL_ONLY_V1',
                  'models':[]}})


if __name__=='__main__':
    unittest.main()
