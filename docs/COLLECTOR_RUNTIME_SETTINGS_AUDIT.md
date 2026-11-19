# Collector 배포 전 운영 설정 감사 (읽기 전용)

## 왜 필요한가

2026-11-19 [Turso Mirror Status #44509040935](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/44509040935)는 당일 KIS 저장 시세 **2종목**, 이력 **8건**, 가장 최근 Collector 수신 **15:56:10 KST**를 확인했습니다. 이전 이력 6건보다 늘었지만 **어떤 수집 경로가 활성화되었는지**는 이 기록만으로 알 수 없습니다. PR #43 잠정 일봉 수집기는 코드만 병합되었고 실제 Worker 배포/활성화는 별개입니다.

## 실행 방법

1. PR의 무비밀 CI를 검증한 뒤 사용자가 병합합니다.
2. [BLUE Collector Runtime Settings Audit (READ ONLY)](../.github/workflows/blue_collector_runtime_settings_audit.yml)을 GitHub Actions에서 열어 `main`의 `Run workflow`를 클릭합니다. 입력값은 없습니다.
3. 실행 결과의 `BLUE_COLLECTOR_SETTINGS_AUDIT` 한 줄을 확인합니다. 원문 Cloudflare 응답과 민감한 바인딩 값은 **출력하지 않습니다**.
4. 읽기 전용 감사 성공은 *배포 허가가 아닙니다*. 아래 결과 해석에 따라 현재 운영 미러/파일럿과 새 배포 후보의 영향도를 별도로 검토합니다.

## 방법과 응답

- Cloudflare 공식 `GET /accounts/{account_id}/workers/scripts/blue-market-collector/settings` API만 1회 호출합니다. 기존 배포용 GitHub Actions Secrets의 Cloudflare 토큰/계정 ID를 **읽기 전용 요청에만** 사용하며 토큰·API 원문을 로그에 남기지 않습니다.
- 코드 및 테스트: `tools/turso/collector-runtime-settings-audit.mjs` / `.test.mjs`.
- 허용된 부울 플래그: `COLLECTOR_ENABLED`, `TURSO_MIRROR_ENABLED`, `TURSO_MIRROR_PAUSED`, `TURSO_DIRECT_QUOTES_ENABLED`, `TURSO_PROVISIONAL_QUOTES_ENABLED`, `TURSO_PROVISIONAL_PAUSED`, `TURSO_INSTANT_QUOTES_ENABLED`.
- 파일럿 만료 시각 Secret/변수: `TURSO_MIRROR_PILOT_UNTIL_UTC`, `TURSO_DIRECT_PILOT_UNTIL_UTC`, `TURSO_PROVISIONAL_PILOT_UNTIL_UTC`의 **존재 여부만** 표시합니다.
- 부울 플래그가 일반 문자열로 조회된 경우 정확히 `true`/`false`일 때만 `TRUE`/`FALSE`; `secret_text`는 `SECRET_PRESENT_VALUE_UNKNOWN`, 누락은 `ABSENT`, 모순/형식 불일치는 `UNKNOWN_*`으로 표시. **Secret의 실제 값·파일럿 만료 여부·비공개 앱 키·Turso URL은 출력 금지**.
- `mirror_off_deploy_risk=POTENTIAL_EXISTING_MIRROR_INTERRUPTION`은 운영 FULL 미러가 `true`인 상황에서 배포 후보 `TURSO_MIRROR_ENABLED=false`가 이를 중단시킬 위험이 있다는 뜻. `MIRROR_RUNTIME_UNVERIFIED`는 상태 확인 불가이므로 안전하다는 뜻이 아닙니다.
- `MIRROR_ALREADY_CONFIGURED_OFF`도 **파일럿/Secrets의 숨은 상태**, 실제 KIS 호출 성공, 최신 Worker 배포 버전, D1 수집 건강상태까지 입증하는 결과가 아닙니다.
- API 401/403/404/통신 장애/바인딩 누락 시 고정된 오류 코드만 출력하고 **실패로 끝납니다**. 권한이 부족하면 새 자격 증명을 임의로 추출/발급하거나 우회하지 말고 사용자에게 확인을 요청합니다.

## 하지 않는 작업

- Cloudflare Worker/Secrets/Variables 생성·수정·배포, Cron 호출, KIS tokenP, KIS 시세 조회, D1·Turso SQL, 주문. 모두 **0회**.
- 신규 전체 시장 KIS 잠정 시세 수집 **활성화 없음**. 5·10·30분봉은 사용자 결정대로 이후 정밀분석 온디맨드 기능으로 보류합니다.

## 다음 검증과 배포 위험

현재 저장소의 `collector/wrangler.jsonc`는 `TURSO_MIRROR_ENABLED=false`입니다. 과거 운영 Worker에서 FULL 미러가 `true`였는지, Secrets 기반 파일럿이 진행 중인지, 새 버전 배포가 정상적인 기존 Turso 시세 수신을 중단할지를 **반드시 별도 판단**합니다. 이 감사 결과만 근거로 수동 배포 워크플로의 `confirm_mirror_off`를 입력하지 않습니다.
