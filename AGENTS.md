# BLUE Signal Lab — 작업 인계 및 기록 규칙

이 파일은 새 ChatGPT/Codex 대화 또는 새로운 개발 에이전트가 저장소를 다시 열었을 때 가장 먼저 읽기 위한 안내서입니다.

## 먼저 읽을 파일

1. `docs/PROJECT_CONTEXT.md` — 현재 아키텍처, 사용자 의사결정, 제약, 다음 단계
2. `docs/WORK_LOG.md` — 날짜별 진행 이력 및 후속 작업
3. 이번 변경과 관계된 소스 코드, GitHub PR 및 Actions 실행 결과

오래된 README의 버전/배포 현황보다 실제 코드·최신 PR·Actions 상태를 우선합니다.

## 매 작업 후 반드시 기록

기능 수정, 장애 분석, 설계 결정, 배포 준비, PR 작성 및 실제 배포를 수행하면 **같은 PR/커밋에서** 다음을 갱신합니다.

- `docs/WORK_LOG.md`: 날짜(KST), 목표, 변경 파일/PR, 테스트 결과, 배포 여부, 미해결 사항, 바로 다음 작업.
- `docs/PROJECT_CONTEXT.md`: 장기적으로 유효한 구조/정책/우선순위가 바뀌었을 때만 업데이트.
- 가능하면 GitHub Actions 실행 링크, PR 번호, 기준 커밋을 기록. 확인하지 못한 성공을 기록하지 않습니다.

이 문서는 대화 원문을 GitHub에 자동 업로드하는 기능이 **아닙니다**. 대화에서 중요한 결정을 구현·검증할 때 개발 에이전트가 요약을 커밋하도록 하는 규칙입니다. 별도 채팅에서 작업할 때도 이 규칙을 이어갑니다.

## 운영 안전 규칙

- 정확성·누락 방지·안정성을 속도보다 우선합니다. 1분가량 늦은 검증된 시세는 허용됩니다.
- 현재 운영 DB는 Cloudflare D1 `blue-signal-lab-db`; Turso는 먼저 별도 테스트/병행 DB로 붙입니다. 명시적 검증 전 원본 데이터를 삭제하거나 읽기/쓰기를 전환하지 않습니다.
- D1 무료 한도에 근접하거나 차단됐을 때는 운영 DB를 조회해 진단하지 않습니다. Cloudflare GraphQL Analytics, 기존 로그, 코드 분석을 우선합니다.
- 비밀 값(KIS 키, Cloudflare 토큰, Turso 토큰/URL에 포함된 비밀 등)은 소스, 요약 문서, GitHub 로그에 남기지 않습니다. GitHub Actions Secrets/Worker Secrets를 사용합니다.
- GitHub PR 병합, 운영 배포, 데이터 마이그레이션, 자동 복제는 별개 단계입니다. 실제 시행 여부를 분명하게 구분합니다.
- 기존 사용자 변경 사항을 보존하고 무관한 파일을 수정하지 않습니다.

## 새 채팅 시작 예시

"`ehdud6728-bit/BLUE-Signal-Lab` 저장소의 `AGENTS.md`, `docs/PROJECT_CONTEXT.md`, `docs/WORK_LOG.md`를 읽고 최근 PR/Actions와 비교한 뒤, 미완료 작업을 이어서 진행해줘."
