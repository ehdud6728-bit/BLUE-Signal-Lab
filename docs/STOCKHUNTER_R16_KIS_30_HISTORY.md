# BLUE → Stock-Hunter R16: 기존 KIS 토큰으로 신규 30종목 일봉 원천 수집

상태: **연구 전용 코드 준비**. PR 병합·오프라인 테스트 성공만으로 실제 수집 또는 전략 검증에 성공한 것은 아니다.

## 고정 연구 범위

- Stock-Hunter R16의 2026-11-21 사전 고정 30개 종목코드를 **순서까지 동일하게** 사용한다. 실패한 종목을 성공한 종목으로 교체하지 않는다.
- 요청 기간 2020-01-01~2025-12-31, 한국투자증권 기간별 일봉 `FHKST03010100` / `inquire-daily-itemchartprice`, `FID_ORG_ADJ_PRC=1` **원주가**. 수정주가와 섞지 않는다.
- 원장·매매·검색·LIVE·WATCH·PWA·Cloudflare·D1·Turso 쓰기는 0회. 기존 터소 암호화 금고에 저장된 유효 KIS 토큰의 SELECT만 1회 사용한다. `tokenP` 발급·갱신은 금지한다.
- 1회 최대 100개 봉을 내려받으므로 조회 종료일을 이전 페이지의 가장 오래된 날짜 **전날**로 당겨 최대 22페이지/종목 조회한다. 종목 간·페이지 간 최소 1.75초 간격, 총 허용 상한 **660개 과거 일봉 GET**. KIS 429/`EGW00201`·401/403은 즉시 전체 중단, 재시도 폭주 없음.
- KIS 소스 이력은 과거 시점 권리락·분할/병합 반영 방식이 독립 인증되지 않은 자료다. 극단적 시가 갭(전일 종가 대비 35% 초과)은 임의 보정하지 않고 R16 구조 사전검증 불통과로 기록한다.

## 실행 방법

1. PR CI의 `offline_safety`가 통과하면 소스를 검토 후 `main`에 병합한다. **병합은 데이터 수집이 아니다.**
2. GitHub Actions에서 `BLUE to Stock-Hunter R16 KIS 30 Tickers History (RESEARCH ONLY)`를 선택한다.
3. 기본 `mode=dry_run`으로 **네트워크·DB·비밀키 사용 없는** 점검을 한다.
4. 실제 KIS 이력 수집을 승인하면 `mode=capture`, `confirm_fixed_scope=true`를 수동 선택한다. BLUE 기존 4개 Actions Secrets만 사용하며 키 값을 대화에 전달하거나 Stock-Hunter에 복사하지 않는다.
5. Actions 아티팩트 `BLUE_STOCKHUNTER_R16_KIS_30_<run_id>`의 다음 파일을 확인한다.
   - `R16_KIS_UNADJUSTED_30.csv`: `date,code,open,high,low,close,volume,amount` 정규화 원주가 및 수량/금액
   - `R16_KIS_SOURCE_MANIFEST.json`: 30개 원래 명단, 코드별 실제 조회 첫날/마지막 날·행 수, 280봉/35% 갭 검사, 페이지별 응답 SHA256, 합계 및 CSV SHA256
   - `R16_KIS_RUN_SUMMARY.json`: 전체 `status`, 실패 이유, 토큰 신규 발급·DB 쓰기 0 표기

## 결론을 내리기 위한 후속 단계

| 실제 상태 | 해석 |
|---|---|
| `DRY_RUN_NO_REMOTE_REQUESTS` | 코드만 오프라인 검증. **원천 일봉 0건** |
| `CAPTURE_COMPLETE_REPLAY_NOT_DONE` | 30종목 순회 완료, 그중 최소 10종목 280봉 및 갭 사전검사 충족. **R116/R14/R15 신호 재실행·수익검증 아님** |
| `INSUFFICIENT_R16_COVERAGE` | 30종목 순회 완료했지만 사전검증 충족 10종목 미만. **연구 성과 금지** |
| `SOURCE_UNAVAILABLE_FAIL_CLOSED` | 인증·권한·호출 제한 등으로 조기 중단. 데이터 결과가 없더라도 실패 원인만 기록 |

`first_requested_date_proven=false`: KIS가 조회 시작일 이전의 마지막 거래일 또는 상장일을 별도로 인증해 주지 않는다. 실제로 2020년 첫날부터 전 기간을 확보했는지는 코드별 `first_date/last_date/bars`와 별도의 상장·거래소 달력 자료를 비교해야 한다. **280봉 이상도 6년 전체 이력 인증은 아니다.**

BLUE CSV는 **Stock-Hunter R16에 곧바로 병합되는 입력이 아니다**. Stock-Hunter R16의 독립 수입기에서 행별 원주가·범위·코드·SHA 및 기업행동/극단값을 확인한 후, 재현이 가능한 종목만 R116/R14/R15 분석으로 넘긴다. 30개가 2,225종목의 사전 신호 출처 명단에서 추출된 **종목 중복 없는 편의 표본**이라는 한계와 20개 유효 이벤트 요건은 여전히 적용된다. 실전 추천 및 자동 매매 전환은 금지한다.

## 원천 근거

- KIS 공식 샘플: [기간별 일봉 조회](https://github.com/koreainvestment/open-trading-api/blob/main/examples_llm/domestic_stock/inquire_daily_itemchartprice/inquire_daily_itemchartprice.py) (1회 최대 100건, 원주가/수정주가 플래그)
- 기존 BLUE 암호화 토큰 읽기: `tools/turso/stockhunter-r9-kis-bridge.mjs`의 `obtainExistingToken`만 재사용.
- 본 작업의 코드: `tools/turso/stockhunter-r16-kis-history.mjs`, `stockhunter-r16-kis-history.test.mjs`, 새 수동 Actions.
