#!/usr/bin/env python3
"""BLUE R1.5.8.1: client-side scan monitor persistence, safe anchor patch."""
from pathlib import Path
import sys

MAIN=Path('web/src/main.tsx')
CSS=Path('web/src/r1581-scan-monitor.css')
assert MAIN.is_file(), 'R1581_MISSING_MAIN'
s=MAIN.read_text(encoding='utf-8')
MARKER='R1581_SCAN_RESUME'
if MARKER in s:
    assert "import './r1581-scan-monitor.css';" in s and CSS.is_file(), 'R1581_PARTIAL_INSTALL'
    print('R1581_ALREADY_INSTALLED')
    sys.exit(0)

def one(old,new,label):
    global s
    n=s.count(old)
    if n != 1: raise RuntimeError(f'R1581_ANCHOR_MISMATCH {label}: matches={n}')
    s=s.replace(old,new,1)

one("import './r157-ui.css';", "import './r157-ui.css';\n// R1581_SCAN_RESUME: persistent scan status across tabs and reloads.\nimport './r1581-scan-monitor.css';",'CSS_IMPORT')

one("const showSignal=(t:string)=>", """const SCAN_WATCH_KEY='blue_r1581_pending_scan_date_v1';
const rememberedScanDate=():string=>{
  try{
    const day=localStorage.getItem(SCAN_WATCH_KEY)||'';
    if(!/^20\\d{2}-\\d{2}-\\d{2}$/.test(day))return '';
    const d=new Date(day+'T00:00:00Z');
    return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===day?day:'';
  }catch{return '';}
};
const showSignal=(t:string)=>""",'PERSIST_HELPER')

one("const [watchDate,setWatchDate]=useState('');", "const [watchDate,setWatchDate]=useState(rememberedScanDate);\n  const [completedDate,setCompletedDate]=useState('');",'WATCH_STATE')

one("  // Only single-day missing results trigger the existing server-managed scan workflow.", """  // R1581_SCAN_RESUME: refresh/reopen must not silently lose the server-side scan.
  useEffect(()=>{
    try{if(watchDate)localStorage.setItem(SCAN_WATCH_KEY,watchDate);
      else localStorage.removeItem(SCAN_WATCH_KEY);}catch{/* storage denied; this tab still polls */}
  },[watchDate]);

  // Only single-day missing results trigger the existing server-managed scan workflow.""",'PERSIST_EFFECT')

one("useEffect(()=>{loadDates().then(d=>{if(d){setDate(d);setStart(d);setEnd(d);}}).catch(e=>setError(`검색 가능 날짜 확인 실패: ${String(e)}`));},[]);", "useEffect(()=>{loadDates().then(d=>{if(d){setDate(watchDate||d);setStart(d);setEnd(d);}}).catch(e=>setError(`검색 가능 날짜 확인 실패: ${String(e)}`));},[]);",'RESTORE_SELECT_DATE')

one("if(d.status==='READY')setScanInfo('분석이 완료된 날짜입니다. 검색 버튼을 누르면 결과를 확인할 수 있습니다.');\n      else{setScanInfo(d.deduplicated?'다른 PC에서 이미 진행 중인 분석입니다.':'서버에 분석 요청을 접수했습니다.');setWatchDate(day);}","""if(d.status==='READY'){
        setCompletedDate(day);setWatchDate('');
        setScanInfo('검증된 분석 결과가 이미 준비됐습니다.');
        if(mode==='single'&&date===day)void search(1,false,gcFields,gcLogic,day);
      }else{
        setCompletedDate('');
        setScanInfo(d.deduplicated?'이미 진행 중인 분석을 이어서 확인합니다.':'서버에 분석 요청을 접수했습니다.');
        setWatchDate(day);
      }""",'READY_OR_PENDING')

