# BLUE Signal Lab — Turso 단독 KIS 장중 시세 수집 준비 (PR #31)

## 구현 범위
- `collector/src/turso-direct.mjs`: D1을 **읽지도 쓰지도 않는 별도 Cron 수집기**. 기존 5분 주기를 재사용하되 Turso의 `blue_research_signal_audit_v1`, `blue_research_signals_v1`, `blue_eod_ingest_audit_v1`을 근거로 검증된 최신 연구 신호 종목을 순환 선택합니다.
- 한 번에 최대 **12종목**을 조회하고 호출 사이를 최소 450ms로 제한합니다. 189종목은 약 16번의 5분 주기를 거쳐 한 번씩 순환하므로 **각 종목이 5분마다 갱신되는 것은 아닙니다.**
- KIS의 실제 응답을 기존 `parseQuote`로 검증해 Turso `blue_kis_live_quotes_r141`과 `blue_kis_live_history_r141`에 저장합니다. 비교 API가 후속 거래일의 최신 확인가로 읽습니다.
- 장중 `KIS_REST_INQUIRE_PRICE` 저장 관측은 **실시간 체결가/확정 종가가 아닙니다.**
- 백그라운드 D1 수집기 예외와 독립된 `ctx.waitUntil`으로 동작합니다.
- 수집기는 자동 활성화되지 않습니다. 기본 설정은 OFF, 15/30분 시간제한 파일럿만 별도 Workflow로 허용됩니다.

## 토큰 전환을 위한 필수 보호
- `tools/turso/kis-token-steward.mjs`: KIS 토큰을 HKDF-SHA256+AES-256-GCM으로 암호화하여 Turso의 `blue_turso_kis_vault_v1`에 보관합니다. 기존 D1 토큰 복호화 형식과 호환되지만 **D1에서 토큰을 읽어오지는 않습니다**.
- KIS 토큰 발급은 GitHub Actions의 `BLUE Turso KIS Token Steward`에서만 수행하며, 전환 완료 전에는 **check만** 실행합니다.
- 안전한 전환 순서:
  1. 기존 D1 토큰 발급 워크플로의 예약 실행을 GitHub 저장소 변수 `BLUE_KIS_TOKEN_AUTO_PAUSED=true`로 일시 중지합니다. **중지 시각 UTC**를 따로 기록합니다. D1로 수동 토큰 발급도 중지합니다.
  2. 중지 후 최소 **24시간 동안** 이전 토큰 발급이 없었음을 확인합니다. 이전 발급이 더 늦게 있었다면 그 시각 기준으로 다시 24시간을 지킵니다.
  3. GitHub 저장소 변수 `BLUE_KIS_D1_DISABLED_AT_UTC=2026-...Z`를 **실제 중지 시각**으로 설정합니다. 예시는 임의로 사용하지 않습니다.
  4. 변수 `BLUE_KIS_TURSO_CUTOVER_APPROVED=true`를 설정하면 새 토큰 발급 관리자를 승인하는 것입니다. 기존 D1 발급 예약은 계속 꺼둡니다.
  5. `BLUE Turso KIS Token Steward`를 `mode=check`로 실행하여 상태를 확인하고, 필요 시 `mode=issue`, `confirm_cutover=blue-turso-kis-cutover`로 명시적인 한 번의 발급을 요청합니다.
  6. 로그 `BLUE_TURSO_KIS_TOKEN_STEWARD`의 `TOKEN_SAVED` 또는 `TOKEN_VALID`를 확인합니다. API 키·토큰·암호문은 어떤 로그에도 표시되면 안 됩니다.
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
