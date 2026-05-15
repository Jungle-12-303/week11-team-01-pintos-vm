# Branch Symbol Diff Console

두 Git ref 사이에서 바뀐 C 심볼을 함수/구조체/매크로 단위로 묶어 검토하는 로컬 MVP입니다.
패키지는 `tools/symbol-diff-console/` 아래에 격리되어 있고, 루트 `package.json`은 필요하지 않습니다.

## 빠른 시작

```bash
npm --prefix tools/symbol-diff-console install
npm --prefix tools/symbol-diff-console run dev
```

- 브라우저 UI: `http://127.0.0.1:5173`
- API 서버: `http://127.0.0.1:5174`
- 기본 비교 대상 저장소: 현재 저장소 루트

화면에서 저장소 경로를 확인한 뒤 `브랜치 불러오기`를 누르면 GitHub `origin` 기반 브랜치 목록을 드롭다운으로 선택할 수 있습니다. `left`, `right`는 필수이고 `target`은 PR 본문 메타데이터용 선택값입니다.

## CLI 사용

JSON 리포트만 파이프에 넘겨야 한다면 npm 실행 배너가 섞이지 않도록 `--silent`를 붙입니다.

```bash
npm --prefix tools/symbol-diff-console --silent run compare -- \
  --repo /path/to/repo \
  --left origin/woojin \
  --right origin/pair/heejun-donghyun \
  --target dev \
  --format json
```

## 개발 명령

```bash
npm --prefix tools/symbol-diff-console test
npm --prefix tools/symbol-diff-console run build
npm --prefix tools/symbol-diff-console run test:e2e
```

## 동작 경계

- Git 접근은 `GitRepo` 어댑터를 통해서만 수행합니다. 내부적으로 shell 문자열 대신 `execFile` 인자 배열, 검증된 cwd, 시간 제한, 출력 크기 제한을 사용합니다.
- 브랜치 선택지는 GitHub REST API에서 먼저 가져오고, 실패하면 로컬 git ref 목록으로 대체합니다.
- GitHub에서 선택한 `origin/<branch>`가 로컬에 아직 없으면 비교 전에 해당 원격 브랜치를 안전한 refspec으로 fetch합니다.
- GitHub 인증은 `GH_TOKEN`, `GITHUB_TOKEN`, `gh auth token` 순서로 시도합니다. 인증이 없어도 공개 저장소는 GitHub API 또는 로컬 ref 대체 경로로 동작할 수 있습니다.
- 결정 기록은 기본적으로 대상 저장소 밖의 `~/.symbol-diff-console/sessions/<repo-hash>/<session-id>.json`에 저장됩니다.
- 테스트나 임시 실행에서는 `SYMBOL_DIFF_STATE_DIR`로 세션 저장 위치를 바꿀 수 있습니다.
- 모든 심볼이 `left`, `right`, `manual_mix`, `defer` 중 하나로 결정되기 전까지 PR 본문 복사는 잠겨 있습니다.
- 대용량, 바이너리, 미지원 확장자, 한도 초과 파일은 JSON, UI, PR 본문에 건너뜀/잘림 항목으로 표시됩니다.

## 문제 해결

| 증상 | 확인할 것 |
| --- | --- |
| 브랜치 목록이 GitHub 대신 `로컬 ref`로 표시됨 | `origin`이 GitHub URL인지, `gh auth status` 또는 토큰 환경 변수가 유효한지 확인합니다. |
| GitHub 드롭다운에서 고른 `origin/<branch>` 비교가 실패함 | 브랜치가 삭제되었거나 권한이 없을 수 있습니다. `gh auth status`와 원격 저장소 접근 권한을 확인합니다. |
| CLI JSON 앞에 npm 로그가 섞임 | `npm --prefix tools/symbol-diff-console --silent run compare -- ...` 형식으로 실행합니다. |
| PR 본문 복사가 비활성화됨 | 모든 변경 심볼에 결정을 남겨야 합니다. 보류도 유효한 결정입니다. |
| 세션 파일을 찾고 싶음 | 기본 위치는 `~/.symbol-diff-console/sessions/`입니다. |

## 현재 범위

이 MVP는 읽기 전용 검토 콘솔입니다. 브랜치를 비교하고, Tree-sitter로 C 함수/구조체/typedef/매크로를 추출하고, 리뷰 결정을 저장하고, PR 본문을 내보냅니다.

GitHub 드래프트 PR 생성과 `manual_mix` 패치 골격/적용은 읽기 전용 검토 흐름이 충분히 안정된 뒤 다음 단계에서 다룹니다.
