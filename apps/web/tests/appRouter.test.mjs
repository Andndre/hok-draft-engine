import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRoute, buildRouteHash, formatShareUrl } from '../src/navigation/appRouter.ts';

test('parseRoute handles empty, root and default draft routes', () => {
  assert.deepEqual(parseRoute(''), {
    activeTab: 'draft',
    draftMode: 'simulator',
    wikiSubTab: 'hero',
    heroIdOrSlug: null,
    shareData: null,
  });

  assert.deepEqual(parseRoute('#/'), {
    activeTab: 'draft',
    draftMode: 'simulator',
    wikiSubTab: 'hero',
    heroIdOrSlug: null,
    shareData: null,
  });

  assert.deepEqual(parseRoute('#/draft'), {
    activeTab: 'draft',
    draftMode: 'simulator',
    wikiSubTab: 'hero',
    heroIdOrSlug: null,
    shareData: null,
  });
});

test('parseRoute parses practice and vision draft modes', () => {
  const practice = parseRoute('#/draft/practice');
  assert.equal(practice.activeTab, 'draft');
  assert.equal(practice.draftMode, 'practice');

  const vision = parseRoute('#/draft/vision');
  assert.equal(vision.activeTab, 'draft');
  assert.equal(vision.draftMode, 'vision');
});

test('parseRoute parses wiki subtabs and counter modes', () => {
  const wikiHero = parseRoute('#/wiki');
  assert.equal(wikiHero.activeTab, 'wiki');
  assert.equal(wikiHero.wikiSubTab, 'hero');

  const wikiItem = parseRoute('#/wiki/item');
  assert.equal(wikiItem.activeTab, 'wiki');
  assert.equal(wikiItem.wikiSubTab, 'item');

  const wikiArcana = parseRoute('#/wiki/arcana');
  assert.equal(wikiArcana.activeTab, 'wiki');
  assert.equal(wikiArcana.wikiSubTab, 'arcana');

  const wikiSpell = parseRoute('#/wiki/spell');
  assert.equal(wikiSpell.activeTab, 'wiki');
  assert.equal(wikiSpell.wikiSubTab, 'spell');

  const wikiCounter = parseRoute('#/wiki/counter');
  assert.equal(wikiCounter.activeTab, 'counter');

  const counterDirect = parseRoute('#/counter');
  assert.equal(counterDirect.activeTab, 'counter');
});

test('parseRoute parses hero drawer modal route', () => {
  const heroRoute = parseRoute('#/hero/liang');
  assert.equal(heroRoute.heroIdOrSlug, 'liang');

  const heroById = parseRoute('#/hero/106');
  assert.equal(heroById.heroIdOrSlug, '106');
});

test('parseRoute parses favorites route', () => {
  const fav = parseRoute('#/favorites');
  assert.equal(fav.activeTab, 'favorites');
});

test('parseRoute extracts share data from query param in hash or search', () => {
  const hashShare = parseRoute('#/draft?share=abc123xyz');
  assert.equal(hashShare.shareData, 'abc123xyz');

  const searchShare = parseRoute('', '?share=def456uvw');
  assert.equal(searchShare.shareData, 'def456uvw');
});

test('buildRouteHash generates expected canonical hashes', () => {
  assert.equal(buildRouteHash({ activeTab: 'draft', draftMode: 'simulator' }), '#/draft');
  assert.equal(buildRouteHash({ activeTab: 'draft', draftMode: 'practice' }), '#/draft/practice');
  assert.equal(buildRouteHash({ activeTab: 'draft', draftMode: 'vision' }), '#/draft/vision');
  assert.equal(buildRouteHash({ activeTab: 'wiki', wikiSubTab: 'hero' }), '#/wiki');
  assert.equal(buildRouteHash({ activeTab: 'wiki', wikiSubTab: 'item' }), '#/wiki/item');
  assert.equal(buildRouteHash({ activeTab: 'wiki', wikiSubTab: 'arcana' }), '#/wiki/arcana');
  assert.equal(buildRouteHash({ activeTab: 'wiki', wikiSubTab: 'spell' }), '#/wiki/spell');
  assert.equal(buildRouteHash({ activeTab: 'counter' }), '#/wiki/counter');
  assert.equal(buildRouteHash({ activeTab: 'favorites' }), '#/favorites');
  assert.equal(buildRouteHash({ heroIdOrSlug: 'liang' }), '#/hero/liang');
  assert.equal(buildRouteHash({ shareData: 'mockData' }), '#/draft?share=mockData');
});

test('formatShareUrl cleanly joins origin and hash', () => {
  const url = formatShareUrl('#/draft/vision', 'https://hokdraft.com');
  assert.equal(url, 'https://hokdraft.com/#/draft/vision');

  const urlWithExistingHash = formatShareUrl('#/wiki/item', 'https://hokdraft.com/#/old');
  assert.equal(urlWithExistingHash, 'https://hokdraft.com/#/wiki/item');
});
