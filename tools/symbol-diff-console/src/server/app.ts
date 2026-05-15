import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPrBody } from "../shared/prBody";
import { compareRequestSchema, decisionPatchSchema } from "../shared/schema";
import { compareBranches } from "./compare";
import { GitCommandError } from "./gitRepo";
import { loadGitHubRepository } from "./github";
import { SessionStore, SessionStoreError } from "./sessionStore";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();
  const sessions = new SessionStore();

  app.use(express.json({ limit: "1mb" }));

  app.get("/api/defaults", (_req, res) => {
    res.json({
      repoPath: defaultRepoPath(),
      leftRef: "",
      rightRef: "",
      targetRef: ""
    });
  });

  app.get("/api/github/repository", async (req, res) => {
    try {
      const repoPath = typeof req.query.repoPath === "string" && req.query.repoPath.trim() ? req.query.repoPath : defaultRepoPath();
      res.json(await loadGitHubRepository(repoPath));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/api/compare", async (req, res) => {
    try {
      const request = compareRequestSchema.parse(req.body);
      const report = await compareBranches(request);
      const session = await sessions.create(report);
      res.json({ sessionId: session.id, report: session.report });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get("/api/sessions/:id", async (req, res) => {
    try {
      res.json({ session: await sessions.read(req.params.id) });
    } catch (error) {
      sendError(res, error, 404);
    }
  });

  app.patch("/api/sessions/:id/decisions/:symbolId", async (req, res) => {
    try {
      const patch = decisionPatchSchema.parse(req.body);
      const session = await sessions.updateDecision(req.params.id, decodeURIComponent(req.params.symbolId), patch);
      res.json({ session });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get("/api/sessions/:id/pr-body", async (req, res) => {
    try {
      res.json(buildPrBody(await sessions.read(req.params.id)));
    } catch (error) {
      sendError(res, error, 404);
    }
  });

  const staticDir = path.resolve(__dirname, "../../dist/client");
  app.use(express.static(staticDir));
  app.get(/.*/, (_req, res) => {
    res.sendFile(path.join(staticDir, "index.html"));
  });

  return app;
}

function sendError(res: express.Response, error: unknown, status = 400): void {
  if (error instanceof GitCommandError) {
    res.status(status).json({ error: error.structured });
    return;
  }
  if (error instanceof SessionStoreError) {
    res.status(500).json({ error: error.structured });
    return;
  }
  const err = error as Error;
  res.status(status).json({
    error: {
      scope: "unknown",
      code: "request_failed",
      message: err.message || "Request failed",
      recoverable: false
    }
  });
}

function defaultRepoPath(): string {
  const env = process.env.SYMBOL_DIFF_DEFAULT_REPO;
  if (env) return env;
  if (path.basename(process.cwd()) === "symbol-diff-console") {
    return path.resolve(process.cwd(), "../..");
  }
  return process.cwd();
}
