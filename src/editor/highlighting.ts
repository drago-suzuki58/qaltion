import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import type { DocumentRuntime } from "../types";

export const setRuntime = StateEffect.define<DocumentRuntime>();

function runtimeDecorations(runtime: DocumentRuntime, documentLength: number): DecorationSet {
  const ranges = runtime.lines.flatMap((line) => line.tokens)
    .filter((token) => token.from >= 0 && token.to > token.from && token.to <= documentLength)
    .map((token) => Decoration.mark({ class: `tok-${token.kind}` }).range(token.from, token.to));
  return Decoration.set(ranges, true);
}

const semanticDecorations = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, transaction) {
    let next = decorations.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(setRuntime) && effect.value.status !== "pending") {
        next = runtimeDecorations(effect.value, transaction.newDoc.length);
      }
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export const highlightingExtension = semanticDecorations;

export function semanticDecorationRanges(runtime: DocumentRuntime, documentLength: number) {
  return runtime.lines.flatMap((line) => line.tokens)
    .filter((token) => token.from >= 0 && token.to > token.from && token.to <= documentLength)
    .map((token) => ({ from: token.from, to: token.to, className: `tok-${token.kind}` }));
}
