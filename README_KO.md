# BLUE Signal Lab R0.4 — Cloudflare 웹 검색 MVP

**RESEARCH_ONLY / 기존 Stock-Hunter 원본과 LIVE·SEARCH·WATCH 변경 없음.**

## 이번에 실제 구현한 것
- `worker/`: Cloudflare Workers + D1 **읽기 전용** API. `/api/runs`, `/api/search`, `/api/symbol`, `/api/health`. 서버에서 날짜 검증, 한 거래일/기간 조회, 신호 OR·AND 및 종목코드 필터, 페이지 처리.
- `web/`: React + TypeScript + Vite 브라우저 화면. 단일 날짜/기간 검색, BLUE20·30·40 및 ENV20·40 선택, 결과표, 거래일별 요약, 종목 세부 정보.
- `scripts/csv_to_d1.py`: 기존 R0.3 `signals.csv`+`daily_counts.csv` → D1 SQL (원본 파일 미수정). 신호가 없는 거래일도 유지.
- `tests/`: CSV 가져오기/SQL 안전성 검증.

## 중요한 현재 제한
1. 이 버전은 **기존 R0.3 CSV 결과를 조회**하며 실시간 KRX 데이터 수집이나 당일 분석 자동 실행은 아직 없습니다.
2. `/api/symbol`은 신호 이력만 제공합니다. **실제 OHLCV 차트, 우측 추정 매물대 시각화, RSI/MACD/Slow 패널은 이 웹앱에 아직 연결되지 않았습니다.** 이전 R0.2의 오프라인 차트 생성 코드는 보존됩니다.
3. BLUE 신호 계산은 이 Workers 코드에서 수행하지 않습니다. R0.3에서 계산하고 결과를 가져와야 합니다.
4. 테스트 입력은 합성 데이터이며 실제 종목 성과를 의미하지 않습니다.
5. D1/Cloudflare 계정 또는 GitHub 저장소에 **배포하지 않았습니다**.
6. `run_id`별 검색 결과 원장과 일별 요약은 유지하지만, D1은 장기 OHLCV 전체 시계열 저장용으로 설계하지 않았습니다. 실제 차트용 데이터는 추후 R2/캐시 계층 연동이 필요합니다.

## 로컬에서 실행
1. Node.js 20 이상, npm, Python 3.10 이상 준비.
2. `cd worker && npm install` 후 `wrangler.jsonc`의 D1 `database_id`를 실제 ID로 교체. 로컬 D1 테스트만이면 Workers CLI 설정을 별도로 맞춥니다.
3. `npm run db:local`로 `schema.sql`을 로컬 D1에 적용.
4. Python R0.3 검색으로 `signals.csv`, `daily_counts.csv` 생성. 경로를 `results/day1/`이라고 가정.
5. `python scripts/csv_to_d1.py --input-dir results/day1 --out data_import.sql --run-id research-20261109 --source R0.3_OHLCV_CSV`
6. `cd worker && npx wrangler d1 execute blue-signal-lab --local --file=../data_import.sql`.
7. `npm run dev` 로 Workers API 실행 (기본 8787).
8. 별도 터미널 `cd web && npm install && npm run dev` 로 UI 실행 (기본 5173). Vite 프록시가 `/api`를 8787로 전달.
9. 원격 D1 데이터베이스 생성: `cd worker && npx wrangler d1 create blue-signal-lab` 후 반환된 실제 ID를 wrangler.jsonc에 설정. `npm run db:remote` 및 `npx wrangler d1 execute blue-signal-lab --remote --file=../data_import.sql`.
10. API 배포는 `npm run deploy`. 프론트엔드 빌드 `cd web && npm run build`, `dist/`를 별도 Cloudflare Pages 프로젝트로 배포. 운영용 `VITE_API_BASE`와 `CORS_ORIGIN`을 실제 도메인으로 설정할 것.

## 검색 의미
- `single`: 지정 날짜가 DB에 없으면 **결과 0건**. 다른 날로 대체하지 않음.
- `range`: 시작일~종료일 범위. 대상 기간에서 최대 370일의 `daily_counts`를 반환. 검색 데이터는 최대 100개씩 페이지 조회 (API 상한 500).
- 검색에 표시되는 최종 데이터 날짜는 실제 시장 최신일이 아니라 업로드된 원장의 마지막 날짜.
- 진짜 2026년 당일 검색을 하려면 장마감 데이터 수집/검증/분석 및 D1 가져오기를 매일 자동 실행해야 함.

## 검증
`python -m unittest discover -s tests -v`

## 기존 프로젝트와 연결
기존 Stock-Hunter의 원본 연구, 신호 판정, 워크플로를 임의 수정하지 마세요. R0.3 연구 결과를 읽기 전용으로 내려받아 이 프로젝트의 D1 인덱스로 가져오는 단방향 연동부터 진행하세요.
