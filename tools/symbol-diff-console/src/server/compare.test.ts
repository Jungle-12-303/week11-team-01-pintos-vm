import { access } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { compareBranches } from "./compare";
import { createSymbolDiffFixtureRepo } from "../test/fixtureRepo";

describe("compareBranches", () => {
  it("builds a risk-first report for changed C symbols", async () => {
    const repo = createSymbolDiffFixtureRepo();
    const report = await compareBranches({
      repoPath: repo.path,
      leftRef: repo.leftRef,
      rightRef: repo.rightRef,
      targetRef: repo.targetRef
    });

    expect(report.refs.left.resolvedCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(report.refs.right.resolvedCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(report.symbols.map((symbol) => symbol.name)).toEqual(
      expect.arrayContaining(["load_segment", "vm_alloc_page_with_initializer", "page", "VM_FLAG"])
    );

    const loadSegment = report.symbols.find((symbol) => symbol.name === "load_segment");
    expect(loadSegment?.riskFlags).toContain("offset_update_changed");
    expect(loadSegment?.hunks[0]?.lines.some((line) => line.text.includes("ofs += page_read_bytes"))).toBe(true);
    expect(report.skippedFiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "binary.c", reason: "binary" }),
        expect.objectContaining({ path: "notes.txt", reason: "unsupported" })
      ])
    );
  });

  it("reports changed-file caps as skipped/truncated items", async () => {
    const repo = createSymbolDiffFixtureRepo();
    const report = await compareBranches(
      { repoPath: repo.path, leftRef: repo.leftRef, rightRef: repo.rightRef },
      { maxChangedFiles: 1 }
    );

    expect(report.truncated.files).toBe(true);
    expect(report.skippedFiles.some((file) => file.reason === "too_many_files")).toBe(true);
  });

  it("rejects invalid repositories with a structured error", async () => {
    await expect(
      compareBranches({ repoPath: path.join(tmpdir(), "missing-symbol-diff-repo"), leftRef: "left", rightRef: "right" })
    ).rejects.toMatchObject({
      structured: expect.objectContaining({ scope: "repo", code: "repo_not_found", recoverable: false })
    });
  });

  it("does not shell-interpolate malicious-looking refs", async () => {
    const repo = createSymbolDiffFixtureRepo({ singleSymbol: true });
    const marker = path.join(tmpdir(), `symbol-diff-injection-${Date.now()}`);

    await expect(
      compareBranches({
        repoPath: repo.path,
        leftRef: `left;touch ${marker}`,
        rightRef: repo.rightRef
      })
    ).rejects.toMatchObject({
      structured: expect.objectContaining({ scope: "ref", code: "git_command_failed" })
    });
    await expect(access(marker)).rejects.toBeTruthy();
  });
});
