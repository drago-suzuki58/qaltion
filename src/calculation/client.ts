import type { CalculationRequest, CalculationResponse, DocumentRuntime } from "../types";
import { symbolRegistryFromPayload, type QalculateSymbolRegistry } from "./registry";

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: number;
};

type CalculationMessage =
  | { type: "evaluate"; source: string }
  | { type: "get-symbol-registry" };

export class CalculationClient {
  private readonly worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  private sequence = 0;
  private readonly pending = new Map<number, PendingRequest>();
  private symbolRegistryPromise: Promise<QalculateSymbolRegistry | undefined> | undefined;

  constructor() {
    this.worker.onmessage = (event: MessageEvent<CalculationResponse>) => {
      const request = this.pending.get(event.data.id);
      if (!request) return;
      window.clearTimeout(request.timeout);
      this.pending.delete(event.data.id);
      if (event.data.type === "runtime") request.resolve(event.data.runtime);
      else request.resolve(symbolRegistryFromPayload(event.data.registry));
    };
    this.worker.onerror = () => this.rejectPending(new Error("The calculation worker stopped unexpectedly."));
    this.worker.onmessageerror = () => this.rejectPending(new Error("The calculation worker returned an invalid response."));
  }

  evaluateDocument(source: string): Promise<DocumentRuntime> {
    return this.request<DocumentRuntime>({ type: "evaluate", source });
  }

  getSymbolRegistry(): Promise<QalculateSymbolRegistry | undefined> {
    if (!this.symbolRegistryPromise) {
      this.symbolRegistryPromise = this.request<QalculateSymbolRegistry | undefined>({ type: "get-symbol-registry" });
    }
    return this.symbolRegistryPromise;
  }

  dispose(): void {
    this.rejectPending(new Error("The calculation worker was disposed."));
    this.worker.terminate();
  }

  private rejectPending(error: Error): void {
    for (const request of this.pending.values()) {
      window.clearTimeout(request.timeout);
      request.reject(error);
    }
    this.pending.clear();
  }

  private request<T>(request: CalculationMessage): Promise<T> {
    const id = ++this.sequence;
    return new Promise<T>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Calculation timed out."));
      }, 30_000);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timeout });
      const message: CalculationRequest = request.type === "evaluate"
        ? { id, type: request.type, source: request.source }
        : { id, type: request.type };
      this.worker.postMessage(message);
    });
  }
}
