import type { Hunk, HunkLine } from "../shared/schema";

export function buildLineHunks(
  leftText: string,
  rightText: string,
  leftStartLine: number,
  rightStartLine: number,
  maxHunkLines: number
): { hunks: Hunk[]; truncated: boolean } {
  const left = splitLines(leftText);
  const right = splitLines(rightText);
  const matrix = buildLcsMatrix(left, right);
  const lines: HunkLine[] = [];
  let i = 0;
  let j = 0;
  let leftLine = leftStartLine;
  let rightLine = rightStartLine;

  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) {
      lines.push({ type: "context", leftLine, rightLine, text: left[i] ?? "" });
      i += 1;
      j += 1;
      leftLine += 1;
      rightLine += 1;
    } else if (j < right.length && (i === left.length || matrix[i][j + 1] >= matrix[i + 1][j])) {
      lines.push({ type: "add", rightLine, text: right[j] ?? "" });
      j += 1;
      rightLine += 1;
    } else if (i < left.length) {
      lines.push({ type: "delete", leftLine, text: left[i] ?? "" });
      i += 1;
      leftLine += 1;
    }
  }

  const changed = lines.some((line) => line.type !== "context");
  const truncated = lines.length > maxHunkLines;
  const visibleLines = truncated ? lines.slice(0, maxHunkLines) : lines;
  return {
    hunks: changed
      ? [
          {
            oldStart: leftStartLine,
            oldLines: left.length,
            newStart: rightStartLine,
            newLines: right.length,
            lines: visibleLines
          }
        ]
      : [],
    truncated
  };
}

function splitLines(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n");
  return normalized.endsWith("\n") ? normalized.slice(0, -1).split("\n") : normalized.split("\n");
}

function buildLcsMatrix(left: string[], right: string[]): number[][] {
  const matrix = Array.from({ length: left.length + 1 }, () => Array<number>(right.length + 1).fill(0));
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      matrix[i][j] = left[i] === right[j] ? matrix[i + 1][j + 1] + 1 : Math.max(matrix[i + 1][j], matrix[i][j + 1]);
    }
  }
  return matrix;
}
