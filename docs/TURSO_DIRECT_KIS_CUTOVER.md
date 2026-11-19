# BLUE Signal Lab — Turso 단독 KIS 장중 시세 수집 준비 (PR #31)

## 구현 범위
- `collector/src/turso-direct.mjs`: D1을 **읽지도 쓰지도 않는 별도 Cron 수집기**. 기존 5분 주기를 재사용하되 Turso의 `blue_research_signal_audit_v1`, `blue_research_signals_v1`, `blue_eod_ingest_audit_v1`을 근거로 검증된 최신 연구 신호 종목을 순환 선택합니다.
- 한 번에 최대 **12종목**을 조회하고 호출 사이를 최소 450ms로 제한합니다. 189종목은 약 16번의 5분 주기를 거쳐 한 번씩 순환하므로 **각 종목이 5분마다 갱신되는 것은 아닙니다.**
- KIS의 실제 응답을 기존 `parseQuote`로 검증해 Turso `blue_kis_live_quotes_r141`과 `blue_kis_live_history_r141`에 저장합니다. 비교 API가 후속 거래일의 최신 확인가로 읽습니다.
- 장중 `KIS_REST_INQUIRE_PRICE` 저장 관측은 **실시간 체결가/확정 종가가 아닙니다.**
- 백그라운드 D1 수집기 예외와 독립된 `ctx.waitUntil`으로 동작합니다.
- 수집기는 자동 활성화되지 않습니다. 기본 설정은 OFF, 15/30분 시간제한 파일럿만 별도 Workflow로 허용됩니다.

## D1 발급 중단 감사 — 터소 발급 전 필수

- [BLUE KIS D1-to-Turso Cutover Audit](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/workflows/blue_kis_cutover_audit.yml)는 **읽기 전용**입니다. D1 `blue_kis_token_vault_v1`의 저장/만료 시각과 `blue_kis_token_issuance_r1597`의 최종 발급 시도·성공 시각만 조회하고, 저장소 변수를 확인합니다. 비밀 값이나 암호문은 조회하지 않으며 KIS 토큰을 발급하지 않습니다.
- GitHub **Settings → Secrets and variables → Actions → Variables**에서 `BLUE_KIS_TOKEN_AUTO_PAUSED=true`를 직접 설정한 *실제 시각*을 기록하고 기존 수동 D1 `mode=issue`도 중단합니다. `BLUE_KIS_D1_DISABLED_AT_UTC`에 그 실제 시각을 UTC 밀리초 형식(예 `2026-11-19T02:15:00.000Z`; 임의 예시는 실제 중단 기록으로 사용 금지)으로 입력합니다. `BLUE_KIS_TURSO_CUTOVER_APPROVED`는 아직 `true`로 바꾸지 않습니다.
- Audit의 `status=READY_FOR_MANUAL_REVIEW`, `cutover_ready=true`가 나올 때까지 신규 Turso 토큰 발급을 시작하지 않습니다. `WAIT_24H_SINCE_D1_PAUSED`, `LEGACY_ISSUER_NOT_PAUSED`, `D1_ACTIVITY_AFTER_PAUSE` 및 D1 조회 실패는 미완료입니다. **수동·외부 tokenP 발급이 없었는지도 사용자가 확인해야 최종 전환 가능합니다.**
- 스크립트는 D1 과거 테이블을 단 두 번 SELECT하므로 일일 D1 조회량은 작지만, 무료 일일 읽기 한도가 차단되어 있으면 감사는 실패할 수 있습니다. 실패를 건너뛰어 준비 완료로 간주하지 않습니다.
- 안전한 Audit 결과 후에만 아래의 기존 Turso 전환 승인·발급 절차를 계속합니다.

## 토큰 유지·만료 복구 (06:00 KST)

- 기존 D1 및 Turso 토큰 관리 워크플로는 매일 06:00/06:30 KST 점검, 평일 07:00~19:30에는 30분마다 재점검합니다. GitHub Actions 예약 실행은 수 분 이상 지연될 수 있습니다.
- **유효한 토큰은 그대로 재사용**합니다. 만료 1시간 전부터 갱신 필요성을 확인하지만, 기존 저장 시각으로부터 24시간이 지나지 않으면 절대 재발급하지 않습니다. 토큰 발급은 실제 06:00 고정이 아니라 해당 보호 조건이 충족되는 첫 예약 실행에서 일어납니다.
- 제공처 발급 요청 실패 시 그날 30분 후 **한 번만** 재시도하며, 재시도도 실패하면 추가 자동 발급 금지입니다. 암호화 저장 실패·메타데이터 오류는 자동 재시도하지 않습니다. 발급 장애 원인 진단과 수동 조치는 별도 검토가 필요합니다.
- 기존 D1 발급과 Turso 발급 작업은 **동시에 켜면 안 됩니다.** 아래의 24시간 전환 보호 절차가 우선입니다.

## KIS 단일 발급·Turso/D1 이중 암호화 금고 (코드 준비, 운영 미활성)

