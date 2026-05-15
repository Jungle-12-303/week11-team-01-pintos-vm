import type { Hunk, RiskFlag } from "../shared/schema";

export function detectRiskFlags(hunks: Hunk[], baseFlags: RiskFlag[] = []): RiskFlag[] {
  const flags = new Set<RiskFlag>(baseFlags);
  const changedText = hunks
    .flatMap((hunk) => hunk.lines)
    .filter((line) => line.type !== "context")
    .map((line) => line.text)
    .join("\n");

  if (/\bofs\b/.test(changedText) && /page_read_bytes/.test(changedText)) {
    flags.add("offset_update_changed");
  }
  if (/\b(malloc|calloc|palloc_get_page|vm_alloc|file_reopen)\b/.test(changedText)) {
    flags.add("allocation_error_path");
  }
  if (/\b(free|palloc_free_page|file_close|destroy|cleanup)\b/.test(changedText)) {
    flags.add("missing_cleanup");
  }
  if (/\b(writable|readonly|deny_write|allow_write|permission)\b/.test(changedText)) {
    flags.add("permission_change");
  }
  if (hunks.some((hunk) => hunk.lines.length > 120)) {
    flags.add("large_diff");
  }
  return [...flags];
}
