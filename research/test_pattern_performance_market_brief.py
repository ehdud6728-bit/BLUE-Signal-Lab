from pattern_performance_market_brief import brief
d="2026-11-23"
r=dict(day=d,scope="ALL",universe=100,matched1=100,up1=70,down1=20,matched5=100,up5=65,down5=30)
s=dict(asof_day=d,audits_readback_verified=True,eod_days=[dict(day=d,expected=100,actual=100)],market_breadth_by_day=[r])
assert brief(s)["regime"]=="BROAD_STRENGTH"
r.update(up1=20,down1=70,up5=30,down5=65)
assert brief(s)["regime"]=="BROAD_WEAKNESS"
r.update(matched5=70,up5=30,down5=30)
assert brief(s)["regime"]=="UNKNOWN"
assert brief(s)["sector_status"]=="NO_VERIFIED_MEMBERSHIP"
r["up5"]=90
try: brief(s)
except ValueError: pass
else: raise AssertionError("invalid breadth accepted")
print("market briefing tests passed")
