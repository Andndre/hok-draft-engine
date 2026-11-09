import { ModelManifest, Hero } from '../types';

const DB_NAME = 'HokDraftEngineDB';
const DB_VERSION = 1;
const STORE_MODELS = 'models_cache';
const STORE_METADATA = 'metadata_cache';

const R2_BASE_URL = (import.meta.env.VITE_R2_PUBLIC_URL || '').trim();

function openIndexedDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB not supported in this environment'));
    }
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
    console.warn(`[IDB] Read warning on ${storeName}:`, err);
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
    console.warn(`[IDB] Write warning on ${storeName}:`, err);
  }
}

/**
 * Robust fetch with automatic local fallback if R2/RustFS is unreachable or blocked
 */
async function fetchWithFallback(filename: string): Promise<Response> {
  if (R2_BASE_URL) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2500);
      const targetUrl = `${R2_BASE_URL}/${filename}`;
      const res = await fetch(targetUrl, { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) {
        console.log(`[ModelLoader] Loaded ${filename} from storage: ${targetUrl}`);
        return res;
      }
    } catch (e) {
      console.warn(`[ModelLoader] Remote fetch failed for ${filename}, falling back to local /${filename}:`, e);
    }
  }

  // Local fallback
  const localUrl = `/${filename}`;
  const localRes = await fetch(localUrl);
  if (!localRes.ok) {
    throw new Error(`Failed to load ${filename} (HTTP ${localRes.status})`);
  }
  console.log(`[ModelLoader] Loaded ${filename} from local static root`);
  return localRes;
}

export async function fetchManifest(): Promise<ModelManifest | null> {
  try {
    const res = await fetchWithFallback('manifest.json');
    return await res.json();
  } catch (err) {
    console.warn('[ModelLoader] Could not load manifest:', err);
    return null;
  }
}

export async function loadHeroMetadata(): Promise<Hero[]> {
  const cacheKey = 'master_hero_metadata_v2';
  const cached = await getFromIDB<Hero[]>(STORE_METADATA, cacheKey);

  if (cached && cached.length === 120) {
    // Background validation
    fetchWithFallback('hero_metadata.json')
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
    const res = await fetchWithFallback('hero_metadata.json');
    const fresh: Hero[] = await res.json();
    await saveToIDB(STORE_METADATA, cacheKey, fresh);
    return fresh;
  } catch (err) {
    console.error('[ModelLoader] Failed to load hero metadata:', err);
    return cached || [];
  }
}

export async function loadOnnxModelBuffer(): Promise<ArrayBuffer> {
  const manifest = await fetchManifest();
  const modelHash = manifest ? manifest.sha256 : 'latest';
  const cacheKey = `onnx_model_${modelHash}`;

  const cachedBuffer = await getFromIDB<ArrayBuffer>(STORE_MODELS, cacheKey);
  if (cachedBuffer) {
    console.log(`[IndexedDB] Loaded ONNX model from instant cache (${(cachedBuffer.byteLength / 1024).toFixed(1)} KB)`);
    return cachedBuffer;
  }

  const modelFile = manifest ? manifest.model_file : 'hok_jev_student.onnx';
  const res = await fetchWithFallback(modelFile);
  const arrayBuffer = await res.arrayBuffer();
  await saveToIDB(STORE_MODELS, cacheKey, arrayBuffer);
  console.log(`[IndexedDB] Cached ONNX model (${(arrayBuffer.byteLength / 1024).toFixed(1)} KB)`);
  return arrayBuffer;
}
