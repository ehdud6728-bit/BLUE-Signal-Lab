# Turso 미수집 날짜 자동 탐색·순차 저장 운영 안내

2026-11-20 KST. 기존 `.github/workflows/blue_turso_history_research_batch.yml`를 지우거나
원장·데이터를 수정하지 않습니다. 신규 워크플로는
`.github/workflows/blue_turso_missing_history_backfill.yml`입니다.

## 작동 순서

1. 먼저 토·일요일을 제외한 날짜를 **아직 KRX 확인되지 않은 후보**로 만듭니다.
   별도의 외부 달력이나 불안정한 2년치 지수 기간 조회를 거래일 증거로 사용하지
   않습니다. Turso 감사 원장에서 미수집 후보를 찾은 뒤, 오래된 최대 **50개 평일 후보**
   중 KRX의 정확한 해당일 KOSPI·KOSDAQ 전체 일봉 검증을 통과한 날짜만
   **최대 5거래일** 처리합니다. 휴장일과 공급자 장애를 무리하게 구별하거나
   누락이 아님으로 영구 표기하지 않습니다. 검증 불가 날짜는 별도 보고합니다.
2. Turso `blue_eod_ingest_audit_v1`, `blue_research_signal_audit_v1`만 전체 기간 조회하고
   기존 감사 원장의 종목 수·패턴 관측 수 등 정합성을 검사합니다. 완결된 두 원장이 있는
   날짜는 재계산·재삽입하지 않습니다. 특정 연구일만 누락되었다면 EOD를 다시 쓰지 않습니다.
3. 원장과 행 수가 맞지 않거나 원장 없는 과거 행이 일부 존재하면 `blocked` 목록에
   사유를 남기고 건너뜁니다. **기존 데이터 자동 덮어쓰기/삭제/해시 교체는 금지**입니다.
   2026-11-10처럼 과거 연구 관측 수와 KRX EOD 종목 수가 다른 날도 별도 감사 대상으로
   분리됩니다. 선택된 다른 날짜는 계속 진행합니다.
4. `audit`는 Turso SELECT와 KRX 정확일 전체시장 검증만 수행하고 저장하지 않습니다.
   `dry_run`은 추가로 R1.1 연구를 해시 검증하고 Turso에 쓰지 않습니다.
   `apply`는 승인된 경우만 기존 EOD→연구 불변 importer를 순서대로 호출합니다.
   날짜별 실패를 보고하고 **다음 날짜로 진행**하되, 실패가 한 건이라도 있으면
   실행 전체는 실패로 표시합니다. 일부 날짜만 성공할 수 있으므로 결과의 날짜별
   `BLUE_MISSING_HISTORY_DAY_OK/FAILED/KRX_UNVERIFIED`를 확인합니다.
   KRX 원천이 연속 8개 날짜에서 확인되지 않으면 공급자 장애 가능성이 있으므로
   대량 재시도를 멈춥니다.

## 수동 실행 (권장 첫 단계)

GitHub Actions > `BLUE Turso Missing History Backfill (BOUNDED)` > Run workflow.

| 입력 | 최초 권장값 | 설명 |
| --- | --- | --- |
| Branch | `main` | 보호된 기본 브랜치만 허용 |
| `mode` | `audit` | Turso **SELECT + KRX 실제 날짜별 검증**, 저장 0건 |
| `lookback_days` | `760` | KST 어제까지 약 2년(30~760일) |
| `start_day` | 빈값 | 선택사항: 특정 기간 첫날, `YYYY-MM-DD` |
| `end_day` | 빈값 | 선택사항: 특정 기간 마지막 날, `YYYY-MM-DD` |
| `batch_size` | `5` | 한 번에 처리할 미수집 거래일 1~5 |
| `study_after` | `false` | 성공한 수동 작업 뒤 **읽기 전용** 5·10·20·60거래일 보유 연구 보고서를 한 번 생성 |
| `confirm_write` | 빈값 | `audit` 및 `dry_run`은 필요 없음 |

`audit`에서 선택 날짜·충돌 목록을 확인하고 `apply`로 바꾸어 실행할 때만
`confirm_write=blue-turso-missing-history-apply`를 정확히 입력합니다.
이후 다음 실행에서는 이미 성공한 날짜가 자동 제외되어 **다음 미수집 날짜**가 선택됩니다.
기존 감사가 있는 11/10은 자동으로 재저장하지 않습니다.

### 2026년 11월 2~20일을 먼저 연구할 때

오래된 2년치 자료를 먼저 수집하지 않고 **11월 2~20일을 우선** 채우려면
`start_day=2026-11-02`, `end_day=2026-11-20`, `lookback_days=760`,
`batch_size=5`를 설정합니다. 두 날짜는 **함께** 입력해야 하며,
선택 범위는 최대 31달력일·한국 시간 어제까지·lookback 이내여야 합니다.
평일 후보는 15일이지만 실제로 저장할 날은 감사 원장 확인 후 고릅니다.
완료 감사가 있는 EOD/연구일은 건너뛰고, 11/10 같은 원장 충돌일은
`blocked`로 격리하며 기존 원천 데이터를 바꾸지 않습니다.

