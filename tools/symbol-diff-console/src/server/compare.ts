import path from "node:path";
import { defaultLimits, type CompareLimits, withDefaultLimits } from "../shared/limits";
import {
  compareReportSchema,
  type ChangedFile,
  type CompareReport,
  type CompareRequest,
  type RefInfo,
  type SkippedFile,
  type StructuredError,
  type SymbolDiff,
  type SymbolSide
} from "../shared/schema";
import { GitRepo, isGitCommandError, type NameStatusEntry } from "./gitRepo";
import { buildLineHunks } from "./lineDiff";
import { detectRiskFlags } from "./risk";
import { extractSymbols, type ExtractedSymbol } from "./symbols";

const C_EXTENSIONS = new Set([".c", ".h"]);

export async function compareBranches(
  request: CompareRequest,
  limitOverrides: Partial<CompareLimits> = {}
): Promise<CompareReport> {
  const limits = withDefaultLimits({ ...defaultLimits, ...limitOverrides });
  const repo = new GitRepo(request.repoPath, limits);
  const repoRoot = await repo.validate();
  const errors: StructuredError[] = [];
  const skippedFiles: SkippedFile[] = [];
  const truncated = { files: false, symbols: false, hunks: false };

  const left = await resolveRequiredRef(repo, request.leftRef);
  const right = await resolveRequiredRef(repo, request.rightRef);
  const target = request.targetRef ? await resolveOptionalRef(repo, request.targetRef, errors) : undefined;
  const entries = await repo.diffNameStatus(request.leftRef, request.rightRef);
  const visibleEntries = entries.slice(0, limits.maxChangedFiles);

  if (entries.length > visibleEntries.length) {
    truncated.files = true;
    for (const entry of entries.slice(limits.maxChangedFiles)) {
      skippedFiles.push({ path: entry.path, reason: "too_many_files", message: "Changed file cap reached." });
    }
  }

  const files: ChangedFile[] = [];
  const allSymbols: SymbolDiff[] = [];

  for (const entry of visibleEntries) {
    if (!isCFile(entry.path)) {
      skippedFiles.push({ path: entry.path, reason: "unsupported", message: "Only .c and .h files are parsed in MVP." });
      continue;
    }
    const file = await compareFile(repo, entry, left, right, limits, errors, skippedFiles, truncated);
    if (file) {
      files.push(file);
      for (const symbol of file.symbols) {
        if (allSymbols.length < limits.maxSymbols) {
          allSymbols.push(symbol);
        } else {
          truncated.symbols = true;
        }
      }
    }
  }

  const report = compareReportSchema.parse({
    schemaVersion: "1.0",
    repoPath: repoRoot,
    generatedAt: new Date().toISOString(),
    refs: { left, right, target },
    files,
    symbols: allSymbols,
    skippedFiles,
    errors,
    truncated,
    limits
  });
  return report;
}

async function resolveRequiredRef(repo: GitRepo, input: string): Promise<RefInfo> {
  const resolvedCommit = await repo.resolveRef(input);
  return { input, resolvedCommit };
}

async function resolveOptionalRef(repo: GitRepo, input: string, errors: StructuredError[]): Promise<RefInfo> {
  try {
    return { input, resolvedCommit: await repo.resolveRef(input) };
  } catch (error) {
    if (!input.includes("/")) {
      try {
        return { input, resolvedCommit: await repo.resolveRef(`origin/${input}`) };
      } catch {
        // Fall through to report the original user-facing ref failure.
      }
    }
    errors.push(toStructuredError(error, "ref", input));
    return { input, resolvedCommit: null };
  }
}

async function compareFile(
  repo: GitRepo,
  entry: NameStatusEntry,
  left: RefInfo,
  right: RefInfo,
  limits: CompareLimits,
  errors: StructuredError[],
  skippedFiles: SkippedFile[],
  truncated: CompareReport["truncated"]
): Promise<ChangedFile | null> {
  const leftPath = entry.status === "renamed" ? entry.oldPath ?? entry.path : entry.path;
  const rightPath = entry.path;
  const leftSource = entry.status === "added" ? null : await loadBlob(repo, left.input, leftPath, limits, errors, skippedFiles);
  const rightSource = entry.status === "deleted" ? null : await loadBlob(repo, right.input, rightPath, limits, errors, skippedFiles);

  if (leftSource?.skipped || rightSource?.skipped) {
    return null;
  }
  if (!leftSource?.text && !rightSource?.text) {
    return null;
  }

  const leftExtraction = leftSource?.text ? extractSymbols(leftSource.text) : { symbols: [], parseError: false };
  const rightExtraction = rightSource?.text ? extractSymbols(rightSource.text) : { symbols: [], parseError: false };
  if (leftExtraction.parseError || rightExtraction.parseError) {
    errors.push({
      scope: "file",
      code: "parse_error",
      message: "Tree-sitter reported ERROR or MISSING nodes; symbol results are partial.",
      filePath: rightPath,
      recoverable: true
    });
  }

  const symbols = buildSymbolDiffs({
    filePath: rightPath,
    leftPath,
    left,
    right,
    leftSymbols: leftExtraction.symbols,
    rightSymbols: rightExtraction.symbols,
    limits,
    parseError: leftExtraction.parseError || rightExtraction.parseError,
    truncated
  });

  return {
    path: rightPath,
    oldPath: entry.status === "renamed" ? leftPath : undefined,
    status: entry.status,
    symbols,
    parseError: leftExtraction.parseError || rightExtraction.parseError
  };
}

