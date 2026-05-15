# Symbol Diff Console

Local MVP for reviewing changed C symbols between two git refs. The package is isolated under `tools/symbol-diff-console/` and does not require a root `package.json`.

## Commands

```bash
npm --prefix tools/symbol-diff-console run dev
npm --prefix tools/symbol-diff-console run compare -- --repo /path/to/repo --left origin/woojin --right origin/pair/heejun-donghyun --target dev --format json
npm --prefix tools/symbol-diff-console test
npm --prefix tools/symbol-diff-console run test:e2e
```

## Boundaries

- Git access goes through `GitRepo`, which uses `execFile` argument arrays with a validated cwd, timeout, and max buffer.
- Branch selectors are populated from the repository's GitHub `origin` via the GitHub REST API when available, with local git refs as a fallback.
- Decisions are written outside the target repo by default at `~/.symbol-diff-console/sessions/<repo-hash>/<session-id>.json`.
- Set `SYMBOL_DIFF_STATE_DIR` to override session storage for tests or temporary runs.
- PR export stays locked until every symbol has one of `left`, `right`, `manual_mix`, or `defer`.
- Large, binary, unsupported, and capped files are reported as skipped/truncated in JSON, the UI, and the PR body.

## Current Scope

This MVP is a read-only review console. It compares branches, extracts C functions/structs/typedefs/macros with Tree-sitter, persists reviewer decisions, and exports a PR body.

GitHub draft PR creation and `manual_mix` patch skeleton/application are intentionally left for the next phase after the read-only workflow is trusted.
