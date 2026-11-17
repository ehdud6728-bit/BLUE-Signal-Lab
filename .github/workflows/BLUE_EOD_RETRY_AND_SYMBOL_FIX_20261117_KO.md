# BLUE Signal Lab — 2026-11-17 EOD 검증·종목명 검색 수정

## 현재 확인한 문제

- 2026-11-17 16:40, 16:55, 17:40 KST 전체시장 분석 GitHub Actions가 동일하게 실패했습니다.
- 로그: `SOURCE_PENDING: KRX_SAMPLE_PRICE_MISMATCH: KOSPI` (마지막 실행 44048778094).
- 기존 코드는 첫 번째 KRX/pykrx 검증이 실패하면 다른 제공 경로를 시도하지 않았습니다.
- `/api/scan/status`는 GitHub dispatch가 204만 돌려주면 실행 ID를 몰라 45분 동안 `PENDING`으로 남을 수 있었습니다.
- 현재 Cloudflare KIS 수집은 분마다 실행하도록 설계되어 있지만, 기본 12개 이전 일봉 후보 수집입니다. 전체시장 14:50 종가배팅 검색은 아직 아닙니다.

## 이 패키지의 수정 범위

1. KRX/pykrx가 당일 종가·거래량 비교 검증에 실패하면, **auto 모드에서만** 독립 KRX Open API로 같은 날짜를 재검증합니다. 두 제공 경로 모두 확정하지 못하면 데이터 저장을 거부합니다.
2. 자동 EOD 확인 시간을 KST **15:45, 16:10, 16:40, 16:55, 17:15, 17:45, 18:15, 19:00, 20:20, 20:35**로 확대합니다. 중복 요청은 잠금과 이미 저장된 날짜 검사를 거쳐 제한됩니다.
3. GitHub가 204를 반환하여 실행 ID를 받지 못한 경우, **시간 조건에 맞는 실행이 딱 하나일 때만** 실제 실행 ID를 연결하여 실패를 더 일찍 표시합니다.
4. 전체시장 일봉을 성공적으로 저장할 때 종목코드↔종목명 D1 목록을 자동으로 갱신합니다. 과거 종목명을 일괄 삭제하지 않습니다.
5. 종목명 검색 초기 대기 상태에서 기존 저장 종목명을 먼저 검색하는 보완, 정밀분석 요청의 CORS 사전요청 완화, 미수집 날짜를 `0종목`으로 오해하지 않도록 하는 UI 수정이 포함됩니다.

**중요:** 위 수정은 14:50 전체시장 종가배팅 검색이 아닙니다. 해당 기능은 별도 KIS 장중 조회/거래대금/이평선 사전계산 파이프라인, 수집 커버리지 검증, 후보 UI가 필요합니다. 현재 시스템은 기존 검색 결과를 소규모로 모니터링하는 단계입니다.

## GitHub에 덮어쓸 파일

패키지의 경로 그대로 `ehdud6728-bit/BLUE-Signal-Lab` `main`에 업로드합니다. `.github/workflows`나 `worker/src`의 기존 경로를 유지하세요.

- `.github/workflows/blue_market_scan_research_only.yml`
- `scripts/market_scan_r11.py`
- `scripts/append_symbol_analysis_sql.py`
- `tests/test_market_scan_r11.py`
- `tests/test_symbol_analysis.py`
- `worker/wrangler.jsonc`
- `worker/src/eod-cron.ts`
- `worker/src/index.ts`
- `worker/src/symbol-analysis.ts`
- `web/src/main.tsx`
- `web/src/SymbolAnalysisPanel.tsx`
- `web/src/symbol-analysis.css`

## 배포/확인 순서

1. GitHub에 위 파일들을 경로대로 반영합니다. 이전 파일을 전부 삭제하거나 다른 YML을 정리할 필요는 없습니다.
2. Actions → **BLUE R1.4 Deploy API Worker (MANUAL, EXPLICIT)** → Run workflow. 완료 후 API가 정상인지 확인합니다.
3. Actions → **BLUE WEB R1.5.10.10 Static Assets Safe Deploy (EXPLICIT)** → `deploy_web=true`, `confirm_target=blue-signal-lab`, `confirm_static_type=STATIC_ASSETS_ONLY`로 실행합니다.
4. Actions → **BLUE Signal Lab R1.1.1 - KRX Alphanumeric Code EOD Hotfix** → `asof_date=2026-11-17`, `publish_to_d1=true`, `publish_diagnostic_only=false`로 실행합니다. 데이터 제공자의 동일 날짜 검증이 통과해야 정상 완료됩니다.
5. 오늘 날짜 데이터가 D1에 들어갔을 때 `/api/dates` 최신일이 2026-11-17인지 확인합니다. 검색 결과가 0건이더라도, 먼저 **해당 날짜 데이터가 실제 저장되었는지** 구분합니다.
6. 이후 검색/정밀분석에서 `225190`과 `LK삼양`을 각각 입력하여 종목명 검색, 조회, 요청 동작을 시험합니다.

## 꼭 확인할 두 가지

- 다른 제공 경로도 당일 일봉을 아직 공개하지 않았다면, 오늘 데이터를 만들어 내지 않습니다. 이 경우 `KRX_BOTH_PROVIDERS_PENDING`으로 중단되는 것이 올바른 동작입니다.
- 14:50 종가배팅을 시작하려면 장중 KIS 실측자료의 종목 수/지연/거래대금 확인, 잠정 상태와 확정 상태 구분, 마지막 15:18 후보 갱신 등의 별도 개발과 테스트가 필요합니다.
