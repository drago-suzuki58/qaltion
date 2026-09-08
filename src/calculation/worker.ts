import type { CalculationRequest, CalculationResponse, DocumentRuntime } from "../types";
import { invalidExpressionError, normalizeEvaluationError } from "./errors";
import { evaluateFallbackDocument } from "./fallback";
import { assignmentName, expressionSource, isComment, isEmpty, lexExpression, sourceLines } from "./lexer";

type NativeEvaluation = { ok: boolean; result: string; error: string };
export type NativeEngine = {
  evaluate(expression: string): NativeEvaluation;
  resetContext(): void;
  delete?(): void;
};

type NativeEngineModule = { QaltionEngine: new () => NativeEngine };

let nativeEngine: NativeEngine | undefined;
let nativeModulePromise: Promise<NativeEngineModule | undefined> | undefined;

function loadNativeModule(): Promise<NativeEngineModule | undefined> {
  if (!nativeModulePromise) {
    nativeModulePromise = (async () => {
      try {
        const response = await fetch("/wasm/qaltion.js");
        if (!response.ok) throw new Error(`Failed to load native engine: ${response.status}`);
        const moduleUrl = URL.createObjectURL(await response.blob());
        try {
          const factory = (await import(/* @vite-ignore */ moduleUrl)) as {
            default: (options?: Record<string, unknown>) => Promise<NativeEngineModule>;
          };
          return await factory.default({ locateFile: (file: string) => `/wasm/${file}` });
        } finally {
          URL.revokeObjectURL(moduleUrl);
        }
      } catch {
        return undefined;
      }
    })();
  }
  return nativeModulePromise;
}

function engineFailure(runtime: DocumentRuntime): DocumentRuntime {
  return {
    ...runtime,
    status: "error",
    failure: "The calculation engine stopped unexpectedly.",
  };
}

function disposeEngine(engine: NativeEngine): void {
  try {
    engine.delete?.();
  } catch (error) {
    console.error("[Qaltion] The invalid native engine could not be released.", error);
  }
}

function restoreContext(
  previousEngine: NativeEngine,
  createEngine: () => NativeEngine,
  assignments: string[],
): NativeEngine {
  disposeEngine(previousEngine);
  const engine = createEngine();
  try {
    engine.resetContext();
    for (const assignment of assignments) {
      const replay = engine.evaluate(assignment);
      if (!replay.ok) throw new Error("Could not restore calculation context.");
    }
    return engine;
  } catch (error) {
    disposeEngine(engine);
    throw error;
  }
}

export function evaluateNativeDocument(source: string, createEngine: () => NativeEngine): DocumentRuntime {
  const runtime: DocumentRuntime = { lines: [], variables: [], engine: "libqalculate", status: "ready" };
  const definedNames = new Set<string>();
  const assignments: string[] = [];
  let engine: NativeEngine | undefined;

  try {
    engine = createEngine();
    engine.resetContext();
  } catch (error) {
    if (engine) disposeEngine(engine);
    console.error("[Qaltion] The native engine could not be initialized.", error);
    return engineFailure(runtime);
  }

  for (const line of sourceLines(source)) {
    if (isEmpty(line.text)) continue;
    const tokens = lexExpression(line.text, definedNames, line.from);
    if (isComment(line.text)) {
      runtime.lines.push({ line: line.line, from: line.from, to: line.to, tokens });
      continue;
    }
    const expression = expressionSource(line.text);
    const name = assignmentName(expression);
    if (name && expression.slice(expression.indexOf("=") + 1).trim().length === 0) {
      runtime.lines.push({
        line: line.line,
        from: line.from,
        to: line.to,
        error: invalidExpressionError,
        tokens,
      });
      continue;
    }

    let result: NativeEvaluation;
    try {
      result = engine.evaluate(expression);
    } catch (error) {
      console.error(`[Qaltion] Native evaluation trapped on line ${line.line}.`, error);
      runtime.lines.push({
        line: line.line,
        from: line.from,
        to: line.to,
        error: normalizeEvaluationError("Calculation failed"),
        tokens,
      });
      try {
        engine = restoreContext(engine, createEngine, assignments);
      } catch (recoveryError) {
        console.error("[Qaltion] The native engine could not recover.", recoveryError);
        return engineFailure(runtime);
      }
      continue;
    }

    if (result.ok) {
      runtime.lines.push({ line: line.line, from: line.from, to: line.to, result: result.result, tokens });
      if (name) {
        definedNames.add(name);
        assignments.push(expression);
        runtime.variables.push({ name, value: result.result });
      }
    } else {
      runtime.lines.push({
        line: line.line,
        from: line.from,
        to: line.to,
        error: normalizeEvaluationError(result.error),
        tokens,
      });
      try {
        engine = restoreContext(engine, createEngine, assignments);
      } catch (error) {
        console.error("[Qaltion] The native engine could not recover.", error);
        return engineFailure(runtime);
      }
    }
  }
  return runtime;
}

export async function evaluateDocument(source: string): Promise<DocumentRuntime> {
  const module = await loadNativeModule();

  if (!module) {
    const runtime = evaluateFallbackDocument(source);
    return { ...runtime, engine: "development-fallback", status: "ready" };
  }

  let useCurrentEngine = true;
  const runtime = evaluateNativeDocument(source, () => {
    if (useCurrentEngine && nativeEngine) {
      useCurrentEngine = false;
      return nativeEngine;
    }
    useCurrentEngine = false;
    nativeEngine = new module.QaltionEngine();
    return nativeEngine;
  });
  if (runtime.status === "error") nativeEngine = undefined;
  return runtime;
}

if (typeof self !== "undefined") self.onmessage = (event: MessageEvent<CalculationRequest>) => {
  void evaluateDocument(event.data.source)
    .then((runtime) => {
      const response: CalculationResponse = { id: event.data.id, runtime };
      self.postMessage(response);
    })
    .catch((error: unknown) => {
      console.error("[Qaltion] The calculation request failed.", error);
      const runtime: DocumentRuntime = {
        lines: [],
        variables: [],
        engine: "development-fallback",
        status: "error",
        failure: "The calculation engine is unavailable.",
      };
      const response: CalculationResponse = { id: event.data.id, runtime };
      self.postMessage(response);
    });
};
