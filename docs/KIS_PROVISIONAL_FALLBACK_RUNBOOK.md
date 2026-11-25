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
