import {useState} from 'react';
type Row={code:string;precise:boolean};
type Remote={revision:number;items:Row[];updated_at:string|null;auto_tracking:false};
const path='/api/basket/tracking';
function canonical(a:Row[]){return JSON.stringify([...a].sort((x,y)=>x.code.localeCompare(y.code)))}
export default function BasketTrackingRegistry({items}:{items:Row[]}){
 const [remote,setRemote]=useState<Remote|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const matching=remote!==null&&canonical(remote.items)===canonical(items);
 const allowed=items.length<=50&&items.filter(r=>r.precise).length<=10;
 async function load(){
  setBusy(true);setMessage('');setRemote(null);
  try{const r=await fetch(path,{credentials:'include',cache:'no-store'});if(!r.ok)throw Error('서버 목록 확인 실패 · '+r.status);
   const x=await r.json();if(!Number.isSafeInteger(x.revision)||x.revision<0||!Array.isArray(x.items)||x.auto_tracking!==false)throw Error('서버 응답 확인 필요');
   setRemote(x);setMessage('서버 목록을 확인했습니다.');
  }catch(e){setMessage(e instanceof Error?e.message:'서버 목록 확인 실패');}finally{setBusy(false);}
 }
 async function register(){
  if(!remote||!allowed||busy)return;
  if(!window.confirm('이 기기의 현재 '+items.length+'종목을 서버 추적 대상으로 등록합니다. 기존 서버 목록과 달라질 수 있습니다. 발견 기록은 삭제하지 않습니다. 계속할까요?'))return;
  setBusy(true);setMessage('');
  try{const r=await fetch(path,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:remote.revision,items})});
   const x=await r.json();if(!r.ok){setRemote(null);throw Error(r.status===409?'다른 기기에서 서버 목록이 변경되었습니다. 다시 확인하세요.':'서버 등록 실패 · '+r.status);}
   if(x.auto_tracking!==false||canonical(x.items)!==canonical(items)||!Number.isSafeInteger(x.revision))throw Error('저장 결과 재확인 필요');
   setRemote(x);setMessage('서버 추적 대상 등록 및 읽기 검증 완료 · 자동 분석은 아직 연결되지 않았습니다.');
  }catch(e){setMessage(e instanceof Error?e.message:'등록 실패');}finally{setBusy(false);}
 }
 return <details className="r152-data-management"><summary>서버 추적 대상 등록</summary>
 <p>현재 브라우저의 종목코드와 정밀 지정만 계정별 서버에 등록합니다. 발견 가격·메모·장기 보호·연구 이력은 변경하지 않습니다. 자동 수집과 30/120분 분석은 아직 시작되지 않습니다.</p>
 <div className="basket-actions"><button type="button" disabled={busy} onClick={()=>void load()}>서버 목록 확인</button>
 <button type="button" disabled={busy||!remote||!allowed||matching&&remote.revision>0} onClick={()=>void register()}>현재 목록 등록</button></div>
 {remote&&<p>서버 {remote.items.length}종목 · 정밀 {remote.items.filter(r=>r.precise).length}종목 · 버전 {remote.revision} · {matching?'현재 목록과 일치':'현재 목록과 다름'}{remote.updated_at?' · '+new Date(remote.updated_at).toLocaleString('ko-KR'):''}</p>}
 {remote&&remote.items.length>0&&<details><summary>서버 종목코드 보기</summary><p>{remote.items.map(r=>r.code+(r.precise?'(정밀)':'')).join(' · ')}</p></details>}
 {!allowed&&<p>전체 50종목·정밀 10종목 이내로 정리해야 등록할 수 있습니다.</p>}
 {message&&<p role="status">{message}</p>}
 </details>
}
