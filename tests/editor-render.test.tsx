/** @vitest-environment jsdom */

import { diagnosticCount, setDiagnostics } from "@codemirror/lint";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { runtimeDiagnostics } from "../src/editor/diagnostics";
import { qaltionExtensions } from "../src/editor/extensions";
import { semanticDecorationRanges, setRuntime } from "../src/editor/highlighting";
import type { DocumentRuntime } from "../src/types";

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

beforeAll(() => {
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
    expect(semanticDecorationRanges(runtime, 5)).toEqual([
      { from: 0, to: 1, className: "tok-number" },
      { from: 2, to: 3, className: "tok-operator" },
      { from: 4, to: 5, className: "tok-number" },
    ]);

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
