# BLUE Signal Lab — 현재 프로젝트 상황

> 업데이트: 2026-11-20 (한국 시간). 이 파일은 개발 인계용 요약이며, 서버의 실시간 상태를 자동으로 반영하지 않습니다.

## 2026-11-20 (KST) — 과거 연구 데이터 묶음 복구 + 단기·장기 첫 청산 연구 개발

- 사용자 요청: 과거 1~2년 이력 확보, 5·10·20·60일 초단기/단기 변화와 120·250·500일 장기 기준선, 패턴별 익절·손절·보유기간 비교, 이후 AI 관찰 후보까지 **하나의 개발 작업으로 추진**. 기존 신호 출현 빈도를 실현 수익률로 바꾸어 주장하지 않음.
- 코드 준비: `blue_turso_history_research_batch.yml`의 기간 최대 7달력일/5평일 수동 `plan`(네트워크/SQL 0), `dry_run`(KRX 소스만 검증), `apply`(날짜·별도 전체 종목 지표 승인 조건으로 Turso EOD+R1.1 연구·선택 전체 지표 순차 저장). **기존 운영 이력에 무단 쓰기 없음**.
- 코드 준비: `blue_turso_pattern_exit_study.yml`의 `plan`(SQL 0)·`study`(Turso SELECT, 감사 EOD/연구 원천 검증→오프라인 6개 사전 고정 청산 정책/시간분리 연구)·`publish`(별도 명시 승인 시 탐색 **요약만** Turso 불변 저장). API `/api/research/exit-study`, 웹 Turso `AI 패턴` 탭은 미게시 상태나 연구 결과·기간별 표본을 표시. **미완성 후속 일봉 PENDING, 원천 불일치 거부, 매수 추천/AI 외부 호출/자동매매 없음**.
- **데이터/추천 한계:** 최신 실물 감사 EOD 9일, R1.1 연구 5일·882건, 전체 기술지표 0일. 전체 거래일 캘린더·수정주가·기업행동·지수/업종 독립 확인이 없으므로 현재의 성숙 성과·'잘 먹히는 패턴'·수익 확률·관찰 종목 추천을 만들어 낼 수 없음. [안전 실행·연구 정책](TURSO_PATTERN_EXIT_BATCH_RUNBOOK.md) 준수. PR 병합/Cloudflare 배포/백필/보고서 게시 각각 별도 승인·실행.

## 2026-11-20 (KST) — 실제 감사 5일에 맞춘 패턴 발생 현황 1단계 (코드 준비)

- PR #54 병합 이후 [수동 Turso 감사 #44652090911](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44652090911)에서 **EOD 9일(전체 종목·일 23,957건), 연구 신호 5일(매칭 종목·일 882건), 전체 종목 지표 0일**을 확인. 최신 EOD 8일 및 연구 5일의 원장/저장 건수 일치. 미래 청산 결과·역사적 1~2년 연속 자료·지표 활성화는 증명되지 않음.
- 후속 코드의 Turso `GET /api/research/pulse`와 `AI 패턴` 화면은 **최근 감사 완료 연구일 최대 5개**의 기술 신호 출현 순위/빈도만 반환한다. 추가로 이전 감사 연구일 5개가 모두 있을 때만 신호별 빈도 변화율을 표시한다. `최근 5개 연구일`은 연속 5거래일이란 뜻이 아니다. 수익률·익절/손절 정책·시장 승률·매수 추천으로 해석하지 않도록 UI/API에서 분리한다. D1 및 AI 캐시 연결 없이 SELECT만 실행한다.
- **다음 작업:** 결측 연구일·EOD/지표의 사용자 승인 백필 계획, 검증된 후속 일봉으로 5·10일 이후 성숙 성과와 손익 청산을 별도 계산, 최근 패턴 효과와 20·60·120·250·500일 장기 표본의 독립 비교 후 AI 근거 설명/관찰 후보 추가. 실제 배포/원격 쓰기는 별도 승인.

## 2026-11-20 (KST) — AI 패턴 초단기·단기·장기 병행 연구 결정

- 사용자 요구: 장세가 빠르게 바뀌므로 **5·10거래일 조기 변화**를 최우선으로 관찰하고, 20·60일의 지속성 및 120·250·500일의 장기 기준선을 **함께** 비교한다. 일반 AI 시황을 사실로 포장하지 않으며 시장/업종 국면은 검증된 자료가 있을 때만 사용.
- 연구 시점 주의: 최근 5·10일에 **발생한 신호**와 신호 이후 **5·10일 후속 청산 성과가 완료된 표본**은 다르다. 미래 일봉이 모자라면 `PENDING`, 최근 표본이 적으면 추천 보류. 단기·장기 결과가 다르면 국면 변화 후보와 표본/불확실성을 표시한다.
- 다음 코드 단계: Turso 2년 이내 감사 원장·최근 8일 실제 행 수의 **SELECT 전용** 단기/장기 확보율 워크플로(기본 `plan`, 수동 `audit`). PR 병합/Actions 실행 전까지 실제 기간 및 연속성·시장 국면·청산 성과는 미확인. [운영 안내](TURSO_AI_PATTERN_HORIZONS_RUNBOOK.md). 실제 DB 백필·KIS 발급·배포는 이 단계에 포함하지 않는다.

## 2026-11-20 (KST) — AI 시황 대신 최근 패턴과 익절·손절 연구를 우선

- 사용자 확인: 기존의 단순 AI 시황은 실제 시황으로 보기 어렵다. **Turso 모드의 `AI 시황` 탭을 `AI 패턴`으로 바꾸고**, 최근 20/60/120거래일의 패턴 효과·시장 국면·관찰 후보·첫 익절/손절/시간 청산 근거를 핵심으로 삼는다. 독립 검증 지수/업종 데이터 없이는 시장 분위기를 꾸며내지 않는다.
- 코드 1단계: 읽기 전용 Turso 감사 원장 기간 조회 `/api/research/coverage` 및 브라우저 데이터 준비 카드, 순수 오프라인 일봉 첫 도달 익절/손절/최대 보유기간 실험 모듈. **실제 최근 추천, 역사 데이터 백필, 모델 호출/자동매매 없음.** 구 D1 AI 시황은 D1 모드에서만 남긴다.
- 140일 EOD/120일 연구 원장 건수는 연속성/표본·지수/업종 증명 전 준비 여부의 **가장 낮은 기준**일 뿐 추천 승인 조건이 아니다. 과거 1~2년 KRX EOD 감사·백필/이벤트 자료 확보부터 단계화하며, 모든 신규 DB 쓰기는 별도 승인 필요. [상세 기술·검증 계획](TURSO_AI_PATTERN_EXIT_PLAN.md).

