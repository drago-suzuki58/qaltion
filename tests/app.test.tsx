/** @vitest-environment jsdom */

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppBlock, DocumentRuntime, StoredNote } from "../src/types";

const mocks = vi.hoisted(() => ({
  deleteNote: vi.fn(),
  evaluateDocument: vi.fn(),
  listNotes: vi.fn(),
  saveNote: vi.fn(),
}));

vi.mock("@mantine/core", () => ({
  Drawer: ({ opened, children, title }: { opened: boolean; children: ReactNode; title: ReactNode }) =>
    opened ? <aside><h2>{title}</h2>{children}</aside> : null,
  Loader: () => <svg data-testid="loader" />,
  Modal: ({ opened, children, title }: { opened: boolean; children: ReactNode; title: ReactNode }) =>
    opened ? <section role="dialog" aria-label={String(title)}>{children}</section> : null,
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

vi.mock("../src/editor/EditorPane", async () => {
  const { useEffect } = await import("react");
  return {
    EditorPane: ({ note, runtime, onChange }: {
      note: StoredNote;
      runtime: DocumentRuntime;
      onChange: (noteId: string, blocks: AppBlock[]) => void;
    }) => {
      useEffect(() => {
        onChange(note.id, note.blocks as AppBlock[]);
      }, [note.id, onChange]);
      const firstBlock = note.blocks[0] as AppBlock | undefined;
      return (
        <div>
          <div data-testid="note-content">{JSON.stringify(note.blocks)}</div>
          <div data-testid="note-result">{firstBlock ? runtime.blocks[firstBlock.id]?.result : ""}</div>
          <button
            type="button"
            onClick={() => onChange(note.id, [block(`${note.id}-edited`, "2 + 2")])}
          >
            Edit expression
          </button>
        </div>
      );
    },
  };
});

import App from "../src/App";

function block(id: string, content: string): AppBlock {
  return { id, type: "paragraph", props: {}, content, children: [] };
}

function storedNote(id: string, title: string, content: string): StoredNote {
  return {
    id,
    title,
    blocks: [block(`${id}-initial`, content)],
    createdAt: 1,
    updatedAt: 1,
    lastOpenedAt: 1,
  };
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
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
  });

  beforeEach(() => {
    vi.useRealTimers();
    mocks.deleteNote.mockReset().mockResolvedValue(undefined);
    mocks.saveNote.mockReset().mockResolvedValue(undefined);
    mocks.evaluateDocument.mockReset().mockImplementation(async (blocks: AppBlock[]) => {
      const first = blocks[0];
      return {
        blocks: first ? { [first.id]: { result: `result:${String(first.content)}`, tokens: [] } } : {},
        variables: [],
        engine: "development-fallback",
        status: "ready",
      } satisfies DocumentRuntime;
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  it("shows loading UI until stored notes are ready", async () => {
    let resolveNotes!: (notes: StoredNote[]) => void;
    mocks.listNotes.mockReturnValue(new Promise<StoredNote[]>((resolve) => {
      resolveNotes = resolve;
    }));

    act(() => root.render(<App />));
    expect(container.textContent).toContain("Loading notes...");
    expect(container.querySelector("[data-testid='loader']")).not.toBeNull();

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

    await act(async () => {
      root.render(<App />);
      await flush();
    });
    await act(async () => {
      click(Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Edit expression")!);
      await flush();
    });
    await act(async () => {
      click(container.querySelector("[aria-label='Open Note B']")!);
      await flush();
    });
    await act(async () => {
      click(container.querySelector("[aria-label='Open Note A']")!);
      await flush();
    });

    expect(container.querySelector("[data-testid='note-content']")?.textContent).toContain("2 + 2");
    expect(container.querySelector("[data-testid='note-result']")?.textContent).toContain("result:2 + 2");
  });

  it("keeps the latest note queued for saving after an immediate switch", async () => {
    vi.useFakeTimers();
    mocks.listNotes.mockResolvedValue([
      storedNote("a", "Note A", "1 + 1"),
      storedNote("b", "Note B", "3 + 3"),
    ]);

    await act(async () => {
      root.render(<App />);
      await flush();
    });
    await act(async () => {
      click(Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Edit expression")!);
      click(container.querySelector("[aria-label='Open Note B']")!);
      await vi.advanceTimersByTimeAsync(450);
      await flush();
    });

    expect(mocks.saveNote).toHaveBeenCalledWith(expect.objectContaining({
      id: "a",
      blocks: [expect.objectContaining({ content: "2 + 2" })],
    }));
    vi.useRealTimers();
  });

  it("confirms and deletes the selected note from its own row", async () => {
    mocks.listNotes.mockResolvedValue([
      storedNote("a", "Note A", "1 + 1"),
      storedNote("b", "Note B", "3 + 3"),
    ]);

    await act(async () => {
      root.render(<App />);
      await flush();
    });
    act(() => click(container.querySelector("[aria-label='Delete Note B']")!));
    expect(container.querySelector("[role='dialog']")?.textContent).toContain("Note B");

    await act(async () => {
      const deleteButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Delete");
      click(deleteButton!);
      await flush();
    });

    expect(mocks.deleteNote).toHaveBeenCalledWith("b");
    expect(container.querySelector("[aria-label='Open Note B']")).toBeNull();
    expect(container.querySelector("[aria-label='Open Note A']")).not.toBeNull();
  });

  it("reschedules the latest content when deletion fails", async () => {
    vi.useFakeTimers();
    mocks.deleteNote.mockRejectedValueOnce(new Error("delete failed"));
    mocks.listNotes.mockResolvedValue([storedNote("a", "Note A", "1 + 1")]);

    await act(async () => {
      root.render(<App />);
      await flush();
    });
    act(() => click(Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Edit expression")!));
    act(() => click(container.querySelector("[aria-label='Delete Note A']")!));
    await act(async () => {
      click(container.querySelector("[aria-label='Delete note']")!);
      await flush();
    });
    expect(container.querySelector("[role='alert']")?.textContent).toContain("could not be deleted");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(450);
      await flush();
    });
    expect(mocks.saveNote).toHaveBeenCalledWith(expect.objectContaining({
      id: "a",
      blocks: [expect.objectContaining({ content: "2 + 2" })],
    }));
    vi.useRealTimers();
  });
});