1. `mode=audit`, `study_after=false`: Turso SELECT와 최대 5일 KRX 정확일 검증.
   실제 누락·충돌 날짜를 보고 EOD/연구가 얼마나 남았는지 확인합니다.
2. 자료가 검증되고 사용자 승인을 받은 뒤에만 `mode=apply`,
   `confirm_write=blue-turso-missing-history-apply`, `study_after=true`를 사용합니다.
   5일 단위로 다음 미수집일을 반복 채우고, 각 성공한 실행 말미에 **D+5·D+10을
   포함한 단일 탐색 연구 보고서**를 작성합니다. 이 보고서는 Actions 요약
   아티팩트에만 저장되며 앱 Turso 보고서 테이블에 게시되지 않습니다.
3. 11월 2~20일의 **실제 거래일 연속 일봉과 발생일 패턴 감사**가 충분해야
   11/2~6의 D+10 성숙 사례를 관측할 수 있습니다. `study` 완료 표본 수는
   보고서 `observed_path_windows`로 확인하고, 누락 데이터·거래일 캘린더·수정주가
   미검증을 숨기지 않습니다. 기존 게시 불변 보고서는 덮어쓰지 않습니다.

`study_after`를 선택하더라도 KIS 토큰 신규 발급, D1, API/웹 배포,
AI 추천 및 보고서 `publish`는 일어나지 않습니다. 예약 실행은 위 날짜
선택이나 후속 연구 없이 기존 2년 lookback 동작을 그대로 유지합니다.

### KIS 잠정 시세만 저장된 날짜와 확정 일봉 구분 (2026-11-21)

`selection.json`의 `source_evidence`는 **선택·차단된 날짜에 한해**
Turso에서 읽은 자료 존재 여부를 표시합니다. `blue_kis_provisional_daily_v1`은
KIS 부분 종목의 **잠정 자료**이며 `blue_eod_daily_v1`의 KRX 전체시장 확정
일봉이 아닙니다. KIS 잠정 자료는 KRX 일봉 또는 BLUE 확정 패턴으로 자동 승격되지 않습니다.

- `price_state=KIS_ONLY_NO_KRX_CONFIRMED_EOD`: KIS 잠정 행이 있지만 해당 날짜의
  KRX EOD 감사 원장이 없음. `kis_rows`, `kis_postclose_daily_rows`는 **저장된
  원자료 개수**이며 전체시장 완성 또는 일봉 내용 검증의 증거가 아님.
- `price_state=NO_KRX_CONFIRMED_EOD`: KRX EOD 감사 원장이 없고 조회 가능한
  KIS 잠정 행도 없음. `kis_provisional=TABLE_MISSING`이면 KIS 존재 여부를
  판별할 테이블 자체가 없는 것이므로 수집 0건이라고 단정하지 않음.
- `price_state=KRX_EOD_AUDIT_PRESENT`: KRX EOD 감사 메타데이터가 존재함.
  이번 계획 단계는 전체 일봉 행이나 해시를 다시 읽지 않으므로 메타데이터의
  존재만으로 모든 원천 행의 정합성을 새로 입증하지 않음.
- `price_state=KRX_EOD_AUDIT_INVALID`: EOD 감사 원장 필수 필드가 비정상.
  KIS 행이 함께 있더라도 KRX 확정 일봉으로 취급하지 않음.
- `blocked[].details`: 기존 단일 `EXISTING_AUDIT_INCONSISTENT` 아래에서
  `SIGNAL_OBSERVED_VS_EOD_COUNT_MISMATCH`, `EOD_AUDIT_HASH_INVALID`,
  `SIGNAL_AUDIT_WITHOUT_EOD_AUDIT` 등 **실제 충돌 조건 코드**를 제공.
  사유가 있다고 해서 KIS 탓으로 추정하거나 원장을 자동 수정하지 않음.

이 추가 SELECT는 최대 100개 **선택·차단 날짜만** 확인합니다.
`source_evidence_total_days` 및 `source_evidence_truncated`로 표시 범위를 알 수
있고, 열거되지 않은 날짜의 KIS 수집 상태를 판단하지 않습니다. 저장·KIS 호출,
인증 토큰 발급·D1 조회는 여전히 0회입니다.

참고: [2026-11-21 Actions #44848048384](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44848048384)는
`mode=apply`로 11월 2·5·6일을 EOD/패턴 저장(각 날짜 `DAY_OK`, 실패 0)했고,
별도 읽기 전용 경로 연구 보고서도 생성했습니다. 당시 11월 10·13·16·17일은
기존 통합 감사 충돌이라는 **통합 코드만** 표시됐으며 이 변경을 병합한 뒤
다음 계획 로그부터 구체적인 원인과 KIS 잠정 존재 여부를 구분할 수 있습니다.

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
`selected`(KRX 검증 전 최대 50개 후보), `blocked`, `missing_audit_sessions`,
`remaining_possible`가 있습니다. `missing_audit_sessions`는 평일 후보 중
해당 감사 원장이 빠진 수이며, 실제 거래일 수는 **아직 아닙니다**.
전체 기간 가격·패턴 분석 성공이나 조정주가 완전성의 증거가 아닙니다.
실패/차단일은 별도로 조사하고, 자동 완료 숫자에 포함하지 않습니다.
