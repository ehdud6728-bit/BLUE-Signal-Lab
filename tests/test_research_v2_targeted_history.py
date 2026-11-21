import hashlib
import json
import sys
import tempfile
import unittest
from datetime import date,timedelta
from pathlib import Path
from unittest.mock import patch

import pandas as pd

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from research_v2_targeted_history import (
    REPLAY_DAYS,EXACT_EOD_HASHES,EXACT_MARCAP_HASHES,
    EXACT_MISSING_BARS,SOURCE_KRX,SOURCE_KIS,plan_coverage,collect,load_and_merge,_from_kis,
)


def reports():
    ready=['006730','014620','023160','033100','038500','052400','082920',
           '095610','096530','101490','226950','241710','251970','298380']
    bars={**EXACT_MISSING_BARS,**{code:(349 if code=='038500' else 350) for code in ready}}
    return [{
        'format':'BLUE_RESEARCH_V2_HISTORY_COVERAGE_V1', 'day':day,
        'status':'BLOCKED_INSUFFICIENT_HISTORY','candidate_count':50,
        'verified_source':'KRX_PYKRX_EXACT_DAY_VERIFIED',
        'eod_count':2662,'eod_day_sha256':EXACT_EOD_HASHES[day],
        'source_sha256_by_year':EXACT_MARCAP_HASHES,
        'missing_candidates':[{'code':code,'history_bars':n,
                               'meets_250_bar_threshold':n>=250} for code,n in bars.items()]
    } for day in REPLAY_DAYS]


def row(code,day='2026-11-09',source=SOURCE_KRX,close=103):
    return {'code':code,'day':day,'source':source,
            'open':100,'high':110,'low':95,'close':close,'volume':1000,'amount':100000}


class FakeResponse:
    status_code=200
    def __init__(self, rows):self.rows=rows
    def json(self):return {'rt_cd':'0','output2':self.rows}


class FakeRequests:
    def __init__(self, rows):self.rows=rows;self.params=[]
    def get(self,url,params,headers,timeout):
        self.params.append(params)
        return FakeResponse(self.rows)