one("async function search(p=1,scroll=true,selectedGc:GcKey[]=gcFields,selectedGcLogic:'any'|'all'=gcLogic){", "async function search(p=1,scroll=true,selectedGc:GcKey[]=gcFields,selectedGcLogic:'any'|'all'=gcLogic,requestedDay?:string){", 'SEARCH_OVERRIDE_PARAM')
one("    const queryMode=mode,queryDate=date;", """    const queryMode=requestedDay?'single':mode,queryDate=requestedDay||date;
    if(requestedDay){setMode('single');setDate(requestedDay);}""",'SEARCH_OVERRIDE_VALUE')

poll_old="""  useEffect(()=>{
    if(!watchDate)return;
    let cancelled=false;
    const poll=async()=>{
      try{
        const r=await fetch(API+'/api/scan/status?date='+encodeURIComponent(watchDate),{credentials:'include',cache:'no-store'});
        const d=await r.json();if(!r.ok)throw new Error(d.error||`상태 조회 오류 ${r.status}`);
        if(cancelled)return;
        if(d.actions_url)setActionsUrl(d.actions_url);
        if(d.status==='READY'){
          setWatchDate('');setScanInfo('D1 등록 완료 · 결과를 갱신합니다.');
          await loadDates().catch(()=>null);
          // The selected date may have changed while waiting: do not overwrite that selection.
          if(mode==='single'&&date===watchDate)void search(1,false);
        }else if(d.status==='FAILED'){setWatchDate('');setScanInfo('분석 실패: '+(d.reason||'Actions 실행 기록 확인 필요'));}
        else if(d.status==='PENDING')setScanInfo('서버에서 분석 중입니다. 다른 PC에서도 동일한 상태가 표시됩니다.');
      }catch(e){if(!cancelled)setScanInfo('상태 확인 오류: '+String(e));}
    };
    void poll();const timer=window.setInterval(()=>{void poll();},8000);
    return()=>{cancelled=true;window.clearInterval(timer);};
  // Intentionally only restart when the watched date changes.
  },[watchDate]);"""

poll_new="""  // R1581_SCAN_RESUME: keep polling while navigating; persist and resume after reload.
  useEffect(()=>{
    if(!watchDate)return;
    let cancelled=false,inFlight=false;
    const poll=async()=>{
      if(inFlight)return;
      inFlight=true;
      try{
        const r=await fetch(API+'/api/scan/status?date='+encodeURIComponent(watchDate),{credentials:'include',cache:'no-store'});
        const d=await r.json();if(!r.ok)throw new Error(d.error||`상태 조회 오류 ${r.status}`);
        if(cancelled)return;
        if(d.actions_url)setActionsUrl(d.actions_url);
        if(d.status==='READY'){
          setWatchDate('');setCompletedDate(watchDate);
          setScanInfo(`${watchDate} 분석 완료 · 저장된 결과를 불러왔습니다.`);
          // Start the result fetch before setWatchDate clears this effect.
          // Otherwise cleanup might suppress auto-refresh while loadDates resolves.
          if(mode==='single'&&date===watchDate)
            void search(1,false,gcFields,gcLogic,watchDate);
          void loadDates().catch(()=>null);
        }else if(d.status==='FAILED'){
          setWatchDate('');setScanInfo(`${watchDate} 분석 실패: `+(d.reason||'GitHub 실행 기록을 확인하세요.'));
        }else if(d.status==='PENDING'){
          setScanInfo(`${watchDate} 분석 진행 중 · 다른 화면에서도 서버 작업은 계속됩니다.`);
        }else if(d.status==='NOT_IMPORTED'){
          setWatchDate('');setScanInfo(`${watchDate} 분석 요청 내역이 없어 검색 버튼으로 다시 요청할 수 있습니다.`);
        }
      }catch(e){if(!cancelled)setScanInfo('분석 상태 확인 오류: '+String(e));}
      finally{inFlight=false;}
    };
    const onVisible=()=>{if(document.visibilityState==='visible')void poll();};
    const onFocus=()=>{void poll();};
    void poll();
    const timer=window.setInterval(()=>{if(document.visibilityState==='visible')void poll();},8000);
    document.addEventListener('visibilitychange',onVisible);
    window.addEventListener('focus',onFocus);
    return()=>{cancelled=true;window.clearInterval(timer);
      document.removeEventListener('visibilitychange',onVisible);
      window.removeEventListener('focus',onFocus);};
  },[watchDate,mode,date,gcFields,gcLogic]);"""
