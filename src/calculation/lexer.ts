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

const tokenPattern = /(?:\d+(?:\.\d+)?(?:e[+-]?\d+)?|[A-Za-z_][A-Za-z_0-9]*|[$€£¥]|[+*/%^=(),-])/gi;

export type SourceLine = {
  line: number;
  from: number;
  to: number;
  text: string;
};

export function sourceLines(source: string): SourceLine[] {
  let from = 0;
  return source.split("\n").map((raw, index) => {
    const text = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    const line = { line: index + 1, from, to: from + text.length, text };
    from += raw.length + 1;
    return line;
  });
}

export function expressionSource(text: string): string {
  const comment = text.indexOf("#");
  return (comment < 0 ? text : text.slice(0, comment)).trimEnd();
}

export function lexExpression(
  expression: string,
  definedNames: Set<string>,
  documentOffset = 0,
): SemanticToken[] {
  const tokens: SemanticToken[] = [];
  const commentFrom = expression.indexOf("#");
  const calculation = commentFrom < 0 ? expression : expression.slice(0, commentFrom);
  for (const match of calculation.matchAll(tokenPattern)) {
    const text = match[0];
    const localFrom = match.index ?? 0;
    const from = documentOffset + localFrom;
    const to = from + text.length;
    let kind: SemanticTokenKind = "operator";

    if (/^\d/.test(text)) {
      kind = "number";
    } else if (/^[$€£¥]$/.test(text)) {
      kind = "currency";
    } else if (text.toLowerCase() === "to") {
      kind = "operator";
    } else if (currencyCodes.has(text.toUpperCase())) {
      kind = "currency";
    } else if (knownUnits.has(text)) {
      kind = "unit";
    } else if (constants.has(text)) {
      kind = "constant";
    } else if (/^[A-Za-z_]/.test(text)) {
      const after = calculation.slice(localFrom + text.length).match(/^\s*=/);
      kind = after ? "definition" : definedNames.has(text) ? "reference" : "undefined";
      if (/^\w+\s*\(/.test(calculation.slice(localFrom))) kind = "function";
    }

    tokens.push({ text, from, to, kind });
  }
  if (commentFrom >= 0) {
    tokens.push({
      text: expression.slice(commentFrom),
      from: documentOffset + commentFrom,
      to: documentOffset + expression.length,
      kind: "comment",
    });
  }
  return tokens;
}

export function isComment(text: string): boolean {
  return text.trimStart().startsWith("#");
}

export function isEmpty(text: string): boolean {
  return text.trim().length === 0;
}

export function assignmentName(text: string): string | undefined {
  return expressionSource(text).match(/^\s*([A-Za-z_]\w*)\s*=/)?.[1];
}
