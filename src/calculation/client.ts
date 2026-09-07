import type { AppBlock, DocumentRuntime } from "../types";

type WorkerResponse = { id: number; runtime: DocumentRuntime };
type PendingRequest = {
  resolve: (runtime: DocumentRuntime) => void;
  reject: (error: Error) => void;
  timeout: number;
};

export class CalculationClient {
  private readonly worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  private sequence = 0;
  private readonly pending = new Map<number, PendingRequest>();

  constructor() {
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const request = this.pending.get(event.data.id);
      if (!request) return;
      window.clearTimeout(request.timeout);
      request.resolve(event.data.runtime);
      this.pending.delete(event.data.id);
    };
    this.worker.onerror = () => this.rejectPending(new Error("The calculation worker stopped unexpectedly."));
    this.worker.onmessageerror = () => this.rejectPending(new Error("The calculation worker returned an invalid response."));
  }

  evaluateDocument(blocks: AppBlock[]): Promise<DocumentRuntime> {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Calculation timed out."));
      }, 30_000);
      this.pending.set(id, { resolve, reject, timeout });
      this.worker.postMessage({ id, blocks });
    });
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
}
