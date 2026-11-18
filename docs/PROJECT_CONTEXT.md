# BLUE Signal Lab — 현재 프로젝트 상황

> 업데이트: 2026-11-19 (한국 시간). 이 파일은 개발 인계용 요약이며, 서버의 실시간 상태를 자동으로 반영하지 않습니다.

## 목표와 우선순위

- 국내 주식 전체 시장 검색, KIS 기반 시세 수집, 기술 신호, 과거 패턴 검증, 매물대 분석, 장바구니·종목 추적을 안정적으로 제공합니다.
- **정확한 최신 데이터의 지속적인 수집**이 최우선입니다. 초단타/실시간 매매 시스템이 아니므로 대략 1분 전 데이터도 허용하며, 빠르지만 누락되거나 오래된 가격을 최신으로 오인하는 상황은 피합니다.
- 비용, 데이터 용량, 장애 복구를 함께 고려합니다. 갑작스러운 유료 전환이나 운영 DB 교체를 피합니다.

## 현재 주요 구성

**2026-11-19 Turso 패턴 검색 읽기 전환 PR (운영 미배포):** [Actions #44351153148](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44351153148)에서 2026-11-18 연구 신호·차트 **189개**의 Turso 감사 완료 저장 증빙 확인. `worker/src/turso-research.ts`가 같은 날짜별 감사 및 신호/차트 기록을 직접 조회하도록 `/api/research/dates`, `/api/research/search`, `/api/research/chart`를 제공. 기존 분석 신호/GC/추세·거래대금/과거 패턴 조건과 정렬을 지원하되 Turso의 원천 224일 이력을 재계산하지 않고 저장된 원래 R1.1 연구 스냅샷을 사용. PWA `기술 패턴 찾기`는 Turso를 우선 시도하고 5xx 오류 및 수동 선택 시 D1 `/api/search`로 전환. 차트도 선택된 연구 소스의 정확한 기준일 기록을 조회합니다. **해당 날짜 189건만 수집된 상태**이며 과거 전체 이관, 후속 최고가 완전성, 모든 탭 D1 독립성은 아직 없습니다. 새 로컬 단위 8/8·웹 빌드·Worker dry-run 통과했으며 운영 Worker/웹 수동 배포 후 휴대폰 검증 필요. D1 데이터 변경 없음.

**2026-11-19 D1 장애 대비 동일 데이터 이중화 재확인:** 사용자가 [검색 화면 PR #26](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/pull/26)을 **이미 병합**했습니다. 다만 기존 D1 분석 결과를 다시 표시하는 것은 장애에 독립적인 검색 복구가 아니므로 **최종 전환 완료로 간주하지 않습니다.** 최종 목표는 검증된 EOD 원본과 분석 결과를 *동일한 산출물 기준*으로 Turso 주 DB와 D1 보조 DB에 저장, 누락·충돌·지연을 감사하고 D1 장애 중에도 Turso에서 검색·사용 가능한 것입니다. 두 DB의 모든 테이블·이력이 이미 같다는 뜻은 아닙니다.

**첫 단계 — 일봉 연구 신호/차트 증거의 Turso 독립 저장 (코드 PR 준비):** 기존 `market_scan_r11.py`의 `signals.csv`·`chart_snapshots.jsonl`·`AUDIT.json`를 D1 SQL 생성과 **동일한** 패턴 하이라이트 계산 규칙으로 `scripts/export_turso_signal_snapshot.py`에서 읽어, 정확한 날짜/종목/원천 해시를 가진 연구 결과 스냅샷으로 출력합니다. `.github/workflows/blue_market_scan_research_only.yml`에 `turso_signals_mode=off|dry_run|apply` 선택값을 추가하고, `tools/turso/signal-snapshot-import.mjs`가 **Turso의 감사 완료 KRX EOD 일자·신호 종목 종가와 먼저 대조**한 뒤 별도 `blue_research_signals_v1` 및 `blue_research_signal_audit_v1`에 충돌 거부·재실행 안전 저장/재조회를 수행합니다. 기본값 `off`, `dry_run`은 원격 DB 접속 없음, `apply`만 명시적 Turso 쓰기. 스캐너 산출물 그대로 전달하는 첫 데이터 계열에 한정되며, **D1에 이미 존재하는 모든 과거 runs·signals·chart_snapshots의 복제, 실시간 자동 이중 저장, D1 실패 후 자동 재처리/앱 검색 폴백은 아직 구현하지 않았습니다.** 이 기능은 기존 D1·원본 Turso EOD 행·장바구니를 수정하지 않습니다.

**2026-11-19 검색 화면 우선순위 복구 (웹 PR 준비):** Turso 확정 일봉 8거래일만으로는 BLUE20/30/40의 이동·시차 밴드, ENV20/40 중심선, RSI/Slow Stoch/MACD, 112/224일선 및 과거 승률을 신뢰성 있게 새로 계산할 수 없습니다. 따라서 PWA `검색`의 **기본 화면을 기존 D1 기반 기술 패턴 검색**(기존 서버 검색·필터·분석 요청 유지)으로 되돌리고, `확정 일봉 전체` 버튼에서 검증된 Turso 원본 종목 목록을 별도로 보여줍니다. D1 데이터가 오래됐거나 무료 행수 한도에 막히면 패턴 검색은 제한/실패할 수 있으며 이를 별도로 표시합니다. Turso EOD 조회 및 장바구니 우선 가격 읽기, 기존 D1·Turso 스키마·운영 DB는 변경하지 않습니다. 기술 패턴을 Turso에서 직접 검색하려면 장기 가격 이력(특히 224일선 및 시차 밴드)을 검증해서 채우거나 신호 연구 스캐너의 결과를 정확한 날짜·원천 감사와 함께 이관하는 후속 단계가 필요합니다. KIS 장중 15분 파일럿은 장이 열릴 때까지 보류합니다.

**2026-11-18 Turso 일봉 수집 확정:** [GitHub Actions #44310029226](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44310029226)에서 11월 9~18일 중 8거래일 총 **21,296개 KRX 검증 일봉**이 Turso `blue_eod_daily_v1`에 저장되고, 날짜별 read-back 및 감사 테이블 검증에 성공. 단 112·224일선, 신호, 매물대·과거 패턴·장바구니 이력은 이 테이블에 포함되지 않음.

**2026-11-18 화면 확인 및 종목명 복구 코드:** Turso 일봉에 가격은 있으나 회사 이름 칸은 비어 있어 종목코드가 중복 표기됨. EOD 감사·가격 행을 재기록하면 검증 해시가 달라질 수 있으므로, 별도 `blue_symbol_directory_v1`에 이름만 `dry_run` 검증 후 **수동 `apply_all`**로 저장하고 `/api/eod/search`에서 코드·시장으로 조인하도록 준비. 미등록이면 빈 이름을 임의 생성하지 않음. 이름은 디렉터리 기준일의 명칭이고 과거 상호 변경 반영을 보장하지 않음. **장바구니는 기존 별도 UI/D1 데이터이며, 이 작업에 포함되지 않고 보존함.** 운영 반영은 GitHub PR 병합 → Turso 이름 적용 → API Worker 수동 배포 → 웹 수동 배포가 모두 필요.

**새 복구 원칙:** 검증된 KRX *일봉 검색*은 Turso를 먼저 조회. Turso 인증·연결·검색 오류 시 기존 **D1 신호 검색 UI**로 전환하고 데이터 영역의 차이를 명시함. 이는 두 DB에 같은 이력이 들어 있다는 뜻이 아니며, D1도 한도 초과면 명확히 이중 장애를 표시. 기존 D1 업무 데이터 및 Worker 바인딩은 보존. 앱의 다른 분석 탭은 여전히 D1 의존이며, 전체 Turso 주 DB 전환은 별도의 후속 단계.

**2026-11-19 장바구니 후속 읽기 준비:** 기존 기기 로컬 장바구니 발견일/기준가/메모를 보존하면서 `Turso 확정 일봉`의 **발견일 후속 거래일** 가격/고가만 읽어 수익률을 표시하도록 단계적 확장. 새 `/api/eod/prices/compare`는 Access 인증 + 검증 감사 날짜 + 최대 24개 날짜/코드 쌍 + SELECT 전용이며, Turso 장애 시 기존 D1 `/api/prices/compare`만 보조 사용. 수집된 8거래일 범위 밖의 고가 완전성은 주장하지 않음. 이는 **장바구니 가격 읽기 하나**의 전환이고, D1의 Watch 등록·KIS 시세 수집/다른 분석 및 AI 기능이 Turso로 이동한 것은 아님. PR 병합 후 API·웹 수동 배포 필요.

**2026-11-19 추가 개발 — KIS 검증 시세 Turso 기록/읽기 (PR 준비):** 수집기 5분 주기에는 장바구니 수집과 기존 후보 수집이 **검증한 시세**를 키별로 합쳐, D1 저장 성공 여부에 앞서 별도 옵트인 Turso 저장 대상으로 큐잉한다. 파일럿 자동 만료 및 회당 최대 2종목/기본 `TURSO_MIRROR_ENABLED=false`는 유지한다. 이미 존재하는 Turso `blue_kis_live_quotes_r141` 테이블에서 별도로 검증된 시각/거래일의 **저장된 KIS 스냅샷**을 장바구니 가격 비교 응답에 합치되, 동일 거래일에는 감사 완료 KRX 확정 종가·고가를 우선하고 KIS는 더 **나중 거래일**에만 최신가로 선택한다. 원래 발견일 기록/로컬 키/D1 테이블을 변경하지 않는다. **여전히 D1의 등록 목록·후보·토큰 금고·락에 의존**하므로 D1 전체 장애 시 수집이 보장되거나 Turso 주 DB로 완전히 전환된 것은 아니다. 실제 자동 저장은 별도 Collector 재배포 및 장중 제한 파일럿을 실행·감사해야 한다.

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

- **Turso 읽기 복구 단계:** `worker/src/turso-eod.ts`, `/api/eod/dates`, `/api/eod/search` 및 PWA의 전용 확정 일봉 화면. 먼저 수동 API Actions `verify_only` 후 `deploy_api`를 명시적으로 선택해 `blue-signal-lab-api-v2`에 Turso URL/토큰 Worker Secrets 두 개를 설치·배포. 이후 기존 웹 안전 배포 Actions를 따로 실행. PR만 병합하면 운영에 자동 적용되지 않음. 다른 탭의 112/224일선·패턴/AI·장바구니는 기존 D1 의존 상태임.

0. **신규 사용자 우선순위(2026-11-18):** 우선 2026-11-09~11-18의 정확한 KRX 일봉 전 종목을 Turso에 채운다. `.github/workflows/blue_turso_verified_eod_range.yml`에서 먼저 `dry_run`으로 8개 평일의 KRX 정확한 날짜·OHLCV·건수·해시를 검증한다. 날짜 하나라도 불확실하면 저장하지 않음. 검증 후 명시적 `apply` 선택으로만 `blue_eod_daily_v1`에 멱등 삽입 및 read-back 완료 기록. **D1/Turso 전체 일치 검사와 주 DB 전환은 이 단계의 선행조건이 아님.** 기존 D1 기능·데이터를 보존한다.
1. Secrets 설치와 Collector 실제 재배포까지 성공했습니다. 단, [Mirror Status #44279543275](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44279543275)의 0행은 복제 OFF 상태에서의 결과로 정상입니다.
2. PR #15 병합·Collector 재배포([#44284567795](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44284567795)) 및 제한 파일럿([#44284901016](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44284901016))은 성공했습니다. 하지만 [Turso Status #44286642943](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44286642943)에서 파일럿 중에도 **0행**입니다. 원인은 아직 미확정이며, 정상 복제 증거가 없습니다.
3. 먼저 **운영 D1을 추가 조회하지 않고** Cloudflare Collector 상태 로그(`BLUE_R142`, `BLUE_TURSO_MIRROR`)로 `후보 없음/토큰 문제/시세 무효/수집 오류/Turso 쓰기 오류`를 구분합니다. [Tail 실행 #44296117467](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44296117467)은 KST **20:36~20:43 거래시간 종료 후** 시행돼 0건이며, 종료 코드 처리의 오탐 실패도 확인돼 개선 중입니다. **다음 거래일 09:00~15:20에 7분 라이브 진단을 다시 실행**해야 원인을 구분할 수 있습니다.
4. D1 대비 데이터 건수·시각·가격을 **소량 검증**하고 장기 누락을 막을 재처리 정책을 구현하기 전에는 운영 데이터의 주 저장소로 전환하지 않습니다.
5. D1 읽기 행 사용량을 UTC 기준 매일 비교하고 쿼리/인덱스 최적화 전후 차이를 관찰합니다.

## 참고

- GitHub: `https://github.com/ehdud6728-bit/BLUE-Signal-Lab`
- 최신 실제 배포 및 실행 결과는 GitHub의 `main` 커밋, PR, Actions와 Cloudflare 대시보드에서 확인합니다.
