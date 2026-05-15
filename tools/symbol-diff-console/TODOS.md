# Branch Symbol Diff Console TODOs

## 다음 단계

- GitHub 드래프트 PR 생성은 PR 본문 내보내기 흐름이 안정화된 뒤 추가한다.
- `manual_mix` 패치 골격 생성과 실제 적용은 읽기 전용 결정 워크플로우를 충분히 신뢰할 수 있게 된 뒤 추가한다.
- 3개 이상 브랜치 비교는 현재 MVP 범위 밖으로 유지한다.

## 리뷰에서 확인된 보완점

- 큰 함수 차이 계산이 서버 CPU/메모리를 과도하게 쓰지 않도록 LCS 계산 전에 작업 예산 또는 제한된 diff 경로를 추가한다.
- GitHub API에서 내려온 `origin/<branch>`가 로컬에 fetch되지 않은 경우를 UI/API에서 명확히 안내하거나 자동 fetch 흐름을 검토한다.
- CLI `--help`, 필수 인자 누락, 지원하지 않는 `--format` 오류를 사용자 친화적인 도움말과 함께 처리한다.
