import { classifyLine, markRuntimeUndefined } from "./classifier";
import { invalidExpressionError, normalizeEvaluationError } from "./errors";
import { evaluateFallbackDocument } from "./fallback";
import { createSymbolRegistry, emptySymbolRegistry } from "./registry";
import type { CalculationRequest, CalculationResponse, DocumentRuntime, SymbolRegistryPayload } from "../types";
import { assignmentName, expressionSource, isComment, isEmpty, sourceLines } from "./lexer";

type NativeEvaluation = { ok: boolean; result: string; error: string };
export type NativeEngine = {
  evaluate(expression: string): NativeEvaluation;
  resetContext(): void;
  delete?(): void;
  getSymbolRegistry?(): string;
};

type NativeEngineModule = { QaltionEngine: new () => NativeEngine };

let nativeEngine: NativeEngine | undefined;
let nativeModulePromise: Promise<NativeEngineModule | undefined> | undefined;
let nativeRegistryPromise: Promise<SymbolRegistryPayload | undefined> | undefined;
let nativeRuntimeFailed = false;

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

function isSymbolRegistryPayload(value: unknown): value is SymbolRegistryPayload {
  if (!value || typeof value !== "object") return false;
  return ["functions", "variables", "units", "currencies", "prefixes"].every((category) => {
    const names = (value as Record<string, unknown>)[category];
    return Array.isArray(names) && names.every((name) => typeof name === "string");
  });
}

async function loadNativeRegistry(module: NativeEngineModule): Promise<SymbolRegistryPayload | undefined> {
  if (!nativeRegistryPromise) {
    nativeRegistryPromise = (async () => {
      try {
        if (!nativeEngine) nativeEngine = new module.QaltionEngine();
        const serialized = nativeEngine.getSymbolRegistry?.();
        if (!serialized) return undefined;
        const parsed: unknown = JSON.parse(serialized);
        return isSymbolRegistryPayload(parsed) ? parsed : undefined;
      } catch (error) {
        console.error("[Qaltion] The native symbol registry could not be loaded.", error);
        if (error instanceof WebAssembly.RuntimeError) {
          nativeEngine = undefined;
          nativeRuntimeFailed = true;
        }
        return undefined;
      }
    })();
  }
  return nativeRegistryPromise;
}

function engineFailure(runtime: DocumentRuntime, failureKind?: DocumentRuntime["failureKind"]): DocumentRuntime {
  return {
    ...runtime,
    status: "error",
    failure: "The calculation engine stopped unexpectedly.",
    failureKind,
  };
}

export function evaluateNativeDocument(
  source: string,
  createEngine: () => NativeEngine,
  registry = emptySymbolRegistry,
): DocumentRuntime {
  const runtime: DocumentRuntime = { lines: [], variables: [], engine: "libqalculate", status: "ready" };
  const definedNames = new Set<string>();
  const assignments: string[] = [];
  let engine: NativeEngine;

  try {
    engine = createEngine();
    engine.resetContext();
  } catch (error) {
    console.error("[Qaltion] The native engine could not be initialized.", error);
    return engineFailure(runtime, "native-runtime");
  }

  for (const line of sourceLines(source)) {
    if (isEmpty(line.text)) continue;
    const tokens = classifyLine(line.text, definedNames, line.from, registry);
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
        tokens: markRuntimeUndefined(tokens, normalizeEvaluationError("Calculation failed")),
      });
      continue;
    }

    let result: NativeEvaluation;
    try {
      result = engine.evaluate(expression);
    } catch (error) {
      console.error("[Qaltion] Native evaluation trapped.", {
        line: line.line,
        expression,
        assignments: [...assignments],
        error,
      });
      const runtimeError = normalizeEvaluationError("Calculation failed");
      runtime.lines.push({
        line: line.line,
        from: line.from,
        to: line.to,
        error: runtimeError,
        tokens: markRuntimeUndefined(tokens, runtimeError),
      });
      return engineFailure(runtime, "native-runtime");
    }

    if (result.ok) {
      runtime.lines.push({ line: line.line, from: line.from, to: line.to, result: result.result, tokens });
      if (name) {
        definedNames.add(name);
        assignments.push(expression);
        runtime.variables.push({ name, value: result.result });
      }
    } else {
      const runtimeError = normalizeEvaluationError(result.error);
      runtime.lines.push({
        line: line.line,
        from: line.from,
        to: line.to,
        error: runtimeError,
        tokens: markRuntimeUndefined(tokens, runtimeError),
      });
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

  if (nativeRuntimeFailed) {
    return engineFailure(
      { lines: [], variables: [], engine: "libqalculate", status: "ready" },
      "native-runtime",
    );
  }

  const payload = await loadNativeRegistry(module);
  if (nativeRuntimeFailed) {
    return engineFailure(
      { lines: [], variables: [], engine: "libqalculate", status: "ready" },
      "native-runtime",
    );
  }
  const registry = createSymbolRegistry(payload);
  const runtime = evaluateNativeDocument(source, () => {
    if (nativeEngine) return nativeEngine;
    nativeEngine = new module.QaltionEngine();
    return nativeEngine;
  }, registry);
  if (runtime.failureKind === "native-runtime") {
    nativeEngine = undefined;
    nativeRuntimeFailed = true;
  }
  return runtime;
}

if (typeof self !== "undefined") self.onmessage = (event: MessageEvent<CalculationRequest>) => {
  if (event.data.type === "get-symbol-registry") {
    void loadNativeModule()
      .then((module) => module ? loadNativeRegistry(module) : undefined)
      .then((registry) => {
        const response: CalculationResponse = { id: event.data.id, type: "symbol-registry", registry };
        self.postMessage(response);
      })
      .catch((error: unknown) => {
        console.error("[Qaltion] The symbol registry request failed.", error);
        const response: CalculationResponse = { id: event.data.id, type: "symbol-registry" };
        self.postMessage(response);
      });
    return;
  }

  void evaluateDocument(event.data.source)
    .then((runtime) => {
      const response: CalculationResponse = runtime.failureKind === "native-runtime"
        ? { id: event.data.id, type: "runtime-failure", runtime }
        : { id: event.data.id, type: "runtime", runtime };
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
      const response: CalculationResponse = { id: event.data.id, type: "runtime", runtime };
      self.postMessage(response);
    });
};
