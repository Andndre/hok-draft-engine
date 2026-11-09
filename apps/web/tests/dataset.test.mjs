import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DATA_CACHE_KEY, decodePackage, loadTournamentDataset, sha256 } from '../src/engine/heroDataLoader.ts';
import { isHeroGlobalReleased } from '../src/data/heroReleaseStatus.ts';

const read = file => readFileSync(new URL('../public/' + file, import.meta.url), 'utf8');
const manifest = JSON.parse(read('data_manifest.json'));
const original = { manifest, texts: Object.fromEntries(Object.entries(manifest.artifacts).map(([key, a]) => [key, read(a.file)])) };
async function changed(transform) {
  const pkg = structuredClone(original);
  const data = Object.fromEntries(Object.entries(pkg.texts).map(([key, value]) => [key, JSON.parse(value)]));
  transform(data);
  pkg.manifest.dataset_version = '0123456789abcdef';
  pkg.manifest.hero_count = data.heroes.length;
  for (const key of Object.keys(data)) {
    pkg.texts[key] = JSON.stringify(data[key]);
    const a = pkg.manifest.artifacts[key];
    a.file = a.file.replace(manifest.dataset_version, pkg.manifest.dataset_version);
    a.sha256 = await sha256(pkg.texts[key]);
  }
  return pkg;
}
const source = pkg => async url => {
  if (url.endsWith('data_manifest.json')) return JSON.stringify(pkg.manifest);
  const key = Object.keys(pkg.manifest.artifacts).find(key => url.endsWith(pkg.manifest.artifacts[key].file));
  if (!key) throw new Error('Missing artifact');
  return pkg.texts[key];
};
test('schema v2 validates item and spell catalogs in the v17 atomic cache package', async () => {
  const dataset = await decodePackage(original);
  assert.equal(manifest.schema_version, 2);
  assert.equal(DATA_CACHE_KEY, 'tournament_dataset_v17');
  assert.ok(Array.isArray(dataset.items) && dataset.items.length > 0);
  assert.ok(Array.isArray(dataset.spells) && dataset.spells.length > 0);
  assert.ok(manifest.artifacts.items.sha256 && manifest.artifacts.spells.sha256);
  assert.equal(dataset.items[0].sources.hokfire.source.source, 'HOKFIRE');
});
test('new hero and changed Global release become usable without a model rebuild', async () => {
  const update = await changed(data => {
    data.heroes.push({ ...data.heroes[0], hero_id: 9999, name: 'New fixture hero' });
    data.releases['9999'] = { released: true };
    data.releases['194'] = { released: true };
  });
  let saved;
  const dataset = await loadTournamentDataset({ remoteBase: 'https://storage.example', readCache: async () => original, fetchText: source(update), writeCache: async pkg => { saved = pkg; } });
  assert.ok(isHeroGlobalReleased(dataset.heroes.find(h => h.hero_id === 9999)));
  assert.ok(isHeroGlobalReleased(dataset.heroes.find(h => h.hero_id === 194)));
  assert.ok(dataset.heroes[0].portrait_asset.startsWith('https://storage.example/assets/'));
  assert.equal(saved.manifest.dataset_version, dataset.version);
});
test('partial or corrupt remote update retains the complete prior snapshot', async () => {
  const update = await changed(data => { data.releases['194'] = { released: true }; });
  update.texts.synergy += 'corruption';
  let writes = 0;
  const dataset = await loadTournamentDataset({ remoteBase: 'https://storage.example', readCache: async () => original, fetchText: source(update), writeCache: async () => { writes++; } });
  assert.equal(dataset.version, original.manifest.dataset_version);
  assert.equal(isHeroGlobalReleased(dataset.heroes.find(h => h.hero_id === 194)), false);
  assert.equal(writes, 0);
});
test('corrupt IndexedDB package falls back to the validated bundled package', async () => {
  const badCache = structuredClone(original); badCache.texts.heroes = '[]';
  const result = await loadTournamentDataset({ remoteBase: '', readCache: async () => badCache, fetchText: source(original), writeCache: async () => {} });
  assert.equal(result.heroes.length, original.manifest.hero_count);
});
test('same version still checks the manifest, then reuses validated cache', async () => {
  let calls = 0;
  const dataset = await loadTournamentDataset({ remoteBase: '', readCache: async () => original, fetchText: async url => { calls++; return source(original)(url); }, writeCache: async () => assert.fail('Cache should be reused') });
  assert.equal(calls, 1);
  assert.equal(dataset.version, original.manifest.dataset_version);
});
test('unknown release and active alias cannot enter the package', async () => {
  const missing = await changed(data => { delete data.releases[String(data.heroes[0].hero_id)]; });
  await assert.rejects(decodePackage(missing));
  const alias = await changed(data => { data.heroes.push({ ...data.heroes[0], hero_id: 511 }); });
  await assert.rejects(decodePackage(alias));
});
test('a storage domain change rebases cached asset URLs even if the data version stays the same', async () => {
  const old = { ...structuredClone(original), origin: 'https://old-storage.example' };
  const dataset = await loadTournamentDataset({ remoteBase: 'https://new-storage.example', readCache: async () => old, fetchText: source(original), writeCache: async () => {} });
  assert.ok(dataset.heroes[0].portrait_asset.startsWith('https://new-storage.example/assets/'));
});
