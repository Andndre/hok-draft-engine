import type { DataManifest, Hero, TournamentDataset } from '../types';

// v17 replaces v16 with a schema-v2 package that also validates item and spell catalogs.
export const DATA_CACHE_KEY = 'tournament_dataset_v17';
const DB_NAME = 'HokDraftEngineDB';
const STORE = 'metadata_cache';
const REMOTE_BASE = (import.meta.env?.VITE_R2_PUBLIC_URL || '').trim().replace(/\/$/, '');
type ArtifactKind = keyof DataManifest['artifacts'];
const KINDS: ArtifactKind[] = ['heroes', 'synergy', 'releases', 'items', 'spells'];
export interface CachedPackage { manifest: DataManifest; texts: Record<ArtifactKind, string>; origin?: string }
export interface DatasetIO {
  fetchText: (url: string) => Promise<string>;
  readCache: () => Promise<CachedPackage | null>;
  writeCache: (value: CachedPackage) => Promise<void>;
  remoteBase?: string;
}

async function withStore<T>(operation: (store: IDBObjectStore, resolve: (value: T) => void) => void, fallback: T, mode: IDBTransactionMode): Promise<T> {
  if (typeof indexedDB === 'undefined') return fallback;
  return new Promise(resolve => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'key' });
    };
    request.onerror = () => resolve(fallback);
    request.onblocked = () => resolve(fallback);
    request.onsuccess = () => {
      const db = request.result;
      try {
        const tx = db.transaction(STORE, mode);
        tx.oncomplete = () => db.close();
        tx.onabort = () => { db.close(); resolve(fallback); };
        tx.onerror = () => { db.close(); resolve(fallback); };
        operation(tx.objectStore(STORE), resolve);
      } catch { db.close(); resolve(fallback); }
    };
  });
}
const readCache = () => withStore<CachedPackage | null>((store, resolve) => {
  const req = store.get(DATA_CACHE_KEY);
  req.onsuccess = () => resolve(req.result?.value ?? null);
  req.onerror = () => resolve(null);
}, null, 'readonly');
const writeCache = async (value: CachedPackage) => {
  await withStore<boolean>((store, resolve) => {
    store.put({ key: DATA_CACHE_KEY, value });
    store.transaction.oncomplete = () => { store.transaction.db.close(); resolve(true); };
  }, false, 'readwrite');
};
async function fetchText(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: url.endsWith('data_manifest.json') ? 'no-store' : 'default' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally { clearTimeout(timer); }
}
export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export function validateManifest(value: unknown): DataManifest {
  const m = value as DataManifest;
  if (!m || m.schema_version !== 2 || !/^[a-f0-9]{16}$/.test(m.dataset_version) || !Number.isInteger(m.hero_count) || m.hero_count < 1) throw new Error('Manifest data tidak valid');
  for (const kind of KINDS) {
    const a = m.artifacts?.[kind];
    if (!a || !/^[a-f0-9]{64}$/.test(a.sha256) || !new RegExp(`^datasets/${m.dataset_version}/[a-z_]+\\.json$`).test(a.file)) throw new Error('Referensi artefak tidak valid');
  }
  return m;
}
export async function decodePackage(pkg: CachedPackage): Promise<TournamentDataset> {
  const manifest = validateManifest(pkg.manifest);
  for (const kind of KINDS) if (await sha256(pkg.texts[kind]) !== manifest.artifacts[kind].sha256) throw new Error(`Checksum ${kind} tidak cocok`);
  const heroes: Hero[] = JSON.parse(pkg.texts.heroes);
  const synergy = JSON.parse(pkg.texts.synergy);
  const releases: Record<string, { released: boolean; alias_of?: number }> = JSON.parse(pkg.texts.releases);
  const items = JSON.parse(pkg.texts.items);
  const spells = JSON.parse(pkg.texts.spells);
  if (!Array.isArray(heroes) || heroes.length !== manifest.hero_count || new Set(heroes.map(h => h.hero_id)).size !== heroes.length || !synergy || typeof synergy !== 'object' || Array.isArray(synergy) || !Array.isArray(items) || !Array.isArray(spells)) throw new Error('Isi dataset tidak valid');
  for (const h of heroes) {
    if (!Number.isInteger(h.hero_id) || h.hero_id === 511 || !h.name || typeof h.slug !== 'string' || typeof h.chinese_name !== 'string' || !Array.isArray(h.lanes) || !h.lanes.length || !h.lanes.every(l => ['Clash', 'Jungle', 'Mid', 'Farm', 'Roam'].includes(l)) || !Array.isArray(h.counters) || !Array.isArray(h.countered_by) || !Number.isFinite(h.win_rate) || h.win_rate < 0 || h.win_rate > 1 || !Number.isFinite(h.pick_rate) || typeof releases[h.hero_id]?.released !== 'boolean') throw new Error('Metadata hero atau status rilis tidak valid');
  }
  if (releases['511']?.released !== false || releases['511']?.alias_of !== 556) throw new Error('Alias Ata tidak valid');
  const origin = pkg.origin && /^https?:\/\//.test(pkg.origin) ? pkg.origin.replace(/\/$/, '') : '';
  const resolveAssets = (value: unknown): unknown => {
    if (typeof value === 'string') return origin && value.startsWith('/assets/') ? origin + value : value;
    if (Array.isArray(value)) return value.map(resolveAssets);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveAssets(item)]));
    return value;
  };
  return { version: manifest.dataset_version, manifest, synergy, items: resolveAssets(items) as TournamentDataset['items'], spells: resolveAssets(spells) as TournamentDataset['spells'], heroes: heroes.map(h => ({ ...(resolveAssets(h) as Hero), is_global_released: releases[h.hero_id].released })) };
}

