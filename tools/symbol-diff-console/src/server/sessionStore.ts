import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  applyDecisions,
  sessionSchema,
  type CompareReport,
  type DecisionPatch,
  type ReviewSession,
  type StructuredError
} from "../shared/schema";

export class SessionStoreError extends Error {
  readonly structured: StructuredError;

  constructor(structured: StructuredError) {
    super(structured.message);
    this.name = "SessionStoreError";
    this.structured = structured;
  }
}

export class SessionStore {
  private readonly rootDir: string;

  constructor(rootDir = process.env.SYMBOL_DIFF_STATE_DIR ?? path.join(os.homedir(), ".symbol-diff-console", "sessions")) {
    this.rootDir = rootDir;
  }

  async create(report: CompareReport): Promise<ReviewSession> {
    const now = new Date().toISOString();
    const session: ReviewSession = {
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      report,
      decisions: {}
    };
    await this.write(session);
    return session;
  }

  async read(id: string): Promise<ReviewSession> {
    const data = await fs.readFile(await this.pathFor(id), "utf8");
    const session = sessionSchema.parse(JSON.parse(data));
    return { ...session, report: applyDecisions(session.report, session.decisions) };
  }

  async updateDecision(id: string, symbolId: string, patch: DecisionPatch): Promise<ReviewSession> {
    const raw = sessionSchema.parse(JSON.parse(await fs.readFile(await this.pathFor(id), "utf8")));
    const now = new Date().toISOString();
    raw.decisions[symbolId] = {
      decision: patch.decision,
      note: patch.note ?? raw.decisions[symbolId]?.note ?? "",
      updatedAt: now
    };
    raw.updatedAt = now;
    await this.write(raw);
    return { ...raw, report: applyDecisions(raw.report, raw.decisions) };
  }

  private async write(session: ReviewSession): Promise<void> {
    const repoHash = repoHashFor(session.report.repoPath);
    const dir = path.join(this.rootDir, repoHash);
    try {
      await fs.mkdir(dir, { recursive: true });
      const file = path.join(dir, `${session.id}.json`);
      await fs.writeFile(file, `${JSON.stringify(session, null, 2)}\n`, "utf8");
    } catch (error) {
      const err = error as Error;
      throw new SessionStoreError({
        scope: "session",
        code: "session_write_failed",
        message: err.message || "Failed to write review session.",
        recoverable: true
      });
    }
  }

  private async pathFor(id: string): Promise<string> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      throw new Error(`Invalid session id: ${id}`);
    }
    const repoDirs = await fs.readdir(this.rootDir, { withFileTypes: true }).catch(() => []);
    for (const dirent of repoDirs) {
      if (!dirent.isDirectory()) continue;
      const candidate = path.join(this.rootDir, dirent.name, `${id}.json`);
      try {
        await fs.access(candidate);
        return candidate;
      } catch {
        // Keep looking in other repo buckets.
      }
    }
    throw new Error(`Session not found: ${id}`);
  }
}

function repoHashFor(repoPath: string): string {
  return crypto.createHash("sha256").update(repoPath).digest("hex").slice(0, 16);
}
