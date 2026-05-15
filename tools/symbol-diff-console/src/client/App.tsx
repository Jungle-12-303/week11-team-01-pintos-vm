import { useEffect, useMemo, useRef, useState } from "react";
import type {
  BranchOption,
  CompareReport,
  CompareResponse,
  DefaultsResponse,
  Decision,
  GitHubRepositoryResponse,
  PrBodyResponse,
  ReviewSession,
  SymbolDiff
} from "../shared/schema";
import { MergeDiff } from "./MergeDiff";

type FormState = {
  repoPath: string;
  leftRef: string;
  rightRef: string;
  targetRef: string;
};

const decisionLabels: Record<Decision, string> = {
  left: "왼쪽 채택",
  right: "오른쪽 채택",
  manual_mix: "수동 조합",
  defer: "보류"
};

export function App() {
  const [form, setForm] = useState<FormState>({ repoPath: "", leftRef: "", rightRef: "", targetRef: "" });
  const [repoInfo, setRepoInfo] = useState<GitHubRepositoryResponse | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [report, setReport] = useState<CompareReport | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [prBody, setPrBody] = useState<PrBodyResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [repoLoading, setRepoLoading] = useState(false);
  const [repoError, setRepoError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const repoLoadSeq = useRef(0);

  useEffect(() => {
    fetchJson<DefaultsResponse>("/api/defaults")
      .then((defaults) => {
        setForm(defaults);
        loadRepository(defaults.repoPath).catch(() => undefined);
      })
      .catch(() => undefined);
    const lastSession = localStorage.getItem("symbol-diff-console:last-session");
    if (lastSession) {
      loadSession(lastSession).catch(() => localStorage.removeItem("symbol-diff-console:last-session"));
    }
  }, []);

  const selectedSymbol = useMemo(
    () => report?.symbols.find((symbol) => symbol.symbolId === selectedId) ?? report?.symbols[0],
    [report, selectedId]
  );

  const highRiskCount = useMemo(() => report?.symbols.filter((symbol) => symbol.riskFlags.length > 0).length ?? 0, [report]);
  const undecidedCount = useMemo(() => report?.symbols.filter((symbol) => !symbol.decision).length ?? 0, [report]);
  const canCompare = Boolean(form.repoPath && form.leftRef && form.rightRef);

  async function loadRepository(repoPath = form.repoPath) {
    if (!repoPath.trim()) return;
    const seq = repoLoadSeq.current + 1;
    repoLoadSeq.current = seq;
    setRepoLoading(true);
    setRepoError(null);
    try {
      const response = await fetchJson<GitHubRepositoryResponse>(
        `/api/github/repository?repoPath=${encodeURIComponent(repoPath.trim())}`
      );
      if (repoLoadSeq.current !== seq) return;
      setRepoInfo(response);
      setForm((current) => ({
        ...current,
        repoPath: response.repoPath,
        leftRef: current.repoPath === response.repoPath ? current.leftRef : "",
        rightRef: current.repoPath === response.repoPath ? current.rightRef : "",
        targetRef: current.repoPath === response.repoPath ? current.targetRef : ""
      }));
    } catch (err) {
      if (repoLoadSeq.current !== seq) return;
      setRepoInfo(null);
      setRepoError(errorMessage(err));
    } finally {
      if (repoLoadSeq.current === seq) {
        setRepoLoading(false);
      }
    }
  }

  async function loadSession(id: string) {
    const response = await fetchJson<{ session: ReviewSession }>(`/api/sessions/${id}`);
    setSessionId(response.session.id);
    setReport(response.session.report);
    setSelectedId(response.session.report.symbols[0]?.symbolId ?? null);
    setPrBody(await fetchJson<PrBodyResponse>(`/api/sessions/${id}/pr-body`));
  }

  async function compare() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchJson<CompareResponse>("/api/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoPath: form.repoPath,
          leftRef: form.leftRef,
          rightRef: form.rightRef,
          targetRef: form.targetRef || undefined
        })
      });
      setSessionId(response.sessionId);
      setReport(response.report);
      setSelectedId(response.report.symbols[0]?.symbolId ?? null);
      localStorage.setItem("symbol-diff-console:last-session", response.sessionId);
      setPrBody(await fetchJson<PrBodyResponse>(`/api/sessions/${response.sessionId}/pr-body`));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function updateDecision(symbol: SymbolDiff, decision: Decision, note = symbol.note ?? "") {
    if (!sessionId) return;
    setError(null);
    try {
      const response = await fetchJson<{ session: ReviewSession }>(
        `/api/sessions/${sessionId}/decisions/${encodeURIComponent(symbol.symbolId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision, note })
        }
      );
      setReport(response.session.report);
      setPrBody(await fetchJson<PrBodyResponse>(`/api/sessions/${sessionId}/pr-body`));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function updateNote(note: string) {
    if (!selectedSymbol?.decision) return;
    await updateDecision(selectedSymbol, selectedSymbol.decision, note);
  }

  async function copyPrBody() {
    if (!prBody || prBody.locked) return;
    await navigator.clipboard.writeText(prBody.markdown);
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <h1>브랜치 심볼 비교</h1>
          <span>위험 심볼 먼저 보기</span>
        </div>
        <div className="compare-strip" aria-label="branch comparison">
          <span className="muted">target</span>
          <span className="target-pill">{branchLabel(repoInfo, form.targetRef, "target 선택 없음")}</span>
          <strong>{report?.refs.left.input ?? branchLabel(repoInfo, form.leftRef, "왼쪽 브랜치 선택")}</strong>
          <span className="arrow">→</span>
          <strong>{report?.refs.right.input ?? branchLabel(repoInfo, form.rightRef, "오른쪽 브랜치 선택")}</strong>
          <span className="resolved">
            resolved {shortSha(report?.refs.left.resolvedCommit)} / {shortSha(report?.refs.right.resolvedCommit)}
          </span>
        </div>
        <button className="ghost-button" disabled={!prBody || prBody.locked} onClick={copyPrBody}>
          PR 본문 복사
        </button>
        <button className="primary-button" disabled>
          Draft PR
        </button>
      </header>

      <section className="compare-form" aria-label="compare refs">
        <div className="repo-field">
          <label>
            repo
            <div className="repo-input-row">
              <input
                aria-label="repo"
                data-testid="repo-input"
                value={form.repoPath}
                onChange={(event) => {
                  repoLoadSeq.current += 1;
                  setForm({ repoPath: event.target.value, leftRef: "", rightRef: "", targetRef: "" });
                  setRepoInfo(null);
                  setRepoError(null);
                  setRepoLoading(false);
                }}
              />
              <button
                className="ghost-button"
                onClick={() => loadRepository()}
                disabled={repoLoading || !form.repoPath}
                data-testid="load-branches-button"
              >
                {repoLoading ? "불러오는 중" : "브랜치 불러오기"}
              </button>
            </div>
          </label>
          <div className={repoError ? "repo-status warning" : "repo-status"}>
            {repoError
              ? repoError
              : repoInfo
                ? `${repoInfo.source === "github_api" ? "GitHub" : "로컬 ref"} · ${repoInfo.fullName ?? "origin 없음"} · ${repoInfo.branches.length}개`
                : "GitHub origin을 읽어 브랜치 목록을 가져옵니다."}
          </div>
        </div>
        <BranchSelect
          label="left"
          value={form.leftRef}
          branches={repoInfo?.branches ?? []}
          placeholder="선택 안 함"
          onChange={(leftRef) => setForm({ ...form, leftRef })}
        />
        <BranchSelect
          label="right"
          value={form.rightRef}
          branches={repoInfo?.branches ?? []}
          placeholder="선택 안 함"
          onChange={(rightRef) => setForm({ ...form, rightRef })}
        />
        <BranchSelect
          label="target"
          value={form.targetRef}
          branches={repoInfo?.branches ?? []}
          placeholder="선택 안 함"
          onChange={(targetRef) => setForm({ ...form, targetRef })}
        />
        <button className="primary-button" onClick={compare} disabled={loading || !canCompare} data-testid="compare-button">
          {loading ? "비교 준비 중…" : "비교"}
        </button>
      </section>

      {error ? <div className="error-banner">{error}</div> : null}

      <main className="workspace">
        <aside className="symbol-sidebar" aria-label="changed symbols">
          <div className="sidebar-header">
            <div>
              <h2>변경 심볼</h2>
              <div className="kpi">{highRiskCount}</div>
              <span>고위험 먼저 보기</span>
            </div>
            <strong>{report?.symbols.length ?? 0}개</strong>
          </div>
          <div className="chip-row">
            <span className="chip danger">고위험</span>
            <span className="chip info">C 함수</span>
            <span className="chip neutral">미결정</span>
          </div>
          {report ? (
            <SymbolList report={report} selectedId={selectedSymbol?.symbolId} onSelect={setSelectedId} />
          ) : (
            <div className="empty-panel">비교할 ref를 선택하세요.</div>
          )}
          <div className="progress-card">
            <h3>검토 진행</h3>
            <p>
              결정 {(report?.symbols.length ?? 0) - undecidedCount} / {report?.symbols.length ?? 0}
            </p>
            <strong className={undecidedCount ? "locked-text" : "ready-text"}>
              {undecidedCount ? `남은 심볼 ${undecidedCount}개 · PR 작성 전 확인` : "모든 결정 완료 · PR 본문 복사 가능"}
            </strong>
          </div>
        </aside>

        <section className="diff-workspace">
          <div className="diff-title">
            <div>
              <h2 className="mono-title">{selectedSymbol?.name ?? "심볼 선택"}</h2>
              <div className="meta-row">
                {selectedSymbol ? <span className="chip info">{selectedSymbol.kind}</span> : null}
                {selectedSymbol?.riskFlags.map((flag) => (
                  <span key={flag} className="chip danger">
                    {flag}
                  </span>
                ))}
              </div>
            </div>
            <span className="split-pill">Split view</span>
          </div>
          <div className="branch-row">
            <span>왼쪽 브랜치</span>
            <code>{report?.refs.left.input ?? branchLabel(repoInfo, form.leftRef, "선택 없음")}</code>
            <span className="arrow">→</span>
            <span>오른쪽 브랜치</span>
            <code>{report?.refs.right.input ?? branchLabel(repoInfo, form.rightRef, "선택 없음")}</code>
          </div>
          <RiskBanner symbol={selectedSymbol} />
          <MergeDiff symbol={selectedSymbol} />
          <div className="fallback-banner">
            <strong>fallback visible</strong>
            <span>parse_error나 skipped file이 있으면 파일 diff와 사유를 이 영역에 유지합니다.</span>
          </div>
          <div className="shortcut-banner">단축키: j/k 심볼 이동 · 1/2/3/4 결정 · Cmd+Enter PR 본문 생성</div>
        </section>

        <aside className="decision-panel" aria-label="decision panel">
          <h2>결정</h2>
          <div className="selected-meta">
            <code>{selectedSymbol?.name ?? "선택 없음"}</code>
            {selectedSymbol?.riskFlags[0] ? <span className="chip danger">{selectedSymbol.riskFlags[0]}</span> : null}
          </div>
          <div className="decision-grid">
            {(["left", "right", "manual_mix", "defer"] as Decision[]).map((decision) => (
              <button
                key={decision}
                className={selectedSymbol?.decision === decision ? "primary-button" : "ghost-button"}
                disabled={!selectedSymbol}
                onClick={() => selectedSymbol && updateDecision(selectedSymbol, decision)}
              >
                {decisionLabels[decision]}
              </button>
            ))}
          </div>
          <label className="note-label">
            리뷰 메모
            <textarea
              value={selectedSymbol?.note ?? ""}
              disabled={!selectedSymbol?.decision}
              onChange={(event) => {
                if (!selectedSymbol) return;
                setReport((current) =>
                  current
                    ? {
                        ...current,
                        symbols: current.symbols.map((symbol) =>
                          symbol.symbolId === selectedSymbol.symbolId ? { ...symbol, note: event.target.value } : symbol
                        ),
                        files: current.files.map((file) => ({
                          ...file,
                          symbols: file.symbols.map((symbol) =>
                            symbol.symbolId === selectedSymbol.symbolId ? { ...symbol, note: event.target.value } : symbol
                          )
                        }))
                      }
                    : current
                );
              }}
              onBlur={(event) => updateNote(event.target.value)}
            />
          </label>
          <h3>PR 본문 미리보기</h3>
          <pre className="pr-preview">{prBody?.markdown ?? "비교를 실행하면 PR 본문이 생성됩니다."}</pre>
          <button className="locked-button" disabled={prBody?.locked ?? true}>
            {prBody?.locked ? `남은 결정 ${prBody.remaining}개 · PR 잠김` : "모든 결정 완료 · PR 본문 복사 가능"}
          </button>
        </aside>
      </main>
    </div>
  );
}

function BranchSelect({
  label,
  value,
  branches,
  placeholder,
  onChange
}: {
  label: string;
  value: string;
  branches: BranchOption[];
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      {label}
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={!branches.length}
        data-testid={`${label}-branch-select`}
      >
        <option value="">{placeholder}</option>
        {branches.map((branch) => (
          <option key={`${branch.source}:${branch.ref}`} value={branch.ref}>
            {branch.name}
            {branch.default ? " · default" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

function SymbolList({
  report,
  selectedId,
  onSelect
}: {
  report: CompareReport;
  selectedId: string | undefined;
  onSelect: (id: string) => void;
}) {
  const groups = new Map<string, SymbolDiff[]>();
  for (const symbol of report.symbols) {
    const list = groups.get(symbol.filePath) ?? [];
    list.push(symbol);
    groups.set(symbol.filePath, list);
  }
  return (
    <div className="symbol-list">
      {[...groups.entries()].map(([filePath, symbols]) => (
        <div key={filePath}>
          <h3 className="file-heading">{filePath}</h3>
          {symbols.map((symbol) => (
            <button
              key={symbol.symbolId}
              className={`symbol-row ${selectedId === symbol.symbolId ? "selected" : ""}`}
              onClick={() => onSelect(symbol.symbolId)}
              data-testid={`symbol-${symbol.name}`}
            >
              <span className={`risk-dot ${symbol.riskFlags.length ? "hot" : "warm"}`} />
              <span className="symbol-copy">
                <strong>{symbol.name}</strong>
                <small>
                  {symbol.decision ? decisionLabels[symbol.decision] : "미결정"} · {symbol.riskFlags[0] ?? symbol.status}
                </small>
              </span>
              {symbol.decision ? <span className="decision-pill">{decisionShort(symbol.decision)}</span> : null}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

function RiskBanner({ symbol }: { symbol: SymbolDiff | undefined }) {
  if (!symbol) return null;
  const hasOffsetRisk = symbol.riskFlags.includes("offset_update_changed");
  if (!hasOffsetRisk) {
    return <div className="risk-banner muted-banner">선택한 심볼의 변경 내용을 확인하고 결정을 남기세요.</div>;
  }
  return (
    <div className="risk-banner">
      <span>동작 차이: 오른쪽 브랜치에 offset 증가가 있습니다.</span>
      <code>ofs += page_read_bytes</code>
    </div>
  );
}

async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error?.message ?? response.statusText);
  }
  return body as T;
}

function shortSha(value: string | null | undefined): string {
  return value ? value.slice(0, 7) : "unresolved";
}

function branchLabel(repoInfo: GitHubRepositoryResponse | null, ref: string, fallback: string): string {
  if (!ref) return fallback;
  return repoInfo?.branches.find((branch) => branch.ref === ref)?.name ?? ref.replace(/^origin\//, "");
}

function decisionShort(decision: Decision): string {
  return decision === "right" ? "오른쪽" : decision === "left" ? "왼쪽" : decision === "manual_mix" ? "수동" : "보류";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "요청에 실패했습니다.";
}
