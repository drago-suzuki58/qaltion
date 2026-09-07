import type { AppBlock, DocumentRuntime } from "../types";

type WorkerResponse = { id: number; runtime: DocumentRuntime };

export class CalculationClient {
  private readonly worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  private sequence = 0;
  private readonly pending = new Map<number, (runtime: DocumentRuntime) => void>();

  constructor() {
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      this.pending.get(event.data.id)?.(event.data.runtime);
      this.pending.delete(event.data.id);
    };
  }

  evaluateDocument(blocks: AppBlock[]): Promise<DocumentRuntime> {
    const id = ++this.sequence;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.worker.postMessage({ id, blocks });
    });
  }

  dispose(): void {
    this.worker.terminate();
    this.pending.clear();
  }
}
