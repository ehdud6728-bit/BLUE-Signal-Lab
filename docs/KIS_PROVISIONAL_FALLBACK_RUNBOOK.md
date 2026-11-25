# KRX 미확정 시 KIS 잠정 일봉 보완 — 운영 절차

2026-11-20 KST 기준 코드 정책입니다. PR 병합은 Worker 배포·KIS 수집 활성화와 다릅니다.

## 실제 수집 시간과 우선순위

1. Collector가 **배포되고 `COLLECTOR_ENABLED=true`이며** `TURSO_PROVISIONAL_QUOTES_ENABLED=true` 또는 유효한 시한부 PILOT Secret이 설정된 경우에만 잠정 수집을 시도합니다. 기본 OFF입니다.
2. 한국 정규장 09:00~15:20 KST는 KIS `inquire-price`, 15:20~22:00 KST는 **동일 거래일 확인이 가능한** KIS `inquire-daily-price`를 사용합니다. 토·일·등록 휴장일 및 22:00 이후에는 호출하지 않습니다.
3. 동일일 `blue_eod_ingest_audit_v1` 건수와 `blue_eod_daily_v1` 실물 건수가 일치하면 KRX 검증 EOD를 우선하며 KIS 중복 수집을 건너뜁니다. 그렇지 않으면 최근 7일 이내 **감사 완료 전 거래일의 종목 목록**으로 순환 수집합니다.
4. 기존 Turso 암호화 토큰만 재사용하며 tokenP 호출/새 발급은 하지 않습니다. FULL은 최초 20→최대 40종목/분(계정 전체 KIS 쿼터의 보증치 아님), PILOT은 10종목/분. `EGW00201` 또는 429 발생 시 FULL 3분 냉각 및 감속. 500개 KIS 호출 동시 요청 없음.
5. 수집 성공 데이터는 `blue_kis_provisional_daily_v1`과 Turso KIS 시세 이력에 `IN_PROGRESS`로 저장합니다. **확정 EOD/연구 감사/BLUE 신호 원장은 수정하지 않습니다.**

## 0건이면 확인할 것

운영에서 0건이 발생한 **실제 사유는 아직 확정되지 않았습니다.** 우선 읽기 전용 [Collector Runtime Settings Audit](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/workflows/blue_collector_runtime_settings_audit.yml)로 배포된 설정의 활성 여부(민감값은 숨김), 이어서 [KIS Provisional Day Audit](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/workflows/blue_turso_provisional_audit.yml)로 해당일 Turso 수집 건수를 확인합니다. 이 둘은 KIS 호출·토큰 발급·DB 쓰기를 하지 않습니다.

- `DISABLED`: 활성화/배포되지 않았거나 별도 Collector 플래그가 OFF. PILOT Secret 만료 시에는 자동으로 OFF 복귀.
- `NO_VERIFIED_EOD_REFERENCE`, `STALE_EOD_REFERENCE`, `INCOMPLETE_EOD_REFERENCE`: 수집 대상 전일 전체시장 감사/실물 원장이 부재 또는 불일치.
- `TURSO_TOKEN_MISSING`, `TURSO_TOKEN_EXPIRED`, `KIS_CONFIG_MISSING`, `TURSO_TOKEN_DECRYPT_FAILED`: 유효 토큰 없음. 자동 tokenP 발급하지 않음. 기존 관리자 절차로 조정.
- `NO_VALID_QUOTES`: Collector 로그 `reasons=KIS_DAILY_EXACT_DATE_MISSING:...` 등 **허용된 에러 코드와 횟수만** 확인. 실제 응답 전문/토큰/URL 출력 금지. 거래일 미일치·빈 데이터와 네트워크 실패를 구별.
- `KIS_RATE_LIMIT_BACKOFF`, `KIS_RATE_LIMIT_COOLDOWN`: 공급자 제한으로 감속·중지. 제한 해제 전 병렬 폭증 금지.
- `SAVED`, `SAVED_WITH_KIS_COOLDOWN`: 해당 분에 수집한 **부분 종목 수**. 전체시장 완료를 뜻하지 않음.

## KRX 검증 실패 시 통합 워크플로 표시