## 2026-11-20 (KST) — 전체 종목 지표 보존과 미분석 날짜의 Turso 검색 실행 (코드 준비)

- **저장 구분:** 감사된 KRX `blue_eod_daily_v1`는 전 거래 종목의 OHLCV와 금액을 기록합니다. 기존 `blue_research_signals_v1`는 패턴에 일치한 종목만 보존합니다. 추가 `blue_indicators_daily_v1`는 전체 종목의 일별 이평·BB/ENV·RSI·MACD·Stochastic·거래대금 비율과 미계산 상태를 보존하도록 코드 준비. 현재 기본 OFF, `BLUE_TURSO_RESEARCH_AUTO_ENABLED=true`와 별개 `BLUE_TURSO_ALL_INDICATORS_AUTO_ENABLED=true`를 모두 켜거나 수동 `include_indicators=true`를 선택해야 쓰기를 시도합니다. 원천 일봉의 전체 종목·종가와 정확히 일치하지 않으면 지표를 저장하지 않습니다. **과거 1~2년 일봉 전체 백필과 지표 조회 API/UI는 아직 미구현**입니다.
- **사용자 검색 문제:** Turso 패턴 연구 날짜가 등록되지 않은 날짜를 골라도 기존 PWA는 `NOT_IMPORTED` 문구만 표시하고 분석을 시작하지 않아 무반응처럼 보였습니다. 새 `/api/research/request`는 로그인·동일 Origin 검증을 통과한 지정 날짜 검색 클릭만 기존 `blue_turso_daily_verified_eod_auto.yml`의 수동 `apply`로 전달하고, KRX 원본 검증 → Turso EOD 감사 → R1.1 연구 저장을 한 날짜에 수행합니다. API는 D1 큐를 건드리지 않고 Turso 날짜별 pending 상태를 기록하며, 최대 3개의 미완료 요청·동일 날짜 중복 방지·150분 제한을 둡니다.
- **앱 반응:** 미분석일 검색 시작 시 상단에 요청·진행·실패·완료를 표시하고 15초 상태 조회 및 새로고침 후 재개. 완료 판정은 연구 감사 원장과 실제 행수 검증, 원인 확인은 날짜별 GitHub Actions 결과. 기간 검색은 자동 대량 수집하지 않습니다. 실제 GitHub 실행과 Turso 쓰기는 **병합 후 API·웹 운영 배포 및 사용자 검색 클릭이 있어야** 일어납니다. API Worker의 기존 GitHub 토큰과 Turso 쓰기 권한 확인 필요.
- **운영 영향:** PR 병합과 API/웹 배포, Github Actions 데이터 `apply`, 예약 변수 활성화는 별개. KIS tokenP, D1 시세/신호 기록, Cloudflare Collector, FULL 플래그와 기존 원본 레코드는 변경하지 않습니다.

**후속 화면 개선 (2026-11-20 코드 준비):** 미분석 날짜를 조회하면 상단 멀리 떨어진 상태 안내 대신 검색 결과의 통계 바로 아래에 진행 카드를 표시. `요청 → 일봉 검증 → 전체시장 패턴 → 연구 저장/확인` 단계는 GitHub Actions 실제 job step 성공과 Turso 감사 상태로만 전진하며, 단계를 못 읽으면 정확한 %를 꾸미지 않고 진행 중/확인 중으로 표시. 요청 경과 시간, 15초 상태 확인, GitHub 실행 링크, 실패 시 오류/재시도 안내, 완료 후 기존 자동 결과 검색을 포함. API의 Turso 전용 상태 조회가 GitHub job summary 한 번을 추가로 읽지만 DB 쓰기와 D1 조회는 추가하지 않음. API/PWA 운영 반영은 별도 배포가 있어야 합니다.

**사용자 승인 후 다음 개발 우선순위 — Turso 패턴 근거 기반 AI 후보 분석:** 기존 `AiWidget`의 `/api/ai/market`·`/api/ai/stock` 및 `SmartBasket` AI 후보는 D1 기반 입력/캐시가 남아 있으므로 전체시장 Turso 연구자료와 독립 연결되지 않았다. 진행 카드 PR 이후 별도 PR에서 (1) Turso 감사 완료 EOD·신호·전체 종목 기술지표(opt-in 저장 상태를 명시하고, 비어 있으면 미계산 처리)로 과거/최신 후보를 구성 (2) 패턴 발생일 **당시 알 수 있던 정보만** 사용해 5/10/20거래일 후속 실현 수익률·표본 수·평균/중앙값·최대 손실·같은 종목 기준선·시점 분리 검증을 산출 (3) 종목별 다중 신호·추세·거래대금·매물대 근거의 관찰 후보 순위를 만들되 소표본·미완성 일봉을 명시 (4) AI는 숫자와 출처를 꾸미지 않고 근거/상승·하락 양쪽 시나리오·무효화 조건을 설명하며 검색·AI 시황·장바구니가 같은 감사된 날짜 스냅샷을 사용하도록 통합한다. 매일 자동 갱신은 연구 집계/조회와 AI 호출 비용·실패 폴백을 분리해 단계적으로 활성화한다. 현 PR에서 AI 추천 실구현/자동 매매/운영 AI 호출은 하지 않는다.

## 2026-11-19 (KST) — KIS 잠정 일봉 우선, 분봉은 정밀분석 시점에 요청

- **사용자 결정:** KRX 확정 일봉이 아직 만들어지지 않은 장중에는 KIS가 제공하는 **미완성 OHLCV를 `잠정`으로 확보**한다. KRX 확정·감사 EOD를 대체하거나 과거 확정 신호에 섞지 않는다. 5/10/30분봉은 **지금 상시 저장하지 않고**, 후속 단계에서 정밀분석 시 종목별 KIS 조회·집계하는 방식으로 보류한다. 분봉 선택기·API·PWA 화면은 아직 구현하지 않았다.
- 코드 준비: `collector/src/turso-provisional.mjs`는 최신 감사 완료 전 거래일의 Turso EOD 목록을 검증하고, KRX 정규장 09:00~15:20 KST에 매분 **최대 10종목**을 순환 조회하여 KIS 잠정 관측을 Turso 기존 최신/이력 + 별도 `blue_kis_provisional_daily_v1`에 저장한다. 대략 2,700종목이면 첫 순환에 약 4.5시간이 걸리며, 이는 각 종목 실시간 갱신이나 누락 없는 수집을 보장하지 않는다. 공급자 거래일 필드가 없으면 현지 정규장 관측 날짜 추정으로 명시하고 `is_confirmed_daily=false`로 유지한다.
- 독립된 `TURSO_PROVISIONAL_QUOTES_ENABLED`(FULL), `TURSO_PROVISIONAL_PILOT_UNTIL_UTC`(15/30분 만료), `TURSO_PROVISIONAL_PAUSED`(긴급 정지)는 모두 기본 OFF. 기존 Turso 연구 후보 수집과 동시에 호출하지 않으며 KIS 토큰은 Turso **기존 유효 금고만** 조회하고 직접 발급/D1 참조하지 않는다. 실제 Worker 배포·플래그 활성화·KIS 요청·DB 기록은 본 코드 작업에서 실행하지 않는다. `blue_turso_provisional_pilot.yml`은 기본 `dry_run`이며, 배포 후 별도 승인 실행이 필요하다. 운영 D1 레거시 수집은 그대로 남는다.
- 현재 화면의 기술 패턴 검색은 **감사 완료 확정 연구 신호 전용**이다. 잠정 일봉을 기반으로 전체 시장 기술 패턴을 재계산/검색하는 기능은 아직 없다. 저장된 KIS 최신 관측은 기존 Turso 비교 API 경로를 재사용할 수 있으나, 사용자 화면에 실제 노출되는지는 배포 후 추가 검증한다.

