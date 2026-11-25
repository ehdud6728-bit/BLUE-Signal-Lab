"""Prepare prior-session history using the existing R1.1 provider stack.
Marcap baseline is not represented as independently audited KRX history.
"""
import argparse,json,os,hashlib,re
from io import BytesIO
import requests
from pathlib import Path
from datetime import date
import pandas as pd
from market_scan import load_marcap,normalise
from market_scan_r08 import COLS
from market_scan_r11 import upgraded_history,selected_provider

def prepare(raw,reference,provider,key,upgrade=upgraded_history):
    ref=pd.Timestamp(reference)
    base=raw.reset_index() if "Date" not in raw.columns and raw.index.name=="Date" else raw.copy()
    base=base.loc[pd.to_datetime(base.Date).dt.normalize().le(ref)].copy()
    combined,added,source=upgrade(base,ref.date(),False,provider,key,force_exact_day=True,allow_verified_fallback=True)
    clean=normalise(combined)
    if clean.empty or clean.date.max()!=ref or clean.date.nunique()<225:
        raise ValueError("INSUFFICIENT_PRIOR_HISTORY")
    if len(clean[clean.date.eq(ref)])<1700:
        raise ValueError("INCOMPLETE_REFERENCE")
    return combined,dict(reference=reference,sessions=int(clean.date.nunique()),krx_added_days=added,reference_source=source,calendar_verified=False,baseline="MARCAP")

def load_versioned_marcap(years, revision, directory, session=requests, reader=pd.read_parquet):
    """Cache public source bytes only, pinned to the upstream Git commit.
    A matching hash proves byte integrity, not financial data correctness.
    KRX reference verification is deliberately outside this cache.
    """
    if not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise ValueError("INVALID_MARCAP_REVISION")
    years = list(years)
    if len(years) != 2 or any(type(y) is not int or not 2000 <= y <= 2100 for y in years) or years[1] != years[0]+1:
        raise ValueError("INVALID_MARCAP_YEARS")
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    manifest = directory / "manifest.json"
    files = {str(y): directory / f"marcap-{y}.parquet" for y in years}
    def digest(blob):
        return hashlib.sha256(blob).hexdigest()
    def read_cache():
        meta = json.loads(manifest.read_text())
        if meta.get("revision") != revision or set(meta.get("sha256", {})) != set(files):
            raise ValueError("CACHE_IDENTITY_MISMATCH")
        frames, hashes = [], {}
        for year, path in files.items():
            blob = path.read_bytes()
            hashes[year] = digest(blob)
            if hashes[year] != meta["sha256"][year]:
                raise ValueError("CACHE_HASH_MISMATCH")
            frames.append(reader(BytesIO(blob)))
        return pd.concat(frames, ignore_index=True), hashes, "HIT"
    try:
        return read_cache()
    except Exception:
        # A missing, corrupt, or incompatible cache is never used as history.
        manifest.unlink(missing_ok=True)
    frames, hashes = [], {}
    for year, path in files.items():
        url = f"https://raw.githubusercontent.com/FinanceData/marcap/{revision}/data/marcap-{year}.parquet"
        response = session.get(url, timeout=90)
        response.raise_for_status()
        blob = response.content
        frames.append(reader(BytesIO(blob)))
        hashes[year] = digest(blob)
        temp = path.with_suffix(".tmp")
        temp.write_bytes(blob)
        temp.replace(path)
    raw = pd.concat(frames, ignore_index=True)
    temp_manifest = manifest.with_suffix(".tmp")
    temp_manifest.write_text(json.dumps({"revision":revision,"sha256":hashes},sort_keys=True))
    temp_manifest.replace(manifest)
    return raw, hashes, "MISS"

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--reference",required=True)
    p.add_argument("--output",required=True)
    p.add_argument("--local-data-dir",default=None)
    p.add_argument("--marcap-revision",default=None)
    p.add_argument("--cache-dir",default=None)
    a=p.parse_args()
    ref=date.fromisoformat(a.reference)
    if bool(a.marcap_revision)!=bool(a.cache_dir) or (a.marcap_revision and a.local_data_dir):
        raise ValueError("INVALID_MARCAP_CACHE_CONFIG")
    if a.marcap_revision:
        raw,hashes,cache_state=load_versioned_marcap([ref.year-1,ref.year],a.marcap_revision,a.cache_dir)
    else:
        raw,hashes=load_marcap([ref.year-1,ref.year],a.local_data_dir)
        cache_state="BYPASS"
    print("BLUE_MARCAP_SOURCE",json.dumps({"revision":a.marcap_revision,"cache":cache_state,"sha256":hashes}))
    key=os.getenv("KRX_AUTH_KEY","")
    provider=selected_provider("auto",key,bool(os.getenv("KRX_DATA_ID") and os.getenv("KRX_DATA_PW")))
    history,meta=prepare(raw,a.reference,provider,key)
    if "Date" not in history.columns: history=history.reset_index()
    history[COLS].to_csv(a.output,index=False)
    Path(a.output+".meta.json").write_text(json.dumps(dict(meta,baseline_hashes=hashes,baseline_revision=a.marcap_revision,baseline_cache=cache_state),ensure_ascii=False))
if __name__=="__main__":main()
