# BLUE Signal Lab — 개발·운영 작업 기록

새 채팅에서 프로젝트를 이어가기 위한 **결정/구현/검증 이력**입니다. 대화 전체를 저장하지 않고 실제 개발에 필요한 내용만 보존합니다. 최신 항목을 위에 추가하고, 결과가 달라지면 추측 대신 검증된 상태로 수정합니다.

## 2026-11-21 (KST) — PR #79 병합 후 탐색 성과 보고서 고가·하락 위험 병행 강화 (코드 준비)

- PR #79 `eb6397f` 병합 확인. 웹 골드 테두리는 아직 추천 API 및 별도 검증이 없어 실제 표시 0건 정상; 운영 웹 배포는 별개.
- `scripts/pattern_exit_study.py`의 이미 감사된 D+5/10/20/60 보유 구간 관측에 **최고가 수익 평균·중앙값, 최고가 양수/5% 이상 건수, 최저가 손실 평균·중앙값, -5% 이하 위험 건수와 최악 관측 손실**을 추가. 서로 다른 일봉 고가·저가의 관측 범위이며 거래 체결 가능 최고수익·확정 승률이 아님.
- 출력은 기존 탐색 연구 JSON 내부의 추가 필드만 사용. DB 조회/쓰기, v2 `apply`, 추천 API 게시, KRX/KIS 호출, Worker 배포 없음. 기존 `investment_recommendation_enabled=false` 및 `candidate_stocks=[]` 유지.
- **다음:** PR 안전 테스트/병합 후 수동 read-only `mode=study`로 실제 고저가·성숙 표본 확인. v2 4일 전용 `apply` 및 독립 달력·기업행동·홀드아웃 검증은 별도 승인 전 미실행.

## 2026-11-21 (KST) — 검색 카드 연구 추천 골드·토마토 대각선 강조 (UI 준비 PR)

