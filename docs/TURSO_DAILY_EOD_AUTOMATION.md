# Turso 확인 종가 자동 갱신 운영 가이드 (2026-11-19)

## 목적
Turso `blue_eod_daily_v1` 및 `blue_eod_ingest_audit_v1`에 검증된 **KRX 확정 일봉**을 D1 조회나 KIS 토큰에 의존하지 않고 저장합니다. API의 `/api/eod/prices/compare`는 이미 이 테이블을 읽으므로 별도 웹/Worker 배포는 필요하지 않습니다.

## 워크플로
- `.github/workflows/blue_turso_daily_verified_eod_auto.yml`
- GitHub 기본 브랜치에 병합하면 월~금 **18:35 KST**를 목표로 예약 실행됩니다. GitHub Actions 크론은 지연되거나 누락될 수 있습니다.
- 휴장일에는 원천 검증에 실패할 수 있으나 **전일 종가를 당일 데이터로 저장하지 않습니다**.
- 수동 실행: `trade_day=YYYY-MM-DD`, `mode=dry_run`을 먼저 사용한 후, 검증된 날짜에만 `mode=apply`를 실행합니다. 날짜를 비우면 한국 날짜 당일입니다.
- 이전 날짜 복구: 기존 `blue_turso_verified_eod_range.yml`을 사용하면 최대 10일 범위에서 각 거래일을 개별 확인하고 저장할 수 있습니다.

## 안전장치
1. 기존 `scripts/turso_verified_eod_range.py`로 원천 날짜·시장 범위·종목 행 수·해시 검증.
2. `tools/turso/eod-range-import.mjs`에서 중복은 수정하지 않으며, 기존 저장 값이나 감사 해시가 다르면 중지.
3. Cloudflare D1을 읽거나 쓰지 않고, KIS 토큰 발급 또는 시세 요청도 하지 않음.
4. 자동 모드는 원천 검증 후에만 `apply`; 사용자 수동 실행 기본값은 `dry_run`.
5. 실행 증빙은 Actions artifact로 14일 보관. 자격 증명과 API 토큰은 로그에 출력하지 않음.

## 확인 방법
GitHub Actions에서 `BLUE Turso Daily Verified EOD Auto (NO D1)`의 성공 로그에
`BLUE_TURSO_EOD_DAY_STORED day=... verified_rows=...` 및 `BLUE_TURSO_EOD_RANGE_OK`가 있어야 저장된 것입니다. 실행 작업 자체의 성공과 Turso 저장 확인 로그를 구분합니다.
웹의 패턴검색에서 검색일보다 **나중에 저장된 일봉**이 있는 종목은 최근 확인가와 해당 확정일을 함께 표시합니다.

## 한계와 다음 작업
- 이 워크플로는 **장중 현재가가 아닌 장 종료 후 확정 종가**만 저장합니다.
- 장중 KIS 저장 시세는 별도 Turso 미러 테이블 `blue_kis_live_quotes_r141`에 저장하도록 개발되어 있으나, 기존 수집기의 후보 검색·토큰 캐시는 D1에 의존합니다. Turso 미러가 켜져 있다고 해서 D1 독립성이 확보되는 것은 아닙니다.
- 다음 작업: 토큰 안전관리(24h 발급 제한 보존), Turso 기반 종목 후보/주문 아닌 시세 전용 수집, 시장 시간·속도 제한, 5분 단위 저장 시각 표시. 인증정보를 웹/로그에 노출하지 말 것.
