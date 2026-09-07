import type { StoredNote } from "../types";

export const sampleBlocks: unknown[] = [
  { type: "paragraph", content: "-- Monthly VPS cost" },
  { type: "paragraph", content: "server = 1200 JPY / month" },
  { type: "paragraph", content: "storage = 0.02 USD / GB" },
  { type: "paragraph", content: "" },
  { type: "paragraph", content: "storage_usage = 500 GB" },
  { type: "paragraph", content: "" },
  { type: "paragraph", content: "server + storage * storage_usage" },
];

function createNoteId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createSampleNote(now = Date.now()): StoredNote {
  return {
    id: createNoteId(),
    title: "Monthly VPS cost",
    blocks: sampleBlocks,
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
  };
}
