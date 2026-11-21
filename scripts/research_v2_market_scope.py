"""Research-v2-only classification of the 50 KOSDAQ GLOBAL members.

The pinned MARCAP files have their full daily histories. The legacy scanner
filters the market label ``KOSDAQ GLOBAL`` out of KOSPI/KOSDAQ research; it
does *not* lack these bars. Do not modify the generic normaliser or v1 audit.
"""
from __future__ import annotations

from datetime import date

import pandas as pd

from research_v2_targeted_history import (
    EXACT_MARCAP_HASHES, EXACT_MISSING_BARS, REPLAY_DAYS,
)

SCOPE = 'RESEARCH_V2_PINNED_KOSDAQ_GLOBAL_50'
# The other 14 members already had >=250 valid legacy-history bars.
OTHER_GLOBAL_CODES = frozenset({
    '006730', '014620', '023160', '033100', '038500', '052400',
    '082920', '095610', '096530', '101490', '226950', '241710',
    '251970', '298380',
})
GLOBAL_CODES = frozenset(EXACT_MISSING_BARS) | OTHER_GLOBAL_CODES


def project_v2_market(raw: pd.DataFrame, verified: pd.DataFrame,
                      day: date, hashes: dict) -> tuple[pd.DataFrame, dict]:
    """Relabel only pinned GLOBAL histories in a copy after exact-source proof.

    KOSDAQ GLOBAL is a KOSDAQ market segment, not 50 unlisted securities.
    This changes neither OHLCV nor an original MARCAP file/DB/audit row.
    """
    if day.isoformat() not in REPLAY_DAYS or hashes != EXACT_MARCAP_HASHES:
        raise ValueError('V2_GLOBAL_SOURCE_OR_DAY_CHANGED')
    result = raw.reset_index() if 'Date' not in raw and raw.index.name == 'Date' else raw.copy()
    if not {'Date', 'Code', 'Market'}.issubset(result.columns):
        raise ValueError('V2_GLOBAL_SOURCE_SCHEMA_INVALID')
    if not {'Code', 'Market'}.issubset(verified.columns):
        raise ValueError('V2_GLOBAL_EOD_SCHEMA_INVALID')
    codes = result['Code'].astype(str).str.replace(r'\.0$', '', regex=True).str.zfill(6)
    stamps = pd.to_datetime(result['Date'], errors='raise').dt.date
    active_global = codes.loc[stamps.eq(day) & result['Market'].eq('KOSDAQ GLOBAL')]
    if len(active_global) != 50 or set(active_global) != GLOBAL_CODES:
        raise ValueError('V2_GLOBAL_50_SOURCE_UNIVERSE_CHANGED')
    checked = verified.loc[verified['Code'].isin(GLOBAL_CODES)]
    if (len(checked) != 50 or set(checked['Code']) != GLOBAL_CODES or
            not checked['Market'].eq('KOSDAQ').all()):
        raise ValueError('V2_GLOBAL_50_KRX_MARKET_MISMATCH')
    changed = codes.isin(GLOBAL_CODES) & result['Market'].eq('KOSDAQ GLOBAL')
    result.loc[changed, 'Market'] = 'KOSDAQ'
    return result, {'research_market_scope': SCOPE,
                    'market_scope_code_count': 50,
                    'market_scope_reclassified_rows': int(changed.sum())}
