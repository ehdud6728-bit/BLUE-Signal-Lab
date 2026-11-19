# BLUE Turso — 기술 패턴 연구·차트 일별 누적 (D1 SQL 없음)

> 2026-11-19 (KST). 코드·워크플로 준비 절차이며 운영 자동 실행을 승인한 기록이 아닙니다.

## 감사로 확인된 출발점

- [Turso Primary Readiness #44500952883](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44500952883): `turso_recent`, `RECENT_TURSO_COUNTS_MATCH`, 최근 감사 EOD **8/8일**, 연구 신호 **2026-11-18 한 날짜 189/189건**, KIS 최신가 기록 2026-11-19 **2종목**.
- 감사는 Turso 원장과 Turso 행 수만 비교했습니다. D1 전체 이력 일치/이관 완료, 장중 KIS 시세 전체 정상 동작의 증거는 아닙니다.
- API `/api/research/dates`, `/api/research/search`, `/api/research/chart`는 이미 감사 완료 Turso 연구 스냅샷을 읽습니다. 이번 단계는 **새 화면을 추가하지 않고** 날짜별 스냅샷을 계속 적재하는 경로입니다.

## 안전한 첫 실행 (PR 병합 후)

1. [BLUE Turso Daily Research Snapshot](../.github/workflows/blue_turso_daily_research.yml)을 `main`에서 수동 실행합니다.
2. `trade_day=2026-11-19` 또는 확인하려는 **정확한 거래일**, `mode=dry_run`으로 실행합니다. `confirm_write`는 빈 값입니다. 소스 분석과 224일 기반 차트·연구 스냅샷 무결성만 검사하며 **Turso/D1 SQL 호출 0회**입니다.
3. 생성된 로그에서 `BLUE_R11_EOD_STATUS`의 날짜·시장 표본과 `BLUE_TURSO_SIGNAL_SNAPSHOT_DRY_RUN`의 건수 및 차트 생성 완료를 확인합니다. 원천 자료가 준비되지 않았다면 멈추며 이전 날짜로 대체하지 않습니다.
4. 기존 [Turso Daily Verified EOD Auto](../.github/workflows/blue_turso_daily_verified_eod_auto.yml)의 같은 거래일 `apply` 감사가 **이미 성공**했는지 확인합니다. 빠진 날짜는 연구 스냅샷보다 EOD 저장 검증을 먼저 합니다. D1에서 가져와 보완하지 않습니다.
5. 명시적 별도 승인 후 같은 날짜를 `mode=apply`, `confirm_write=blue-turso-research-only`로 수동 실행합니다. **Turso 감사 EOD 일자·각 신호 종목 종가 일치**를 다시 검사한 다음 연구·차트만 Turso에 멱등 저장/재조회 검증합니다. 기존 해시와 내용이 다른 기록은 덮어쓰지 않고 실패합니다.
6. 읽기 전용 [Turso Primary Readiness](../.github/workflows/blue_turso_primary_readiness.yml)의 `turso_recent`을 재실행해 새 날짜의 연구 `expected=actual`을 확인합니다. 그다음 모바일 기존 기술 패턴 검색의 날짜 목록·차트 확인을 진행합니다.

## 예약 실행은 기본 OFF

- `.github/workflows/blue_turso_daily_research.yml`에는 **평일 20:15 KST** 예약이 준비돼 있지만, 저장소 Actions Variables의 `BLUE_TURSO_RESEARCH_AUTO_ENABLED`가 **정확히 `true`**일 때에만 실행됩니다. PR 병합만으로 자동 쓰기를 활성화하지 않습니다.
- 예약 모드는 `apply`이며, 출처 검증과 독립 Turso 감사 EOD 증명이 실패하면 **저장을 거부**합니다. 시장 휴장일·소스 미준비·일봉 자동 수집 실패는 성공으로 가정하지 않습니다. 스케줄은 GitHub 지연이 가능하므로 정확히 20:15에 저장된다는 보장은 없습니다.
- 장중 KIS 토큰 발급·5분 호가·D1 보조 미러·서버 장바구니 watch에는 영향이 없습니다.
- 이전 D1 `runs/signals/chart_snapshots` 전체 과거 자료는 그대로 보존하고, 누락 날짜 백필/이관은 별도로 진행합니다.
- 새 스냅샷은 재검증 시각만 달라져도 동일한 시장 원천 해시를 유지하도록 정규화합니다. 단, 기존 수동 방식으로 이미 저장된 11월 18일 등 과거 날짜는 이전의 원본 감사 파일 해시와 다를 수 있으므로 무작정 재적재하지 않고, 충돌이 나면 기존 기록을 보존한 채 원천·행 해시를 별도 검증합니다.

## 다음 단계

Turso의 감사 완료 연구 날짜가 여러 날 누적되는지 확인한 뒤, P0의 Turso 독립 장중 1종목 KIS 즉시조회 배포/운영 플래그 상태를 별도 승인 아래 검증합니다. 이어서 서버 장바구니 watch를 Turso로 이관합니다. D1 원본 삭제나 D1 바인딩 제거는 완료 조건이 아닙니다.
