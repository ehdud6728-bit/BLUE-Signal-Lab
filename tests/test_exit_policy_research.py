import unittest

from scripts.exit_policy_research import (
    VerifiedBar, ExitPolicy, simulate_exit, describe_exits,
)


def b(day, o=100, h=104, l=98, c=101, audited=True):
    return VerifiedBar(day, o, h, l, c, audited)


class ExitPolicyTests(unittest.TestCase):
    def setUp(self):
        self.policy = ExitPolicy(5, 3, 3, total_round_trip_cost_pct=0.2)
        self.signal = b('2026-10-30', 95, 101, 94, 100)

    def test_next_session_open_entry_and_target_first(self):
        result = simulate_exit([self.signal, b('2026-11-02', 110, 117, 109, 115)], 0, self.policy)
        self.assertEqual(result.entry_price, 110)
        self.assertEqual(result.exit_price, 115.5)
        self.assertEqual(result.reason, 'TAKE')
        self.assertAlmostEqual(result.net_return_pct, 4.8)
        self.assertEqual(result.held_sessions, 1)

    def test_same_day_both_limits_assumes_stop_not_profit(self):
        result = simulate_exit([self.signal, b('2026-11-02', 100, 110, 90, 105)], 0, self.policy)
        self.assertEqual(result.reason, 'AMBIGUOUS_STOP_FIRST')
        self.assertTrue(result.ambiguous_same_bar)
        self.assertAlmostEqual(result.net_return_pct, -3.2)

    def test_downward_open_gap_is_filled_at_worse_open(self):
        result = simulate_exit([self.signal, b('2026-11-02'),
                                b('2026-11-03', 92, 96, 89, 94)], 0, self.policy)
        self.assertEqual(result.reason, 'STOP_GAP')
        self.assertEqual(result.exit_price, 92)
        self.assertAlmostEqual(result.net_return_pct, -8.2)

    def test_up_gap_does_not_invent_a_better_than_limit_price(self):
        result = simulate_exit([self.signal, b('2026-11-02'),
                                b('2026-11-03', 108, 112, 107, 111)], 0, self.policy)
        self.assertEqual(result.reason, 'TAKE_GAP')
        self.assertAlmostEqual(result.exit_price, 105)

    def test_time_exit_only_after_full_max_holding_period(self):
        bars = [self.signal, b('2026-11-02'), b('2026-11-03'),
                b('2026-11-04', 101, 103, 100, 102)]
        self.assertIsNone(simulate_exit(bars[:3], 0, self.policy))
        result = simulate_exit(bars, 0, self.policy)
        self.assertEqual(result.reason, 'TIME')
        self.assertEqual(result.held_sessions, 3)
        self.assertEqual(result.exit_day, '2026-11-04')

    def test_future_signal_without_next_audited_open_is_pending(self):
        self.assertIsNone(simulate_exit([self.signal], 0, self.policy))
        with self.assertRaisesRegex(ValueError, 'UNVERIFIED_OR_INVALID_BAR'):
            simulate_exit([self.signal, b('2026-11-02', audited=False)], 0, self.policy)

    def test_reject_invalid_dates_prices_unsorted_and_policy(self):
        with self.assertRaisesRegex(ValueError, 'INVALID_EXIT_POLICY'):
            ExitPolicy(0, 3, 5)
        for bars in ([self.signal, b('2026-10-30')],
                     [self.signal, b('2026-11-02', 100, 99, 90, 100)],
                     [self.signal, b('2026-11-31')]):
            with self.assertRaises(ValueError):
                simulate_exit(bars, 0, self.policy)

    def test_no_mature_cases_and_small_sample_are_never_recommendations(self):
        self.assertEqual(describe_exits([])['status'], 'NO_MATURE_CASES')
        values = [simulate_exit([self.signal, b('2026-11-02', 100, 110, 98, 106)],
                                0, self.policy) for _ in range(3)]
        report = describe_exits(values)
        self.assertEqual(report['status'], 'SMALL_SAMPLE')
        self.assertEqual(report['n'], 3)
        self.assertEqual(report['take_count'], 3)


if __name__ == '__main__':
    unittest.main()
