import { setDiagnostics } from "@codemirror/lint";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useEffect, useLayoutEffect, useRef } from "react";
import type { DocumentRuntime, StoredNote } from "../types";
import type { QalculateSymbolRegistry } from "../calculation/registry";
import { runtimeDiagnostics } from "./diagnostics";
import { qaltionExtensions } from "./extensions";
import { setRuntime, setSymbolRegistry } from "./highlighting";

type Props = {
  note: StoredNote;
  runtime: DocumentRuntime;
  registry?: QalculateSymbolRegistry;
  onChange: (noteId: string, content: string) => void;
};

export function EditorPane({ note, runtime, registry, onChange }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const laneRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView>(null);

  useLayoutEffect(() => {
    const mount = mountRef.current;
    const lane = laneRef.current;
    if (!mount || !lane) return;

    const view = new EditorView({
      state: EditorState.create({
        doc: note.content,
        extensions: qaltionExtensions({
          lane,
          registry,
          onChange: (content) => onChange(note.id, content),
        }),
      }),
      parent: mount,
    });
    viewRef.current = view;
    return () => {
      viewRef.current = null;
      view.destroy();
    };
  }, [note.id, onChange]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const content = view.state.doc.toString();
    if (content !== note.content) {
      view.dispatch({ changes: { from: 0, to: content.length, insert: note.content } });
    }
  }, [note.content]);

  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const diagnostics = runtime.status === "pending"
      ? []
      : runtimeDiagnostics(runtime, view.state.doc.length);
    view.dispatch(
      { effects: setRuntime.of(runtime) },
      setDiagnostics(view.state, diagnostics),
    );
  }, [runtime]);

  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: setSymbolRegistry.of(registry) });
  }, [registry]);

  return (
    <div className="editor-host" aria-busy={runtime.status === "pending"}>
      <section className="visually-hidden" aria-label="Calculation results">
        {runtime.lines.flatMap((line) => line.result
          ? [<output key={line.line}>Line {line.line}: {line.result}</output>]
          : [])}
      </section>
      <div className="editor-layout">
        <div className="editor-mount" ref={mountRef} />
        <div className="result-lane" ref={laneRef} aria-hidden="true" />
      </div>
    </div>
  );
}
