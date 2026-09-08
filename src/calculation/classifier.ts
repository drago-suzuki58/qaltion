import type { RuntimeError, SemanticToken, SemanticTokenKind } from "../types";
import {
  emptySymbolRegistry,
  hasExactSymbol,
  hasSymbol,
  type QalculateSymbolRegistry,
} from "./registry";
import { assignmentName, expressionSource, scanTokens, sourceLines, type RawToken } from "./lexer";

const languageKeywords = new Set([
  "and",
  "bitand",
  "bitor",
  "comb",
  "compl",
  "cross",
  "div",
  "minus",
  "mod",
  "nand",
  "nor",
  "not",
  "or",
  "per",
  "perm",
  "plus",
  "rem",
  "times",
  "to",
  "where",
  "xor",
]);

const conversionKeywords = new Set([
  "bcd",
  "bijective",
  "bin",
  "binary",
  "binary16",
  "binary32",
  "binary64",
  "dec",
  "decimal",
  "doz",
  "dozenal",
  "duo",
  "duodecimal",
  "float",
  "fp16",
  "fp32",
  "fp64",
  "fp80",
  "hex",
  "hexadecimal",
  "oct",
  "octal",
  "roman",
  "sexa",
  "sexagesimal",
]);

function keyword(text: string): boolean {
  return languageKeywords.has(text.toLowerCase());
}

function conversionKeyword(text: string): boolean {
  return conversionKeywords.has(text.toLowerCase());
}

function tokenAt(tokens: RawToken[], index: number): RawToken | undefined {
  return tokens[index];
}

function isFunctionCall(tokens: RawToken[], index: number): boolean {
  return tokenAt(tokens, index + 1)?.text === "(";
}

function matchesExactCategory(
  registry: QalculateSymbolRegistry,
  text: string,
  category: "functions" | "variables" | "units" | "currencies" | "prefixes",
): boolean {
  return hasExactSymbol(registry, category, text);
}

function matchesCategory(
  registry: QalculateSymbolRegistry,
  text: string,
  category: "functions" | "variables" | "units" | "currencies" | "prefixes",
): boolean {
  return hasSymbol(registry, category, text);
}

function exactCategory(
  registry: QalculateSymbolRegistry,
  text: string,
): "functions" | "variables" | "units" | "currencies" | "prefixes" | undefined {
  const categories = ["variables", "currencies", "units", "prefixes", "functions"] as const;
  return categories.find((category) => matchesExactCategory(registry, text, category));
}

function prefixedUnit(
  registry: QalculateSymbolRegistry,
  token: RawToken,
): { prefix: string; unit: string } | undefined {
  const candidates = [...registry.prefixes]
    .filter((prefix) => prefix.length < token.text.length)
    .sort((left, right) => right.length - left.length);

  for (const prefix of candidates) {
    if (!token.text.toLowerCase().startsWith(prefix.toLowerCase())) continue;
    const unit = token.text.slice(prefix.length);
    if (matchesCategory(registry, prefix, "prefixes") && matchesCategory(registry, unit, "units")) {
      return { prefix: token.text.slice(0, prefix.length), unit };
    }
  }
  return undefined;
}

function makeToken(raw: RawToken, kind: SemanticTokenKind): SemanticToken {
  return { text: raw.text, from: raw.from, to: raw.to, kind };
}

function classifyIdentifier(
  raw: RawToken,
  index: number,
  tokens: RawToken[],
  registry: QalculateSymbolRegistry,
  definedNames: Set<string>,
  definition: boolean,
): SemanticToken[] {
  if (definition) return [makeToken(raw, "definition")];
  if (definedNames.has(raw.text)) return [makeToken(raw, "reference")];

  const functionCall = isFunctionCall(tokens, index);
  if (functionCall && matchesCategory(registry, raw.text, "functions")) return [makeToken(raw, "function")];

  if (keyword(raw.text) || (conversionKeyword(raw.text) && tokenAt(tokens, index - 1)?.text.toLowerCase() === "to")) {
    return [makeToken(raw, "keyword")];
  }

  const exact = exactCategory(registry, raw.text);
  if (exact === "variables") return [makeToken(raw, "builtin-variable")];
  if (exact === "currencies") return [makeToken(raw, "currency")];
  if (exact === "units") return [makeToken(raw, "unit")];
  if (exact === "prefixes") return [makeToken(raw, "prefix")];
  if (exact === "functions") return [makeToken(raw, "function")];

  if (matchesCategory(registry, raw.text, "variables")) return [makeToken(raw, "builtin-variable")];
  if (matchesCategory(registry, raw.text, "currencies")) return [makeToken(raw, "currency")];
  if (matchesCategory(registry, raw.text, "units")) return [makeToken(raw, "unit")];
  if (matchesCategory(registry, raw.text, "prefixes")) return [makeToken(raw, "prefix")];
  if (matchesCategory(registry, raw.text, "functions")) return [makeToken(raw, "function")];

  const split = prefixedUnit(registry, raw);
  if (split) {
    const prefixTo = raw.from + split.prefix.length;
    return [
      { text: split.prefix, from: raw.from, to: prefixTo, kind: "prefix" },
      { text: split.unit, from: prefixTo, to: raw.to, kind: "unit" },
    ];
  }

  return [makeToken(raw, "identifier")];
}

export function classifyTokens(
  tokens: RawToken[],
  definedNames: Set<string>,
  registry: QalculateSymbolRegistry = emptySymbolRegistry,
): SemanticToken[] {
  const definitionIndex = tokens.findIndex((token) => token.kind !== "comment");
  const isDefinition = definitionIndex >= 0
    && tokens[definitionIndex]?.kind === "identifier"
    && tokens[definitionIndex + 1]?.kind === "operator"
    && tokens[definitionIndex + 1]?.text === "=";

  return tokens.flatMap((raw, index) => {
    if (raw.kind === "comment") return [makeToken(raw, "comment")];
    if (raw.kind === "number") return [makeToken(raw, "number")];
    if (raw.kind === "string") return [makeToken(raw, "string")];
    if (raw.kind === "operator") return [makeToken(raw, "operator")];
    if (raw.kind === "punctuation") return [makeToken(raw, "punctuation")];
    return classifyIdentifier(raw, index, tokens, registry, definedNames, index === definitionIndex && isDefinition);
  });
}

export function classifyLine(
  text: string,
  definedNames: Set<string>,
  documentOffset = 0,
  registry: QalculateSymbolRegistry = emptySymbolRegistry,
): SemanticToken[] {
  return classifyTokens(scanTokens(text, documentOffset), definedNames, registry);
}

export function classifyDocument(source: string, registry: QalculateSymbolRegistry = emptySymbolRegistry): SemanticToken[] {
  const definedNames = new Set<string>();
  return sourceLines(source).flatMap((line) => {
    const tokens = classifyLine(line.text, definedNames, line.from, registry);
    const name = assignmentName(expressionSource(line.text));
    if (name) definedNames.add(name);
    return tokens;
  });
}

export function markRuntimeUndefined(tokens: SemanticToken[], error: RuntimeError): SemanticToken[] {
  if (error.kind !== "undefined") return tokens;
  const unknown = tokens.findIndex((token) => token.kind === "identifier");
  if (unknown < 0) return tokens;
  return tokens.map((token, index) => index === unknown ? { ...token, kind: "undefined" as const } : token);
}
