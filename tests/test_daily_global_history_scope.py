import unittest
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
import pandas as pd
from daily_global_history_scope import project_daily_global, prepare_verified_daily_scope
from market_scan import normalise
from daily_global_history_preflight import compare_history

def row(code,day,market,amount=100):
    return dict(Code=code,Date=day,Market=market,Name="fixture",Open=10,High=12,Low=9,Close=11,Volume=10,Amount=amount)

class GlobalScopeTests(unittest.TestCase):
    def setUp(self):
        self.raw=pd.DataFrame([row("000001","2026-11-18","KOSDAQ GLOBAL"),
            row("000001","2026-11-19","KOSDAQ GLOBAL"),row("000001","2026-11-20","KOSDAQ GLOBAL"),
            row("000002","2026-11-18","KOSDAQ GLOBAL"),row("000003","2026-11-18","KOSDAQ"),
            row("000004","2026-11-18","KONEX"),row("000005","2026-11-18","KOSDAQ GLOBAL")])
        self.verified=pd.DataFrame([row("000001","2026-11-19","KOSDAQ"),row("000002","2026-11-19","KOSPI"),row("000003","2026-11-19","KOSDAQ")])
    def test_only_exact_members_no_future(self):
        after,info=project_daily_global(self.raw,self.verified,"2026-11-19")
        self.assertEqual(info["changed_rows"],2)
        self.assertEqual(info["changed_codes"],1)
        self.assertEqual(after.Market.tolist(),["KOSDAQ","KOSDAQ","KOSDAQ GLOBAL","KOSDAQ GLOBAL","KOSDAQ","KONEX","KOSDAQ GLOBAL"])
        self.assertEqual(self.raw.Market.iloc[0],"KOSDAQ GLOBAL")
        pd.testing.assert_frame_equal(after.drop(columns="Market"),self.raw.drop(columns="Market"))
    def test_reject_stale_proof(self):
        with self.assertRaisesRegex(ValueError,"GLOBAL_SCOPE_TARGET_PROOF"):
            project_daily_global(self.raw,self.verified,"2026-11-20")
    def test_reject_duplicate_proof(self):
        with self.assertRaisesRegex(ValueError,"GLOBAL_SCOPE_TARGET_PROOF"):
            project_daily_global(self.raw,pd.concat([self.verified,self.verified]),"2026-11-19")
    def test_duplicate_after_projection_rejected(self):
        dup=pd.concat([self.raw,pd.DataFrame([row("000001","2026-11-18","KOSDAQ")])])
        corrected,_=project_daily_global(dup,self.verified,"2026-11-19")
        with self.assertRaisesRegex(ValueError,"Duplicate code/date"):
            normalise(corrected)
    def test_parity_not_just_count(self):
        days=pd.bdate_range(end="2026-11-19",periods=21).strftime("%Y-%m-%d").tolist()
        src=pd.DataFrame([row("000001",d,"KOSDAQ") for d in days])
        clean=normalise(src)
        ref={d:{"000001":dict(open=10,high=12,low=9,close=11,volume=10,amount=100)} for d in days}
        self.assertTrue(compare_history("000001",days[-1],clean,days[:-1],ref)["prior20_exact_krx"])
        ref[days[0]]["000001"]["amount"]=101
        self.assertEqual(compare_history("000001",days[-1],clean,days[:-1],ref)["value_mismatch_days"],1)
        self.assertFalse(compare_history("000001",days[-1],clean,days[:-1],ref)["prior20_exact_krx"])
        ref[days[0]]={}
        self.assertEqual(compare_history("000001",days[-1],clean,days[:-1],ref)["official_no_usable_trade_rows"],1)
        self.assertFalse(compare_history("000001",days[-1],clean,days[:-1],ref)["prior20_exact_krx"])
    def full_fixture(self):
        day="2026-11-19"
        verified=pd.DataFrame([row(f"{i:06d}",day,"KOSDAQ" if i<=850 else "KOSPI") for i in range(1,1701)])
        history=pd.DataFrame([row("000001","2026-11-18","KOSDAQ GLOBAL"),row("001700","2026-11-18","KOSPI")])
        return pd.concat([history,verified],ignore_index=True),verified,day
    def test_verified_daily_full_target_preserved(self):
        raw,verified,day=self.full_fixture()
        result,audit=prepare_verified_daily_scope(raw,verified,day)
        self.assertEqual(audit["valid_prior_rows_restored"],1)
        self.assertEqual(audit["target_rows"],1700)
        self.assertTrue(audit["target_ohlcva_exact"])
        self.assertTrue(audit["unaffected_history_exact"])
        self.assertEqual(raw.Market.iloc[0],"KOSDAQ GLOBAL")
        self.assertEqual(result.Market.iloc[0],"KOSDAQ")
    def test_verified_daily_reject_target_amount_mismatch(self):
        raw,verified,day=self.full_fixture()
        raw.loc[raw.Date.eq(day)&raw.Code.eq("000001"),"Amount"]=101
        with self.assertRaisesRegex(ValueError,"GLOBAL_SCOPE_TARGET_PARITY"):
            prepare_verified_daily_scope(raw,verified,day)
    def test_verified_daily_reject_target_missing_symbol(self):
        raw,verified,day=self.full_fixture()
        raw=raw.loc[~(raw.Date.eq(day)&raw.Code.eq("000001"))]
        with self.assertRaisesRegex(ValueError,"GLOBAL_SCOPE_TARGET_PARITY"):
            prepare_verified_daily_scope(raw,verified,day)
if __name__=="__main__":unittest.main()
