import { describe, expect, it } from "vitest";
import { compareReportSchema } from "./schema";

describe("compareReportSchema", () => {
  it("rejects malformed reports", () => {
    expect(() =>
      compareReportSchema.parse({
        schemaVersion: "1.0",
        repoPath: "/tmp/repo",
        generatedAt: new Date().toISOString(),
        refs: {},
        files: [],
        symbols: [],
        skippedFiles: [],
        errors: [],
        truncated: { files: false, symbols: false, hunks: false },
        limits: {}
      })
    ).toThrow();
  });
});
