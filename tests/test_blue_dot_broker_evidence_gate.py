import copy
import unittest

from scripts.blue_dot_30_2_26_observed_line_match import check_model_pairs
from scripts.blue_dot_broker_evidence_gate import build_report
from tests.test_blue_dot_30_2_26_observed_line_match import _baseline, _payload, _one


def inputs(observations=None):
    audit = _baseline()
    original = audit['screenshots_four_cases_30_period_reclassified'][0]
    other = copy.deepcopy(original)
    other['code'] = '071850'
    other['name_on_screenshot'] = '캐스텍코리아'
    audit['screenshots_four_cases_30_period_reclassified'].append(other)
    audit['source_sha256'] = {'2025': 'pinned2025', '2026': 'pinned2026'}
    match = check_model_pairs(audit, _payload(observations or []))
    conflict = {
        'schema': 'BLUE_DOT_KIWOOM_BBANDSUP_LABEL_NUMERIC_CONFLICT_V1',
        'source_sha256': dict(audit['source_sha256']),
        'main_settings': dict(audit['user_confirmed_parameters']),
        'numeric_blue_dot_observations_for_four_screenshots':
            match['observed_value_count'],
    }
    return audit, match, conflict


class BrokerEvidenceGateTest(unittest.TestCase):
    def test_empty_no_go_has_all_twelve_priority_dates_missing(self):
        result = build_report(*inputs())
        self.assertEqual(result['priority_broker_prices_missing'], 12)
        self.assertEqual(result['all_four_cases_observed_count'], 0)
        self.assertFalse(result['ready_to_use_in_search_or_ai_recommendations'])

    def test_one_observed_date_shows_exact_missing_dates_and_context(self):
        obs = _one()
        obs['market_session'] = 'UNKNOWN'
        obs['adjusted_prices'] = None
        result = build_report(*inputs([obs]))
        self.assertEqual(result['priority_broker_prices_received'], 1)
        self.assertEqual(result['priority_broker_prices_missing'], 11)
        hybe = next(c for c in result['cases'] if c['code'] == '352820')
        self.assertEqual(len(hybe['missing_dates']), 5)
        self.assertNotIn('2026-11-12', hybe['missing_dates'])
        self.assertIn('2026-11-12', hybe['unknown_market_session_dates'])
        self.assertIn('2026-11-12', hybe['unknown_adjustment_dates'])
        self.assertFalse(hybe['broker_formula_identity_verified'])

    def test_six_numeric_values_do_not_certify_broker_formula_or_live(self):
        dates = ('2026-11-05','2026-11-06','2026-11-09',
                 '2026-11-10','2026-11-11','2026-11-12')
        obs = [_one(date=day, price=round(100.10 - 0.1*i,2))
               for i, day in enumerate(dates)]
        result = build_report(*inputs(obs))
        hybe = next(c for c in result['cases'] if c['code'] == '352820')
        self.assertTrue(hybe['six_day_broker_slope_observable'])
        self.assertFalse(hybe['broker_formula_identity_verified'])
        self.assertFalse(result['ready_to_use_in_search_or_ai_recommendations'])

    def test_source_hash_mismatch_rejected(self):
        a, m, c = inputs([_one()])
        c['source_sha256']['2025'] = 'wrong'
        with self.assertRaisesRegex(ValueError, 'SOURCE_HASH'):
            build_report(a, m, c)

    def test_inconsistent_sample_count_rejected(self):
        a, m, c = inputs([_one()])
        m['observed_value_count'] = 0
        with self.assertRaisesRegex(ValueError, 'GLOBAL_OBSERVED_COUNT'):
            build_report(a, m, c)

    def test_misaligned_date_rejected(self):
        a, m, c = inputs([_one()])
        hybe = next(x for x in m['cases'] if x['code'] == '352820')
        hybe['price_basis_hypothesis_comparison'][0][
            'model_line_30_2_26_values'][0]['date'] = '2026-11-04'
        with self.assertRaisesRegex(ValueError, 'DATE_ALIGNMENT'):
            build_report(a, m, c)


if __name__ == '__main__':
    unittest.main()