/** Never combine artifacts from different origins or activate a partial update. */
export async function loadTournamentDataset(overrides: Partial<DatasetIO> = {}): Promise<TournamentDataset> {
  const io: DatasetIO = { fetchText, readCache, writeCache, remoteBase: REMOTE_BASE, ...overrides };
  const cached = await io.readCache().catch(() => null);
  let validCache: TournamentDataset | null = null;
  if (cached) try { validCache = await decodePackage(cached); } catch { /* Discard corrupt cache. */ }
  const origins = [...new Set([io.remoteBase, ''].filter((x): x is string => x !== undefined))];
  for (const base of origins) {
    let manifestLoaded = false;
    try {
      const manifest = validateManifest(JSON.parse(await io.fetchText(`${base}/data_manifest.json`)));
      manifestLoaded = true;
      if (validCache && cached && manifest.dataset_version === validCache.version && JSON.stringify(manifest.artifacts) === JSON.stringify(validCache.manifest.artifacts)) {
        if ((cached.origin ?? '') === base) return validCache;
        const rebased = { ...cached, origin: base };
        const dataset = await decodePackage(rebased);
        await io.writeCache(rebased).catch(() => {});
        return dataset;
      }
      const texts = {} as Record<ArtifactKind, string>;
      await Promise.all(KINDS.map(async kind => { texts[kind] = await io.fetchText(`${base}/${manifest.artifacts[kind].file}`); }));
      const pkg = { manifest, texts, origin: base };
      const dataset = await decodePackage(pkg);
      await io.writeCache(pkg).catch(() => {});
      return dataset;
    } catch (error) {
      console.warn('[Dataset] Paket tidak tersedia:', base || 'bawaan', error);
      // If the remote manifest itself is unavailable, try the current bundled manifest before using stale cache.
      // Once a manifest was accepted, a corrupt/partial artifact update must keep the last complete snapshot.
      if (validCache && manifestLoaded) return validCache;
    }
  }
  if (validCache) return validCache;
  throw new Error('Database hero belum dapat dimuat. Coba lagi.');
}

export async function loadHeroMetadata(): Promise<Hero[]> { return (await loadTournamentDataset()).heroes; }
