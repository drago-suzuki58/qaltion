import { useCallback, useEffect, useRef, useState } from "react";
import { CalculationClient } from "./calculation/client";
import { EditorPane } from "./editor/EditorPane";
import type { AppBlock, DocumentRuntime, StoredNote } from "./types";
import { deleteNote, listNotes, saveNote } from "./storage/database";
import { createSampleNote } from "./storage/sample";

const emptyRuntime: DocumentRuntime = {
  blocks: {},
  variables: [],
  engine: "development-fallback",
};

function createBlankNote(): StoredNote {
  const note = createSampleNote();
  return { ...note, title: "Untitled note", blocks: [{ type: "paragraph", content: "" }] };
}

export default function App() {
  const [initialNote] = useState<StoredNote>(() => createSampleNote());
  const [notes, setNotes] = useState<StoredNote[]>([initialNote]);
  const [note, setNote] = useState<StoredNote>(initialNote);
  const [documentBlocks, setDocumentBlocks] = useState<AppBlock[]>();
  const [runtime, setRuntime] = useState<DocumentRuntime>(emptyRuntime);
  const [notesOpen, setNotesOpen] = useState(false);
  const calculationClient = useRef<CalculationClient | null>(null);

  useEffect(() => {
    try {
      calculationClient.current = new CalculationClient();
    } catch {
      calculationClient.current = null;
    }
    void listNotes()
      .then((storedNotes) => {
        const availableNotes = storedNotes.length > 0 ? storedNotes : [initialNote];
        setNotes(availableNotes);
        setNote(availableNotes[0]);
      })
      .catch(() => {
        setNotes([initialNote]);
        setNote(initialNote);
      });

    return () => calculationClient.current?.dispose();
  }, [initialNote]);

  useEffect(() => {
    if (!note) return;
    const saveTimer = window.setTimeout(() => {
      void saveNote(note);
    }, 450);
    return () => window.clearTimeout(saveTimer);
  }, [note]);

  useEffect(() => {
    if (!documentBlocks || !calculationClient.current) return;
    let current = true;
    void calculationClient.current.evaluateDocument(documentBlocks).then((nextRuntime) => {
      if (current) setRuntime(nextRuntime);
    });
    return () => {
      current = false;
    };
  }, [documentBlocks]);

  const handleEditorChange = useCallback((blocks: AppBlock[]) => {
    setDocumentBlocks(blocks);
    setNote((current) =>
      current
        ? { ...current, blocks, updatedAt: Date.now(), lastOpenedAt: Date.now() }
        : current,
    );
  }, []);

  const selectNote = useCallback((selected: StoredNote) => {
    const opened = { ...selected, lastOpenedAt: Date.now() };
    setNotes((current) => current.map((item) => (item.id === opened.id ? opened : item)));
    setNote(opened);
    setDocumentBlocks(undefined);
    setRuntime(emptyRuntime);
    setNotesOpen(false);
  }, []);

  const renameNote = useCallback((title: string) => {
    setNote((current) => {
      if (!current) return current;
      const renamed = { ...current, title: title || "Untitled note", updatedAt: Date.now() };
      setNotes((available) => available.map((item) => (item.id === renamed.id ? renamed : item)));
      return renamed;
    });
  }, []);

  const addNote = useCallback(() => {
    const created = createBlankNote();
    setNotes((current) => [created, ...current]);
    setNote(created);
    setDocumentBlocks(undefined);
    setRuntime(emptyRuntime);
    setNotesOpen(false);
  }, []);

  const removeCurrentNote = useCallback(() => {
    if (!note || !window.confirm(`Delete “${note.title}”?`)) return;
    const remaining = notes.filter((item) => item.id !== note.id);
    void deleteNote(note.id);
    if (remaining.length === 0) {
      const replacement = createBlankNote();
      setNotes([replacement]);
      setNote(replacement);
    } else {
      selectNote(remaining[0]);
      setNotes(remaining);
    }
    setDocumentBlocks(undefined);
    setRuntime(emptyRuntime);
  }, [note, notes, selectNote]);

  if (!note) {
    return <main className="loading-screen">Qaltion</main>;
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="brand" aria-label="Qaltion">Qaltion</div>
        <div className="note-actions">
          <button type="button" className="quiet-button" onClick={() => setNotesOpen((open) => !open)}>
            Notes
          </button>
          <button type="button" className="quiet-button" onClick={addNote}>
            New
          </button>
        </div>
        {notesOpen && (
          <div className="notes-popover" role="dialog" aria-label="Notes">
            <div className="notes-popover-heading">Recent notes</div>
            {notes.map((availableNote) => (
              <button
                type="button"
                className={`note-option ${availableNote.id === note.id ? "selected" : ""}`}
                key={availableNote.id}
                onClick={() => selectNote(availableNote)}
              >
                <span>{availableNote.title}</span>
                <small>{new Date(availableNote.lastOpenedAt).toLocaleDateString()}</small>
              </button>
            ))}
            <button type="button" className="note-delete" onClick={removeCurrentNote}>
              Delete current note
            </button>
          </div>
        )}
      </header>

      <section className="document-shell" aria-label="Calculation note">
        <div className="note-heading">
          <input
            aria-label="Note title"
            value={note.title}
            onChange={(event) => renameNote(event.target.value)}
          />
        </div>
        <EditorPane
          key={note.id}
          note={note}
          runtime={runtime}
          onChange={handleEditorChange}
        />
      </section>
    </main>
  );
}
