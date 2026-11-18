# Turso 연결 검사 (BLUE Signal Lab)

이 문서는 Turso 연결 검사부터 제한된 병행 저장까지 안내합니다. `SELECT 1` 연결 검사 자체는 **기존 D1 DB와 운영 수집기에 영향을 주지 않습니다**. 별도 수동 Actions로 Turso 스키마가 생성됐으며, 복제는 기본 OFF 상태입니다.

## 1. Turso DB 생성

1. https://turso.tech 에서 계정을 만들거나 로그인합니다.
2. Turso Cloud에서 별도 테스트 DB `blue-signal-lab-mirror`를 생성합니다. 초기 단계에서는 Cloudflare 공식 연동 문서와 맞는 **libSQL** 엔진을 선택합니다. 새로운 Turso Database 엔진과 사용 SDK를 혼동하지 않습니다.
3. 데이터베이스 URL(`libsql://...`)을 확인하고 DB 접근 토큰을 생성합니다. CLI를 쓴다면 `turso db show blue-signal-lab-mirror --url`, `turso db tokens create blue-signal-lab-mirror` 명령을 이용할 수 있습니다.

## 2. GitHub Actions 비밀 값 등록

`ehdud6728-bit/BLUE-Signal-Lab` 저장소의 **Settings → Secrets and variables → Actions → New repository secret**에서 두 항목을 등록합니다.

- `TURSO_DATABASE_URL`: Turso DB URL (공개 문서/로그에는 출력하지 않음)
- `TURSO_AUTH_TOKEN`: Turso DB 접근 토큰 (**절대 채팅이나 GitHub 소스에 붙여넣지 않기**)

연결 검사와 Turso-only 관리/상태 확인에 사용합니다. 별도로 Collector Worker에도 동일한 Turso Secrets가 설치됐는지는 5절 실행 기록에서 확인합니다.

## 3. 연결 검사 실행

이 PR을 `main`에 병합한 뒤 GitHub **Actions → BLUE Turso Connection Smoke Test (READ ONLY) → Run workflow**를 누릅니다.

- 성공: `TURSO_CONNECTION_OK`가 출력됩니다.
- 실패: `TURSO_SECRETS_MISSING`, `TURSO_URL_INVALID`, `TURSO_CONNECTION_FAILED` 중 하나가 출력됩니다. 오류 로그에는 URL이나 토큰을 출력하지 않습니다.

Actions URL: https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/workflows/blue_turso_connection_test.yml

## 다음 단계

연결 성공 이후에만 스키마 호환성, 변경 데이터의 **중복 없는** Turso 복제, 수집 시각·종목코드·건수 검증, 장애 시 분리 운영을 설계합니다. 운영 D1의 읽기/쓰기를 일괄 변경하지 않습니다.

공식 참고: https://developers.cloudflare.com/workers/databases/third-party-integrations/turso/

## 4. 병행 저장 파일럿 (연결 성공 후)

새 GitHub Actions **BLUE Turso Mirror Schema Init (MANUAL)** 워크플로에서:

1. `apply=false`로 실행하면 설명만 출력하며 DB에 접근하지 않습니다.
2. `apply=true`를 명시하면 Turso에 `blue_kis_live_quotes_r141`, `blue_kis_live_history_r141` 두 테이블과 보조 인덱스를 `IF NOT EXISTS`로 생성합니다. 기존 행은 삭제하지 않습니다.
3. 이 과정에서 Cloudflare D1을 읽거나 쓰지 않습니다.

수동 실행 링크: https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/workflows/blue_turso_mirror_schema_init.yml

수집기 `collector/src/turso-mirror.mjs`는 D1에 **성공적으로 저장한 시세 묶음만** Turso로 보내는 테스트용 코드입니다. 같은 시각의 중복 저장과 더 오래된 최신가의 덮어쓰기를 SQL 키/조건으로 방지합니다.

