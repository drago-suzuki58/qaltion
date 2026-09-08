import { all, create, type MathNode, type MathJsInstance, type Unit } from "mathjs";
import type { CalculationVariable, DocumentRuntime, LineRuntime, RuntimeError } from "../types";
import { assignmentName, expressionSource, isComment, isEmpty, lexExpression, sourceLines } from "./lexer";

export type FallbackResult =
  | { ok: true; result: string; variable?: CalculationVariable }
  | { ok: false; error: RuntimeError };

type Scope = Record<string, unknown>;

function createFallbackMath(): MathJsInstance {
  const math = create(all);
  for (const unit of ["USD", "JPY", "EUR", "GBP", "CNY", "AUD", "CAD", "GB"]) {
    try {
      math.createUnit(unit);
    } catch {
      // A unit can already be provided by a future mathjs release.
    }
  }
  return math;
}

function formatValue(math: MathJsInstance, value: unknown, expression: string): string {
  if (typeof value === "number") return math.format(value, { precision: 14 });
  if (typeof value === "bigint") return value.toString();
  if (value && typeof value === "object" && "toString" in value) {
    const unit = value as Unit;
    const formatted = unit.toString();
    if (formatted.includes("/ GB") && /\bUSD\b/.test(expression)) {
      return `${math.format(unit.toNumber(), { precision: 14 })} USD`;
    }
    return formatted;
  }
  return String(value);
}

function looseCurrencySum(math: MathJsInstance, expression: string, scope: Scope): string | undefined {
  if (!expression.includes("+")) return undefined;
  const names = [...expression.matchAll(/\b[A-Za-z_]\w*\b/g)].map((match) => match[0]);
  if (names.some((name) => !(name in scope))) return undefined;

  const values = names.map((name) => scope[name]);
  if (!values.every((value) => value && typeof value === "object" && "toNumber" in value)) {
    return undefined;
  }

  const numericExpression = expression.replace(/\b[A-Za-z_]\w*\b/g, (name) => {
    const value = scope[name] as Unit;
    return String(value.toNumber());
  });
  try {
    const numeric = math.evaluate(numericExpression);
    const firstUnit = String((values[0] as Unit).formatUnits());
    const unit = firstUnit.split(" /")[0];
    return `${math.format(numeric, { precision: 14 })} ${unit}`;
  } catch {
    return undefined;
  }
}

export function evaluateFallback(
  expression: string,
  scope: Scope,
): FallbackResult {
  const math = createFallbackMath();
  const name = assignmentName(expression);
  const source = name ? expression.replace(/^\s*[A-Za-z_]\w*\s*=\s*/, "") : expression;

  try {
    const value = math.evaluate(source, scope);
    if (name) scope[name] = value;
    return {
      ok: true,
      result: formatValue(math, value, source),
      variable: name ? { name, value: formatValue(math, value, source) } : undefined,
    };
  } catch (error) {
    const looseResult = looseCurrencySum(math, expression, scope);
    if (looseResult) return { ok: true, result: looseResult };

    const message = error instanceof Error ? error.message : "Calculation failed";
    const kind: RuntimeError["kind"] = /unit/i.test(message)
      ? "unit"
      : /undefined symbol|undefined variable/i.test(message)
        ? "undefined"
        : /function/i.test(message)
          ? "function"
          : /parse|syntax|unexpected|parenthesis/i.test(message)
            ? "syntax"
            : "calculation";
    return { ok: false, error: { kind, message } };
  }
}

export function evaluateFallbackDocument(
  source: string,
): Omit<DocumentRuntime, "engine" | "status"> {
  const scope: Scope = {};
  const definedNames = new Set<string>();
  const variables: CalculationVariable[] = [];
  const lines: LineRuntime[] = [];

  for (const line of sourceLines(source)) {
    if (isEmpty(line.text)) continue;
    const tokens = lexExpression(line.text, definedNames, line.from);
    if (isComment(line.text)) {
      lines.push({ line: line.line, from: line.from, to: line.to, tokens });
      continue;
    }

    const expression = expressionSource(line.text);
    const outcome = evaluateFallback(expression, scope);
    if (outcome.ok) {
      lines.push({ line: line.line, from: line.from, to: line.to, result: outcome.result, tokens });
      if (outcome.variable) {
        definedNames.add(outcome.variable.name);
        variables.push(outcome.variable);
      }
    } else {
      lines.push({ line: line.line, from: line.from, to: line.to, error: outcome.error, tokens });
    }
  }

  return { lines, variables };
}

export function parseForTests(expression: string): MathNode {
  return createFallbackMath().parse(expression);
}
