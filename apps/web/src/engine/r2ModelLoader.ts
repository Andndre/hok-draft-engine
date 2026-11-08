import { ModelManifest, Hero } from '../types';

const DB_NAME = 'HokDraftEngineDB';
const DB_VERSION = 1;
const STORE_MODELS = 'models_cache';
const STORE_METADATA = 'metadata_cache';

const R2_BASE_URL = import.meta.env.VITE_R2_PUBLIC_URL || '';

function openIndexedDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_MODELS)) {
        db.createObjectStore(STORE_MODELS, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_METADATA)) {
        db.createObjectStore(STORE_METADATA, { keyPath: 'key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getFromIDB<T>(storeName: string, key: string): Promise<T | null> {
  try {
    const db = await openIndexedDB();
    return new Promise((resolve) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result ? req.result.value : null);
      req.onerror = () => resolve(null);
    });
  } catch (err) {
    console.warn(`IndexedDB read error on ${storeName}:`, err);
    return null;
  }
}

async function saveToIDB<T>(storeName: string, key: string, value: T): Promise<void> {
  try {
    const db = await openIndexedDB();
    return new Promise((resolve) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      store.put({ key, value });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch (err) {
    console.warn(`IndexedDB write error on ${storeName}:`, err);
  }
}

export async function fetchManifest(): Promise<ModelManifest | null> {
  const url = R2_BASE_URL ? `${R2_BASE_URL}/manifest.json` : '/manifest.json';
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn(`Could not load manifest from ${url}:`, err);
    return null;
  }
}

export async function loadHeroMetadata(): Promise<Hero[]> {
  const cacheKey = 'master_hero_metadata';
  const cached = await getFromIDB<Hero[]>(STORE_METADATA, cacheKey);
  
  const manifest = await fetchManifest();
  const url = R2_BASE_URL ? `${R2_BASE_URL}/hero_metadata.json` : '/hero_metadata.json';

  if (cached && cached.length === 120) {
    // Background validation
    fetch(url)
      .then((r) => r.json())
      .then((fresh) => {
        if (fresh && fresh.length === 120) {
          saveToIDB(STORE_METADATA, cacheKey, fresh);
        }
      })
      .catch(() => {});
    return cached;
  }

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const fresh: Hero[] = await res.json();
    await saveToIDB(STORE_METADATA, cacheKey, fresh);
    return fresh;
  } catch (err) {
    console.error('Failed to load hero metadata:', err);
    return cached || [];
  }
}

export async function loadOnnxModelBuffer(): Promise<ArrayBuffer> {
  const manifest = await fetchManifest();
  const modelHash = manifest ? manifest.sha256 : 'latest';
  const cacheKey = `onnx_model_${modelHash}`;

  const cachedBuffer = await getFromIDB<ArrayBuffer>(STORE_MODELS, cacheKey);
  if (cachedBuffer) {
    console.log(`[IndexedDB] Loaded ONNX model from instant cache (${(cachedBuffer.byteLength / 1024 / 1024).toFixed(2)} MB)`);
    return cachedBuffer;
  }

  const modelFile = manifest ? manifest.model_file : 'hok_jev_student.onnx';
  const url = R2_BASE_URL ? `${R2_BASE_URL}/${modelFile}` : `/${modelFile}`;
  console.log(`[R2 Fetch] Fetching ONNX model from ${url}...`);

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download ONNX model: HTTP ${res.status}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  await saveToIDB(STORE_MODELS, cacheKey, arrayBuffer);
  console.log(`[IndexedDB] Cached ONNX model (${(arrayBuffer.byteLength / 1024 / 1024).toFixed(2)} MB)`);
  return arrayBuffer;
}
