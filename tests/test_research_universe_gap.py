"""Offline universe comparison must never equate a candidate with proven history."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from research_universe_gap import compare_day, diagnose, EXPECTED_DAYS, SOURCE_FORMAT


HASH = 'a' * 64


def fixture(day=EXPECTED_DAYS[0]):
    rows = [{'code': f'{i:06d}', 'market': 'KOSPI' if i < 1000 else 'KOSDAQ',
             'name': f'STOCK_{i}'} for i in range(1, 2663)]
    return {'day': day, 'eod_count': 2662, 'research_observed_count': 2612,
            'eod_audit_sha256': HASH, 'research_audit_sha256': HASH,
            'eod_codes': rows}


class UniverseGapTest(unittest.TestCase):
    def test_reproduces_50_candidates_without_historic_proof(self):
        day = fixture()
        marcap = {row['code'] for row in day['eod_codes'][50:]}
        result = compare_day(day, marcap)
        self.assertEqual(result['eod_only_count'], 50)
        self.assertEqual(result['marcap_only_count'], 0)
        self.assertEqual(len(result['eod_only_candidates']), 50)
        self.assertEqual(result['status'],
                         'EXACTLY_50_FRESH_SOURCE_CANDIDATES_NOT_ORIGINAL_PROOF')

    def test_same_net_gap_but_different_codes_is_unresolved(self):
        day = fixture()
        marcap = {row['code'] for row in day['eod_codes'][51:]}
        marcap.add('999999')
        result = compare_day(day, marcap)
        self.assertEqual(result['eod_only_count'], 51)
        self.assertEqual(result['marcap_only_count'], 1)
        self.assertEqual(result['status'], 'HISTORIC_MEMBERSHIP_UNRESOLVED')

    def test_changed_count_marks_source_drift(self):
        day = fixture()
        marcap = {row['code'] for row in day['eod_codes'][49:]}
        result = compare_day(day, marcap)
        self.assertEqual(result['fresh_marcap_count'], 2613)
        self.assertFalse(result['fresh_source_count_matches_old_audit'])

    def test_bad_counts_and_duplicates_fail_closed(self):
        day = fixture()
        day['research_observed_count'] = 2600
        with self.assertRaisesRegex(ValueError, 'SOURCE_INVALID'):
            compare_day(day, set())
        day = fixture()
        day['eod_codes'][1]['code'] = day['eod_codes'][0]['code']
        with self.assertRaisesRegex(ValueError, 'DUPLICATES'):
            compare_day(day, set())

    def test_report_never_marks_historic_data_as_repaired(self):
        days = [fixture(day) for day in EXPECTED_DAYS]
        universe = {d['day']: {row['code'] for row in d['eod_codes'][50:]}
                    for d in days}
        report = diagnose({'format': SOURCE_FORMAT, 'turso_read_only': True,
                           'days': days}, universe, HASH)
        self.assertTrue(report['all_four_exactly_50_candidates'])
        self.assertFalse(report['historical_missing_codes_proven'])
        self.assertFalse(report['historical_research_repaired'])
        self.assertEqual(report['writes'], 0)


if __name__ == '__main__':
    unittest.main()
