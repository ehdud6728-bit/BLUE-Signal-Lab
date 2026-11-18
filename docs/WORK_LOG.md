# BLUE Signal Lab — 개발·운영 작업 기록

새 채팅에서 프로젝트를 이어가기 위한 **결정/구현/검증 이력**입니다. 대화 전체를 저장하지 않고 실제 개발에 필요한 내용만 보존합니다. 최신 항목을 위에 추가하고, 결과가 달라지면 추측 대신 검증된 상태로 수정합니다.

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