[일일 EOD + Research](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/workflows/blue_turso_daily_verified_eod_auto.yml)는 22:20 KST에 확정 KRX 원천 검증을 시도합니다. 원천 실패 시 검증 EOD/패턴/지표 쓰기를 **전부 건너뛰고**, Turso에 이미 수집한 **해당일 KIS 잠정 행**과 감사 완료 전 기준일만 읽습니다.

- `BLUE_KRX_FALLBACK status=KIS_PARTIAL_PROVISIONAL`: 기존 KIS 부분 관측이 확인되어 액션은 끝나지만 **확정 패턴 성공은 아님**. 검색 진행 조회는 `PROVISIONAL`로 표시합니다.
- `EXISTING_EOD_RESEARCH_PENDING`: 과거 실행에서 이미 전체 KRX EOD 감사/실물이 확보되었으나 이번 연구 저장은 확인되지 않으므로, KIS 잠정 완료로 표시하지 않고 실패로 남김.
- `KIS_PROVISIONAL_NOT_AVAILABLE`: KRX도 확인되지 않고 KIS 행도 없음. **실패로 남김**, 성공 조작 금지.

KIS는 **22시 이후 새로 수집하지 않습니다.** 22:20 KRX 단계에서 KIS API를 호출하면 이미 정한 시간 제한을 어기므로, 같은 날 KIS 보완은 사전에 배포·승인 활성화된 Collector가 15:20~22:00 사이에 수행해야 합니다. 운영 `TURSO_PROVISIONAL_QUOTES_ENABLED` 영구 활성화, Collector/API/PWA 배포는 각각 별도 검토·승인 항목입니다. PR만 병합해서 0건 문제가 실제 해결됐다고 판단하지 않습니다.

## 웹 화면과 다음 단계

조회 화면은 22:00 KST 전에는 KRX 미분석 오늘 날짜에서 잠정 KIS 관측을 우선 표시하고 불필요한 KRX 재요청을 피합니다. 읽기 전용 API는 감사 완료 전 기준일의 EOD 실물 건수까지 확인한 뒤 **양봉/고가권/기준일 고가 돌파/기준일 대비 거래량 2배** 등의 단순 일봉 관찰 조건을 계산합니다. 이것은 RSI·MACD·GC·ENV 등 BLUE 기술 패턴이나 투자 추천이 아닙니다. KRX 확정 전체 일봉을 확보하면 기존 R1.1 분석·감사 경로를 다시 따릅니다. 최신/과거 5·10·20·60·120·250·500일 성과 및 익절·손절은 **별도 충분한 이력과 시간분리 검증**이 확보될 때까지 게시하지 않습니다.

필요 운영 순서: PR CI 및 사용자 병합 → Collector/API/PWA 코드 별도 승인 배포 → 배포된 플래그 확인 → 15/30분 KIS 파일럿(별도 사용자 실행) → 해당일 감사/에러 코드 확인 → KIS 정상 및 실제 쿼터 확인 후 사용자 별도 승인으로 FULL 상시 활성화 → KRX 확정 일봉 수신 시 자동 대조. 대용량 KIS 원격 호출·토큰 새 발급·운영 DB 쓰기는 이 PR 작업에서 실행하지 않습니다.


## 2026-11-25 당일 잠정 검색 반복 미게시 대응
- 사용자 화면 18:53 KST: 11/25 잠정 패턴 미게시, 전일 확정 11/24, KIS 수집 1715/2660종목, 최신 수신 18:38. 이는 수집 성공 일부와 패턴 게시 부재를 구분해야 하는 사례이며 해당일 수동 workflow 실패 여부는 실행 로그 없이는 미확인.
- 기존 수동 blue_provisional_pattern_publish.yml에 평일 11:20/14:20/18:50 KST schedule apply 추가. main만, 기존 동일 concurrency 및 검증된 head promotion 사용. 새 KIS 호출/토큰 발급/D1/확정 EOD 변경 없음. 당일 감사 EOD 존재, 수집 없음, 장외/주말, 자동 실행 시 최신 수신 60분 초과 또는 기존 head보다 새 수신 없음은 skip. 휴장일은 당일 저장 관측 존재 여부로 방어(공식 휴장 달력 확인 아님). 수동 apply 유지. 자동 실행 결과 raw artifact 업로드 없음. GitHub cron 지연/실행 시간/외부 history 공급처/Actions 비용 및 실제 시장 수집 커버리지 확인 필요; 분 단위 실시간 검색 아님.
- KIS 잠정 시세 조회에 기존 code+market 종목명 사전 결합 및 이름 필터, 원본 가격 불변. 화면은 요약만 기본 표시, 개별 시세와 장문 안내 접기. 연구 데이터 및 추천 규칙 불변. 향후 연구 화면은 기존 통합 연구센터의 핵심 결과 중심으로 상세만 펼치는 원칙 유지. 새 지표별 메뉴 추가 지양.


