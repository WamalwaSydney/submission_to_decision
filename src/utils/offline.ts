import { OfflineDraft } from '../types';

const DB_NAME = 'participation-platform-db';
const DB_VERSION = 1;
const DRAFTS_STORE = 'drafts';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(DRAFTS_STORE)) {
        db.createObjectStore(DRAFTS_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveDraft(draft: OfflineDraft): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DRAFTS_STORE, 'readwrite');
    const store = tx.objectStore(DRAFTS_STORE);
    store.put(draft);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAllDrafts(): Promise<OfflineDraft[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DRAFTS_STORE, 'readonly');
    const store = tx.objectStore(DRAFTS_STORE);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getUnsyncedDrafts(): Promise<OfflineDraft[]> {
  const drafts = await getAllDrafts();
  return drafts.filter(d => !d.synced);
}

export async function markDraftSynced(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DRAFTS_STORE, 'readwrite');
    const store = tx.objectStore(DRAFTS_STORE);
    const getRequest = store.get(id);
    getRequest.onsuccess = () => {
      const draft = getRequest.result;
      if (draft) {
        draft.synced = true;
        store.put(draft);
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteDraft(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DRAFTS_STORE, 'readwrite');
    const store = tx.objectStore(DRAFTS_STORE);
    store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
