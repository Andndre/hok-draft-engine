import { Hero } from '../types';

const DB_NAME = 'HokDraftEngineDB';
const DB_VERSION = 1;
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

export async function loadHeroMetadata(): Promise<Hero[]> {
  const cacheKey = 'master_hero_metadata_v15_counters_direction_fixed';
  const cached = await getFromIDB<Hero[]>(STORE_METADATA, cacheKey);

  // Validate that cached heroes contain strict Global release status, Ata merge, KPL synergies, fixed tournament tiers, and correct counter direction
  const isCacheValid =
    cached &&
    cached.length >= 120 &&
    cached.some((h) => h.hero_id === 556 && h.is_global_released === true && h.kpl_matchup?.synergies && h.kpl_matchup.synergies.length > 0) &&
    cached.some((h) => h.hero_id === 112 && h.tier === 'B') &&
    cached.some((h) => h.hero_id === 156 && h.countered_by?.some((cb) => cb.counter_id === 182));

  if (isCacheValid) {
    return cached;
  }

  try {
    const res = await fetchWithFallback('hero_metadata.json');
    const fresh: Hero[] = await res.json();
    if (fresh && fresh.length >= 120) {
      await saveToIDB(STORE_METADATA, cacheKey, fresh);
    }
    return fresh;
  } catch (err) {
    console.error('[ModelLoader] Failed to load hero metadata:', err);
    return cached || [];
  }
}

