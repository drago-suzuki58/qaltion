import type { AppBlock, DocumentRuntime, RuntimeErrorKind } from "../types";
import { evaluateFallbackDocument } from "./fallback";
import { assignmentName, isComment, isEmpty, lexExpression } from "./lexer";
import { plainText } from "./text";

type WorkerRequest = {
  id: number;
  blocks: AppBlock[];
};

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
let nativeAttempted = false;

async function loadNativeEngine(): Promise<NativeEngine | undefined> {
  if (nativeAttempted) return nativeEngine;
  nativeAttempted = true;
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
}

async function evaluateDocument(blocks: AppBlock[]): Promise<DocumentRuntime> {
  const engine = await loadNativeEngine();
  const items = blocks.map((block) => ({
    id: block.id,
    type: block.type,
    text: plainText(block.content),
    props: block.props,
  }));

  if (!engine) {
    const runtime = evaluateFallbackDocument(items);
    return { ...runtime, engine: "development-fallback" };
  }

  engine.resetContext();
  const runtime: DocumentRuntime = { blocks: {}, variables: [], engine: "libqalculate" };
  const definedNames = new Set<string>();
  for (const item of items) {
    if (item.type === "variables") {
      runtime.blocks[item.id] = { variables: [...runtime.variables], tokens: [] };
      continue;
    }
    if (item.type !== "paragraph" && !(item.type === "result" && item.props?.mode === "dynamic")) continue;
    if (isEmpty(item.text)) continue;
    if (isComment(item.text)) {
      runtime.blocks[item.id] = { tokens: [{ text: item.text, from: 0, to: item.text.length, kind: "comment" }] };
      continue;
    }
    const tokens = lexExpression(item.text, definedNames);
    const result = engine.evaluate(item.text);
    if (result.ok) {
      runtime.blocks[item.id] = { result: result.result, tokens };
      const name = assignmentName(item.text);
      if (name) {
        definedNames.add(name);
        runtime.variables.push({ name, value: result.result });
      }
    } else {
      runtime.blocks[item.id] = { error: { kind: nativeErrorKind(result.error), message: result.error }, tokens };
    }
  }
  return runtime;
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  void evaluateDocument(event.data.blocks).then((runtime) => {
    self.postMessage({ id: event.data.id, runtime });
  });
};
