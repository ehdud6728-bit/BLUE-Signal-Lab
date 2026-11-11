#!/usr/bin/env python3
"""R1.5.5 minimal UI CSS + sanitized AI error reporting. Safe anchor checks."""
from pathlib import Path
import argparse
ROOT=Path(__file__).resolve().parents[1]
MARK='R155_AI_REPAIR'

class Patch:
 def __init__(self,name):
  self.name=name
  self.path=ROOT/name
  self.before=self.path.read_text(encoding='utf-8')
  self.data=self.before
  if MARK in self.data: raise SystemExit('R155_ALREADY_INSTALLED: '+name)
 def one(self,old,new):
  c=self.data.count(old)
  if c!=1: raise SystemExit(f'R155_ANCHOR_MISMATCH {self.name} ({c}): {old[:110]!r}')
  self.data=self.data.replace(old,new,1)
  return self
 def save(self,check):
  if not check:self.path.write_text(self.data,encoding='utf-8')
  print(('R155_CHECK' if check else 'R155_PATCH'),self.name, 'changed=',self.before!=self.data)

def run(check):
 main=Patch('web/src/main.tsx')
 main.one("import './r154-clarity.css';", "import './r154-clarity.css';\n// R155_AI_REPAIR: restore independent AI briefing styles.\nimport './r155-ai-repair.css';")
 
 basket=Patch('web/src/SmartBasket.tsx')
 basket.one('   if(!r.ok)throw Error(d.message||d.error||`AI API 오류 ${r.status}`);',
  "   if(!r.ok)throw Error(`${d.message||'AI 후보 생성 실패'}${d.error?' ('+d.error+')':''} · HTTP ${r.status}`);")
 # Existing user basket, price, cache, action remain unchanged.
 
 api=Patch('worker/src/basket.ts')
 api.one('generationConfig:{temperature:0.15,maxOutputTokens:2800}',
  "generationConfig:{temperature:0.15,maxOutputTokens:3600,responseMimeType:'application/json'}")
 api.one("   if(!response.ok)throw Error(response.status===429?'AI_QUOTA':'AI_PROVIDER_ERROR');",
  """   // R155_AI_REPAIR: stable, non-sensitive provider status classification.
   if(!response.ok){
    const code=response.status===429?'AI_QUOTA':
     response.status===401||response.status===403?'AI_AUTH':
     response.status===404?'AI_MODEL_UNAVAILABLE':
     response.status===400?'AI_BAD_REQUEST':
     response.status>=500?'AI_UPSTREAM_UNAVAILABLE':'AI_PROVIDER_ERROR';
    throw Error(code);
   }""")
 api.one("   const reason=e instanceof Error&&['AI_QUOTA','AI_INVALID_JSON','AI_NO_VALID_PICKS'].includes(e.message)?e.message:'AI_PROVIDER_ERROR';\n   return send({error:reason,message:'AI 후보를 생성하지 못했습니다. 데이터는 변경되지 않았습니다.'},503);",
  """   // Keep the API key and provider body private, but return actionable failures.
   const failure=e instanceof Error?e.message:'UNKNOWN';
   const reason=e instanceof Error&&e.name==='AbortError'?'AI_TIMEOUT':
    ['AI_QUOTA','AI_INVALID_JSON','AI_NO_VALID_PICKS','AI_AUTH','AI_MODEL_UNAVAILABLE',
     'AI_BAD_REQUEST','AI_UPSTREAM_UNAVAILABLE'].includes(failure)?failure:'AI_PROVIDER_ERROR';
   const explanations:Record<string,string>={
    AI_QUOTA:'Gemini 사용량 제한(429)입니다. 사용량을 확인하고 다음에 다시 시도하세요.',
    AI_AUTH:'Gemini API 키 또는 모델 이용 권한이 거부됐습니다. Worker 비밀키와 API 설정을 확인하세요.',
    AI_MODEL_UNAVAILABLE:'해당 API 키에서 Gemini 모델을 찾거나 사용할 수 없습니다. Worker 모델 설정을 확인하세요.',
    AI_BAD_REQUEST:'Gemini 요청 형식이 거부됐습니다. 모델 입력과 JSON 출력 설정을 점검해야 합니다.',
    AI_INVALID_JSON:'Gemini 응답이 유효한 JSON 형식이 아닙니다. 후보 생성은 저장되지 않았습니다.',
    AI_NO_VALID_PICKS:'Gemini가 검색 후보 밖의 종목을 제시했거나 잘못된 후보 응답을 보냈습니다.',
    AI_TIMEOUT:'Gemini 응답 제한시간(45초)을 넘었습니다. 나중에 다시 시도하세요.',
    AI_UPSTREAM_UNAVAILABLE:'Gemini 서비스에 일시적인 오류가 발생했습니다. 나중에 다시 시도하세요.',
    AI_PROVIDER_ERROR:'Gemini 요청 처리에 실패했습니다. Cloudflare Worker 로그로 원인을 확인하세요.'
   };
   return send({error:reason,message:(explanations[reason]||explanations.AI_PROVIDER_ERROR)+' 기존 장바구니 데이터는 유지됩니다.'},reason==='AI_QUOTA'?429:503);""")
 tests=Patch('tests/test_basket_r15.mjs')
 tests.one("  assert.equal(res.status,503);const j=await res.json();assert.equal(j.error,'AI_QUOTA');assert.equal(j.items,undefined);",
  "  assert.equal(res.status,429);const j=await res.json();assert.equal(j.error,'AI_QUOTA');assert.equal(j.items,undefined);")
 tests.one("  called++;const body=JSON.parse(req.body);assert.ok(body.contents[0].parts[0].text.includes('005930'));",
  "  called++;const body=JSON.parse(req.body);assert.ok(body.contents[0].parts[0].text.includes('005930'));\n  assert.equal(body.generationConfig.responseMimeType,'application/json');")
 for p in [main,basket,api,tests]:p.save(check)

if __name__=='__main__':
 parser=argparse.ArgumentParser()
 parser.add_argument('--check',action='store_true')
 parser.add_argument('--apply',action='store_true')
 args=parser.parse_args()
 if not args.check and not args.apply:parser.error('specify --check or --apply')
 run(check=args.check)