- **요청/의미 구분:** 사용자는 기술 패턴 연구가 완료돼 실제 추천된 종목은 골드, 기존 탐색적 토마토가 겹치면 좌상단 골드·우하단 토마토를 제안. `AI 패턴 > 빈도변화`는 **패턴 출현율의 변화**이고 높은 승률·상승 강세·매매 추천이 아님을 확인. 기존 토마토도 `10일 관측 상승 비중`이며 검증된 미래 상승 확률은 아니다.
- **구현:** `web/src/research-gold-highlight.ts`는 Turso 패턴 검색의 명시적 감사 v2 추천 증거/검색일/신호 교집합/홀드아웃/하락 위험 검증 없으면 골드를 거부하는 fail-closed 검사. `web/src/main.tsx` 검색 모바일 카드·데스크톱 표에 독립 골드 배지/색상 조건 및 삼색 범례 추가. `web/src/r-research-gold-outline.css`는 기존 토마토 영역/장바구니 버튼을 보존하며 **대각선 이중 테두리** 구현. `tests/test_research_gold_highlight.mjs` 및 Web read-only CI 연계.
- **기준 증거:** [Actions #44906026852](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44906026852) 성공은 v2 읽기 전용 KRX 4일 원본과 2,662/2,663/2,661/2,661종목 재분석(241/198/119/142신호) 증명. **새 v2 DB 저장·성과 연구 검증·실제 추천 승인은 아직 없음.** 현재 API는 `research_recommendation`을 반환하지 않으므로 골드 표시가 없는 것이 맞다.
- **영향/안전:** 프런트 CSS·검색 렌더와 로컬 안전 테스트만 수정. D1·Turso/KIS/Collector/API 실 DB 쓰기·추천 생성·자동 설정·운영 배포 없음. 서버가 나중에 출처 감사·성숙/홀드아웃/하방 위험 검증 결과를 제공하기 전까지 클라이언트의 증거 모양 검사만으로 추천의 신뢰성을 주장하지 않는다.
- **로컬 검증:** 신규 fail-closed/배지·대각선 CSS 테스트 **5/5**, 기존 Turso/장바구니 등 통합 Node 안전 테스트 **88/88 PASS**(신규 5개 포함), 웹 TypeScript/Vite 프로덕션 빌드 및 `git diff --check` 성공. 기존 테스트는 로컬에 이미 설치된 의존성을 재사용했으며 CI는 별도 신규 설치로 검증 예정. 원격 CI·운영 모바일 표현·실제 검증 추천 데이터 표시는 미확인.
- **다음:** UI PR CI→사용자 병합→웹 수동 배포; v2 별도 감사 테이블 `apply` 명시 승인/실행 후 성숙한 5·10·20·60일 연구·독립 검증·하락 위험 평가→서버 추천 API의 증거 검증·게시 별도 PR→실제 골드/토마토 중첩 관측. 새 KRX 수집/구 v1 수정·데이터 덮어쓰기 없음.

## 2026-11-21 (KST) — 연구 50종목 실제 누락 아닌 `KOSDAQ GLOBAL` 필터 오분류 (v2 수정 PR 준비)

- **실행 결과 정정:** [Actions #44903157189](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44903157189) `recover` job은 성공. KRX 역사 요청 미완료 시 기존 KIS 2차로 **36종목×309봉=11,124봉**을 수집·SHA 아티팩트로 보존했으나, 연구 250봉 재확인에서는 여전히 36개 미달로 판정하여 **4개 날짜 R1.1 재분석·Turso 신호 대조는 건너뛰었고 DB 저장 0건**. 성공 배지를 연구 복구 완료로 해석하지 않는다.
- **확인된 근본 원인:** 2025·2026 MARCAP parquet를 기존 감사 SHA(`2bfd93c...`, `699c5d8...`)와 재확인했다. **11/10 원본에는 `KOSDAQ GLOBAL` 50개가 실제 존재**, 그중 36종목은 각각 **2025~2026 원본 458행**을 이미 갖고 있다. 기존 `market_scan.normalise()`는 `'KOSPI','KOSDAQ'`만 허용하므로 코스닥 글로벌 세그먼트 종목의 봉을 누락 처리했다. SHA 검증된 KIS 11,124봉을 기존 MARCAP과 `load_and_merge()`로 대조하면 **추가 0행/가격 충돌 0건**이다. 실제 일봉 부족이나 토큰 오류가 아니라 **시장 구분 오분류**였다. 구 v1의 누락 원인은 현재 원본 기준 재현되지만 당시 parquet의 해시가 없으므로 당시 저장 데이터 실명 구성은 단정하지 않는다.
- **수정:** `research_v2_market_scope.py`를 **v2 수동 복구에만** 사용. 정확한 연도별 MARCAP SHA, 네 날짜, 고정된 `KOSDAQ GLOBAL` 50코드, 독립 KRX EOD에서 50코드 모두 `KOSDAQ`임을 통과한 후 **메모리 연구 사본**의 해당 이력 `Market` 값만 `KOSDAQ`으로 분류한다. OHLCVA·날짜·종목코드·원천 parquet·기존 v1 원장은 절대 수정하지 않는다. Coverage와 R1.1 scanner에서 같은 범위 옵션을 사용하고, v2 proof는 50코드·변환 행 수 및 원본 KRX/소스 해시를 연결하여 누락·변조 시 차단한다.
- **로컬 증빙:** 감사 SHA가 정확히 일치하는 2025·2026 실제 parquet와 원본 MARCAP의 당일 유효가를 **테스트용 EOD 프록시**로 사용한 네 날짜 오프라인 커버리지 확인에서 11/10·13·16·17 전체 정상 집합 크기 **2,662/2,663/2,661/2,661**, 50개 종목의 최소 이력 **440/443/444/445봉**, 각 날짜 상태 `PASS`, 50코드 역사 라벨 치환 합계 **17,241행**. 이는 기존 KRX 원본 Turso의 SHA/실제 신호 검증을 대체하지 않는다. 신규 시장범위·출처거부/연구 출처 테스트 포함 단위 테스트 실행.
- **추가 전체 스캔:** 같은 **MARCAP EOD 프록시**로 11/10의 R1.1 전체 시장 분석을 실제 2프로세스/500종목 청크로 실행하여 **2,662종목 관측, 2,526종목 유효, 241개 신호**로 코드 경로가 종료됐음을 확인. 이 신호 수는 독립 KRX 확정 EOD로 재검증한 공식 v2 결과가 아니므로 연구 DB에 쓰거나 추천으로 발표하지 않는다. Python v2 관련 단위 테스트 **21/21** 통과, GitHub Actions YAML과 컴파일·diff 체크 통과.
- **PR 첫 CI:** [#44905312418](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44905312418)의 새 테스트는 `market_scan_r11`가 참조하는 `requests` 패키지가 테스트 선행 설치 목록에 없어 `ModuleNotFoundError`로 실패했다. 파이썬 기능 자체 실패가 아니므로 동일 PR 워크플로의 **테스트 전 의존성 목록에 `requests`를 추가**했으며, 재실행 성공 여부는 후속 Actions에서 확인한다.
- **다음 수행:** 새 PR CI 통과 및 사용자 병합 후 수동 `BLUE KRX 4-Day R1.1 v2 Replay`의 **`mode=check` 한 번**으로 기존 Turso KRX 확정 일봉 SELECT 및 검증된 MARCAP만 사용해 4일 전체 연구·신호 건수/가격 대조까지 실행. 새 KRX/KIS 시세 호출·KIS 토큰 발급·Turso/D1 INSERT·v1 재저장·AI 추천 게시 없음. 실제 KRX 원본과 4일 스캔 결과는 아직 실행 전이며, v2 쓰기 승격은 별도 명시 승인 후에만 가능.

## 2026-11-21 (KST) — 36종목 표적 과거 일봉 KRX→KIS 2차 복구 및 통합 검증 (PR 준비)

- **실측:** PR #75 병합 커밋 `c814e8d`; [Actions #44899355187](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44899355187) job 완료 후 아티팩트 실물 확인. 4개 일자 동일하게 50종목 중 1봉 30개, 107봉 5개, 244봉 1개, 349봉 1개, 350봉 13개. **36 미달/14 통과**, 4일 패턴 재스캔 및 v2 DB 쓰기는 **0건**. 4일 KRX EOD 원본 SHA 재구성은 성공. 실제 4개 JSON을 새 planner에 입력해 **36코드** 정확하게 산출함.
- **변경:** `research_v2_targeted_history.py`(36코드·기존 봉 수·4개 KRX 및 2개 MARCAP 해시 고정, KRX 과거 일봉 원주가→미달 KIS 2차조회, KIS 11/10 감사 KRX OHLCVA 6필드 일치 검사, 이력 JSONL+manifest SHA), `research-v2-history-runner.mjs`(Turso 캐시 KIS 토큰 SELECT·복호화만, 신규 발급/쓰기는 없음), 기존 coverage/scanner/proof 및 `blue_turso_research_v2_replay.yml` `recover` 통합. KRX 원본 확정일을 별도 연구 이력으로만 재활용, MARCAP 가격 충돌/출처 변조/미래봉 차단. 36종목 모두 250봉이면 4일 연구 및 Turso SELECT 대조까지 같은 수동 Actions에서 실행, 아니라면 이유별 보고서만 남기고 중단.
- **테스트:** 실제 #44899355187 JSON 기반 `--mode=plan` 성공, 신규·기존 Python 연구 테스트 17/17, Node 역사 수집기/원본 해시/Importer 11/11 통과. 최초 PR CI [#44902009297](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44902009297)는 Node 11/11 및 구 Python 테스트 통과 후 Python 3.14 기본 환경의 pandas 누락으로 실패. 같은 PR에서 Python 3.11과 pandas/numpy를 테스트 전에 설치하도록 변경 후 **[v2 사전검증 CI #44902131337](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44902131337) 성공, [연구 안전성 CI #44902131352](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44902131352) 성공**. 두 성공 작업은 PR 안전 테스트/오프라인 `plan`이며 실 `recover` KRX/KIS 시세 호출·원격 DB 대조는 미실행; KIS 캐시 토큰·과거 거래대금·완전한 250봉 확보 여부 역시 아직 미확정.
- **권한 및 다음:** 기본 `plan`/`check` 변경 없음, `recover`는 병합 후 사용자 **수동 선택**, 코드만 병합해도 조회·저장 시작 안 됨. `recover` 실행은 36종목 KRX/KIS **시세 호출은 있음**, D1/Turso 쓰기·토큰 발급·클라우드 배포 없음. 실행 결과에 따라 실제 이력 부족/상장 전/원천 차이를 구분하고, 연구 v2 승격과 5/10/20/60일 익절·손절 추천은 별도 승인·검증 뒤 진행.

## 2026-11-21 (KST) — 동일 코스닥 50종목 격차 확인, KRX 원본 해시 일치 기반 v2 재분석 준비 (PR 준비)

- **실제 자료 확인:** PR #74 병합(`9b578bd`), [Actions #44894825971](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44894825971) `inspect` 성공/보고서 아티팩트 `BLUE_RESEARCH_UNIVERSE_GAP_44894825971`. 11/10·13·16·17 네 날짜의 KRX EOD보다 **정확히 동일한 KOSDAQ 50코드**가 최신 MARCAP 자료에 없음. 현재 MARCAP 하루 종목 수는 구 R1.1 감사의 관측 수와 모두 동일, 역방향(MARCAP-only)은 0건. 50코드 전체는 해당 아티팩트에서 확인 가능; KRX EOD의 `name` 열은 공백이어서 이름을 증빙 없이 채우지 않음. 당시 MARCAP 원본 parquet 해시가 없으므로 `historical_missing_codes_proven=false` 유지.
- **원칙:** KRX 확정 일봉이 이미 Turso에 있으므로 날짜별 KRX 재요청·KIS 보충·기존 v1 연구/가격 덮어쓰기 없이 누락 연구일을 재분석. 저장된 일자별 KRX `day_sha256` 원본 해시와 **재구성한 JSONL 바이트 해시가 일치해야** R1.1 scanner 입력으로 사용한다. 해시 다르면 실패 처리, 새 digest로 거짓 검증하지 않음.
- **이번 코드:** `research-v2-eod-export.mjs`(4일 EOD/구 연구감사 SELECT+정확일 원본 바이트 해시), `research_v2_replay_proof.py`(연구 감사/신호 스냅샷/원본 KRX 해시 연결), `research-v2-signal-import.mjs`(분리된 v2 신호·감사 테이블, 충돌 거부/멱등/실물 read-back). 새 수동 `blue_turso_research_v2_replay.yml`은 `plan`/`check`만 허용, `check`에서 MARCAP 연간 소스 1회 다운로드 후 4일×500종목 청크/2개 프로세스 R1.1 재생·Turso SELECT 대조·아티팩트 보존. `apply`는 코드에 안전 확인값을 요구하는 준비 단계만 있으며 Actions에서는 **절대 실행하지 않음**.
- **누락 위험 차단:** 이전 연구의 **250개 과거 일봉 최소 기준** 때문에 KRX 정확일 50개를 채워도 나머지 역사 봉이 없으면 패턴을 평가할 수 없다. `research_v2_history_coverage.py`가 4일별 EOD-only 정확히 50종목 모두의 **재생 기준 250봉**을 먼저 검사. 하나라도 부족하면 보고서에 `BLOCKED_INSUFFICIENT_HISTORY` 표시 후 v2 연구/신호 검증을 건너뛴다. 완전한 50개 역사 검증의 SHA를 v2 증빙·감사에 결합하므로 단순 전체 종목 수 일치로 승격되지 않는다. 실제 충족 여부는 Actions 실행 전 미정.
- **테스트:** Node 원본 EOD 해시·변조 차단·별도 v2 DB 격리/재시도/미승인 쓰기 차단 8/8, Python 출처 결합/수불일치 차단 4/4, GitHub Actions YAML 파싱 및 `git diff --check` 로컬 통과. 실 Turso에 대한 4일 KRX 바이트 해시 재생·패턴 연구/가격 매칭은 **병합 후 수동 `mode=check` 전에는 미확정**.
- **다음:** PR CI → 사용자 병합 → **수동 `mode=check` 1회**(쓰기/새 KRX 호출 없음) → 4일 감사 KRX 원본 해시·v2 연구 표본/신호 수 검증 → 사용자 별도 승인 후 v2 전용 테이블 `apply` 워크플로 준비. 기존 패턴 Exit Study는 v1의 4개 날짜 제외 정책을 그대로 유지, 새 v2 연구 자동 병합·추천 미게시.

## 2026-11-21 (KST) — 4일×50종목 연구 모집단 격차의 후보 목록 재구성 (PR 준비)

- **확정 실측:** [연구 #44886675015](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44886675015) `mode=study` 성공. KRX EOD 15일/감사 일치 연구 11일, 구 연구 격차 4일 제외. 11/10 2612 vs 2662, 11/13 2613 vs 2663, 11/16 2611 vs 2661, 11/17 2611 vs 2661, 각 50개 순 차이. D+5 관측 성숙 1586종목·일, D+10 1022종목·일. 실제 목표가/손절가 검증용 holdout은 부족해 추천 미게시.
- **제약 확인:** 원래 전체 종목별 관측 목록은 v1 연구 데이터에 남지 않음. 저장된 선택 패턴 신호를 제외하여 집계된 50종목을 거꾸로 식별할 수 없으며 당시 MARCAP parquet 리비전이 보존됐다는 증거도 없음. 이를 정확한 실제 50종목이나 개별 신호 누락 확정으로 단정하지 않음.
- **추가 코드:** `research-universe-gap-export.mjs`로 네 날짜의 독립 KRX EOD 원장 메타/2,600여 전체 종목 코드와 구 연구 감사 수를 Turso SELECT로 제한 조회. 감사/실물 종목 수/이름/시장의 기본 정합성·50개 순 격차 확인 후 JSON 출력. `research_universe_gap.py`는 동일 4일을 **새로 받은** MARCAP 2026년 snapshot의 정규화된 종목과 비교하여 KRX 전용 후보·MARCAP 전용 코드, 소스 SHA256, 개별 순 격차를 산출. 원본 당시 구성원 증명/복구/익절·손절 추천은 항상 `false`.
- **수동 실행:** 새 [BLUE Research Four-Day Universe Gap (READ ONLY)](../.github/workflows/blue_turso_research_universe_gap.yml)에서 사용자 병합 후 `mode=inspect` 1회. `plan`/PR은 DB 조회 0; `inspect`도 **읽기 전용 Turso**+공개 MARCAP 다운로드, KRX/KIS 호출·Turso/D1 쓰기/스키마/자동수집·배포/AI 게시 없음. 보고서 JSON만 아티팩트로 업로드(14일).
- **검증:** Python 순수비교 5/5, Node Turso mock SELECT 3/3, JS 구문 및 `git diff --check` 로컬 통과. 실제 원격 Turso/현재 MARCAP에 대한 4일 후보 비교는 아직 실행하지 않았음.
- **다음:** PR CI → 사용자 병합 → `mode=inspect` 1회 → 50개 후보 및 소스 변경 여부 점검 → 기존 v1 보존, 감사된 KRX 전 종목·과거 가격 바를 이용한 별도 **v2 연구 원장** 설계 후 명시 승인. 이미 제외된 4일 신호는 그 전까지 단기/장기 익절·손절 연구 표본에 넣지 않는다.

## 2026-11-21 (KST) — KRX EOD vs R1.1 연구 전체 종목 수 불일치 차단·탐색 연구 격리 (PR 준비)

- **결과:** [Actions #44881004263](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44881004263) `mode=audit` 성공, 신규 저장 0. 11/02~20 평일 후보 15일 중 정상 EOD/신호 원장 11일, 신규 미감사 날짜 0, `blocked` 4일(11/10·11/13·11/16·11/17). 네 날짜 모두 `SIGNAL_OBSERVED_VS_EOD_COUNT_MISMATCH`; EOD 및 신호 감사 메타데이터는 있고 KIS 잠정 저장 0건. 원본 일봉/신호 개별 행의 완전성이나 차이 발생 원천은 아직 독립 조회 전이므로 단정하지 않음.
- **코드 원인:** 기존 `tools/turso/signal-snapshot-import.mjs`는 EOD 감사 날짜 존재와 **선택된 신호 종목**의 KRX 종가 일치만 강제했고, `manifest.observed_stocks === eod_audit.row_count`를 검사하지 않았음. 최근 `market_scan_r11.py --verified-eod-dir`에는 같은 검사가 있지만 과거 다른 EOD/연구 소스 조합에서는 우회 가능. 과거 `pattern-exit-export.mjs`도 두 수의 불일치를 검사하지 않아 [연구 #44848048384](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44848048384) 보고서의 전체 연구 15일이 모두 동일 모집단이라고 볼 수 없음.
- **수정:** 신규 패턴 저장 승인 시 KRX EOD 전체 감사 종목 수와 연구 관측 종목 수가 다르면 **신호를 쓰기 전** `TURSO_SIGNAL_RESEARCH_UNIVERSE_MISMATCH`로 차단. 수동 익절/손절 연구는 이런 과거 날짜의 신호를 연구 표본에서 명시적으로 제외하며, 해당 날짜 KRX EOD 고저/시종가는 **정상 날짜 신호의 후속 보유 경로**에는 계속 활용. 결과 요약에 `research_excluded_days`를 기록하고 임의 0%·손실로 계상하지 않음. 원본 저장 행·원장 불변, DB 스키마/관리 변수/자동 백필/토큰/D1/API/PWA/수동 publish/추천 모두 미변경.
- **테스트:** 패턴 저장 및 익절/손절 export Node 10/10, Python 연구+기존 백필 가드 13/13, `git diff --check` 통과. 실제 Turso 재조회/새 요약 보고서 생성은 병합 후 수동 `mode=study`로 수행할 예정이며 추천 게시 없음.
- **다음:** PR CI → 사용자 병합 → **추가 KRX 재수집 없이** read-only Exit Study `mode=study, sessions=60` 1회 실행하고 `research_excluded_days` 및 D+5/D+10 성숙 사례 확인. 기존 4일 연구를 진짜 복구해야 한다면 저장된 v1을 덮어쓰기 전에 버전별 원장/기존 기록 보존·전체시장 재현 가능성을 따로 설계한다.

## 2026-11-21 (KST) — 11월 결측 실제 적재 성공·KIS 잠정/확정 감사 구별 (신규 PR 준비)

- **운영 결과:** [Actions #44848048384](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44848048384)는 `mode=apply`, 기간 2026-11-02~20, `batch_size=5`, `study_after=true`. KRX 정확일 확인 후 11/02·11/05·11/06 EOD 및 R1.1 패턴 저장 각각 `DAY_OK`, 배치 성공 3·실패 0·원천 미확인 0. 읽기 전용 청산 탐색 `asof=11/20`, EOD 15일/패턴 신호 종목일 2,798/가격 관측값 23,425, 보고서 아티팩트 정상 업로드. D+10 성숙 표본 수와 매매 정책 검증은 이 로그 숫자만으로 단정하지 않음. 기존 감사 불일치 11/10·13·16·17은 이번에도 저장 대상 제외.
- **원인 구분 필요:** EOD 감사/신호 감사 불일치는 신호의 관측 종목 수와 EOD 전체 종목 수 차이, 해시·범위 오류, 감사 없는 실물 행 등 여러 원인에서 생김. KIS 잠정 시세가 기록됐다는 사실만으로 불일치 원인이라 단정 불가.
- **이번 코드:** `missing-history-plan.mjs`는 원래 불변 감사 가드와 `selected` 형식 유지하면서 `blocked[].details`에 실제 불일치 조건을 분리 표시. 선택/차단된 최대 100개 날짜만 Turso SELECT 1회 추가해 KIS 잠정 행 수·일자별 종가 소스·KRX EOD 감사 존재/메타데이터 유효성을 `source_evidence`에 기록. `KIS_ONLY_NO_KRX_CONFIRMED_EOD`는 **잠정 자료만 존재**, 확정 EOD가 아니므로 자동 패턴 추천/확정 연구 승격 금지. `TABLE_MISSING`은 수집 없음과 구별. 원장/자료 업데이트, 운영 DB 쓰기, KIS 직접 API 호출/토큰 발급, D1, 배포는 없음.
- **검증:** 단위 테스트 및 문법 검사 실행, 실제 Turso 데이터 적용은 사용자 병합 후 다음 Actions에서 검증. 4개 날짜의 구체적인 충돌 원인·KIS 저장 현황은 **새 코드로 운영 재조회 전까지 미확정**. 기존 확정/잠정 데이터는 덮어쓰지 않음.
- **다음:** PR 안전 CI → 사용자 병합 → 최소한의 읽기 전용 `audit` 1회에서 네 날짜의 `details` 및 `source_evidence` 확인 → 실제 충돌별 복구 계획 별도 검토; 동시에 D+5/D+10 사례 성숙도 검토. 같은 검증 반복 대신 원인이 확정된 날짜만 명시적으로 해결.

## 2026-11-21 (KST) — 11/02~11/20 우선 결측 보완과 D+5·10 일괄 재연구 (PR 준비)

- **사용자 승인 방향:** 과거 2년치 오래된 날짜보다 **11/02~11/20에 존재하는 EOD/패턴 누락 거래일**을 먼저 채워 D+10 성숙 표본을 확보. 11/01은 일요일이며, 11/20 기준 11/02~11/06 발생 신호의 후속 10거래일이 관측 가능하다는 것은 모든 해당 거래일 원천·신호가 확인된 경우에만 성립.
- **기존 문제:** `blue_turso_missing_history_backfill.yml`은 `lookback_days`로 전체 기간의 가장 오래된 누락을 고르므로 11월 초 우선 수집을 바로 지정할 수 없었음. 최신 실물 [Turso 연구 #44757099110](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44757099110)은 EOD 감사 10일, D+5 성숙 988종목·일, D+10 성숙 0건(전부 최신 미성숙), `publish` 실행 없음.
- **변경:** 수동 실행에만 `start_day/end_day` 양쪽 날짜를 추가(최대 31달력일, 지난 날짜, lookback 이내). 예약 실행의 범위·변수·기본 OFF와 `apply` 명시 승인, 기존 EOD/연구 원장 불변·충돌 격리·5일 배치 유지. `study_after=true`는 성공한 수동 실행 뒤 Turso SELECT→순수 오프라인 D+5/10/20/60 분석 후 **요약 보고서 아티팩트만** 업로드하며 실거래·추천 및 `publish` 쓰기는 하지 않음.
- **로컬 검증:** Python 날짜 경계/미래·부분 입력·예약 덮어쓰기 차단 7/7, 기존 패턴 연구 5/5, Node 미수집 원장 계획 및 11월 우선순위 회귀 6/6, Turso 연구 export 4/4, Workflow YAML 및 `git diff --check` 통과. KRX/Turso 운영 SQL·저장·KIS 토큰 발급·Cloudflare 배포 미실행. 이 변경을 병합해도 11월 누락일이 자동 저장되거나 D+10 보고서가 자동 게시되지는 않음.
- **다음:** PR CI→사용자 병합→수동 `audit`로 11/02~11/20 누락/충돌 확인→운영자가 별도 `apply` 승인 후 5일씩 결측 보완+선택적 `study_after` 보고서. 성숙 표본·KRX 연속성/수정주가·비교 기준 검증 전 AI 추천 차단.

## 2026-11-20 (KST) — 장바구니 상승 TOP 10 기준 선택 + D+5/10/20/60 고저가 경로 연구 (별도 PR 준비)

- **운영 선행 확인:** [PR #69](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/pull/69) 병합 커밋 `3992d92d` 확인, 동일 커밋의 [API 실제 배포 #44750669729](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44750669729)와 [웹 실제 배포 #44750858818](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44750858818)에서 각각 배포 단계 `success`. 운영 모바일의 실제 저장 가격·화면 값 개별 실측은 아직 없음.
- **장바구니 필터:** 기존 상승 TOP 10을 `현재수익률`(기본)/`관측 최고가`/`관측 최저가` 세 기준으로 바꿔 선택 가능. 공통 순수 함수 `web/src/basket-rank.ts`로 **화면과 정렬의 동일 가격**을 사용하고 선택 중인 양(+)의 수익률만 내림차순 TOP 10. 저가 기록 없는 종목은 0%로 합성하지 않고 제외. 하락 TOP 10은 기존 최근시세 기준을 유지. 장바구니 저장·백업·장기 관찰 보호 불변.
- **색상:** 관측 최고가 가격/수익률은 토마토색, 관측 최저가 가격/수익률은 파란색으로 대비. AI 패턴의 경로 연구에서도 같은 상승/하락 색상 사용. 모바일 버튼·가격 카드 가독성 보강.
- **패턴 연구:** 기존 수동 Turso 감사 연구 경로의 순수 오프라인 `pattern_exit_study.py`에 **신호 다음 거래일 시가 기준 보유 5·10·20·60거래일** 최대 고가 상승률과 최소 저가 하락률(중앙값), 고가가 먼저/저가가 먼저/동일 거래일 선후 불명 개수, 성숙·미성숙·누락 건수 추가. 기존 5·10·20·60·120·250·500 **신호 발생 최근 기간**과 명시적으로 구분. 최소 3개 성숙 사례부터 탐색 표시, 종목 추천 불가·날짜별 OHLC 내부 경로 추정 금지. 기존 요약은 불변 수동 `publish`로만 Turso 저장하며 구버전 게시 보고서도 조회 호환.
- **안전:** API·웹 읽기 경로만 변동; KIS 호출, DB 스키마/자동 쓰기, 원본 신호/EOD, Worker Secrets, D1 복제, AI 추정, 매매·주문 0. 기존 탐색 보고서 `publish`는 독립 승인 문자열이 필요한 별도 단계이며 이번 PR/배포만으로 게시되지 않음. 당일 동일 불변 보고서 재게시 충돌 시 덮어쓰지 않음.
- **로컬 검증:** 장바구니/Turso API/기존 연구 Node 회귀 **88/88 PASS**, Python 오프라인 청산/패턴 **15/15 PASS**, Turso 원천 감사·게시 안전 Node **7/7 PASS**(합계 110). 웹 TypeScript/Vite 프로덕션 빌드·수정 API TypeScript 무출력 검사·Wrangler API `deploy --dry-run`·`git diff --check` 모두 성공. 원격 CI 및 운영 배포/실제 새 연구 게시 여부는 별도 확인 필요.
- **바로 다음:** 안전 CI/수동 보고서 연구 워크플로 통과 → 사용자 PR 병합 → API/웹 필요 범위만 수동 배포. 별도 `mode=study` 읽기 전용 보고서 품질·성숙도 확인 후, **사용자 명시 승인 시에만** `publish`. 재연구 값과 이미 게시된 동일 날짜 불변 자료 충돌은 허용하지 않음.

## 2026-11-20 (KST) — 장바구니 최고·최저가 동시 추적 (별도 PR 준비)

- **현재 운영 확인:** 검색 장바구니 연속 담기 수정 [PR #68](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/pull/68)은 병합 커밋 `7dccd744`로 실제 병합됨(UTC 13:56). [Web 안전 CI #44747927028](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44747927028), [Direct KIS 안전 CI #44747927008](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44747927008) 성공. 마지막으로 확인된 웹 실배포 [#44744917971](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44744917971)는 PR #67 병합 `95354f1c` 기준이므로, **PR #68 운영 UI 반영은 아직 확인되지 않음**.
- **사용자 제안:** 장바구니에 최고가만 표시하면 수익 전 하락 위험을 놓침. 발견일·정밀분석 기준일의 다음 거래일부터 **관측 최저가·날짜·기준가 대비 수익률**을 최고가와 함께 표시해 향후 익절·손절 패턴 연구의 기초로 사용.
- **API/기준:** 기존 Turso 감사 완료 `blue_eod_daily_v1.low`와 날짜 검증된 KIS 저장 `payload.low`에서 **발견일 이후의 최저가**를 읽기 전용 산출. 같은 날짜에 감사 완료 KRX EOD가 있으면 잠정 KIS 저가는 제외. 누락 날짜가 있으므로 절대 최저가·연속 보유 검증을 주장하지 않고 `low_complete=false`, `부분 관측` 유지. 새 수집·DB 스키마·KIS 호출·토큰 갱신·주문 로직 없음. D1 보조 경로도 기존 저장 차트의 유효 저가/KIS 기록만 활용, 보장된 연속 일봉으로 취급하지 않음.
- **화면:** 최고·최저·최근·현재수익률 4개 카드, 모바일 2×2. 최신가·발견가/기술 신호/장기 관찰 보호·로컬 저장 구조 불변. API와 웹은 별도 수동 배포가 필요한데 **최저가 필드는 구 API에서 미존재할 수 있으므로 화면은 안전하게 `—`로 표시**.
- **로컬 검증:** Turso/KIS 관측 우선순위, 기준일 제외, 복수 발견일 독립 구간, D1 저장 차트의 유효 저가, 웹 안전 표기를 포함한 Node 회귀 **92/92 PASS**. 웹 TypeScript/Vite 프로덕션 빌드·API Wrangler `deploy --dry-run`, 수정 API 모듈 TypeScript `--noEmit` 검사 및 `git diff --check` 성공. PR 원격 CI·실제 모바일 표시/운영 API/웹 배포 결과는 별도 확인 필요.
- **바로 다음:** 새 PR 테스트·CI·사용자 병합 → 기존 API Worker `blue_turso_api_eod_deploy.yml` 수동 `deploy_api` → 웹 `blue_web_r15110_static_safe_deploy.yml` 수동 정적 배포 → 실제 1~2종목 저가/날짜/부분 관측 모바일 확인. API/웹/DB 원격 변경을 PR 병합으로 오인하지 않음.

## 2026-11-20 (KST) — 검색 장바구니 연속 담기 누락·버튼 무반응 수정 (PR 준비)

- **사용자 제보:** 검색에서 담기 버튼을 눌러도 상태가 바뀌지 않고, 여러 종목 중 일부만 장바구니에 들어감.
- **원인:** Turso 모드 검색 탭에서는 `<SmartBasket>`을 아예 언마운트했음. 상위 검색은 단 하나의 `basketRequest`만 보유해 탭을 열 때 **마지막 클릭만** 전달했고, 자식의 `onItemsChange`도 실행되지 않아 검색 버튼의 `담김` 표시가 갱신되지 않았음. 추가로 상위 100개 한도는 장기 관찰 보호를 포함한 전체 수로 세어 과도하게 차단했음.
- **변경:** 검색 중에도 SmartBasket 상태/로컬 저장을 유지, 종목별 클릭을 증가하는 serial의 큐로 전달해 한 번씩 처리하고 완료 후 큐 제거. 저장 수신 시 버튼을 `담김`으로 바꾸고 검색 상단에 성공/실패 안내. 장바구니가 숨겨져 있을 때 조회성 watch 등록·AI·시세 폴링은 수행하지 않아 D1 요청 증가를 막음. 일반 100건 한도는 보호 제외 실제 일반 항목 수 기준으로 계산; 미확정 가격·비숫자 종목코드에는 모바일 버튼 제한 사유 표시. 원본 발견일·기존 장바구니와 백업은 보존.
- **검증/운영:** 신규 큐/일반 한도/중복 클릭 및 기존 Turso·기술 배지 회귀 Node **30/30 PASS**, 웹 TypeScript/Vite 프로덕션 빌드·`git diff --check` 통과. 실제 휴대폰 연속 담기·운영 PWA 반영은 PR 병합 후 웹 정적 배포 필요. D1/KIS/Turso 직접 SQL·Collector/API/비밀값/자동 수집 예약 정책 변경 없음.

## 2026-11-20 (KST) — 장바구니에서 검색 당시 역배열·장기선 돌파 표식 누락 수정 (PR 준비)

- **제보/원인:** 검색 화면에는 `extras.ma20/ma40/ma60`으로 계산한 `역배열`과 이동평균 전환/112·224선 돌파 배지가 표시되나, 장바구니는 원본 `signals`만 보존해 새로 담으면 기술 배지가 사라졌음. 원본 신호 코드와 계산된 기술 배지는 다른 필드임.
- **코드:** 공통 `web/src/discovery-technical.ts`로 검색일 기술 배지 판정을 일원화. 검색·정밀분석에서 장바구니 추가 시 검증된 당일 배지를 **최초 발견 스냅샷**으로 브라우저 장바구니/JSON 백업에 보존, 발견 당시 기술 신호 영역에 표시. 기존 장바구니는 기존 Turso 우선/D1 후순위 검색일 **정확한 코드·날짜의 연구 자료가 있을 때에만** 역배열 등을 복원; 없으면 임의 추정하지 않음. 이후 최신 시세와 발견일 기술 배지를 혼동하지 않음.
- **검증/보호:** 관련 브라우저·Turso/검색 회귀 및 새 기술 배지 테스트 **25/25 PASS**, 웹 TypeScript/Vite 프로덕션 빌드·`git diff --check` 통과. 기존 목록·백업 필드 호환, 원본 `signals`/수익률/발견가격·KIS/D1/Turso 호출 정책 무변경. 원격 CI·실제 모바일 표시/기존 목록 자동 복원은 PR/배포 후 확인 필요. 실제 운영 앱 반영은 PR 병합 후 별도 **웹 전용** 배포 필요.

## 2026-11-20 (KST) — KRX 당일 일봉·패턴 저장 및 4개 실제 운영 배포 확인

- **실제 데이터:** [일일 `apply` #44734533589](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44734533589)에서 2026-11-20 KRX 정확일 2,662종목, Turso EOD `written=2662`, R1.1 검색 신호 89건 `written=89` 확인. 이날 KRX 성공으로 KIS 대체 수집은 시작하지 않았음. 전체 종목 지표는 별도 opt-in 없이 미실행.
- **실배포:** PR #66 병합 커밋 `5becb6e` 기준 [Collector #44740418020](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44740418020), [API #44741117341](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44741117341), [웹 #44741468897](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44741468897)의 Wrangler 업로드·배포 완료, [즉시조회 플래그 #44742032320](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44742032320)의 `mode=enable` 확인. **실제 검색 시 최신 KIS 시세 반영·KRX 장애일 대체 수집 성공은 아직 미관측**이며 배포 성공과 구분.

## 2026-11-20 (KST) — KRX 불가 시 KIS 자동 2차 수집·검색 누락가 자동 조회 (PR 준비)

- **요청:** KRX가 안 되면 보조 KIS를 `apply`에서 실제 자동 호출하고, 사용자가 종목을 검색하면 최근가가 비거나 낡은 종목의 KIS 최신 시세를 별도 버튼 없이 반영한다.
- **코드:** `tools/turso/krx-kis-fallback-collect.mjs`는 직전 감사 KRX 전체 종목을 1,750ms 이상 간격으로 KIS 정확일 daily-price에서 읽고 20개 유효 건마다 Turso 잠정/시세·이력 저장. 재실행 누락분만 조회, KIS 429·유효날짜 불명·토큰 없음 시 안전 중단, KRX 확정 원장·연구 쓰기 없음. 일일 `apply` KRX 실패 단계에 연결, `dry_run`/정상 KRX 경로는 그대로. `worker/src/turso-eod.ts`의 같은 날 KRX 확정 우선·KIS 당일 잠정/22시 이후 정밀 출처 읽기, `collector/src/turso-direct.mjs`의 15:20~22:00 정확일 KIS 온디맨드까지 연결. `web/src/main.tsx` 검색 직후 최신가 누락 종목 최대 100개 순차 자동조회·진행 표시, 기간 최고가/검색일 거래대금·확정 신호 보존.
- **검증:** 관련 Collector/Node/Turso/API·웹 회귀 **124/124 PASS**, 통합 Python Workflow 가드 **6/6 PASS**, 웹 TypeScript/Vite 빌드, API·Collector Wrangler `deploy --dry-run` 성공(2026-11-20 로컬). 실제 KIS 호출/Turso·D1 원격 SQL/운영 배포/Worker Secret 갱신·FULL 활성화 **수행하지 않음**. 공식 KIS 예제의 `inquire-daily-price`/`FHKST01010400` 및 정확 영업일 필드 대조. [운영 안내](KRX_KIS_AUTOMATIC_FALLBACK.md).
- **다음:** PR CI→사용자 병합→Collector/API/웹 순차 재배포→사용자 승인 KIS 즉시조회 flag enable(전역 FULL 아님)→검색 1~2종목 새 KIS 저장과 KRX 실패시 일일 `apply`의 KIS 잠정 자료/호출 제한 실측.

## 2026-11-20 (KST) — PR #64 병합 후 통합 안전 CI 구문 검사 보완 (PR 준비)

- **병합 확인:** PR #64 [병합 커밋 `0b03afc`](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/pull/64) 로컬 `origin/main` 계보 확인. 무비밀 [KIS 안전 CI #44730835529](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44730835529), [웹/API 안전 CI #44730835495](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44730835495)는 성공. [통합 연구 안전 CI #44730835563](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44730835563)만 신규 `steps.krx_fetch.outcome == 'success'` 조건을 알지 못하는 **기존 테스트의 고정 문자열 검사**에서 실패했고, 실 KIS/DB/파이프라인은 시작되지 않음.
- **수정:** `tests/test_turso_unified_pipeline.py`의 3개 기존 쓰기 조건 문자열을 **KRX 성공을 추가로 요구하는 새 계약**으로 업데이트. KRX 실패 시 읽기 전용 KIS gate, 전체 확정 쓰기 차단 조건 및 gate 코드의 tokenP/DB 쓰기 금지까지 검사. 통합 수집·분석·데이터 모델 및 Worker 배포 코드는 변경하지 않음.
- **다음:** 로컬 테스트/PR CI 후 사용자 병합. 운영 KIS 0건 실제 원인 감사·Collector 플래그 확인·승인 배포는 여전히 별개이며 이번 수정에서 하지 않음.

## 2026-11-20 (KST) — KRX 미확정 → KIS 잠정 일봉·관찰 연결 (PR 준비)

- **사용자 정정:** 미확정 KRX EOD에 대해 KRX만 반복 `dry_run`할 것이 아니라 이전에 합의한 KIS 대체 자료를 사용해야 한다. KRX 전체시장 검증/확정 신호 안전 규칙은 유지.
- **작업:** 일일 통합 워크플로의 KRX 실패를 감지, 확인된 Turso KIS 잠정 행만 읽기 전용 감사하여 `KIS_PARTIAL_PROVISIONAL` 또는 명시적 실패로 기록. 기존 EOD만 확인되어도 연구 완료는 아니므로 KIS 잠정 성공으로 위장하지 않음. KRX가 실패하면 확정 EOD·전체 종목 지표·R1.1 패턴 쓰기 모두 건너뜀. 검색 요청 상태에서도 KIS 분기 성공을 확정 `READY`/불명확한 실패와 분리(`PROVISIONAL`).
- **KIS 0건 진단:** 기존 Collector의 09:00~22:00 KST OPT-IN 수집·기존 암호화 토큰 재사용·FULL 안전 감속은 유지하면서, `NO_VALID_QUOTES` 사유를 허용된 코드별 횟수로 기록하고 Collector 로그에 시도/저장/거절 건수 출력. 실제 0건의 운영 원인을 확인했다는 뜻은 아님. 운영 플래그 기본 OFF, 외부 토큰 발급/시세 수집을 실행하지 않음.
- **임시 관찰 UI:** 감사 완료 기준 EOD 실물 행수 대조 후에만 잠정 단일 일봉의 양봉/고가권/기준일 고가 돌파/거래량 2배를 순수 계산해 함께 보여 줌. `pattern_analysis:false`/`pattern_confirmed:false`, 날짜·원천·실제 수집 범위 표시. PWA는 22시 전 KRX 미분석 오늘 날짜를 KIS 잠정으로 먼저 안내. 5·10일 성과/RSI·MACD·GC/AI 매수 추천을 생성하지 않음.
- **검증:** 무비밀 Collector/KIS/Turso 보안 회귀 Node **79/79**, 웹/API/진행 상태 회귀 Node **69/69**, 웹 TypeScript·Vite 빌드, API·Collector Wrangler `--dry-run`, 통합 EOD Workflow YAML 파싱·쓰기 차단 정적 검사 및 `git diff --check` 로컬 통과. PR 원격 CI는 게시 후 별도 확인. 본 PR 코드 변경만 진행하며 GitHub Actions 운영 실행, Turso/D1 쓰기, KIS API/토큰 재발급, Cloudflare 배포·FULL 활성화는 하지 않음. [운영 안내](KIS_PROVISIONAL_FALLBACK_RUNBOOK.md).
- **다음:** PR CI→사용자 병합→별도 승인 Worker/API/PWA 배포→Collector 플래그 읽기 전용 확인→실거래일 15/30분 파일럿 및 안전 사유 코드 확인→KIS 정상/계정 쿼터 확인 후 사용자 별도 승인으로 FULL. KRX 확정 원천이 들어오면 기존 불변 EOD 및 R1.1 전체시장 연구 적용. KIS가 0건이면 `KIS_PROVISIONAL_NOT_AVAILABLE` 그대로 남긴다.

## 2026-11-20 (KST) — KRX 정확일 검증 실패 원인 로그 복구 (PR 준비)

- **실제 실행:** [하루 통합 `dry_run` #44724278090](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44724278090)에서 2026-11-20 20:03 KST KRX 원천 조회까지 도달. KOSPI 횡단면 **935개 중 실제 거래 912개, 무거래 23개, 영문 포함 코드 27개**를 수신했으나 정확일 독립 검증 또는 대체 KRX Open API까지 포함한 단계에서 `SourcePending` 중단. 병렬 패턴 스캔·Turso EOD/신호 쓰기는 **시작 전 미실행**. KOSDAQ·시장 합산·정확일 확인은 통과했다고 주장하지 않음.
- **확정한 로그 버그:** `fetch_verified_day`는 양쪽 소스 모두 실패 시 `primary=...; alternate=...` 형태로 안전한 사유를 포함해 던지는데, 최종 출력 필터가 **대문자만 허용**하여 정확한 원인 대신 예외 클래스명 `SourcePending`만 출력했다. 이번 로그만으로 1차 pykrx 실패 조건, 2차 Open API 실패 사유를 단정할 수 없음. 데이터 미완성이라고 단정하거나 검증을 완화하지 않음.
- **수정:** 소스가 자체 생성한 예외의 코드·시장 식별자만 안전하게 출력. 양쪽 실패는 `KRX_BOTH_PROVIDERS_PENDING DAY=... PRIMARY=... ALTERNATE=...`로 출력하며 외부 응답 본문·URL·인증값·세부 오류 문자열은 여전히 폐기. KRX 정확일 일봉 인증/수집 차단·대체 소스·Turso 불변 쓰기·KIS는 변경하지 않음.
- **검증 및 다음:** 새 기밀 방지·복합 오류 테스트 2개 포함 EOD 테스트 **10/10** 로컬 성공. PR CI 성공 및 사용자 병합 후, 다음 원천 검증 시 실제 공급자별 실패 코드를 관찰한 다음 필요한 경우 공식 원천 검증 경로를 수정한다. 기존 실패 실행의 공급자별 코드를 소급 복구할 수 없어 그 결과를 억측하지 않는다.

## 2026-11-20 (KST) — KRX 수집 결과 재사용·500종목 단위 패턴 병렬 연구 (PR 준비)

- **사용자 결정:** KIS 종목별 수집과 패턴 검증의 반복 지연을 줄이되, KIS 쿼터 불명 상태에서 500개 KIS REST 호출을 한꺼번에 보내지 않음. 이미 검증한 KRX 전체시장 일봉에 대해 **500종목 단위·2개 프로세스**로 R0.8/R1.1 기존 패턴 계산을 나누고 결과를 종목 코드순으로 합친다. R0.6/R0.8의 신호 선정·기술지표·청산연구 규칙은 변경하지 않음.
- **구현:** `turso_parallel_pattern_scan.py`에서 최대 4개 작업자/최대 1,000개 청크 제한, 전체 관측·매칭·지표 수/중복/감사 필드 대조 후에만 exporter로 전달. `--scan-workers 1`은 원본 직렬 경로. 하루 통합 KRX EOD→패턴, 과거 범위 묶음, 미수집 날짜 백필은 2개 프로세스/500종목으로 설정하되 실제 KRX 날짜 수집 및 Turso 저장은 기존 순서·승인 보호 유지.
- **원천 재사용:** 하루 통합 워크플로에서 이미 조회·불변 해시 검증한 KRX 동일 날짜 EOD 파일을 R1.1 스캐너도 검증해 재사용(`--reuse-target-eod-dir`), 대상일 종목 수 대조. marcap이 목표일까지 **2개 이상 평일** 지연되면 중간 거래일 이력 누락을 막기 위해 기존 `upgraded_history` 검증 수집 경로를 유지한다. 기존 과거 replay 전용 `--verified-eod-dir`의 원천 표기는 불변. 공급자 출처 로그는 기존 R1.1 daily 문자열 의미를 유지. 공휴일은 보수적인 재수집이 있을 수 있음.
- **검증:** 신규 병렬 비교 **5/5**, EOD 재사용/해시·출처 **6/6**, 통합 예약 가드 **6/6**, R1.1 원천/날짜 회귀 **21/21**, 독립 연구 워크플로 **5/5** 로컬 통과. 새 병렬 비교는 진단·원본 감사·전 종목 기술지표 스냅샷도 직렬 결과와 일치; 1,001종목은 청크 500+500+1로 분할됨. `--scan-workers 1` 원본 복귀도 확인. CI와 실제 2,600종목 실행시간·메모리 절감률은 PR 이후 별도 측정해야 하며 **속도 개선 수치는 아직 주장하지 않음**.
- **운영 제한:** KIS 요청 속도·tokenP, Turso 실물 행/원장, D1, Cloudflare 예약 변수, API/웹 배포 변경 없음. 앞선 KIS 잠정 수집 0건 원인과 병렬 패턴 계산은 별개; 이 변경으로 KIS 0건이 해결되었다고 판단하지 않음. 원격 EOD/패턴 `apply` 및 재배포 미수행.
- **다음:** PR CI 성공 확인→사용자 병합→기존 하루 통합 및 소규모 과거 `dry_run`에서 KRX EOD 대조·직렬 대비 소요시간/피크 메모리 관찰→별도 수집 동시성 쿼터 실측 후 KIS 병렬화 여부 결정.

## 2026-11-20 (KST) — 당일 검색 신속 분기·KIS 잠정 종목 조회·안전 증속 (코드 준비)

- **요청:** 당일 검색 버튼에서 신규 KRX 전체시장·패턴 분석이 끝나기까지 수분을 기다리는 문제 개선. KIS 잠정 종목 수집 10종목/분은 KIS 공식 할당량이 아니라 초기 프로젝트 안전값이며 2,700종목 순환에 약 4.5시간이 필요함.
- **앱/API:** 감사된 최신 Turso 패턴 날짜보다 새 날짜를 검색하면 불필요한 미수집 SQL 조회를 생략하고 즉시 미완성 안내(15:40 전) 또는 기존 GitHub Actions 분석 요청/진행 카드(15:40 후) 표시. 새 GET `/api/research/provisional`은 저장된 `blue_kis_provisional_daily_v1`를 Turso SELECT로만 검색하고 실제 수집 종목 수, 전일 감사 시장 수, KIS 잠정 수신시각·가격을 별도 카드에 표시. **오늘 신규 기술신호/전체종목 패턴이 아니라 잠정 수집 부분 집합**임을 명시.
- **KIS 제한/우선순위:** 기존 time-box PILOT은 10종목/분 유지. 별도 승인 FULL에서만 처음 20→성공 시 25/30/35/최대 40종목/분. KIS `EGW00201` 또는 HTTP 429면 나머지 호출 즉시 중단·Turso에 3분 cooldown 저장·다음 배치 예산 절반; 5분마다 최근 감사 완료된 패턴 종목 최대 8개를 일반 종목보다 먼저 관측. 장바구니와 종목추적은 별도 기존 Collector 경로를 유지하고, 실제 동시 사용 가능한 KIS 쿼터는 아직 미측정. 새 토큰 발급/tokenP/D1 수정 없음.
- **장마감 확정:** 기존 평일 22:20 KST `blue_turso_daily_verified_eod_auto.yml` KRX EOD 예약을 재사용. 같은 워크플로의 R1.1 패턴 자동 분석은 독립 `BLUE_TURSO_RESEARCH_AUTO_ENABLED=true`가 필요하며 이번 코드 변경으로 이 변수를 켜지 않음.
- **검증과 PR:** 신규/기존 KIS/Turso 조회·수집 회귀 Node **54/54**(HTTP 429/EGW00201 포함), 분석 요청/API 회귀 Node **51/51**, 웹 TypeScript/Vite 빌드·API 및 Collector Wrangler `--dry-run` 성공. [PR #61](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/pull/61)에서 [KIS 안전 CI #44711199998](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44711199998), [웹 읽기 안전 CI #44711200039](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44711200039) **모두 성공**. 실제 KIS 운영 호출·신규 DB 테이블 생성·API/Collector/PWA 배포 없음.
- **다음:** 사용자 병합→API/PWA/Collector 개별 배포→기존 15/30분 파일럿과 조회 시각 확인→FULL 및 마감 연구 자동화는 사용자 별도 승인 후 활성화.

## 2026-11-20 (KST) — BLUE KIS 기존 유효 토큰으로 Stock-Hunter R9 연구 원천 수집 준비

- **사용자 결정:** 삼성SDI 2023-11-02 고정 추세선/11-06 돌파의 원주가·수정주가를 검증할 때 별도 Stock-Hunter KIS 키 발급·복사 대신, 기존 KIS Secrets가 등록된 BLUE에서 과거 시세를 수집하고 Stock-Hunter의 원천 검증을 사용한다.
- **구현:** 신규 수동 `.github/workflows/blue_stockhunter_r9_kis_price_bridge_research_only.yml`, `tools/turso/stockhunter-r9-kis-bridge.mjs`, 무비밀 테스트, [운영 안내](STOCKHUNTER_R9_KIS_BRIDGE.md). 기존 Turso 암호화 토큰을 **SELECT 1회만** 조회·복호화, KIS 날짜 지정 일봉 `006400`의 2023-09-01~11-06 **GET 2회만** 사용(원주가 flag=1, 수정주가 flag=0). 외부 `tokenP` 금지, D1/Turso 쓰기·주문/매매 호출 0. 고정 Stock-Hunter R8 커밋 `891f3ba3b2d82dec4cf052f301d685d649de106a`을 checkout하여 같은 Actions에서 CSV+매니페스트의 5개 날짜 일치 검사 실행. 기존 BLUE 시세 수집·검색·DB·발급기·Worker/PWA 불변.
- **로컬 검증:** 신규 Node 무비밀 테스트 **11/11 PASS**(기본 dry-run, 토큰 만료 차단, SELECT 전용, 날짜/가격/응답 검증, 원주가·수정주가 플래그, 기밀 미노출). 워크플로 YAML은 `workflow_dispatch` 전용/`contents:read`로 파싱 통과, `git diff --check` 성공. Stock-Hunter 기존 R8 단위 테스트 **9/9 PASS**. 다만 실제 BLUE GitHub Actions에서 pinned R8 checkout과 원천 CSV 인터페이스 연동은 병합 후 실행해 검증해야 함. 실제 KIS 호출/Turso SELECT/토큰 발급·데이터 쓰기·Worker 배포는 **수행하지 않음**.
- **남은 확인/다음:** PR CI 확인·사용자 병합 → `mode=dry_run` → 기존 Shared KIS Token Steward `mode=check`의 유효 토큰 확인 → `mode=capture` 수동 한 번 → Actions 아티팩트의 R8 `independent_status`를 감사. 5개 날짜 비교 통과도 전체 R116 수정주가 재현·55일 전략 성공 판단을 뜻하지 않는다. Stock-Hunter [R9 PR #13](https://github.com/ehdud6728-bit/Stock-Hunter/pull/13)은 대체 수집 경로로 유지하며 별도 Secret 불필요.

## 2026-11-20 (KST) — 미수집 자동 저장 `audit` KRX 기간조회 실패 후 직접 정확일 판정으로 보완

- **실제 실패:** [Actions #44701977071](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44701977071) `audit`에서 가드·의존성 설치 성공, KRX KOSPI 2024-10-21~2026-11-19 지수 기간 조회가 `Expecting value: line 1 column 1 (char 0)`으로 실패. Turso SQL 및 EOD/패턴 저장 단계는 시작되지 않아 원격 쓰기 0건. 이 결과를 조회 실패/휴장일로 잘못 간주하지 않음.
- **사용자 지적:** KIS·KRX 공식 시세가 있는데 별도 거래일 라이브러리를 도입할 이유가 불충분하다. 기존 KRX 정확한 날짜별 KOSPI·KOSDAQ EOD 검증 경로를 재사용하고, KIS tokenP 추가 발급·제3자 달력 의존 없이 가도록 변경.
- **수정:** 날짜 생성기는 검증 전 평일 후보만 만듦 → Turso 불변 EOD/연구 감사에서 미수집 최대 50개 후보 조회 → 각 날짜마다 기존 KRX 전체시장 검증 성공한 날짜만 최대 5개 `audit` 확인·`dry_run` 연구 검증·명시적 `apply` 저장. 불가 날짜는 `KRX_UNVERIFIED`(휴장 또는 공급자 오류, 구별 불가)로 남기고 다음 후보 처리, 연속 8회 원천 확인 실패 시 중단. 감사 존재·충돌·부분 저장 보호, 예약 기본 OFF 정책 유지.
- **테스트/원격 상태:** 신규 및 기존 가드/저장기 단위 테스트 재실행 예정. 실제 KRX·Turso 쿼리·쓰기/예약 활성화는 이번 코드 수정 중 수행하지 않음.
- **다음:** PR CI 통과→사용자 병합→신규 `audit`에서 KRX 날짜별 검증 5개 및 Turso 목록 확인→별도 `apply` 승인 후 순차 저장.

## 2026-11-20 (KST) — 감사 원장 기준 미수집 KRX 거래일 자동 탐색·순차 저장 PR 준비

- **요청/문제:** 수동 11/11~11/12 `apply` [#44696224417](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44696224417)은 `confirm_write` 빈값으로 가드에서 중단되어 저장 0건. 이전 4일 적용 [#44683473485](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44683473485)은 11/10 불변 연구 감사 해시 충돌로 뒤 날짜 연구 저장을 진행하지 못했음. 사용자는 일일이 날짜 선택하지 않고 **미수집 날짜만 차례대로 저장**하는 운영을 선호.
- **개발:** `scripts/turso_missing_history_guard.py`(main/최대5일/2년 범위/쓰기 승인), `scripts/turso_history_sessions.py`(KRX 지수 실제 세션으로 휴장일 제외), `tools/turso/missing-history-plan.mjs`(Turso SELECT 0쓰기, EOD/패턴 감사 별도 비교, 충돌/부분 기록 격리), `.github/workflows/blue_turso_missing_history_backfill.yml`(원장 기반 오래된 미수집 거래일 5개 한정, 기존 불변 importer로 날짜별 독립 재생/오류 시 다음 날짜 진행) 및 단위 테스트. 기존 과거 워크플로·저장 레코드·D1/KIS·전체 종목 지표 옵션은 변경하지 않음.
- **운영 권한:** 수동 `apply`는 `blue-turso-missing-history-apply`, 매일 05:00 KST 스케줄은 저장소 변수 2개 모두 일치해야 허용. 기본 OFF. 로컬 테스트 외 GitHub Actions 실행/운영 DB 연결·쓰기/변수 활성화 미실행. [실행 방법](TURSO_MISSING_HISTORY_BACKFILL_RUNBOOK.md).
- **검증:** 신규 Node 단위 테스트 **4/4**, Python 단위 테스트 **5/5** 로컬 통과. CI·실제 KRX 세션 대량 조회·실 Turso 감사 결과는 병합 후 확인할 단계이며 원격 저장 성공이라고 기록하지 않음.
- **다음:** PR CI → 사용자 병합 → 첫 `audit`에서 실제 미수집·충돌 목록 조회 → 수동 `apply` 1회 확인 → Turso 저장 용량 및 경고 확인 후 별도 사용자 결정으로 자동 예약 변수 활성화 → 장기 표본 기반 익절·손절 후속 연구.

## 2026-11-20 (KST) — 과거 분석 KRX EOD/패턴 원천 불일치 제거 (PR 준비)

- **실행 근거:** PR #57 병합 커밋 `239c2418390fe7275a255a9582afdcebb4279b6a`, [History Replay `dry_run` #44667107812](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44667107812) 전체 job 성공. 정확한 KRX EOD 11/09~12 각 2,660·2,662·2,665·2,664건(**10,651종목·일**), 기존 R1.1 패턴은 각 155·238·283·122건(**798종목·일**); 모두 `written=0`. EOD/패턴/지표 원격 쓰기 단계 skipped. 로그 아티팩트 업로드 성공.
- **발견한 저장 전 문제:** 스캐너는 4개 과거 날짜가 marcap 연도 파일에 이미 있으면 KRX로 전환하지 않고 `FinanceData/marcap daily`만 사용. 실제 패턴 스캐너 `observed_stocks`는 2,610·2,612·2,615·2,614 (**10,451종목·일**, KRX보다 총 **200건 적음**). 이력 `dry_run`은 정적 JSON/해시만 검사하며 Turso의 공식 KRX 종가와 대조하지 않으므로 통과한 것이 곧 저장 호환/전체 종목 동등성을 증명하는 것은 아님. `apply`는 먼저 EOD를 쓰고 신호 importer에서 일치 검증하므로 이 상태로 진행하면 일부 날짜 연구 저장 실패/부분 백필 가능성이 있음.
- **수정:** 기존 검증 완료 `output/history/eod/manifest.json` + `daily.jsonl`(EOD importer `dry_run` 선행)의 날짜/원천/일자별·전체 해시/전체 종목 KRX 일봉을 **그대로 스캐너 목표일에 재사용**. `--verified-eod-dir`는 해당 파일의 증빙을 재확인하고 유효하지 않거나 해당 날짜가 없으면 실패; marcap은 앞선 수개월·연도의 **과거 기술지표 이력**에만 사용. 기존 같은 날짜 marcap 행은 대체하여 KRX에 없는 후보/종가 차이를 방지. 분석된 목표일 종목 수가 KRX 행 수와 다르면 저장 전 중단. 지표 opt-in도 같은 원천 사용. 같은 날짜의 KRX API를 두 번 호출하지 않음.
- **로컬 검증:** 새 입력 재사용/변조·날짜/원천 거부 Python **4/4**, 기존 R1.1 정확일·KRX 회귀 **21/21**, 기간 guard **4/4**, YAML 두 개/`git diff --check` 통과. 실제 원격 `dry_run`에서 **수정 후 신호 발생 건수는 미확인**이고, 위 798건은 marcap 기반 이전 실행의 발생 건수로 정식 연구 백필 수치가 아님. Turso/D1 SQL·KIS·배포 미실행.
- **다음:** PR 검증 및 병합 → 같은 4일의 수동 `dry_run`으로 패턴 감사 `observed_stocks`가 KRX 일봉 2,660·2,662·2,665·2,664과 정확히 일치하는지, 수정 후 후보/차트·원장 해시 생성되는지 확인 → 별도 승인 `apply`로만 Turso 백필. EOD 이미 저장된 4일의 기존 감사와 충돌한다면 데이터를 변경·삭제하지 않고 중단.

## 2026-11-20 (KST) — 과거 4일 묶음 `dry_run` 스캐너 연도 인자 실패 수정 (PR 준비)

- **실제 실행:** [History Replay #44664203917](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44664203917)은 `2026-11-09`~`2026-11-12`, `dry_run`, 전 종목 지표 OFF로 실행. KRX 확정 EOD 네 날짜(2,660·2,662·2,665·2,664종목), **총 10,651건의 원천 검증과 EOD importer `dry_run`까지 통과**(`verified_days=4`, `verified_rows=10651`, `written=0`). 그 뒤 패턴 스캔 단계에서 실패하였으므로 R1.1 연구 스냅샷 검증 **미완료**. 뒤의 EOD/패턴/지표 Turso `apply` 단계 모두 실행되지 않았고 D1 접근·KIS 발급·운영 배포 없음.
- **실패 원인:** 신규 `.github/workflows/blue_turso_history_research_batch.yml`이 스캐너 `--years 2`를 전달했으나 `market_scan_r11.py`는 연도 **개수가 아닌 `2025,2026` 형식의 실제 달력연도 목록**을 요구. `FinanceData/marcap`의 존재하지 않는 `marcap-2.parquet`를 요청하여 HTTP 404 발생. KRX EOD 공급 오류나 Turso 인증 실패 아님.
- **수정:** 각 `DAY`에서 `YEAR-1,YEAR`를 계산해 `--years "$RESEARCH_YEARS"`로 전달. 기존 일일 통합 수집 guard와 동일한 기간 규칙으로 맞추고, 연말/연초/2026-11-09을 포함한 실제 워크플로 명령 회귀 테스트 추가. 기존 `plan`/`dry_run`/`apply` 승인 분리, 원천·원장 검증 및 데이터 보존 정책 그대로 유지.
- **로컬 검증:** 신규 포함 Python 이력 워크플로 guard **4/4 통과**. `dry_run` 재실행·KRX 연구 스캔 실제 완료 여부/원격 GitHub CI는 PR 병합 전까지 미확인. **이 작업에서는 DB 기록 및 원격 스캐너 실행 안 함.**
- **다음:** PR 리뷰·CI 후 사용자 병합 → 같은 4일 범위의 `dry_run` 다시 실행해 R1.1 연구 원천·manifest까지 검증 → 성공 확인 후에만 별도 승인 `apply` 여부 결정. 4일 EOD 검증 성공만으로 패턴 자료 적재를 완료했다고 판단하지 않음.

## 2026-11-20 (KST) — 과거 묶음 복구·5~500일 패턴 익절/손절 일괄 개발 (PR 준비)

- **운영 기준:** PR #55 병합 `7615436cabd389fa506ae31b38b2079e1d969b48`. 같은 커밋을 사용한 [API 배포 #44655223026](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44655223026)와 [웹 배포 #44655290849](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44655290849)의 실제 Deploy 단계 성공. 기존 자료는 [읽기 전용 감사 #44652090911](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44652090911)에서 EOD 9일·23,957 종목·일, 연구 5일·882 종목·일, 전 종목 지표 0일. 실제 모바일 화면 표시는 미확인.
- **사용자 요구:** 데이터 확보 → 5·10·20·60일과 120·250·500일 병행 → 익절/손절/시간청산 효과 → 최근 효과를 검증한 AI 관찰 후보 순으로 **한 PR에서 기반 기능을 묶어 진행**. 과거가 없는데 수익률/추천을 만들지 않음.
- **역사 자료:** 소스·원장·해시를 모두 재사용하는 기존 KRX exact-day EOD/연구 importer를 최대 7달력일/5평일 수동 기간으로 묶음. `plan`은 네트워크 0, `dry_run`은 검증만, `apply`는 날짜 포함 정확 승인 후 EOD·R1.1 패턴 저장. 전 종목 지표는 별도 opt-in 및 이중 확인 문자열. KRX 공급자 장애/휴장일/기존 행 충돌은 자동 덮어쓰기 없이 중단. D1/KIS 발급/AI 호출 없음.
- **연구 결과:** 새 Turso SELECT 전용 export가 날짜별 EOD·연구 건수·연구 해시 검증, 데이터 범위를 상한으로 제어. 순수 Python 연구는 다음 거래일 시가 진입, 사전 고정 6개 익절/손절/기간 정책 첫 도달, 거래 비용, 고저가 동시 도달 손절 우선, 결측·미성숙 제외, 시점 구분 홀드아웃. 5·10·20·60·120·250·500일 원장 충족 여부/탐색 정책 요약 반환. 별도 승인 `publish`는 원본 보존 불변 요약 테이블에만 저장. API `/api/research/exit-study`·PWA `TursoExitStudy`에 미게시/관찰 통계 표시. **공식 세션 캘린더·기업행동/수정주가·시장/업종 출처 독립 검증 전 추천과 예상 목표가 생성 금지**.
- **로컬 검증:** Python 이력 guard **3/3**·청산연구 **4/4**, Turso exporter/publisher Node **7/7**, 기존 Turso API/브라우저 회귀 Node **62/62**, 웹 TypeScript/Vite 빌드, Worker Wrangler `--dry-run`, 계획 실행 `turso_sql_queries=0`·`d1_sql_queries=0`, YAML 구문·diff 정합성 통과. 원격 KRX 조회·Turso/D1 SQL 쓰기·KIS tokenP·배포 **없음**. 새로운 원격 GitHub CI는 PR 게시 후 확인. [운영/후속 절차](TURSO_PATTERN_EXIT_BATCH_RUNBOOK.md).
- **다음:** PR CI → 사용자 병합 → API/웹 별도 수동 배포 → 과거 결측일 작은 `plan`/`dry_run` 검증 → 승인한 범위만 단계적 `apply` → 자료 성숙/독립 검증 후 `study`와 필요시 `publish`. AI 관찰 후보의 실제 활성화는 추가 공식 시장/기업행동 근거 필요.

## 2026-11-20 (KST) — 최근 감사된 5개 연구일의 패턴 발생 빈도 UI/API (PR 준비)

- **실제 감사 근거:** PR #54 병합 `bff985eea0124b1924ca7f59292988a02c00c8eb`. [읽기 전용 감사 #44652090911](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44652090911)의 `audit` 성공 로그에서 Turso SELECT **5회**, D1 SQL **0회**, 쓰기 없음. EOD 감사 **9일(2026-11-09~19), 전체 종목·일 23,957건**, 최신 8개 날짜의 감사/실물 행 수 모두 일치. 연구 감사 **5일(11/13,16,17,18,19), 패턴 매칭 종목·일 882건**이며 5개 날짜의 감사/실물 건수(196·114·140·189·243) 일치. 전체 종목 기술지표 원장은 **0일(기본 opt-in OFF)**. 거래일 연속성·기업행동·완성된 후속 성과/익절·손절은 미검증. 5일 출현 관찰만 가능하며 **10일 연구일은 5개 부족**, EOD도 9개로 부족함.
- **이번 코드:** `GET /api/research/pulse`는 Turso 최신 감사 연구일 최대 10개 중 최근 5개 신호 발생을 이름별 집계하고, 원장 날짜별 실제 저장 건수·이벤트 수·원천 해시가 모두 일치할 때만 반환. 전체 관찰 종목·일 1,000개당 빈도를 보여 주며 이전 감사 연구일 5개가 추가로 있을 때만 상대 변화율을 계산(양쪽 패턴 발생이 각각 3회 이상). `AI 패턴` 탭의 `TursoPatternPulse`에 최대 10종 기술신호를 표시. **연속 5거래일 보장, 실제 시장 승률, 미래 5일 청산 성과, 종목 추천, AI 모델 분석은 제공하지 않음.** 데이터가 모자라면 변화율을 숨긴다.
- **보호:** SELECT 전용, API D1/AI 캐시 호출 없음. 기존 연구 날짜 자동 수집·저장/지표 opt-in/KIS tokenP·토큰 금고·수집기/Workflow 예약 설정을 변경하지 않음. 이 PR은 운영 Worker/PWA 배포나 Turso 백필을 수행하지 않음.
- **로컬 검증:** Turso API/API 라우팅/브라우저 회귀 Node **59/59** 성공(5+5일 기준선·원천 해시 불일치 거부 포함). 웹 `npm run build` TypeScript/Vite 성공, Worker Wrangler `deploy --dry-run` 성공, YAML 구문·`git diff --check` 통과. 실제 모바일 화면·운영 API 응답 및 원격 CI는 미확인.
- **다음:** 코드 리뷰/CI → 사용자 병합 → 별도 API/PWA 배포 → 실제 감사일 UI 검증 → 사용자 승인 하에 누락 연구일/과거 EOD 백필 및 전체 종목 지표 opt-in 검토 → 성숙한 5·10·20일 청산 결과의 독립 검증과 최근·장기 비교/AI 추천 연결.

## 2026-11-20 (KST) — AI 패턴 5·10일 초단기 + 중·장기 확보율 읽기 전용 감사 PR 준비

- **운영 확인:** PR #53 병합 `3b09f9306445a8f6641b4752446745ec13984325`, [실제 API 배포 #44647891557](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44647891557) 및 [웹 배포 #44649578847](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44649578847) 성공. 기존 배포/CI 재실행하지 않음.
- **추가 사용자 결정:** 변화가 빠른 시장을 반영하여 **5·10거래일 초단기**, 20·60거래일 단기/지속성, 120·250·500거래일 장기 연구를 **병행**. 최근 5일의 신호와 5일 후 성숙 성과를 혼동하지 않고, 단기 소표본·장기 기준선 충돌 시 자동 추천 금지.
- **실제 조회 제한:** 공개 API `/api/research/coverage` 직접 조회는 Cloudflare 인증 302로 기간 데이터를 얻지 못함. 인증 우회나 운영 DB 직접 쿼리 대신 GitHub Actions Secrets를 쓰는 새로운 읽기 전용 수동 감사 워크플로 준비. **현재 실제 저장된 기간의 일수는 미확인**.
- **코드:** `tools/turso/ai-pattern-horizons-audit.mjs`(KST 이전 760달력일/원장 최대 520일, 5·10·20·60/120·250·500 구간별 EOD/연구/옵트인 전 종목 지표 날짜 집계, 최근 최대 8일만 실물 행수 readback, 평일 누락 후보) + 수동 `.github/workflows/blue_turso_ai_pattern_horizons_audit.yml`(기본 `plan`은 DB 연결 0회; 별도 `audit`만 Turso SELECT) + 단위 테스트. API의 `goals.rolling_windows`와 PWA 다음 단계 문구도 기간 구분에 맞춤. **운영 SQL 쓰기·D1·KIS tokenP·모델 호출·매매·배포 없음.** [설명](TURSO_AI_PATTERN_HORIZONS_RUNBOOK.md).
- **로컬 검증:** 신설 기간 감사 Node **8/8**, 기존 Turso 웹/API/진행 회귀 Node **54/54**, 웹 TypeScript/Vite 빌드·API Worker Wrangler `--dry-run`, 수동 `plan` 출력 `turso_sql_queries=0`, YAML 구문 및 `git diff --check` 통과. 실제 `audit`는 아직 실행하지 않았으며 원격 저장일 수는 확인되지 않음. CI는 PR에서 별도 확인.
- **다음:** 이 PR 무비밀 테스트/CI → 사용자 병합 → 수동 `audit` 후 실제 원장과 최근 8일 불일치 확인 → 과거 구간 보충은 용량·KRX 출처 확인 및 별도 승인 → 성숙 사례 기반 단기·장기 비교/시황 국면·추천 연구.

## 2026-11-20 (KST) — Turso AI 패턴·익절·손절 데이터 준비 1단계 (PR 준비)

- **운영 기준:** PR #51 병합 `3ada75f89c7b9d5037e66b799b7388366f97094e`, [API #44644472568](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44644472568)와 [웹 #44644643775](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44644643775) 실제 배포 성공. 모바일 화면 렌더링 자체는 미확인.
- **추가 요구:** 단순 D+10 성과나 일반적 AI 시황보다 **최근 잘 작동하는 패턴·종목별 후보·시장 국면별 성능·언제 익절하고 언제 손절/시간 청산할지**를 우선. 과거 1~2년 전체 종목 EOD 백필이 아직 없어 충분한 과거 데이터가 있다고 간주하지 않음.
- **구현:** Turso 감사 원장 EOD/패턴 일자·행수 **읽기 전용** `/api/research/coverage`, Turso UI `AI 패턴` 데이터 준비 카드. 동일 Worker의 구 D1 AI 시장 리포트를 Turso 모드에서 호출하지 않음. `scripts/exit_policy_research.py` 오프라인 first-touch 익절/손절/시간청산·갭·모호한 일봉 판정. 실제 투자 후보/AI 모델 출력/패턴 백필/DB 쓰기/발급/주문 미시행.
- **기준:** 미래 일봉을 미리 아는 방식으로 신호일 종가 진입 금지(다음 거래일 시가 사용), 양방향 터치 모호함은 손절 우선, 갭 손절 미화 금지, 미완성 보유기간은 `PENDING`, 샘플 1~11건은 탐색적 소표본.
- **로컬 검증:** Turso UI/API/브라우저 안전 Node **54/54**, 오프라인 익절·손절 Python **8/8**, Turso 연구 guard/export Python 각각 통과, 원장 import Node **9/9**, 웹 TypeScript/Vite 빌드·API Wrangler `--dry-run`·워크플로 YAML 구문·`git diff --check` 통과. 기존 `test_market_scan_r11.py` 재실행은 현재 로컬 Python에 `requests`가 없어 **시작 전 실패**했으며 CI는 `requests`/`numpy`/`pandas`를 설치한 뒤 실행하도록 설정. 해당 기존 테스트의 성공을 주장하지 않음.
- **다음:** PR CI/웹·API 빌드 검사 → 사용자 병합/수동 API+웹 배포 → Turso 실제 감사 원장 커버리지 확인 → 사용자 승인 하에 범위 제한 historical dry-run/백필 → 최근 20·60·120거래일 이벤트/시장 국면/익절·손절 walk-forward 통계 → Gemini 모델 설명 연결. [상세 계획](TURSO_AI_PATTERN_EXIT_PLAN.md).

## 2026-11-20 (KST) — 과거 날짜 자동 분석 진행 카드·실제 단계 표시 (PR 준비)

- **운영 증거:** PR #50 병합 `012107165d1fad7d5e8bbcd7782c7c2506c6f99a`. [API #44636946023](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44636946023)와 [웹 #44637083823](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44637083823) 실제 배포 성공. 사용자 2026-11-16 검색 후 [자동 Turso 통합 EOD·연구 #44637541535](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44637541535)가 2026-11-20 08:25:32~08:29:41 KST(4분 9초) 성공; 전체시장 일봉·연구 단계 성공, 지표 opt-in 단계는 의도대로 skipped.
- **UI 문제/변경:** 분석 요청 자체는 정상이나 화면 상단 배너를 스크롤하면 검색 결과 영역에서 보이지 않고, 일반 `NOT_IMPORTED` 안내만 남아 무반응으로 오해하기 쉬웠음. `TursoResearchProgress` 진행 카드를 통계/검색 결과 사이로 옮겨 4단계 상태·경과 시간·15초 간격 자동 조회·실행 링크·완료 버튼·실패 사유를 한곳에 표시. 실패 시 과거의 '분석 요청합니다' 안내를 그대로 남기지 않음. 정확한 퍼센트 추정은 하지 않음.
- **API 단계 근거:** `worker/src/turso-research-request.ts`의 기존 Access 보호 상태 조회가 날짜와 접수 시각이 일치하는 GitHub Actions 실행에 대해 **읽기 전용** jobs API를 추가 호출. KRX EOD Turso 감사, 전체시장 스캔, 연구 저장 단계의 각 성공한 실제 step에 따라 `stage`·`requested_at_utc` 반환. GitHub 조회 오류/결과 미확정은 `RUNNING`으로 표시해 추정 단계 전진을 차단. 완료 여부는 변함없이 Turso 연구 감사 원장 및 실제 행수로 판정. 운영 D1 SQL·데이터 쓰기·새 분석 실행 없음.
- **로컬 검증:** Turso API/브라우저 연동·회귀·진행 단계 테스트 **51/51 통과**, 웹 TypeScript + Vite 빌드 성공, API Wrangler 배포 `--dry-run` 성공. PR CI/운영 배포와 새 모바일 앱 화면 확인은 후속. 작업 브랜치 `feat/turso-research-inline-progress-20261120`.
- **다음:** PR CI 확인 → 사용자 병합 → 기존 Turso API 배포(승인된 수동 워크플로 `deploy_api`) → 웹 정적 배포 → 미등록 과거 거래일을 검색해 단계 전환·진행·완료 결과 자동 갱신 확인. 테스트 재실행을 위한 운영 D1 조회나 불필요한 KIS tokenP 발급 금지.
- **추가 사용자 결정:** 화면 진행상태 확인 후 저장된 패턴을 활용한 AI 분석·관찰 후보 추천 개발을 다음 우선순위로 확정. 기존 AI 시황/장바구니 API에는 D1 의존이 남아 있어 Turso로 독립 연결해야 함. 데이터 기준일 엄수, 후속 5/10/20거래일 검증과 소표본/불확실성 표시, 다중 신호 근거·위험 요인·AI 설명 및 매일 갱신을 별도 단계로 추진. 이 PR에 AI 후보 추천의 완성/배포를 포함하지 않음.
## 2026-11-20 (KST) — Turso 전체 종목 기술지표 opt-in 및 과거 날짜 검색 자동 분석 연결

- **사용자 문제/결정:** 패턴에 해당한 약 243종목만 저장하는 기존 연구 스냅샷과 별개로, 전체 종목의 매일 일봉·계산 지표를 누적하는 방향에 동의. 이후 다른 날짜를 검색해도 새로운 분석이 시작되지 않고 상태 표시도 보이지 않는 문제를 보고했으며, Turso 중심 날짜별 분석 실행·진행 표시 개발을 승인.
- **확인된 운영 근거:** 2026-11-19 [통합 EOD·연구 #44624755873](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44624755873)에서 KRX 양 시장 2,661개 전체 일봉 및 243개 패턴 연구 스냅샷 저장 성공(이전 사용자 공유 실행 결과). [API 배포 #44629969906](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44629969906)·[PWA 배포 #44630135989](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44630135989)는 기존 버전 배포 확인으로, 새 날짜 실행 기능은 포함하지 않음. 실시간 운영 데이터와 Actions 최신 변수는 재확인이 필요.
- **지표 코드:** `market_scan.py`의 기존 모든 종목 지표 계산 시점에서 패턴 비일치/이력 부족 종목까지 일별 숫자·GC·상태 기록. `export_turso_indicator_snapshot.py`의 전체 KRX 행수/원천/해시 검증, `indicator-snapshot-import.mjs`의 기존 감사 EOD와 모든 코드·종가 일치 확인·멱등 저장/완전 재조회, `blue_indicators_daily_v1`과 원장 분리. `include_indicators` 수동 opt-in 또는 별개 예약 변수의 이중 opt-in만 허용. 기본 EOD·연구 동작/운영 D1 변경 없음.
- **미분석 날짜 기능:** 기존 `web/src/main.tsx`는 Turso의 `NOT_IMPORTED`에 대해 `requestScan`을 호출하지 않아 서버에서 아무 분석도 시작하지 않았으며, 기존 `GET /api/scan`은 D1 기반 작업. 새 Access·동일 Origin 보안 `POST /api/research/request`, `GET /api/research/request/status`는 Turso 감사 상태·요청 원장·GitHub Actions 날짜별 결과를 사용해 한 날짜의 기존 통합 EOD+패턴 `apply`를 요청합니다. 같은 날짜 중복, 동시 3건 초과, 장중 미확정 일봉을 차단. PWA 상단 진행 표시, 15초 확인/재방문 복원, 완료 후 해당 날짜 자동 검색. 범위 조회는 기존 저장 날짜만 읽고 신규 대량 수집하지 않음.
- **로컬 검증:** 전체 지표 export Python 4개, Turso import Node 5개, 기존 지표·매칭 Python 8개, R1.1 정확한 날짜 KRX 보호 Python 21개, 통합 EOD guard Python 6개 통과. 새 요청 상태 Node 7개·실제 API 라우팅/브라우저 연결 회귀 Node 3개 통과, 웹 TypeScript/Vite 빌드 및 API Wrangler dry-run 통과. 별도 전체 회귀·PR CI는 게시 후 확인. **운영 GitHub 분석 실행, Turso/D1 데이터 쓰기, Collector/API/웹 배포, KIS 호출 없음.**
- **PR/인계:** 작업 후보 브랜치 `feat/turso-fullmarket-indicators-and-search-20261120`. 병합 후 안전 CI 확인 → 기존 API 수동 배포 `verify_only` 후 `deploy_api`(별도 승인) → 기존 웹 정적 배포(별도 승인) → 미등록 과거 평일 하루를 검색해 진행·완료/실패·Turso 패턴 저장 확인. 자동 기술지표 적재 변수는 비용/적재량 확인 후 따로 승인할 때까지 OFF 유지. 장기 과거 일봉 백필/지표 UI 조회는 별도 후속 작업.

## 2026-11-19 (KST) — KIS 잠정 일봉 22:00까지 KRX 확정 EOD 미수신 보충

- **문제 증빙:** [잠정 일봉 파일럿 #44517489569](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44517489569)은 20:44 KST에 `start_15m` Secret 설정까지 성공했지만, 기존 `turso-provisional.mjs`의 **09:00~15:20 시간 제한**으로 수집 경로에 도달하지 못함. 사용자 요구는 'KRX 확정 일봉이 없다면 21~22시까지 KIS에서 일봉을 보충 조회'. 해당 파일럿의 설정 성공은 시세 저장 성공이 아님.
- **변경:** 09:00~15:20 기존 현재가 KIS API 유지. 15:20~22:00에는 당일 Turso KRX EOD 감사(`blue_eod_ingest_audit_v1`)와 실제 저장 행수 일치 시 수집을 생략하고, 미감사/불완전 시 KIS 공식 `inquire-daily-price`(`FHKST01010400`)를 요청. 공급자가 명시한 거래일이 KST 오늘과 정확히 같을 때만 `KRX_POST_CLOSE`·`KIS_REST_INQUIRE_DAILY_PRICE` 출처로 잠정 OHLCV 저장, 이전 거래일/날짜 없음은 거부. 주말/휴장일/22시 이후 및 기존 토큰 만료 시 중단. 기존 확정 EOD·연구·D1·tokenP 로직 불변.
- **앱/DB:** 기존 Turso 최신/이력과 잠정 일봉에만 저장하며, API 비교기는 엄격한 날짜·잠정 플래그를 검증한 장외 KIS 자료를 최근 관측으로 인정. 같은 날짜의 독립 감사 완료 KRX EOD가 있으면 **확정 EOD가 우선**한다. 표시는 'KIS 저장 시세'이며 확정 종가로 오인하지 않음.
- **로컬 검증:** Collector Node **74/74**(기존 69 + 신규 5), Turso API Node **35/35**, Collector/API Wrangler `deploy --dry-run` 성공, `git diff --check` 성공. 합성 KIS 응답으로 같은 날짜 검증·이전 날짜 거부·22시 종료·감사 EOD 우선·API 표시/위조 원본 거부 확인. 실제 KIS/API/Cloudflare Worker/Turso·D1 원격 쓰기 없음. PR 병합만으로 운영 Worker가 바뀌지 않으며 별도 Collector/API 배포 및 다음 거래일 파일럿 검증 필요. 기존 토큰 만료·Turso 연결 오류 시 성공으로 간주하지 않음.

## 2026-11-19 (KST) — Collector 운영 배포 완료 및 Turso KIS 토큰 상태 조회 보호 보완

- **실제 배포 확인:** [#44515487283](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44515487283)에서 Collector 69/69 테스트·승인 확인·Cloudflare Worker 업로드 및 매분 트리거 배포·KIS_APP_KEY/SECRET Secret 등록 성공. Worker version `b0818fa5-674b-485e-b81e-a8053c6c08b4`. 운영 배포만으로 Turso 잠정 일봉 파일럿이 켜지지는 않음. 이전 [#44514827448](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44514827448)은 확인 문구 입력 위치 오류로 배포 단계 skipped.
- **사전 점검에서 발견:** `BLUE Shared KIS Token Steward`의 `mode=check`는 문서상 읽기 전용이지만 `steward()`가 진입 시 `CREATE TABLE IF NOT EXISTS` 2회를 실행할 수 있었음. 실제 운영에서 이 쿼리의 테이블 생성 여부는 확인하지 않았으며, 이번에 `check`를 실행하지 않음.
- **보완:** `mode=check`는 토큰·만료 메타데이터 `SELECT` 한 번만 사용하고 테이블을 절대 생성하지 않게 변경. 테이블 누락/연결·권한 실패는 `TOKEN_VAULT_READ_UNAVAILABLE`로 고정하여 오류/원본 비밀값을 출력하지 않고 실패. 기존 승인된 `issue`/`sync`의 초기화·D1 백업·24시간 발급 보호는 변경하지 않음. 로컬 검증 및 PR/Actions는 별도 기록 필요.
- **다음:** 보완 PR CI 및 사용자 병합 → [Shared KIS Token Steward](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/workflows/blue_turso_kis_token_steward.yml) `mode=check` 결과로 Turso 저장 토큰 만료 상태 확인 → `TOKEN_VALID`일 때만 장중 Turso 잠정 일봉 15분 파일럿 준비. 장외 파일럿 미시작, Turso/D1/KIS 운영 쓰기 없음.

## 2026-11-19 (KST) — Cloudflare Collector 운영 플래그 읽기 전용 감사 준비

- **확인된 순서:** 사용자 PR #44 병합(`main` 병합 커밋 `62c8d4e`); Collector 수동 검증 [#44508508392](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44508508392) **69/69 테스트와 Wrangler dry-run 성공**, 실제 배포는 skipped. [Turso Mirror Status #44509040935](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44509040935) 당일 KIS 저장 시세 2종목·이력 8건·마지막 수신 2026-11-19 15:56:10 KST. 이 정보만으로 구형 미러/독립 Turso/신규 잠정 수집기 중 어느 경로가 켜졌는지 확정하지 않음.
- **사용자 승인:** 실제 Collector를 바로 배포하지 않고 Cloudflare **현재 Worker 운영 설정을 읽기 전용으로 감사하는 GitHub Actions**를 준비.
- **구현:** `.github/workflows/blue_collector_runtime_settings_audit.yml`(수동 전용, main만, 기본 쓰기 작업 없음) + `tools/turso/collector-runtime-settings-audit.mjs`(공식 Cloudflare Worker `/settings` GET 1회, 7개 고정 플래그·3개 파일럿 설정 존재 여부만 화이트리스트 상태로 출력, Secret 값/원문/URL·키 미출력) + 위조 응답 기반 무비밀 테스트. [운영·해석 안내](COLLECTOR_RUNTIME_SETTINGS_AUDIT.md).
- **안전 한계:** `secret_text` 바인딩은 값/파일럿 만료 여부를 확인할 수 없으므로 `SECRET_PRESENT_VALUE_UNKNOWN`으로 표시. 바인딩 설정 조회도 실제 실행 중인 모든 수집 루프의 건강상태·배포 버전을 단독 증명하지 못함. D1/토큰·주가/Worker 배포·Variables 수정/시크릿 갱신 없음.
- **로컬 검증:** 신규 Node 바인딩 감사 테스트 **7/7 통과**(GET 한정, secret_text 값 미노출, 중복/오류 실패, 수동 워크플로 무변경 보장), 기존 Turso Readiness 포함 Node **12/12**, Python 기존 운영 배포 보호 **3/3**, Workflow YAML 구문·`git diff --check` 통과. 실제 Cloudflare API GET 및 운영 Worker/DB/KIS 접근은 **병합 후 사용자 수동 실행 전까지 미실행**; GitHub PR CI는 별도 확인.
- **다음:** PR CI 성공 및 사용자 병합 → 읽기 전용 설정 감사 수동 실행 → FULL 미러 OFF 배포 영향 및 Secrets 파일럿 불확실성 검토 → 별도 명시적 승인 후에만 Collector 배포 → 다음 정상 정규장에서 잠정 일봉 15분 파일럿. 분봉은 정밀분석 시 종목별 요청으로 보류.

## 2026-11-19 (KST) — Collector 수동 검증 #44507158683 테스트 의존성 누락 수정

- **실패 확인:** [Collector Actions #44507158683](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44507158683) `Install and run collector tests` 단계에서 `ERR_MODULE_NOT_FOUND: Cannot find package '@libsql/client' imported from tools/turso/kis-token-steward.mjs`. Node 62개 검사 중 61개 성공, 1개 파일은 테스트 로딩 전에 실패. Cloudflare 배포 단계 **skipped**, D1/Turso SQL·KIS 호출·토큰 발급 없음.
- **원인:** `collector/turso-direct.test.mjs`는 `tools/turso/kis-token-steward.mjs`의 테스트용 토큰 암호화 함수를 가져오지만, 수동 배포 워크플로는 `collector`만 `npm install`함. 앞선 PR CI #44506133087는 `collector`와 `tools/turso`를 모두 설치해 통과함. KIS 인증 실패나 잠정 일봉 수집 로직 결함으로 판단하지 않음.
- **수정:** `.github/workflows/blue_r142_collector_deploy.yml`에서 무비밀 테스트 전에 `tools/turso` 의존성 설치 추가(`--ignore-scripts`). `tests/test_turso_mirror_rollout.py`에 순서/설치 회귀 방지 검사 추가. 기존 `deploy=false`, `confirm_mirror_off`, `confirm_full_mirror` 배포 승인 게이트와 Worker 설정/발급기/DB 동작은 변경하지 않음.
- **로컬 검증:** Collector Node **69/69** PASS, Python 수동 배포 보호 **3/3** PASS, 배포 Workflow YAML 구문·`git diff --check` PASS, Collector Wrangler **`deploy --dry-run` 성공**(`TURSO_MIRROR_ENABLED=false` 보존). GitHub PR CI는 별도 확인. 실제 운영 Worker 배포·Secret 변경·KIS 호출·원격 DB 접근은 미실행.
- **다음:** 수정 PR 병합 및 GitHub CI 확인 → [Collector 수동 검증](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/workflows/blue_r142_collector_deploy.yml)의 `deploy=false`로 재실행 → 기존 Turso 미러 운영 상태 확인 후 **별도 승인** 전에는 `deploy=true` 금지. 그 후 정규장에서 KIS 잠정 일봉 제한 파일럿을 검증. 분봉은 정밀분석 시 온디맨드 조회로 보류.

## 2026-11-19 (KST) — KIS 잠정 일봉 코드 준비 / 정밀분석 분봉 보류

- **사용자 결정:** 확정 KRX 일봉이 준비되기 전에도 KIS의 미완성 당일 OHLCV를 받아서 사용한다. 반면 5/10/30분봉은 **정밀분석에서 종목을 지정한 시점에 수집**하는 미래 기능으로 미루며 이번 변경에서 구현/수집하지 않는다.
- **개발:** `collector/src/turso-provisional.mjs`에 Turso의 마지막 감사 완료 전일 KRX EOD 목록 기반 장중(09:00~15:20 KST) **최대 10종목/분** 순환 조회와 유효한 **기존** Turso 암호화 KIS 토큰 조회 추가. 기존 Turso 시세 최신·이력과 독립된 `blue_kis_provisional_daily_v1`에 잠정 관측 저장, `is_confirmed_daily=false`·KIS 원천/거래일 추정 여부 기록. KRX EOD/감사/연구 신호는 그대로 유지. 기존 Turso 연구 신호 수집과 동시 실행하지 않도록 Collector 분기. 안전한 기본 비활성·15/30분 자동 만료 파일럿/긴급 정지 및 무시크릿 CI 회귀 추가. 실제 운영 변수/Secrets/DB/KIS는 변경하지 않음.
- **검증:** Collector Node **69/69** 통과, Wrangler `deploy --dry-run`에서 `TURSO_MIRROR_ENABLED=false` 확인, 파일럿 Workflow YAML 구문 및 `git diff --check` 통과. GitHub Actions/PR CI는 게시 후 별도 확인. **운영 배포 및 원격 수집 미실행**.
- **다음:** PR 병합·CI → 기존 Collector 배포 위험(`TURSO_MIRROR_ENABLED=false`) 확인 → 별도 배포 승인 → 주식 정규장에서 시간제한 파일럿 승인/상태 감사 → 잠정 일봉 실제 표출/시장 커버리지 검증. 이후 잠정 기반 기술 패턴 검색과 정밀분석 온디맨드 5/10/30분봉을 분리 개발한다.

## 2026-11-19 (KST) — 감사 #44500952883 성공 / Turso 연구 신호 일별 누적 워크플로 PR 준비

- **실제 운영 증거:** [Turso Primary Readiness #44500952883](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44500952883) `turso_recent` 실행 성공. `RECENT_TURSO_COUNTS_MATCH`, 최근 EOD 감사 8거래일 모두 원장 수와 실제 행 수 일치(11/18 2660/2660, 11/17 2661/2661 등), 연구 신호는 11/18 **189/189건 한 날짜**, 최근 KIS 시세는 11/19 **2종목**. Turso SELECT 3회, D1 SQL 0회. **D1 전체와의 동일성·과거 이관/실시간 전체 시세 증명이 아님.**
- **이유:** 검색 화면과 패턴 필터·차트의 Turso 읽기 API는 이미 구현되어 있으나 Turso 감사 완료 연구 날짜가 1일에 그쳐 실제 과거/기간 검색 활용도가 낮음. 검증한 일봉을 바탕으로 동일 R1.1 연구 산출물을 매일 누적하도록 코드 준비. UI 변경 없음.
- **안전 구현:** `.github/workflows/blue_turso_daily_research.yml`에 평일 20:15 KST 예약 경로와 수동 `trade_day`, `dry_run`(기본), `apply`(정확한 `blue-turso-research-only` 확인) 추가. 예약은 `BLUE_TURSO_RESEARCH_AUTO_ENABLED=true` 변수 없으면 실행 안 함. `scripts/turso_research_day_guard.py`가 한국 날짜/미래·주말/기준 브랜치/승인 문자열을 검사, 이전 날짜로 자동 대체하지 않음. 기존 R1.1 전체 시장 스캔 → 동일 신호/차트 export → 기존 엄격한 Turso 감사 EOD·종가 교차 검증, 해시 충돌 거부·멱등 read-back writer를 재사용. **D1 조회·KIS tokenP·Worker/PWA 배포 포함 안 함.**
- **재실행 해시 안정화:** 기존 R1.1 `AUDIT.json`의 `source_verified_at_kst`가 달라지는 것만으로 Turso 원장 충돌이 발생하지 않도록, 새 export의 `source_audit_sha256`는 해당 단일 시각 필드만 제외한 정렬 JSON의 SHA256으로 계산. 원본 AUDIT 파일은 보존; 종가·원천 해시 등 변동은 여전히 감지. 기존에 저장된 11/18 원장과는 형식이 다를 수 있으므로 과거 날짜 재실행 충돌은 자동 무시/덮어쓰기 하지 않음.
- **문서/테스트:** `docs/TURSO_DAILY_RESEARCH_RUNBOOK.md`와 무시크릿 PR CI 추가. 로컬 Python 새 guard **5/5**, 신호 export **6/6**, 기존 Turso 워크플로 회귀 **5/5**, Node 신호 importer+Primary Readiness **9/9**, 신규 Workflow YAML 2개 구문 검사 및 `git diff --check` 성공. [잔여 D1 의존성](TURSO_PRIMARY_DEPENDENCY_INVENTORY.md)에는 과거 원본/장바구니/AI 등 미완료 영역 유지. GitHub PR CI/운영 원격 실행은 별도 검증 전까지 미확인.
- **배포:** 해당 기록 시점 **GitHub PR/병합/운영 자동 변수 설정/원격 DB 쓰기 없음**. 수동 dry-run → 동일 날짜 EOD 감사 확인 → 수동 apply → readiness와 PWA 확인 → 필요할 때만 예약 변수 활성화 순서. 다음 별도 우선 과제는 Turso 독립 KIS 장중 1종목 실제 조회와 서버 장바구니 watch 이관.

## 2026-11-19 (KST) — Turso 주 DB 전환을 위한 D1 잔존 의존성 목록·안전 감사 PR 준비

- **사용자 결정:** D1 중심 KIS 시세 미러가 최종 목표(Turso 주 DB, D1 보조)에 어긋난다는 지적. 과거 D1의 중요한 업무 데이터를 삭제하지 않고, D1 후보·큐에 의존하는 구형 미러는 확대하지 않음.
- **안전 변경:** `collector/wrangler.jsonc`의 `TURSO_MIRROR_ENABLED` 기본값을 `true`→`false`로 되돌림. 기존 파일럿/긴급 정지 로직과 명시적 정식 미러 배포 확인 게이트는 보존. Turso 독립 Cron/즉시 KIS 조회의 플래그는 기본 OFF 유지. **기존 운영 Worker 배포 상태/Secret을 읽거나 변경하지 않음.**
- **운영 중단 방지 추가:** OFF 설정을 실제 배포할 경우 이전에 실행 중이던 구형 Turso 시세 복제가 끊길 수 있으므로 Collector 수동 deploy 워크플로에 `confirm_mirror_off=blue-turso-mirror-off`라는 별도 승인 게이트를 추가. 기존 FULL 모드 승인과 분리하며 둘 다 기본 빈 값. Turso 독립 장중 시세 검증 완료 전에는 운영 배포 금지.
- **데이터 목록:** `docs/TURSO_PRIMARY_DEPENDENCY_INVENTORY.md`에 D1 과거 신호·차트, 장바구니 서버 추적, AI/분석 요청·종목 추적/큐, KIS 보조 토큰 원장을 코드 사용처와 함께 기록. Turso에 옮겨진 영역과 아직 완전 이관이 입증되지 않은 영역 구분.
- **새 수동 감사:** `blue_turso_primary_readiness.yml`의 기본 `plan`은 DB 호출 0, `turso_recent`은 Turso 감사 완료 EOD/연구 8거래일 이내의 기대/실제 개수 및 7일 중 KIS 최신가 최대 3일의 집계만 SELECT. D1 SQL/Cloudflare API 자격 정보/KIS 호출/외부 쓰기는 포함하지 않음. 이것은 **과거 데이터 전량 이관 증명이나 D1 대비 동등성 감사가 아님**.
- **로컬 검증:** Collector **61/61**, 신규 readiness+기존 Turso 감사 Node **16/16**, Python mirror 보호 **3/3** 및 D1 cutover **10/10**, `node tools/turso/primary-readiness-audit.mjs`의 `PLAN_ONLY`(Turso/D1 SQL 0회), Wrangler Collector `--dry-run` 바인딩 `TURSO_MIRROR_ENABLED="false"`, YAML 구문·`git diff --check` 성공. 원격 Turso/D1/KIS 호출, Secret 변경, 운영 배포는 하지 않음. PR CI는 별도 확인.
- **다음:** PR CI 확인·사용자 병합 → 수동 `plan`/`turso_recent` 순서로 실제 Turso 집계 검증 → 사용자 승인 하에 Collector 전체 미러 OFF 상태에서 장중 Turso 독립 1종목 시세 실증 → 서버 장바구니 watch 및 과거 신호 자료의 Turso 이관을 개별 PR로 순차 진행. D1 원본 삭제 금지.

## 2026-11-19 (KST) — D1 중단과 관계없는 KIS 즉시조회 및 모바일 검색 단순화 PR 준비

- **요청:** D1 무료 일일 사용량 제한을 24시간 기다리지 않고 Turso 독립 경로로 운영할 수 있게 하고, 사용자가 종목별 **KIS 최신가 조회** 버튼을 눌러 즉시 조회하도록 개발. 별도로 모바일 검색 화면에 새로 생긴 `기술 패턴 찾기` / `확정 일봉 전체` 대형 버튼과 긴 데이터 설명은 혼란스럽다는 피드백을 반영.
- **구현:** `collector/src/turso-direct.mjs`의 새로운 `collectTursoInstant`는 검증·감사된 이전 Turso KRX 일봉을 종목 기준값으로 사용하고 **Turso 암호화 금고의 기존 유효 KIS 토큰만** 읽어 KIS REST 1회 호출·응답 검증 뒤 Turso 최신가/이력 테이블에 함께 기록. D1 DB/발급기/큐에 접근하지 않음. 토큰이 만료·누락되어도 **새 tokenP 발급하지 않음**. Cloudflare Collector 서비스 바인딩을 통해서만 호출하고 HTTP API는 `Origin` + Access 인증 후에만 전달. 종목별 20초, 전체 분당 12회 원자적 Turso 제한. `TURSO_INSTANT_QUOTES_ENABLED` Worker Secret 기본 OFF이며 수동 확인 workflow로만 활성화.
- **PWA:** 기술 패턴 검색은 그대로 기본 화면. 두 개의 큰 모드 버튼을 없애고 `전체 종목 보기`를 보조 링크로 축소, 긴 Turso/D1 설명은 `분석 데이터 안내`의 접힌 세부 안내로 이동. 기존 확정 일봉 전체 조회·복귀 경로, 날짜/기술 조건, D1 보조 분석, 장바구니/다른 탭 보존. Turso 모드의 `KIS 최신가 조회`는 새 POST에 성공하면 Turso 시세만 다시 읽으며 **D1 한도 오류 시 신규 D1 요청을 만들지 않음**. 검증 가격과 실제 수신 시각은 별도 안내하고 KIS REST 스냅샷을 거래소 체결/실시간 스트리밍으로 표시하지 않음.
- **테스트:** `collector/test/turso-instant.test.mjs`, `tests/test_turso_instant_api.mjs`, `tests/test_turso_basket_browser.mjs`에 비활성·장외·토큰 없음·요청 제한·인증·저장·Turso 실패 시 D1 미호출 회귀 추가. 전체 Collector **61/61**, 관련 browser/API **53/53**, 웹 TypeScript+Vite 빌드, Collector/API Wrangler `--dry-run` 모두 성공. PR 후 GitHub CI는 별도 확인.
- **운영:** 실제 시세 KIS 호출/토큰 발급/원격 Turso·D1 SQL/Cloudflare 설정/Worker·PWA 배포 **아직 없음**. 마지막 단일 토큰 발급 #44469823869은 2026-11-20 15:07:25 KST 만료 예정이며 별도 토큰 관리자가 보호 정책에 따라 갱신. 지난 `turso_only` 감사 #44485333770은 Turso 6개 샘플 성공 증거이고 이번 즉시조회 실가동 증거는 아님.
- **다음:** PR CI → 사용자 병합 → 현재 Collector `TURSO_MIRROR_ENABLED=true`의 **full-mirror 배포 보호 확인** 및 별도 명시적 운영 승인 → Collector/API/PWA 수동 배포 → 장중 1종목만 인증·토큰·KIS 가격 및 Turso 저장/조회 시험 → `TURSO_INSTANT_QUOTES_ENABLED` 수동 enable → 분당/종목별 제한 및 D1 쓰기 백업·정합 재처리는 후속 안전 단계로 검증. 기존 코드만으로 Turso에서 D1에 모든 신규 시세를 자동 복제한다고 주장하지 않음.

## 2026-11-19 (KST) — 실토큰 복구·2종목 미러링 검증 후 정식 이중 저장 PR 준비

- **운영에서 실제 확인된 상태:** 읽기 전용 조기 감사 [#44465868952](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44465868952)는 `EARLY_READY_FOR_MANUAL_REVIEW`, `early_cutover_ready=true`. 사용자 외부 발급 부재 확인 후 [단일 발급 #44469823869](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44469823869)에서 `TOKEN_SAVED_DUAL`(하나의 토큰을 Turso·D1에 암호화 저장, 만료 2026-11-20 15:07 KST). **재발급 금지**. [D1 시세 감사 #44471939334](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44471939334)에서는 신규 토큰 이후 D1 수집 `PARTIAL_QUOTES` 24시도/17저장/7거절 및 11/19 저장 스냅샷 17종목 확인.
- **Turso 증거:** [30분 제한 파일럿 #44472224119](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44472224119) 시작·자동 종료 15:57 KST. [Turso 상태 #44475510723](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44475510723)에서 11/19 종목 2개·시세 이력 6행·최근 수신 15:51 KST 확인. 이것은 **미러 경로 작동 증거**이지 D1/Turso 정확한 행 일치 또는 전체 종목 복제 증거는 아님.
- **별도 기존 GitHub 시세조회 오류:** [#44474905492](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44474905492) `TOKEN_VAULT_DECRYPT_FAILED`. 새 Node 발급기의 Base64URL 암호문은 `=` 패딩이 없는데 기존 Python 복호화기는 패딩을 요구함을 가짜 토큰으로 재현하고, 양쪽 포맷 수용으로 고침. 실토큰 조회/발급 없이 Node→Python 가짜 암호문 교차 검증 통과.
- **이번 코드:** `collector/wrangler.jsonc`의 `TURSO_MIRROR_ENABLED=true`를 **정식 배포 후보로만** 설정(병합해도 자동 Worker 배포 없음). 기존 `blue_r142_collector_deploy.yml`은 `deploy=true` 외에 별도 `confirm_full_mirror=blue-turso-full-mirror` 없이 정식 배포를 차단. `TURSO_MIRROR_PAUSED` 비밀값으로 전체/파일럿 미러를 즉시 끌 수 있고, 별도 수동 Emergency Workflow는 기본 dry-run/승인 후 pause·resume만 가능. 기존 D1 시세 수집·저장, 비밀값 및 tokenP 발급 정책 변경 없음.
- **새 읽기 전용 정합성 감사:** `blue_turso_quote_parity_audit.yml` 기본 `turso_only`는 Turso 이력 최대 6건만 조회. `compare_small`은 `confirm_d1_read=blue-d1-bounded-read` 명시 시에만 같은 `(거래일,시장,코드,수신시각)` 키로 D1 **정확히 최대 6건**을 조회해 가격·누적거래량·시장단계를 비교. D1 Free 한도에 막힌 경우 성공 처리하지 않고 원문/토큰/SQL을 로그에 출력하지 않음. **원격 정합성 감사 미실행**이며 누락 재전송·전체 자료 동기화는 아직 없음.
- **로컬 검증:** Collector **55/55**, Python KIS 계열 **69/69**, 신규 무시크릿 정합성 감사 **6/6**, Workflow YAML 파싱 및 Worker Wrangler `--dry-run` (FULL 바인딩) 통과, Node→Python 가짜 암호문 호환 검증 및 `git diff --check` 통과. **실제 운영 full mirror 배포/원격 D1·Turso 쿼리/KIS 재발급은 수행하지 않음.**
- **병합 후 다음:** 새 감사 `turso_only` → D1 무료 한도 정상 시 `compare_small` 수동 승인 후 11/19 시험 이력 6건 일치 여부 검증 → 결과·쓰기량 확인 후 명시적 승인으로 Collector `deploy=true`, `confirm_full_mirror=blue-turso-full-mirror` → Turso 저장 수치/시각 재검증 및 별도 R1.4.1 Python cache-only 실행 확인. D1 쓰기 실패 시 Turso 경로가 살아도 D1 후보 조회 전체 장애에서는 여전히 수집 불완전. 장기 누락 재처리와 D1 독립 수집기는 별개 후속 개발.

## 2026-11-19 (KST) — 만료된 KIS 토큰의 조기 복구 안전 예외 (PR 준비)

- **사용자 결정:** 11/20 11:23 KST까지 일률적으로 기다려 최신 시세가 중단되는 상황보다는, 제공처 마지막 발급이 24시간 이상 전임을 검증한 뒤 **가능하면 조기 복구**. 읽기 전용 감사 #44444330961 `paused=true`, `pause_at_utc=2026-11-19T02:23:04.174Z`, `last_attempt_status=SAVED`, `last_saved_at_utc=2026-11-17T07:20:08.600Z`, `WAIT_24H_SINCE_D1_PAUSED`. D1 마지막 check #44438538538 `TOKEN_EXPIRED_ELIGIBLE`; **감사 이후 외부 수동 tokenP 부재는 이 증거만으로 입증할 수 없음**.
- **구현:** 기본 24시간 pause 보호는 유지. 운영자가 `BLUE_KIS_EARLY_CUTOVER_APPROVED=true`로 외부 발급 부재를 명시 확인하고 `workflow_dispatch`에서 조기 허용·정확한 확인 문자열을 선택한 경우에만, Turso 발급기 직전에 D1 마지막 저장·발급 시도·성공 시각 및 완료 상태 `SAVED`를 읽기 전용 재검증. 중단 이후 D1 활동, 최근 발급, 발급 불확실, D1 조회 불가라면 fail-closed. 일반 예약 실행에는 조기 예외를 전달하지 않음.
- **읽기 전용 감사 확장:** `scripts/blue_kis_cutover_audit.py`에서 일반 `cutover_ready`와 별도로 `early_cutover_ready`와 `EARLY_READY_FOR_MANUAL_REVIEW`를 보고하도록 추가. `.github/workflows/blue_kis_cutover_audit.yml`은 조기 승인 저장소 변수도 **읽기 전용으로 전달**. 두 조건을 혼동하지 않고 토큰 비밀값/암호문 조회 없음.
- **로컬 검증:** Node 토큰/Collector 관련 **39/39**, Python 읽기 전용 감사 **10/10**, 기존 D1 발급 **18/18**, 금고 **6/6** 통과. GitHub Actions YAML 파싱 성공. Collector 소스나 Worker 설정은 변경하지 않음. **이 작업 중 실제 KIS tokenP, 원격 DB 쓰기/조회, GitHub 운영 변수 변경/Worker 배포는 실행하지 않음.** PR CI 결과 및 원격 감사는 병합 후 별도 확인 필요.
- **다음:** PR CI 성공 및 사용자 병합 → 외부/수동 KIS 발급 부재를 운영자가 확인 → GitHub 변수 승인 → 수동 **읽기 전용 감사**에서 `EARLY_READY_FOR_MANUAL_REVIEW` 확인 → 별도 **사용자 운영 승인**으로 수동 단일 `issue` → Turso/D1 `TOKEN_SAVED_DUAL`·Collector 장중 시세 확인. 안전 증거가 불충분하면 기존 11/20 11:23 KST 대기 절차 유지.

## 2026-11-19 (KST) — KIS 토큰 1회 발급·Turso/D1 이중 금고·안전 폴백 코드

- **사용자 확정:** 동일 KIS 토큰을 Turso와 D1에 암호화하여 함께 보관. KIS `tokenP`는 오직 단일 발급기에서 요청하며 구 D1 발급기는 계속 중단. 주가 데이터의 최종 Turso 주 DB/D1 보조 DB 동시 저장·복구 목표는 유지하며, 이번 토큰 PR과 별개 후속 작업.
- **변경:** `tools/turso/kis-token-steward.mjs` 단일 issuer에 이중 금고 필수 플래그·D1 복제·신규 tokenP 없는 `mode=sync`·Turso 저장 후 D1 실패 복구·Turso 금고 누락 시 D1 검사·유효 토큰 복원 추가. `tools/turso/d1-token-backup.mjs`에서 기존 Cloudflare D1 API/암호화 금고를 재사용해 별도 nonce의 동일 토큰 저장, 타임스탬프 비역행, 실제 복호화 read-back 확인. Collector는 기본 Turso 토큰을 쓰고 명시적 Worker 플래그일 때만 D1 암호화 금고로 유효 토큰 폴백. 부패된 Turso 금고의 무조건 폴백 금지.
- **워크플로:** `.github/workflows/blue_turso_kis_token_steward.yml`은 `check/sync/issue`를 지원하고 `sync/issue`에는 기존 24시간 감사·사용자 승인과 새 GitHub `BLUE_KIS_DUAL_VAULT_ENABLED=true`가 필수. 토큰 저장 실패 시 같은 발급을 반복하지 않고 `D1_SYNC_PENDING`의 복제만 다시 시도. 새 Node 테스트 경로는 무시크릿 `.github/workflows/blue_turso_direct_ci.yml`에 포함.
- **로컬 검증:** 관련 Node 단위 테스트 **34/34 통과**(1회 발급, 동일 토큰 이중 보관, 한쪽 DB 장애 후 재발급 방지, 기존 D1 토큰 복원, 잘못된 금고 거부, 기본 비활성), 기존 Python D1 vault **6/6**, 일일 발급 **18/18**, 안전 감사 **9/9** 통과. Collector Wrangler `npm run build:check`의 `--dry-run` 번들 및 D1 바인딩 확인. 실제 KIS 발급/원격 D1·Turso SQL/운영 배포 없음.
- **운영 미완료:** 사용자 PR 병합과 CI 확인 후에도 기존 `BLUE_KIS_TOKEN_AUTO_PAUSED=true` 중단을 유지한다. 2026-11-20 11:23 KST 이후 읽기 전용 감사·외부 발급 부재·수동 승인 전 `issue` 불가. GitHub 변수와 Worker 플래그는 각각 별도로 승인/활성화해야 한다. Turso 전체 장애에서 tokenP 재발급까지 보장하는 독립 원장, 그리고 주가 Turso→D1 완전 자동 복제·누락 재처리는 **이 PR에 미포함**.

## 2026-11-19 (KST) — D1 대기 중 Turso 우선 장바구니 연구 증거 읽기 개선

- **운영 선행 확인:** [안전 감사 #44444330961](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44444330961)에서 `paused=true`, `pause_at_utc=2026-11-19T02:23:04.174Z`, `WAIT_24H_SINCE_D1_PAUSED` 확인. **2026-11-20 11:23:04 KST 이전 Turso 토큰 발급 금지.** 다음 재감사는 기존 수동 `blue_kis_cutover_audit.yml`에서 실행.
- **코드 변경:** 브라우저 `web/src/turso-research-reader.ts`에 검증된 Turso `/api/research/chart`, `/api/research/search` **우선 읽기** 추가. 장바구니 손절선·발견일 매물대 및 과거 패턴 근거는 감사 완료 Turso 기록이 존재하면 D1 호출 없이 이용하고, 이전 Turso에 미이관된 날짜/가용성 오류에서만 기존 D1 조회를 보조 사용. Turso 유효한 빈 검색 결과는 D1로 대체하지 않고, 비정상 차트·401/403은 안전하게 실패. 저장된 발견가·메모·차트·성과 근거는 덮어쓰지 않음.
- **로컬 검증:** `node --test tests/test_turso_research_reader.mjs tests/test_turso_basket_browser.mjs tests/test_turso_basket_prices.mjs` **23/23 통과**, `web` TypeScript+Vite `npm run build` 성공, `git diff --check` 이상 없음. 새 무시크릿 PR CI `.github/workflows/blue_turso_web_readonly_ci.yml`에서 동일 회귀 검사를 반복. 실제 원격 D1/Turso SQL, KIS 발급·시세 수집, Worker/PWA 배포, DB 변경은 **실행하지 않음**.
- **미해결/다음:** 장바구니 `POST/GET /api/basket/watch` 및 AI·추적은 여전히 D1 의존. 예전 날짜 전체 연구 자료는 Turso에 없을 수 있고, 해당 날짜 D1 보조 읽기는 한도 차단 시 실패. 이 PR만으로 **앱 전체 D1 독립 또는 최신 시세 수집 성공**을 주장하지 않음. 사용자 병합/웹 배포 후 실제 Turso 자료가 있는 날짜의 손절선·매물대·패턴 표시를 확인하고, 다음 별도 PR에서 D1 watch 읽기와 등록 경로를 분리.


## 2026-11-19 (KST) — Turso 전환용 D1 발급 중단·최종 발급 시각 읽기 전용 감사

- **사용자 결정:** D1 의존 시세 수집에서 Turso 독립 경로로 안전하게 전환 준비. 실제 D1 issuer 중단 여부·최후 토큰 발급 기록·24시간 대기 충족을 검증하기 전 Turso 토큰을 발급하지 않음.
- **마지막 발급 증빙:** [Actions #44037861051](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44037861051)의 `TOKEN_SAVED`(2026-11-17 07:20:09 UTC, 16:20 KST), 만료 2026-11-18 07:20:08 UTC. [D1 check #44438538538](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44438538538)은 `TOKEN_EXPIRED_ELIGIBLE`. [예약 실행 #44345601488](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44345601488)이 11/19 01:18 KST에 실제 수행되어 적어도 당시 D1 자동 중단은 아니었음. **현재 저장소 변수 상태는 외부 API 접근 제한으로 확인 불가**, 24시간 전환 대기 시작은 미확인.
- **코드 준비:** 새 `scripts/blue_kis_cutover_audit.py`, `.github/workflows/blue_kis_cutover_audit.yml`: D1 금고의 저장/만료 시각과 발급 상태표의 최근 발급 시도 및 성공 시각만 SELECT, 저장소 중단/승인 변수와 실제 중단 UTC 시각 비교, 24시간 충족 여부를 고정 상태 코드로 출력. 토큰·암호문·앱 시크릿 조회 및 KIS tokenP 호출 없음. DB 읽기 실패·자료/변수 부재 시 안전하게 불합격.
- **수동 발급 차단:** `BLUE_KIS_TOKEN_AUTO_PAUSED=true`면 D1 예약뿐 아니라 `blue_kis_daily_token_r1597.yml`의 수동 `mode=issue`도 거부하도록 추가. 기존 `mode=check`는 유지. 별도 R1.3 연구 워크플로의 `allow_new_token=true`는 기존부터 차단.
- **검증/상태:** [PR #35](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/pull/35), [자동 CI #44440422930](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44440422930)에서 Python D1 token vault/자동갱신/감사 테스트, Node Turso 수집·토큰 테스트, Wrangler dry-run 모두 성공. PR 병합·원격 감사 실행·실시간 변수 값 조회·D1 발급 중단·Turso 새 발급은 아직 시행하지 않음.
- **다음:** 안전 CI 확인 → 사용자 PR 병합 → GitHub Repo Variables에서 `BLUE_KIS_TOKEN_AUTO_PAUSED=true` 실제 설정/시각 기록 → 감사 Actions `READY_FOR_MANUAL_REVIEW` 확인(중단 후 24시간 경과까지는 `WAIT...`) → 별도 승인으로 Turso issuer enable 및 파일럿 → KIS 시세 저장 관측 확인.

## 2026-11-19 (KST) — GitHub Actions 예약 지연 시 D1 토큰 점검 누락 보완

- **병합 확인:** [PR #33](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/pull/33)은 11월 19일 KST 10:30 병합. [CI #44437369022](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44437369022)에서 Python D1 테스트, Node Turso 테스트, Wrangler dry-run까지 모두 통과. 실제 tokenP/시세 수집/운영 DB 변경은 수행하지 않음.
- **새 발견:** [D1 Token Steward 예약 실행 #44345601488](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44345601488)이 KST **01:18**에 완료됐지만, `OUTSIDE_SCHEDULED_KST_WINDOW`를 출력해 토큰 상태를 조회하거나 갱신하지 않았음. 따라서 PR #33의 06:00 예약 추가만으로는 GitHub 예약 지연 시 점검 누락을 해결하지 못함.
- **보완:** D1 스크립트의 추가적인 실제 시작 시각(시계) 차단 로직을 제거. GitHub cron이 *의도한 예약 시각*을 정하고, 늦게 시작했더라도 DB의 24시간/KST-day 원자적 발급 상태표와 암호화 금고가 발급 제한을 책임짐. 긴급 정지 `BLUE_KIS_TOKEN_AUTO_PAUSED`는 그대로 유지. 기존 `--scheduled` 인자는 호환성을 위해 유지.
- **검증:** 지연된 01:18 KST 실행을 재현한 회귀 테스트 추가. CI 결과·새 토큰 발급·운영 상태는 별도 확인 필요.
- **다음:** PR 테스트 성공 후 사용자 병합. **운영 D1 토큰 점검 로그를 `R1597_RESULT`로 확인**하고, Turso 전환은 기존 중단 후 24시간 보호 절차를 별도로 진행.

## 2026-11-19 (KST) — KIS 접근토큰 06:00 자동 점검·제한 복구 PR 준비

- **요청:** KIS 접근토큰이 24시간 후 만료되어 시세 수집이 중단되는 상황에 대비해 매일 06:00 KST 자동 점검, 만료 임박 시 갱신, 발급 실패 후 안전한 재시도를 구현. GitHub Secrets의 `KIS_APP_KEY`/`KIS_APP_SECRET`은 장기 자격 증명이고 토큰은 D1/Turso의 별도 암호화 금고에 보관.
- **원인 증빙:** [Turso Token Steward Actions #44434674813](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44434674813)의 `check` 실행은 성공했지만 결과는 `TOKEN_MISSING_OR_EXPIRED`. 이 결과로는 만료인지 미발급인지 구분 불가. 기존 D1 관리자는 08:00~19:30 KST 점검, Turso 관리자는 08:10/12:10/16:10 KST 점검으로 06:00 일정이 없었음. [PR #32](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/pull/32) 영문 혼합 코드 버그 수정은 11/19 10:05 KST 병합 완료.
- **코드 변경:** `blue_kis_daily_token_r1597.yml` 및 `blue_turso_kis_token_steward.yml`를 06:00/06:30 매일 예약하고 영업일에만 07:00~19:30까지 30분 간격으로 추가 확인. 두 토큰 매니저에서 만료 1시간 전부터 안전하게 재발급 필요성 검사, 유효하면 재사용, 최근 저장 24시간 보호. 제공처 요청 실패는 동일 KST 일자·30분 이후 **최대 한 번** 추가 요청(일일 최대 두 시도), 다시 실패하면 추가 자동 재시도 금지. 저장 실패·메타데이터 오류는 자동 재시도 금지. 기존 두 발급기가 동시에 켜지지 않도록 Turso cutover 보호 변수 유지.
- **검증:** Python D1 단위 테스트와 Node Turso 단위 테스트 및 Actions 예약 경로 회귀 테스트 추가. PR CI 성공/실배포/토큰 발급 여부는 후속 로그 확인 전까지 미확인. 새 KIS 토큰 발급, D1 중단, Turso 파일럿, 운영 DB 변경은 이번 작업에서 실행하지 않음.
- **다음:** PR CI 확인 → 사용자 병합 → 기존 D1 자동 발급 워크플로에서 다음 예약 점검 확인 → 기존 D1 issuer 중단을 실제로 증명하고 24시간 대기 후에만 Turso 전환 승인·발급 → 15분 KIS 파일럿과 실제 Turso 저장 행 수 검사.

## 2026-11-19 (KST) — D1 독립 KIS→Turso 장중 시세 수집 파일럿 준비

- [PR #30](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/pull/30) 병합 확인. Turso 일봉 예약 적재는 18:35 KST 기준이며 실제 당일 수집 성공 여부는 별도 Actions 로그 확인이 필요.
- 신규 `collector/src/turso-direct.mjs`: D1 의존 없이 Turso 감사 완료 최신 연구 신호 종목을 5분 틱마다 최대 12개씩 순환 선택, 기존 KIS REST 응답 검증 후 Turso 최신시세/이력 테이블에 저장. 기존 레거시 D1 Cron과 독립된 `waitUntil`. 기본 비활성, 시간제한 파일럿으로만 테스트.
- 신규 `tools/turso/kis-token-steward.mjs`: Turso에 암호화된 KIS 토큰 보관 및 24시간·한국 날짜별 발급 시도 제한. **기존 D1 토큰 발급을 최소 24시간 중단했다는 운영 확인이 있어야 발급** 가능. 서로 독립된 토큰 발급 관리자 동시 실행 금지. GitHub 변수 `BLUE_KIS_TOKEN_AUTO_PAUSED`, `BLUE_KIS_D1_DISABLED_AT_UTC`, `BLUE_KIS_TURSO_CUTOVER_APPROVED` 보호 조건.
- 사용 안내: `docs/TURSO_DIRECT_KIS_CUTOVER.md`. 테스트는 CI 워크플로 및 별도 파일럿으로 검증 예정; 아직 실제 KIS 운용이나 D1 독립 5분 실시간 가격 확보가 입증된 것은 아님.
- 189개 종목을 12개/5분으로 순환하면 각 종목의 갱신 간격은 약 80분이며, **전체 종목 5분 실시간 갱신이 아님**. 관심 종목 우선수집은 이후 단계.

## 2026-11-19 (KST) — Turso 패턴 검색의 최근 시세 D1 잔여 의존 수정 PR

- **사용자 확인:** [PR #28](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/pull/28) 병합 후 API 검증 [#44358312734](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44358312734), API 배포 [#44358544419](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44358544419), 웹 배포 [#44358717880](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44358717880) 성공. 사용자가 Turso 패턴 검색·차트는 정상 표시됨을 확인했으나 검색 결과 **최근시세는 안 나옴**을 보고.
- **원인:** `web/src/main.tsx`의 패턴 결과 가격 비교 효과와 종목별 수동 갱신 버튼은 기존 D1 전용 `/api/prices/compare` 및 D1 수집 큐를 계속 호출. Turso 검색/차트만 전환된 상태에서 가격은 D1 장애의 영향을 받음.
- **수정:** Turso 패턴 검색에는 검증된 Turso `/api/eod/prices/compare` 우선 읽기(`fetchComparedTursoFirst`)를 연결. D1 패턴 보기 모드에서는 기존 비교/서버 수집 요청 유지. Turso 모드의 종목별 버튼은 신규 KIS 수집이 아닌 저장 관측 자료 **재조회**로 명시하고 D1 큐 호출 금지. 영문 혼합 여섯 자리 종목코드 비교 허용 및 테스트 추가.
- **중요한 한계:** 11월 18일 발견 신호의 경우 11월 19일 후속 일봉·검증 KIS 저장 시세가 없다면 `NO_LATER_PRICE`가 정상. 검색일의 종가를 최근가로 승격하지 않음. 장중 실시간 KIS 호출 기능을 추가한 것은 아님. 배포 전 코드 검증 결과를 별도로 기록해야 함.

## 2026-11-19 (KST) — Turso 감사 연구 신호 직접 검색·차트, D1 보조 읽기 PR

- **실제 전 단계 증빙:** [GitHub Actions #44351153148](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44351153148)에서 `BLUE_TURSO_SIGNAL_SNAPSHOT_OK day=2026-11-18 records=189 written=189` 확인. **2026-11-18 하루의 189개 신호**가 Turso에서 검증 저장된 것이며 이전 날짜 전체 이관·D1 완전 복제·운영 읽기 배포 성공을 의미하지 않음.
- **이번 API:** 새 `worker/src/turso-research.ts`의 읽기 전용 `/api/research/dates`, `/api/research/search`, `/api/research/chart`에서 Turso 연구 신호/차트 스냅샷과 날짜별 완료 감사를 직접 사용. DB 전체 개수·원본 파일 해시 일치를 확인하고 불완전하면 실패 처리; 검색어/코드/신호/골든크로스/112선·역배열 등의 기술 필터/거래대금/과거 패턴 승률/정렬/페이지네이션 지원. D1은 이 경로의 직접 또는 암묵적인 입력이 아님. 종목 상세 차트는 정확한 검색일의 Turso 기록만 출력하며 다른 날짜 차트로 대체하지 않음.
- **이번 PWA:** `기술 패턴 찾기`의 기본 조회는 Turso 직접 연구 API. 명시적 `D1 과거 자료 보기`와 Turso HTTP 5xx 시 기존 D1 보조 검색은 그대로 유지. 검색 스냅샷에는 근거 차트를 연결하고 이후 최고·최저가는 저장된 후속 감사 일봉 구간의 **부분 관측**임을 명시. 기존 Turso 전체 EOD 조회, D1 운영 자료, 장바구니·KIS 수집 경로 유지.
- **검증:** `node --test tests/test_turso_research_api.mjs` **8/8**, 웹 `npm --prefix web run build`, Worker `wrangler deploy --dry-run` 성공. 새 테스트를 수동 API 배포 Workflow 검사 단계에 추가. 실제 Turso 원격 검색/차트 HTTP 검증, Cloudflare Worker 및 웹 운영 배포, D1 장애 통합 검사는 **미실행**.
- **병합 후 수동 순서:** API 배포 Workflow `blue_turso_api_eod_deploy.yml`의 `verify_only` → `deploy_api`를 명시적으로 실행하고, 기존 웹 안전 배포 Workflow를 따로 실행. 휴대폰 `기술 패턴 찾기`에서 `2026-11-18`과 선택 종목 차트, D1 전환을 직접 확인. 더 오래된 날짜는 별도 감사 완료 Turso 데이터 적용 필요. KIS 장중 15분 파일럿은 별도 일정.

## 2026-11-19 (KST) — D1 장애에도 독립적으로 저장 가능한 Turso 연구 신호·차트 미러링 1단계

- **확인/결정:** 사용자 PR #26 기술 패턴 UI 복원은 이미 병합([PR #26](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/pull/26), merge `33e13bcd2ac9e89cd8ab26cbc53621aef0ac10e5`). D1 기반 패턴 검색으로는 D1 한도 초과 재발 시 서비스를 지킬 수 없음. 최종 우선순위는 Turso 주 DB/D1 보조 DB의 **동일한 검증 데이터 저장·복구 가능성**. 현재 둘은 아직 불완전하게 동기화되어 있으며 전환·자동 복구가 성공했다고 주장하지 않음.
- **이번 구현:** 기존 R1.1 EOD 스캐너가 생성하는 `signals.csv`/`chart_snapshots.jsonl`/`AUDIT.json`에서 `scripts/export_turso_signal_snapshot.py`가 D1 importer와 동일한 `pattern_highlights` 연구 규칙으로 날짜별 검색 신호·원래 180봉 차트·실제 과거 검증 통계를 JSONL/해시 manifest로 추출. 기존 D1 SQL 생성/원래 신호 정의는 변경하지 않음. `tools/turso/signal-snapshot-import.mjs`는 해당 날짜가 Turso 원본 EOD 감사에 존재하는지, 개별 신호 종가가 독립 감사 완료 KRX 종가와 일치하는지 검증. 기존 데이터 충돌을 **수정하지 않고 실패**, 부분 삽입 재실행·전량 read-back 확인 후에만 별도 `blue_research_signal_audit_v1` 완료 기록.
- **수동 워크플로:** `blue_market_scan_research_only.yml`에 `turso_signals_mode='off'|'dry_run'|'apply'` 입력. 기본 `off`, `dry_run`은 DB 연결/쓰기 없음, 명시 `apply`에만 Turso 행 삽입. 기존 `publish_to_d1` 옵션과 독립적으로 실행되어 D1 무료 한도에 영향을 받지 않음. 단, **같은 정확한 EOD 날짜가 Turso `blue_eod_ingest_audit_v1`에 먼저 있어야 저장 가능**하고, 두 모드를 모두 apply/publish했는지는 수동 실행 결과로 별도 확인해야 함.
- **검증:** Python 전체 회귀 **204/204** 통과(신규 4건 포함), Node 신규 **4/4** 통과(데이터 변조·미래 날짜·중복·EOD 종가 불일치·중복 재실행·기존값 충돌), GitHub Actions YAML 파싱/입력 문자열 확인 완료. 실제 KRX 데이터 다운로드·Turso 인증/삽입·D1 데이터 일치 확인 및 배포는 **미실행**.
- **미완료/다음:** PR 병합 후 기존 workflow에서 `asof_date=2026-11-18`, `publish_to_d1=false`, `turso_directory_mode=off`, `turso_signals_mode=dry_run`으로 우선 생성·검증. 해당 날짜 EOD가 Turso에 감사 완료 저장됐는지 확인 후 별도 사용자 명시 선택으로 `apply`; 수동 read-back/audit 완료 증빙 확인. 추가로 오래된 D1 runs/signals/chart snapshots 및 장바구니/추적의 역이관, 양 DB 지속 재시도 큐·정합성 검사, Turso 검색 API/앱 읽기 전환, 두 DB 장애 폴백을 별도 단계로 진행해야 실제 D1 독립 검색을 보장할 수 있음. 장중 KIS 파일럿은 기존대로 정규장에 별도 시행.

## 2026-11-19 (KST) — 검색 기본 화면을 기술 패턴 발굴로 복원 (웹 PR 준비)

- **사용자 요청:** 장외 KIS→Turso 15분 파일럿은 다음 거래시간에 진행. 현재 `검색`에 보이는 Turso 확정 일봉 2,660종목 전체 목록을 기본 화면에서 내리고, 기존 **BLUE20/30/40·ENV20/40 중심선·RSI/Slow Stoch/MACD GC·112/224일선·역배열·거래대금·과거 패턴** 검색을 복원.
- **변경:** `web/src/main.tsx`, `web/src/turso-eod-recovery.css`에 상단 `기술 패턴 찾기`(기본) / `확정 일봉 전체` 전환 추가. 기술 패턴은 기존 `/api/dates`와 `/api/search` 기반의 D1 분석 흐름·필터·날짜 검색·분석 요청/진행 확인을 그대로 사용. Turso 원본 일봉 목록은 두 번째 선택에서 기존 `/api/eod/search`로 조회하며 가격/장바구니 원본 우선순위 불변. 화면은 D1의 최근 분석 날짜·연결 오류를 분리해서 명시하고, 일봉 조회와 패턴 분석이 같은 DB 결과라는 오해를 막음.
- **기술적 한계:** Turso 저장 일봉은 8거래일 수준이어서 112/224일선, 시차 밴드, 과거 패턴 승률을 재현할 수 없음. 기본 패턴 화면을 보이게 하는 것은 Turso 신호 스캐너 이관/최신 검색 자동 갱신 완료를 의미하지 않으며, D1 Free 한도 또는 오래된 분석일에 따라 검색 제한이 남음.
- **검증:** 웹 TypeScript·Vite `npm run build` 성공. JS 번들 크기 경고는 기존 코드 분할 과제. 운영 DB SQL/Secrets/KIS 호출/Cloudflare 실배포 없음. 실제 휴대폰에서 두 검색 화면 전환 및 D1의 유효 신호 응답을 확인해야 함.
- **다음:** PR 병합 → 기존 `blue_web_r15110_static_safe_deploy.yml` 웹 검증/수동 배포 → PWA 새로고침/재실행, 패턴 검색·Turso 일봉·장바구니 보존 확인 → 후속 별도 PR에서 검증된 250거래일 가격 이력 또는 EOD 연구 신호 스냅샷의 Turso 단계적 이관. 다음 거래시간에만 KIS 소량 미러링 파일럿 별도 진행.

## 2026-11-19 (KST) — 검증 KIS 시세 Turso 저장·장바구니 후속 읽기 (신규 PR 준비)

- **목적:** Turso 확정 일봉 읽기 성공 이후, 실장중 KIS 수집 시세를 Turso에 기록하고 장바구니의 최근가를 30초 재조회 시 자동 갱신할 수 있도록 **코드 경로** 준비. 기존 D1/로컬 장바구니 보존과 명확한 시세 출처가 우선.
- **수집 변경:** `collector/src/core.mjs`와 `basket.mjs`에서 검증된 KIS quote를 D1 기록 전에 별도 후크로 전달. `handler.mjs`는 매 5분 수집 틱에서 장바구니/스캔의 동일 `(거래일,시장,코드)`를 합쳐 **한 번만** Turso에 저장 요청. 기존 `turso-mirror.mjs` 스키마·멱등 UPSERT·최대 30분 자동 만료/파일럿 최대 2건·별도 OFF 기본값 유지. 따라서 **D1 쓰기만 실패한 상황**에도 이미 검증된 quote는 Turso에 도달할 수 있지만, D1의 후보 목록/토큰/등록 목록을 읽지 못하는 경우에는 여전히 수집 불가.
- **읽기 변경:** Access 보호된 `/api/eod/prices/compare`가 기존 감사 완료 KRX EOD와 Turso 저장 KIS 스냅샷을 독립 SELECT, 레코드 키/거래일/수신 UTC/KIS 원본 표시/가격 범위를 검증. 확정 EOD가 존재하는 날짜에는 EOD 종가·고가 우선, 그보다 이후 KIS 날짜에만 저장 시세를 최신가로 표시. 거래소 체결시각 미검증, 수집시각·시장과 `high_complete=false` 명시. 기존 D1 API 및 D1 장애 폴백·기기 로컬 저장소 불변.
- **회귀검증:** Collector **46/46** 테스트, Turso/API/브라우저 비교 **27/27** 테스트, 웹 Vite/TypeScript 빌드, Collector/API Wrangler `--dry-run` 완료. `collector/wrangler.jsonc`의 `TURSO_MIRROR_ENABLED=false`, 운영 D1/KIS 바인딩 보존 확인. 이 결과는 Mock 기반으로 **실제 시세가 Turso에 들어왔다는 증거는 아님**.
- **미시행:** 운영 DB SQL/시세 복제/파일럿 시작/Collector·API·웹 실제 배포/PR 병합 모두 미실행. PR 생성 후 링크를 이 항목에 추가할 수 있음.
- **다음:** PR 검토·병합 → Collector/API/웹 각각 안전 배포 → 한국 장중 `blue_turso_mirror_pilot.yml` 수동 15분 파일럿 → `blue_turso_mirror_status.yml`에서 1~2종목의 최근 UTC 시세·이력 행 기록 확인 → 장바구니 가격 표시와 시장일/수집시각 검증. `D1 읽기 차단`이 원인이라면 조회 목록/토큰 저장소를 분리하는 **Turso 독립 수집기**는 다음 PR로 설계.

## 2026-11-19 (KST) — 장바구니 검증 일봉 가격 비교 Turso 우선 (PR 준비)

- **휴대폰 실화면:** Turso 2026-11-18 종목명 검색에서 `삼성전자 005930`/`삼성전자우 005935`와 정확한 확정 종가가 보임. 장바구니에서 기존 LK삼양(225190) 등 18개 발견 기록 및 사용자 선택 기준가가 유지되지만 `최근시세`, `현재수익률`, `검색 이후 관측 최고가`는 미수집/확인 중으로 남음. **기존 장바구니 로컬 데이터는 삭제하거나 재작성하지 않음.**
- **운영 선행 성공:** [Turso 종목명 전체 입력 #44323354552](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44323354552)에서 `verified_source_symbols=2721 written=2721`; [API 검증 #44325688656](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44325688656), [API 실배포 #44326003529](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44326003529), [정적 웹 실배포 #44327071460](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44327071460) 성공. 이 결과는 **일봉 검색/종목명 복구**의 배포이며, 당시 장바구니 Turso 가격 비교는 없었음.
- **이번 변경:** `/api/eod/prices/compare?items=종목코드:발견일,...`를 **Access 인증 필수/읽기 전용**으로 추가. 요청 코드에 대해 Turso 감사 완료된 날짜의 `blue_eod_daily_v1`에서 **발견일보다 나중**의 확정 종가/일봉 고가만 비교. 최고가를 전체 기간 완전 커버로 단정하지 않음(`high_complete=false`); 가격이 없는 경우 `NO_LATER_PRICE`/빈값 유지. 장바구니의 가격 조회만 Turso 우선, Turso 장애 때 기존 D1 `prices/compare`로 폴백. 다른 검색/정밀분석/AI/수집기 기능은 현행 D1 그대로. 장중 KIS/실시간 가격으로 오인하지 않도록 출처를 표시하고 여러 후속 수집원의 **거래일이 더 최신인 값**을 우선 표시.
- **운영 안전:** D1·Turso SQL 쓰기/스키마·EOD 감사 해시·기기 로컬 저장 키 변경 없음. `POST /api/basket/watch` 및 기타 D1 탭은 **아직 D1 의존**. 일봉 8거래일 이후 자동 수집/224일선·패턴·AI 전환이 아님. PR 병합은 실제 배포가 아니며, API와 웹 수동 배포 Actions가 둘 다 필요.
- **로컬 검증:** `node --test tests/test_turso_eod_api.mjs tests/test_turso_basket_prices.mjs tests/test_turso_basket_browser.mjs tests/test_r1593_compare.mjs` **24/24 통과**(Turso 성공/실패·미수집·Access 거부 등), 프런트 TypeScript+Vite 빌드 성공, API Worker Wrangler dry-run 성공(D1·KIS 바인딩 보존). 실제 API 원격 호출/휴대폰 반영은 PR 병합·배포 전까지 미확인.
- **다음:** PR 병합 → `blue_turso_api_eod_deploy.yml` `verify_only` 후 `deploy_api` → `blue_web_r15110_static_safe_deploy.yml`에서 웹 배포 → 장바구니 LK삼양(발견일 11/17)처럼 다음 거래일 11/18의 **실제 Turso 가격 존재** 케이스와 후속 가격 미수집 케이스를 각각 확인. 이후 지속적인 KIS/Turso 수집 및 다른 탭 Turso 전환을 별개 개발.

## 2026-11-18 (KST) — Turso 일봉 종목명 미표시 수정 준비

- **실제 사용자 화면:** Turso 2026-11-16 확정 일봉이 2,661종목으로 조회되지만 `000660 000660`, `005930 005930`처럼 종목코드가 두 번 보임. 장바구니 탭과 기존 장바구니 종목은 보존해야 함.
- **원인:** 날짜별 가격 수집기 `pykrx_verified_day`의 검증된 OHLCV에 `Name=''`가 들어오며, EOD 임포트는 이를 원본 그대로 저장. 기존 PWA가 빈 이름을 코드로 치환했으므로 가격 데이터 오류 또는 종목명 자체의 증빙이 아님.
- **수정 코드:** EOD 일자별 감사·해시·가격 저장 테이블을 **수정하지 않고**, 별도 `blue_symbol_directory_v1`에 검증된 종목명 디렉터리 전체를 명시적인 수동 `apply_all`로 저장·50개씩 재검증하는 경로를 추가. `/api/eod/search`는 별도 이름 디렉터리를 `code+market`으로 LEFT JOIN하여 종목명 검색/표시. 디렉터리 없으면 EOD 원본을 조회하되 종목명은 '미등록'으로 표시. 종목명은 디렉터리 기준일의 이름이므로 과거 상호 변경을 반영하지 않을 수 있음.
- **보존/운영:** 기존 D1 테이블, 장바구니, 추적, AI 분석, 기존 Turso OHLCV 및 일자별 감사 해시를 건드리지 않음. 코드 PR 병합만으로 DB에 이름이 생기거나 운영 Worker가 배포되는 것은 아님. 순서: EOD 연구용 Actions `dry_run` → **사용자가 명시적으로** `apply_all`(D1 게시 두 옵션 false) → API Worker 수동 배포 → 기존 웹 안전 배포. 각 단계 완료 후 이름/코드 검색을 확인.
- **운영 반영 선행 확인:** 사용자 [API 배포 #44314992912](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44314992912), [웹 배포 #44315819434](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44315819434) 성공 후의 실제 휴대폰 화면에서 이 현상이 관측됨. 새 수정 버전은 별도의 DB 이름 입력/API·웹 배포 전까지 적용되지 않음.
- **새 수정 로컬 검증:** Turso 디렉터리 테스트 7/7, Turso API 테스트 8/8, 워크플로 회귀 4/4, 웹 TypeScript+Vite 빌드, API Worker Wrangler `deploy --dry-run`, YAML 파싱 및 `git diff --check` 모두 성공. 실제 Turso 이름 전체 입력과 운영 API/웹 배포는 아직 실행하지 않음.

## 2026-11-18 (KST) — Turso 확정 일봉 조회·D1 장애 폴백 준비

- **요청/결정:** D1 무료 읽기 제한 중 앱을 최대한 활용하도록 Turso에 들어 있는 검증된 자료부터 PWA에서 조회. **Turso 우선**, Turso 장애 시 기존 **D1 분석 UI로 자동 폴백**; D1도 실패하면 양쪽 모두 장애로 알림. 하나의 DB가 정상이더라도 두 DB의 데이터 완전 일치라고 표시하지 않음.
- **실제 선행 결과:** [EOD 수동 적용 #44310029226](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44310029226)은 2026-11-09~18의 **8거래일·21,296건** 정확한 KRX 일봉을 Turso에 `apply`해 날짜별 read-back에 성공(`BLUE_TURSO_EOD_RANGE_OK`). D1 변경 없음.
- **이번 코드:** API에 `/api/eod/dates`, `/api/eod/search` 읽기 전용 추가, 감사 완료된 날짜만 검색·정확한 종가/시가/고가/저가·거래량·원화 거래대금 제공. 기존 `/api/search` 및 D1 바인딩 변경 없음. 웹에는 별도 Turso 확정 일봉 검색 화면을 제공하고, Turso 실패/미설치 시 기존 D1 검색으로 폴백. 전용 화면은 신호·패턴 승률·이동평균선 계산을 제공하지 않으며 다른 탭은 D1 의존임.
- **배포 안전:** 새 `.github/workflows/blue_turso_api_eod_deploy.yml`은 기본 `verify_only`, 명시 `deploy_api`+정확한 Worker 이름 재입력 시에만 기존 API Worker에 두 개의 Turso 비밀값 설치 및 배포. 웹은 기존 검증형 정적 배포 Actions를 별도 수행. 운영 DB SQL·수집기·Cloudflare 배포는 **이 PR에서 실행하지 않음**.
- **로컬 검증:** 새 Turso 읽기 테스트 **7/7** 통과. API Worker Wrangler 번들 `deploy --dry-run` 성공(D1·KIS 서비스 바인딩 보존 확인), 웹 `npm run build` 성공, YAML 파싱·`git diff --check` 성공. 기존 전체 Node 회귀 **80/81** 통과: `tests/test_ai_api.mjs`의 SQL mock 미지원은 `worker/src/ai.ts`/해당 테스트를 이번에 변경하지 않았고, 수정 이전 별도 기존 worktree에서도 같은 오류로 재현됨. 기존 AI 테스트 실패를 신규 Turso 변경 원인으로 오인하지 않음. Turso 이력을 224거래일 이상 확보하고 기술 지표/패턴/추적 관련 데이터를 이관하기 전까지 정상 분석 전체 복구를 주장하지 않음.
- **다음:** PR 병합 → `verify_only` 실행 → 확인 후 `deploy_api` 실행 → API의 Turso 날짜/종목 조회 확인 → 웹 안전 배포 → 휴대폰에서 Turso 우선 및 장애 시 D1 폴백 검증. 이후 정확한 과거 일봉 범위 확장과 신호 엔진 이전.

## 2026-11-18 (KST) — Turso 일봉 11월 9~18일 전체 종목 저장 경로 준비

- **사용자 우선순위 변경:** 현재는 D1/Turso 값 일치 검사보다 **주 DB 예정 Turso에 검증된 일봉을 누락 없이 저장**하는 데 집중. 기존 D1 읽기/쓰기 경로는 유지하며 Turso 우선 읽기·복제 전환은 후순위로 둠.
- **기간:** 2026-11-09~2026-11-18(10일, 주말 제외 평일 **8일**). 정확히 요청한 날짜의 KRX 일봉만 허용. 원천 사이트 준비가 안 된 날이 있으면 **전체 저장 시작 전 실패**; 11월 16일 데이터를 17·18일로 대체하지 않음.
- **새 수동 워크플로:** `.github/workflows/blue_turso_verified_eod_range.yml`, 기본 `dry_run`, 명시적 `apply`만 Turso에 쓰기. `scripts/turso_verified_eod_range.py`는 기존 `market_scan_r11.py`의 pykrx + KRX OpenAPI 날짜·시장 검증을 재사용, 날짜별 약 1,700개 이상 거래 종목의 비조정 OHLCV 및 거래대금, 출처, SHA256을 보존. 보관 파일은 `manifest.json`+`daily.jsonl`.
- **Turso 저장:** `tools/turso/eod-range-import.mjs`는 전체 파일·날짜·날짜별 해시·종목코드·OHLC 범위를 저장 전 독립 검증. `blue_eod_daily_v1` `(trade_day,code)` 기본키로 멱등 삽입, 재실행 시 일치하는 기존 행은 유지. 기존 값이 다르면 **자동 수정하지 않고 실패**. 날짜별 실제 read-back과 `blue_eod_ingest_audit_v1` 완료 기록을 남김. 장애로 일자 일부만 입력됐어도 수동 재실행 가능.
- **명확한 범위:** 데이터 수집/정확성/저장부터 시작. D1 데이터 비교, D1 SQL 실행, 운영 DB 교체, 자동 스케줄·앱 조회 변경, KIS 주문 모두 하지 않음. **아직 실제 Turso에 일봉이 저장됐다는 뜻이 아님**; PR 병합 후 GitHub Actions `dry_run` 및 소스 준비 확인, 이어서 `apply`가 필요.
- **로컬 검증:** Python 8/8, Node 5/5 단위 테스트 통과(정확한 8개 평일, 원천 오류 중단, KRX Open API 영문 혼합 우선주 코드·정확한 날짜 보존, 무거래 제외, 기간/해시 변조 거부, DB 없는 dry-run, 동일행 재실행 및 기존값 불일치 중단). YAML 수동 입력 파싱 통과. 실제 KRX·Turso 접속은 아직 실행하지 않음.
- **후속:** PR 병합 후 `dry_run`으로 실제 날짜별 원천 검증·행수·해시 로그 확인 → 성공 시 `apply` 실행 → 실제 DB 행수/날짜별 완료 기록 확인. 소스 미준비일이 있으면 끝 날짜를 줄여 검증 완료 날짜부터 단계적으로 저장할 수 있으나, 미확인 일자를 성공으로 표시하지 않음.

## 2026-11-18 (KST) — EOD Turso 파일럿 `off` 기본값 안정화 및 수동 `dry_run` 성공

- **발견된 오류:** [Actions #44304329101](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44304329101)에서 YAML의 따옴표 없는 `off`가 불리언 `false`로 해석됨. 기존 `!= 'off'` 조건이 참이 되어 의도하지 않은 Turso 파일럿 단계가 시작되고 `INVALID_PILOT_MODE`로 종료. 일봉 스캔은 성공했으며 Turso/D1 실제 기록 없음.
- **정상 수동 검증:** [Actions #44304379580](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44304379580)에서 `dry_run` 성공. 2026-11-16 기준 일봉 관측 종목 2,611개, 신호 114개, 검증된 종목 디렉터리 2,721개. `TURSO_EOD_DIRECTORY_DRY_RUN ... written=0`을 확인했고 D1 발행은 건너뜀. 이는 Turso 실제 쓰기 성공을 의미하지 않음.
- **이번 수정:** `off` 및 선택값을 문자열로 명시하고 Turso 설치/테스트/쓰기 단계의 실행 조건을 **`dry_run` 또는 `apply_12`인 경우에만**으로 제한. YAML 암묵적 불리언과 비정상/미전달 값에서 안전하게 건너뜀. 회귀 검사 추가.
- **바로 다음:** 수정 PR 병합 후 `off` 기본 실행을 다시 확인. 이후 사용자 선택 시에만 `apply_12`로 Turso 실제 12종목 삽입/조회 검증. 최신 일봉이 2026-11-16까지인 문제는 별도 데이터 갱신 점검이 필요함. **Turso 주 DB 전환과 운영 D1 쓰기 변경 없음.**

## 2026-11-18 (KST) — Turso 주 DB / D1 보조 DB 목표 확정, 장외 EOD Turso 12종목 파일럿 준비

- **사용자 결정:** 두 독립 DB에 검증된 업무 데이터를 가능한 동일하게 보존하되, 최종 **Turso를 주 DB, D1을 보조 DB**로 운영. 즉시 전환하지 않고 실제 저장·대조·누락 재처리 및 읽기 장애 폴백을 검증한 뒤 전환합니다. 무료 D1 단일 DB 용량 제한(500MB) 때문에 영구 완전 복제를 무제한 약속하지 않습니다.
- **이번 코드:** `.github/workflows/blue_market_scan_research_only.yml`에 수동 `turso_directory_mode=off|dry_run|apply_12` 입력 추가. 기존 검증된 `SYMBOL_DIRECTORY.json`를 `tools/turso/eod-directory-pilot.mjs`가 전체 검사 후 코드 순 최대 12개만 Turso의 동일 이름 테이블 `blue_symbol_directory_v1`에 멱등 UPSERT, 정확한 키로 소량 read-back 검증. 기본 off이며 **D1 SQL/Worker 배포/운영 전환 없음**.
- **분리된 단계:** 파일럿은 실제 종목명 저장 통신 테스트이고 `runs`·`signals`·`chart_snapshots` 및 과거 대용량 자료의 전체 미러와는 다릅니다. 현재 Turso 0건 원인은 여전히 미확정. 새 경로 성공을 5분 시세 복제 성공으로 해석하지 않습니다.
- **로컬 테스트:** Turso 파일럿 Node 테스트 **5/5** 통과, GitHub Actions YAML 파싱 및 `git diff --check` 통과. 실제 Turso DB 쓰기와 D1 운영 DB 조회는 실행하지 않았습니다.
- **바로 다음:** PR 병합 후 EOD 스캔 `dry_run` → 검증 성공 시 수동 `apply_12` → Turso 입출력 확인 → 운영 D1 데이터 백필·재시도 큐·전량 정합성 검사·Turso 우선 읽기 기능을 순차 구현. **사용자 승인 없이 즉시 운영 DB를 바꾸지 않음**.

## 2026-11-18 (KST) — 진단 Actions 야간 실행 / 7분 종료 판정 개선

- **실행 확인:** [Collector Runtime Tail #44296117467](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44296117467), UTC 11:36~11:43 = **한국 시간 20:36~20:43**, 거래 시간 종료 후. 로컬 필터 테스트 4/4 통과; 7분 수집 결과 `full_runs=0 mirror_events=0 provider_summaries=0 warnings=0`. **장중 수집 실패의 증거는 아님.** Cloudflare Worker Tail 원문은 보안상 출력되지 않았으며 D1 SQL 실행 없음.
- **진단 Actions 자체의 결함:** 정해진 7분이 정상적으로 지나도 `timeout`/`wrangler tail` 종료 코드가 기존 허용 목록(`0`, `124`, `130`)에 없으면 실패 처리됨. 이번 실행도 약 7분 후 이 조건에서 종료됐으나 실제 코드 값은 기존 로그에 없어서 미확정. Tail 권한이 없었다고 단정하지 말 것.
- **개선 PR:** [#17 — Collector 로그 진단 정상 종료 오탐 수정](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/pull/17). 시작/종료 시각과 종료 코드(숫자만)를 출력하고, 정상 관측 시간에 도달했다면 신호에 따른 종료 코드가 달라도 **정상 관측 종료**로 처리. 권한 오류 등으로 조기 종료하면 실패 상태 유지. 운영 D1 조회·Worker 배포·시세 요청 없음.
- **바로 다음 작업:** 수정 PR 병합 → **다음 거래일 KST 09:00~15:20 중** 7분 로그 진단 수동 실행 → `BLUE_R142` 상태/원인을 토대로 수정. 현재 Turso 0건 원인은 여전히 미확정이며, 만료된 파일럿을 근거 없이 재시작하지 않음.

## 2026-11-18 (KST) — 수집기 재배포·Turso 파일럿 실행 성공, 실제 복제 0건 진단

- **확인 완료:** [PR #15](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/pull/15) 병합 후 [Collector 실배포 #44284567795](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44284567795)에서 수집기 테스트 40/40, Wrangler 실배포 및 KIS Secrets 설치 성공. 일반 Turso 복제는 OFF.
- **파일럿 재시작:** [#44284901016](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44284901016)에서 `start_15m` 성공. UTC 10:38:32.778 (= KST 19:38:32) 자동 만료, 회당 최대 2종목 제한.
- **관측:** [Turso Status #44286642943](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44286642943), UTC 10:34 (= KST 19:34) `latest_symbols=0 history_rows=0`. Turso SQL 읽기는 정상이며 **실제 복제 성공은 아직 확인되지 않음**.
- **원인 미확정:** 수집 자체의 `PAUSED_NO_FRESH_CANDIDATES`, `PAUSED_TOKEN_EXPIRED_OR_MISSING`, `NO_VALID_QUOTES`, `COLLECTOR_ERROR` 또는 Turso 비동기 오류 여부를 먼저 분리해야 함. Google OAuth/Turso 웹사이트 로그인 거부가 이 0건의 직접 원인이라는 근거 없음.
- **이번 진단 PR:** [#16 — D1 SQL 없이 Collector 실시간 상태 로그로 원인 진단](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/pull/16). `.github/workflows/blue_r142_collector_tail_diagnostic.yml`에 수동 3/7분 **Cloudflare Worker 실시간 로그 읽기만** 수행하는 Actions 추가. `collector/tools/tail-diagnostic.mjs`는 `BLUE_R142`·`BLUE_TURSO_MIRROR`의 정해진 상태 코드/숫자만 출력하며 토큰, SQL, 요청 URL, KIS 응답 원문은 버림. `collector/src/core.mjs`는 상태 코드의 안전한 원인 필드(`NO_VERIFIED_CANDIDATES`, `STALE_OR_FUTURE_EOD`, `SANITIZED_RUNTIME_FAILURE`)를 출력해 문제 원인 분류 향상. 이 진단은 **운영 D1 SQL 실행 없음**, 시세 수집을 인위적으로 실행하지 않음.
- **주의:** Cloudflare Wrangler `tail`은 **미래의 실시간 로그**만 받아오므로 5분 수집 시점 포함 7분 캡처를 권장. 과거 수집 실패를 소급해 조회하지 못함. 코드 병합/재배포 전에는 새 `reason` 필드가 없을 수 있으나 구버전 상태 요약도 파싱 가능.
- **로컬 검증 완료:** 수집기 `npm test` **44/44** 통과(진단 로그 필터 4개 테스트 신규), Wrangler `npm run build:check` dry-run 성공(`TURSO_MIRROR_ENABLED=false` 유지). GitHub Actions YAML 파싱 성공. **Cloudflare 실시간 tail은 아직 실행하지 않았으며 운영 Worker도 변경하지 않음.**
- **후속:** 진단 PR 병합 → (필요시) Collector 재배포 후 한국 주식시장 거래 시간에 읽기 전용 진단 Actions 실행 → `BLUE_R142` 상태와 Turso 복제 결과로 실제 원인 확정 → 최소 범위 수정 및 재검증. 무근거 전체 복제 재실행/DB 이관 금지.

## 2026-11-18 (KST) — 수집기 실제 배포 성공 / 자동 만료 Turso 소량 복제 파일럿 준비

- **확인 완료:** [Secrets 설치 #44279139920](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44279139920)에서 Cloudflare Worker Turso Secrets 두 개 등록 성공. [Turso 상태 확인 #44279543275](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44279543275)에서 최신/이력 모두 0행(복제 OFF이므로 정상). [Collector 실제 배포 #44279762372](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44279762372)에서 테스트 37개/드라이런 성공, 운영 `blue-market-collector`에 실제 배포 성공. 당시 `TURSO_MIRROR_ENABLED=false`.
- **사용자 승인:** D1을 기본 저장소로 유지하고 Turso는 실제 종목 중 소량만, 기간이 지나면 자동 종료되는 파일럿을 준비하기로 함.
- **이번 코드:** `TURSO_MIRROR_PILOT_UNTIL_UTC`라는 Worker Secret에 미래 UTC 종료 시각을 넣으면 `TURSO_MIRROR_ENABLED=false` 상태에서도 최대 **30분간** `PILOT` 모드로 동작. **5분 전체 수집 완료 건당 앞의 최대 2종목**만 Turso 테이블 두 곳에 쓰며, 만료 후 추가 작업을 자동 차단. 독립된 `FULL` 모드는 기존처럼 배포 설정을 명시적으로 `true`로 바꿀 때만 사용 가능.
- **수동 Actions:** `.github/workflows/blue_turso_mirror_pilot.yml`(기본 `dry_run`, `start_15m`, `start_30m`, `stop`; 대상 Worker 이름 확인 필수). Cloudflare의 종료 시각 Secret만 갱신할 수 있으며, 배포 버전이 새로 생성될 수 있음. D1 SQL 없음.
- **작업 PR:** [#15 — 15/30분 자동 종료·최대 2종목 Turso 복제 파일럿](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/pull/15) (게시 완료, 아직 병합 전). 작업 브랜치 `codex/turso-timeboxed-pilot-20261118`. 새 파일럿 코드의 운영 배포나 실제 복제 **아직 하지 않음**. 병합 → 기존 수집기 배포 Actions로 새 코드 운영 반영 → 사용자 수동 파일럿 시작 순서를 지킴.
- **로컬 검증 완료:** Collector Node 테스트 **40/40 통과**(엄격한 30분 시한, 회당 2건, 만료 시 연결 없음 포함). `npm run build:check` Wrangler dry-run 성공, 빌드 바인딩에서 `TURSO_MIRROR_ENABLED="false"` 확인. GitHub Actions 파일 YAML 파싱 성공. **운영 Worker 재배포/실제 Turso 저장은 별도이며 미실행.**
- **후속:** 장중 소량 복제 확인 → Turso-only Status로 건수/시각 확인 → D1 대비 정확한 일치 확인 및 누락 재처리 큐 설계. 파일럿은 연속/완전한 보관이 아니며 운영 읽기 전환 근거로 사용하지 않음.

## 2026-11-18 (KST) — Turso 테이블 생성 성공 / Worker 인증·상태 점검 준비

- **확인 완료:** [GitHub Actions #44278060936](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44278060936) 성공. `TURSO_MIRROR_SCHEMA_READY: two tables verified, no stock rows inserted` 로그 확인. 사용자가 `apply=true`로 실제 Turso 스키마를 생성함.
- **작업 PR:** [#14 — Turso Worker 시크릿 수동 설치·상태 점검](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/pull/14). 병합 및 배포 상태는 실제 PR/Actions에서 확인할 것.
- **준비:** `blue_turso_collector_secrets.yml`(기본 아무 작업 없음, 명시적 승인 시 Turso 인증 두 개만 Worker에 등록), `blue_turso_mirror_status.yml`(Turso 한국 날짜 당일 건수/최신 수신 시각만 조회), `tools/turso/mirror-status.mjs`.
- **운영 상태:** D1은 계속 원본. Turso 테이블 생성 성공, **현재 복제 플래그 OFF**. Worker 인증 등록/실제 데이터 복제/누락 복구는 아직 확인되지 않음.
- **후속:** PR 병합 → 기본 `apply=false` 워크플로 확인 → 사용자 선택 시 Worker Secrets 설치 → 상태 점검 → 제한된 수집 파일럿과 D1 대비 일치 검증 및 누락 재처리 설계.

## 2026-11-18 (KST) — Turso 연결 성공 / 병행 저장 파일럿 코드 준비

- **검증 성공:** [GitHub Actions #44276186275](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44276186275)에서 `TURSO_CONNECTION_OK` 확인. `SELECT 1` 실행 성공, GitHub Secrets 인식, D1 SQL 없음.
- **작업 PR:** [#13 — Turso 병행 저장 파일럿 준비](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/pull/13). 이 기록 시점은 **미병합/미배포**이며, 실제 상태는 PR과 Actions를 확인할 것.
- **이번 변경:** `collector/src/turso-mirror.mjs`(5분 전체 수집분을 Turso에 idempotent UPSERT + INSERT OR IGNORE), `collector/src/handler.mjs`/`core.mjs`(D1 저장 완료 후 별도 비동기 작업), `collector/wrangler.jsonc`(Turso 복제 OFF 기본값), `tools/turso/mirror-schema.sql` 및 수동 생성 워크플로 추가.
- **안전 범위:** 운영 D1 쓰기 로직과 KIS 수집 경로는 계속 원본. Turso 쓰기 실패는 D1 성공을 취소하지 않음. Cloudflare 배포, Turso 스키마 생성, 실제 병행 복제는 **아직 실행하지 않음**.
- **검증:** 수집기 Node 테스트 37/37 통과; Wrangler `deploy --dry-run` 성공; 인메모리 SQLite에서 Turso 테이블 DDL을 두 번 실행해도 성공(재실행 안전).
- **남은 문제:** best-effort 복제는 Turso 장애 동안 누락된 과거 데이터를 재전송하지 못함. 이것은 장기 안정성 보장의 미완료 항목이며 읽기 전환 이전에 반드시 보완 필요.
- **다음:** PR 병합 → Turso `apply=true`로 테이블 생성 → 기본 OFF 상태 유지하며 비밀 값/코드 배포 검증 → 데이터 일치·누락 재처리 개발.

## 2026-11-18 (KST) — Turso 병행 연결 준비 + 자동 인계 문서 도입

- **목표:** 기존 D1/API/수집기 안정성을 유지하면서 Turso와 통신이 가능한지 먼저 검증. 채팅이 바뀌어도 GitHub 기록으로 개발을 이어가기 위한 구조를 마련.
- **작업 PR:** [#12 — Turso 연결 수동 테스트 + GitHub 인계 기록 체계 추가](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/pull/12). 운영 반영 여부는 PR 병합 상태를 확인해야 함.
- **추가:** `.github/workflows/blue_turso_connection_test.yml`, `tools/turso/`, `AGENTS.md`, `docs/PROJECT_CONTEXT.md`, `docs/WORK_LOG.md`.
- **안전 범위:** Turso 쪽 `SELECT 1` 연결 검사만 허용. Cloudflare D1에 SQL 실행 없음. 시세 복제, 스키마 생성, 운영 전환 없음. GitHub Secrets 미설정 상태에서는 실패하도록 설계.
- **실제 연결/배포 여부:** PR 검토·병합과 비밀 값 등록 후 Actions 실행 결과로 판단. 코드를 추가한 것만으로 Turso가 연결된 것은 아님.
- **후속:** Turso DB 생성 → GitHub Secrets 설정 → 수동 연결 테스트 → 성공 결과 기록 → 데이터 복제 정책 및 일치 검증 설계.

## 2026-11-18 (KST) — D1 사용량 분석 및 대응

- GraphQL Analytics를 이용한 **읽기 전용** 사용량 진단 수행: [GitHub Actions 실행 44262816647](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44262816647).
- 리포트 실행 기준 UTC 2026-11-18 진행 중 읽은 행 5,104,591, 이전 6일 합계 6,050,725. 계정/대상 DB 값 동일. Analytics는 샘플링 기반이므로 실제 무료 한도 카운터와 직접 동일시하지 않음.
- 반복 비용이 큰 쿼리 유형: `chart_snapshots`, `blue_kis_first_seen_r154`, `blue_search_quote_priority_r1594`, `sqlite_master` 등.
- D1 무료 행 읽기 한도 초과 알림 수신. 운영 DB에 진단용 SQL을 직접 실행하는 방식을 피하기로 결정.
- 사용자는 우선 인덱스/중복 조회 개선과 다음 날 재발 관찰, 이어서 기존 계획 개발을 원함.

## 장기적으로 계속 적용할 운영 원칙

- 데이터의 일관성·신뢰성이 실시간 초저지연보다 중요함(약 1분 지연 허용).
- DB를 즉시 교체하지 않음. Turso는 검증된 병행 수단으로 단계적 도입.
- 새로운 기능과 운영 변경이 발생한 경우 같은 PR/커밋에서 이 작업 기록을 보완.
