import { describe, expect, it } from "vitest";
import { buildLineHunks } from "./lineDiff";

describe("buildLineHunks", () => {
  it("uses a bounded fallback for very large symbols before building an LCS matrix", () => {
    const left = Array.from({ length: 400 }, (_, index) => `left_${index}`).join("\n");
    const right = Array.from({ length: 400 }, (_, index) => `right_${index}`).join("\n");

    const result = buildLineHunks(left, right, 10, 20, 12);

    expect(result.truncated).toBe(true);
    expect(result.hunks[0]?.oldStart).toBe(10);
    expect(result.hunks[0]?.newStart).toBe(20);
    expect(result.hunks[0]?.lines).toHaveLength(12);
    expect(result.hunks[0]?.lines[0]).toMatchObject({ type: "delete", leftLine: 10, text: "left_0" });
  });
});
