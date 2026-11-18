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

1. D1을 당장 버리지 않고 **Turso를 병행 연결**합니다. **2026-11-18 사용자 추가 결정:** 최종 목표는 **Turso 주 DB / D1 보조 DB**, 가능한 범위에서 **동일한 검증된 업무 데이터**를 유지합니다. 현재는 전환 전 단계이며, Turso에 유효 데이터가 저장·검증되기 전까지 D1 원본을 유지합니다.
   - 최종 쓰기 경로: KRX/KIS 한 번 수집·검증 → Turso 기록 및 동기화 이벤트 → D1에 멱등 복제. 이력/누락 재처리와 행 수·키·값 일치 검증을 필수로 합니다. 두 독립 DB의 동시 트랜잭션은 보장되지 않으므로 복제 지연을 표시합니다.
   - 최종 읽기 경로: Turso 우선, 장애 시 **마지막 검증된 D1 시점과 데이터 날짜를 명시**하는 읽기 전용 폴백. Turso 장애 중 D1에 독립 쓰기를 허용해 충돌시키지 않습니다.
   - `runs`, `signals`, `chart_snapshots`, 일봉·시세·장바구니·분석·종목목록은 업무 데이터 복제 후보입니다. Lock, 캐시, KIS 암호화 토큰·비밀값, Worker 런타임 상태는 각 시스템 책임 하에 분리합니다.
   - **무료 용량 제약:** D1 무료는 단일 DB 최대 **500MB**(계정 합계 5GB), Turso 무료는 총 5GB 수준이므로 모든 과거 대용량 데이터를 D1에 영구히 완전 복제할 수 있다고 가정하지 않습니다. 용량에 앞서 별도 아카이브/유료 전환 여부를 검토해야 합니다.
2. 2026-11-18에 Turso **libSQL** DB에 대한 비파괴 연결 검사가 성공했습니다([Actions #44276186275](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44276186275)). Turso 스키마 생성([#44278060936](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44278060936)), Cloudflare Collector Worker에 Turso Secrets 설치([#44279139920](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44279139920)), Collector 실배포([#44279762372](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44279762372))도 성공했지만 **복제 기본값은 OFF**입니다.
3. 제한된 병행 저장을 위한 수동 파일럿은 **15분/30분 자동 만료 + 5분 수집당 최대 2종목**으로 설계합니다. 실제 적용은 파일럿 코드 병합·재배포 후 수동 Actions 실행이 필요합니다. 이후 복구·재처리·건수/시각/값 일치 검증 → 제한된 읽기 전환 순서입니다. **복구 기능 검증 전 Turso 데이터를 완전한 보관본으로 취급하지 않습니다.**
4. 장기 원시 데이터/대용량 아카이브는 Google 등 별도 스토리지도 검토 중이나, **선정·배포 완료 상태가 아닙니다**. Cloudflare R2를 무료라고 가정하지 않습니다.
5. 주요 이력은 `docs/WORK_LOG.md`와 GitHub PR/Actions에 보존하여 새 채팅에서도 이어갑니다.

### 장외 EOD → Turso 소량 실데이터 검증 (신규 수동 경로)

- 기존 `blue_market_scan_research_only.yml`의 EOD 검증 성공 후 같은 `SYMBOL_DIRECTORY.json`를 사용하는 **Turso 단독 12종목 파일럿**을 추가합니다. 새 입력 `turso_directory_mode` 기본값은 `off`; `dry_run`은 외부 DB 호출이 없고, `apply_12`만 **Turso에 최대 12개 종목명**을 `blue_symbol_directory_v1`에 멱등 기록·키별 재검증합니다. D1 SQL 실행·KIS API 호출·Worker 배포·주/보조 DB 전환은 없습니다. 단, 기존 EOD 스캔은 원천 자료를 내려받으므로 데이터 제공처 준비 상태에 좌우됩니다.
- 이 기능은 기존 5분 수집기를 기다리지 않고 장 마감 이후 **실제 검증된 종목 데이터를 Turso에 저장할 수 있는지** 확인하는 분리된 파일럿입니다. 전체 동일 데이터 복제, 일봉/차트/시그널 복제, 누락 복구, 읽기 전환은 **구현되지 않았습니다**. 기존 EOD 수집/검증 실패를 임의 데이터로 보완하지 않습니다.
- 권장 수동 순서: `asof_date=latest`, `publish_to_d1=false`, `publish_diagnostic_only=false`, `turso_directory_mode=dry_run` → 검증 성공 및 감사 수치 확인 → 별도 사용자 승인으로 `apply_12` 실행 → Turso 결과 12개 검증. `apply_12`를 선택해도 D1은 건드리지 않습니다. `publish_to_d1=true`는 별도의 운영 쓰기 선택입니다.

## 바로 다음 작업

1. Secrets 설치와 Collector 실제 재배포까지 성공했습니다. 단, [Mirror Status #44279543275](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44279543275)의 0행은 복제 OFF 상태에서의 결과로 정상입니다.
2. PR #15 병합·Collector 재배포([#44284567795](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44284567795)) 및 제한 파일럿([#44284901016](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44284901016))은 성공했습니다. 하지만 [Turso Status #44286642943](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44286642943)에서 파일럿 중에도 **0행**입니다. 원인은 아직 미확정이며, 정상 복제 증거가 없습니다.
3. 먼저 **운영 D1을 추가 조회하지 않고** Cloudflare Collector 상태 로그(`BLUE_R142`, `BLUE_TURSO_MIRROR`)로 `후보 없음/토큰 문제/시세 무효/수집 오류/Turso 쓰기 오류`를 구분합니다. [Tail 실행 #44296117467](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44296117467)은 KST **20:36~20:43 거래시간 종료 후** 시행돼 0건이며, 종료 코드 처리의 오탐 실패도 확인돼 개선 중입니다. **다음 거래일 09:00~15:20에 7분 라이브 진단을 다시 실행**해야 원인을 구분할 수 있습니다.
4. D1 대비 데이터 건수·시각·가격을 **소량 검증**하고 장기 누락을 막을 재처리 정책을 구현하기 전에는 운영 데이터의 주 저장소로 전환하지 않습니다.
5. D1 읽기 행 사용량을 UTC 기준 매일 비교하고 쿼리/인덱스 최적화 전후 차이를 관찰합니다.

## 참고

- GitHub: `https://github.com/ehdud6728-bit/BLUE-Signal-Lab`
- 최신 실제 배포 및 실행 결과는 GitHub의 `main` 커밋, PR, Actions와 Cloudflare 대시보드에서 확인합니다.
