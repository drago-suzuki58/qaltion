import { StateEffect, StateField, type EditorState } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { assignmentName, expressionSource, lexExpression, sourceLines } from "../calculation/lexer";
import type { DocumentRuntime } from "../types";

export const setRuntime = StateEffect.define<DocumentRuntime>();

function runtimeDecorations(runtime: DocumentRuntime, documentLength: number): DecorationSet {
  const ranges = runtime.lines.flatMap((line) => line.tokens)
    .filter((token) => token.kind === "undefined")
    .filter((token) => token.from >= 0 && token.to > token.from && token.to <= documentLength)
    .map((token) => Decoration.mark({ class: `tok-${token.kind}` }).range(token.from, token.to));
  return Decoration.set(ranges, true);
}

function localDecorations(state: EditorState): DecorationSet {
  const definedNames = new Set<string>();
  const ranges = sourceLines(state.doc.toString()).flatMap((line) => {
    const tokens = lexExpression(line.text, definedNames, line.from);
    const name = assignmentName(expressionSource(line.text));
    if (name) definedNames.add(name);
    return tokens;
  })
    .map((token) => token.kind === "undefined" ? { ...token, kind: "reference" as const } : token)
    .map((token) => Decoration.mark({ class: `tok-${token.kind}` }).range(token.from, token.to));
  return Decoration.set(ranges, true);
}

const localSyntaxDecorations = StateField.define<DecorationSet>({
  create: (state) => localDecorations(state),
  update(decorations, transaction) {
    return transaction.docChanged ? localDecorations(transaction.state) : decorations;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const semanticDecorations = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, transaction) {
    let next = transaction.docChanged ? Decoration.none : decorations.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(setRuntime)) {
        next = effect.value.status === "pending"
          ? Decoration.none
          : runtimeDecorations(effect.value, transaction.newDoc.length);
      }
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export const highlightingExtension = [localSyntaxDecorations, semanticDecorations];

export function semanticDecorationRanges(runtime: DocumentRuntime, documentLength: number) {
  return runtime.lines.flatMap((line) => line.tokens)
    .filter((token) => token.kind === "undefined")
    .filter((token) => token.from >= 0 && token.to > token.from && token.to <= documentLength)
    .map((token) => ({ from: token.from, to: token.to, className: `tok-${token.kind}` }));
}
