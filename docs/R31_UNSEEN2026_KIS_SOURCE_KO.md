# R31 새로운 30종목 원본 데이터 수집 (2026-11-24)

이 PR은 Stock-Hunter의 [R31 가설 고정 문서](https://github.com/ehdud6728-bit/Stock-Hunter/blob/research/r31-locked-two-hypotheses-new-tickers-20261124/research_projects/trendline_true55_r31_locked_unseen_cohort_20261124/PREREGISTERED_R31_PROTOCOL_KO.md)에 따른 **SOURCE_CAPTURE_ONLY / RESEARCH_ONLY** 원본 확보 단계입니다. **결과 라벨, R25·R27 매도 결과, 큰 상승 종목의 과거 실적을 여기서 계산하지 않습니다.**

## 사전에 선정한 새로운 30종목

`036570 035250 090430 051900 010950 018260 034730 259960 003670 058470 000810 071050 016360 008770 004170 097950 047050 030200 267250 010140 042660 329180 034220 011070 032640 069960 028050 000720 006360 035760`

- 기존 R19 26종목과 중복 0
- 기존 R28 30종목과 중복 0 (**R28에서 기업행위 미확인으로 제외된 207940 포함하여** 전원 금지)
- 신규 데이터에서 승률이나 성과를 확인하기 **이전**에 종목과 기간을 확정
- 업종과 시가총액이 다양한 대형·중형 관심 종목을 수동 지정한 **편의표본**으로, 전체시장의 무작위 추출이 아님. 상장폐지 종목도 제외될 수 있음.

## 원본 수집 범위

- 공급자: 한국투자증권 KIS `/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice`
- 날짜: 2025-01-02~2026-11-20, 2025년은 2026년 분석을 위한 지표·비중복 준비봉.
- 매매나 모델 테스트는 별도 Stock-Hunter R31 연구단계에서만 진행, KIS에는 **최대 240 GET**만 수행.
- R28에서 검증된 기존 **암호화 캐시 KIS 토큰**만 SELECT-only로 읽고 새 토큰 발급이나 Turso/D1 쓰기·실전 주문은 하지 않음. PR 자동 테스트는 토큰 조회·KIS 요청 모두 0회.
- 요청 페이지당 SHA256 및 최종 원시 CSV SHA256을 저장. 데이터 출처·기간·종목 중복, 중복 일봉, 잘못된 가격, 일별 35% 초과 시가 갭 등은 검증. **이상 종목은 격리하고 성과 좋은 다른 종목으로 대체하지 않음.**
- 최소 유효 20개 종목에 도달하지 못하면 **SOURCE_UNAVAILABLE_FAIL_CLOSED**, 원본 CSV 생성하지 않음.
- 기업행위, 거래정지, 상폐, PIT 종목 구성, 실제 체결·슬리피지는 미인증. 2026년은 기존 R28과 동일한 시간 구간이므로 시점별로 독립적인 시장 상태를 제공하지 않음.

## 실행 경로

PR CI 테스트 통과 후 병합. Actions `BLUE R31 Frozen 30 Disjoint Tickers 2026 KIS OHLCV Source (RESEARCH ONLY)` → `Run workflow` → `main` → `mode=capture` → `confirm_r31_disjoint30_scope=true`. 토큰만 확인하려면 `mode=token_check`를 선택.

수집 성공 후 `R31_SOURCE_MANIFEST.json`의 정확한 CSV SHA256, 유효 종목 수, 가격행 수, run_id를 고정해야 후속 Stock-Hunter 평가가 가능합니다. **현재 원본 데이터는 미수집이며 새 연구의 수익성은 미검증**입니다.

운영 BLUE Worker/UI/D1/Turso·KIS 시세 수집기·Stock-Hunter LIVE/SEARCH/WATCH는 변경하지 않습니다.
