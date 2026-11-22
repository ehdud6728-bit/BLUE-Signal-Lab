"""Audited broad-market breadth context for conditional first-touch research.

Market direction is a close-known, equal-weight KRX *stock breadth proxy*,
NOT the official KOSPI/KOSDAQ index return or a certified bull/bear regime.
No same-day opening-auction decisions are inferred from finalized EOD bars.
"""
from __future__ import annotations

from collections import Counter
from statistics import median


SCOPES = ('ALL', 'KOSPI', 'KOSDAQ')
STATES = ('UP', 'DOWN', 'MIXED', 'UNKNOWN')
FEATURES = (
    'signal_day_range_at_least_10pct',
    'signal_day_close_down_at_least_5pct',
    'signal_day_close_in_bottom_quartile',
)
STOP_REASONS = frozenset(('STOP', 'STOP_GAP', 'AMBIGUOUS_STOP_FIRST'))


def validated_market_context(dates, expected_counts, rows, markets):
    """Validate compact market breadth against the preverified EOD day ledger.

    Each lag must be a matched price on the exact earlier audited date. The
    exporter produces the raw counts with indexed SQL self joins; this module
    does not accept an externally supplied UP/DOWN label as evidence.
    """
    if rows is None:
        return None
    if not isinstance(rows, list) or not isinstance(markets, dict):
        raise ValueError('INVALID_MARKET_BREADTH_SOURCE')
    allowed_days = set(dates)
    if not 1 <= len(rows) <= len(dates) * len(SCOPES):
        raise ValueError('INVALID_MARKET_BREADTH_SIZE')
    index = {}
    by_day = {}
    for item in rows:
        if not isinstance(item, dict):
            raise ValueError('INVALID_MARKET_BREADTH_ROW')
        day, scope = item.get('day'), item.get('scope')
        if day not in allowed_days or scope not in SCOPES or (day, scope) in index:
            raise ValueError('INVALID_MARKET_BREADTH_KEY')
        vals = {}
        for key in ('universe', 'matched1', 'up1', 'down1', 'matched5', 'up5', 'down5'):
            value = item.get(key)
            if not isinstance(value, int) or isinstance(value, bool) or not 0 <= value <= 10000:
                raise ValueError('INVALID_MARKET_BREADTH_COUNT')
            vals[key] = value
        if (not 1 <= vals['universe'] or vals['matched1'] > vals['universe'] or
                vals['matched5'] > vals['universe'] or
                vals['up1'] + vals['down1'] > vals['matched1'] or
                vals['up5'] + vals['down5'] > vals['matched5']):
            raise ValueError('INCONSISTENT_MARKET_BREADTH_COUNT')
        index[(day, scope)] = vals
        by_day[day] = by_day.get(day, 0) + (vals['universe'] if scope != 'ALL' else 0)
    for position, day in enumerate(dates):
        all_row = index.get((day, 'ALL'))
        if not all_row or all_row['universe'] != expected_counts[day]:
            raise ValueError('MARKET_BREADTH_EOD_UNIVERSE_MISMATCH')
        if by_day.get(day, 0) != all_row['universe']:
            raise ValueError('MARKET_BREADTH_SCOPE_MISMATCH')
        for scope in SCOPES:
            row = index.get((day, scope))
            if row is None:
                continue
            if (position < 1 and row['matched1'] != 0 or
                    position < 5 and row['matched5'] != 0):
                raise ValueError('MARKET_BREADTH_PREHISTORY_LEAK')
    for code, by_code_day in markets.items():
        if not isinstance(by_code_day, dict):
            raise ValueError('INVALID_MARKET_BAR_LABEL')
        for day, market in by_code_day.items():
            if day not in allowed_days or market not in ('KOSPI', 'KOSDAQ'):
                raise ValueError('INVALID_MARKET_BAR_LABEL')
            if (day, market) not in index:
                raise ValueError('MISSING_MARKET_SCOPE_FOR_BAR')
    return {'by_day_scope': index, 'stock_markets': markets}


