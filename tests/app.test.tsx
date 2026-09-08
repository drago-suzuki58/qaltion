/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentRuntime, StoredNote } from "../src/types";

const mocks = vi.hoisted(() => ({
  deleteNote: vi.fn(),
  evaluateDocument: vi.fn(),
  listNotes: vi.fn(),
  saveNote: vi.fn(),
}));

vi.mock("../src/storage/database", () => ({
  deleteNote: mocks.deleteNote,
  listNotes: mocks.listNotes,
  saveNote: mocks.saveNote,
}));

vi.mock("../src/calculation/client", () => ({
  CalculationClient: class {
    evaluateDocument = mocks.evaluateDocument;
    dispose() {}
  },
}));

vi.mock("../src/editor/EditorPane", () => ({
  EditorPane: ({ note, runtime, onChange }: {
    note: StoredNote;
    runtime: DocumentRuntime;
    onChange: (noteId: string, content: string) => void;
  }) => (
    <div>
      <div data-testid="note-content">{note.content}</div>
      <div data-testid="note-result">{runtime.lines[0]?.result ?? ""}</div>
      <button type="button" onClick={() => onChange(note.id, "2 + 2")}>Edit expression</button>
    </div>
  ),
}));

import App from "../src/App";

let desktopListener: ((event: MediaQueryListEvent) => void) | undefined;

function storedNote(id: string, title: string, content: string): StoredNote {
  return { id, title, content, createdAt: 1, updatedAt: 1, lastOpenedAt: 1 };
}

function click(element: Element): void {
  element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("App note workflow", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
          desktopListener = listener;
        },
        removeEventListener: vi.fn(),
      })),
    });
  });

  beforeEach(() => {
    vi.useRealTimers();
    mocks.deleteNote.mockReset().mockResolvedValue(undefined);
    mocks.saveNote.mockReset().mockResolvedValue(undefined);
    mocks.evaluateDocument.mockReset().mockImplementation(async (source: string) => ({
      lines: source ? [{ line: 1, from: 0, to: source.length, result: `result:${source}`, tokens: [] }] : [],
      variables: [],
      engine: "development-fallback",
      status: "ready",
    } satisfies DocumentRuntime));
    desktopListener = undefined;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
    vi.useRealTimers();
  });

  it("shows loading UI until stored notes are ready", async () => {
    let resolveNotes!: (notes: StoredNote[]) => void;
    mocks.listNotes.mockReturnValue(new Promise<StoredNote[]>((resolve) => { resolveNotes = resolve; }));

    act(() => root.render(<App />));
    expect(container.textContent).toContain("Loading notes...");

    await act(async () => {
      resolveNotes([storedNote("a", "Note A", "1 + 1")]);
      await flush();
    });
    expect(container.textContent).not.toContain("Loading notes...");
    expect(container.textContent).toContain("Note A");
  });

  it("keeps edited content and recalculates it after switching notes", async () => {
    mocks.listNotes.mockResolvedValue([
      storedNote("a", "Note A", "1 + 1"),
      storedNote("b", "Note B", "3 + 3"),
    ]);
    await act(async () => { root.render(<App />); await flush(); });
    await act(async () => {
      click(Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Edit expression")!);
      await flush();
    });
    await act(async () => { click(container.querySelector("[aria-label='Open Note B']")!); await flush(); });
    await act(async () => { click(container.querySelector("[aria-label='Open Note A']")!); await flush(); });

    expect(container.querySelector("[data-testid='note-content']")?.textContent).toBe("2 + 2");
    expect(container.querySelector("[data-testid='note-result']")?.textContent).toBe("result:2 + 2");
  });

  it("keeps the latest plain text queued for saving after an immediate switch", async () => {
    vi.useFakeTimers();
    mocks.listNotes.mockResolvedValue([
      storedNote("a", "Note A", "1 + 1"),
      storedNote("b", "Note B", "3 + 3"),
    ]);
    await act(async () => { root.render(<App />); await flush(); });
    await act(async () => {
      click(Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Edit expression")!);
      click(container.querySelector("[aria-label='Open Note B']")!);
      await vi.advanceTimersByTimeAsync(450);
      await flush();
    });

    expect(mocks.saveNote).toHaveBeenCalledWith(expect.objectContaining({ id: "a", content: "2 + 2" }));
  });

  it("flushes a pending save when the page is hidden", async () => {
    vi.useFakeTimers();
    mocks.listNotes.mockResolvedValue([storedNote("a", "Note A", "1 + 1")]);
    await act(async () => { root.render(<App />); await flush(); });
    act(() => click(Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Edit expression")!));

    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
      await flush();
    });
    expect(mocks.saveNote).toHaveBeenCalledWith(expect.objectContaining({ id: "a", content: "2 + 2" }));
  });

  it("closes the mobile notes dialog when the viewport becomes desktop-sized", async () => {
    mocks.listNotes.mockResolvedValue([storedNote("a", "Note A", "1 + 1")]);
    await act(async () => { root.render(<App />); await flush(); });
    await act(async () => { click(container.querySelector("[aria-label='Open notes']")!); await flush(); });
    expect(container.querySelector(".notes-drawer[open]")).not.toBeNull();

    await act(async () => {
      desktopListener?.({ matches: true } as MediaQueryListEvent);
      await flush();
    });
    expect(container.querySelector(".notes-drawer[open]")).toBeNull();
  });

  it("confirms and deletes a note from its own row", async () => {
    mocks.listNotes.mockResolvedValue([
      storedNote("a", "Note A", "1 + 1"),
      storedNote("b", "Note B", "3 + 3"),
    ]);
    await act(async () => { root.render(<App />); await flush(); });
    await act(async () => { click(container.querySelector("[aria-label='Delete Note B']")!); await flush(); });
    expect(container.querySelector("dialog[open]")?.textContent).toContain("Note B");

    await act(async () => {
      const deleteButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Delete");
      click(deleteButton!);
      await flush();
    });
    expect(mocks.deleteNote).toHaveBeenCalledWith("b");
    expect(container.querySelector("[aria-label='Open Note B']")).toBeNull();
  });

  it("reschedules the latest content when deletion fails", async () => {
    vi.useFakeTimers();
    mocks.deleteNote.mockRejectedValueOnce(new Error("delete failed"));
    mocks.listNotes.mockResolvedValue([storedNote("a", "Note A", "1 + 1")]);
    await act(async () => { root.render(<App />); await flush(); });
    act(() => click(Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Edit expression")!));
    await act(async () => { click(container.querySelector("[aria-label='Delete Note A']")!); await flush(); });
    await act(async () => { click(container.querySelector("[aria-label='Delete note']")!); await flush(); });
    expect(container.querySelector("[role='alert']")?.textContent).toContain("could not be deleted");

    await act(async () => { await vi.advanceTimersByTimeAsync(450); await flush(); });
    expect(mocks.saveNote).toHaveBeenCalledWith(expect.objectContaining({ id: "a", content: "2 + 2" }));
  });
});
