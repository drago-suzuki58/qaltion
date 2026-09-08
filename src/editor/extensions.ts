import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { EditorState, type Extension } from "@codemirror/state";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder,
} from "@codemirror/view";
import { highlightingExtension } from "./highlighting";
import { resultsExtension } from "./results";

type ExtensionOptions = {
  lane: HTMLElement;
  onChange: (source: string) => void;
};

export function qaltionExtensions({ lane, onChange }: ExtensionOptions): Extension[] {
  let composing = false;
  return [
    history(),
    lineNumbers(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    drawSelection(),
    EditorView.lineWrapping,
    highlightSelectionMatches(),
    placeholder("Try 1 + 2"),
    keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
    EditorState.tabSize.of(2),
    EditorView.contentAttributes.of({
      "aria-label": "Calculation editor",
      "aria-multiline": "true",
      autocapitalize: "off",
      autocomplete: "off",
      spellcheck: "false",
    }),
    EditorView.updateListener.of((update) => {
      if (update.docChanged && !composing && !update.view.composing) onChange(update.state.doc.toString());
    }),
    EditorView.domEventHandlers({
      compositionstart: () => {
        composing = true;
        return false;
      },
      compositionend: (_event, view) => {
        composing = false;
        window.setTimeout(() => onChange(view.state.doc.toString()), 0);
        return false;
      },
    }),
    highlightingExtension,
    resultsExtension(lane),
  ];
}