**2026-11-19 사용자 수정 요청 — 장외 KIS 백업 시세는 밤 10시까지:** 기존 15:20 하드컷은 불충분했다. 09:00~15:20에는 KIS 현재가를 잠정 수집하고, **15:20~22:00 KST에는 해당 날짜 감사 완료 KRX EOD가 없거나 불완전할 때만** KIS 일자별 API에서 정확히 그 거래일의 OHLCV를 받아 잠정 저장하도록 코드 보완한다. 21~22시에도 수집 가능하되 저장시각과 실제 영업일을 분리 검증하고, 전일 데이터/날짜 없음/휴장일은 거부한다. 확정 KRX EOD가 이미 정상 적재되었으면 중복 KIS 호출을 하지 않는다. KRX 확정 EOD, 기술 신호/연구 결과, 토큰 발급, D1은 수정하지 않는다. **이 변경은 별도 Collector/API 배포 및 파일럿 성공 전까지 운영 활성화로 간주하지 않는다.**

## 2026-11-19 (KST) — Turso 주 DB 재확인 / D1 종속 전체 미러 기본 OFF

**추가 확인과 다음 개발:** [읽기 전용 감사 #44500952883](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44500952883)의 `turso_recent`은 Turso 최근 8개 EOD 일자 수가 모두 감사 원장과 일치, 2026-11-18 연구 신호 **189/189건** 일치, 2026-11-19 KIS 저장 시세 **2종목**을 확인. Turso SQL 3회·D1 SQL 0회. D1와 과거 전체 동등성 및 전 앱 D1 독립 완료는 아님. 기존 기술 패턴 검색·차트는 Turso 조회 경로가 있으므로 다음 우선 개발은 **검증 완료 연구 날짜를 일별로 누적**하는 수동 기본 `dry_run`/명시적 `apply` 워크플로; 예약 자동 적재는 운영 변수로 별도 승인할 때까지 OFF. [운영 절차](TURSO_DAILY_RESEARCH_RUNBOOK.md).

- **확정 방향:** 새 검증 주가와 연구자료의 주 저장소는 Turso, D1은 과거 원본 보존 및 쿼터가 허용하는 보조 저장. 과거 D1 후보·장바구니 큐·분석 기록에 의존한 수집기 출력을 Turso에 복제하는 구형 전체 미러는 D1 무료 한도 장애를 해결하지 못하므로 `TURSO_MIRROR_ENABLED=false`를 새 Collector **배포 후보**에 반영. 기존 토큰 금고 이중 저장·발급 원장은 유지. PR 병합만으로 이미 배포된 Worker의 변수/Secrets가 바뀌지는 않음.
- **배포 위험 차단:** 기존 운영 Collector가 전체 미러를 실제 사용 중인지 아직 확인되지 않았으므로 OFF 구성을 배포해 수집이 끊기는 일을 막아야 함. `blue_r142_collector_deploy.yml`의 `deploy=true`에 `confirm_mirror_off=blue-turso-mirror-off` 수동 확인을 추가하고, 독립 Turso 수집·시세 재조회가 실증되기 전에는 사용하지 않음. 기존 FULL 모드 확인 문자열도 그대로 유지.
- D1에 여전히 의존하는 중요 기능은 **과거 `runs/signals/chart_snapshots/daily_counts`**, 서버 장바구니 watch, 일부 종목 추적·우선순위, AI 캐시 및 작업 상태. 모든 테이블을 Turso에 이미 옮겼다고 판단하지 않음. 이력 삭제 및 D1 바인딩 제거 금지. 상세 목록·근거 코드·전환 우선순위는 [TURSO_PRIMARY_DEPENDENCY_INVENTORY.md](TURSO_PRIMARY_DEPENDENCY_INVENTORY.md).
- 새 수동 [Turso Primary Readiness](../.github/workflows/blue_turso_primary_readiness.yml) 기본 `plan`은 DB 접근 0회, `turso_recent`은 최대 8개 감사 EOD/연구 날짜·3개 최근 KIS 날짜 집계만 Turso SELECT. 운영 D1 SQL은 수행하지 않고 KIS tokenP/실거래 호출도 없음. 실제 Turso 행 수·날짜는 Actions를 별도로 수동 실행하기 전까지 미검증.

## 2026-11-19 (KST) — 운영 토큰 복구·제한 시세 미러 성공, 정식 미러 배포는 별도 승인

- 조기 감사 [#44465868952](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44465868952) 통과 및 사용자 외부 발급 부재 확인 후 [KIS 공유 발급 #44469823869](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44469823869) `TOKEN_SAVED_DUAL` 달성. 동일 KIS 접근토큰이 Turso·D1에 저장됨(만료 2026-11-20 15:07:25 KST). 기존 D1 발급 중단은 계속 유지, 재발급 반복 금지.
- [D1 시세 감사 #44471939334](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44471939334)에서 토큰 갱신 이후 D1 수집 17건 확인. [Turso 제한 파일럿 #44472224119](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44472224119) 이후 [Turso 상태 #44475510723](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44475510723)에서 2종목·이력 6건 수신 확인. **정확한 동일행 비교·전량 복제·앱 최신시세 표시 완료는 아직 아님.**
- 다음 코드 PR은 Python 기존 KIS vault의 Node unpadded Base64URL 호환 오류([R1.4.1 실패 #44474905492](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44474905492))를 수정하고, D1 최대 6개 정확한 이력 키만 수동 조회하는 정합성 감사/전체 미러 수동 배포 확인 문자열/긴급 정지 Secret을 추가한다. `TURSO_MIRROR_ENABLED=true`는 **코드에 준비하지만 GitHub PR 병합만으로 운영 Worker가 변경되지 않으며** 감사 후 별도 수동 배포가 필요하다. D1 수집 코드·KIS 발급 기능/토큰은 건드리지 않는다.
- 사용자는 Turso 주 DB/D1 보조 DB의 **동일한 검증 시세**를 원한다. 현 단계 미러는 D1 후보·우선순위·관심 목록을 읽어서 얻은 관측을 D1과 Turso에 쓰는 best-effort 구조다. D1 무료 한도로 후보 조회 자체가 차단되면 미러만으로는 해결되지 않으며, 이전에 준비한 별도 Turso 연구 후보 기반 독립 수집과 누락 복구/원장 재처리를 검증한 뒤 다음 전환을 진행한다.

## 2026-11-19 (KST) — KIS 최신 시세 조기 복구 예외 준비 (발급 미실행)

- **사용자 요청:** 현재 KIS 토큰이 만료돼 최신 시세 수집이 중단된 상태이므로 내일 24시간 중단 대기 완료 전의 안전한 조기 복구 가능성을 우선 검토. 확인된 D1 마지막 `TOKEN_SAVED`는 2026-11-17 16:20 KST, 만료 11/18 16:20 KST. [읽기 전용 감사 #44444330961](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44444330961)에서 D1 자동 발급 중단 기록 2026-11-19 11:23:04 KST, 최근 발급 시도/성공은 중단 이전, 현재 일반 보호 상태 `WAIT_24H_SINCE_D1_PAUSED`. 이 기록은 감사 이후 또는 외부 수동 tokenP 발급 부재까지 증명하지는 않음.
- **기본 보수 정책 유지:** D1 issuer 중단 후 24시간까지는 `WAIT...`가 기본. 조기 경로는 `BLUE_KIS_EARLY_CUTOVER_APPROVED=true` **운영자 직접 승인**, 별도 `workflow_dispatch`와 정확한 수동 확인 문자열, D1 **실시간 발급 원장/금고 메타데이터 재검증**이 모두 있을 때만 허용. 마지막 발급 시도·성공·저장 전부 24시간 이상 전, 기존 시도가 `SAVED`로 완료, D1 pause 이후 추가 활동 없음이 증명돼야 함. D1 오류/이력 없음/최근 실패 시도/외부 발급 불확실은 발급 금지.
- Python 읽기 전용 cutover 감사는 `EARLY_READY_FOR_MANUAL_REVIEW`와 `early_cutover_ready=true`를 일반 `READY_FOR_MANUAL_REVIEW`와 분리. Turso 단일 issuer는 D1 백업 감사 전까지 `tokenP`에 도달하지 않으며, 예약 실행에는 조기 예외가 활성화되지 않음. 동작·검증 절차는 `docs/TURSO_DIRECT_KIS_CUTOVER.md`. **이번 PR 자체로 토큰 발급, 운영 변수 변경, 원격 DB 쓰기, Collector 배포는 전혀 하지 않음.**

## 2026-11-19 (KST) — 동일 KIS 접근토큰의 Turso + D1 이중 보관 준비

- **사용자 결정:** KIS 토큰 발급기는 단 한 곳으로 제한하고, **동일한 발급 결과를 Turso 주 금고와 D1 보조 금고에 각각 암호화 저장**한다. 주가 데이터는 별도 합의대로 Turso 주 DB / D1 보조 DB에 동일 검증 관측을 기록하고 누락 재처리·정합성 감사를 구축한다. 토큰 이중화와 주가 이중 쓰기는 서로 별도 구현 단계다.
- Turso issuer `tools/turso/kis-token-steward.mjs`가 기존 D1 AES-GCM 복호화와 호환되는 토큰을 **한 번만 발급**하고 `tools/turso/d1-token-backup.mjs`로 D1 기존 암호화 금고에 복제·복호화 재검증하도록 코드 준비. Turso 저장 성공 후 D1 장애가 발생해도 `D1_SYNC_PENDING` 상태로 **토큰을 재발급하지 않고 재동기화**한다. Turso 기록이 비어 있으면 발급 전 D1에 이미 유효한 토큰이 있는지 확인하고 복원하여 중복 발급을 막는다.
- Collector Turso 독립 경로는 **토큰 금고**가 누락/일시 오류/만료됐고 수동 Worker 플래그 `BLUE_KIS_DUAL_VAULT_ENABLED=true`일 때만 D1 보조 금고의 유효 토큰으로 폴백한다. 금고 손상·복호화 실패는 폴백하지 않는다. Turso 전체 장애 시 Turso 후보 조회/시세 쓰기도 중단되므로 D1 백업 토큰만으로 Turso 수집기가 운영된다고 주장하지 않는다.
- GitHub 변수 `BLUE_KIS_DUAL_VAULT_ENABLED=true`는 **읽기 전용 cutover 감사·최소 24시간 대기·운영자 승인 이후**에만 활성화. `check`는 기존처럼 읽기 전용, `sync`는 신규 tokenP 호출 없이 Turso→D1 복제, `issue`는 보호 조건 하에서만 갱신. 기존 D1 발급기 중단 변수 `BLUE_KIS_TOKEN_AUTO_PAUSED=true` 유지. 이 코드 PR 자체로 **KIS 발급/원격 DB 쓰기/Worker 배포가 일어나지 않는다.**
- **남는 고가용성 공백:** Turso 전체 장애가 토큰 만료 시각까지 지속되는 경우, 현재 발급 CLI는 Turso를 원장으로 사용하므로 D1 독립 재발급은 아직 불가. 별도 단일 발급 원장/잠금·긴급 재발급 절차가 검증되기 전 자동 재발급을 허용하지 않는다. D1 Free 한도 차단 시 D1 백업 조회·기록도 실패할 수 있다. 자세한 절차: `docs/TURSO_DIRECT_KIS_CUTOVER.md`.


## 2026-11-19 (KST) — D1→Turso KIS 발급 전환 읽기 전용 감사 준비

- 마지막 Actions `TOKEN_SAVED` [#44037861051](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44037861051): 2026-11-17 16:20 KST, 만료 11/18 16:20 KST. 최신 D1 `check` [#44438538538](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44438538538)에서 만료 확인. 이것만으로 자동 발급기가 **중단됐다**고 판단하지 않음.
- 새 수동 `BLUE KIS D1-to-Turso Cutover Audit (READ ONLY)`: 현재 GitHub `BLUE_KIS_TOKEN_AUTO_PAUSED`, `BLUE_KIS_D1_DISABLED_AT_UTC`, `BLUE_KIS_TURSO_CUTOVER_APPROVED` 및 D1 발급 원장/금고의 **시간·고정 상태만** 조회. 토큰 발급/복호화/시세 수집/DB 쓰기는 없으며, D1 조회 불가·이력 부재·시각 오류·중단 시각 이후 활동·24시간 미경과 시 준비 완료로 표시하지 않음. `READY_FOR_MANUAL_REVIEW`도 외부 수동 발급까지 증명하지 못하므로 최종 승인 전 사용자가 운영 상태를 확인해야 함.
- 기존 D1 자동 중단 변수는 예약 워크플로에만 걸려 있었으므로, **수동 `mode=issue`에도 동일 중단 플래그를 적용**하도록 보강. Turso 발급 보호는 이전처럼 기존 D1 발급 중단 **후 24시간**이 확인되기 전 `issue` 금지. GitHub Secrets 장기 앱 키는 그대로 유지.

## 2026-11-19 (KST) — KIS 토큰 06:00 점검·복구 정책 추가 (PR 준비)

- 매일 **06:00/06:30 KST**에 KIS 토큰 상태를 검사하고, 평일 07:00~19:30에는 30분마다 후속 점검. GitHub 예약 실행은 실제 시작 시간이 지연될 수 있으며, 06:00에 *무조건 새 토큰을 발급*하는 것이 아니라 1시간 이내 만료 예정·만료·미발급 상태에서 24시간 저장 쿨다운 및 원자적 예약 조건을 지켜 발급.
- GitHub Actions 예약 작업이 의도한 시각보다 크게 지연되어 실제 KST 시각 제한을 통과하지 못하면 발급 점검이 통째로 생략될 수 있으므로, D1 예약 스크립트에서는 이중 시간대 차단을 제거합니다. 실제 실행이 지연되더라도 토큰 점검은 수행하고 발급 여부는 24시간/KST-day 상태표가 결정합니다. [과거 예약 실행 #44345601488](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44345601488)에서 01:18 KST `OUTSIDE_SCHEDULED_KST_WINDOW`로 스킵된 기록이 있습니다.
- 발급 요청 자체가 실패했다면 동일 KST 날짜에 **최초 실패 후 최소 30분 경과·단 한 번** 재시도할 수 있도록 완화. 두 번째 실패는 다음 정상 발급 가능 기간까지 재시도 차단. 저장 실패나 메타데이터 오류는 재발급 근거로 사용하지 않음.
- 기존 D1 토큰 매니저는 기존 D1 암호화 금고·발급 상태표를 유지. Turso 매니저는 별개 금고·상태표를 유지하고 `BLUE_KIS_TOKEN_AUTO_PAUSED=true` + 실제 D1 중단 시각 24시간 경과 + `BLUE_KIS_TURSO_CUTOVER_APPROVED=true`일 때만 발급 허용. **이번 코드 PR 자체로 운영 token cutover/신규 발급/Collector 활성화는 일어나지 않음.**
- [Turso check Actions #44434674813](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44434674813) `TOKEN_MISSING_OR_EXPIRED`은 Turso 토큰 없음/만료 여부를 분리하지 못한 기존 진단. 새 코드에서 `TOKEN_MISSING`, `TOKEN_EXPIRED`, `TOKEN_EXPIRES_SOON`으로 구분.

## 2026-11-19 (KST) — D1 독립 KIS→Turso 장중 시세 수집 파일럿 준비

- [PR #30](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/pull/30) 병합 확인. Turso 일봉 예약 적재는 18:35 KST 기준이며 실제 당일 수집 성공 여부는 별도 Actions 로그 확인이 필요.
- 신규 `collector/src/turso-direct.mjs`: D1 의존 없이 Turso 감사 완료 최신 연구 신호 종목을 5분 틱마다 최대 12개씩 순환 선택, 기존 KIS REST 응답 검증 후 Turso 최신시세/이력 테이블에 저장. 기존 레거시 D1 Cron과 독립된 `waitUntil`. 기본 비활성, 시간제한 파일럿으로만 테스트.
- 신규 `tools/turso/kis-token-steward.mjs`: Turso에 암호화된 KIS 토큰 보관 및 24시간·한국 날짜별 발급 시도 제한. **기존 D1 토큰 발급을 최소 24시간 중단했다는 운영 확인이 있어야 발급** 가능. 서로 독립된 토큰 발급 관리자 동시 실행 금지. GitHub 변수 `BLUE_KIS_TOKEN_AUTO_PAUSED`, `BLUE_KIS_D1_DISABLED_AT_UTC`, `BLUE_KIS_TURSO_CUTOVER_APPROVED` 보호 조건.
- 사용 안내: `docs/TURSO_DIRECT_KIS_CUTOVER.md`. 테스트는 CI 워크플로 및 별도 파일럿으로 검증 예정; 아직 실제 KIS 운용이나 D1 독립 5분 실시간 가격 확보가 입증된 것은 아님.
- 189개 종목을 12개/5분으로 순환하면 각 종목의 갱신 간격은 약 80분이며, **전체 종목 5분 실시간 갱신이 아님**. 관심 종목 우선수집은 이후 단계.

## 목표와 우선순위

- 국내 주식 전체 시장 검색, KIS 기반 시세 수집, 기술 신호, 과거 패턴 검증, 매물대 분석, 장바구니·종목 추적을 안정적으로 제공합니다.
- **정확한 최신 데이터의 지속적인 수집**이 최우선입니다. 초단타/실시간 매매 시스템이 아니므로 대략 1분 전 데이터도 허용하며, 빠르지만 누락되거나 오래된 가격을 최신으로 오인하는 상황은 피합니다.
- 비용, 데이터 용량, 장애 복구를 함께 고려합니다. 갑작스러운 유료 전환이나 운영 DB 교체를 피합니다.

## 현재 주요 구성

**2026-11-19 패턴 검색 최근시세 표시 수정 PR (병합/배포 전):** PR #28을 사용자 병합, API·웹 Actions 성공 배포 후 사용자가 Turso 패턴 결과/차트가 정상이라고 확인. 다만 검색 결과의 `최근 확인가`는 `web/src/main.tsx`에 남은 D1 전용 `/api/prices/compare` 호출 때문에 조회되지 않았음. 이번 수정은 선택한 패턴 검색 소스에 따라 Turso 감사 EOD·검증된 저장 KIS 스냅샷 또는 D1 전용 비교를 연결하고, Turso 종목 버튼은 새 수집 요청 없이 저장 시세만 재조회하도록 함. **검색일 이후 날짜의 검증된 관측이 아직 없으면 최근 확인가가 비는 것이 정상**이며, 검색일 종가를 현재가로 표시하지 않음. Turso 장중 최신 시세 자동 수집·D1 완전 장애 독립화·전 기간 최고가 완전성은 별도 단계.

**2026-11-19 Turso 패턴 검색 읽기 전환 PR (배포/사용자 검증 완료):** [Actions #44351153148](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44351153148)에서 2026-11-18 연구 신호·차트 **189개**의 Turso 감사 완료 저장 증빙 확인. `worker/src/turso-research.ts`가 같은 날짜별 감사 및 신호/차트 기록을 직접 조회하도록 `/api/research/dates`, `/api/research/search`, `/api/research/chart`를 제공. 기존 분석 신호/GC/추세·거래대금/과거 패턴 조건과 정렬을 지원하되 Turso의 원천 224일 이력을 재계산하지 않고 저장된 원래 R1.1 연구 스냅샷을 사용. PWA `기술 패턴 찾기`는 Turso를 우선 시도하고 5xx 오류 및 수동 선택 시 D1 `/api/search`로 전환. 차트도 선택된 연구 소스의 정확한 기준일 기록을 조회합니다. **해당 날짜 189건만 수집된 상태**이며 과거 전체 이관, 후속 최고가 완전성, 모든 탭 D1 독립성은 아직 없습니다. [PR #28](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/pull/28) 병합, API 검증/배포, 웹 배포까지 성공했고 사용자 패턴·차트 표시 확인. D1 데이터 변경 없음.

**2026-11-19 D1 장애 대비 동일 데이터 이중화 재확인:** 사용자가 [검색 화면 PR #26](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/pull/26)을 **이미 병합**했습니다. 다만 기존 D1 분석 결과를 다시 표시하는 것은 장애에 독립적인 검색 복구가 아니므로 **최종 전환 완료로 간주하지 않습니다.** 최종 목표는 검증된 EOD 원본과 분석 결과를 *동일한 산출물 기준*으로 Turso 주 DB와 D1 보조 DB에 저장, 누락·충돌·지연을 감사하고 D1 장애 중에도 Turso에서 검색·사용 가능한 것입니다. 두 DB의 모든 테이블·이력이 이미 같다는 뜻은 아닙니다.

**첫 단계 — 일봉 연구 신호/차트 증거의 Turso 독립 저장 (코드 PR 준비):** 기존 `market_scan_r11.py`의 `signals.csv`·`chart_snapshots.jsonl`·`AUDIT.json`를 D1 SQL 생성과 **동일한** 패턴 하이라이트 계산 규칙으로 `scripts/export_turso_signal_snapshot.py`에서 읽어, 정확한 날짜/종목/원천 해시를 가진 연구 결과 스냅샷으로 출력합니다. `.github/workflows/blue_market_scan_research_only.yml`에 `turso_signals_mode=off|dry_run|apply` 선택값을 추가하고, `tools/turso/signal-snapshot-import.mjs`가 **Turso의 감사 완료 KRX EOD 일자·신호 종목 종가와 먼저 대조**한 뒤 별도 `blue_research_signals_v1` 및 `blue_research_signal_audit_v1`에 충돌 거부·재실행 안전 저장/재조회를 수행합니다. 기본값 `off`, `dry_run`은 원격 DB 접속 없음, `apply`만 명시적 Turso 쓰기. 스캐너 산출물 그대로 전달하는 첫 데이터 계열에 한정되며, **D1에 이미 존재하는 모든 과거 runs·signals·chart_snapshots의 복제, 실시간 자동 이중 저장, D1 실패 후 자동 재처리/앱 검색 폴백은 아직 구현하지 않았습니다.** 이 기능은 기존 D1·원본 Turso EOD 행·장바구니를 수정하지 않습니다.

**2026-11-19 검색 화면 우선순위 복구 (웹 PR 준비):** Turso 확정 일봉 8거래일만으로는 BLUE20/30/40의 이동·시차 밴드, ENV20/40 중심선, RSI/Slow Stoch/MACD, 112/224일선 및 과거 승률을 신뢰성 있게 새로 계산할 수 없습니다. 따라서 PWA `검색`의 **기본 화면을 기존 D1 기반 기술 패턴 검색**(기존 서버 검색·필터·분석 요청 유지)으로 되돌리고, `확정 일봉 전체` 버튼에서 검증된 Turso 원본 종목 목록을 별도로 보여줍니다. D1 데이터가 오래됐거나 무료 행수 한도에 막히면 패턴 검색은 제한/실패할 수 있으며 이를 별도로 표시합니다. Turso EOD 조회 및 장바구니 우선 가격 읽기, 기존 D1·Turso 스키마·운영 DB는 변경하지 않습니다. 기술 패턴을 Turso에서 직접 검색하려면 장기 가격 이력(특히 224일선 및 시차 밴드)을 검증해서 채우거나 신호 연구 스캐너의 결과를 정확한 날짜·원천 감사와 함께 이관하는 후속 단계가 필요합니다. KIS 장중 15분 파일럿은 장이 열릴 때까지 보류합니다.

**2026-11-18 Turso 일봉 수집 확정:** [GitHub Actions #44310029226](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44310029226)에서 11월 9~18일 중 8거래일 총 **21,296개 KRX 검증 일봉**이 Turso `blue_eod_daily_v1`에 저장되고, 날짜별 read-back 및 감사 테이블 검증에 성공. 단 112·224일선, 신호, 매물대·과거 패턴·장바구니 이력은 이 테이블에 포함되지 않음.

**2026-11-18 화면 확인 및 종목명 복구 코드:** Turso 일봉에 가격은 있으나 회사 이름 칸은 비어 있어 종목코드가 중복 표기됨. EOD 감사·가격 행을 재기록하면 검증 해시가 달라질 수 있으므로, 별도 `blue_symbol_directory_v1`에 이름만 `dry_run` 검증 후 **수동 `apply_all`**로 저장하고 `/api/eod/search`에서 코드·시장으로 조인하도록 준비. 미등록이면 빈 이름을 임의 생성하지 않음. 이름은 디렉터리 기준일의 명칭이고 과거 상호 변경 반영을 보장하지 않음. **장바구니는 기존 별도 UI/D1 데이터이며, 이 작업에 포함되지 않고 보존함.** 운영 반영은 GitHub PR 병합 → Turso 이름 적용 → API Worker 수동 배포 → 웹 수동 배포가 모두 필요.

**새 복구 원칙:** 검증된 KRX *일봉 검색*은 Turso를 먼저 조회. Turso 인증·연결·검색 오류 시 기존 **D1 신호 검색 UI**로 전환하고 데이터 영역의 차이를 명시함. 이는 두 DB에 같은 이력이 들어 있다는 뜻이 아니며, D1도 한도 초과면 명확히 이중 장애를 표시. 기존 D1 업무 데이터 및 Worker 바인딩은 보존. 앱의 다른 분석 탭은 여전히 D1 의존이며, 전체 Turso 주 DB 전환은 별도의 후속 단계.

**2026-11-19 장바구니 후속 읽기 준비:** 기존 기기 로컬 장바구니 발견일/기준가/메모를 보존하면서 `Turso 확정 일봉`의 **발견일 후속 거래일** 가격/고가만 읽어 수익률을 표시하도록 단계적 확장. 새 `/api/eod/prices/compare`는 Access 인증 + 검증 감사 날짜 + 최대 24개 날짜/코드 쌍 + SELECT 전용이며, Turso 장애 시 기존 D1 `/api/prices/compare`만 보조 사용. 수집된 8거래일 범위 밖의 고가 완전성은 주장하지 않음. 이는 **장바구니 가격 읽기 하나**의 전환이고, D1의 Watch 등록·KIS 시세 수집/다른 분석 및 AI 기능이 Turso로 이동한 것은 아님. PR 병합 후 API·웹 수동 배포 필요.

**2026-11-19 추가 개발 — KIS 검증 시세 Turso 기록/읽기 (PR 준비):** 수집기 5분 주기에는 장바구니 수집과 기존 후보 수집이 **검증한 시세**를 키별로 합쳐, D1 저장 성공 여부에 앞서 별도 옵트인 Turso 저장 대상으로 큐잉한다. 파일럿 자동 만료 및 회당 최대 2종목/기본 `TURSO_MIRROR_ENABLED=false`는 유지한다. 이미 존재하는 Turso `blue_kis_live_quotes_r141` 테이블에서 별도로 검증된 시각/거래일의 **저장된 KIS 스냅샷**을 장바구니 가격 비교 응답에 합치되, 동일 거래일에는 감사 완료 KRX 확정 종가·고가를 우선하고 KIS는 더 **나중 거래일**에만 최신가로 선택한다. 원래 발견일 기록/로컬 키/D1 테이블을 변경하지 않는다. **여전히 D1의 등록 목록·후보·토큰 금고·락에 의존**하므로 D1 전체 장애 시 수집이 보장되거나 Turso 주 DB로 완전히 전환된 것은 아니다. 실제 자동 저장은 별도 Collector 재배포 및 장중 제한 파일럿을 실행·감사해야 한다.

| 구성 | 저장소 경로 | 내용 |
| --- | --- | --- |
| API Worker | `worker/` | Cloudflare Workers API, D1 `DB` 바인딩 및 KIS 수집기 서비스 바인딩 |
| 주가 수집기 | `collector/` | Cloudflare Worker, KIS 수집·관찰 로직, D1 `DB` 바인딩 |
| 모바일/PWA | `web/` | 시세 검색·종목 추적·장바구니 UI |
| Actions | `.github/workflows/` | 배포, DB 관리, 진단 및 연구용 작업(실행 조건이 제각각임) |
| 운영 DB | Cloudflare D1 | `blue-signal-lab-db` |

## 현재 문제와 근거

**2026-11-19 추가 운영/UX 설계:** 메인 `종목 검색`은 Turso 감사 완료 기술 연구 결과를 사용하며 검색 조건을 그대로 유지한다. `전체 종목 보기`는 검증된 KRX 일봉을 기술 신호 계산 없이 나열하는 보조 화면이므로 구별하되, 메인에 큰 두 버튼과 긴 설명 배너를 표시하지 않는다. 출처·D1 보조 검색의 한계는 펼침 안내에 보존한다. 장중 사용자가 명시적으로 누르는 종목별 `KIS 최신가 조회`는 기존 KIS 인증 토큰을 **Turso 암호화 금고에서만** 꺼내고 Turso 일봉·시세만 조회/저장하는 별도 수동 경로로 준비 중이다. `Origin`/Access, per-code 20초/전체 12회 매분 제한, 기본 OFF 플래그가 선행한다. 해당 경로는 **D1 무료 쿼터와 독립**이나, Turso 자체 장애 시 신규 저장 불가·토큰 만료 시 발급 관리자 정책에 의존한다. KIS REST는 사용자 요청 시의 스냅샷이며 거래소 체결 스트림이 아니다. 현재 운영 full-mirror 배포 승인과 수동 배포/flag 활성화/실시세 감사 모두 **별도 단계**다. D1 읽기만을 회피하는 이 수동 경로가 시세의 D1 완전 복제나 앱 전체의 Turso 전환을 달성하는 것은 아니다.

- 2026-11-18에 D1 Free **읽은 행 하루 5,000,000행** 한도 초과 알림을 받았으며, 리셋 전 DB 읽기 요청이 실패했습니다. 기존 저장 데이터 삭제를 의미하지는 않습니다.
- GraphQL Analytics 리포트(2026-11-18 07:56 UTC 실행, 샘플링 추정치): UTC 2026-11-18 진행 중 5,104,591행, 직전 6일 합계 6,050,725행. UTC 00:00은 KST 오전 09:00입니다. 샘플링 집계와 실제 청구/한도 수치를 혼동하지 않습니다.
- 반복 조회 후보: `chart_snapshots`, `blue_kis_first_seen_r154`, `blue_search_quote_priority_r1594`, `sqlite_master`, `blue_kis_live_quotes_r141`. **원인 확정/인덱스 효과는 코드 및 추가 측정으로 검증해야 합니다.**
- D1 인덱스 최적화, 불필요한 중복 조회/쓰기 제거를 우선하고, DB 분리/이관은 데이터를 보존하면서 검증합니다.

## DB 방향 — 확정된 사용자 결정

1. D1을 당장 버리지 않고 **Turso를 병행 연결**합니다. **2026-11-18 사용자 추가 결정:** 최종 목표는 **Turso 주 DB / D1 보조 DB**, 가능한 범위에서 **동일한 검증된 업무 데이터**를 유지합니다. 현재는 전환 전 단계이며, Turso에 유효 데이터가 저장·검증되기 전까지 D1 원본을 유지합니다.
   - 최종 쓰기 경로: KRX/KIS 한 번 수집·검증 → Turso 기록 및 동기화 이벤트 → D1에 멱등 복제. 이력/누락 재처리와 행 수·키·값 일치 검증을 필수로 합니다. 두 독립 DB의 동시 트랜잭션은 보장되지 않으므로 복제 지연을 표시합니다.
   - 최종 읽기 경로: Turso 우선, 장애 시 **마지막 검증된 D1 시점과 데이터 날짜를 명시**하는 읽기 전용 폴백. Turso 장애 중 D1에 독립 쓰기를 허용해 충돌시키지 않습니다.
   - `runs`, `signals`, `chart_snapshots`, 일봉·시세·장바구니·분석·종목목록은 업무 데이터 복제 후보입니다. Lock, 캐시, KIS 암호화 토큰·비밀값, Worker 런타임 상태는 각 시스템 책임 하에 분리합니다.
   - **무료 용량 제약:** D1 무료는 단일 DB 최대 **500MB**(계정 합계 5GB), Turso 무료는 총 5GB 수준이므로 모든 과거 대용량 데이터를 D1에 영구히 완전 복제할 수 있다고 가정하지 않습니다. 용량에 앞서 별도 아카이브/유료 전환 여부를 검토해야 합니다.
2. 2026-11-18에 Turso **libSQL** DB에 대한 비파괴 연결 검사가 성공했습니다([Actions #44276186275](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44276186275)). Turso 스키마 생성([#44278060936](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44278060936)), Cloudflare Collector Worker에 Turso Secrets 설치([#44279139920](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44279139920)), Collector 실배포([#44279762372](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44279762372))도 성공했지만 **복제 기본값은 OFF**입니다.
3. 제한된 병행 저장을 위한 수동 파일럿은 **15분/30분 자동 만료 + 5분 수집당 최대 2종목**으로 설계합니다. 실제 적용은 파일럿 코드 병합·재배포 후 수동 Actions 실행이 필요합니다. 이후 복구·재처리·건수/시각/값 일치 검증 → 제한된 읽기 전환 순서입니다. **복구 기능 검증 전 Turso 데이터를 완전한 보관본으로 취급하지 않습니다.**
4. 장기 원시 데이터/대용량 아카이브는 Google 등 별도 스토리지도 검토 중이나, **선정·배포 완료 상태가 아닙니다**. Cloudflare R2를 무료라고 가정하지 않습니다.
5. 주요 이력은 `docs/WORK_LOG.md`와 GitHub PR/Actions에 보존하여 새 채팅에서도 이어갑니다.

### 장외 EOD → Turso 소량 실데이터 검증 (신규 수동 경로)

- 기존 `blue_market_scan_research_only.yml`의 EOD 검증 성공 후 같은 `SYMBOL_DIRECTORY.json`를 사용하는 **Turso 단독 12종목 파일럿**을 추가합니다. 새 입력 `turso_directory_mode` 기본값은 `off`; `dry_run`은 외부 DB 호출이 없고, `apply_12`만 **Turso에 최대 12개 종목명**을 `blue_symbol_directory_v1`에 멱등 기록·키별 재검증합니다. D1 SQL 실행·KIS API 호출·Worker 배포·주/보조 DB 전환은 없습니다. 단, 기존 EOD 스캔은 원천 자료를 내려받으므로 데이터 제공처 준비 상태에 좌우됩니다.
- 이 기능은 기존 5분 수집기를 기다리지 않고 장 마감 이후 **실제 검증된 종목 데이터를 Turso에 저장할 수 있는지** 확인하는 분리된 파일럿입니다. 전체 동일 데이터 복제, 일봉/차트/시그널 복제, 누락 복구, 읽기 전환은 **구현되지 않았습니다**. 기존 EOD 수집/검증 실패를 임의 데이터로 보완하지 않습니다.
- 권장 수동 순서: `asof_date=latest`, `publish_to_d1=false`, `publish_diagnostic_only=false`, `turso_directory_mode=dry_run` → 검증 성공 및 감사 수치 확인 → 별도 사용자 승인으로 `apply_12` 실행 → Turso 결과 12개 검증. `apply_12`를 선택해도 D1은 건드리지 않습니다. `publish_to_d1=true`는 별도의 운영 쓰기 선택입니다.

## 바로 다음 작업

- **Turso 읽기 복구 단계:** `worker/src/turso-eod.ts`, `/api/eod/dates`, `/api/eod/search` 및 PWA의 전용 확정 일봉 화면. 먼저 수동 API Actions `verify_only` 후 `deploy_api`를 명시적으로 선택해 `blue-signal-lab-api-v2`에 Turso URL/토큰 Worker Secrets 두 개를 설치·배포. 이후 기존 웹 안전 배포 Actions를 따로 실행. PR만 병합하면 운영에 자동 적용되지 않음. 다른 탭의 112/224일선·패턴/AI·장바구니는 기존 D1 의존 상태임.

0. **신규 사용자 우선순위(2026-11-18):** 우선 2026-11-09~11-18의 정확한 KRX 일봉 전 종목을 Turso에 채운다. `.github/workflows/blue_turso_verified_eod_range.yml`에서 먼저 `dry_run`으로 8개 평일의 KRX 정확한 날짜·OHLCV·건수·해시를 검증한다. 날짜 하나라도 불확실하면 저장하지 않음. 검증 후 명시적 `apply` 선택으로만 `blue_eod_daily_v1`에 멱등 삽입 및 read-back 완료 기록. **D1/Turso 전체 일치 검사와 주 DB 전환은 이 단계의 선행조건이 아님.** 기존 D1 기능·데이터를 보존한다.
1. Secrets 설치와 Collector 실제 재배포까지 성공했습니다. 단, [Mirror Status #44279543275](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44279543275)의 0행은 복제 OFF 상태에서의 결과로 정상입니다.
2. PR #15 병합·Collector 재배포([#44284567795](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44284567795)) 및 제한 파일럿([#44284901016](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44284901016))은 성공했습니다. 하지만 [Turso Status #44286642943](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44286642943)에서 파일럿 중에도 **0행**입니다. 원인은 아직 미확정이며, 정상 복제 증거가 없습니다.
3. 먼저 **운영 D1을 추가 조회하지 않고** Cloudflare Collector 상태 로그(`BLUE_R142`, `BLUE_TURSO_MIRROR`)로 `후보 없음/토큰 문제/시세 무효/수집 오류/Turso 쓰기 오류`를 구분합니다. [Tail 실행 #44296117467](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44296117467)은 KST **20:36~20:43 거래시간 종료 후** 시행돼 0건이며, 종료 코드 처리의 오탐 실패도 확인돼 개선 중입니다. **다음 거래일 09:00~15:20에 7분 라이브 진단을 다시 실행**해야 원인을 구분할 수 있습니다.
4. D1 대비 데이터 건수·시각·가격을 **소량 검증**하고 장기 누락을 막을 재처리 정책을 구현하기 전에는 운영 데이터의 주 저장소로 전환하지 않습니다.
5. D1 읽기 행 사용량을 UTC 기준 매일 비교하고 쿼리/인덱스 최적화 전후 차이를 관찰합니다.

## 참고

- GitHub: `https://github.com/ehdud6728-bit/BLUE-Signal-Lab`
- 최신 실제 배포 및 실행 결과는 GitHub의 `main` 커밋, PR, Actions와 Cloudflare 대시보드에서 확인합니다.
