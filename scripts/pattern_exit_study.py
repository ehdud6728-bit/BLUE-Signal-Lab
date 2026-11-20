#!/usr/bin/env python3
"""Offline, audit-ledger-backed short/long pattern and exit-policy study.

No price forecasting, LLM calls, orders or database access. A report can be
published separately, but there are NO watchlist candidates until independent
session-calendar and corporate-action proofs exist and holdout tests pass.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import date
from hashlib import sha256
import json
from pathlib import Path
import re
from statistics import mean, median

try:
    from scripts.exit_policy_research import ExitPolicy, VerifiedBar, simulate_exit, describe_exits
except ModuleNotFoundError:  # direct `python scripts/pattern_exit_study.py` execution
    from exit_policy_research import ExitPolicy, VerifiedBar, simulate_exit, describe_exits


WINDOWS = (5, 10, 20, 60, 120, 250, 500)
# Fixed BEFORE observing returns. No post hoc expansion of the policy search.
POLICIES = (
    ExitPolicy(3, 2, 5), ExitPolicy(5, 3, 5), ExitPolicy(5, 3, 10),
    ExitPolicy(8, 4, 10), ExitPolicy(10, 5, 20), ExitPolicy(15, 7, 20),
)
CODE = re.compile(r'^[0-9A-Z]{6}$')
SIGNAL = re.compile(r'^[A-Z0-9_]{2,60}$')


def _date(value):
    if not isinstance(value, str) or not re.fullmatch(r'20\d\d-\d\d-\d\d', value):
        raise ValueError('BAD_STUDY_DATE')
    try:
        if date.fromisoformat(value).isoformat() != value:
            raise ValueError
    except ValueError as exc:
        raise ValueError('BAD_STUDY_DATE') from exc
    return value


def _count(value, lower=0, upper=100000):
    if not isinstance(value, int) or isinstance(value, bool) or not lower <= value <= upper:
        raise ValueError('BAD_STUDY_COUNT')
    return value


def analyze(snapshot: dict) -> dict:
    if not isinstance(snapshot, dict) or snapshot.get('format') != 'BLUE_TURSO_EXIT_SOURCE_V1' or \
            snapshot.get('storage') != 'TURSO' or snapshot.get('audits_readback_verified') is not True:
        raise ValueError('UNVERIFIED_STUDY_SOURCE')
    days = snapshot.get('eod_days')
    signals = snapshot.get('signals')
    bars = snapshot.get('bars')
    if not all(isinstance(x, list) for x in (days, signals, bars)) or \
            not 1 <= len(days) <= 520 or len(signals) > 100000 or len(bars) > 350000:
        raise ValueError('BAD_STUDY_SIZE')
    dates = [_date(item.get('day')) for item in days]
    if dates != sorted(set(dates)) or snapshot.get('asof_day') != dates[-1]:
        raise ValueError('UNORDERED_STUDY_SESSIONS')
    for item in days:
        _count(item.get('expected'), 1700, 10000)
        if _count(item.get('actual'), 0, 10000) != item['expected']:
            raise ValueError('INCOMPLETE_STUDY_AUDIT')
    indexed = {day: i for i, day in enumerate(dates)}
    per_code = defaultdict(dict)
    for row in bars:
        day = _date(row.get('day'))
        code = row.get('code')
        if day not in indexed or not isinstance(code, str) or not CODE.fullmatch(code) or \
                day in per_code[code]:
            raise ValueError('INVALID_STUDY_BAR_KEY')
        per_code[code][day] = VerifiedBar(day, *(float(row[key]) for key in
            ('open', 'high', 'low', 'close')), audited=True)
    events = []
    keys = set()
    for row in signals:
        day = _date(row.get('day'))
        code = row.get('code')
        names = row.get('names')
        if day not in indexed or not isinstance(code, str) or not CODE.fullmatch(code) or \
                not isinstance(names, list) or not names or \
                names != sorted(set(names)) or any(not isinstance(s, str) or not SIGNAL.fullmatch(s)
                                                  for s in names) or (day, code) in keys:
            raise ValueError('INVALID_STUDY_SIGNAL')
        keys.add((day, code))
        if day not in per_code[code]:
            raise ValueError('SIGNAL_WITHOUT_AUDITED_CLOSE')
        events.append((indexed[day], day, code, names))
    events.sort()
    policy_keys = tuple(f'TP{p.take_profit_pct:g}_SL{p.stop_loss_pct:g}_H{p.max_holding_sessions}'
                        for p in POLICIES)
    results = {key: defaultdict(list) for key in policy_keys}
    pending = defaultdict(int)
    gaps = defaultdict(int)
    for i, day, code, names in events:
        for policy, key in zip(POLICIES, policy_keys):
            end = i + policy.max_holding_sessions
            if end >= len(dates):
                for tag in names:
                    pending[(tag, key)] += 1
                continue
            segment = [per_code[code].get(d) for d in dates[i:end+1]]
            if any(bar is None for bar in segment):
                for tag in names:
                    gaps[(tag, key)] += 1
                continue
            outcome = simulate_exit(segment, 0, policy)
            if outcome is None:
                raise ValueError('UNEXPECTED_PENDING_FULL_HORIZON')
            for tag in names:
                results[key][tag].append(outcome)
    calendar_ok = snapshot.get('trading_calendar_verified') is True
    corporate_ok = snapshot.get('corporate_actions_verified') is True
    proof_ready = calendar_ok and corporate_ok
    windows = []
    # Distinguish *signal occurrence date window* from *subsequent mature exits*.
    for horizon in WINDOWS:
        complete = len(dates) >= horizon
        earliest = dates[-horizon] if complete else None
        entries = []
        if complete:
            tags = sorted({s for _, _, _, names in events for s in names})
            for tag in tags:
                for key in policy_keys:
                    samples = [o for o in results[key][tag] if o.signal_day >= earliest]
                    if not samples:
                        continue
                    samples.sort(key=lambda item: (item.signal_day, item.entry_day))
                    # Walk-forward: the most recent 25% is NEVER used to pick a policy.
                    cut = max(1, len(samples)*3//4)
                    if cut >= len(samples):
                        train, holdout = samples, []
                    else:
                        boundary = samples[cut].signal_day
                        train = [o for o in samples[:cut] if o.exit_day < boundary]
                        holdout = samples[cut:]
                    train_stats = describe_exits(train)
                    holdout_stats = describe_exits(holdout)
                    holdout_passed = proof_ready and len(train) >= 50 and len(holdout) >= 20 and \
                        train_stats.get('median_net_return_pct', 0) > 0 and \
                        holdout_stats.get('median_net_return_pct', 0) > 0
                    entries.append({'pattern': tag, 'policy': key,
                        'mature_count': len(samples), 'training': train_stats,
                        'holdout': holdout_stats,
                        'pending_recent': pending[(tag, key)],
                        'excluded_missing_price_path': gaps[(tag, key)],
                        'holdout_checks_passed': holdout_passed,
                        'eligible_for_research_watchlist': False})
        # Policy selection requires training-only evidence; holdout is shown as
        # an independent check, not used to select the policy that looks best.
        best = {}
        for item in entries:
            if item['training'].get('n', 0) < 50:
                continue
            old = best.get(item['pattern'])
            score = item['training'].get('median_net_return_pct', float('-inf'))
            if old is None or score > old['training'].get('median_net_return_pct', float('-inf')):
                best[item['pattern']] = item
        selected = sorted(best.values(), key=lambda x:
            (-x['training'].get('median_net_return_pct', 0), x['pattern']))
        exploratory = sorted((item for item in entries if item['mature_count'] >= 3),
                             key=lambda x: (-x['mature_count'], x['pattern'], x['policy']))
        windows.append({'sessions': horizon, 'archive_complete': complete,
            'start_day': earliest, 'candidate_policies': len(entries),
            'exploratory_examples': exploratory[:5],
            'research_only_best_policies': selected[:15],
            'watchlist_allowed': False})
    # Never output a stock buy list: issuer/survivorship/market benchmark and
    # an independent approval are missing even if individual policy tests pass.
    return {'schema': 'BLUE_TURSO_PATTERN_EXIT_REPORT_V1', 'storage': 'TURSO',
        'asof_day': dates[-1], 'eod_audited_days': len(dates),
        'research_audited_days': _count(snapshot.get('research_audited_days'), 0, 520),
        'signal_stock_days': len(signals), 'short_and_long_windows': windows,
        'trading_calendar_verified': calendar_ok,
        'corporate_actions_verified': corporate_ok,
        'market_and_sector_benchmark_verified': False,
        'candidate_stocks': [], 'investment_recommendation_enabled': False,
        'note': '정확한 미래 거래일/기업행동/시장 기준선 독립 검증 전 탐색 통계입니다. 신호일 다음 거래일 시가 진입, 보수적 일봉 첫 도달, 비용 0.3% 가정. 확률 예측이나 종목 추천이 아닙니다.'}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True)
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    source = Path(args.input).read_bytes()
    study = analyze(json.loads(source))
    destination = Path(args.out)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(study, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print('BLUE_PATTERN_EXIT_STUDY', study['asof_day'], 'eod_days=' + str(study['eod_audited_days']),
          'signal_stock_days=' + str(study['signal_stock_days']),
          'watchlist=DISABLED', 'source_sha256=' + sha256(source).hexdigest())


if __name__ == '__main__':
    try:
        main()
    except (ValueError, KeyError, TypeError, OverflowError, OSError) as exc:
        print('BLUE_PATTERN_EXIT_STUDY_BLOCKED', type(exc).__name__)
        raise SystemExit(1) from None