one(poll_old,poll_new,'POLLING_BLOCK')

one("onChange={e=>{setDate(e.target.value);setWatchDate('');setDataStatus('');}}", "onChange={e=>{setDate(e.target.value);setDataStatus('');}}",'NO_CANCEL_ON_DATE_CHANGE')

one("    {/* R153_BOTTOM_NAV_ONLY: navigation is in the bottom dock on every viewport. */}","""    {(watchDate||completedDate||scanInfo)&&<div className="r1581-scan-monitor" role="status">
      <RefreshCw size={16} className={watchDate?'r1581-pending':''}/>
      <div className="r1581-scan-text">
        <strong>{watchDate?`${watchDate} 검색 분석 중`:completedDate?`${completedDate} 분석 완료`:'검색 분석 안내'}</strong>
        <span>{scanInfo||'서버 처리 상태를 확인합니다.'}</span>
        {actionsUrl&&<a href={actionsUrl} rel="noopener noreferrer" target="_blank">GitHub 실행 기록</a>}
      </div>
      {completedDate&&<button type="button" onClick={()=>{
        const day=completedDate;setActiveView('research');setCompletedDate('');setScanInfo('');
        void search(1,false,gcFields,gcLogic,day);
      }}>완료 결과 보기</button>}
    </div>}
    {/* R153_BOTTOM_NAV_ONLY: navigation is in the bottom dock on every viewport. */}""",'GLOBAL_BANNER')

# Strict invariants: do not change the backend dispatch or scan schema.
assert "const [watchDate,setWatchDate]=useState(rememberedScanDate)" in s
assert "if(document.visibilityState==='visible')void poll();" in s
assert "setDate(e.target.value);setWatchDate('')" not in s
assert "requestedDay?:string" in s
assert "completedDate&&<button" in s
assert "void search(1,false,gcFields,gcLogic,watchDate)" in s
assert "await requestScan(queryDate);" in s
assert "API+'/api/scan/status?date='" in s
assert "API+'/api/scan'" in s
CSS.write_text('''/* R1.5.8.1: Global scan status survives tab navigation and local reload. */
.r1581-scan-monitor{display:flex;align-items:flex-start;gap:10px;flex-wrap:wrap;
 padding:12px 14px;margin:0 0 12px;border:1px solid #cbdcf5;border-radius:11px;
 background:#edf5ff;color:#285084;font-size:12px;line-height:1.55}
.r1581-scan-monitor>svg{flex-shrink:0;margin-top:3px}
.r1581-scan-text{display:flex;flex:1;min-width:150px;flex-direction:column;gap:2px}
.r1581-scan-text strong{color:#174da4;font-size:13px}
.r1581-scan-text a{color:#245fdb;text-decoration:underline;font-size:11px;width:max-content}
.r1581-scan-monitor button{margin-left:auto;align-self:center;border:0;border-radius:8px;
 background:#245fda;color:white;padding:9px 12px;font-size:12px;font-weight:800;cursor:pointer}
@media(max-width:560px){.r1581-scan-monitor{padding:10px 11px;gap:7px}
 .r1581-scan-monitor button{margin:4px 0 0 24px;width:calc(100% - 24px)}}
@media(prefers-reduced-motion:no-preference){.r1581-pending{animation:r1581rotate 2.5s linear infinite}}
@keyframes r1581rotate{to{transform:rotate(360deg)}}
''',encoding='utf-8')
MAIN.write_text(s,encoding='utf-8')
print('R1581_SCAN_RESUME_PATCH_OK')
