# BLUE Signal Lab — 개발·운영 작업 기록

새 채팅에서 프로젝트를 이어가기 위한 **결정/구현/검증 이력**입니다. 대화 전체를 저장하지 않고 실제 개발에 필요한 내용만 보존합니다. 최신 항목을 위에 추가하고, 결과가 달라지면 추측 대신 검증된 상태로 수정합니다.

## 2026-11-19 (KST) — Turso 224일선 준비용 검증 일봉 커버리지 조회 코드

- **이어서 진행할 단계:** 2026-11-18 화면에서 Turso의 2,660개 종목 검색과 기존 장바구니가 확인됨. 화면은 상태 공유이며, 장바구니 가격 공백은 이번 단계에서 수정 요청된 것이 아님. 이미 저장된 8거래일을 기반으로 112/224 이동평균·과거 패턴을 곧바로 계산하지 않음.
- **이번 코드:** `tools/turso/eod-history-coverage.mjs` 및 테스트, 수동 `.github/workflows/blue_turso_eod_history_coverage.yml` 추가. 일자별 검증 완료 감사 최대 600개와 가장 최근 일자 실제 건수만 조회하여 최신/최초 검증일, 최소 225거래일까지 부족한 수, 중간의 *미검증 평일 후보*, 다음 10일 이하 과거 수집 검토 구간을 요약함. 휴장일을 미수집일로 단정하지 않음.
- **영향/안전:** Turso 대상 `SELECT` 2회만 실행하며 D1/수집기/KIS/Worker/웹/장바구니 데이터 쓰기·배포는 없음. 자동 시세 채우기, 실제 224일선 계산도 하지 않음. GitHub Secrets를 출력하지 않음.
- **운영 반영:** PR 병합 후 수동 Actions 실행으로 실제 Turso의 완료일 수를 확인해야 함. 이 로컬 작성은 운영 DB를 읽거나 변경한 것이 아님.
- **후속:** `READ ONLY` 커버리지 결과를 기준으로 검증된 KRX EOD 수집 워크플로를 기간별 `dry_run` → 사용자 선택 `apply`로 확장. 거래소 휴장일/종목별 이력/수정주가 검증 후 112·224일선 엔진을 별도 PR로 진행.

## 2026-11-18 (KST) — Turso 일봉 종목명 미표시 수정 준비

