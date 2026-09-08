import { describe, expect, it } from "vitest";
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

  it("isolates a native trap, recreates context, and evaluates later lines", () => {
    let generation = 0;
    let disposed = 0;
    const createEngine = (): NativeEngine => {
      generation += 1;
      return {
        delete: () => { disposed += 1; },
        resetContext: () => undefined,
        evaluate: (expression) => {
          if (generation === 1 && expression === "trap") {
            throw new WebAssembly.RuntimeError("memory access out of bounds");
          }
          const results: Record<string, string> = {
            "a = 100": "100",
            "a * 10": "1000",
            "5 km to m": "5000 m",
          };
          return { ok: true, result: results[expression] ?? "0", error: "" };
        },
      };
    };

    const runtime = evaluateNativeDocument("a = 100\ntrap\na * 10\n5 km to m", createEngine);

    expect(generation).toBe(2);
    expect(disposed).toBe(1);
    expect(runtime.status).toBe("ready");
    expect(runtime.lines.map((line) => line.result)).toEqual(["100", undefined, "1000", "5000 m"]);
    expect(runtime.lines[1].error).toEqual({ kind: "calculation", message: "Calculation failed" });
  });

  it("discards context changes from a failed native line before continuing", () => {
    let generation = 0;
    let x = 0;
    const createEngine = (): NativeEngine => {
      generation += 1;
      x = 0;
      return {
        resetContext: () => { x = 0; },
        evaluate: (expression) => {
          if (expression === "x = 5") {
            x = 5;
            return { ok: true, result: "5", error: "" };
          }
          if (expression === "broken") {
            x = 999;
            return { ok: false, result: "", error: "Syntax error near broken" };
          }
          return { ok: true, result: String(x * 10), error: "" };
        },
      };
    };

    const runtime = evaluateNativeDocument("x = 5\nbroken\nx * 10", createEngine);

    expect(generation).toBe(2);
    expect(runtime.lines[1].error).toEqual({ kind: "syntax", message: "Invalid expression" });
    expect(runtime.lines[2].result).toBe("50");
  });
});
