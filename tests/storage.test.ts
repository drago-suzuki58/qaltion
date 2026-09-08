import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { deleteNote, listNotes, saveNote } from "../src/storage/database";
import type { StoredNote } from "../src/types";

function note(overrides: Partial<StoredNote> = {}): StoredNote {
  return {
    id: "note-a",
    title: "A note",
    content: "1 + 2",
    createdAt: 1,
    updatedAt: 1,
    lastOpenedAt: 1,
    ...overrides,
  };
}

function createLegacyDatabase(record: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("qaltion", 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore("notes", { keyPath: "id" });
      store.createIndex("lastOpenedAt", "lastOpenedAt");
      store.put(record);
    };
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
}

beforeEach(() => {
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: new IDBFactory(),
  });
});

describe("note storage", () => {
  it("creates, reloads, renames, and deletes a plain-text note", async () => {
    await saveNote(note());
    expect(await listNotes()).toEqual([note()]);

    await saveNote(note({ title: "Renamed", content: "2 + 2", updatedAt: 2 }));
    expect(await listNotes()).toEqual([note({ title: "Renamed", content: "2 + 2", updatedAt: 2 })]);

    await deleteNote("note-a");
    expect(await listNotes()).toEqual([]);
  });

  it("migrates version 1 BlockNote records to plain text", async () => {
    await createLegacyDatabase({
      id: "legacy",
      title: "Legacy",
      blocks: [
        { type: "paragraph", content: [{ type: "text", text: "-- old comment" }] },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Docs: " },
            { type: "link", href: "https://example.test/docs", content: [{ type: "text", text: "guide" }] },
          ],
          children: [{ type: "paragraph", content: "a * 2" }],
        },
        { type: "variables", content: "" },
        { type: "result", content: "a + 1", props: { mode: "dynamic" } },
        { type: "result", content: "a + 2", props: { mode: "frozen", frozenValue: "12" } },
        { type: "table", content: { rows: [{ cells: ["A", "B"] }, { cells: ["C", "D"] }] } },
        { type: "image", props: { name: "diagram.png", caption: "budget", url: "https://example.test/a.png" } },
      ],
      createdAt: 1,
      updatedAt: 2,
      lastOpenedAt: 3,
    });

    const migrated = await listNotes();
    expect(migrated[0]).toEqual({
      id: "legacy",
      title: "Legacy",
      content: [
        "# old comment",
        "Docs: guide (https://example.test/docs)",
        "a * 2",
        "# Variables block removed during migration",
        "a + 1",
        "# Frozen result: a + 2 = 12",
        "# Migrated table block: A | B / C | D",
        "# Migrated image block: diagram.png - budget - https://example.test/a.png",
      ].join("\n"),
      createdAt: 1,
      updatedAt: 2,
      lastOpenedAt: 3,
    });
    expect("blocks" in migrated[0]).toBe(false);
  });
});