- **실제 사용자 화면:** Turso 2026-11-16 확정 일봉이 2,661종목으로 조회되지만 `000660 000660`, `005930 005930`처럼 종목코드가 두 번 보임. 장바구니 탭과 기존 장바구니 종목은 보존해야 함.
- **원인:** 날짜별 가격 수집기 `pykrx_verified_day`의 검증된 OHLCV에 `Name=''`가 들어오며, EOD 임포트는 이를 원본 그대로 저장. 기존 PWA가 빈 이름을 코드로 치환했으므로 가격 데이터 오류 또는 종목명 자체의 증빙이 아님.
- **수정 코드:** EOD 일자별 감사·해시·가격 저장 테이블을 **수정하지 않고**, 별도 `blue_symbol_directory_v1`에 검증된 종목명 디렉터리 전체를 명시적인 수동 `apply_all`로 저장·50개씩 재검증하는 경로를 추가. `/api/eod/search`는 별도 이름 디렉터리를 `code+market`으로 LEFT JOIN하여 종목명 검색/표시. 디렉터리 없으면 EOD 원본을 조회하되 종목명은 '미등록'으로 표시. 종목명은 디렉터리 기준일의 이름이므로 과거 상호 변경을 반영하지 않을 수 있음.
- **보존/운영:** 기존 D1 테이블, 장바구니, 추적, AI 분석, 기존 Turso OHLCV 및 일자별 감사 해시를 건드리지 않음. 코드 PR 병합만으로 DB에 이름이 생기거나 운영 Worker가 배포되는 것은 아님. 순서: EOD 연구용 Actions `dry_run` → **사용자가 명시적으로** `apply_all`(D1 게시 두 옵션 false) → API Worker 수동 배포 → 기존 웹 안전 배포. 각 단계 완료 후 이름/코드 검색을 확인.
- **운영 반영 선행 확인:** 사용자 [API 배포 #44314992912](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44314992912), [웹 배포 #44315819434](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44315819434) 성공 후의 실제 휴대폰 화면에서 이 현상이 관측됨. 새 수정 버전은 별도의 DB 이름 입력/API·웹 배포 전까지 적용되지 않음.
- **새 수정 로컬 검증:** Turso 디렉터리 테스트 7/7, Turso API 테스트 8/8, 워크플로 회귀 4/4, 웹 TypeScript+Vite 빌드, API Worker Wrangler `deploy --dry-run`, YAML 파싱 및 `git diff --check` 모두 성공. 실제 Turso 이름 전체 입력과 운영 API/웹 배포는 아직 실행하지 않음.

## 2026-11-18 (KST) — Turso 확정 일봉 조회·D1 장애 폴백 준비

- **요청/결정:** D1 무료 읽기 제한 중 앱을 최대한 활용하도록 Turso에 들어 있는 검증된 자료부터 PWA에서 조회. **Turso 우선**, Turso 장애 시 기존 **D1 분석 UI로 자동 폴백**; D1도 실패하면 양쪽 모두 장애로 알림. 하나의 DB가 정상이더라도 두 DB의 데이터 완전 일치라고 표시하지 않음.
- **실제 선행 결과:** [EOD 수동 적용 #44310029226](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44310029226)은 2026-11-09~18의 **8거래일·21,296건** 정확한 KRX 일봉을 Turso에 `apply`해 날짜별 read-back에 성공(`BLUE_TURSO_EOD_RANGE_OK`). D1 변경 없음.
- **이번 코드:** API에 `/api/eod/dates`, `/api/eod/search` 읽기 전용 추가, 감사 완료된 날짜만 검색·정확한 종가/시가/고가/저가·거래량·원화 거래대금 제공. 기존 `/api/search` 및 D1 바인딩 변경 없음. 웹에는 별도 Turso 확정 일봉 검색 화면을 제공하고, Turso 실패/미설치 시 기존 D1 검색으로 폴백. 전용 화면은 신호·패턴 승률·이동평균선 계산을 제공하지 않으며 다른 탭은 D1 의존임.
- **배포 안전:** 새 `.github/workflows/blue_turso_api_eod_deploy.yml`은 기본 `verify_only`, 명시 `deploy_api`+정확한 Worker 이름 재입력 시에만 기존 API Worker에 두 개의 Turso 비밀값 설치 및 배포. 웹은 기존 검증형 정적 배포 Actions를 별도 수행. 운영 DB SQL·수집기·Cloudflare 배포는 **이 PR에서 실행하지 않음**.
- **로컬 검증:** 새 Turso 읽기 테스트 **7/7** 통과. API Worker Wrangler 번들 `deploy --dry-run` 성공(D1·KIS 서비스 바인딩 보존 확인), 웹 `npm run build` 성공, YAML 파싱·`git diff --check` 성공. 기존 전체 Node 회귀 **80/81** 통과: `tests/test_ai_api.mjs`의 SQL mock 미지원은 `worker/src/ai.ts`/해당 테스트를 이번에 변경하지 않았고, 수정 이전 별도 기존 worktree에서도 같은 오류로 재현됨. 기존 AI 테스트 실패를 신규 Turso 변경 원인으로 오인하지 않음. Turso 이력을 224거래일 이상 확보하고 기술 지표/패턴/추적 관련 데이터를 이관하기 전까지 정상 분석 전체 복구를 주장하지 않음.
- **다음:** PR 병합 → `verify_only` 실행 → 확인 후 `deploy_api` 실행 → API의 Turso 날짜/종목 조회 확인 → 웹 안전 배포 → 휴대폰에서 Turso 우선 및 장애 시 D1 폴백 검증. 이후 정확한 과거 일봉 범위 확장과 신호 엔진 이전.

## 2026-11-18 (KST) — Turso 일봉 11월 9~18일 전체 종목 저장 경로 준비

- **사용자 우선순위 변경:** 현재는 D1/Turso 값 일치 검사보다 **주 DB 예정 Turso에 검증된 일봉을 누락 없이 저장**하는 데 집중. 기존 D1 읽기/쓰기 경로는 유지하며 Turso 우선 읽기·복제 전환은 후순위로 둠.
- **기간:** 2026-11-09~2026-11-18(10일, 주말 제외 평일 **8일**). 정확히 요청한 날짜의 KRX 일봉만 허용. 원천 사이트 준비가 안 된 날이 있으면 **전체 저장 시작 전 실패**; 11월 16일 데이터를 17·18일로 대체하지 않음.
- **새 수동 워크플로:** `.github/workflows/blue_turso_verified_eod_range.yml`, 기본 `dry_run`, 명시적 `apply`만 Turso에 쓰기. `scripts/turso_verified_eod_range.py`는 기존 `market_scan_r11.py`의 pykrx + KRX OpenAPI 날짜·시장 검증을 재사용, 날짜별 약 1,700개 이상 거래 종목의 비조정 OHLCV 및 거래대금, 출처, SHA256을 보존. 보관 파일은 `manifest.json`+`daily.jsonl`.
- **Turso 저장:** `tools/turso/eod-range-import.mjs`는 전체 파일·날짜·날짜별 해시·종목코드·OHLC 범위를 저장 전 독립 검증. `blue_eod_daily_v1` `(trade_day,code)` 기본키로 멱등 삽입, 재실행 시 일치하는 기존 행은 유지. 기존 값이 다르면 **자동 수정하지 않고 실패**. 날짜별 실제 read-back과 `blue_eod_ingest_audit_v1` 완료 기록을 남김. 장애로 일자 일부만 입력됐어도 수동 재실행 가능.
- **명확한 범위:** 데이터 수집/정확성/저장부터 시작. D1 데이터 비교, D1 SQL 실행, 운영 DB 교체, 자동 스케줄·앱 조회 변경, KIS 주문 모두 하지 않음. **아직 실제 Turso에 일봉이 저장됐다는 뜻이 아님**; PR 병합 후 GitHub Actions `dry_run` 및 소스 준비 확인, 이어서 `apply`가 필요.
- **로컬 검증:** Python 8/8, Node 5/5 단위 테스트 통과(정확한 8개 평일, 원천 오류 중단, KRX Open API 영문 혼합 우선주 코드·정확한 날짜 보존, 무거래 제외, 기간/해시 변조 거부, DB 없는 dry-run, 동일행 재실행 및 기존값 불일치 중단). YAML 수동 입력 파싱 통과. 실제 KRX·Turso 접속은 아직 실행하지 않음.
- **후속:** PR 병합 후 `dry_run`으로 실제 날짜별 원천 검증·행수·해시 로그 확인 → 성공 시 `apply` 실행 → 실제 DB 행수/날짜별 완료 기록 확인. 소스 미준비일이 있으면 끝 날짜를 줄여 검증 완료 날짜부터 단계적으로 저장할 수 있으나, 미확인 일자를 성공으로 표시하지 않음.

## 2026-11-18 (KST) — EOD Turso 파일럿 `off` 기본값 안정화 및 수동 `dry_run` 성공

- **발견된 오류:** [Actions #44304329101](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44304329101)에서 YAML의 따옴표 없는 `off`가 불리언 `false`로 해석됨. 기존 `!= 'off'` 조건이 참이 되어 의도하지 않은 Turso 파일럿 단계가 시작되고 `INVALID_PILOT_MODE`로 종료. 일봉 스캔은 성공했으며 Turso/D1 실제 기록 없음.
- **정상 수동 검증:** [Actions #44304379580](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44304379580)에서 `dry_run` 성공. 2026-11-16 기준 일봉 관측 종목 2,611개, 신호 114개, 검증된 종목 디렉터리 2,721개. `TURSO_EOD_DIRECTORY_DRY_RUN ... written=0`을 확인했고 D1 발행은 건너뜀. 이는 Turso 실제 쓰기 성공을 의미하지 않음.
- **이번 수정:** `off` 및 선택값을 문자열로 명시하고 Turso 설치/테스트/쓰기 단계의 실행 조건을 **`dry_run` 또는 `apply_12`인 경우에만**으로 제한. YAML 암묵적 불리언과 비정상/미전달 값에서 안전하게 건너뜀. 회귀 검사 추가.
- **바로 다음:** 수정 PR 병합 후 `off` 기본 실행을 다시 확인. 이후 사용자 선택 시에만 `apply_12`로 Turso 실제 12종목 삽입/조회 검증. 최신 일봉이 2026-11-16까지인 문제는 별도 데이터 갱신 점검이 필요함. **Turso 주 DB 전환과 운영 D1 쓰기 변경 없음.**

## 2026-11-18 (KST) — Turso 주 DB / D1 보조 DB 목표 확정, 장외 EOD Turso 12종목 파일럿 준비

- **사용자 결정:** 두 독립 DB에 검증된 업무 데이터를 가능한 동일하게 보존하되, 최종 **Turso를 주 DB, D1을 보조 DB**로 운영. 즉시 전환하지 않고 실제 저장·대조·누락 재처리 및 읽기 장애 폴백을 검증한 뒤 전환합니다. 무료 D1 단일 DB 용량 제한(500MB) 때문에 영구 완전 복제를 무제한 약속하지 않습니다.
- **이번 코드:** `.github/workflows/blue_market_scan_research_only.yml`에 수동 `turso_directory_mode=off|dry_run|apply_12` 입력 추가. 기존 검증된 `SYMBOL_DIRECTORY.json`를 `tools/turso/eod-directory-pilot.mjs`가 전체 검사 후 코드 순 최대 12개만 Turso의 동일 이름 테이블 `blue_symbol_directory_v1`에 멱등 UPSERT, 정확한 키로 소량 read-back 검증. 기본 off이며 **D1 SQL/Worker 배포/운영 전환 없음**.
- **분리된 단계:** 파일럿은 실제 종목명 저장 통신 테스트이고 `runs`·`signals`·`chart_snapshots` 및 과거 대용량 자료의 전체 미러와는 다릅니다. 현재 Turso 0건 원인은 여전히 미확정. 새 경로 성공을 5분 시세 복제 성공으로 해석하지 않습니다.
- **로컬 테스트:** Turso 파일럿 Node 테스트 **5/5** 통과, GitHub Actions YAML 파싱 및 `git diff --check` 통과. 실제 Turso DB 쓰기와 D1 운영 DB 조회는 실행하지 않았습니다.
- **바로 다음:** PR 병합 후 EOD 스캔 `dry_run` → 검증 성공 시 수동 `apply_12` → Turso 입출력 확인 → 운영 D1 데이터 백필·재시도 큐·전량 정합성 검사·Turso 우선 읽기 기능을 순차 구현. **사용자 승인 없이 즉시 운영 DB를 바꾸지 않음**.

## 2026-11-18 (KST) — 진단 Actions 야간 실행 / 7분 종료 판정 개선

- **실행 확인:** [Collector Runtime Tail #44296117467](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44296117467), UTC 11:36~11:43 = **한국 시간 20:36~20:43**, 거래 시간 종료 후. 로컬 필터 테스트 4/4 통과; 7분 수집 결과 `full_runs=0 mirror_events=0 provider_summaries=0 warnings=0`. **장중 수집 실패의 증거는 아님.** Cloudflare Worker Tail 원문은 보안상 출력되지 않았으며 D1 SQL 실행 없음.
- **진단 Actions 자체의 결함:** 정해진 7분이 정상적으로 지나도 `timeout`/`wrangler tail` 종료 코드가 기존 허용 목록(`0`, `124`, `130`)에 없으면 실패 처리됨. 이번 실행도 약 7분 후 이 조건에서 종료됐으나 실제 코드 값은 기존 로그에 없어서 미확정. Tail 권한이 없었다고 단정하지 말 것.
- **개선 PR:** [#17 — Collector 로그 진단 정상 종료 오탐 수정](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/pull/17). 시작/종료 시각과 종료 코드(숫자만)를 출력하고, 정상 관측 시간에 도달했다면 신호에 따른 종료 코드가 달라도 **정상 관측 종료**로 처리. 권한 오류 등으로 조기 종료하면 실패 상태 유지. 운영 D1 조회·Worker 배포·시세 요청 없음.
- **바로 다음 작업:** 수정 PR 병합 → **다음 거래일 KST 09:00~15:20 중** 7분 로그 진단 수동 실행 → `BLUE_R142` 상태/원인을 토대로 수정. 현재 Turso 0건 원인은 여전히 미확정이며, 만료된 파일럿을 근거 없이 재시작하지 않음.

## 2026-11-18 (KST) — 수집기 재배포·Turso 파일럿 실행 성공, 실제 복제 0건 진단

- **확인 완료:** [PR #15](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/pull/15) 병합 후 [Collector 실배포 #44284567795](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44284567795)에서 수집기 테스트 40/40, Wrangler 실배포 및 KIS Secrets 설치 성공. 일반 Turso 복제는 OFF.
- **파일럿 재시작:** [#44284901016](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44284901016)에서 `start_15m` 성공. UTC 10:38:32.778 (= KST 19:38:32) 자동 만료, 회당 최대 2종목 제한.
- **관측:** [Turso Status #44286642943](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44286642943), UTC 10:34 (= KST 19:34) `latest_symbols=0 history_rows=0`. Turso SQL 읽기는 정상이며 **실제 복제 성공은 아직 확인되지 않음**.
- **원인 미확정:** 수집 자체의 `PAUSED_NO_FRESH_CANDIDATES`, `PAUSED_TOKEN_EXPIRED_OR_MISSING`, `NO_VALID_QUOTES`, `COLLECTOR_ERROR` 또는 Turso 비동기 오류 여부를 먼저 분리해야 함. Google OAuth/Turso 웹사이트 로그인 거부가 이 0건의 직접 원인이라는 근거 없음.
- **이번 진단 PR:** [#16 — D1 SQL 없이 Collector 실시간 상태 로그로 원인 진단](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/pull/16). `.github/workflows/blue_r142_collector_tail_diagnostic.yml`에 수동 3/7분 **Cloudflare Worker 실시간 로그 읽기만** 수행하는 Actions 추가. `collector/tools/tail-diagnostic.mjs`는 `BLUE_R142`·`BLUE_TURSO_MIRROR`의 정해진 상태 코드/숫자만 출력하며 토큰, SQL, 요청 URL, KIS 응답 원문은 버림. `collector/src/core.mjs`는 상태 코드의 안전한 원인 필드(`NO_VERIFIED_CANDIDATES`, `STALE_OR_FUTURE_EOD`, `SANITIZED_RUNTIME_FAILURE`)를 출력해 문제 원인 분류 향상. 이 진단은 **운영 D1 SQL 실행 없음**, 시세 수집을 인위적으로 실행하지 않음.
- **주의:** Cloudflare Wrangler `tail`은 **미래의 실시간 로그**만 받아오므로 5분 수집 시점 포함 7분 캡처를 권장. 과거 수집 실패를 소급해 조회하지 못함. 코드 병합/재배포 전에는 새 `reason` 필드가 없을 수 있으나 구버전 상태 요약도 파싱 가능.
- **로컬 검증 완료:** 수집기 `npm test` **44/44** 통과(진단 로그 필터 4개 테스트 신규), Wrangler `npm run build:check` dry-run 성공(`TURSO_MIRROR_ENABLED=false` 유지). GitHub Actions YAML 파싱 성공. **Cloudflare 실시간 tail은 아직 실행하지 않았으며 운영 Worker도 변경하지 않음.**
- **후속:** 진단 PR 병합 → (필요시) Collector 재배포 후 한국 주식시장 거래 시간에 읽기 전용 진단 Actions 실행 → `BLUE_R142` 상태와 Turso 복제 결과로 실제 원인 확정 → 최소 범위 수정 및 재검증. 무근거 전체 복제 재실행/DB 이관 금지.

## 2026-11-18 (KST) — 수집기 실제 배포 성공 / 자동 만료 Turso 소량 복제 파일럿 준비

- **확인 완료:** [Secrets 설치 #44279139920](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44279139920)에서 Cloudflare Worker Turso Secrets 두 개 등록 성공. [Turso 상태 확인 #44279543275](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44279543275)에서 최신/이력 모두 0행(복제 OFF이므로 정상). [Collector 실제 배포 #44279762372](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44279762372)에서 테스트 37개/드라이런 성공, 운영 `blue-market-collector`에 실제 배포 성공. 당시 `TURSO_MIRROR_ENABLED=false`.
- **사용자 승인:** D1을 기본 저장소로 유지하고 Turso는 실제 종목 중 소량만, 기간이 지나면 자동 종료되는 파일럿을 준비하기로 함.
- **이번 코드:** `TURSO_MIRROR_PILOT_UNTIL_UTC`라는 Worker Secret에 미래 UTC 종료 시각을 넣으면 `TURSO_MIRROR_ENABLED=false` 상태에서도 최대 **30분간** `PILOT` 모드로 동작. **5분 전체 수집 완료 건당 앞의 최대 2종목**만 Turso 테이블 두 곳에 쓰며, 만료 후 추가 작업을 자동 차단. 독립된 `FULL` 모드는 기존처럼 배포 설정을 명시적으로 `true`로 바꿀 때만 사용 가능.
- **수동 Actions:** `.github/workflows/blue_turso_mirror_pilot.yml`(기본 `dry_run`, `start_15m`, `start_30m`, `stop`; 대상 Worker 이름 확인 필수). Cloudflare의 종료 시각 Secret만 갱신할 수 있으며, 배포 버전이 새로 생성될 수 있음. D1 SQL 없음.
- **작업 PR:** [#15 — 15/30분 자동 종료·최대 2종목 Turso 복제 파일럿](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/pull/15) (게시 완료, 아직 병합 전). 작업 브랜치 `codex/turso-timeboxed-pilot-20261118`. 새 파일럿 코드의 운영 배포나 실제 복제 **아직 하지 않음**. 병합 → 기존 수집기 배포 Actions로 새 코드 운영 반영 → 사용자 수동 파일럿 시작 순서를 지킴.
- **로컬 검증 완료:** Collector Node 테스트 **40/40 통과**(엄격한 30분 시한, 회당 2건, 만료 시 연결 없음 포함). `npm run build:check` Wrangler dry-run 성공, 빌드 바인딩에서 `TURSO_MIRROR_ENABLED="false"` 확인. GitHub Actions 파일 YAML 파싱 성공. **운영 Worker 재배포/실제 Turso 저장은 별도이며 미실행.**
- **후속:** 장중 소량 복제 확인 → Turso-only Status로 건수/시각 확인 → D1 대비 정확한 일치 확인 및 누락 재처리 큐 설계. 파일럿은 연속/완전한 보관이 아니며 운영 읽기 전환 근거로 사용하지 않음.

## 2026-11-18 (KST) — Turso 테이블 생성 성공 / Worker 인증·상태 점검 준비

- **확인 완료:** [GitHub Actions #44278060936](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44278060936) 성공. `TURSO_MIRROR_SCHEMA_READY: two tables verified, no stock rows inserted` 로그 확인. 사용자가 `apply=true`로 실제 Turso 스키마를 생성함.
- **작업 PR:** [#14 — Turso Worker 시크릿 수동 설치·상태 점검](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/pull/14). 병합 및 배포 상태는 실제 PR/Actions에서 확인할 것.
- **준비:** `blue_turso_collector_secrets.yml`(기본 아무 작업 없음, 명시적 승인 시 Turso 인증 두 개만 Worker에 등록), `blue_turso_mirror_status.yml`(Turso 한국 날짜 당일 건수/최신 수신 시각만 조회), `tools/turso/mirror-status.mjs`.
- **운영 상태:** D1은 계속 원본. Turso 테이블 생성 성공, **현재 복제 플래그 OFF**. Worker 인증 등록/실제 데이터 복제/누락 복구는 아직 확인되지 않음.
- **후속:** PR 병합 → 기본 `apply=false` 워크플로 확인 → 사용자 선택 시 Worker Secrets 설치 → 상태 점검 → 제한된 수집 파일럿과 D1 대비 일치 검증 및 누락 재처리 설계.

## 2026-11-18 (KST) — Turso 연결 성공 / 병행 저장 파일럿 코드 준비

- **검증 성공:** [GitHub Actions #44276186275](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44276186275)에서 `TURSO_CONNECTION_OK` 확인. `SELECT 1` 실행 성공, GitHub Secrets 인식, D1 SQL 없음.
- **작업 PR:** [#13 — Turso 병행 저장 파일럿 준비](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/pull/13). 이 기록 시점은 **미병합/미배포**이며, 실제 상태는 PR과 Actions를 확인할 것.
- **이번 변경:** `collector/src/turso-mirror.mjs`(5분 전체 수집분을 Turso에 idempotent UPSERT + INSERT OR IGNORE), `collector/src/handler.mjs`/`core.mjs`(D1 저장 완료 후 별도 비동기 작업), `collector/wrangler.jsonc`(Turso 복제 OFF 기본값), `tools/turso/mirror-schema.sql` 및 수동 생성 워크플로 추가.
- **안전 범위:** 운영 D1 쓰기 로직과 KIS 수집 경로는 계속 원본. Turso 쓰기 실패는 D1 성공을 취소하지 않음. Cloudflare 배포, Turso 스키마 생성, 실제 병행 복제는 **아직 실행하지 않음**.
- **검증:** 수집기 Node 테스트 37/37 통과; Wrangler `deploy --dry-run` 성공; 인메모리 SQLite에서 Turso 테이블 DDL을 두 번 실행해도 성공(재실행 안전).
- **남은 문제:** best-effort 복제는 Turso 장애 동안 누락된 과거 데이터를 재전송하지 못함. 이것은 장기 안정성 보장의 미완료 항목이며 읽기 전환 이전에 반드시 보완 필요.
- **다음:** PR 병합 → Turso `apply=true`로 테이블 생성 → 기본 OFF 상태 유지하며 비밀 값/코드 배포 검증 → 데이터 일치·누락 재처리 개발.

## 2026-11-18 (KST) — Turso 병행 연결 준비 + 자동 인계 문서 도입

- **목표:** 기존 D1/API/수집기 안정성을 유지하면서 Turso와 통신이 가능한지 먼저 검증. 채팅이 바뀌어도 GitHub 기록으로 개발을 이어가기 위한 구조를 마련.
- **작업 PR:** [#12 — Turso 연결 수동 테스트 + GitHub 인계 기록 체계 추가](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/pull/12). 운영 반영 여부는 PR 병합 상태를 확인해야 함.
- **추가:** `.github/workflows/blue_turso_connection_test.yml`, `tools/turso/`, `AGENTS.md`, `docs/PROJECT_CONTEXT.md`, `docs/WORK_LOG.md`.
- **안전 범위:** Turso 쪽 `SELECT 1` 연결 검사만 허용. Cloudflare D1에 SQL 실행 없음. 시세 복제, 스키마 생성, 운영 전환 없음. GitHub Secrets 미설정 상태에서는 실패하도록 설계.
- **실제 연결/배포 여부:** PR 검토·병합과 비밀 값 등록 후 Actions 실행 결과로 판단. 코드를 추가한 것만으로 Turso가 연결된 것은 아님.
- **후속:** Turso DB 생성 → GitHub Secrets 설정 → 수동 연결 테스트 → 성공 결과 기록 → 데이터 복제 정책 및 일치 검증 설계.

## 2026-11-18 (KST) — D1 사용량 분석 및 대응

- GraphQL Analytics를 이용한 **읽기 전용** 사용량 진단 수행: [GitHub Actions 실행 44262816647](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44262816647).
- 리포트 실행 기준 UTC 2026-11-18 진행 중 읽은 행 5,104,591, 이전 6일 합계 6,050,725. 계정/대상 DB 값 동일. Analytics는 샘플링 기반이므로 실제 무료 한도 카운터와 직접 동일시하지 않음.
- 반복 비용이 큰 쿼리 유형: `chart_snapshots`, `blue_kis_first_seen_r154`, `blue_search_quote_priority_r1594`, `sqlite_master` 등.
- D1 무료 행 읽기 한도 초과 알림 수신. 운영 DB에 진단용 SQL을 직접 실행하는 방식을 피하기로 결정.
- 사용자는 우선 인덱스/중복 조회 개선과 다음 날 재발 관찰, 이어서 기존 계획 개발을 원함.

## 장기적으로 계속 적용할 운영 원칙

- 데이터의 일관성·신뢰성이 실시간 초저지연보다 중요함(약 1분 지연 허용).
- DB를 즉시 교체하지 않음. Turso는 검증된 병행 수단으로 단계적 도입.
- 새로운 기능과 운영 변경이 발생한 경우 같은 PR/커밋에서 이 작업 기록을 보완.
