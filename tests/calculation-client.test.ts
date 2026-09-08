/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import { CalculationClient } from "../src/calculation/client";
import type { CalculationRequest, CalculationResponse, DocumentRuntime } from "../src/types";

const readyRuntime: DocumentRuntime = {
  lines: [],
  variables: [],
  engine: "libqalculate",
  status: "ready",
};

const failedRuntime: DocumentRuntime = {
  lines: [],
  variables: [],
  engine: "libqalculate",
  status: "error",
  failure: "The calculation engine stopped unexpectedly.",
  failureKind: "native-runtime",
};

class FakeWorker {
  onmessage: ((event: MessageEvent<CalculationResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  readonly messages: CalculationRequest[] = [];
  terminated = false;

  postMessage(message: CalculationRequest): void {
    this.messages.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  respond(response: CalculationResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<CalculationResponse>);
  }
}

describe("CalculationClient native runtime recovery", () => {
  it("retries an evaluation in a new Worker after a native trap", async () => {
    const workers: FakeWorker[] = [];
    const client = new CalculationClient(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker as unknown as Worker;
    });

    const result = client.evaluateDocument("1 + 2");
    expect(workers[0].messages).toEqual([{ id: 1, type: "evaluate", source: "1 + 2" }]);

    workers[0].respond({ id: 1, type: "runtime-failure", runtime: failedRuntime });
    expect(workers).toHaveLength(2);
    expect(workers[0].terminated).toBe(true);
    expect(workers[1].messages).toEqual([{ id: 1, type: "evaluate", source: "1 + 2" }]);

    workers[1].respond({ id: 1, type: "runtime", runtime: readyRuntime });
    await expect(result).resolves.toBe(readyRuntime);
    client.dispose();
  });

  it("stops retrying the failed request but can recover a later edit", async () => {
    const workers: FakeWorker[] = [];
    const client = new CalculationClient(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker as unknown as Worker;
    });

    const first = client.evaluateDocument("trap");
    workers[0].respond({ id: 1, type: "runtime-failure", runtime: failedRuntime });
    workers[1].respond({ id: 1, type: "runtime-failure", runtime: failedRuntime });

    await expect(first).resolves.toBe(failedRuntime);
    expect(workers).toHaveLength(2);

    const second = client.evaluateDocument("trap again");
    workers[1].respond({ id: 2, type: "runtime-failure", runtime: failedRuntime });
    expect(workers).toHaveLength(3);
    workers[2].respond({ id: 2, type: "runtime", runtime: readyRuntime });
    await expect(second).resolves.toBe(readyRuntime);
    client.dispose();
  });
});
