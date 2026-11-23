#!/usr/bin/env python3
"""Fail-closed read-only checklist for Kiwoom thick blue dotted line 30·2·26.

Uses generated JSON reports only; no market download, live search, or trading.
"""
import argparse
import json
from pathlib import Path

AUDIT_SCHEMA = 'BLUE_DOT_KIWOOM_30_2_26_FOCUS_MODEL_AUDIT_V2'
MATCH_SCHEMA = 'BLUE_DOT_30_2_26_OBSERVED_PRICE_MATCH_V1'
CONFLICT_SCHEMA = 'BLUE_DOT_KIWOOM_BBANDSUP_LABEL_NUMERIC_CONFLICT_V1'
SCHEMA = 'BLUE_DOT_30_2_26_BROKER_EVIDENCE_GATE_V1'
PRIMARY = 'HLC3_LOWER_PRIMARY_UNVERIFIED'
PRIORITY_CODES = ('352820', '071850')


def build_report(audit, match, conflict):
    if (audit.get('schema') != AUDIT_SCHEMA or
        match.get('schema') != MATCH_SCHEMA or
        conflict.get('schema') != CONFLICT_SCHEMA):
        raise ValueError('EVIDENCE_INPUT_SCHEMA_MISMATCH')
    if audit.get('source_sha256') != conflict.get('source_sha256'):
        raise ValueError('EVIDENCE_SOURCE_HASH_MISMATCH')
    if audit.get('user_confirmed_parameters') != {
        'period': 30, 'multiplier': 2, 'shift': 26}:
        raise ValueError('EVIDENCE_SETTINGS_MISMATCH')
    if (match.get('target') != 'USER_KIWOOM_THICK_BLUE_DOTTED_LINE_30_2_26'
        or conflict.get('main_settings') not in (None, {'period':30,'multiplier':2,'shift':26})):
        raise ValueError('EVIDENCE_TARGET_MISMATCH')

    raw_cases = {c['code']: c for c in audit['screenshots_four_cases_30_period_reclassified']}
    seen_cases = {c['code']: c for c in match['cases']}
    if len(raw_cases) != len(audit['screenshots_four_cases_30_period_reclassified']) or (
            set(raw_cases) != set(seen_cases) or len(seen_cases) != len(match['cases'])):
        raise ValueError('EVIDENCE_CASE_SET_MISMATCH')
    results = []
    total = 0
    for code, raw in raw_cases.items():
        observed = seen_cases[code]
        hypotheses = observed['price_basis_hypothesis_comparison']
        primary = [x for x in hypotheses if x['hypothesis'] == PRIMARY]
        if len(primary) != 1 or len(hypotheses) != 4:
            raise ValueError('EVIDENCE_FOUR_HYPOTHESES_REQUIRED')
        primary = primary[0]
        dates = [v['date'] for v in raw['basis_and_band_hypotheses'][PRIMARY]['model_line_last_six_by_date']]
        rows = primary['model_line_30_2_26_values']
        if len(dates) != 6 or len(set(dates)) != 6 or [v['date'] for v in rows] != dates:
            raise ValueError('EVIDENCE_DATE_ALIGNMENT_MISMATCH')
        actual = [r for r in rows if r.get('broker_line_krw') is not None]
        if len(actual) != primary['paired_day_count'] or len(actual) != observed['available_user_observations']:
            raise ValueError('EVIDENCE_OBSERVED_COUNT_MISMATCH')
        total += len(actual)
        missing = [r['date'] for r in rows if r.get('broker_line_krw') is None]
        exact_fit = [h['hypothesis'] for h in hypotheses if h['paired_day_count'] == 6
                     and h['matching_day_count'] == 6]
        results.append({
            'code': code,
            'name': raw['name_on_screenshot'],
            'signal_day': raw['signal_day'],
            'priority': code in PRIORITY_CODES,
            'dates_requested': dates,
            'received_count': len(actual),
            'missing_dates': missing,
            'six_day_broker_slope_observable': not missing,
            'all_six_match_model_hypotheses': exact_fit,
            'sample_model_comparison': [
                {'hypothesis': h['hypothesis'], 'sample_days': h['paired_day_count'],
                 'matching_days': h['matching_day_count']}
                for h in hypotheses],
            'unknown_market_session_dates': [
                r['date'] for r in actual if r.get('market_session') == 'UNKNOWN'],
            'unknown_adjustment_dates': [
                r['date'] for r in actual if r.get('adjusted_prices') is None],
            'source_candle_matches_user_screenshot': raw.get('marcap_ohlc_matches_screenshot_exactly'),
            'broker_formula_identity_verified': False,
            'eligible_for_live_use': False,
        })
    if total != match.get('observed_value_count') or total != conflict.get(
            'numeric_blue_dot_observations_for_four_screenshots'):
        raise ValueError('EVIDENCE_GLOBAL_OBSERVED_COUNT_MISMATCH')
    priority = [r for r in results if r['priority']]
    if len(priority) != len(PRIORITY_CODES):
        raise ValueError('EVIDENCE_PRIORITY_CASE_MISSING')
    return {
        'schema': SCHEMA,
        'settings': audit['user_confirmed_parameters'],
        'source_sha256': audit['source_sha256'],
        'priority_codes': list(PRIORITY_CODES),
        'priority_broker_prices_received': sum(r['received_count'] for r in priority),
        'priority_broker_prices_requested': 6 * len(PRIORITY_CODES),
        'priority_broker_prices_missing': sum(len(r['missing_dates']) for r in priority),
        'all_four_cases_observed_count': total,
        'broker_formula_identity_verified': False,
        'ready_to_use_in_search_or_ai_recommendations': False,
        'decision': 'NO_GO_BROKER_FORMULA_AND_PRICE_BASIS_UNVERIFIED',
        'next_validation': [
            'Acquire dated numeric values for the selected thick blue 5pt dotted line',
            'Confirm formula-2 row maps to the actual selected blue plot',
            'Record KRX/NXT market session and adjusted price option for each sample',
            'Reconcile actual broker OHLC and original BBandsUp output; do not alter user formula',
            'Re-run model parity and independently validate exit risk before live promotion',
        ],
        'cases': results,
    }


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--audit', default='output/blue_dot_direction/kiwoom_30_2_26_audit.json')
    p.add_argument('--match', default='output/blue_dot_direction/kiwoom_30_2_26_observed_match.json')
    p.add_argument('--conflict', default='output/blue_dot_direction/formula_conflict_report.json')
    p.add_argument('--out', default='output/blue_dot_direction/broker_evidence_gate.json')
    args = p.parse_args()
    a, m, c = (json.loads(Path(f).read_text(encoding='utf-8'))
               for f in (args.audit, args.match, args.conflict))
    result = build_report(a, m, c)
    dst = Path(args.out)
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False) + '\n', encoding='utf-8')
    print('BROKER_EVIDENCE', result['decision'], 'PRIORITY_MISSING',
          result['priority_broker_prices_missing'], 'LIVE=FALSE')


if __name__ == '__main__':
    main()
