import { describe, expect, it } from "vitest";
import { evaluateFallbackDocument } from "../src/calculation/fallback";
import { lexExpression } from "../src/calculation/lexer";
import { evaluateDocument } from "../src/calculation/worker";

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
  });
});

describe("Qaltion lexer", () => {
  it("returns document ranges and semantic categories without changing source", () => {
    const tokens = lexExpression("server = 1200 JPY / month", new Set(["server"]), 10);

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
});
