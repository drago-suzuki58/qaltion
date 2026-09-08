import { describe, expect, it, vi } from "vitest";
import { classifyLine } from "../src/calculation/classifier";
import { evaluateFallbackDocument } from "../src/calculation/fallback";
import { scanTokens } from "../src/calculation/lexer";
import { createSymbolRegistry } from "../src/calculation/registry";
import { evaluateDocument, evaluateNativeDocument, type NativeEngine } from "../src/calculation/worker";

describe("calculation document semantics", () => {
  it("evaluates expressions and unit conversion from a source string", () => {
    const runtime = evaluateFallbackDocument("1 + 2\n5 km to m");

    expect(runtime.lines[0].result).toBe("3");
    expect(runtime.lines[1].result).toBe("5000 m");
  });

  it("skips empty lines and keeps comments without evaluating them", () => {
    const runtime = evaluateFallbackDocument("# heading\n\n1 + 2 # total");

    expect(runtime.lines).toHaveLength(2);
    expect(runtime.lines[0]).toMatchObject({ line: 1, from: 0, to: 9 });
    expect(runtime.lines[0].tokens).toEqual([
      { text: "# heading", from: 0, to: 9, kind: "comment" },
    ]);
    expect(runtime.lines[1]).toMatchObject({ line: 3, from: 11, to: 24, result: "3" });
    expect(runtime.lines[1].tokens.at(-1)).toEqual({
      text: "# total",
      from: 17,
      to: 24,
      kind: "comment",
    });
  });

  it("propagates and replaces variables from top to bottom", () => {
    const runtime = evaluateFallbackDocument("a = 10\na * 2\na = 50\na * 2");

    expect(runtime.lines.map((line) => line.result)).toEqual(["10", "20", "50", "100"]);
    expect(runtime.variables).toEqual([
      { name: "a", value: "10" },
      { name: "a", value: "50" },
    ]);
  });

  it("resets calculation context for every document", () => {
    evaluateFallbackDocument("a = 10");
    const runtime = evaluateFallbackDocument("a * 2");

    expect(runtime.lines[0].error?.kind).toBe("undefined");
  });

  it("reports calculation errors on their logical lines", () => {
    const runtime = evaluateFallbackDocument("1 +\nmissing_value * 2\n5 m + 2 s");

    expect(runtime.lines[0].error).toBeDefined();
    expect(runtime.lines[1].error?.kind).toBe("undefined");
    expect(runtime.lines[2].error?.kind).toBe("unit");
    expect(runtime.lines.map((line) => line.error?.message).filter(Boolean)).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/memory access out of bounds/i)]),
    );
  });

  it("keeps independent results after an invalid assignment", () => {
    const runtime = evaluateFallbackDocument("x = 5\na =\nx * 10");

    expect(runtime.lines[0].result).toBe("5");
    expect(runtime.lines[1].error?.message).toBe("Invalid expression");
    expect(runtime.lines[2].result).toBe("50");
  });

  it("evaluates the editing stress scenario and recovers after repairing the assignment", () => {
    const initial = evaluateFallbackDocument("1+1\n2+8\n4942563+2455246\na = 100\na * 100");
    expect(initial.lines.map((line) => line.result)).toEqual(["2", "10", "7397809", "100", "10000"]);

    const invalid = evaluateFallbackDocument("1+1\n2+8\n4942563+2455246\na =\na * 100");
    expect(invalid.lines.slice(0, 3).map((line) => line.result)).toEqual(["2", "10", "7397809"]);
    expect(invalid.lines[3].error?.message).toBe("Invalid expression");
    expect(invalid.lines[4].error?.kind).toBe("undefined");

    const repaired = evaluateFallbackDocument("1+1\n2+8\n4942563+2455246\na = 50\na * 100");
    expect(repaired.lines.map((line) => line.result)).toEqual(["2", "10", "7397809", "50", "5000"]);
  });
});

describe("Qaltion lexer", () => {
  it("returns document ranges from the scanner without semantic knowledge", () => {
    const tokens = scanTokens("server = 1200 JPY / month", 10);

    expect(tokens).toEqual(expect.arrayContaining([
      { text: "server", kind: "identifier", from: 10, to: 16 },
      { text: "1200", kind: "number", from: 19, to: 23 },
      { text: "JPY", kind: "identifier", from: 24, to: 27 },
      { text: "month", kind: "identifier", from: 30, to: 35 },
    ]));
  });

  it("classifies the same ranges with a mock libqalculate registry", () => {
    const tokens = classifyLine(
      "server = 1200 JPY / month",
      new Set<string>(),
      10,
      createSymbolRegistry({ currencies: ["JPY"], units: ["month"] }),
    );

    expect(tokens).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: "server", kind: "definition", from: 10, to: 16 }),
      expect.objectContaining({ text: "1200", kind: "number", from: 19, to: 23 }),
      expect.objectContaining({ text: "JPY", kind: "currency" }),
      expect.objectContaining({ text: "month", kind: "unit" }),
    ]));
  });
});

