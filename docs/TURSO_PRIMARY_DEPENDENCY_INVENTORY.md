# BLUE Signal Lab — Turso 주 DB 전환 / D1 데이터 보존 목록

> 2026-11-19 KST 기준 **소스코드 정적 점검**. 원격 운영 DB의 실제 행 수·완전성·현재 활성 Worker 플래그를 조회한 결과가 아닙니다.

## 왜 D1 중심 미러가 남았는가

초기 수집기 `collector/src/handler.mjs`는 D1을 조회하는 장바구니·검색 우선순위·기존 KIS 후보 수집을 실행합니다. 이 수집기가 **검증한 KIS 관측**을 `afterValidatedQuotes`에 넣고 `mirrorQuotesToTurso`로 Turso에 복제합니다. D1 테이블의 전체 행을 다시 읽는 미러는 아니지만, **D1 쿼터가 막혀 후보를 찾지 못하면 이 경로도 정상 동작할 수 없습니다.**

별도의 `collectTursoDirect`(Turso 연구 후보 기반 Cron)와 `collectTursoInstant`(사용자 클릭 KIS REST)는 D1 후보 조회 없이 Turso 시세를 저장할 수 있습니다. 그러나 두 경로는 독립적인 운영 플래그가 기본 OFF이며, 기존 서버 장바구니/AI/추적까지 Turso로 이동시킨 것은 아닙니다.

**결정:** 새 데이터의 검증·우선 저장소는 Turso로 이동합니다. `collector/wrangler.jsonc`의 전체 D1-기반 Turso 미러링 기본값을 **OFF**로 두고, 과거 코드·데이터는 이관과 검증 완료 전까지 보존합니다. 향후 Turso→D1 보조 쓰기는 D1 한도에 영향을 주지 않는 비차단·멱등·재시도 방식으로 별도 구현합니다. 토큰 발급 금고의 이중 저장 정책은 그대로 유지합니다.

**배포 보호:** `TURSO_MIRROR_ENABLED=false` 코드를 실제 Collector에 배포하면 이전에 돌아가던 D1 중심 Turso 미러까지 멈출 수 있습니다. 따라서 `.github/workflows/blue_r142_collector_deploy.yml`의 `deploy=true`는 이 모드에서 `confirm_mirror_off=blue-turso-mirror-off`도 필수입니다. 실 운영 Worker 변수·백그라운드 Turso 독립 수집 플래그를 먼저 확인하고, 장중 독립 시세 경로 실증 전에는 중단을 승인하지 않습니다.

## 남아 있는 D1 의존성 — 삭제 금지

| 업무 영역 | D1 표 / 읽기 경로 | Turso 현재 코드 범위 | 남은 작업 |
|---|---|---|---|
| 과거 검색·패턴 | `runs`, `signals`, `daily_counts`, `chart_snapshots` — `worker/src/index.ts`, `worker/src/ai.ts` | `blue_research_signals_v1`/감사 기록으로 **이관된 거래일만** 검색·차트 읽기 | 누락된 과거 날짜·원천 해시·파생 결과 이관 및 read-back 감사 |
| 확정 일봉 | 기존 스캐너 결과와 D1 검색 | `blue_eod_daily_v1` + `blue_eod_ingest_audit_v1`로 **감사된 날짜만** 읽기 | 날짜·종목 수·OHLCV 완전성 검증 후 범위 확대 |
| 장바구니 서버 추적 | `blue_basket_watch_r153`와 `signals` 검증 — `worker/src/performance.ts`, `collector/src/basket.mjs` | Turso 확정 일봉/KIS 시세의 **후속 가격 비교 읽기**는 가능 | 사용자 저장 기록은 보존하면서 서버 watch 등록·진행·고가 재처리 이관 |
| AI 시황 및 분석 요청 | `ai_analysis_cache`, `ai_daily_usage`, `blue_symbol_analysis_requests_v1`, `chart_snapshots` — `worker/src/ai.ts`, `worker/src/index.ts` | 감사 완료 연구 스냅샷 일부 조회 가능 | AI 캐시·과거 근거·원자 제한/요청 상태 Turso로 이동 |
| 종목 추적·기존 KIS 우선순위 | `blue_symbol_live_requests_v1`, `blue_search_quote_priority_r1594`, `blue_kis_first_seen_r154` 등 | 종목별 Turso KIS 즉시조회 + 저장 스냅샷 | 기존 D1 우선순위·등록/표시 경로 분리 |
| KIS 발급/복구 | `blue_kis_token_vault_v1` 및 발급 원장 | 같은 KIS 토큰을 Turso/D1에 이중 암호화 저장하도록 구현 | **중복 발급 방지 원장·수동 복구 정책 유지**. 앱 저장소 이관과 별개 |

※ 실제 운영 D1에 해당 행이 얼마나 남았는지, 모든 과거 날짜가 Turso에 없는지는 위 코드만으로 수치 확정할 수 없습니다. 특히 과거 자료를 삭제하거나 D1 바인딩을 제거하지 않습니다.

## 무해한 확인 수단

- [BLUE Turso Primary Readiness](../.github/workflows/blue_turso_primary_readiness.yml): 기본 `plan`은 **어느 DB에도 연결하지 않음**. `turso_recent`은 최근 감사된 EOD/연구 거래일 최대 각 8개와 최근 7일 중 KIS 저장일 최대 3개의 **Turso 집계만** 조회, 예상/실제 행 수의 일치 여부를 보고. D1 SQL 요청은 **0회**, KIS API 요청도 없습니다.
- 기존 [BLUE D1 Query Insights](../.github/workflows/blue_data_coverage_audit_readonly.yml)는 Cloudflare GraphQL Analytics에서 쿼리 사용량을 확인합니다. **D1 직접 SQL은 하지 않지만 D1 테이블의 정확한 행 수/이관 완료를 증명하지는 못합니다.**
- 기존 [Turso vs D1 KIS Quote Parity](../.github/workflows/blue_turso_quote_parity_audit.yml)는 기본 `turso_only`; `compare_small`만 별도 D1 소량 읽기 승인 문자열 필요. D1 쿼터 차단 중에는 실행하지 않습니다.

## 전환 순서와 완료 조건

1. **P0 — 안전:** 전체 구형 미러 기본 OFF, 신규 Turso 수집/즉시조회 독립 경로의 인증·토큰·장중 1종목 수신·Turso 저장 증명. 코드 병합과 운영 배포는 별개.
2. **P1 — 중요한 사용자 자료:** 서버 장바구니 watch, 종목 추적 기록·고가/현재가를 Turso에서 읽고 쓰도록 전환. 사용자 로컬 장바구니 ID·발견일·메모 유지. D1 실패를 강제 폴백으로 감추지 않음.
3. **P2 — 과거 패턴·분석:** 누락 날짜의 `signals`·`chart_snapshots`를 원천·건수·일치 해시로 이관 후 Turso 단독 과거 검색·AI/차트 검증. D1 원본은 보존.
4. **P3 — 보조 저장:** Turso 성공 → D1 멱등 복제 **비차단** → 별도 보류 원장과 재시도/키·값 정합 검사. D1 무료 사용량 차단에도 Turso 수집 성공 상태 유지. 실제 D1 백업 성공 여부 별도 노출.
5. 각 영역별 최신 시점·누락/오류·폴백 경로를 사용자에게 표시. **모든 영역을 한 번에 '전환 완료'라고 주장하지 않음.**
