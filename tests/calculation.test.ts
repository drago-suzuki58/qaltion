import { describe, expect, it } from "vitest";
import { evaluateFallbackDocument } from "../src/calculation/fallback";
import { lexExpression } from "../src/calculation/lexer";

function calculate(items: Array<{ id: string; type: string; text: string }>) {
  return evaluateFallbackDocument(items);
}

describe("calculation document semantics", () => {
  it("evaluates basic arithmetic and unit conversion", () => {
    const runtime = calculate([
      { id: "basic", type: "paragraph", text: "1 + 2" },
      { id: "unit", type: "paragraph", text: "5 km to m" },
    ]);

    expect(runtime.blocks.basic.result).toBe("3");
    expect(runtime.blocks.unit.result).toBe("5000 m");
  });

  it("propagates, then replaces variables from top to bottom", () => {
    const runtime = calculate([
      { id: "define-a", type: "paragraph", text: "a = 10" },
      { id: "use-a", type: "paragraph", text: "a * 2" },
      { id: "define-again", type: "paragraph", text: "a = 50" },
      { id: "use-new-a", type: "paragraph", text: "a * 2" },
    ]);

    expect(runtime.blocks["use-a"].result).toBe("20");
    expect(runtime.blocks["use-new-a"].result).toBe("100");
    expect(runtime.variables).toEqual([
      { name: "a", value: "10" },
      { name: "a", value: "50" },
    ]);
  });

  it("captures variables only from above a variables block", () => {
    const runtime = calculate([
      { id: "define-a", type: "paragraph", text: "a = 10" },
      { id: "before-b", type: "variables", text: "" },
      { id: "define-b", type: "paragraph", text: "b = 20" },
      { id: "after-b", type: "variables", text: "" },
    ]);

    expect(runtime.blocks["before-b"].variables).toEqual([{ name: "a", value: "10" }]);
    expect(runtime.blocks["after-b"].variables).toEqual([
      { name: "a", value: "10" },
      { name: "b", value: "20" },
    ]);
  });

  it("does not calculate comments, empty paragraphs, or non-paragraph blocks", () => {
    const runtime = calculate([
      { id: "comment", type: "paragraph", text: "-- hello" },
      { id: "empty", type: "paragraph", text: "" },
      { id: "heading", type: "heading", text: "1 + 2" },
    ]);

    expect(runtime.blocks.comment.tokens[0]).toMatchObject({ kind: "comment" });
    expect(runtime.blocks.empty).toBeUndefined();
    expect(runtime.blocks.heading).toBeUndefined();
  });

  it("reports an error instead of treating a failed expression as prose", () => {
    const runtime = calculate([
      { id: "syntax", type: "paragraph", text: "1 +" },
      { id: "unknown", type: "paragraph", text: "missing_value * 2" },
      { id: "unit-error", type: "paragraph", text: "5 m + 2 s" },
    ]);

    expect(runtime.blocks.syntax.error).toBeDefined();
    expect(runtime.blocks.unknown.error?.kind).toBe("undefined");
    expect(runtime.blocks["unit-error"].error?.kind).toBe("unit");
  });
});

describe("Qaltion lexer", () => {
  it("returns source ranges and semantic categories without changing the source", () => {
    const tokens = lexExpression("server = 1200 JPY / month", new Set(["server"]));

    expect(tokens).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: "server", kind: "definition", from: 0, to: 6 }),
        expect.objectContaining({ text: "1200", kind: "number" }),
        expect.objectContaining({ text: "JPY", kind: "currency" }),
        expect.objectContaining({ text: "month", kind: "unit" }),
      ]),
    );
  });
});
