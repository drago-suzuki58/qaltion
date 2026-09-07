import type { SemanticToken, SemanticTokenKind } from "../types";

const currencyCodes = new Set(["USD", "JPY", "EUR", "GBP", "CNY", "AUD", "CAD"]);
const knownUnits = new Set([
  "m",
  "km",
  "cm",
  "mm",
  "s",
  "min",
  "h",
  "day",
  "month",
  "year",
  "g",
  "kg",
  "GB",
  "MB",
  "byte",
  "L",
]);
const constants = new Set(["pi", "e", "c", "G"]);

const tokenPattern = /(?:\d+(?:\.\d+)?(?:e[+-]?\d+)?|[A-Za-z_][A-Za-z_0-9]*|[+*/%^=(),-])/gi;

export function lexExpression(expression: string, definedNames: Set<string>): SemanticToken[] {
  const tokens: SemanticToken[] = [];
  for (const match of expression.matchAll(tokenPattern)) {
    const text = match[0];
    const from = match.index ?? 0;
    const to = from + text.length;
    let kind: SemanticTokenKind = "operator";

    if (/^\d/.test(text)) {
      kind = "number";
    } else if (currencyCodes.has(text.toUpperCase())) {
      kind = "currency";
    } else if (knownUnits.has(text)) {
      kind = "unit";
    } else if (constants.has(text)) {
      kind = "constant";
    } else if (/^[A-Za-z_]/.test(text)) {
      const after = expression.slice(to).match(/^\s*=/);
      kind = after ? "definition" : definedNames.has(text) ? "reference" : "undefined";
      if (/^\w+\s*\(/.test(expression.slice(from))) kind = "function";
    }

    tokens.push({ text, from, to, kind });
  }
  return tokens;
}

export function isComment(text: string): boolean {
  return text.startsWith("--");
}

export function isEmpty(text: string): boolean {
  return text.trim().length === 0;
}

export function assignmentName(text: string): string | undefined {
  return text.match(/^\s*([A-Za-z_]\w*)\s*=/)?.[1];
}