**안전장치:** `collector/wrangler.jsonc`의 `TURSO_MIRROR_ENABLED`는 기본 `false`입니다. 코드를 병합하거나 수집기를 다시 배포하는 것만으로 Turso 복제가 켜지지 않습니다. 수동·시간제한 파일럿 모드는 6절을 참고하세요. 제한 없는 전체 복제는 별도 승인 없이는 켜지 않습니다.

**현재 한계:** 이 단계는 `collector/`의 **5분 전체 수집 시세만** best-effort로 복제합니다. Turso 장애 중 발생한 모든 과거 행을 자동으로 재전송하는 큐/재처리 기능은 없습니다. 따라서 장기 보관의 완전성을 보장하지 않으며 운영 읽기 전환은 아직 금지합니다. 다음 단계에서 복구·재처리·일치성 검증을 우선 구현해야 합니다.

## 5. 테이블 생성 성공 후: 인증 설정과 상태 확인

2026-11-18 [Turso Schema Init #44278060936](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44278060936)에서 `TURSO_MIRROR_SCHEMA_READY`가 확인됐습니다. 두 테이블만 생성됐고 주가 데이터는 아직 없습니다.

**수동 인증 설정:** [BLUE Turso Collector Secrets Install](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/workflows/blue_turso_collector_secrets.yml)

- 기본 `apply=false`는 아무것도 바꾸지 않습니다.
- 실제 등록이 필요할 때만 `apply=true`와 `confirm_worker=blue-market-collector`를 입력합니다. 이 작업은 GitHub Actions Secrets를 같은 이름의 Cloudflare `blue-market-collector` Worker Secrets에 복사합니다.
- `wrangler secret put`은 Worker의 새 버전을 게시할 수 있습니다. 따라서 이 동작은 **명시적으로 선택한 경우에만** 실행합니다. `TURSO_MIRROR_ENABLED`는 여전히 `false`이며 DB 복제는 시작하지 않습니다.

**Turso 데이터 현황 확인:** [BLUE Turso Mirror Status (READ ONLY)](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/workflows/blue_turso_mirror_status.yml)

- Turso의 **한국 날짜 기준 오늘 자료만** 읽어 최신 스냅샷 건수/히스토리 건수/마지막 수신 시각을 출력합니다.
- Cloudflare D1 조회가 전혀 없으므로 D1 무료 읽기 한도를 사용하지 않습니다.
- 이 상태 검사는 Turso가 *얼마나 들어왔는지* 확인할 뿐, D1과의 완전한 일치나 과거 누락이 없음을 보장하지 않습니다.

## 6. 수동 15분/30분 Turso 파일럿 (최대 2종목/수집 회차)

### 검증된 선행 결과

- [Cloudflare Turso Worker Secrets 설치 #44279139920](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44279139920) 성공.
- [Turso Mirror Status #44279543275](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44279543275)에서 0행 확인(정상: 아직 복제 안 함).
- [Collector 운영 배포 #44279762372](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44279762372) 성공. 이때는 시간제한 파일럿 코드가 포함되기 전이고 기본 복제 OFF.

### 파일럿 시작 순서 (운영 데이터 변경이므로 확인 필요)

1. 시간제한 파일럿 코드 PR을 `main`에 병합합니다.
2. [BLUE R1.4.2 Collector Deploy](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/workflows/blue_r142_collector_deploy.yml)에서 **새 코드가 포함된 `main`**을 선택하고 `deploy=true`로 실제 Worker를 재배포합니다. 이때도 일반 복제 플래그는 `false`입니다.
3. 수집기 실행이 가능한 **한국 주식시장 장중**에 [BLUE Turso 2-Quote Pilot (MANUAL)](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/workflows/blue_turso_mirror_pilot.yml)을 엽니다.
4. 우선 `mode=dry_run`을 실행합니다(Worker/DB 변경 없음). 실제 시작할 때만 `mode=start_15m` 또는 `start_30m`을 선택하고 `confirm_worker=blue-market-collector`를 입력합니다.
5. 이 Actions는 `TURSO_MIRROR_PILOT_UNTIL_UTC`라는 **Cloudflare Worker Secret 하나의 종료 시각만** 업데이트합니다. 해당 명령은 Worker 새 버전을 게시할 수 있습니다. `TURSO_MIRROR_ENABLED=false`는 유지됩니다.
6. 파일럿 기간에 5분 전체 수집 작업이 완료될 때마다, D1에 저장한 시세 묶음에서 **최대 2건**만 Turso 최신/이력 테이블에 기록합니다. 파일럿에 쓰는 Turso 요청은 D1 성공 뒤 독립적으로 처리되며 실패해도 D1 결과를 취소하지 않습니다.
7. 종료 시각(UTC)이 지나면 자동으로 복제하지 않습니다. 즉시 중단이 필요하면 같은 수동 Actions에서 `mode=stop`, `confirm_worker=blue-market-collector`을 실행합니다.
8. [BLUE Turso Mirror Status (READ ONLY)](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/workflows/blue_turso_mirror_status.yml)로 당일 Turso 저장 건수/마지막 기록 시각을 확인합니다. **D1 SQL을 실행하지 않습니다.**

### 주의

- **수동 파일럿 액션이 성공했다고 해서 실제 시세가 저장됐다는 뜻은 아닙니다.** 수집기가 장중 실제 시세를 D1에 성공적으로 저장해야 Turso 기록이 발생합니다.
- 시간제한이 끝나도 이미 저장된 Turso 시세는 자동 삭제하지 않습니다. 15분/30분은 **추가 쓰기 허용 시간**입니다.
- 마지막 수집 회차가 파일럿 종료 전에 시작돼도 Turso 비동기 단계에서는 종료 시각을 한 번 더 검사합니다.
- 리플레이 큐가 없으므로 Turso 오류 시 과거 누락 데이터는 자동 복구되지 않습니다. Turso는 아직 완전한 운영 백업도, 애플리케이션 읽기 원본도 아닙니다.

## 7. 파일럿이 성공했는데 Turso가 0건인 경우: D1 SQL 없는 진단

2026-11-18 최신 수집기 실배포 및 수동 파일럿 성공 후에도 [Turso-only 상태 확인 #44286642943](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44286642943)은 **0행**이었습니다. 연결 실패가 아닌 실제 복제/수집 단계의 미확인 문제입니다.

1. [BLUE Collector Runtime Tail Diagnostic (READ ONLY)](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/workflows/blue_r142_collector_tail_diagnostic.yml)을 `main` 병합 후 수동 실행합니다.
2. `capture_minutes=7`을 선택합니다. **7분 동안** Cloudflare에서 `blue-market-collector`의 **새로 발생하는** Worker 로그만 받아오며 기존 로그를 소급 조회하지 않습니다.
3. `BLUE_COLLECTOR_TAIL`에서 수집기 `BLUE_R142` 상태와 저장 행 수, `BLUE_TURSO_MIRROR` 상태, `BLUE_TURSO_MIRROR_WRITE_FAILED` 여부를 확인합니다.
4. `PAUSED_NO_FRESH_CANDIDATES`면 후보 원천/일봉 증빙 갱신, `PAUSED_TOKEN_EXPIRED_OR_MISSING`면 토큰 만료/캐시, `NO_VALID_QUOTES`면 KIS 응답 검증, `COLLECTOR_ERROR`면 DB 쓰기 등 수집 오류, `BLUE_TURSO_MIRROR_WRITE_FAILED`면 Turso 비동기 쓰기를 우선 조사합니다. 로그가 없으면 Cron과 관측 시간을 재확인합니다.

**안전:** 이 Actions는 Cloudflare에 배포하지 않고 D1/KIS/Turso에 SQL·시세 요청을 보내지 않습니다. 구독/조회하는 로그도 사전에 지정한 상태·숫자 필드만 출력하므로 KIS 키, URL, SQL, 원시 시세 payload를 노출하지 않습니다. Cloudflare Worker Tail 권한이 없다면 실패 메시지만 출력하고 종료합니다. 계정의 Workers 로그 수집/쿼터 설정은 별도이며, 7분간 GitHub Actions 실행 시간을 소비합니다.
