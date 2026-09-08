import { useCallback, useEffect, useRef, useState } from "react";
import { CalculationClient } from "./calculation/client";
import { AppDialog } from "./components/AppDialog";
import { ThemeToggle } from "./components/ThemeToggle";
import { EditorPane } from "./editor/EditorPane";
import { deleteNote, listNotes, saveNote } from "./storage/database";
import { createSampleNote } from "./storage/sample";
import type { DocumentRuntime, StoredNote } from "./types";
import type { QalculateSymbolRegistry } from "./calculation/registry";
import { applyTheme, getInitialTheme, THEME_STORAGE_KEY, type Theme } from "./theme";

function createEmptyRuntime(status: DocumentRuntime["status"] = "idle", failure?: string): DocumentRuntime {
  return { lines: [], variables: [], engine: "development-fallback", status, failure };
}

function createBlankNote(): StoredNote {
  const note = createSampleNote();
  return { ...note, title: "Untitled note", content: "" };
}

function MenuIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>;
}

function PlusIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>;
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" />
    </svg>
  );
}

function CloseIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>;
}

type NotesListProps = {
  notes: StoredNote[];
  activeNoteId: string;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
};

function NotesList({ notes, activeNoteId, onSelect, onDelete }: NotesListProps) {
  return (
    <nav className="notes-navigation" aria-label="Notes">
      <ul className="notes-list">
        {notes.map((note) => (
          <li className={`note-row ${note.id === activeNoteId ? "selected" : ""}`} key={note.id}>
            <button
              type="button"
              className="note-option"
              aria-current={note.id === activeNoteId ? "page" : undefined}
              aria-label={`Open ${note.title}`}
              onClick={() => onSelect(note.id)}
            >
              <span className="note-option-title">{note.title}</span>
              <small>{new Date(note.lastOpenedAt).toLocaleDateString()}</small>
            </button>
            <button
              type="button"
              className="note-delete-button"
              aria-label={`Delete ${note.title}`}
              onClick={() => onDelete(note.id)}
            >
              <TrashIcon />
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

type ScheduledSave = { timer: number; note: StoredNote };
const EVALUATION_DEBOUNCE_MS = 120;

export default function App() {
  const [theme, setTheme] = useState<Theme>(() => getInitialTheme());
  const [notes, setNotes] = useState<StoredNote[]>([]);
  const notesRef = useRef<StoredNote[]>([]);
  const [activeNoteId, setActiveNoteId] = useState("");
  const activeNoteIdRef = useRef("");
  const [loadStatus, setLoadStatus] = useState<"loading" | "ready">("loading");
  const [runtime, setRuntime] = useState<DocumentRuntime>(() => createEmptyRuntime());
  const [symbolRegistry, setSymbolRegistry] = useState<QalculateSymbolRegistry>();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string>();
  const [deleteStatus, setDeleteStatus] = useState<"idle" | "deleting">("idle");
  const [deleteError, setDeleteError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});
  const calculationClient = useRef<CalculationClient | null>(null);
  const evaluationSequence = useRef(0);
  const scheduledSaves = useRef(new Map<string, ScheduledSave>());
  const saveQueues = useRef(new Map<string, Promise<void>>());
  const activeContent = notes.find((note) => note.id === activeNoteId)?.content;

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const toggleTheme = () => {
    const nextTheme: Theme = theme === "light" ? "dark" : "light";
    setTheme(nextTheme);
    applyTheme(nextTheme);
    window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  };

  const replaceNotes = useCallback((nextNotes: StoredNote[]) => {
    notesRef.current = nextNotes;
    setNotes(nextNotes);
  }, []);

  const queueSave = useCallback((note: StoredNote): Promise<void> => {
    const previous = saveQueues.current.get(note.id) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(() => saveNote(note));
    saveQueues.current.set(note.id, next);
    void next
      .then(() => setSaveErrors((current) => {
        if (!current[note.id]) return current;
        const updated = { ...current };
        delete updated[note.id];
        return updated;
      }))
      .catch(() => setSaveErrors((current) => ({
        ...current,
        [note.id]: `Could not save “${note.title}”. Your changes remain open in this tab.`,
      })))
      .finally(() => {
        if (saveQueues.current.get(note.id) === next) saveQueues.current.delete(note.id);
      });
    return next;
  }, []);

  const scheduleSave = useCallback((note: StoredNote) => {
    const scheduled = scheduledSaves.current.get(note.id);
    if (scheduled) window.clearTimeout(scheduled.timer);
    const timer = window.setTimeout(() => {
      scheduledSaves.current.delete(note.id);
      void queueSave(note);
    }, 450);
    scheduledSaves.current.set(note.id, { timer, note });
  }, [queueSave]);

  const updateNote = useCallback((id: string, update: (note: StoredNote) => StoredNote) => {
    const current = notesRef.current.find((note) => note.id === id);
    if (!current) return;
    const updated = update(current);
    replaceNotes(notesRef.current.map((note) => note.id === id ? updated : note));
    scheduleSave(updated);
  }, [replaceNotes, scheduleSave]);

  const flushScheduledSaves = useCallback(() => {
    for (const { timer, note } of scheduledSaves.current.values()) {
      window.clearTimeout(timer);
      void queueSave(note);
    }
    scheduledSaves.current.clear();
  }, [queueSave]);

  useEffect(() => {
    let current = true;
    try {
      calculationClient.current = new CalculationClient();
      const client = calculationClient.current;
      const registryPromise = client.getSymbolRegistry?.();
      if (registryPromise) {
        void registryPromise.then((registry) => {
          if (current && registry) setSymbolRegistry(registry);
        });
      }
    } catch {
      calculationClient.current = null;
    }
    void listNotes()
      .then((storedNotes) => {
        if (!current) return;
        const availableNotes = storedNotes.length > 0 ? storedNotes : [createSampleNote()];
        replaceNotes(availableNotes);
        activeNoteIdRef.current = availableNotes[0].id;
        setActiveNoteId(availableNotes[0].id);
        setLoadStatus("ready");
      })
      .catch(() => {
        if (!current) return;
        const fallback = createSampleNote();
        replaceNotes([fallback]);
        activeNoteIdRef.current = fallback.id;
        setActiveNoteId(fallback.id);
        setLoadError("Stored notes could not be loaded. Changes will remain open in this tab.");
        setLoadStatus("ready");
      });
    return () => {
      current = false;
      calculationClient.current?.dispose();
    };
  }, [replaceNotes]);

  useEffect(() => {
    if (loadStatus !== "ready" || activeContent === undefined) return;
    const sequence = ++evaluationSequence.current;
    const client = calculationClient.current;
    if (!client) {
      setRuntime(createEmptyRuntime("error", "The calculation engine could not be started."));
      return;
    }
    const noteId = activeNoteId;
    setRuntime((previous) => ({ ...previous, status: "pending", failure: undefined }));
    const timer = window.setTimeout(() => {
      void client.evaluateDocument(activeContent)
        .then((nextRuntime) => {
          if (evaluationSequence.current === sequence && activeNoteIdRef.current === noteId) {
            setRuntime(nextRuntime);
          }
        })
        .catch((error: unknown) => {
          if (evaluationSequence.current !== sequence || activeNoteIdRef.current !== noteId) return;
          console.error("[Qaltion] Document evaluation failed.", error);
          setRuntime(createEmptyRuntime("error", "The calculation engine is unavailable."));
        });
    }, EVALUATION_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [activeContent, activeNoteId, loadStatus]);

  useEffect(() => {
    const flushWhenHidden = () => {
      if (document.visibilityState === "hidden") flushScheduledSaves();
    };
    window.addEventListener("pagehide", flushScheduledSaves);
    document.addEventListener("visibilitychange", flushWhenHidden);
    return () => {
      window.removeEventListener("pagehide", flushScheduledSaves);
      document.removeEventListener("visibilitychange", flushWhenHidden);
      flushScheduledSaves();
    };
  }, [flushScheduledSaves]);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 641px)");
    const closeDrawerOnDesktop = (event: MediaQueryListEvent) => {
      if (event.matches) setDrawerOpen(false);
    };
    desktop.addEventListener("change", closeDrawerOnDesktop);
    if (desktop.matches) setDrawerOpen(false);
    return () => desktop.removeEventListener("change", closeDrawerOnDesktop);
  }, []);

  const handleEditorChange = useCallback((noteId: string, content: string) => {
    if (notesRef.current.find((note) => note.id === noteId)?.content === content) return;
    if (noteId === activeNoteIdRef.current) evaluationSequence.current += 1;
    updateNote(noteId, (note) => ({ ...note, content, updatedAt: Date.now() }));
  }, [updateNote]);

  const selectNote = useCallback((id: string) => {
    setDrawerOpen(false);
    if (id === activeNoteIdRef.current) return;
    updateNote(id, (note) => ({ ...note, lastOpenedAt: Date.now() }));
    activeNoteIdRef.current = id;
    setActiveNoteId(id);
    setRuntime(createEmptyRuntime());
  }, [updateNote]);

  const renameNote = useCallback((title: string) => {
    updateNote(activeNoteIdRef.current, (note) => ({
      ...note,
      title: title || "Untitled note",
      updatedAt: Date.now(),
    }));
  }, [updateNote]);

  const addNote = useCallback(() => {
    const created = createBlankNote();
    replaceNotes([created, ...notesRef.current]);
    scheduleSave(created);
    activeNoteIdRef.current = created.id;
    setActiveNoteId(created.id);
    setRuntime(createEmptyRuntime());
    setDrawerOpen(false);
  }, [replaceNotes, scheduleSave]);

  const requestDelete = useCallback((id: string) => {
    setDrawerOpen(false);
    setDeleteError("");
    setDeleteTargetId(id);
  }, []);

  const closeDeleteDialog = useCallback(() => {
    if (deleteStatus === "deleting") return;
    setDeleteTargetId(undefined);
    setDeleteError("");
  }, [deleteStatus]);

  const confirmDelete = useCallback(async () => {
    if (!deleteTargetId) return;
    setDeleteStatus("deleting");
    setDeleteError("");
    const scheduled = scheduledSaves.current.get(deleteTargetId);
    if (scheduled) {
      window.clearTimeout(scheduled.timer);
      scheduledSaves.current.delete(deleteTargetId);
    }
    try {
      await saveQueues.current.get(deleteTargetId)?.catch(() => undefined);
      await deleteNote(deleteTargetId);
      let remaining = notesRef.current.filter((note) => note.id !== deleteTargetId);
      if (remaining.length === 0) {
        const replacement = createBlankNote();
        remaining = [replacement];
        scheduleSave(replacement);
      }
      replaceNotes(remaining);
      setSaveErrors((current) => {
        if (!current[deleteTargetId]) return current;
        const updated = { ...current };
        delete updated[deleteTargetId];
        return updated;
      });
      if (activeNoteIdRef.current === deleteTargetId) {
        activeNoteIdRef.current = remaining[0].id;
        setActiveNoteId(remaining[0].id);
        setRuntime(createEmptyRuntime());
      }
      setDeleteTargetId(undefined);
    } catch {
      const latest = notesRef.current.find((note) => note.id === deleteTargetId);
      if (latest) scheduleSave(latest);
      setDeleteError("The note could not be deleted. Please try again.");
    } finally {
      setDeleteStatus("idle");
    }
  }, [deleteTargetId, replaceNotes, scheduleSave]);

  if (loadStatus === "loading") {
    return <main className="loading-screen" role="status" aria-live="polite">Loading notes...</main>;
  }

  const note = notes.find((item) => item.id === activeNoteId);
  if (!note) return null;
  const deleteTarget = notes.find((item) => item.id === deleteTargetId);
  const storageError = loadError || saveErrors[activeNoteId];

  const notesList = (
    <NotesList notes={notes} activeNoteId={activeNoteId} onSelect={selectNote} onDelete={requestDelete} />
  );

  return (
    <>
      <main className="app-shell">
        <aside className="notes-sidebar">
          <div className="sidebar-heading">
            <div className="brand" aria-label="Qaltion">Qaltion</div>
            <button type="button" className="new-note-button" onClick={addNote}>
              <PlusIcon /><span>New note</span>
            </button>
          </div>
          {notesList}
          <div className="sidebar-footer">
            <ThemeToggle theme={theme} onToggle={toggleTheme} />
          </div>
        </aside>

        <div className="workspace">
          <header className="mobile-header">
            <button type="button" className="icon-button" aria-label="Open notes" onClick={() => setDrawerOpen(true)}>
              <MenuIcon />
            </button>
            <span className="mobile-title">{note.title}</span>
            <button type="button" className="icon-button" aria-label="New note" onClick={addNote}>
              <PlusIcon />
            </button>
          </header>
          <section className="document-shell" aria-label="Calculation note">
            <div className="note-heading">
              <input aria-label="Note title" value={note.title} onChange={(event) => renameNote(event.target.value)} />
              <div className="engine-status" aria-live="polite">
                {runtime.status === "pending" && runtime.lines.length === 0
                  ? "Loading calculation engine..."
                  : runtime.status === "ready" && runtime.engine === "development-fallback"
                    ? "Development fallback engine"
                    : ""}
              </div>
            </div>
            <EditorPane key={note.id} note={note} runtime={runtime} registry={symbolRegistry} onChange={handleEditorChange} />
          </section>
        </div>
      </main>

      {(storageError || runtime.status === "error") && (
        <div className="app-notifications">
          {storageError && <div className="storage-error" role="alert">{storageError}</div>}
          {runtime.status === "error" && <div className="calculation-error" role="alert">{runtime.failure}</div>}
        </div>
      )}

      <AppDialog className="notes-drawer" labelledBy="notes-drawer-title" open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <div className="drawer-heading">
          <h2 id="notes-drawer-title">Notes</h2>
          <button type="button" className="icon-button" aria-label="Close notes" autoFocus onClick={() => setDrawerOpen(false)}>
            <CloseIcon />
          </button>
        </div>
        <button type="button" className="new-note-button drawer-new-note" onClick={addNote}>
          <PlusIcon /><span>New note</span>
        </button>
        {notesList}
        <div className="drawer-footer">
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </div>
      </AppDialog>

      <AppDialog
        className="delete-modal"
        labelledBy="delete-modal-title"
        open={Boolean(deleteTarget)}
        preventClose={deleteStatus === "deleting"}
        onClose={closeDeleteDialog}
      >
        <h2 id="delete-modal-title">Delete note?</h2>
        <p className="delete-modal-copy">
          {deleteTarget ? `“${deleteTarget.title}” will be permanently deleted.` : "This note will be permanently deleted."}
        </p>
        {deleteError && <div className="delete-error" role="alert">{deleteError}</div>}
        <div className="delete-modal-actions">
          <button type="button" className="secondary-button" autoFocus onClick={closeDeleteDialog} disabled={deleteStatus === "deleting"}>
            Cancel
          </button>
          <button
            type="button"
            className="danger-button"
            aria-busy={deleteStatus === "deleting"}
            aria-label={deleteStatus === "deleting" ? "Deleting note" : "Delete note"}
            onClick={() => void confirmDelete()}
            disabled={deleteStatus === "deleting"}
          >
            {deleteStatus === "deleting" ? "Deleting..." : "Delete"}
          </button>
        </div>
      </AppDialog>
    </>
  );
}