- 하나의 Turso 관리자가 **`tokenP`를 최대 1회** 호출해 얻은 동일 KIS 접근토큰을 Turso `blue_turso_kis_vault_v1` 및 기존 D1 `blue_kis_token_vault_v1`에 각각 AES-256-GCM 암호화 저장합니다. 암호문은 임의 nonce 때문에 서로 다를 수 있지만 복호화되는 토큰·발급/만료 시각은 같습니다. KIS App Key/Secret는 기존 GitHub/Worker Secrets에만 둡니다.
- D1 백업은 **별도의 발급기가 아닙니다**. 기존 D1 발급 워크플로는 `BLUE_KIS_TOKEN_AUTO_PAUSED=true`로 계속 중단해야 하며, Turso 발급 역시 D1 중단 감사 완료 + 24시간 대기 + 수동 승인 전에는 불가합니다.
- 새 저장소 변수 `BLUE_KIS_DUAL_VAULT_ENABLED=true`를 **코드 검증 및 전환 승인 후에만** 설정합니다. 이 값이 없으면 `mode=issue`와 `mode=sync`를 모두 차단합니다. 기존 `mode=check`는 Turso 메타데이터 읽기만 수행합니다.
- `mode=sync`는 Turso의 **현재 유효한 토큰**을 D1에 재암호화 복제·재조회·복호화 비교만 수행합니다. KIS 발급이 전혀 없으므로 D1 백업 실패(`TOKEN_SAVED_BACKUP_PENDING`/`D1_BACKUP_SYNC_FAILED`) 후 토큰 재발급 대신 `sync`로 복구할 수 있습니다. 예약된 `issue` 점검에서도 대기 중 백업 복제를 다시 시도합니다.
- 최초 Turso 토큰이 비어 있으면 KIS에 요청하기 전에 D1 백업을 검사합니다. 유효한 D1 토큰이 있으면 Turso로 복원해 **추가 발급을 막습니다**. D1 조회 불가·손상·24시간 미경과 상태를 새 발급 근거로 사용하지 않습니다.
- Collector의 Turso 독립 시세 경로는 기본적으로 Turso 금고의 암호문을 읽습니다. 별도로 **Cloudflare Collector Worker에** `BLUE_KIS_DUAL_VAULT_ENABLED=true`를 명시 설치한 경우, Turso 토큰 금고만 조회 실패/누락/만료일 때 D1에 남은 **유효한 동일 토큰**을 읽습니다. 복호화 오류·메타데이터 손상은 폴백하지 않고 차단합니다. 이 바인딩은 GitHub 저장소 Variables와 별개이며 수동 Worker 설정/배포가 필요합니다.
- **중요한 장애 한계:** Turso 전체가 중단되면 Turso 독립 수집기의 후보 선택과 시세 *저장* 자체도 불가능합니다. D1 경로는 정상 D1 수집 기능·쿼터 및 백업 토큰이 살아 있을 때만 운영을 이어갈 수 있습니다. Turso 장애가 토큰 만료 시점까지 지속되면 현재 중앙 발급 관리자는 안전상 새 `tokenP`를 실행하지 않습니다. Turso 불가 시 D1만으로 새 토큰을 발급하는 별도의 단일 원장·잠금 복구 절차는 **미구현**이며, 자동 발급 가능하다고 주장하면 안 됩니다.
- D1 무료 읽기/쓰기 한도가 차단되면 백업 기록·조회도 실패할 수 있습니다. Turso에 저장된 유효 토큰은 유지하고 복제 대기로 표시하되, **두 DB 모두 유효 토큰을 읽을 수 없는 경우 발급을 반복하지 않습니다.**

### 안전한 활성화 순서

1. 이 변경 PR의 무시크릿 CI, D1 암호화 포맷 호환, 실패 복구 테스트를 검증합니다. PR 병합만으로 비밀값·운영 DB·발급기를 변경하지 않습니다.
2. 기존 읽기 전용 cutover 감사가 `READY_FOR_MANUAL_REVIEW`이고 24시간 중단 및 외부 수동 발급 부재를 **사람이 확인**한 후 `BLUE_KIS_TURSO_CUTOVER_APPROVED=true`를 승인합니다.
3. GitHub Actions Repo Variable `BLUE_KIS_DUAL_VAULT_ENABLED=true`를 설정한 후, 새 `BLUE Shared KIS Token Steward`를 `mode=check`로 검사하고 필요 시 `mode=sync`(유효한 Turso 토큰이 있을 경우) 또는 `mode=issue`(발급 가능 시)로 수동 실행합니다. 수동 `sync`/`issue`는 `confirm_cutover=blue-turso-kis-cutover` 확인이 필요합니다.
4. `TOKEN_SAVED_DUAL`, `D1_BACKUP_VERIFIED`, `TOKEN_RESTORED_FROM_D1` 등 안전한 상태를 확인합니다. 백업 실패 상태는 토큰 발급 재시도를 하지 않고 원인 확인/동기화합니다.
5. Collector Worker에도 `BLUE_KIS_DUAL_VAULT_ENABLED=true`를 별도로 반영·배포하고 장중 제한 파일럿으로 D1 백업 폴백을 검증합니다. **GitHub Variables만 바꿔서는 Worker 폴백이 활성화되지 않습니다.**
6. 주가 데이터 Turso→D1 정합 복제·내구성 재시도는 **토큰 금고 이중화와 별개 개발 단계**입니다. 토큰 이중 저장만으로 주가 이중 저장 완료를 주장하지 않습니다.