## 당일 검색 주기 및 개별 시세 품질 개선 (PR #196 후속)
- 평일 KST 09:20~14:20 30분 간격, 14:35~15:25 10분 간격, 15:50 및 18:50: 총 19회 예약 기회. GitHub 예약은 지연/누락될 수 있으며 분석 소요시간과 수집 순환 주기가 추가된다. 실시간/전시장 동시 조회 보장 아님.
- 정규장 기준 15:30 이전: 각 종목의 수신 시간이 당일 09:00 이후이며 추출 시점보다 미래가 아니고 90분 이내여야 한다. 90분은 40종목/분 순환 수집(2660종목 약 67분)을 고려한 초기 상한이며 전체 종목이 10분마다 갱신된다는 뜻이 아니다.
- 15:30 이후: 당일 15:30 이후 수신한 KIS 일봉 endpoint의 관측만 분석한다. 장중 관측은 종가로 대체하지 않는다. 정확한 KRX 확정 일봉을 의미하지 않으며, 특별 거래시간/휴장일 달력 검증은 별도 과제.
- 원본 payload 파싱 오류, 저장값 불일치, 잘못된 OHLCV/시각은 종목 단위 제외 및 사유 집계. 중복 근거, 감사 원장/실물 건수 불일치, 전체 유효 시세 없음, 기준 이력 실패는 게시를 중단하며 기존 head 보존. 거래대금 미수신은 null 유지. joinedRaw/ joined / rejectedCount 및 사유 합계를 게시 직전 대조.
- 기존 원천 공급 경로와 교차검증 수준은 불변. MARCAP 이력의 독립 검증·거래일 완전성은 미확인. 22:20 확정 EOD 작업 및 확정 연구 원장 변경 없음.
- 예약 skip 시 Python 환경/의존성 설치와 기준 이력 준비를 하지 않도록 순서 조정. 유효 실행마다 기존 이력 준비와 전체 잠정 분석을 실행한다. 19회 전부 실행 시 기존 3회보다 최대 6.3배 실행 및 스냅샷 증가 가능. 실제 실행시간, 원천 API/Turso 읽기·쓰기/저장량, 최신 시세 비율, 실패/skip 사유를 첫 거래일 점검. 자동 이전 세대 삭제, 캐시, 공급자 변경은 이번 변경 범위 아님.
- 테스트 및 운영 검증 전 성공 단정 금지. UI는 기존 잠정 표시를 유지하며 이 변경에는 Worker/PWA 수정 없음.


## 2026-11-25 연장거래 검증 (PR #197 후속)
- 2026-09-14 이후 KRX 애프터마켓 16:00~20:00, NXT 15:40~20:00. KIS 공식 예제의 J=KRX, NX=NXT, UN=통합은 시장 구분이며 정규장 OHLCV 보증이 아니다. https://github.com/koreainvestment/open-trading-api/tree/main/examples_llm/domestic_stock
- 현행 잠정 수집기는 15:20 이후 J 일봉 API(inquire-daily-itemchartprice)를 주로 사용하고 응답의 stck_clpr를 price로 매핑한다. 이 가격을 애프터마켓 체결가로 사용할 수 없다. 과거 저장물에는 다른 일봉 endpoint가 있을 수 있다.
- 20:20 예약 분석 1회 추가(총 20회 예약 기회); 기존 동일 날짜/신규 관측/신선도/감사 gate 유지. 실제 실행 시각이나 새 관측 보장 아님. 22:20 확정 EOD 경로 불변.
- 기존 blue_turso_provisional_audit.yml에서 session-evidence-audit.mjs를 먼저 실행한다. 최근 7일 중 명시한 1일만 SELECT. 일봉 응답 수신시간 구간·endpoint·원본 근거 일치 건수, J/KRX_AFTER 및 NX/NXT_AFTER 수신기록 수/종목수, 감사 건수 일치 KRX EOD 존재 시 동일일 동일 코드 OHLCV 일치 건수를 집계한다. 미확정/불완전 감사이면 비교하지 않는다. 원본 응답 덮어쓰기 및 미수집은 불일치로 간주하지 않으며 실제 비교 분모를 기록한다. 로그는 집계만 출력.
- 수신시간/phase는 체결시각/세션 검증이 아니다. 15:30/15:40/16:00/20:00은 통상 거래일 기준, 특별 거래시간 미지원. KRX 감사 건수 일치는 독립 원천 검증과 다르며, 비교 결과로 패턴 일치율이나 수익률을 단정할 수 없다.
- 정규장 패턴과 연장거래 진입 판단을 분리하는 방향 유지. 연장거래 현재가 신규 호출·수집 활성화·DB 쓰기·화면 추가는 이 변경에 포함하지 않는다. 실제 저장 관측/공급자 기준을 먼저 확인한 뒤 별도 경로 구현 판단. 추가 Worker/PWA 배포 불필요.


