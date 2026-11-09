# BLUE Signal Lab R0.5 — 국내 전체 종목 당일 검색 (연구 전용)

## 이것은 배포 완료가 아닙니다

- **새 GitHub 브랜치 자동 생성이 권한 오류(403)로 차단**되어, 파일을 GitHub 저장소에 직접 반영하지 못했습니다.
- 이 ZIP의 `.github/workflows/blue_market_scan_research_only.yml`을 GitHub **저장소 루트의 동일 경로**로 업로드하면 Actions에서 실행할 수 있도록 작성했습니다.
- 실제 marcap 연도별 Parquet 다운로드는 현재 실행환경에서 네트워크가 차단되어 미검증입니다. GitHub Actions 로그와 `AUDIT.json`을 반드시 확인하세요.
- 기존 Stock-Hunter의 실전 LIVE/SEARCH/WATCH, 연구 원본 및 Cloudflare 배포 코드를 수정하지 않습니다.

## 업로드할 파일

`BLUE-Signal-Lab` 저장소 (https://github.com/ehdud6728-bit/BLUE-Signal-Lab) 에서:

- `research_r05/scripts/market_scan.py` ← ZIP 안의 `scripts/market_scan.py`
- `research_r05/tests/test_market_scan.py` ← ZIP 안의 `tests/test_market_scan.py`
- `.github/workflows/blue_market_scan_research_only.yml` ← ZIP 동일 경로

`worker`, `web`, `scripts/csv_to_d1.py`는 그대로 유지합니다.

## GitHub 웹에서 실행

1. GitHub → Actions → **BLUE Signal Lab R0.5 - KRX Market Scan RESEARCH_ONLY**.
2. Run workflow → `asof_date=latest` / `publish_to_d1=false` 상태로 실행합니다.
3. `BLUE_R05_MARKET_SCAN_RESEARCH_ONLY` 아티팩트를 내려받고 `AUDIT.json`에서 `asof`, `observed_stocks`, `insufficient_history`, `matched_stocks`, `source_sha256_by_year` 확인.
4. 실측 스캔 결과와 기존 BLUE 연구 신호 일치 검증 후에만 D1 공개를 고려합니다.

`latest`는 **소스에 존재하는 가장 최근 거래일**입니다. 달력상 오늘과 동일하다는 뜻이 아닙니다. 날짜를 직접 지정할 경우 해당 날짜가 소스에 없다면 실패합니다. 원천 데이터 지연, 휴장, 신규 상장/거래정지, 기업행사 영향이 있을 수 있습니다.

## D1 자동 등록 — 검증 후 선택 사항

GitHub → Settings → Secrets and variables → Actions → New repository secret 에 다음을 등록해야 합니다:

- `CLOUDFLARE_API_TOKEN`: D1 편집 권한이 있는 **최소 권한** API 토큰. 절대 소스에 입력하지 마세요.
- `CLOUDFLARE_ACCOUNT_ID`: Cloudflare 계정 ID.

그다음 `publish_to_d1=true`로 수동 실행하면 기존 `blue-signal-lab-db`의 `runs/signals/daily_counts`에 결과를 넣습니다. 이 단계는 DB에 쓰기를 수행합니다. `false` 기본값은 결과 SQL 파일을 아티팩트로만 만듭니다. `runs`에 새 `run_id`로 저장되므로 웹에서 검색 실행을 선택할 수 있습니다.

## R0.5 신호 정의와 주의

- BB20/30/40: 종가 SMA, 모표준편차 `ddof=0`, `(2.0σ,26거래일 이동)` 상·하단 및 `(1.8σ,20거래일 이동)` 보조 변형. 이동된 밴드가 하락하고, 전일 종가가 전일 밴드 이하이고, 양봉 몸통이 해당 선의 아래/위로 각각 20% 이상, 양봉 크기 0.5% 이상인 돌파를 독립 기록.
- ENV20/40: 이동하지 않는 해당 기간 SMA 중앙선의 몸통 돌파 **연구용 후보**. 원본 `ENV20` 연구와의 완전 동등성은 검증 전입니다.
- RSI: Wilder 방식의 14일 RSI에 9일 SMA 기준 신호. Slow Stochastic: 14,3,3 / 12,5,5 / 20,12,12; 모든 값은 신호 당일까지 계산.
- 전고점: 이전 20/60/120/224거래일 최고 고가. 실제 매물대 Volume Profile은 현재 버전에서 **NOT_COMPUTED**로 명시 (R0.2 화면의 시각화와 혼동 금지).
- **원시 가격 기반, 기업행사 보정 검증 미완료**. 가격 갭 ±40% 이상은 별도 제외 계수로 기록하며, 모든 corporate action을 검출하지는 못합니다.
- 전체 시장은 소스에 포함된 `Market=KOSPI/KOSDAQ`의 유효 OHLCV 행을 대상으로 하며, ETF/ETN/우선주 등 종목 분류 완전 제외는 미구현입니다. "전체 국내 상장증권 종류"와 동의어가 아닙니다.
- 기존 500종목 연구와 신호 완전 일치 검증 미완료. 매매 판단/실전 알림 사용 금지.

## 다음 개발

날짜 지정 검색을 실제 데이터 기준으로 활성화하고, `AUDIT`의 신호 조건 동등성을 검증한 다음 GitHub Actions에 예약 실행을 추가합니다. 실패 시 원본과 비교하며 변경을 최소화합니다.
