import { execFile } from "node:child_process";
import { constants, promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { CompareLimits } from "../shared/limits";
import type { StructuredError } from "../shared/schema";

const execFileAsync = promisify(execFile);

export class GitCommandError extends Error {
  readonly structured: StructuredError;

  constructor(structured: StructuredError) {
    super(structured.message);
    this.name = "GitCommandError";
    this.structured = structured;
  }
}

export type NameStatusEntry = {
  status: "added" | "deleted" | "modified" | "renamed";
  path: string;
  oldPath?: string;
};

export class GitRepo {
  readonly repoPath: string;
  private readonly limits: CompareLimits;

  constructor(repoPath: string, limits: CompareLimits) {
    this.repoPath = path.resolve(repoPath);
    this.limits = limits;
  }

  async validate(): Promise<string> {
    const stat = await fs.stat(this.repoPath).catch(() => null);
    if (!stat?.isDirectory()) {
      throw new GitCommandError({
        scope: "repo",
        code: "repo_not_found",
        message: `Repository path does not exist or is not a directory: ${this.repoPath}`,
        recoverable: false
      });
    }
    await fs.access(this.repoPath, constants.R_OK);
    return (await this.run(["rev-parse", "--show-toplevel"], "repo")).trim();
  }

  async resolveRef(ref: string): Promise<string> {
    return (await this.run(["rev-parse", "--verify", `${ref}^{commit}`], "ref", ref)).trim();
  }

  async diffNameStatus(leftRef: string, rightRef: string): Promise<NameStatusEntry[]> {
    const output = await this.run(["diff", "--name-status", leftRef, rightRef, "--"], "repo");
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split(/\t+/);
        const rawStatus = parts[0] ?? "M";
        if (rawStatus.startsWith("R")) {
          return { status: "renamed" as const, oldPath: parts[1], path: parts[2] ?? parts[1] ?? "" };
        }
        const status: NameStatusEntry["status"] = rawStatus === "A" ? "added" : rawStatus === "D" ? "deleted" : "modified";
        return { status, path: parts[1] ?? "" };
      })
      .filter((entry) => entry.path.length > 0);
  }

  async remoteUrl(remote = "origin"): Promise<string> {
    return (await this.run(["remote", "get-url", remote], "repo")).trim();
  }

  async branchOptions(remote = "origin"): Promise<Array<{ name: string; ref: string; sha: string | null; source: "local_git" }>> {
    const output = await this.run(
      ["for-each-ref", "--format=%(refname:short)%09%(objectname)", `refs/remotes/${remote}`, "refs/heads"],
      "repo"
    );
    const seen = new Set<string>();
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [ref = "", sha = ""] = line.split("\t");
        const isRemote = ref.startsWith(`${remote}/`);
        const name = isRemote ? ref.slice(remote.length + 1) : ref;
        return { name, ref, sha: sha || null, source: "local_git" as const, isRemote };
      })
      .filter((branch) => branch.name !== "HEAD" && branch.name.length > 0)
      .sort((a, b) => Number(b.isRemote) - Number(a.isRemote) || a.name.localeCompare(b.name))
      .filter((branch) => {
        const key = branch.name;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map(({ isRemote: _isRemote, ...branch }) => branch)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async blobSize(ref: string, filePath: string): Promise<number | null> {
    try {
      const output = await this.run(["cat-file", "-s", `${ref}:${filePath}`], "file", ref, filePath);
      const size = Number(output.trim());
      return Number.isFinite(size) ? size : null;
    } catch {
      return null;
    }
  }

  async show(ref: string, filePath: string): Promise<string> {
    return this.run(["show", `${ref}:${filePath}`], "file", ref, filePath);
  }

  private async run(args: string[], scope: StructuredError["scope"], ref?: string, filePath?: string): Promise<string> {
    try {
      const { stdout } = await execFileAsync("git", args, {
        cwd: this.repoPath,
        timeout: this.limits.gitTimeoutMs,
        maxBuffer: this.limits.gitMaxBufferBytes,
        encoding: "utf8",
        windowsHide: true
      });
      return stdout;
    } catch (error) {
      const err = error as NodeJS.ErrnoException & { stderr?: string; signal?: string; killed?: boolean };
      const code = err.killed || err.signal === "SIGTERM" ? "git_timeout" : "git_command_failed";
      const stderr = typeof err.stderr === "string" ? err.stderr.trim() : "";
      throw new GitCommandError({
        scope,
        code,
        message: stderr || err.message || `git ${args[0]} failed`,
        filePath,
        ref,
        recoverable: scope === "file"
      });
    }
  }
}

export function isGitCommandError(error: unknown): error is GitCommandError {
  return error instanceof GitCommandError;
}
