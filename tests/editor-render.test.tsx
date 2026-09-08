/** @vitest-environment jsdom */

import { diagnosticCount, setDiagnostics } from "@codemirror/lint";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { runtimeDiagnostics } from "../src/editor/diagnostics";
import { EditorPane } from "../src/editor/EditorPane";
import { qaltionExtensions } from "../src/editor/extensions";
import { semanticDecorationRanges, setRuntime, setSymbolRegistry } from "../src/editor/highlighting";
import { createSymbolRegistry } from "../src/calculation/registry";
import type { DocumentRuntime, StoredNote } from "../src/types";

const runtime: DocumentRuntime = {
  lines: [{
    line: 1,
    from: 0,
    to: 5,
    result: "3",
    tokens: [
      { text: "1", from: 0, to: 1, kind: "number" },
      { text: "+", from: 2, to: 3, kind: "operator" },
      { text: "2", from: 4, to: 5, kind: "number" },
    ],
  }],
  variables: [],
  engine: "development-fallback",
  status: "ready",
};

const syntaxRegistry = createSymbolRegistry({
  functions: ["sin"],
  variables: ["pi"],
  units: ["m", "month"],
  currencies: ["JPY", "$"],
});

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(window, "requestAnimationFrame", {
    configurable: true,
    value: (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0),
  });
  Object.defineProperty(window, "cancelAnimationFrame", {
    configurable: true,
    value: (id: number) => window.clearTimeout(id),
  });
  if (!Range.prototype.getClientRects) {
    Range.prototype.getClientRects = () => ({
      length: 0,
      item: () => null,
      [Symbol.iterator]: function* () {},
    }) as DOMRectList;
  }
  if (!Range.prototype.getBoundingClientRect) {
    Range.prototype.getBoundingClientRect = () => new DOMRect();
  }
});

afterEach(() => {
  document.body.replaceChildren();
});