class TargetedHistoryTest(unittest.TestCase):
    def setUp(self):self.plan=plan_coverage(reports())

    def test_plan_only_36_not_full_market(self):
        self.assertEqual(len(self.plan['target_codes']),36)
        self.assertEqual(self.plan['baseline_bars']['122870'],244)
        self.assertEqual(self.plan['history_end'],'2026-11-09')

    def test_wrong_eod_sha_and_drift_rejected(self):
        values=reports();values[0]['eod_day_sha256']='0'*64
        with self.assertRaisesRegex(ValueError,'COVERAGE_INVALID'):
            plan_coverage(values)
        values=reports();values[2]['missing_candidates'][0]['history_bars']=2
        with self.assertRaisesRegex(ValueError,'UNIVERSE_CHANGED'):
            plan_coverage(values)

    def test_collection_one_provider_per_symbol_and_readonly_manifest(self):
        calls=[]
        def krx(code):
            calls.append(('krx',code))
            if code=='003380':return []
            return [row(code,day=(date(2026,11,9)-timedelta(days=i)).isoformat())
                    for i in range(249)] if code=='009520' else [row(code)]
        def kis(code,*_):
            calls.append(('kis',code));return [row(code,source=SOURCE_KIS),
                row(code,day=REPLAY_DAYS[0],source=SOURCE_KIS)]
        blob,manifest=collect(self.plan,krx,kis,pause=lambda _:None,
                              anchor_quotes={'003380':{k:v for k,v in row('003380').items()
                                                     if k in ('open','high','low','close','volume','amount')}})
        self.assertTrue(manifest['row_count']>0)
        self.assertEqual(manifest['source_sha256'],hashlib.sha256(blob).hexdigest())
        self.assertEqual(manifest['writes'],0)
        self.assertEqual(manifest['by_code']['003380']['source'],SOURCE_KIS)
        self.assertNotIn(('kis','009520'),calls)  # 249 prior + exact target = 250
        self.assertEqual(len([x for x in calls if x[0]=='krx']),36)

    def test_unsigned_tampered_and_future_rows_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)
            good=json.dumps(row('003380'),separators=(',',':')).encode()+b'\n'
            manifest={'format':'BLUE_RESEARCH_V2_TARGETED_HISTORY_V1','plan':self.plan,
                      'source_sha256':hashlib.sha256(good).hexdigest(),
                      'row_count':1,'writes':0}
            (path/'manifest.json').write_text(json.dumps(manifest))
            (path/'history.jsonl').write_bytes(good)
            raw=pd.DataFrame([{'Date':pd.Timestamp('2026-11-08'),'Code':'003380',
                               'Name':'','Market':'KOSDAQ','Open':99,'High':110,
                               'Low':90,'Close':100,'Volume':1000,'Amount':100000}])
            augmented,digest=load_and_merge(raw,path,pd.Timestamp('2026-11-10').date())
            self.assertEqual(len(augmented),2)
            self.assertEqual(digest,manifest['source_sha256'])
            (path/'history.jsonl').write_bytes(good+b'\n')
            with self.assertRaisesRegex(ValueError,'MANIFEST_INVALID'):
                load_and_merge(raw,path,pd.Timestamp('2026-11-10').date())
            altered=row('003380',day='2026-11-10')
            other=json.dumps(altered).encode()+b'\n'
            (path/'history.jsonl').write_bytes(other)
            manifest['source_sha256']=hashlib.sha256(other).hexdigest()
            (path/'manifest.json').write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError,'ROW_IDENTITY_INVALID'):
                load_and_merge(raw,path,pd.Timestamp('2026-11-10').date())

    def test_conflicting_marcap_candle_blocks_mixing(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)
            record=row('003380')
            blob=json.dumps(record).encode()+b'\n'
            (path/'history.jsonl').write_bytes(blob)
            (path/'manifest.json').write_text(json.dumps({
                'format':'BLUE_RESEARCH_V2_TARGETED_HISTORY_V1','plan':self.plan,
                'source_sha256':hashlib.sha256(blob).hexdigest(),
                'row_count':1,'writes':0}))
            raw=pd.DataFrame([{'Date':pd.Timestamp(record['day']),'Code':'003380',
                'Name':'','Market':'KOSDAQ','Open':100,'High':110,'Low':95,
                'Close':104,'Volume':1000,'Amount':100000}])
            with self.assertRaisesRegex(ValueError,'MARCAP_PRICE_CONFLICT'):
                load_and_merge(raw,path,pd.Timestamp('2026-11-10').date())

    def test_kis_original_price_and_exact_dates_and_volume(self):
        data={'stck_bsop_date':'20261109','stck_oprc':'100','stck_hgpr':'110',
              'stck_lwpr':'95','stck_clpr':'103','acml_vol':'1000',
              'acml_tr_pbmn':'100000'}
        fake=FakeRequests([data])
        actual=_from_kis('000001','cached','key','secret',session=fake)
        self.assertEqual(len(actual),1)
        self.assertEqual(actual[0]['source'],SOURCE_KIS)
        self.assertEqual(fake.params[0]['FID_ORG_ADJ_PRC'],'1')
        fake.rows=[{**data,'stck_bsop_date':'20261111'}]
        with self.assertRaisesRegex(ValueError,'DATE_OUT_OF_RANGE'):
            _from_kis('000001','cached','key','secret',session=fake)

    def test_kis_anchor_mismatch_cannot_enter_research(self):
        code='003380'
        def kis(code,*_):return [row(code,source=SOURCE_KIS),
              row(code,day=REPLAY_DAYS[0],source=SOURCE_KIS,close=104)]
        expected={k:v for k,v in row(code).items() if k in
                  ('open','high','low','close','volume','amount')}
        _,manifest=collect(self.plan,krx=lambda _:[],kis=kis,pause=lambda _:None,
                           anchor_quotes={code:expected})
        self.assertEqual(manifest['by_code'][code]['source'],'NONE')
        self.assertIn('KIS_UNAVAILABLE',manifest['by_code'][code]['status'])

    def test_kis_rate_limit_stops_entire_collection(self):
        class Limited:
            status_code=200
            def json(self):return {'rt_cd':'1','msg_cd':'EGW00201','output2':[]}
        class Client:
            def get(self,*_,**__):return Limited()
        with self.assertRaisesRegex(ValueError,'KIS_HISTORY_RATE_LIMIT'):
            _from_kis('003380','cached','key','secret',session=Client())


if __name__=='__main__':unittest.main()
