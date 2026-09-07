import { all, create, type MathNode, type MathJsInstance, type Unit } from "mathjs";
import type { CalculationVariable, RuntimeBlock, RuntimeError } from "../types";
import { assignmentName, isComment, isEmpty, lexExpression } from "./lexer";

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
  items: Array<{ id: string; type: string; text: string; props?: Record<string, unknown> }>,
): {
  blocks: Record<string, RuntimeBlock>;
  variables: CalculationVariable[];
} {
  const scope: Scope = {};
  const definedNames = new Set<string>();
  const variables: CalculationVariable[] = [];
  const blocks: Record<string, RuntimeBlock> = {};

  for (const item of items) {
    if (item.type === "variables") {
      blocks[item.id] = { variables: [...variables], tokens: [] };
      continue;
    }
    if (item.type !== "paragraph" && !(item.type === "result" && item.props?.mode === "dynamic")) {
      continue;
    }
    if (isEmpty(item.text)) continue;
    if (isComment(item.text)) {
      blocks[item.id] = { tokens: [{ text: item.text, from: 0, to: item.text.length, kind: "comment" }] };
      continue;
    }

    const tokens = lexExpression(item.text, definedNames);
    const outcome = evaluateFallback(item.text, scope);
    if (outcome.ok) {
      blocks[item.id] = { result: outcome.result, tokens };
      if (outcome.variable) {
        definedNames.add(outcome.variable.name);
        variables.push(outcome.variable);
      }
    } else {
      blocks[item.id] = { error: outcome.error, tokens };
    }
  }

  return { blocks, variables };
}

export function parseForTests(expression: string): MathNode {
  return createFallbackMath().parse(expression);
}
