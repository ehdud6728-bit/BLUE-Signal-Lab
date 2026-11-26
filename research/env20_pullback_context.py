"""Signal-day context only. Coarse predeclared one-factor strata, not a fitted score."""
from fractions import Fraction as F
from math import isfinite
from pattern_performance_forward import history
from pattern_performance_full_universe import check
def band(v,edges,labels):
    return next((label for edge,label in zip(edges,labels) if v<edge),labels[-1])
def categories(b,x,prior,atr):
    o,h,l,c=(b[k] for k in ("open","high","low","close"))
    width=h-l;body=abs(c-o)
    shape="FLAT_RANGE" if not width else "DOJI" if 10*body<=width else ("LONG_BULL" if 10*body>=6*width else "BULL") if c>o else ("LONG_BEAR" if 10*body>=6*width else "BEAR")
    result={"CANDLE":shape,"CLOSE_LOCATION":"UNKNOWN" if not width else band(F(c-l,width),(F(1,3),F(2,3)),("LOW","MID","HIGH")),
        "LOWER_WICK":"UNKNOWN" if not width else "LONG" if 2*(min(o,c)-l)>=width else "SHORT",
        "UPPER_WICK":"UNKNOWN" if not width else "LONG" if 2*(h-max(o,c))>=width else "SHORT"}
    ma=x.get("ma20")
    if x.get("ma_chart_consistent") is True and isinstance(ma,(int,float)) and not isinstance(ma,bool) and isfinite(ma) and ma>0:
        result["MA20_DISCOUNT"]=band(100*(ma-c)/ma,(10,20,25),("LT10","10_20","20_25","GE25"))
        a,z=x.get("ma40"),x.get("ma60")
        if all(isinstance(v,(int,float)) and not isinstance(v,bool) and isfinite(v) and v>0 for v in (a,z)):
            result["MA20_60_GAP"]=band(100*(z-ma)/z,(5,10,20),("LT5","5_10","10_20","GE20"))
        else:result["MA20_60_GAP"]="UNKNOWN"
    else:result.update(MA20_DISCOUNT="UNKNOWN",MA20_60_GAP="UNKNOWN")
    if prior and len(prior)>=25:
        prev=sum(v["close"] for v in prior[-25:-5]);now=sum(v["close"] for v in prior[-20:])
        result["MA20_SLOPE_5"]=band(100*F(now-prev,prev),(-2,0,2),("FALL_FAST","FALL","FLAT_UP","RISE_FAST"))
        mean=sum(v["amount"] for v in prior[-21:-1])
        result["TURNOVER_20"]=band(F(20*b["amount"],mean),(1,F(3,2),3),("LT1","1_1_5","1_5_3","GE3")) if mean>0 else "UNKNOWN"
    else:result.update(MA20_SLOPE_5="UNKNOWN",TURNOVER_20="UNKNOWN")
    result["ATR_PCT"]=band(100*atr/c,(3,5,8),("LT3","3_5","5_8","GE8")) if atr is not None else "UNKNOWN"
    s=x.get("supply") or {}
    if s.get("status")=="NO_UPPER_CONCENTRATION":result.update(SUPPLY_DISTANCE="NO_UPPER_CONCENTRATION",SUPPLY_GRADE="NO_UPPER_CONCENTRATION")
    elif s.get("status")=="STORED_ESTIMATE" and isinstance(s.get("distance_pct"),(int,float)) and isfinite(s["distance_pct"]) and s["distance_pct"]>0 and s.get("grade") in ("강","중","약"):
        result["SUPPLY_DISTANCE"]=band(s["distance_pct"],(3,5,10),("LT3","3_5","5_10","GE10"))
        result["SUPPLY_GRADE"]={"강":"STRONG","중":"MEDIUM","약":"WEAK"}[s["grade"]]
    else:result.update(SUPPLY_DISTANCE="UNKNOWN",SUPPLY_GRADE="UNKNOWN")
    # Small predeclared joint contrast: no post-signal prices, no fitted weights.
    result["CANDLE_MA_CONTEXT"]="BULL_HIGH_CLOSE_SLOPE_NOT_FALLING" if c>o and result["CLOSE_LOCATION"]=="HIGH" and result["MA20_SLOPE_5"] in ("FLAT_UP","RISE_FAST") else "BEAR_LOW_CLOSE_SLOPE_FALLING" if c<o and result["CLOSE_LOCATION"]=="LOW" and result["MA20_SLOPE_5"] in ("FALL","FALL_FAST") else "UNKNOWN" if result["MA20_SLOPE_5"]=="UNKNOWN" else "OTHER"
    return result
