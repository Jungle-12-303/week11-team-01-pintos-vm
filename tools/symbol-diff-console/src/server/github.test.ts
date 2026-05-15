import { describe, expect, it } from "vitest";
import { loadGitHubRepository, parseGitHubRemote } from "./github";
import { createSymbolDiffFixtureRepo } from "../test/fixtureRepo";

describe("parseGitHubRemote", () => {
  it("parses common GitHub remote URL formats", () => {
    expect(parseGitHubRemote("https://github.com/Jungle-12-303/week11-team-01-pintos-vm.git")).toMatchObject({
      owner: "Jungle-12-303",
      name: "week11-team-01-pintos-vm"
    });
    expect(parseGitHubRemote("git@github.com:Jungle-12-303/week11-team-01-pintos-vm.git")).toMatchObject({
      owner: "Jungle-12-303",
      name: "week11-team-01-pintos-vm"
    });
  });
});

describe("loadGitHubRepository", () => {
  it("loads branch options from the GitHub API when origin is GitHub", async () => {
    const repo = createSymbolDiffFixtureRepo({ githubOrigin: true });
    const fetcher = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/branches?per_page=100&page=1")) {
        return jsonResponse([
          { name: "dev", commit: { sha: "a".repeat(40) }, protected: false },
          { name: "pair/heejun-donghyun", commit: { sha: "b".repeat(40) }, protected: true }
        ]);
      }
      return jsonResponse({ default_branch: "dev" });
    };

    const result = await loadGitHubRepository(repo.path, { fetcher: fetcher as typeof fetch, token: null });

    expect(result).toMatchObject({
      platform: "github",
      fullName: "Jungle-12-303/week11-team-01-pintos-vm",
      defaultBranch: "dev",
      source: "github_api"
    });
    expect(result.branches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "dev", ref: "origin/dev", default: true, source: "github" }),
        expect.objectContaining({ name: "pair/heejun-donghyun", ref: "origin/pair/heejun-donghyun", protected: true })
      ])
    );
  });

  it("falls back to local git branch options when no GitHub origin exists", async () => {
    const repo = createSymbolDiffFixtureRepo();
    const result = await loadGitHubRepository(repo.path, { token: null });

    expect(result.source).toBe("local_git_fallback");
    expect(result.branches.map((branch) => branch.ref)).toEqual(expect.arrayContaining(["left", "right", "main"]));
  });
});

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => body
  } as Response;
}
