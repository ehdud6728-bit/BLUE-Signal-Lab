# BLUE → Stock-Hunter R9 삼성SDI KIS 과거 원주가·수정주가 원천 수집

**상태:** `RESEARCH_ONLY` / 수동 실행만 / 기존 실전 앱·D1·Turso 기록·KIS 발급 체계 변경 없음.

## 배경과 책임 경계

- BLUE 저장소에 이미 등록된 `KIS_APP_KEY`, `KIS_APP_SECRET`을 **BLUE의 GitHub Actions 실행 시점에서만** 사용한다. 키를 Stock-Hunter로 복사·출력·이동하지 않는다.
- 현재 BLUE의 KIS 접근토큰은 Turso 암호화 금고 `blue_turso_kis_vault_v1`에 저장되고 단일 토큰 관리자가 발급한다. 이 연구는 기존 유효 토큰을 **SELECT 한 번으로 읽기만** 한다. **`tokenP` 신규 발급/갱신, D1 조회, SQL 쓰기, 매매/주문 API 사용 불가.**
- 고정 대상은 삼성SDI `006400`, 2023-09-01~2023-11-06의 KIS 날짜 지정 일봉 GET 2회만이다. `FID_ORG_ADJ_PRC=1` 원주가, `0` 수정주가. 다른 종목/기간으로 확대하지 않는다.
- BLUE는 외부 공급자의 OHLCV와 검증용 증거를 만든다. Stock-Hunter의 **고정 R8 커밋 `891f3ba3b2d82dec4cf052f301d685d649de106a`**이 동일 액션에서 기존 2023 추세선 5개 날짜를 비교한다. 수집 성공과 실제 연구 검증 성공은 별개의 상태다.

## 실행 방법

1. PR을 확인하고 `main`에 병합한다. 별도의 Worker/PWA 배포는 **필요 없으며 실행하지 않는다**.
2. GitHub Actions `BLUE to Stock-Hunter R9 KIS Historical Price Bridge (RESEARCH ONLY)`를 열어 `Run workflow` → `main` → `mode=dry_run` 실행. 이것은 DB/KIS/Secret에 접근하지 않는다. 로그에서 `DRY_RUN_NO_REMOTE_REQUESTS`를 확인한다.
3. 기존 Turso 토큰 관리자의 읽기 전용 `check` 결과가 `TOKEN_VALID`인지 확인한다. 토큰 만료/누락이면 기존 단일 토큰 관리자에서 **기존 승인된 안전 절차로만** 복구한다. 이 연구 때문에 새 토큰을 발급하거나 발급 중단 플래그를 해제하지 않는다.
4. `mode=capture`를 **한 번만** 수동 실행한다. 이 모드는 BLUE 기존 GitHub Secrets `KIS_APP_KEY`, `KIS_APP_SECRET`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`만 읽는다. 필요한 Secret이 없으면 실패 처리하고 재발급하지 않는다.
5. 완료된 Actions 링크를 연구 채팅에 공유한다. `BLUE_STOCKHUNTER_R9_KIS_006400_<run_id>` 아티팩트의 CSV 2개·매니페스트 2개·`BLUE_R9_SUMMARY.json` 및 `BLUE_R9_STOCKHUNTER_R8_COMPARISON.json`을 점검한다.

## 결과 해석

| 항목 | 의미 |
| --- | --- |
| `DRY_RUN_NO_REMOTE_REQUESTS` | 테스트와 무통신 경로만 검증한 상태. **실제 과거 OHLC 수집 아님** |
| `CAPTURE_COMPLETE_READY_FOR_STOCKHUNTER_R8_AUDIT` | KIS 응답 2개가 형식·고정 날짜 검증을 통과하고 파일로 내보내진 상태. **독립 R8 비교 성공과는 별개** |
| `SOURCE_UNAVAILABLE_FAIL_CLOSED` | 기존 토큰/연결/API/원주가·수정주가 날짜 불일치 등 실패. CSV 일부가 있어도 승인하지 않음 |
| `FIVE_DATE_COMPARISON_COMPLETE_FULL_R116_REPLAY_NOT_DONE` | 고정 5개 날짜 독립 비교 완료. **R116 전체 신호 재현, 55일 전략 통계, 실전 수익성 인증은 아님** |
| `RAW_SOURCE_DISAGREEMENT`, `UNKNOWN_MISSING_REQUIRED_DATES` | 독립 R8 감사에서 원본과 차이/누락이 확인된 상태. 차이를 임의 보정하지 않음 |

매니페스트는 공급자 응답 바이트 SHA256과 수집 CSV SHA256, GitHub commit/run ID, 조회 모드를 기록한다. 이는 파일의 동일성·이력을 점검하는 자료이지 KIS가 제공하는 전자서명이나 조정주가 산정 원리의 독립 인증은 아니다.

## 안전장치와 남은 과제

- 기존 BLUE Worker, PWA, Cloudflare, D1·Turso 스키마, 토큰 발급기, 시세 수집 스케줄을 변경하지 않는다.
- 새 액션은 `workflow_dispatch`, `main`, `permissions: contents:read`, `actions/checkout`의 `persist-credentials:false`로만 실행한다.
- 시세 GET 2회 외 새로운 KIS HTTP 호출은 허용하지 않는다. 새 프로그램은 `tokenP`나 주문 URL을 보유하지 않는다.
- 기존 유효 Turso 토큰이 없거나 암호문을 복호화할 수 없으면 실패한다. 외부 API 응답이 이상해도 가격을 0.979배로 추정 생성하지 않는다.
- Stock-Hunter [R9 PR #13](https://github.com/ehdud6728-bit/Stock-Hunter/pull/13)의 전용 Secret 발급 경로는 **별도 선택지로 유지**한다. 본 BLUE 액션은 Stock-Hunter R8 고정 소스를 직접 실행하므로 그 PR을 병합하거나 Stock-Hunter용 KIS Secrets를 등록할 필요는 없다.
- 전체 R116·55일 전수 추세선 재현은 5개 날짜 원천 확인 후 **별도 연구 승인**이 필요하다.
