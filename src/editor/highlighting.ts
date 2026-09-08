import { StateEffect, StateField, type EditorState, type Transaction } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { assignmentName, expressionSource, sourceLines } from "../calculation/lexer";
import { classifyLine } from "../calculation/classifier";
import { emptySymbolRegistry, type QalculateSymbolRegistry } from "../calculation/registry";
import type { DocumentRuntime } from "../types";

export const setRuntime = StateEffect.define<DocumentRuntime>();
export const setSymbolRegistry = StateEffect.define<QalculateSymbolRegistry | undefined>();

function runtimeDecorations(runtime: DocumentRuntime, documentLength: number): DecorationSet {
  const ranges = runtime.lines.flatMap((line) => line.tokens)
    .filter((token) => token.kind === "undefined")
    .filter((token) => token.from >= 0 && token.to > token.from && token.to <= documentLength)
    .map((token) => Decoration.mark({ class: `tok-${token.kind}` }).range(token.from, token.to));
  return Decoration.set(ranges, true);
}

function localDecorations(state: EditorState, registry = emptySymbolRegistry): DecorationSet {
  const definedNames = new Set<string>();
  const ranges = sourceLines(state.doc.toString()).flatMap((line) => {
    const tokens = classifyLine(line.text, definedNames, line.from, registry);
    const name = assignmentName(expressionSource(line.text));
    if (name) definedNames.add(name);
    return tokens;
  }).map((token) => Decoration.mark({ class: `tok-${token.kind}` }).range(token.from, token.to));
  return Decoration.set(ranges, true);
}

const symbolRegistryField = StateField.define<QalculateSymbolRegistry | undefined>({
  create: () => undefined,
  update(registry, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setSymbolRegistry)) return effect.value;
    }
    return registry;
  },
});

function registryFromTransaction(transaction: Transaction, current: QalculateSymbolRegistry | undefined) {
  for (const effect of transaction.effects) {
    if (effect.is(setSymbolRegistry)) return effect.value ?? emptySymbolRegistry;
  }
  return current ?? emptySymbolRegistry;
}

const localSyntaxDecorations = StateField.define<DecorationSet>({
  create: (state) => localDecorations(state, state.field(symbolRegistryField) ?? emptySymbolRegistry),
  update(decorations, transaction) {
    const registryChanged = transaction.effects.some((effect) => effect.is(setSymbolRegistry));
    return transaction.docChanged || registryChanged
      ? localDecorations(transaction.state, registryFromTransaction(transaction, transaction.state.field(symbolRegistryField)))
      : decorations;
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

export function highlightingExtension(registry?: QalculateSymbolRegistry) {
  return [
    symbolRegistryField.init(() => registry),
    localSyntaxDecorations,
    semanticDecorations,
  ];
}

export function semanticDecorationRanges(runtime: DocumentRuntime, documentLength: number) {
  return runtime.lines.flatMap((line) => line.tokens)
    .filter((token) => token.kind === "undefined")
    .filter((token) => token.from >= 0 && token.to > token.from && token.to <= documentLength)
    .map((token) => ({ from: token.from, to: token.to, className: `tok-${token.kind}` }));
}
