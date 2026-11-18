# BLUE Signal Lab — 현재 프로젝트 상황

> 업데이트: 2026-11-18 (한국 시간). 이 파일은 개발 인계용 요약이며, 서버의 실시간 상태를 자동으로 반영하지 않습니다.

## 목표와 우선순위

- 국내 주식 전체 시장 검색, KIS 기반 시세 수집, 기술 신호, 과거 패턴 검증, 매물대 분석, 장바구니·종목 추적을 안정적으로 제공합니다.
- **정확한 최신 데이터의 지속적인 수집**이 최우선입니다. 초단타/실시간 매매 시스템이 아니므로 대략 1분 전 데이터도 허용하며, 빠르지만 누락되거나 오래된 가격을 최신으로 오인하는 상황은 피합니다.
- 비용, 데이터 용량, 장애 복구를 함께 고려합니다. 갑작스러운 유료 전환이나 운영 DB 교체를 피합니다.

## 현재 주요 구성

| 구성 | 저장소 경로 | 내용 |
| --- | --- | --- |
| API Worker | `worker/` | Cloudflare Workers API, D1 `DB` 바인딩 및 KIS 수집기 서비스 바인딩 |
| 주가 수집기 | `collector/` | Cloudflare Worker, KIS 수집·관찰 로직, D1 `DB` 바인딩 |
| 모바일/PWA | `web/` | 시세 검색·종목 추적·장바구니 UI |
| Actions | `.github/workflows/` | 배포, DB 관리, 진단 및 연구용 작업(실행 조건이 제각각임) |
| 운영 DB | Cloudflare D1 | `blue-signal-lab-db` |

## 현재 문제와 근거

- 2026-11-18에 D1 Free **읽은 행 하루 5,000,000행** 한도 초과 알림을 받았으며, 리셋 전 DB 읽기 요청이 실패했습니다. 기존 저장 데이터 삭제를 의미하지는 않습니다.
- GraphQL Analytics 리포트(2026-11-18 07:56 UTC 실행, 샘플링 추정치): UTC 2026-11-18 진행 중 5,104,591행, 직전 6일 합계 6,050,725행. UTC 00:00은 KST 오전 09:00입니다. 샘플링 집계와 실제 청구/한도 수치를 혼동하지 않습니다.
- 반복 조회 후보: `chart_snapshots`, `blue_kis_first_seen_r154`, `blue_search_quote_priority_r1594`, `sqlite_master`, `blue_kis_live_quotes_r141`. **원인 확정/인덱스 효과는 코드 및 추가 측정으로 검증해야 합니다.**
- D1 인덱스 최적화, 불필요한 중복 조회/쓰기 제거를 우선하고, DB 분리/이관은 데이터를 보존하면서 검증합니다.

## DB 방향 — 확정된 사용자 결정

1. D1을 당장 버리지 않고 **Turso를 병행 연결**합니다.
2. 2026-11-18에 Turso **libSQL** DB에 대한 비파괴 연결 검사가 성공했습니다([Actions #44276186275](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44276186275)). GitHub Actions Secrets는 설정됐지만 Cloudflare Worker의 Turso 인증/복제 활성화 여부는 별도입니다.
3. 다음은 Turso에만 테스트 테이블을 생성 → 5분 전체 수집 결과를 선택적으로 best-effort 복제 → 복구·재처리·건수/시각/값 일치 검증 → 제한된 읽기 전환 순서입니다. **복구 기능 검증 전 Turso 데이터를 완전한 보관본으로 취급하지 않습니다.**
4. 장기 원시 데이터/대용량 아카이브는 Google 등 별도 스토리지도 검토 중이나, **선정·배포 완료 상태가 아닙니다**. Cloudflare R2를 무료라고 가정하지 않습니다.
5. 주요 이력은 `docs/WORK_LOG.md`와 GitHub PR/Actions에 보존하여 새 채팅에서도 이어갑니다.

## 바로 다음 작업

1. 연결 검사는 **성공**함. 병행 저장 파일럿 PR을 검토하고 병합하더라도 `TURSO_MIRROR_ENABLED=false`를 유지합니다.
2. `BLUE Turso Mirror Schema Init (MANUAL)` Actions에서 `apply=true`를 수동 선택하여 **Turso에만** 시세 최신/히스토리 테이블 생성 후 결과를 확인합니다.
3. Turso 테이블 생성 성공 후 수집기 코드/Worker secrets/활성화 테스트 및 실패 기록을 확인하고, D1 대비 데이터 건수·시각·가격을 **소량 검증**합니다. 장기 누락을 막을 별도 재처리 정책을 구현하기 전에는 운영 데이터의 주 저장소로 전환하지 않습니다.
4. D1 읽기 행 사용량을 UTC 기준 매일 비교하고 쿼리/인덱스 최적화 전후 차이를 관찰합니다.

## 참고

- GitHub: `https://github.com/ehdud6728-bit/BLUE-Signal-Lab`
- 최신 실제 배포 및 실행 결과는 GitHub의 `main` 커밋, PR, Actions와 Cloudflare 대시보드에서 확인합니다.
