import { describe, expect, it } from "vitest";
import { extractSymbols } from "./symbols";

describe("extractSymbols", () => {
  it("extracts C functions, structs, typedefs, and macros", () => {
    const result = extractSymbols(`
#define PAGE_SIZE 4096
#ifdef VM
typedef struct page {
  int writable;
} page_t;
#endif
static int load_segment(int page_read_bytes) {
  return page_read_bytes;
}
`);

    expect(result.parseError).toBe(false);
    expect(result.symbols.map((symbol) => `${symbol.kind}:${symbol.name}`)).toEqual(
      expect.arrayContaining(["macro:PAGE_SIZE", "struct:page", "typedef:page_t", "function:load_segment"])
    );
    expect(result.symbols.find((symbol) => symbol.name === "page_t")?.condition).toContain("#ifdef VM");
  });

  it("does not promote a macro body to a function symbol", () => {
    const result = extractSymbols(`
#define DECLARE_FAKE int fake(void) { return 1; }
int real(void) { return 2; }
`);

    const functions = result.symbols.filter((symbol) => symbol.kind === "function").map((symbol) => symbol.name);
    expect(functions).toEqual(["real"]);
  });

  it("marks parser errors without dropping all recoverable symbols", () => {
    const result = extractSymbols(`
int ok(void) { return 1; }
int broken(
`);

    expect(result.parseError).toBe(true);
    expect(result.symbols.some((symbol) => symbol.name === "ok")).toBe(true);
  });
});
