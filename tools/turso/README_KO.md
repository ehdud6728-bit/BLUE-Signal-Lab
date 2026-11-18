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
