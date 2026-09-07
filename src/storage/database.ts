import type { StoredNote } from "../types";

const databaseName = "qaltion";
const databaseVersion = 1;
const notesStore = "notes";

function request<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(notesStore)) {
        const store = database.createObjectStore(notesStore, { keyPath: "id" });
        store.createIndex("lastOpenedAt", "lastOpenedAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
  });
}

export async function listNotes(): Promise<StoredNote[]> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(notesStore, "readonly");
    const notes = await request(transaction.objectStore(notesStore).getAll());
    return notes.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  } finally {
    database.close();
  }
}

export async function saveNote(note: StoredNote): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(notesStore, "readwrite");
    transaction.objectStore(notesStore).put(note);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB write failed"));
    });
  } finally {
    database.close();
  }
}

export async function deleteNote(id: string): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(notesStore, "readwrite");
    transaction.objectStore(notesStore).delete(id);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB delete failed"));
    });
  } finally {
    database.close();
  }
}