describe("CodeMirror calculation editor", () => {
  it("applies a ready runtime when the Editor mounts", async () => {
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    const note: StoredNote = {
      id: "note-a",
      title: "Initial note",
      content: "1 + 2",
      createdAt: 1,
      updatedAt: 1,
      lastOpenedAt: 1,
    };

    await act(async () => root.render(<EditorPane note={note} runtime={runtime} onChange={() => undefined} />));
    await new Promise((resolve) => window.setTimeout(resolve, 20));

    expect(container.querySelector(".cm-content")?.textContent).toBe("1 + 2");
    expect(container.querySelector(".result-lane output")?.textContent).toBe("3");
    expect(container.querySelector(".tok-number")).not.toBeNull();
    await act(async () => root.unmount());
  });

  it("shows line position cues and local syntax before runtime results arrive", () => {
    const parent = document.body.appendChild(document.createElement("div"));
    const lane = parent.appendChild(document.createElement("div"));
    const view = new EditorView({
      state: EditorState.create({
        doc: "# Monthly cost\nrate = sin(pi) + 1200 JPY / month\nrate + $5",
        extensions: qaltionExtensions({ lane, registry: syntaxRegistry, onChange: () => {} }),
      }),
      parent,
    });

    view.focus();

    expect(parent.querySelector(".cm-lineNumbers")?.textContent).toContain("1");
    expect(parent.querySelector(".cm-lineNumbers")?.textContent).toContain("3");
    expect(parent.querySelector(".cm-activeLine")).not.toBeNull();
    expect(parent.querySelector(".cm-activeLineGutter")).not.toBeNull();
    expect(parent.querySelector(".tok-comment")?.textContent).toBe("# Monthly cost");
    expect(parent.querySelector(".tok-number")?.textContent).toBe("1200");
    expect(parent.querySelector(".tok-currency")?.textContent).toBe("JPY");
    expect(Array.from(parent.querySelectorAll(".tok-operator")).some((token) => token.textContent === "/")).toBe(true);
    expect(parent.querySelector(".tok-unit")?.textContent).toBe("month");
    expect(parent.querySelector(".tok-definition")?.textContent).toBe("rate");
    expect(parent.querySelector(".tok-function")?.textContent).toBe("sin");
    expect(parent.querySelector(".tok-builtin-variable")?.textContent).toBe("pi");
    expect(Array.from(parent.querySelectorAll(".tok-reference")).some((token) => token.textContent === "rate")).toBe(true);
    expect(Array.from(parent.querySelectorAll(".tok-currency")).some((token) => token.textContent === "$")).toBe(true);
    view.destroy();
  });

  it("keeps content as plain text and reports document changes", () => {
    const parent = document.body.appendChild(document.createElement("div"));
    const lane = parent.appendChild(document.createElement("div"));
    const onChange = vi.fn();
    const view = new EditorView({
      state: EditorState.create({ doc: "1 + 2", extensions: qaltionExtensions({ lane, onChange }) }),
      parent,
    });

    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "2 + 2" } });

    expect(view.state.doc.toString()).toBe("2 + 2");
    expect(onChange).toHaveBeenLastCalledWith("2 + 2");
    view.destroy();
  });

  it("reclassifies locally when the registry arrives without recreating the document", () => {
    const parent = document.body.appendChild(document.createElement("div"));
    const lane = parent.appendChild(document.createElement("div"));
    const view = new EditorView({
      state: EditorState.create({
        doc: "sin(pi) + 5 m",
        extensions: qaltionExtensions({ lane, onChange: () => {} }),
      }),
      parent,
    });

    expect(parent.querySelector(".tok-function")).toBeNull();
    view.dispatch({ effects: setSymbolRegistry.of(syntaxRegistry) });

    expect(view.state.doc.toString()).toBe("sin(pi) + 5 m");
    expect(parent.querySelector(".tok-function")?.textContent).toBe("sin");
    expect(parent.querySelector(".tok-builtin-variable")?.textContent).toBe("pi");
    expect(parent.querySelector(".tok-unit")?.textContent).toBe("m");
    view.destroy();
  });

  it("waits until composition ends before reporting IME changes", async () => {
    const parent = document.body.appendChild(document.createElement("div"));
    const lane = parent.appendChild(document.createElement("div"));
    const onChange = vi.fn();
    const view = new EditorView({
      state: EditorState.create({ doc: "", extensions: qaltionExtensions({ lane, onChange }) }),
      parent,
    });

    view.contentDOM.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    view.dispatch({ changes: { from: 0, insert: "日本語" } });
    expect(onChange).not.toHaveBeenCalled();

    view.contentDOM.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    await new Promise((resolve) => window.setTimeout(resolve, 10));
    expect(onChange).toHaveBeenLastCalledWith("日本語");
    view.destroy();
  });

  it("creates exact semantic ranges and CodeMirror diagnostics", () => {
    expect(semanticDecorationRanges(runtime, 5)).toEqual([]);

    const failure: DocumentRuntime = {
      ...runtime,
      lines: [{
        line: 1,
        from: 0,
        to: 7,
        error: { kind: "undefined", message: "Undefined symbol" },
        tokens: [{ text: "missing", from: 0, to: 7, kind: "undefined" }],
      }],
    };
    const parent = document.body.appendChild(document.createElement("div"));
    const lane = parent.appendChild(document.createElement("div"));
    const view = new EditorView({
      state: EditorState.create({ doc: "missing", extensions: qaltionExtensions({ lane, onChange: () => {} }) }),
      parent,
    });
    const diagnostics = runtimeDiagnostics(failure, view.state.doc.length);
    view.dispatch({ effects: setRuntime.of(failure) }, setDiagnostics(view.state, diagnostics));

    expect(diagnostics[0]).toMatchObject({ from: 0, to: 7, severity: "error", message: "Undefined symbol" });
    expect(diagnosticCount(view.state)).toBe(1);
    expect(view.contentDOM.querySelector(".tok-undefined")?.textContent).toBe("missing");
    expect(semanticDecorationRanges(failure, 7)).toEqual([
      { from: 0, to: 7, className: "tok-undefined" },
    ]);
    view.destroy();
  });

  it("keeps local syntax when the calculation engine is unavailable", () => {
    const parent = document.body.appendChild(document.createElement("div"));
    const lane = parent.appendChild(document.createElement("div"));
    const view = new EditorView({
      state: EditorState.create({ doc: "a = 100\na * 10", extensions: qaltionExtensions({ lane, onChange: () => {} }) }),
      parent,
    });
    const failure: DocumentRuntime = {
      lines: [],
      variables: [],
      engine: "libqalculate",
      status: "error",
      failure: "The calculation engine is unavailable.",
    };
    view.dispatch({ effects: setRuntime.of(failure) });

    expect(view.contentDOM.querySelector(".tok-definition")?.textContent).toBe("a");
    expect(view.contentDOM.querySelector(".tok-number")?.textContent).toBe("100");
    expect(Array.from(view.contentDOM.querySelectorAll(".tok-reference")).some((token) => token.textContent === "a")).toBe(true);
    expect(view.contentDOM.querySelector(".tok-operator")).not.toBeNull();
    view.destroy();
  });

  it("renders results in a lane outside the editable document", async () => {
    const parent = document.body.appendChild(document.createElement("div"));
    const lane = parent.appendChild(document.createElement("div"));
    const view = new EditorView({
      state: EditorState.create({ doc: "1 + 2", extensions: qaltionExtensions({ lane, onChange: () => {} }) }),
      parent,
    });

    view.dispatch({ effects: setRuntime.of(runtime) });
    await new Promise((resolve) => window.setTimeout(resolve, 10));

    expect(view.state.doc.toString()).toBe("1 + 2");
    expect(view.contentDOM.textContent).toBe("1 + 2");
    expect(lane.querySelector("output")?.textContent).toBe("3");
    expect(view.contentDOM.contains(lane)).toBe(false);

    view.dispatch({ changes: { from: 0, insert: "\n" } });
    view.dispatch({ effects: setRuntime.of({ ...runtime, status: "pending" }) });
    await new Promise((resolve) => window.setTimeout(resolve, 10));
    expect(lane.querySelector("output")?.dataset.line).toBe("2");
    view.destroy();
  });

  it("keeps the previous result while the same line is edited and pending", async () => {
    const parent = document.body.appendChild(document.createElement("div"));
    const lane = parent.appendChild(document.createElement("div"));
    const view = new EditorView({
      state: EditorState.create({ doc: "1 + 2", extensions: qaltionExtensions({ lane, onChange: () => {} }) }),
      parent,
    });
    view.dispatch({ effects: setRuntime.of(runtime) });
    view.dispatch({ changes: { from: 4, to: 5, insert: "" } });
    view.dispatch({ effects: setRuntime.of({ ...runtime, status: "pending" }) });
    await new Promise((resolve) => window.setTimeout(resolve, 10));

    expect(view.state.doc.toString()).toBe("1 + ");
    expect(lane.querySelector("output")?.textContent).toBe("3");
    view.destroy();
  });

  it("keeps result drawing active when the internal scroller moves", async () => {
    const parent = document.body.appendChild(document.createElement("div"));
    const lane = parent.appendChild(document.createElement("div"));
    const view = new EditorView({
      state: EditorState.create({ doc: "1 + 2", extensions: qaltionExtensions({ lane, onChange: () => {} }) }),
      parent,
    });
    view.dispatch({ effects: setRuntime.of(runtime) });
    await new Promise((resolve) => window.setTimeout(resolve, 10));
    view.scrollDOM.dispatchEvent(new Event("scroll"));
    await new Promise((resolve) => window.setTimeout(resolve, 10));

    expect(lane.querySelector("output")?.textContent).toBe("3");
    view.destroy();
  });

  it("uses a full expression range for non-undefined diagnostics", () => {
    const failure: DocumentRuntime = {
      ...runtime,
      lines: [{
        line: 1,
        from: 0,
        to: 9,
        error: { kind: "syntax", message: "Syntax error" },
        tokens: [{ text: "missing", from: 0, to: 7, kind: "undefined" }],
      }],
    };

    expect(runtimeDiagnostics(failure, 9)[0]).toMatchObject({ from: 0, to: 9 });
  });

  it("drops stale results beside a deletion while mapping distant unchanged lines", async () => {
    const parent = document.body.appendChild(document.createElement("div"));
    const lane = parent.appendChild(document.createElement("div"));
    const view = new EditorView({
      state: EditorState.create({ doc: "1 + 2\n3 + 4\n5 + 6", extensions: qaltionExtensions({ lane, onChange: () => {} }) }),
      parent,
    });
    const twoLines: DocumentRuntime = {
      ...runtime,
      lines: [
        runtime.lines[0],
        { line: 2, from: 6, to: 11, result: "7", tokens: [] },
        { line: 3, from: 12, to: 17, result: "11", tokens: [] },
      ],
    };
    view.dispatch({ effects: setRuntime.of(twoLines) });
    view.dispatch({ changes: { from: 0, to: 6 } });
    view.dispatch({ effects: setRuntime.of({ ...twoLines, status: "pending" }) });
    await new Promise((resolve) => window.setTimeout(resolve, 10));

    const outputs = lane.querySelectorAll("output");
    expect(outputs).toHaveLength(1);
    expect(outputs[0].textContent).toBe("11");
    expect(outputs[0].dataset.line).toBe("2");
    view.destroy();
  });

  it("drops both stale results when deleting the newline between expressions", async () => {
    const parent = document.body.appendChild(document.createElement("div"));
    const lane = parent.appendChild(document.createElement("div"));
    const view = new EditorView({
      state: EditorState.create({ doc: "1 + 2\n3 + 4", extensions: qaltionExtensions({ lane, onChange: () => {} }) }),
      parent,
    });
    const twoLines: DocumentRuntime = {
      ...runtime,
      lines: [runtime.lines[0], { line: 2, from: 6, to: 11, result: "7", tokens: [] }],
    };
    view.dispatch({ effects: setRuntime.of(twoLines) });
    view.dispatch({ changes: { from: 5, to: 6 } });
    view.dispatch({ effects: setRuntime.of({ ...twoLines, status: "pending" }) });
    await new Promise((resolve) => window.setTimeout(resolve, 10));

    expect(lane.querySelectorAll("output")).toHaveLength(0);
    view.destroy();
  });
});
