# BLUE Signal Lab R1.5.10.14 — 매매기법 연구소 / 1차

**RESEARCH ONLY. No live stock search, brokerage orders, Cloudflare Worker, or D1 writes.**

## Reference conditions (from user PDFs)

- `★엔벨상단눌림특강★(최종).pdf` page 2: ENV upper setting **period 20, percent 40**, with pullbacks around 7/15/20-session moving averages; page 3 discusses risk around 7-vs-15-vs-20 line. **ENV upper** is `SMA(close,20)*1.40`, NOT the existing application's ENV20 centerline.
- `★기준 거래대금 조건검색식★.pdf` page 5: examples involving **500억 KRW candle turnover** are illustrated; page 14 describes **2-minute 70억 KRW** and suggests 3-minute turnover near 100억. These are reference examples, not demonstrated causal trading edges.
- The **daily 500억 condition is an explicit adaptation**, because completed daily turnover and intraday ‘500억 기준봉’ are different events. Do not claim the PDF's pattern is precisely implemented by this EOD proxy.
- `3-minute 100억` is a user-chosen research candidate; `3-minute 150억` is an additional research control. This implementation does **not** claim such a strategy is profitable.

## Daily strategy families

| Code | As-of detection condition |
|---|---|
| `AMOUNT_500EOK` | **Research EOD proxy, not the source's actual candle condition**: completed daily bar `amount >= 50,000,000,000 KRW`. The original candle-level 500억 rule needs verified intraday data. |
| `ENV20_40_PULLBACK` | An ENV upper touch in the prior 30 completed bars (at least 2 days earlier), then a 7/15/20 moving-average retest with price drawdown. |
| `AMOUNT_ENV_PULLBACK` | Above, AND the earlier ENV touch bar had `amount >= 500억`. |
| `AMOUNT_ENV_SUPPLY` | Above, AND **today's preceding-120-day** estimated overhead price-volume-density zone is within 5%; uses existing `scripts/supply_profile_r15110.py` as a *proxy*. |
| `BASELINE_20_STEP` | Same-symbol coarse 20-trading-day baseline, *not* a matched market/sector benchmark. |

Configurable **research assumptions**, not original PDF rules: touch lookback 30 sessions; >=2 sessions after touch; pullback within ±1% of the MA, close within 1% below it; 3% drop from touch high; overhead density zone 5% or less away; dedup 20 sessions. The assumption affects sample size materially; run sensitivity studies rather than choosing the best backtest post hoc.

### Outcome protocol

Signals are detected using information at or before the selected as-of date only. On completed historical events, measure next trading-day **open** to day 5/10/20 **close**, plus max future high and minimum future low. **Immature** outcomes are excluded from the relevant horizon denominator. Chronological and market/sector holdout research must precede use as predictive/automated picks. Data may be unadjusted; delisted names may be missing.

### CSV schema & usage

`daily.csv` columns: `code,date,open,high,low,close,volume,amount`. `amount` must be the source's actual daily KRW turnover, never approximated as `close*volume`. Dates must represent the **complete EOD** bars for the available market.

```bash
python -m research.strategy_lab_r15114.run --daily-csv daily.csv --asof 2026-11-13 --out output/research/daily.json
```

Only `--asof` values present in the CSV are accepted. A source-snapshot report is not automatically downloaded or synthesized.

## Minute research

`minute.csv` columns: `code,timestamp,open,high,low,close,volume,amount_krw`.

- One row per **completed, timezone-aware (KST or equivalent offset) 1-minute bar**, its timestamp is the start of that minute.
- `amount_krw` is the amount **within that minute**. **Do not pass a running/cumulative daily amount** without first validating and differencing it from the provider's source definition.
- Only completed non-gapped 2- or 3-minute bundles are accepted, all aligned to 09:00 KST. Sample market session: 09:00–15:20 continuous trading (final auction excluded). No fake bars or KIS provider calls. Half days / delayed-opening days require an explicitly validated session adjustment in future versions.
- Compare `2MIN_70EOK`, `3MIN_100EOK`, `3MIN_150EOK` on the first such trigger per symbol/day, next complete **10 and 30 minutes**. Insufficient future minute coverage is omitted, not called a loss or win.

```bash
python -m research.strategy_lab_r15114.run --minute-csv minute.csv --out output/research/intraday.json
```

## Safe installation

The standalone GitHub Actions installer copies files **only** under `research/strategy_lab_r15114/` and `tests/test_strategy_lab_r15114.py` after an SHA256 check, runs all tests, checks exact source scope, and optionally commits after `apply_changes=true`. Does **not** publish results to D1 or deploy the web app. Future integrations should be reviewed separately and must retain the current production search strategy.
