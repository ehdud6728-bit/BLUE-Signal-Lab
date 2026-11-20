# Turso 미수집 날짜 자동 탐색·순차 저장 운영 안내

2026-11-20 KST. 기존 `.github/workflows/blue_turso_history_research_batch.yml`를 지우거나
원장·데이터를 수정하지 않습니다. 신규 워크플로는
`.github/workflows/blue_turso_missing_history_backfill.yml`입니다.

## 작동 순서

1. KRX KOSPI 지수의 **실제 거래 날짜** 목록을 요청합니다. 토·일요일과 지수 원본에서
   거래가 확인되지 않는 휴장일은 누락 목록으로 분류하지 않습니다. 기간 결과가 심하게
   불완전하면 휴장일로 추정하지 않고 전부 중단합니다. 거래일은 정확한 KRX 원본 일봉
   검증으로 **각 날짜마다 다시 검증**합니다.
2. Turso `blue_eod_ingest_audit_v1`, `blue_research_signal_audit_v1`만 전체 기간 조회하고
   기존 감사 원장의 종목 수·패턴 관측 수 등 정합성을 검사합니다. 완결된 두 원장이 있는
   날짜는 재계산·재삽입하지 않습니다. 날짜별 읽기/계산은 오래된 미수집 날짜부터
   **한 번에 최대 5거래일**입니다. 특정 연구일만 누락되었다면 EOD를 다시 쓰지 않습니다.
3. 원장과 행 수가 맞지 않거나 원장 없는 과거 행이 일부 존재하면 `blocked` 목록에
   사유를 남기고 건너뜁니다. **기존 데이터 자동 덮어쓰기/삭제/해시 교체는 금지**입니다.
   2026-11-10처럼 과거 연구 관측 수와 KRX EOD 종목 수가 다른 날도 별도 감사 대상으로
   분리됩니다. 선택된 다른 날짜는 계속 진행합니다.
4. `dry_run`은 선택한 날짜별 KRX EOD→R1.1 연구를 해시 검증하고 Turso에 쓰지 않습니다.
   `apply`는 승인된 경우만 기존 EOD→연구 불변 importer를 순서대로 호출합니다.
   날짜별 실패를 보고하고 **다음 날짜로 진행**하되, 실패가 한 건이라도 있으면
   실행 전체는 실패로 표시합니다. 일부 날짜만 성공할 수 있으므로 결과의 날짜별
   `BLUE_MISSING_HISTORY_DAY_OK/FAILED`를 확인합니다.

## 수동 실행 (권장 첫 단계)

GitHub Actions > `BLUE Turso Missing History Backfill (BOUNDED)` > Run workflow.

| 입력 | 최초 권장값 | 설명 |
| --- | --- | --- |
| Branch | `main` | 보호된 기본 브랜치만 허용 |
| `mode` | `audit` | KRX 거래일 + Turso **SELECT만**, 저장 0건 |
| `lookback_days` | `760` | KST 어제까지 약 2년(30~760일) |
| `batch_size` | `5` | 한 번에 처리할 미수집 거래일 1~5 |
| `confirm_write` | 빈값 | `audit` 및 `dry_run`은 필요 없음 |

`audit`에서 선택 날짜·충돌 목록을 확인하고 `apply`로 바꾸어 실행할 때만
`confirm_write=blue-turso-missing-history-apply`를 정확히 입력합니다.
이후 다음 실행에서는 이미 성공한 날짜가 자동 제외되어 **다음 미수집 날짜**가 선택됩니다.
기존 감사가 있는 11/10은 자동으로 재저장하지 않습니다.

## 사용자 승인 후에만 예약 활성화

기본적으로 예약된 백필은 **비활성**입니다. 사용자가 GitHub Repository
Settings > Secrets and variables > Actions > Variables에서 두 값을 설정할 때만
매일 **05:00 KST (20:00 UTC)** 5개 미수집 거래일을 저장합니다.

- `BLUE_TURSO_MISSING_HISTORY_AUTO_ENABLED` = `true`
- `BLUE_TURSO_MISSING_HISTORY_AUTO_CONFIRM` = `blue-turso-missing-history-scheduled`

두 변수 중 하나라도 없으면 예약 실행은 건너뛰거나 가드에서 차단됩니다.
자동 저장을 멈추려면 `BLUE_TURSO_MISSING_HISTORY_AUTO_ENABLED=false`로 바꿉니다.
이 예약은 전체 종목 지표 저장, D1 백필, KIS 토큰 발급, Cloudflare 배포,
매매/AI 추천을 수행하지 않습니다. 2년치 누적은 다수의 날짜별 실행과 상당한
Turso 저장 공간·KRX 요청이 필요할 수 있으므로 최초 1회 수동 `apply` 결과와
요금/쿼터를 확인한 뒤 예약을 활성화하세요.

로그 `BLUE_MISSING_HISTORY_PLAN`과 14일 보존 아티팩트 `selection.json`에
`selected`, `blocked`, `missing_audit_sessions`, `remaining_possible`가 있습니다.
`missing_audit_sessions`는 KRX 지수 거래일에서 해당 감사 원장이 빠진 **후보 수**로,
모든 날짜의 가격·패턴 분석 성공이나 조정주가 완전성의 증거가 아닙니다.
실패/차단일은 별도로 조사하고, 자동 완료 숫자에 포함하지 않습니다.
