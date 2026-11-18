# Turso 연결 검사 (BLUE Signal Lab)

이 테스트는 **기존 D1 DB와 운영 수집기에 영향을 주지 않습니다**. Turso 데이터베이스에 `SELECT 1`만 실행합니다. 아직 시세 복제, 스키마 생성, 데이터 이관 기능은 없습니다.

## 1. Turso DB 생성

1. https://turso.tech 에서 계정을 만들거나 로그인합니다.
2. Turso Cloud에서 별도 테스트 DB `blue-signal-lab-mirror`를 생성합니다. 초기 단계에서는 Cloudflare 공식 연동 문서와 맞는 **libSQL** 엔진을 선택합니다. 새로운 Turso Database 엔진과 사용 SDK를 혼동하지 않습니다.
3. 데이터베이스 URL(`libsql://...`)을 확인하고 DB 접근 토큰을 생성합니다. CLI를 쓴다면 `turso db show blue-signal-lab-mirror --url`, `turso db tokens create blue-signal-lab-mirror` 명령을 이용할 수 있습니다.

## 2. GitHub Actions 비밀 값 등록

`ehdud6728-bit/BLUE-Signal-Lab` 저장소의 **Settings → Secrets and variables → Actions → New repository secret**에서 두 항목을 등록합니다.

- `TURSO_DATABASE_URL`: Turso DB URL (공개 문서/로그에는 출력하지 않음)
- `TURSO_AUTH_TOKEN`: Turso DB 접근 토큰 (**절대 채팅이나 GitHub 소스에 붙여넣지 않기**)

이 값은 GitHub Actions 수동 연결 검사용입니다. 아직 Cloudflare Worker에 Turso 비밀 값을 넣을 필요는 없습니다.

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

**안전장치:** `collector/wrangler.jsonc`의 `TURSO_MIRROR_ENABLED`는 기본 `false`입니다. 코드를 병합하거나 수집기를 다시 배포하는 것만으로 Turso 복제가 켜지지 않습니다. 실제 활성화를 하려면 Turso Worker secrets를 넣고 별도 검증/승인 후 해당 플래그를 변경해야 합니다.

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