describe("calculation worker document API", () => {
  it("accepts source text and returns line runtimes", async () => {
    const runtime = await evaluateDocument("a = 4\na * 3");

    expect(runtime.engine).toBe("development-fallback");
    expect(runtime.status).toBe("ready");
    expect(runtime.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ line: 1, from: 0, to: 5, result: "4" }),
      expect.objectContaining({ line: 2, from: 6, to: 11, result: "12" }),
    ]));
  });

  it("marks a native trap as fatal without touching the failed engine", () => {
    let generation = 0;
    let disposed = 0;
    const evaluate = vi.fn((expression: string) => {
      if (expression === "trap") throw new WebAssembly.RuntimeError("memory access out of bounds");
      return { ok: true, result: "100", error: "" };
    });
    const createEngine = (): NativeEngine => {
      generation += 1;
      return {
        delete: () => { disposed += 1; },
        resetContext: () => undefined,
        evaluate,
      };
    };
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const runtime = evaluateNativeDocument("a = 100\ntrap\na * 10\n5 km to m", createEngine);

    expect(generation).toBe(1);
    expect(disposed).toBe(0);
    expect(runtime).toMatchObject({ status: "error", failureKind: "native-runtime" });
    expect(runtime.lines).toHaveLength(2);
    expect(runtime.lines[1].error).toEqual({ kind: "calculation", message: "Calculation failed" });
    expect(evaluate).not.toHaveBeenCalledWith("a * 10");
    expect(consoleError).toHaveBeenCalledWith("[Qaltion] Native evaluation trapped.", {
      line: 2,
      expression: "trap",
      assignments: ["a = 100"],
      error: expect.any(WebAssembly.RuntimeError),
    });
    consoleError.mockRestore();
  });

  it("keeps the engine and evaluates later lines after a normal native error", () => {
    let generation = 0;
    let x = 0;
    let disposed = 0;
    const createEngine = (): NativeEngine => {
      generation += 1;
      return {
        delete: () => { disposed += 1; },
        resetContext: () => { x = 0; },
        evaluate: (expression) => {
          if (expression === "x = 5") {
            x = 5;
            return { ok: true, result: "5", error: "" };
          }
          if (expression === "broken") {
            return { ok: false, result: "", error: "Syntax error near broken" };
          }
          return { ok: true, result: String(x * 10), error: "" };
        },
      };
    };

    const runtime = evaluateNativeDocument("x = 5\nbroken\nx * 10", createEngine);

    expect(generation).toBe(1);
    expect(disposed).toBe(0);
    expect(runtime.status).toBe("ready");
    expect(runtime.lines[1].error).toEqual({ kind: "syntax", message: "Invalid expression" });
    expect(runtime.lines[2].result).toBe("50");
  });

  it("recovers across document evaluations while an assignment is being edited", () => {
    let x: number | undefined;
    const engine: NativeEngine = {
      resetContext: () => { x = undefined; },
      evaluate: (expression) => {
        const assignment = expression.match(/^x\s*=\s*(\d+)$/);
        if (assignment) {
          x = Number(assignment[1]);
          return { ok: true, result: assignment[1], error: "" };
        }
        if (expression === "x * 10" && x !== undefined) {
          return { ok: true, result: String(x * 10), error: "" };
        }
        return { ok: false, result: "", error: "Undefined symbol" };
      },
    };
    const createEngine = vi.fn(() => engine);

    expect(evaluateNativeDocument("x = 5\nx * 10", createEngine).lines[1].result).toBe("50");
    const interrupted = evaluateNativeDocument("x =\nx * 10", createEngine);
    expect(interrupted.lines[0].error?.message).toBe("Invalid expression");
    expect(interrupted.lines[1].error?.kind).toBe("undefined");
    expect(evaluateNativeDocument("x = 7\nx * 10", createEngine).lines[1].result).toBe("70");
  });

  it("reuses one engine after registry loading and repeated document resets", () => {
    let value = 0;
    let resetCount = 0;
    const engine: NativeEngine = {
      getSymbolRegistry: () => JSON.stringify({
        functions: ["sqrt"], variables: ["pi"], units: ["m"], currencies: ["USD"], prefixes: ["k"],
      }),
      resetContext: () => { value = 0; resetCount += 1; },
      evaluate: (expression) => {
        if (expression === "value = 2") value = 2;
        return { ok: true, result: String(expression === "value * 3" ? value * 3 : value), error: "" };
      },
    };
    const payload = JSON.parse(engine.getSymbolRegistry?.() ?? "{}") as Record<string, string[]>;
    const registry = createSymbolRegistry(payload);

    for (let index = 0; index < 500; index += 1) {
      const runtime = evaluateNativeDocument("value = 2\nvalue * 3", () => engine, registry);
      expect(runtime.lines[1].result).toBe("6");
    }

    expect(resetCount).toBe(500);
  });
});
