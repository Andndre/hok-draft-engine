import type { Hero } from './types';

/**
 * Hero search that tolerates how people actually type on a phone.
 *
 * Every term is compared against a folded, separator-free form of the hero name
 * ("Ao'yin" → "aoyin", "Luban No.7" → "lubanno7"), so `aoyin`, `AOYIN` and `luban7`
 * all resolve without the punctuation. Beyond exact and partial names it accepts
 * skipped letters (`liin` → Li Xin) and single-character typos such as a swapped
 * pair (`ayoin` → Ao'yin).
 *
 * Matches are scored, and a typed query always ranks by relevance first: the
 * user's chosen sort (AI score, win rate, A–Z) only breaks ties. Scores keep name
 * matches above role/lane/counter metadata matches, so `jungle` still behaves as a
 * filter while a hero name always wins the top of the list.
 */

const TOKEN_SPLIT = /[^A-Za-z0-9]+/;
const DIACRITICS = /[\u0300-\u036f]/g;

/** Latin search form: accents folded, lowercase, punctuation and spaces dropped. */
export function normalizeHeroSearchText(text: string): string {
  return text
    .normalize('NFKD')
    .replace(DIACRITICS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function tokensOf(name: string): string[] {
  return name.split(TOKEN_SPLIT).map(normalizeHeroSearchText).filter(Boolean);
}

/** Ordered-character match ("liin" inside "lixin"), scored by how tightly the letters pack. */
function subsequenceScore(name: string, query: string): number {
  if (query.length < 3 || name.length < query.length) return 0;
  let cursor = -1;
  let first = -1;
  let last = -1;
  for (const char of query) {
    const next = name.indexOf(char, cursor + 1);
    if (next < 0) return 0;
    if (first < 0) first = next;
    last = next;
    cursor = next;
  }
  const skipped = last - first + 1 - query.length;
  if (skipped > Math.max(2, Math.ceil(query.length * 0.75))) return 0;
  return Math.max(420, 640 - skipped * 12 - Math.max(0, name.length - query.length) * 2);
}

/**
 * Damerau–Levenshtein distance, banded to `limit`: anything above the limit is
 * reported as `limit + 1`, which lets callers reject a candidate cheaply. The
 * transposition rule is what turns "ayoin" into Ao'yin.
 */
function editDistance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  const rows = a.length;
  const columns = b.length;
  let previousPrevious: number[] = new Array(columns + 1).fill(0);
  let previous: number[] = Array.from({ length: columns + 1 }, (_, index) => index);
  for (let row = 1; row <= rows; row += 1) {
    const current: number[] = new Array(columns + 1).fill(limit + 1);
    current[0] = row;
    const from = Math.max(1, row - limit);
    const to = Math.min(columns, row + limit);
    for (let column = from; column <= to; column += 1) {
      const cost = a[row - 1] === b[column - 1] ? 0 : 1;
      let value = Math.min(previous[column] + 1, current[column - 1] + 1, previous[column - 1] + cost);
      if (row > 1 && column > 1 && a[row - 1] === b[column - 2] && a[row - 2] === b[column - 1]) {
        value = Math.min(value, previousPrevious[column - 2] + 1);
      }
      current[column] = value;
    }
    previousPrevious = previous;
    previous = current;
  }
  return previous[columns];
}

function fuzzyScore(name: string, tokens: string[], query: string): number {
  if (query.length < 3) return 0;
  // Short names tolerate one edit; only long names get room for a second typo, otherwise
  // a 5-letter query fuzzy-matches half the roster.
  const limit = query.length <= 7 ? 1 : query.length <= 11 ? 2 : 3;
  let best = limit + 1;
  for (const candidate of [name, ...tokens]) {
    if (Math.abs(candidate.length - query.length) > limit) continue;
    const distance = editDistance(candidate, query, limit);
    if (distance < best) best = distance;
    if (best <= 1) break;
  }
  if (best > limit) return 0;
  return Math.max(400, 580 - best * 90);
}

/** How well one hero name answers the query; 0 means "no match". */
function scoreNameValue(name: string, query: string): number {
  const normalized = normalizeHeroSearchText(name);
  if (!normalized) return 0;
  if (normalized === query) return 1000;
  if (normalized.startsWith(query)) return 900 - Math.min(80, (normalized.length - query.length) * 5);
  const at = normalized.indexOf(query);
  if (at > 0) return 800 - Math.min(80, at * 6);
  const tokens = tokensOf(name);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const penalty = Math.min(20, index * 5);
    if (token === query) return 880 - penalty;
    if (token.startsWith(query)) return 860 - penalty;
  }
  return subsequenceScore(normalized, query) || fuzzyScore(normalized, tokens, query);
}

/** Best relevance score for one hero, covering name, Chinese label, role, lane and counters. */
export function scoreHeroSearchMatch(hero: Hero, rawQuery: string): number {
  const trimmed = rawQuery.trim();
  if (!trimmed) return 1;
  const query = normalizeHeroSearchText(trimmed);
  let best = query ? scoreNameValue(hero.name, query) : 0;
  // HUD/Chinese labels stay an exact substring test: they are not latinizable.
  if (hero.chinese_name && hero.chinese_name.toLowerCase().includes(trimmed.toLowerCase())) best = Math.max(best, 720);
  if (!query) return best;
  for (const label of [hero.primary_role, hero.primary_lane]) {
    const value = normalizeHeroSearchText(label ?? '');
    if (!value) continue;
    if (value === query) best = Math.max(best, 360);
    else if (value.startsWith(query)) best = Math.max(best, 340);
    else if (value.includes(query)) best = Math.max(best, 320);
  }
  if (query.length >= 3) {
    for (const counter of hero.counters ?? []) {
      if (normalizeHeroSearchText(counter.target_name).includes(query)) {
        best = Math.max(best, 300);
        break;
      }
    }
  }
  return best;
}

/**
 * Filter and order a roster for a search query. An empty query keeps the caller's
 * ordering untouched; a typed query puts the closest match first and uses `compare`
 * only to break ties, so a typo still surfaces the hero above win-rate neighbours.
 */
export function searchHeroes<T extends Hero>(heroes: readonly T[], rawQuery: string, compare: (a: T, b: T) => number = () => 0): T[] {
  if (!rawQuery.trim()) return [...heroes].sort(compare);
  const scored: Array<{ hero: T; score: number }> = [];
  for (const hero of heroes) {
    const score = scoreHeroSearchMatch(hero, rawQuery);
    if (score > 0) scored.push({ hero, score });
  }
  scored.sort((a, b) => b.score - a.score || compare(a.hero, b.hero));
  return scored.map((entry) => entry.hero);
}

/**
 * First hero in a ranked list that is still takeable — the Enter-key target when the
 * user types a name and confirms instead of tapping. Returns undefined when nothing
 * qualifies, so Enter on an exhausted or empty result list stays a no-op.
 */
export function firstSelectableHero<T extends Hero>(heroes: readonly T[], isSelectable: (hero: T) => boolean): T | undefined {
  for (const hero of heroes) if (isSelectable(hero)) return hero;
  return undefined;
}
