import type { PrBodyResponse, ReviewSession, SymbolDiff } from "./schema";

export function buildPrBody(session: ReviewSession): PrBodyResponse {
  const symbols = session.report.symbols;
  const remaining = symbols.filter((symbol) => !symbol.decision).length;
  const locked = remaining > 0;
  const lines: string[] = [
    "# Symbol diff review",
    "",
    `- Repo: \`${session.report.repoPath}\``,
    `- Left: \`${session.report.refs.left.input}\` (${shortSha(session.report.refs.left.resolvedCommit)})`,
    `- Right: \`${session.report.refs.right.input}\` (${shortSha(session.report.refs.right.resolvedCommit)})`
  ];

  if (session.report.refs.target) {
    lines.push(`- Target: \`${session.report.refs.target.input}\` (${shortSha(session.report.refs.target.resolvedCommit)})`);
  }

  lines.push("", "## Symbol decisions", "");
  for (const symbol of symbols) {
    lines.push(formatSymbolDecision(symbol));
  }

  if (session.report.skippedFiles.length) {
    lines.push("", "## Skipped files", "");
    for (const skipped of session.report.skippedFiles) {
      lines.push(`- \`${skipped.path}\`: ${skipped.reason}${skipped.message ? ` — ${skipped.message}` : ""}`);
    }
  }

  if (session.report.errors.length) {
    lines.push("", "## Parser and compare notes", "");
    for (const error of session.report.errors) {
      const where = error.filePath ? ` \`${error.filePath}\`` : error.ref ? ` \`${error.ref}\`` : "";
      lines.push(`- ${error.code}${where}: ${error.message}`);
    }
  }

  if (locked) {
    lines.push("", `> PR export locked: ${remaining} symbol(s) still need a decision.`);
  }

  return { locked, remaining, markdown: `${lines.join("\n")}\n` };
}

function formatSymbolDecision(symbol: SymbolDiff): string {
  const decision = symbol.decision ?? "undecided";
  const risks = symbol.riskFlags.length ? ` [${symbol.riskFlags.join(", ")}]` : "";
  const note = symbol.note?.trim() ? `\n  - note: ${symbol.note.trim()}` : "";
  return `- \`${symbol.filePath}::${symbol.name}\`: ${decision}${risks}${note}`;
}

function shortSha(value: string | null): string {
  return value ? value.slice(0, 7) : "unresolved";
}
