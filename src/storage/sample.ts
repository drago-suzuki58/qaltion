import type { StoredNote } from "../types";

export const sampleContent = `# Monthly VPS cost

server = 1200 JPY / month
storage = 0.02 USD / GB

storage_usage = 500 GB

server + storage * storage_usage`;

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
    content: sampleContent,
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
  };
}
