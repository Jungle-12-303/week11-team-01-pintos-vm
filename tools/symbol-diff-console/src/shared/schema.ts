import { z } from "zod";
import { limitsSchema } from "./limits";

export const decisionSchema = z.enum(["left", "right", "manual_mix", "defer"]);
export type Decision = z.infer<typeof decisionSchema>;

export const symbolKindSchema = z.enum(["function", "struct", "typedef", "macro", "global"]);
export type SymbolKind = z.infer<typeof symbolKindSchema>;

export const symbolStatusSchema = z.enum([
  "unchanged",
  "modified",
  "added_left",
  "added_right",
  "deleted",
  "moved",
  "renamed",
  "parse_error"
]);
export type SymbolStatus = z.infer<typeof symbolStatusSchema>;

export const riskFlagSchema = z.enum([
  "offset_update_changed",
  "allocation_error_path",
  "missing_cleanup",
  "permission_change",
  "parse_error",
  "large_diff",
  "moved_candidate"
]);
export type RiskFlag = z.infer<typeof riskFlagSchema>;

export const structuredErrorSchema = z.object({
  scope: z.enum(["repo", "ref", "file", "symbol", "session", "unknown"]),
  code: z.string().min(1),
  message: z.string().min(1),
  filePath: z.string().optional(),
  ref: z.string().optional(),
  recoverable: z.boolean().default(true)
});
export type StructuredError = z.infer<typeof structuredErrorSchema>;

export const skippedFileSchema = z.object({
  path: z.string(),
  reason: z.enum(["binary", "oversized", "unsupported", "too_many_files", "git_error"]),
  sizeBytes: z.number().int().nonnegative().optional(),
  message: z.string().optional()
});
export type SkippedFile = z.infer<typeof skippedFileSchema>;

export const refInfoSchema = z.object({
  input: z.string(),
  resolvedCommit: z.string().nullable()
});
export type RefInfo = z.infer<typeof refInfoSchema>;

export const hunkLineSchema = z.object({
  type: z.enum(["context", "add", "delete"]),
  leftLine: z.number().int().positive().optional(),
  rightLine: z.number().int().positive().optional(),
  text: z.string()
});
export type HunkLine = z.infer<typeof hunkLineSchema>;

export const hunkSchema = z.object({
  oldStart: z.number().int().nonnegative(),
  oldLines: z.number().int().nonnegative(),
  newStart: z.number().int().nonnegative(),
  newLines: z.number().int().nonnegative(),
  lines: z.array(hunkLineSchema)
});
export type Hunk = z.infer<typeof hunkSchema>;

export const symbolSideSchema = z.object({
  filePath: z.string(),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  text: z.string(),
  resolvedRef: z.string()
});
export type SymbolSide = z.infer<typeof symbolSideSchema>;

export const symbolDiffSchema = z.object({
  symbolId: z.string(),
  filePath: z.string(),
  name: z.string(),
  kind: symbolKindSchema,
  status: symbolStatusSchema,
  condition: z.string().optional(),
  left: symbolSideSchema.optional(),
  right: symbolSideSchema.optional(),
  hunks: z.array(hunkSchema),
  riskFlags: z.array(riskFlagSchema),
  decision: decisionSchema.optional(),
  note: z.string().optional()
});
export type SymbolDiff = z.infer<typeof symbolDiffSchema>;

export const changedFileSchema = z.object({
  path: z.string(),
  status: z.enum(["added", "deleted", "modified", "renamed"]),
  oldPath: z.string().optional(),
  symbols: z.array(symbolDiffSchema),
  parseError: z.boolean().default(false)
});
export type ChangedFile = z.infer<typeof changedFileSchema>;

export const compareRequestSchema = z.object({
  repoPath: z.string().min(1),
  leftRef: z.string().min(1),
  rightRef: z.string().min(1),
  targetRef: z.preprocess((value) => (value === "" ? undefined : value), z.string().min(1).optional())
});
export type CompareRequest = z.infer<typeof compareRequestSchema>;

export const compareReportSchema = z.object({
  schemaVersion: z.literal("1.0"),
  repoPath: z.string(),
  generatedAt: z.string(),
  refs: z.object({
    left: refInfoSchema,
    right: refInfoSchema,
    target: refInfoSchema.optional()
  }),
  files: z.array(changedFileSchema),
  symbols: z.array(symbolDiffSchema),
  skippedFiles: z.array(skippedFileSchema),
  errors: z.array(structuredErrorSchema),
  truncated: z.object({
    files: z.boolean(),
    symbols: z.boolean(),
    hunks: z.boolean()
  }),
  limits: limitsSchema
});
export type CompareReport = z.infer<typeof compareReportSchema>;

export const decisionRecordSchema = z.object({
  decision: decisionSchema,
  note: z.string().default(""),
  updatedAt: z.string()
});
export type DecisionRecord = z.infer<typeof decisionRecordSchema>;

export const sessionSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  report: compareReportSchema,
  decisions: z.record(z.string(), decisionRecordSchema)
});
export type ReviewSession = z.infer<typeof sessionSchema>;

export const compareResponseSchema = z.object({
  sessionId: z.string(),
  report: compareReportSchema
});
export type CompareResponse = z.infer<typeof compareResponseSchema>;

export const sessionResponseSchema = z.object({
  session: sessionSchema
});
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

export const decisionPatchSchema = z.object({
  decision: decisionSchema,
  note: z.string().optional()
});
export type DecisionPatch = z.infer<typeof decisionPatchSchema>;

export const prBodyResponseSchema = z.object({
  locked: z.boolean(),
  remaining: z.number().int().nonnegative(),
  markdown: z.string()
});
export type PrBodyResponse = z.infer<typeof prBodyResponseSchema>;

export const defaultsResponseSchema = z.object({
  repoPath: z.string(),
  leftRef: z.string(),
  rightRef: z.string(),
  targetRef: z.string()
});
export type DefaultsResponse = z.infer<typeof defaultsResponseSchema>;

export const branchOptionSchema = z.object({
  name: z.string(),
  ref: z.string(),
  sha: z.string().nullable().optional(),
  protected: z.boolean().optional(),
  default: z.boolean().optional(),
  source: z.enum(["github", "local_git"])
});
export type BranchOption = z.infer<typeof branchOptionSchema>;

export const githubRepositoryResponseSchema = z.object({
  repoPath: z.string(),
  remoteUrl: z.string().nullable(),
  platform: z.literal("github").nullable(),
  owner: z.string().nullable(),
  name: z.string().nullable(),
  fullName: z.string().nullable(),
  defaultBranch: z.string().nullable(),
  branches: z.array(branchOptionSchema),
  source: z.enum(["github_api", "local_git_fallback"]),
  warning: z.string().optional()
});
export type GitHubRepositoryResponse = z.infer<typeof githubRepositoryResponseSchema>;

export function applyDecisions(report: CompareReport, decisions: Record<string, DecisionRecord>): CompareReport {
  const symbols = report.symbols.map((symbol) => {
    const record = decisions[symbol.symbolId];
    return record ? { ...symbol, decision: record.decision, note: record.note } : symbol;
  });
  const files = report.files.map((file) => ({
    ...file,
    symbols: file.symbols.map((symbol) => {
      const record = decisions[symbol.symbolId];
      return record ? { ...symbol, decision: record.decision, note: record.note } : symbol;
    })
  }));
  return { ...report, files, symbols };
}
