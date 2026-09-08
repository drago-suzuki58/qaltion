import type { RuntimeError, RuntimeErrorKind } from "../types";

function errorKind(message: string): RuntimeErrorKind {
  if (/undefined symbol|undefined variable/i.test(message)) return "undefined";
  if (/unit/i.test(message)) return "unit";
  if (/function/i.test(message)) return "function";
  if (/parse|syntax|unexpected|parenthesis/i.test(message)) return "syntax";
  return "calculation";
}

export function normalizeEvaluationError(message: string): RuntimeError {
  const kind = errorKind(message);
  const messages: Record<RuntimeErrorKind, string> = {
    syntax: "Invalid expression",
    undefined: "Undefined symbol",
    unit: "Incompatible units",
    function: "Unknown function",
    calculation: "Calculation failed",
  };
  return { kind, message: messages[kind] };
}

export const invalidExpressionError: RuntimeError = {
  kind: "syntax",
  message: "Invalid expression",
};
