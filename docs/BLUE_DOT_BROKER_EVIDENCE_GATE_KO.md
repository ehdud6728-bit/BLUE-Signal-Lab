# 키움 파란 점선 30·2·26 — 브로커 실측 증거 게이트

> **연구 전용. 실제 매매 신호가 아닙니다.** 2026-11-23 수동 Actions [#45192784352](https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/45192784352) 결과로 검토했습니다.

## 목적

계산 모델에서 점선이 하락하는 것과 **키움 MTS의 실제 굵은 파란 점선**이 하락하는 것은 별개입니다. 기존 `kiwoom_30_2_26_observed_match.json`와 수식 충돌 보고서·30일 감사 보고서를 **동일 실행에서 교차 확인**하고, 검증에 필요한 날짜별 실측값을 빠짐없이 표시합니다.

## 현재 실측 증거

- 핵심 두 종목: **하이브 352820**, **캐스텍코리아 071850**.
- 각 종목의 2026-11-05·06·09·10·11·12 총 6거래일: **12개 숫자가 필요**.
- 하이브 11월 12일 키움 선값 **153,078.28원**만 확보. 따라서 **1/12 확인·11/12 미확인**.
- 하이브 같은 날 HLC3 하단 가설 모델 **152,862.20516원**으로 **216.07484원 차이**, 네 후보 모두 표시 소수점 자릿수 기준 수치 일치 실패.
- 해당 하이브 사용자 스크린샷의 시장 세션(KRX/NXT)과 수정주가 설정은 미확인.
- `SHIFT(BBandsUp(30,2),26)`가 키움 파란 5pt선 자체와 같은 값임은 **아직 확정되지 않음**.

## 사용 방법

사용자에게 **실제 값이 보이는 키움 차트 사진** 또는 동일 날짜의 정확한 수치 6개씩을 요청합니다. 비교값을 계산해서 실제 키움값으로 대체 입력하지 않습니다. 반드시 **수식2(원문), 선택된 파란 점선, 선택 날짜의 실제 지표 가격, 차트 가격시장(KRX/NXT), 수정주가 설정**을 함께 확인합니다.

병합 후 수동 연구 워크플로를 `main`에서 `mode=study`로 실행하면 기존 일곱 보고서와 함께 새 `broker_evidence_gate.json`가 아티팩트에 포함됩니다. PR 테스트에서는 오프라인 단위테스트만 실행하며 **공개 시장자료 다운로드조차 하지 않습니다**.

```bash
python scripts/blue_dot_broker_evidence_gate.py \
  --audit output/blue_dot_direction/kiwoom_30_2_26_audit.json \
  --match output/blue_dot_direction/kiwoom_30_2_26_observed_match.json \
  --conflict output/blue_dot_direction/formula_conflict_report.json \
  --out output/blue_dot_direction/broker_evidence_gate.json
```

## 안전 장치

- 모델 비교와 실제 점선 값이 서로 다른 날짜에 묶이면 **실패**.
- 세 보고서의 종목·건수·고정 원본 SHA가 불일치하면 **실패**.
- 실제 6거래일 값이 확보돼도 수식2↔화면선의 직접 연결과 가격 기준 정합성이 해결되지 않으면 **실전 승격 불가**.
- 출력은 항상 `ready_to_use_in_search_or_ai_recommendations=false`. 향후 수식 인증·독립 성과 검증은 별도 승인/코드 심사 없이는 자동 변경되지 않습니다.
- **기존 Worker/UI·D1/Turso·KIS·자동 종목검색·AI 추천·주문/매매 규칙 변경 없음**.

### 이번 작업의 검증 범위

추가 파일: `scripts/blue_dot_broker_evidence_gate.py`, `tests/test_blue_dot_broker_evidence_gate.py`; 수동 연구 워크플로 보고서 생성·아티팩트 업로드만 추가. 본 연구는 실측 부족·가정 체결·표본 중복에 관한 기존 한계를 없애지 않습니다.
