import type { CalculationRequest, CalculationResponse, DocumentRuntime } from "../types";
import { symbolRegistryFromPayload, type QalculateSymbolRegistry } from "./registry";

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: number;
  message: CalculationRequest;
  recoveryAttempts: number;
};

type CalculationMessage =
  | { type: "evaluate"; source: string }
  | { type: "get-symbol-registry" };

function createCalculationWorker(): Worker {
  return new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
}

export class CalculationClient {
  private worker: Worker;
  private sequence = 0;
  private readonly pending = new Map<number, PendingRequest>();
  private symbolRegistryPromise: Promise<QalculateSymbolRegistry | undefined> | undefined;
  private disposed = false;

  constructor(private readonly workerFactory: () => Worker = createCalculationWorker) {
    this.worker = this.startWorker();
  }

  private startWorker(): Worker {
    const worker = this.workerFactory();
    worker.onmessage = (event: MessageEvent<CalculationResponse>) => {
      if (this.worker !== worker) return;
      const response = event.data;
      const request = this.pending.get(response.id);
      if (!request) return;

      if (response.type === "runtime-failure" && request.recoveryAttempts === 0) {
        this.restartWorker();
        return;
      }

      window.clearTimeout(request.timeout);
      this.pending.delete(response.id);
      if (response.type === "runtime" || response.type === "runtime-failure") {
        request.resolve(response.runtime);
      } else {
        request.resolve(symbolRegistryFromPayload(response.registry));
      }
    };
    worker.onerror = () => {
      if (this.worker === worker) this.handleWorkerFailure(new Error("The calculation worker stopped unexpectedly."));
    };
    worker.onmessageerror = () => {
      if (this.worker === worker) this.handleWorkerFailure(new Error("The calculation worker returned an invalid response."));
    };
    return worker;
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
    this.disposed = true;
    this.rejectPending(new Error("The calculation worker was disposed."));
    this.worker.terminate();
  }

  private handleWorkerFailure(error: Error): void {
    const canRecover = [...this.pending.values()].every((request) => request.recoveryAttempts === 0);
    if (!this.disposed && this.pending.size > 0 && canRecover) {
      this.restartWorker();
      return;
    }
    this.rejectPending(error);
  }

  private restartWorker(): void {
    const previousWorker = this.worker;
    previousWorker.onmessage = null;
    previousWorker.onerror = null;
    previousWorker.onmessageerror = null;
    previousWorker.terminate();
    this.worker = this.startWorker();
    for (const request of this.pending.values()) {
      request.recoveryAttempts += 1;
      this.worker.postMessage(request.message);
    }
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
      const message: CalculationRequest = request.type === "evaluate"
        ? { id, type: request.type, source: request.source }
        : { id, type: request.type };
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout,
        message,
        recoveryAttempts: 0,
      });
      this.worker.postMessage(message);
    });
  }
}
