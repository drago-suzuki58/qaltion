/** @vitest-environment jsdom */

import { StrictMode, act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { EditorPane } from "../src/editor/EditorPane";
import type { DocumentRuntime, StoredNote } from "../src/types";

const note: StoredNote = {
  id: "note",
  title: "Test note",
  blocks: [{ id: "calculation", type: "paragraph", content: "1 + 2" }],
  createdAt: 0,
  updatedAt: 0,
  lastOpenedAt: 0,
};

const runtime: DocumentRuntime = {
  blocks: {
    calculation: {
      result: "3",
      tokens: [{ text: "1", from: 0, to: 1, kind: "number" }],
    },
  },
  variables: [],
  engine: "development-fallback",
  status: "ready",
};

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

afterEach(() => {
  document.body.replaceChildren();
});

describe("EditorPane", () => {
  it("renders calculation decorations without a DOM mutation loop", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <StrictMode>
          <EditorPane note={note} runtime={runtime} onChange={vi.fn()} />
        </StrictMode>,
      );
    });

    const outer = container.querySelector<HTMLElement>("[data-node-type='blockOuter']");
    const content = container.querySelector<HTMLElement>(".bn-block-content");
    expect(outer?.classList.contains("qaltion-calculation")).toBe(true);
    expect(content?.getAttribute("data-result")).toBe("3");

    await act(async () => root.unmount());
  });

  it("shows a pending marker while a calculation is running", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <EditorPane
          note={note}
          runtime={{ ...runtime, status: "pending" }}
          onChange={vi.fn()}
        />,
      );
    });

    const outer = container.querySelector<HTMLElement>("[data-node-type='blockOuter']");
    const content = container.querySelector<HTMLElement>(".bn-block-content");
    expect(outer?.classList.contains("qaltion-pending")).toBe(true);
    expect(content?.getAttribute("data-result")).toBeNull();
    expect(container.querySelector(".editor-host")?.getAttribute("aria-busy")).toBe("true");

    await act(async () => root.unmount());
  });
});