def market_state(context, day, code, scope, lag):
    if context is None:
        return 'UNKNOWN'
    real_scope = ('ALL' if scope == 'ALL' else
                  context['stock_markets'].get(code, {}).get(day))
    row = context['by_day_scope'].get((day, real_scope))
    if row is None:
        return 'UNKNOWN'
    n = row[f'matched{lag}']
    if n < 30 or n / row['universe'] < 0.9:
        return 'UNKNOWN'
    net = (row[f'up{lag}'] - row[f'down{lag}']) / n
    if net >= 0.1:
        return 'UP'
    if net <= -0.1:
        return 'DOWN'
    return 'MIXED'


def _metrics(items):
    reasons = Counter(x[4].reason for x in items)
    stopped = sum(reasons[x] for x in STOP_REASONS)
    takes = reasons['TAKE'] + reasons['TAKE_GAP']
    severe = sum(x[4].net_return_pct is not None and x[4].net_return_pct <= -10
                 for x in items)
    return {
        'n': len(items), 'signal_days': len({x[0] for x in items}),
        'take_first': takes, 'stop_first': stopped,
        'stop_gap': reasons['STOP_GAP'],
        'severe_resolved_net_loss_at_or_below_minus_10pct': severe,
        'no_touch_unresolved': reasons['NO_TOUCH'],
        # With no-touch included in denominator this is a lower bound, not
        # an audited prediction of eventual stop probability.
        'observed_stop_fraction_pct_including_no_touch': (
            round(100 * stopped / len(items), 1) if items else None),
    }


def _tradeoffs(items, features):
    result = {}
    for feature in FEATURES:
        skipped = [x for x in items if feature in features(x[2][0])]
        kept = [x for x in items if feature not in features(x[2][0])]
        paired_days = sorted({x[0] for x in skipped} & {x[0] for x in kept})
        by_day_differences = []
        for day in paired_days:
            flagged = [x for x in skipped if x[0] == day]
            retained = [x for x in kept if x[0] == day]
            flagged_stop = sum(x[4].reason in STOP_REASONS for x in flagged) / len(flagged)
            retained_stop = sum(x[4].reason in STOP_REASONS for x in retained) / len(retained)
            by_day_differences.append(100 * (retained_stop - flagged_stop))
        result[feature] = {
            'if_feature_skipped': _metrics(skipped),
            'if_feature_retained': _metrics(kept),
            'avoided_stop_count_if_skipped': sum(x[4].reason in STOP_REASONS for x in skipped),
            'avoided_stop_gap_count_if_skipped': sum(x[4].reason == 'STOP_GAP' for x in skipped),
            'missed_take_count_if_skipped': sum(
                x[4].reason in ('TAKE', 'TAKE_GAP') for x in skipped),
            'paired_same_signal_days': len(paired_days),
            'median_same_day_stop_rate_kept_minus_skipped_pct_points': (
                round(median(by_day_differences), 2) if len(paired_days) >= 5 else None),
            'status': 'DESCRIPTIVE_ONLY_NO_VALIDATED_FILTER',
        }
    return result


def describe_market_conditional(observed, context, features):
    """Same-case market-stratified loss counts, tradeoff for skipping flags.

    Every TP/SL candidate is reported without selection. Market states and
    close-known filters are predeclared, not tuned on holdout prices. Returns
    and unresolved cases cannot imply real fills or a proven market edge.
    """
    if context is None:
        return None
    output = {}
    for scope, lag in (('ALL', 1), ('ALL', 5), ('OWN', 1), ('OWN', 5)):
        buckets = {s: [] for s in STATES}
        for item in observed:
            buckets[market_state(context, item[0], item[1], scope, lag)].append(item)
        output[f'{scope}_PREV_{lag}_AUDITED_DAYS'] = {
            state: {
                'risk': _metrics(buckets[state]),
                'signal_day_filter_tradeoffs': _tradeoffs(buckets[state], features)
                if state in ('UP', 'DOWN', 'MIXED') else None,
                'status': ('DESCRIPTIVE_ONLY_NOT_VALIDATED' if
                           len(buckets[state]) >= 30 and
                           len({x[0] for x in buckets[state]}) >= 5 else
                           'INSUFFICIENT_INDEPENDENT_SIGNAL_DAYS_OR_CASES'),
            }
            for state in STATES
        }
    return output
