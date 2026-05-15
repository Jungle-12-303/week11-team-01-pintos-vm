import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { defaultLimits, withDefaultLimits } from "../shared/limits";
import { githubRepositoryResponseSchema, type GitHubRepositoryResponse } from "../shared/schema";
import { GitRepo } from "./gitRepo";

const execFileAsync = promisify(execFile);

type ParsedGitHubRemote = {
  owner: string;
  name: string;
  host: string;
};

type FetchLike = typeof fetch;

export async function loadGitHubRepository(
  repoPath: string,
  options: { fetcher?: FetchLike; token?: string | null } = {}
): Promise<GitHubRepositoryResponse> {
  const repo = new GitRepo(repoPath, withDefaultLimits(defaultLimits));
  const root = await repo.validate();
  const remoteUrl = await repo.remoteUrl("origin").catch(() => null);
  const parsed = remoteUrl ? parseGitHubRemote(remoteUrl) : null;

  if (!parsed) {
    return githubRepositoryResponseSchema.parse({
      repoPath: root,
      remoteUrl,
      platform: null,
      owner: null,
      name: null,
      fullName: null,
      defaultBranch: null,
      branches: await repo.branchOptions("origin"),
      source: "local_git_fallback",
      warning: remoteUrl ? "origin remote is not a GitHub repository." : "origin remote is not configured."
    });
  }

  try {
    const token = options.token === undefined ? await githubToken() : options.token;
    const fromApi = await fetchFromGitHub(parsed, options.fetcher ?? fetch, token);
    return githubRepositoryResponseSchema.parse({
      repoPath: root,
      remoteUrl,
      platform: "github",
      owner: parsed.owner,
      name: parsed.name,
      fullName: `${parsed.owner}/${parsed.name}`,
      defaultBranch: fromApi.defaultBranch,
      branches: fromApi.branches.map((branch) => ({
        name: branch.name,
        ref: `origin/${branch.name}`,
        sha: branch.sha,
        protected: branch.protected,
        default: branch.name === fromApi.defaultBranch,
        source: "github"
      })),
      source: "github_api"
    });
  } catch (error) {
    const local = await repo.branchOptions("origin");
    return githubRepositoryResponseSchema.parse({
      repoPath: root,
      remoteUrl,
      platform: "github",
      owner: parsed.owner,
      name: parsed.name,
      fullName: `${parsed.owner}/${parsed.name}`,
      defaultBranch: inferDefaultBranch(local),
      branches: local,
      source: "local_git_fallback",
      warning: error instanceof Error ? error.message : "GitHub API request failed; using local git refs."
    });
  }
}

export function parseGitHubRemote(remoteUrl: string): ParsedGitHubRemote | null {
  const trimmed = remoteUrl.trim().replace(/\.git$/, "");
  const https = /^https:\/\/github\.com\/([^/]+)\/([^/]+)$/i.exec(trimmed);
  if (https) return { host: "github.com", owner: https[1], name: https[2] };
  const ssh = /^git@github\.com:([^/]+)\/([^/]+)$/i.exec(trimmed);
  if (ssh) return { host: "github.com", owner: ssh[1], name: ssh[2] };
  const sshUrl = /^ssh:\/\/git@github\.com\/([^/]+)\/([^/]+)$/i.exec(trimmed);
  if (sshUrl) return { host: "github.com", owner: sshUrl[1], name: sshUrl[2] };
  return null;
}

async function fetchFromGitHub(parsed: ParsedGitHubRemote, fetcher: FetchLike, token: string | null) {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "symbol-diff-console"
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const repoUrl = `https://api.github.com/repos/${parsed.owner}/${parsed.name}`;
  const repoResponse = await fetcher(repoUrl, { headers });
  if (!repoResponse.ok) {
    throw new Error(`GitHub repository request failed: ${repoResponse.status} ${repoResponse.statusText}`);
  }
  const repoJson = (await repoResponse.json()) as { default_branch?: string };

  const branches: Array<{ name: string; sha: string | null; protected?: boolean }> = [];
  for (let page = 1; page <= 10; page += 1) {
    const response = await fetcher(`${repoUrl}/branches?per_page=100&page=${page}`, { headers });
    if (!response.ok) {
      throw new Error(`GitHub branch request failed: ${response.status} ${response.statusText}`);
    }
    const json = (await response.json()) as Array<{ name: string; commit?: { sha?: string }; protected?: boolean }>;
    branches.push(...json.map((branch) => ({ name: branch.name, sha: branch.commit?.sha ?? null, protected: branch.protected })));
    if (json.length < 100) break;
  }

  return {
    defaultBranch: repoJson.default_branch ?? inferDefaultBranch(branches.map((branch) => ({ name: branch.name }))),
    branches: branches.sort((a, b) => a.name.localeCompare(b.name))
  };
}

async function githubToken(): Promise<string | null> {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    const { stdout } = await execFileAsync("gh", ["auth", "token"], {
      timeout: 2000,
      maxBuffer: 20_000,
      encoding: "utf8",
      windowsHide: true
    });
    const token = stdout.trim();
    return token || null;
  } catch {
    return null;
  }
}

function inferDefaultBranch(branches: Array<{ name: string }>): string | null {
  if (branches.some((branch) => branch.name === "main")) return "main";
  if (branches.some((branch) => branch.name === "master")) return "master";
  return branches[0]?.name ?? null;
}
