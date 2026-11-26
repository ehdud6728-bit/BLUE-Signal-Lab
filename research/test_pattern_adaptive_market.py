import unittest
from pattern_adaptive_market import market_report,performance,rotation_report
class Adaptive(unittest.TestCase):
    def test_frequency_denominator_and_missing_audit(self):
        ds=["2026-11-%02d"%i for i in range(1,12)]
        idx={m:ds for m in ("KOSPI","KOSDAQ")}
        states={(m,d):("DOWN_CONFIRMED","DOWN") for m in idx for d in ds}
        meta={d:{"signal_status":"COUNT_AND_PAYLOAD_HASH_METADATA_MATCH"} for d in ds}
        bars={(d,c):dict(market=m,close=100+i) for i,d in enumerate(ds) for c,m in (("000001","KOSPI"),("000002","KOSDAQ"))}
        old={(d,"000001"):["RSI_GC"] for d in ds[-5:]}
        r=market_report(ds,meta,bars,idx,states,old)[0]
        self.assertEqual(r["frequency"]["rows"][0]["delta_pp"],100)
        self.assertEqual(r["breadth"][0]["up_pct"],100)
        meta[ds[-2]]["signal_status"]="MISSING_AUDIT"
        self.assertEqual(market_report(ds,meta,bars,idx,states,old)[0]["frequency"]["status"],"INSUFFICIENT_ALIGNED_SIGNAL_DATES")
        self.assertEqual(market_report(ds[:-2]+ds[-1:],meta,bars,idx,states,old)[0]["breadth"][0]["status"],"DATE_WINDOW_UNAVAILABLE")
    def test_sealed_unsealed_and_insufficient_not_ranked(self):
        def row(i):
            m=dict(available=10,targets={"3":{"mean_pct":i},"5":{"mean_pct":i+1}},paired_5_minus_3_pp=1)
            return dict(source_day="2026-10-%02d"%i,maturity_day="2026-11-01",horizon=3,outcome_version="FORWARD_SYMBOL_EXIT_V1",exit_groups=[dict(market="KOSPI",market_state="DOWN_CONFIRMED",prior_direction="UP",feature="LEGACY_PATTERN",value="RSI_GC",methods={"SIGNAL_LOW":m,"ATR14_SMA_1_5":m})])
        records=[row(i) for i in range(1,11)]
        batch=dict(schema="BLUE_FORWARD_SYMBOL_SETTLEMENT_BATCH_V1",asof="2026-11-02",records=records)
        archive=dict(schema="BLUE_FORWARD_SYMBOL_SETTLEMENT_REPORT_V1",asof=batch["asof"],recent_rows=records,total=10,conflicts=[])
        r=performance(batch,archive)
        self.assertEqual(r["unsealed_cohorts"],0)
        self.assertEqual(r["sealed_changes"][0]["delta_3_pp"],5)
        archive["conflicts"]=[dict(source_day=records[0]["source_day"],horizon=3)]
        self.assertEqual(performance(batch,archive)["sealed_changes"][0]["status"],"INSUFFICIENT_MATURE_DAYS")
    def test_rotation_dedup_and_no_missing_date_skip(self):
        ds=["2026-11-24","2026-11-25","2026-11-26","2026-11-27"]
        a=dict(recorded_day=ds[1],source_day=ds[0],mapping_status="PARTIAL",source_sha256="a"*64,candidates=[dict(market="KOSPI",role="LEADER",code="000001")]*2)
        rot=dict(schema="BLUE_ROTATION_FROZEN_SOURCE_V1",status="OBSERVED_ARCHIVES",archives=[a])
        bars={(ds[2],"000001"):dict(market="KOSPI",open=100,high=105,low=99,close=101)}
        idx={m:ds for m in ("KOSPI","KOSDAQ")}
        r=rotation_report(ds,{},bars,idx,rot)
        self.assertEqual(r["duplicate_sector_memberships_removed"],1)
        self.assertEqual(r["rows"][0]["target_high_reach"]["5"]["hits"],1)
        r=rotation_report(ds[:2]+ds[3:],{},bars,idx,rot)
        self.assertEqual(r["rows"][0]["missing_path"],1)
if __name__=="__main__":unittest.main()
