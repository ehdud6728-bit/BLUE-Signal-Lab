# BLUE Signal Lab — R1.5 AI 스마트 장바구니

## 구현 범위 (2026-11-11)

- 기존 확정 일봉 종목 검색 결과에서 **내가 직접 종목 추가**.
- 기존 검증된 비데모 EOD 신호에서 사전 후보를 추린 뒤 **Gemini가 실제 종목코드 내에서만 관찰 후보 선택**. AI는 이유/위험/다음 관찰 조건 기록. 후보 전체 보류도 허용.
- **내 선택 / AI 선택 / 전체** 분리. 동일 종목도 선택 주체별 독립 기록.
- **기준 EOD 종가, 거래일, 저장 시각 고정**. 이후 KRX 저장 스냅샷이 더 새로운 거래일일 때만 참고 변화율 계산. 실제 매수·매도 성과는 아님.
- 동일 기준일 + 후속 참조 시세가 양쪽에 있는 경우만 두 그룹의 평균 참고 변화율 차이를 표시.
- 브라우저 로컬스토리지에 최대 100건 저장, JSON 백업·불러오기, 메모·삭제.
- AI 요청은 서버 측 지정된 Gemini 모델, 1일 전체 제한·D1 캐시, 외부에서 임의 종목/프롬프트 입력 불허.
- 새로운 D1 `blue_basket_ai_cache_r15`는 처음 AI 접근할 때 생성. 기존 신호·수집 테이블에 쓰지 않음.
- 기존 Stock-Hunter, BLUE LIVE/SEARCH/WATCH, R1.4.2 수집기, 주문 시스템 변경 없음. 주문 기능 없음.

## 가장 간단한 설치 (YML 단일 파일)

1. `BLUE_R15_AI_Basket_OneClick.yml` 단일 파일을 다운로드하여 이름을 `blue_r15_basket_oneclick.yml`로 유지하거나 바꿉니다.
2. GitHub 저장소 `ehdud6728-bit/BLUE-Signal-Lab`의 `.github/workflows/` 경로에 **`blue_r15_basket_oneclick.yml`** 이름으로 업로드·Commit합니다.
3. GitHub Actions에서 **BLUE R1.5 AI Smart Basket ONE-CLICK Installer (MANUAL)** 워크플로를 엽니다.
4. `main`에서 `apply_changes=false`로 실행: 10개 Node 단위 테스트 + 기존 프런트엔드 빌드 + Worker 빌드 드라이런. **원격 코드 변경 없음**.
5. 위 단계가 성공하면 다시 `apply_changes=true`로 실행: R1.5 코드와 기존 `web/src/main.tsx`·`worker/src/index.ts`의 최소한의 연결 코드만 GitHub main에 커밋.
6. 마지막으로 기존 **BLUE R1.4 Deploy API Worker (MANUAL, EXPLICIT)** 워크플로 `.github/workflows/blue_kis_r14_deploy_api.yml` 실행. 이것이 새 `/api/basket/ai` 백엔드를 배포하는 단계입니다.
7. 웹앱은 기존 Cloudflare 배포 설정에 따라 자동 업데이트될 수 있습니다. BLUE 웹앱 화면에서 `BLUE 스마트 장바구니`가 보이는지 확인합니다. 보이지 않으면 프런트엔드의 Cloudflare 연결 설정을 점검합니다.

워크플로 바로가기 (업로드 이후):
https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/workflows/blue_r15_basket_oneclick.yml

API Worker 배포:
https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/workflows/blue_kis_r14_deploy_api.yml

**중요:** 새 AI 후보 API는 기존 Cloudflare Access 인증 보호를 그대로 따릅니다. `GEMINI_API_KEY`가 기존 Worker에 등록되지 않았거나 AI 모델이 사용할 수 없으면 AI 후보 생성은 안전하게 실패합니다. 사용자별 D1 장바구니 동기화는 아직 구현하지 않았습니다.

## 대안: 개별 소스 업로드

- `web/src/SmartBasket.tsx`
- `web/src/smart-basket.css`
- `worker/src/basket.ts`
- `scripts/blue_r15_basket_install.py`
- `tests/test_basket_r15.mjs`
- `.github/workflows/blue_r15_basket_install.yml`

동일한 경로로 업로드한 후, **BLUE R1.5 AI Smart Basket Safe Install (MANUAL)** 워크플로를 `apply_changes=false`로 검증하고, 성공 시 `apply_changes=true`로 설치합니다. 이미 원클릭 설치를 선택했다면 개별 설치는 필요 없습니다.

## 데이터 정확도 및 제한

- AI는 투자 추천이 아니라 **연구용 관찰 후보 제안**. 미래 상승 확률/수익률을 예언하지 않습니다.
- 기준 가격은 저장된 확정 일봉 종가로, 사용자의 실제 매입 체결가는 아닙니다.
- 후속 시세는 KRX D1 저장 스냅샷만 사용하며 실제 거래소 체결시각 미검증·지연 가능. 수정주가·배당·슬리피지·수수료·세금 미반영.
- 장바구니는 **현재 브라우저의 로컬 저장소**. 다른 기기와 자동 동기화되지 않으므로 백업 파일을 이용합니다.
- AI 종목 선별은 최신 검증 EOD가 7일 이내에 있을 때만 가능. 종목 전체시장 전수 AI 검색과는 다릅니다. 사전 추림 후보 최대 24개 대상으로 Gemini가 최대 6개만 표시합니다.
- 무료 API/Cloudflare 작업자 실행시간과 사용량 제한으로 AI 제공자 응답이 실패할 수 있으며, 이런 경우 가짜 추천은 생성하지 않습니다.
- GitHub의 AI 모듈 설치가 성공해도 실제 Worker 배포를 별도로 해야 합니다. 수집기 R1.4.2는 영향을 받지 않습니다.

## 수행한 로컬 검증

- `node --experimental-strip-types --test tests/test_basket_r15.mjs` : **10 PASS, 0 FAIL**.
- R1.5 Worker TypeScript와 React 컴포넌트 TypeScript: 국소 타입/문법 검증 통과.
- 설치 스크립트 멱등성/중복 삽입 방지 테스트 통과.
- 원클릭 워크플로 YAML 파싱 및 임베디드 소스 복구 검증 통과.
- 실제 기존 React 앱 전체 빌드 및 Cloudflare Wrangler 빌드는 **GitHub Actions dry-run을 통해 확인해야 합니다**.