async function loadBlob(
  repo: GitRepo,
  ref: string,
  filePath: string,
  limits: CompareLimits,
  errors: StructuredError[],
  skippedFiles: SkippedFile[]
): Promise<{ text?: string; skipped?: boolean }> {
  const size = await repo.blobSize(ref, filePath);
  if (size !== null && size > limits.maxFileBytes) {
    skippedFiles.push({ path: filePath, reason: "oversized", sizeBytes: size, message: `File exceeds ${limits.maxFileBytes} bytes.` });
    return { skipped: true };
  }
  try {
    const text = await repo.show(ref, filePath);
    if (text.includes("\0")) {
      skippedFiles.push({ path: filePath, reason: "binary", sizeBytes: size ?? undefined, message: "Binary file skipped." });
      return { skipped: true };
    }
    return { text };
  } catch (error) {
    const structured = toStructuredError(error, "file", ref, filePath);
    errors.push(structured);
    skippedFiles.push({ path: filePath, reason: "git_error", message: structured.message });
    return { skipped: true };
  }
}

function buildSymbolDiffs(args: {
  filePath: string;
  leftPath: string;
  left: RefInfo;
  right: RefInfo;
  leftSymbols: ExtractedSymbol[];
  rightSymbols: ExtractedSymbol[];
  limits: CompareLimits;
  parseError: boolean;
  truncated: CompareReport["truncated"];
}): SymbolDiff[] {
  const leftMap = new Map(args.leftSymbols.map((symbol) => [symbolKey(symbol), symbol]));
  const rightMap = new Map(args.rightSymbols.map((symbol) => [symbolKey(symbol), symbol]));
  const keys = new Set([...leftMap.keys(), ...rightMap.keys()]);
  const result: SymbolDiff[] = [];

  for (const key of keys) {
    const left = leftMap.get(key);
    const right = rightMap.get(key);
    if (left && right && left.text === right.text) {
      continue;
    }
    const leftSide = left ? toSide(args.leftPath, args.left.resolvedCommit ?? args.left.input, left) : undefined;
    const rightSide = right ? toSide(args.filePath, args.right.resolvedCommit ?? args.right.input, right) : undefined;
    const { hunks, truncated } = buildLineHunks(
      left?.text ?? "",
      right?.text ?? "",
      left?.startLine ?? 1,
      right?.startLine ?? 1,
      args.limits.maxHunkLines
    );
    if (truncated) {
      args.truncated.hunks = true;
    }
    const name = right?.name ?? left?.name ?? "unknown";
    const kind = right?.kind ?? left?.kind ?? "function";
    const status = !left ? "added_right" : !right ? "deleted" : "modified";
    const baseFlags = [...(left?.riskFlags ?? []), ...(right?.riskFlags ?? [])];
    if (args.parseError) {
      baseFlags.push("parse_error");
    }
    result.push({
      symbolId: makeSymbolId(args.filePath, kind, name),
      filePath: args.filePath,
      name,
      kind,
      status,
      condition: right?.condition ?? left?.condition,
      left: leftSide,
      right: rightSide,
      hunks,
      riskFlags: detectRiskFlags(hunks, baseFlags),
      note: ""
    });
  }

  return result.sort((a, b) => riskWeight(b) - riskWeight(a) || a.filePath.localeCompare(b.filePath) || a.name.localeCompare(b.name));
}

function symbolKey(symbol: ExtractedSymbol): string {
  return `${symbol.kind}:${symbol.name}`;
}

function makeSymbolId(filePath: string, kind: string, name: string): string {
  return `s_${Buffer.from(`${filePath}\0${kind}\0${name}`).toString("base64url")}`;
}

function toSide(filePath: string, resolvedRef: string, symbol: ExtractedSymbol): SymbolSide {
  return {
    filePath,
    startLine: symbol.startLine,
    endLine: symbol.endLine,
    text: symbol.text,
    resolvedRef
  };
}

function riskWeight(symbol: SymbolDiff): number {
  return symbol.riskFlags.includes("offset_update_changed") || symbol.riskFlags.includes("parse_error")
    ? 3
    : symbol.riskFlags.length
      ? 2
      : 1;
}

function isCFile(filePath: string): boolean {
  return C_EXTENSIONS.has(path.extname(filePath));
}

function toStructuredError(error: unknown, scope: StructuredError["scope"], ref?: string, filePath?: string): StructuredError {
  if (isGitCommandError(error)) {
    return { ...error.structured, ref: error.structured.ref ?? ref, filePath: error.structured.filePath ?? filePath };
  }
  const err = error as Error;
  return {
    scope,
    code: "unknown_error",
    message: err.message || "Unknown compare error",
    ref,
    filePath,
    recoverable: scope === "file"
  };
}
