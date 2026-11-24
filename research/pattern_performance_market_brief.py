"""Audited breadth briefing. No external macro or industry data is inferred."""
import argparse,json
from pathlib import Path

def brief(source):
    if source.get("audits_readback_verified") is not True: raise ValueError("audit required")
    days=[r["day"] for r in source["eod_days"]]
    if not days or days!=sorted(set(days)) or days[-1]!=source["asof_day"] or any(r["expected"]!=r["actual"] for r in source["eod_days"]): raise ValueError("invalid audit dates")
    expected={r["day"]:r["expected"] for r in source["eod_days"]}
    rows={}
    for r in source["market_breadth_by_day"]:
        d,s=r["day"],r["scope"]
        if d not in expected or s not in ("ALL","KOSPI","KOSDAQ") or (d,s) in rows: raise ValueError("invalid scope")
        u=r["universe"]
        if not 0<u<=expected[d] or (s=="ALL" and u!=expected[d]): raise ValueError("universe mismatch")
        v=dict(day=d,scope=s,universe=u)
        for h in (1,5):
            m,up,down=(r[k+str(h)] for k in ("matched","up","down"))
            if not 0<=up+down<=m<=u or min(up,down)<0: raise ValueError("invalid breadth")
            v.update({f"matched{h}":m,f"up{h}_pct":round(100*up/m,2) if m>=.8*u else None,f"down{h}_pct":round(100*down/m,2) if m>=.8*u else None})
        rows[d,s]=v
    if any((d,"ALL") not in rows for d in days): raise ValueError("missing market breadth")
    latest=rows[days[-1],"ALL"]
    a,b=latest["up1_pct"],latest["up5_pct"]
    regime="UNKNOWN" if a is None or b is None else "BROAD_STRENGTH" if a>=60 and b>=60 else "BROAD_WEAKNESS" if a<=40 and b<=40 else "MIXED"
    return dict(asof=days[-1],audited_sessions=len(days),regime=regime,history=[rows[d,s] for d in days[-20:] for s in ("ALL","KOSPI","KOSDAQ") if (d,s) in rows],sector_status="NO_VERIFIED_MEMBERSHIP",macro_status="NOT_CONNECTED",calendar_verified=source.get("trading_calendar_verified") is True,corporate_actions_verified=source.get("corporate_actions_verified") is True)

if __name__=="__main__":
    p=argparse.ArgumentParser()
    for k in ("input","output"): p.add_argument("--"+k,type=Path,required=True)
    a=p.parse_args()
    a.output.write_text(json.dumps(brief(json.loads(a.input.read_text())),ensure_ascii=False,allow_nan=False)+"\n")
