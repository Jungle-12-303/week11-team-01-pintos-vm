import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildPrBody } from "../shared/prBody";
import { type CompareReport } from "../shared/schema";
import { SessionStore } from "./sessionStore";

describe("SessionStore", () => {
  it("persists decisions outside the target repo and applies them on read", async () => {
    const stateDir = mkdtempSync(path.join(tmpdir(), "symbol-diff-state-"));
    const store = new SessionStore(stateDir);
    const created = await store.create(reportFixture());

    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    const updated = await store.updateDecision(created.id, "symbol-1", {
      decision: "right",
      note: "오른쪽 offset 변경 채택"
    });

    expect(updated.report.symbols[0]?.decision).toBe("right");
    expect(updated.report.symbols[0]?.note).toBe("오른쪽 offset 변경 채택");

    const reread = await store.read(created.id);
    expect(reread.report.symbols[0]?.decision).toBe("right");
    expect(buildPrBody(reread)).toMatchObject({ locked: false, remaining: 0 });
  });
});

function reportFixture(): CompareReport {
  return {
    schemaVersion: "1.0",
    repoPath: "/tmp/repo",
    generatedAt: new Date().toISOString(),
    refs: {
      left: { input: "left", resolvedCommit: "a".repeat(40) },
      right: { input: "right", resolvedCommit: "b".repeat(40) }
    },
    files: [
      {
        path: "vm.c",
        status: "modified",
        symbols: [
          {
            symbolId: "symbol-1",
            filePath: "vm.c",
            name: "load_segment",
            kind: "function",
            status: "modified",
            left: { filePath: "vm.c", startLine: 1, endLine: 3, text: "int a(void){return 1;}", resolvedRef: "a".repeat(40) },
            right: { filePath: "vm.c", startLine: 1, endLine: 3, text: "int a(void){return 2;}", resolvedRef: "b".repeat(40) },
            hunks: [],
            riskFlags: []
          }
        ],
        parseError: false
      }
    ],
    symbols: [
      {
        symbolId: "symbol-1",
        filePath: "vm.c",
        name: "load_segment",
        kind: "function",
        status: "modified",
        left: { filePath: "vm.c", startLine: 1, endLine: 3, text: "int a(void){return 1;}", resolvedRef: "a".repeat(40) },
        right: { filePath: "vm.c", startLine: 1, endLine: 3, text: "int a(void){return 2;}", resolvedRef: "b".repeat(40) },
        hunks: [],
        riskFlags: []
      }
    ],
    skippedFiles: [],
    errors: [],
    truncated: { files: false, symbols: false, hunks: false },
    limits: {
      maxChangedFiles: 40,
      maxFileBytes: 512000,
      maxSymbols: 200,
      maxHunkLines: 240,
      gitTimeoutMs: 8000,
      gitMaxBufferBytes: 10485760,
      maxRenderedSymbols: 80
    }
  };
}
