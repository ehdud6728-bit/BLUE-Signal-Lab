# BLUE Signal Lab R0.6 — 날짜 자동 선택 + 종목명 + 일봉 추정 매물대

## 현재 완료 범위
- **기존 D1 스키마 유지**. 저장된 2026-11-05의 94건을 삭제하거나 변경하지 않습니다.
- 프론트엔드에서 데이터셋 선택 제거. 날짜 지정/기간 검색만 사용.
- API에서 날짜별로 최신 비-데모 run을 자동 선택. 단, 이는 이미 저장된 날짜에 한하며, 미등록 날짜를 새로 계산하는 기능은 아직 없습니다.
- marcap의 종목명(Name)을 신호 CSV로 내보낸 뒤 SQL 변환기의 extras_json에 보존.
- 상단 매물대 거리는 120개 *이전* 거래일의 일봉 대표가격(고가+저가+종가)/3에 일별 거래량을 부여한 1% 폭 히스토그램으로부터 **실험적 추정치**를 계산. 기존 Stock-Hunter의 인증된 VP 알고리즘과 동일하지 않음. 값이 없으면 미계산.

## GitHub 웹 UI 설치 (Windows/PowerShell 불필요)
1. ZIP 내부의 `worker/src/index.ts`를 GitHub `worker/src/index.ts`에 완전히 덮어쓰기 후 Commit. Cloudflare API Worker 배포 성공 확인.
2. ZIP 내부의 `web/src/main.tsx`를 GitHub `web/src/main.tsx`에 완전히 덮어쓰기 후 Commit. Cloudflare 웹 배포 성공 확인.
3. ZIP의 `scripts/market_scan_r06.py`를 같은 경로로 새로 업로드 후 Commit.
4. ZIP의 `tests/test_market_scan_r06.py`도 같은 경로로 새로 업로드.
5. 기존 `.github/workflows/blue_market_scan_research_only.yml` 파일의 단 한 줄:
   `python scripts/market_scan.py --date "$ASOF" --years 2025,2026 --out output`
   를 아래로 바꿉니다.
   `python scripts/market_scan_r06.py --date "$ASOF" --years 2025,2026 --out output`
6. 기존 Actions 워크플로를 `asof_date=2026-11-05`, `publish_to_d1=false`로 테스트합니다. `AUDIT.json`에 names_found 및 supply_proxy_computed를 확인.
7. 검증 후 `output/import.sql`을 이전과 동일한 방식으로 D1에 등록합니다. 기존 `blue_market_20261105`의 **해당 run만 대체**하며 다른 날짜·다른 run은 남습니다. SQL의 BEGIN/COMMIT은 D1 Console 수동 실행 시 제거합니다. **재등록 전에 기존 데이터 백업을 권장합니다.**
8. 웹에서 2026-11-05 검색하여 종목명과 `(일봉 추정)` 매물대 수치 확인.

## 데이터 및 안전 주의
- 웹과 Worker 두 코드가 모두 배포된 후 날짜 기반 자동 검색이 동작합니다.
- 기존 94개 데이터는 종목명/매물대 값이 비어 있으므로 새 검색 결과를 재등록하기 전에는 각각 '종목명 미등록'/'미계산'으로 보입니다.
- marcap의 최신 데이터 기준일이 검색 요청일보다 이전이면 날짜를 조용히 변경하지 않으며 해당 날짜를 미등록으로 표시합니다.
- **웹 버튼 → GitHub Actions 자동 실행 기능은 아직 구현하지 않았습니다.** 인증 및 rate limiting, 작업 상태 저장, 결과 D1 자동 배포를 별도 단계에서 완성해야 합니다.
- 기존 Stock-Hunter 원본은 변경하지 않습니다.
