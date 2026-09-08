import type { CalculationRequest, CalculationResponse, DocumentRuntime, RuntimeErrorKind } from "../types";
import { evaluateFallbackDocument } from "./fallback";
import { assignmentName, expressionSource, isComment, isEmpty, lexExpression, sourceLines } from "./lexer";

type NativeEvaluation = { ok: boolean; result: string; error: string };
type NativeEngine = {
  evaluate(expression: string): NativeEvaluation;
  resetContext(): void;
};

function nativeErrorKind(message: string): RuntimeErrorKind {
  if (/undefined symbol/i.test(message)) return "undefined";
  if (/unit/i.test(message)) return "unit";
  if (/function/i.test(message)) return "function";
  if (/parse|syntax|parenthesis/i.test(message)) return "syntax";
  return "calculation";
}

let nativeEngine: NativeEngine | undefined;
let nativeEnginePromise: Promise<NativeEngine | undefined> | undefined;

function loadNativeEngine(): Promise<NativeEngine | undefined> {
  if (!nativeEnginePromise) {
    nativeEnginePromise = (async () => {
      try {
        const response = await fetch("/wasm/qaltion.js");
        if (!response.ok) throw new Error(`Failed to load native engine: ${response.status}`);
        const moduleUrl = URL.createObjectURL(await response.blob());
        try {
          const factory = (await import(/* @vite-ignore */ moduleUrl)) as {
            default: (options?: Record<string, unknown>) => Promise<{ QaltionEngine: new () => NativeEngine }>;
          };
          const module = await factory.default({ locateFile: (file: string) => `/wasm/${file}` });
          nativeEngine = new module.QaltionEngine();
          return nativeEngine;
        } finally {
          URL.revokeObjectURL(moduleUrl);
        }
      } catch {
        return undefined;
      }
    })();
  }
  return nativeEnginePromise;
}

export async function evaluateDocument(source: string): Promise<DocumentRuntime> {
  const engine = await loadNativeEngine();

  if (!engine) {
    const runtime = evaluateFallbackDocument(source);
    return { ...runtime, engine: "development-fallback", status: "ready" };
  }

  engine.resetContext();
  const runtime: DocumentRuntime = { lines: [], variables: [], engine: "libqalculate", status: "ready" };
  const definedNames = new Set<string>();
  for (const line of sourceLines(source)) {
    if (isEmpty(line.text)) continue;
    const tokens = lexExpression(line.text, definedNames, line.from);
    if (isComment(line.text)) {
      runtime.lines.push({ line: line.line, from: line.from, to: line.to, tokens });
      continue;
    }
    const expression = expressionSource(line.text);
    const result = engine.evaluate(expression);
    if (result.ok) {
      runtime.lines.push({ line: line.line, from: line.from, to: line.to, result: result.result, tokens });
      const name = assignmentName(expression);
      if (name) {
        definedNames.add(name);
        runtime.variables.push({ name, value: result.result });
      }
    } else {
      runtime.lines.push({
        line: line.line,
        from: line.from,
        to: line.to,
        error: { kind: nativeErrorKind(result.error), message: result.error },
        tokens,
      });
    }
  }
  return runtime;
}

if (typeof self !== "undefined") self.onmessage = (event: MessageEvent<CalculationRequest>) => {
  void evaluateDocument(event.data.source)
    .then((runtime) => {
      const response: CalculationResponse = { id: event.data.id, runtime };
      self.postMessage(response);
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Calculation failed.";
      const runtime: DocumentRuntime = {
        lines: [],
        variables: [],
        engine: "development-fallback",
        status: "error",
        failure: message,
      };
      const response: CalculationResponse = { id: event.data.id, runtime };
      self.postMessage(response);
    });
};