## 자동 분석 비용 및 원본 근거 강화
- 15:30 이후 preflight에서 동일일 15:30 이후 수신한 정확 거래일 일봉 관측이 없으면 NO_POST_CLOSE_QUOTES로 분석하지 않음. 예약 실행은 최신 유효 후보 관측이 60분보다 오래된 경우 STALE_POST_CLOSE_QUOTES로 건너뜀. 이 단계는 원본 payload 검증을 대체하지 않음.
- 추출 단계에서 저장 OHLCV 전체와 원본 payload를 대조하고 일봉은 정확한 공급자 보고 거래일·잠정 플래그·출처를 추가 검사. 불일치 개별 종목 제외 및 사유 집계.
- 예약 실행의 유효 종목 0건은 BLUE_PROVISIONAL_EXPORT_GATE ready=false로 기록하고 Python 설치·이력 다운로드·패턴 분석·게시 모두 생략. 수동 실행에서 추출 후 유효 종목 0건은 기존처럼 실패. 이전 head 보존; skip은 신규 게시 성공 아님.
- 실제 비용/속도 개선량은 실행 로그로 측정 필요. 정상 분석의 전체 이력 재다운로드, 스냅샷 보존 비용 및 캐싱은 아직 해결하지 않음. 기존 분석 산식 및 20회 예약, 확정 일봉 원장, KIS 호출 한도 변경 없음.


## 공개 MARCAP 원본 캐시 (PR #200 후속)
- 유효한 잠정 분석에만 공개 upstream master의 현재 Git commit을 조회하고, 그 40자리 revision 및 기준일 연도에 해당하는 전년도·당해년도 parquet 원본만 GitHub Actions 캐시에 저장한다. 정확한 키만 복원하며 이전 revision으로 폴백하지 않는다.
- SHA-256 manifest 및 parquet 파싱 검사 실패 시 해당 캐시는 사용하지 않고 동일 revision의 원본 2개를 다시 내려받는다. manifest는 두 파일 모두 성공 후 기록. 동일 revision 다운로드 실패 시 분석 실패이며 기존 게시 결과 보존. revision 조회가 불가능하면 캐시 없이 기존 원천 조회 경로 사용(BYPASS).
- 캐시에 KIS 관측·KRX 계정 정보·Turso 정보·준비된 일봉/분석 결과는 저장하지 않는다. KRX 정확 기준일 검증 및 기존 이력/패턴 계산은 매번 유지한다. 원본 hash는 바이트 무결성 지표이며 수정주가/원천 데이터 정확성을 독립 검증한 것이 아니다.
- BLUE_MARCAP_SOURCE 로그와 history.csv.meta.json에 revision·HIT/MISS/BYPASS 및 원본 해시 기록. 캐시 저장 실패가 정상 분석을 중단시키지 않도록 설정. 자동 삭제나 과거 원장 변경 없음. 실제 HIT 비율·원본 다운로드 및 복원 시간·캐시 저장량과 Actions 비용 개선은 운영 실행 로그로 측정해야 한다. 공개 소스 배포 정책 및 캐시 용량 한도에 따라 이점이 없을 수 있다.