## 토큰 전환을 위한 필수 보호
 - `tools/turso/kis-token-steward.mjs`: KIS 토큰을 HKDF-SHA256+AES-256-GCM으로 암호화하여 Turso에 보관하고, 별도 활성화된 경우 `d1-token-backup.mjs`로 기존 D1 금고에 동일 토큰을 복제합니다. 신규 발급 전 Turso에 토큰이 없으면 D1 백업을 확인해 중복 발급을 차단합니다.
- KIS 토큰 발급은 GitHub Actions의 `BLUE Turso KIS Token Steward`에서만 수행하며, 전환 완료 전에는 **check만** 실행합니다.
- 안전한 전환 순서:
  1. 기존 D1 토큰 발급 워크플로의 예약 실행을 GitHub 저장소 변수 `BLUE_KIS_TOKEN_AUTO_PAUSED=true`로 일시 중지합니다. **중지 시각 UTC**를 따로 기록합니다. D1로 수동 토큰 발급도 중지합니다.
  2. 중지 후 최소 **24시간 동안** 이전 토큰 발급이 없었음을 확인합니다. 이전 발급이 더 늦게 있었다면 그 시각 기준으로 다시 24시간을 지킵니다.
  3. GitHub 저장소 변수 `BLUE_KIS_D1_DISABLED_AT_UTC=2026-...Z`를 **실제 중지 시각**으로 설정합니다. 예시는 임의로 사용하지 않습니다.
  4. 변수 `BLUE_KIS_TURSO_CUTOVER_APPROVED=true`를 설정하면 새 토큰 발급 관리자를 승인하는 것입니다. 기존 D1 발급 예약은 계속 꺼둡니다.
  5. `BLUE Turso KIS Token Steward`를 `mode=check`로 실행하여 상태를 확인하고, 필요 시 `mode=issue`, `confirm_cutover=blue-turso-kis-cutover`로 명시적인 한 번의 발급을 요청합니다.
  6. 로그 `BLUE_TURSO_KIS_TOKEN_STEWARD`의 `TOKEN_SAVED_DUAL`, `TOKEN_VALID` 또는 명확한 백업 복구 상태를 확인합니다. API 키·토큰·암호문은 어떤 로그에도 표시되면 안 됩니다.
  7. KIS 토큰이 준비되고 정규 거래시간이면 `BLUE Turso Direct KIS Quote Pilot`에서 `start_15m`, `confirm_worker=blue-market-collector`로 제한 테스트를 시작합니다. 필요하면 `stop`으로 종료합니다.
  8. `BLUE Turso Mirror Status (READ ONLY)`에서 해당 한국 날짜의 `latest_symbols`와 `history_rows` 증가 여부를 검증합니다. 숫자 0이라면 수집 성공이라고 간주하지 않습니다.

**주의:** 단순히 Turso에 새 발급 예약 테이블이 생겼다는 사실은 기존 D1 발급 기록의 24시간 공백을 증명하지 못합니다. 두 토큰 발급 작업을 동시에 활성화하면 KIS 24시간 제한 및 기존 인증 상태를 망가뜨릴 수 있습니다. 새 구조 활성화는 운영자가 이전 발급 중단을 검증한 다음에만 진행합니다.

## 관련 링크
- [Turso 토큰 보관/검증](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/workflows/blue_turso_kis_token_steward.yml)
- [Turso 직접 KIS 시세 15분 파일럿](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/workflows/blue_turso_direct_quotes_pilot.yml)
- [Turso 시세 읽기 전용 상태 검사](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/workflows/blue_turso_mirror_status.yml)
- [기존 수집기 배포](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/workflows/blue_r142_collector_deploy.yml)

## 추가로 남는 작업
1. 현재 각 종목은 평균 80분 간격(189건일 때)에 한 번씩 순환하며, **5분마다 모든 검색 종목을 갱신하지는 않습니다.** 관심 종목 우선순위·장바구니 직접 등록 등 선택형 대상 관리가 필요합니다.
2. 기존 D1 검색/토큰/장바구니 Cron은 그대로 유지됩니다. 동작 경로를 완전히 없애려면 독립 수집 검증 후에만 종료/전환합니다.
3. 사용자 로컬 장바구니 이중화는 별도 작업입니다.
4. 각 최신시세에는 수집 시각과 출처를 표시해야 하며, 장중 시세의 갱신 지연·빈 결과를 감추면 안 됩니다.
