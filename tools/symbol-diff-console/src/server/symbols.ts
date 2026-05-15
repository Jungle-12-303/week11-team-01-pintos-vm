import Parser from "tree-sitter";
import C from "tree-sitter-c";
import type { RiskFlag, SymbolKind } from "../shared/schema";

type Point = { row: number; column: number };
type SyntaxNodeLike = {
  type: string;
  text: string;
  startPosition: Point;
  endPosition: Point;
  childCount: number;
  namedChildCount: number;
  hasError?: boolean;
  isError?: boolean;
  child(index: number): SyntaxNodeLike | null;
  namedChild(index: number): SyntaxNodeLike | null;
  childForFieldName(name: string): SyntaxNodeLike | null;
};

export type ExtractedSymbol = {
  name: string;
  kind: SymbolKind;
  startLine: number;
  endLine: number;
  text: string;
  condition?: string;
  riskFlags: RiskFlag[];
};

export type SymbolExtraction = {
  symbols: ExtractedSymbol[];
  parseError: boolean;
};

const parser = new Parser();
parser.setLanguage(C as never);

export function extractSymbols(source: string): SymbolExtraction {
  const tree = parser.parse(source);
  const symbols: ExtractedSymbol[] = [];
  const parseError = Boolean((tree.rootNode as unknown as SyntaxNodeLike).hasError);

  walk(tree.rootNode as unknown as SyntaxNodeLike, [], (node, conditions) => {
    const extracted = extractNodeSymbol(node, conditions);
    if (extracted) {
      symbols.push(extracted);
    }
  });

  return { symbols: dedupeSymbols(symbols), parseError };
}

function walk(
  node: SyntaxNodeLike,
  conditions: string[],
  onNode: (node: SyntaxNodeLike, conditions: string[]) => void
): void {
  onNode(node, conditions);
  const nextConditions = isPreprocessorCondition(node) ? [...conditions, firstLine(node.text)] : conditions;
  for (let i = 0; i < node.namedChildCount; i += 1) {
    const child = node.namedChild(i);
    if (child) {
      walk(child, nextConditions, onNode);
    }
  }
}

function extractNodeSymbol(node: SyntaxNodeLike, conditions: string[]): ExtractedSymbol | null {
  if (node.type === "function_definition") {
    const declarator = node.childForFieldName("declarator");
    const name = declarator ? findIdentifier(declarator) : findIdentifier(node);
    return name ? makeSymbol(node, name, "function", conditions) : null;
  }
  if (node.type === "struct_specifier") {
    const name = node.childForFieldName("name")?.text ?? findTypeIdentifier(node);
    return name ? makeSymbol(node, name, "struct", conditions) : null;
  }
  if (node.type === "type_definition") {
    const name = findLastIdentifier(node);
    return name ? makeSymbol(node, name, "typedef", conditions) : null;
  }
  if (node.type === "preproc_function_def" || node.type === "preproc_def") {
    const name = findIdentifier(node);
    return name ? makeSymbol(node, name, "macro", conditions) : null;
  }
  return null;
}

function makeSymbol(node: SyntaxNodeLike, name: string, kind: SymbolKind, conditions: string[]): ExtractedSymbol {
  const riskFlags: RiskFlag[] = [];
  if (Boolean(node.hasError) || Boolean(node.isError)) {
    riskFlags.push("parse_error");
  }
  return {
    name,
    kind,
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    text: node.text,
    condition: conditions.length ? conditions.join(" && ") : undefined,
    riskFlags
  };
}

function findIdentifier(node: SyntaxNodeLike): string | null {
  if (node.type === "identifier" || node.type === "field_identifier" || node.type === "type_identifier") {
    return node.text;
  }
  for (let i = 0; i < node.namedChildCount; i += 1) {
    const child = node.namedChild(i);
    if (!child) continue;
    const found = findIdentifier(child);
    if (found) return found;
  }
  return null;
}

function findTypeIdentifier(node: SyntaxNodeLike): string | null {
  if (node.type === "type_identifier") return node.text;
  for (let i = 0; i < node.namedChildCount; i += 1) {
    const child = node.namedChild(i);
    if (!child) continue;
    const found = findTypeIdentifier(child);
    if (found) return found;
  }
  return null;
}

function findLastIdentifier(node: SyntaxNodeLike): string | null {
  let found: string | null = null;
  if (node.type === "identifier" || node.type === "field_identifier" || node.type === "type_identifier") {
    found = node.text;
  }
  for (let i = 0; i < node.namedChildCount; i += 1) {
    const child = node.namedChild(i);
    if (!child) continue;
    const childFound = findLastIdentifier(child);
    if (childFound) found = childFound;
  }
  return found;
}

function isPreprocessorCondition(node: SyntaxNodeLike): boolean {
  return ["preproc_if", "preproc_ifdef", "preproc_ifndef", "preproc_elif"].includes(node.type);
}

function firstLine(text: string): string {
  return text.split("\n")[0]?.trim() ?? text.trim();
}

function dedupeSymbols(symbols: ExtractedSymbol[]): ExtractedSymbol[] {
  const seen = new Set<string>();
  return symbols.filter((symbol) => {
    const key = `${symbol.kind}:${symbol.name}:${symbol.startLine}:${symbol.endLine}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
