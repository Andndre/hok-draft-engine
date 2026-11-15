import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeHeroSearchText, scoreHeroSearchMatch, searchHeroes, firstSelectableHero } from '../src/heroSearch.ts';

const read = path => JSON.parse(readFileSync(new URL('../public/' + path, import.meta.url), 'utf8'));
const manifest = read('data_manifest.json');
const heroes = read(manifest.artifacts.heroes.file);
const names = (query, compare) => searchHeroes(heroes, query, compare).map(hero => hero.name);
const byName = name => {
  const hero = heroes.find(candidate => candidate.name === name);
  assert.ok(hero, `Fixture sanity: ${name} must exist in the published dataset`);
  return hero;
};

test('search text folds punctuation, spacing and accents before matching', () => {
  assert.equal(normalizeHeroSearchText("Ao'yin"), 'aoyin');
  assert.equal(normalizeHeroSearchText('Luban No.7'), 'lubanno7');
  assert.equal(normalizeHeroSearchText("Chang'e"), 'change');
  assert.equal(normalizeHeroSearchText('  Gan & Mo  '), 'ganmo');
  assert.equal(normalizeHeroSearchText('Mai Shiranui'), 'maishiranui');
});

test('punctuation-free and lowercase queries resolve the same hero', () => {
  const cases = [
    ['Li Xin', ['lixin', 'Li Xin', 'LIXIN', 'li xin', 'li-xin']],
    ["Ao'yin", ['aoyin', 'AOYIN', "ao'yin", 'ao yin']],
    ["Chang'e", ['change', 'chánge']],
    ['Luban No.7', ['luban7', 'lubanno7', 'luban no 7']],
    ['Gan & Mo', ['ganmo', 'gan & mo', 'ganmo']],
  ];
  for (const [expected, queries] of cases) {
    for (const query of queries) {
      const results = names(query);
      assert.equal(results[0], expected, `"${query}" must rank ${expected} first, got ${results.slice(0, 3).join(', ')}`);
    }
  }
});

test('skipped letters and swapped characters still find the hero at the top', () => {
  // Skipped characters: the letters appear in order inside the name.
  assert.equal(names('liin')[0], 'Li Xin');
  assert.equal(names('lixn')[0], 'Li Xin');
  assert.equal(names('lubno7')[0], 'Luban No.7');
  assert.equal(names('hoyi')[0], 'Hou Yi');
  // Swapped pair (Damerau transposition).
  assert.equal(names('ayoin')[0], "Ao'yin");
  assert.equal(names('aoiyn')[0], "Ao'yin");
  assert.equal(names('lixin'.replace('ix', 'xi'))[0], 'Li Xin');
});

test('one- and two-letter queries only accept real prefix or substring hits', () => {
  const oneLetter = names('z');
  assert.ok(oneLetter.length > 0 && oneLetter.length < heroes.length, 'A single letter must narrow the roster, not empty it');
  const list = names('li');
  assert.ok(list.length >= 4);
  for (const name of list.slice(0, 4)) assert.ok(normalizeHeroSearchText(name).startsWith('li'), `${name} should be a "li" prefix match, not noise`);
  assert.deepEqual(names('zzzq'), [], 'Unrelated junk must not fuzzy-match every hero');
});

test('a typed query ranks by relevance even when the selected sort is win rate', () => {
  const byWinRate = (a, b) => b.win_rate - a.win_rate;
  const ranked = searchHeroes(heroes, 'liin', byWinRate).map(hero => hero.name);
  assert.equal(ranked[0], 'Li Xin', 'Relevance must outrank win-rate order');
  const winSorted = searchHeroes(heroes, '', byWinRate).map(hero => hero.name);
  assert.notEqual(winSorted[0], 'Li Xin', 'Fixture sanity: Li Xin is not the overall win-rate leader');
});

test('role, lane, counter and Chinese label searches keep working', () => {
  const jungle = names('jungle');
  assert.ok(jungle.length > 0);
  for (const name of jungle) {
    const hero = byName(name);
    assert.ok(hero.primary_lane === 'Jungle' || hero.lanes.includes('Jungle'), `${name} must actually be a Jungle hero`);
  }
  const liXin = byName('Li Xin');
  assert.equal(names(liXin.chinese_name)[0], 'Li Xin', 'Chinese hero label remains searchable');
  const target = liXin.counters[0]?.target_name;
  if (target) assert.ok(names(target).includes('Li Xin'), `"${target}" is countered by Li Xin, so the counter search must surface Li Xin`);
});

test('the Enter target is the first available result, never a taken hero', () => {
  const ranked = searchHeroes(heroes, 'li');
  assert.ok(ranked.length > 1);
  assert.equal(firstSelectableHero(ranked, () => true), ranked[0], 'Enter takes the top match when it is still free');
  const taken = new Set([ranked[0].hero_id]);
  assert.equal(firstSelectableHero(ranked, hero => !taken.has(hero.hero_id)), ranked[1], 'A taken top match is skipped for the next one');
  assert.equal(firstSelectableHero(ranked, () => false), undefined, 'An exhausted list turns Enter into a no-op');
  assert.equal(firstSelectableHero([], () => true), undefined);
});

test('empty query keeps every hero and defers to the caller ordering', () => {
  const all = searchHeroes(heroes, '   ', (a, b) => a.name.localeCompare(b.name));
  assert.equal(all.length, heroes.length);
  assert.equal(all[0].name, [...heroes].map(hero => hero.name).sort((a, b) => a.localeCompare(b))[0]);
  assert.ok(scoreHeroSearchMatch(byName('Li Xin'), '') > 0);
  assert.equal(scoreHeroSearchMatch(byName('Li Xin'), 'zzzq'), 0);
});
