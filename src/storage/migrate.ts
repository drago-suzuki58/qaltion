import type { StoredNote } from "../types";

type LegacyBlock = {
  type?: unknown;
  content?: unknown;
  children?: unknown;
  props?: unknown;
};

type LegacyNote = Omit<StoredNote, "content"> & {
  blocks?: unknown;
  content?: unknown;
};

function inlineText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(inlineText).filter(Boolean).join("");
  if (!content || typeof content !== "object") return "";
  const part = content as Record<string, unknown>;
  if (typeof part.text === "string") return part.text;
  if (part.type === "link" && typeof part.href === "string") {
    const label = inlineText(part.content);
    return !label || label === part.href ? part.href : `${label} (${part.href})`;
  }
  if ("content" in part) return inlineText(part.content);
  if (Array.isArray(part.cells)) return part.cells.map(inlineText).filter(Boolean).join(" | ");
  if (Array.isArray(part.rows)) return part.rows.map(inlineText).filter(Boolean).join(" / ");
  return "";
}

function propSummary(props: Record<string, unknown>): string {
  return [props.name, props.caption, props.url]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" - ");
}

function commentLine(label: string, content: string): string {
  return `# ${label}${content ? `: ${content}` : ""}`;
}

function legacyBlockText(content: unknown): string {
  return inlineText(content);
}

function migrateComment(text: string): string {
  const indentation = text.match(/^\s*/)?.[0] ?? "";
  return text.slice(indentation.length).startsWith("--")
    ? `${indentation}#${text.slice(indentation.length + 2)}`
    : text;
}

function blockLines(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const block = value as LegacyBlock;
  const type = typeof block.type === "string" ? block.type : "paragraph";
  const text = migrateComment(legacyBlockText(block.content));
  const props = block.props && typeof block.props === "object"
    ? block.props as Record<string, unknown>
    : {};

  let line = type === "paragraph" ? text : commentLine(`Migrated ${type} block`, text || propSummary(props));
  if (type === "variables") line = "# Variables block removed during migration";
  if (type === "result" && props.mode !== "frozen") line = text;
  if (type === "result" && props.mode === "frozen") {
    const value = typeof props.frozenValue === "string" ? props.frozenValue : "";
    line = `# Frozen result: ${[text, value].filter(Boolean).join(" = ")}`.trimEnd();
  }

  const children = Array.isArray(block.children) ? block.children.flatMap(blockLines) : [];
  return [line, ...children];
}

export function blocksToContent(blocks: unknown): string {
  if (!Array.isArray(blocks)) return "";
  return blocks.flatMap(blockLines).join("\n");
}

export function migrateStoredNote(value: unknown): StoredNote | undefined {
  if (!value || typeof value !== "object") return undefined;
  const note = value as LegacyNote;
  if (typeof note.id !== "string" || typeof note.title !== "string") return undefined;
  return {
    id: note.id,
    title: note.title,
    content: typeof note.content === "string" ? note.content : blocksToContent(note.blocks),
    createdAt: typeof note.createdAt === "number" ? note.createdAt : Date.now(),
    updatedAt: typeof note.updatedAt === "number" ? note.updatedAt : Date.now(),
    lastOpenedAt: typeof note.lastOpenedAt === "number" ? note.lastOpenedAt : Date.now(),
  };
}
