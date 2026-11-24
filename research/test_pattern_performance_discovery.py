from pattern_performance_discovery import discover
from datetime import date,timedelta
days=[(date(2026,1,1)+timedelta(days=i)).isoformat() for i in range(60)]
bars=[];signals=[]
for i,d in enumerate(days):
    for j in range(20):
        c=f"{j:06d}"
        close=1000+i*10 if j<10 else 2000-i*10
        bars.append(dict(day=d,code=c,close=close,open=close-4 if j<10 else close+4,high=close+5,low=close-5,amount=100))
        signals.append(dict(day=d,code=c,names=["ENV20"]))
source=dict(asof_day=days[-1],audits_readback_verified=True,eod_days=[dict(day=d,expected=20,actual=20) for d in days],research_audited_dates=days,bars=bars,signals=signals)
r=discover(source)
assert any(x["direction"]=="UPSIDE" and x["status"]=="HOLDOUT_AGREES_EXPLORATORY" for x in r["rows"])
assert any(x["direction"]=="DOWNSIDE" and x["status"]=="HOLDOUT_AGREES_EXPLORATORY" for x in r["rows"])
source["research_audited_dates"]=days[:-1]
try:
    discover(source)
except ValueError:
    pass
else:
    raise AssertionError("unaudited signal accepted")
print("compound discovery tests passed")
