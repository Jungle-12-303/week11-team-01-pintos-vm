import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export type FixtureRepo = {
  path: string;
  leftRef: string;
  rightRef: string;
  targetRef: string;
};

export function createSymbolDiffFixtureRepo(options: { singleSymbol?: boolean; githubOrigin?: boolean } = {}): FixtureRepo {
  const repoPath = mkdtempSync(path.join(tmpdir(), "symbol-diff-fixture-"));
  run(repoPath, "git", ["init", "-b", "main"]);
  run(repoPath, "git", ["config", "user.email", "symbol-diff@example.local"]);
  run(repoPath, "git", ["config", "user.name", "Symbol Diff Test"]);

  writeFileSync(path.join(repoPath, "vm.c"), baseSource());
  run(repoPath, "git", ["add", "vm.c"]);
  run(repoPath, "git", ["commit", "-m", "base"]);

  run(repoPath, "git", ["checkout", "-b", "left"]);
  writeFileSync(path.join(repoPath, "vm.c"), leftSource(options.singleSymbol));
  run(repoPath, "git", ["add", "vm.c"]);
  run(repoPath, "git", ["commit", "-m", "left branch"]);

  run(repoPath, "git", ["checkout", "main"]);
  run(repoPath, "git", ["checkout", "-b", "right"]);
  writeFileSync(path.join(repoPath, "vm.c"), rightSource(options.singleSymbol));
  if (!options.singleSymbol) {
    writeFileSync(path.join(repoPath, "binary.c"), "not-c\0binary");
    writeFileSync(path.join(repoPath, "notes.txt"), "unsupported text change\n");
  }
  run(repoPath, "git", ["add", "."]);
  run(repoPath, "git", ["commit", "-m", "right branch"]);

  if ("githubOrigin" in options && options.githubOrigin) {
    run(repoPath, "git", ["remote", "add", "origin", "https://github.com/Jungle-12-303/week11-team-01-pintos-vm.git"]);
  }

  return { path: repoPath, leftRef: "left", rightRef: "right", targetRef: "main" };
}

function run(cwd: string, cmd: string, args: string[]): void {
  execFileSync(cmd, args, { cwd, stdio: "ignore" });
}

function baseSource(): string {
  return `#include <stddef.h>

static int load_segment(int page_read_bytes) {
  int ofs = 0;
  return ofs;
}
`;
}

function leftSource(singleSymbol = false): string {
  const extra = singleSymbol
    ? ""
    : `
struct page {
  int writable;
};

void vm_alloc_page_with_initializer(void) {
  return;
}
`;
  return `#include <stddef.h>
#define PAGE_SIZE 4096

static int load_segment(int page_read_bytes) {
  int ofs = 0;
  return ofs;
}
${extra}`;
}

function rightSource(singleSymbol = false): string {
  const extra = singleSymbol
    ? ""
    : `
#define VM_FLAG(x) ((x) + 1)

struct page {
  int writable;
  int frame;
};

void vm_alloc_page_with_initializer(void) {
  int ok = 1;
  (void)ok;
}
`;
  return `#include <stddef.h>
#define PAGE_SIZE 4096

static int load_segment(int page_read_bytes) {
  int ofs = 0;
  ofs += page_read_bytes;
  return ofs;
}
${extra}`;
}
