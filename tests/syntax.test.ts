import { describe, expect, it } from "vitest";
import { classifyLine, classifyDocument } from "../src/calculation/classifier";
import { expressionSource, scanTokens } from "../src/calculation/lexer";
import { createSymbolRegistry } from "../src/calculation/registry";

const registry = createSymbolRegistry({
  functions: ["sin", "sqrt"],
  variables: ["pi"],
  units: ["m", "km", "miles", "s", "meter"],
  currencies: ["JPY", "USD", "$", "€", "¥"],
  prefixes: ["k", "M", "m", "micro", "µ"],
});

describe("Qaltion lexical scanner", () => {
  it("keeps comments and hashes inside strings separate", () => {
    expect(scanTokens('value = "#" # trailing')).toEqual([
      { kind: "identifier", text: "value", from: 0, to: 5 },
      { kind: "operator", text: "=", from: 6, to: 7 },
      { kind: "string", text: '"#"', from: 8, to: 11 },
      { kind: "comment", text: "# trailing", from: 12, to: 22 },
    ]);
    expect(expressionSource('value = "#" # trailing')).toBe('value = "#"');
  });

  it("recognizes number forms, multi-character operators, punctuation, and ranges", () => {
    const tokens = scanTokens("1.23 1E-3 0xff 0b1010 0o77 %% // ** << >> && || ≤ ≥ (x, y):");
    expect(tokens.filter((token) => token.kind === "number").map((token) => token.text)).toEqual([
      "1.23",
      "1E-3",
      "0xff",
      "0b1010",
      "0o77",
    ]);
    expect(tokens.filter((token) => token.kind === "operator").map((token) => token.text)).toEqual([
      "%%",
      "//",
      "**",
      "<<",
      ">>",
      "&&",
      "||",
      "≤",
      "≥",
    ]);
    expect(tokens.filter((token) => token.kind === "punctuation").map((token) => token.text)).toEqual([
      "(",
      ",",
      ")",
      ":",
    ]);
    expect(tokens.find((token) => token.text === "0xff")).toMatchObject({ from: 10, to: 14 });
  });
});

describe("Qaltion symbol classifier", () => {
  it("classifies builtin symbols from a registry and leaves unknowns neutral", () => {
    const tokens = classifyLine("sin(pi / 4) + missing", new Set(), 0, registry);
    expect(tokens.filter((token) => ["sin", "pi", "missing"].includes(token.text))).toEqual([
      { text: "sin", from: 0, to: 3, kind: "function" },
      { text: "pi", from: 4, to: 6, kind: "builtin-variable" },
      { text: "missing", from: 14, to: 21, kind: "identifier" },
    ]);
    expect(tokens.find((token) => token.text === "/")?.kind).toBe("operator");
  });

  it("tracks definitions and references from top to bottom", () => {
    const tokens = classifyDocument("radius = 5 m\narea = pi * radius^2\narea", registry);
    expect(tokens.filter((token) => token.text === "radius").map((token) => token.kind)).toEqual([
      "definition",
      "reference",
    ]);
    expect(tokens.filter((token) => token.text === "area").map((token) => token.kind)).toEqual([
      "definition",
      "reference",
    ]);
  });

  it("uses exact units before prefix decomposition and classifies currencies", () => {
    const tokens = classifyLine("5 km to miles + 1200 JPY", new Set(), 0, registry);
    expect(tokens.find((token) => token.text === "to")?.kind).toBe("keyword");
    expect(tokens.find((token) => token.text === "miles")?.kind).toBe("unit");
    expect(tokens.find((token) => token.text === "JPY")?.kind).toBe("currency");
    expect(tokens.filter((token) => token.text === "km").map((token) => token.kind)).toEqual(["unit"]);
  });

  it("splits a prefixed unit only when no exact unit exists", () => {
    const prefixed = classifyLine(
      "5 ms",
      new Set(),
      0,
      createSymbolRegistry({ units: ["s"], prefixes: ["m"] }),
    );
    expect(prefixed.filter((token) => token.text === "m" || token.text === "s")).toEqual([
      { text: "m", from: 2, to: 3, kind: "prefix" },
      { text: "s", from: 3, to: 4, kind: "unit" },
    ]);
  });
});
