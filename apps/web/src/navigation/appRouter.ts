import type { ActiveTab } from '../types';

export type DraftMode = 'simulator' | 'practice' | 'vision';
export type WikiSubTab = 'hero' | 'item' | 'arcana' | 'spell';

export interface RouteState {
  activeTab: ActiveTab;
  draftMode: DraftMode;
  wikiSubTab: WikiSubTab;
  heroIdOrSlug: string | null;
  shareData: string | null;
}

export const DEFAULT_ROUTE_STATE: RouteState = {
  activeTab: 'draft',
  draftMode: 'simulator',
  wikiSubTab: 'hero',
  heroIdOrSlug: null,
  shareData: null,
};

/**
 * Parses raw hash and search strings into a structured RouteState.
 */
export function parseRoute(rawHash: string = '', rawSearch: string = ''): RouteState {
  let hash = rawHash.trim();
  if (hash.startsWith('#')) hash = hash.slice(1);
  if (hash.startsWith('/')) hash = hash.slice(1);

  // Extract query params from hash if present (e.g. /draft?share=xyz)
  let pathPart = hash;
  let queryPart = '';
  const hashQuestionIdx = hash.indexOf('?');
  if (hashQuestionIdx !== -1) {
    pathPart = hash.slice(0, hashQuestionIdx);
    queryPart = hash.slice(hashQuestionIdx + 1);
  }

  // Combine query parts from search and hash (hash query takes precedence)
  const searchParams = new URLSearchParams(rawSearch);
  if (queryPart) {
    const hashParams = new URLSearchParams(queryPart);
    hashParams.forEach((val, key) => {
      searchParams.set(key, val);
    });
  }

  const shareData = searchParams.get('share') || null;

  // Clean path segments
  const segments = pathPart
    .split('/')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  // Default initial state
  const state: RouteState = {
    ...DEFAULT_ROUTE_STATE,
    shareData,
  };

  if (segments.length === 0) {
    return state;
  }

  const [primary, secondary] = segments;

  if (primary === 'hero' && secondary) {
    state.heroIdOrSlug = secondary;
    return state;
  }

  if (primary === 'draft') {
    state.activeTab = 'draft';
    if (secondary === 'practice') {
      state.draftMode = 'practice';
    } else if (secondary === 'vision') {
      state.draftMode = 'vision';
    } else {
      state.draftMode = 'simulator';
    }
    return state;
  }

  if (primary === 'counter') {
    state.activeTab = 'counter';
    state.wikiSubTab = 'hero';
    return state;
  }

  if (primary === 'wiki') {
    if (secondary === 'counter') {
      state.activeTab = 'counter';
      state.wikiSubTab = 'hero';
    } else {
      state.activeTab = 'wiki';
      if (secondary === 'item' || secondary === 'arcana' || secondary === 'spell') {
        state.wikiSubTab = secondary;
      } else {
        state.wikiSubTab = 'hero';
      }
    }
    return state;
  }

  if (primary === 'favorites') {
    state.activeTab = 'favorites';
    return state;
  }

  return state;
}

/**
 * Builds a canonical hash string from route state.
 */
export function buildRouteHash(state: Partial<RouteState>): string {
  if (state.heroIdOrSlug) {
    return `#/hero/${encodeURIComponent(state.heroIdOrSlug.toLowerCase())}`;
  }

  if (state.activeTab === 'favorites') {
    return '#/favorites';
  }

  if (state.activeTab === 'counter') {
    return '#/wiki/counter';
  }

  if (state.activeTab === 'wiki') {
    if (state.wikiSubTab && state.wikiSubTab !== 'hero') {
      return `#/wiki/${state.wikiSubTab}`;
    }
    return '#/wiki';
  }

  // ActiveTab === 'draft' (or default)
  if (state.draftMode === 'practice') {
    return '#/draft/practice';
  }
  if (state.draftMode === 'vision') {
    return '#/draft/vision';
  }

  if (state.shareData) {
    return `#/draft?share=${encodeURIComponent(state.shareData)}`;
  }

  return '#/draft';
}

/**
 * Creates an absolute or relative shareable URL.
 */
export function formatShareUrl(hash: string, baseUrl?: string): string {
  const origin =
    baseUrl ||
    (typeof window !== 'undefined' && window.location ? window.location.origin + window.location.pathname : '');
  let cleanBase = origin.split('#')[0].split('?')[0];
  if (!cleanBase.endsWith('/')) {
    cleanBase += '/';
  }
  const cleanHash = hash.startsWith('#') ? hash : `#${hash}`;
  return `${cleanBase}${cleanHash}`;
}
