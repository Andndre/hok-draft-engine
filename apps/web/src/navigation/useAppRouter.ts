import { useState, useEffect, useCallback, useRef } from 'react';
import {
  RouteState,
  DEFAULT_ROUTE_STATE,
  parseRoute,
  buildRouteHash,
  formatShareUrl,
} from './appRouter';

export interface UseAppRouterReturn {
  route: RouteState;
  navigate: (patch: Partial<RouteState>, options?: { replace?: boolean }) => void;
  openHeroModal: (heroIdOrSlug: string | number) => void;
  closeHeroModal: () => void;
  clearShareData: () => void;
  getShareDraftUrl: (shareCode: string) => string;
  getSharePracticeUrl: (shareCode: string) => string;
  getHeroShareUrl: (heroIdOrSlug: string | number) => string;
}

export function useAppRouter(): UseAppRouterReturn {
  const [route, setRoute] = useState<RouteState>(() => {
    if (typeof window === 'undefined') return DEFAULT_ROUTE_STATE;
    const initialHash = window.location.hash;
    const initialSearch = window.location.search;

    // Fallback: if hash is empty, check pathname (e.g. /draft/vision)
    if (!initialHash && window.location.pathname && window.location.pathname !== '/') {
      return parseRoute(window.location.pathname, initialSearch);
    }

    return parseRoute(initialHash, initialSearch);
  });

  const isNavigatingInternalRef = useRef(false);

  // Sync state when browser back/forward or hash change occurs
  useEffect(() => {
    const handleLocationChange = () => {
      if (isNavigatingInternalRef.current) {
        isNavigatingInternalRef.current = false;
        return;
      }
      const newHash = window.location.hash;
      const newSearch = window.location.search;
      const nextRoute = parseRoute(newHash, newSearch);
      setRoute((prev) => {
        if (
          prev.activeTab === nextRoute.activeTab &&
          prev.draftMode === nextRoute.draftMode &&
          prev.wikiSubTab === nextRoute.wikiSubTab &&
          prev.heroIdOrSlug === nextRoute.heroIdOrSlug &&
          prev.shareData === nextRoute.shareData
        ) {
          return prev;
        }
        return nextRoute;
      });
    };

    window.addEventListener('hashchange', handleLocationChange);
    window.addEventListener('popstate', handleLocationChange);
    return () => {
      window.removeEventListener('hashchange', handleLocationChange);
      window.removeEventListener('popstate', handleLocationChange);
    };
  }, []);

  const navigate = useCallback(
    (patch: Partial<RouteState>, options: { replace?: boolean } = {}) => {
      setRoute((current) => {
        const next: RouteState = {
          ...current,
          ...patch,
        };

        const targetHash = buildRouteHash(next);
        const currentHash = window.location.hash || '#/';

        if (targetHash !== currentHash) {
          isNavigatingInternalRef.current = true;
          if (options.replace) {
            window.history.replaceState(null, '', targetHash);
          } else {
            window.history.pushState(null, '', targetHash);
          }
        }

        return next;
      });
    },
    []
  );

  const openHeroModal = useCallback(
    (heroIdOrSlug: string | number) => {
      navigate({ heroIdOrSlug: String(heroIdOrSlug) });
    },
    [navigate]
  );

  const closeHeroModal = useCallback(() => {
    navigate({ heroIdOrSlug: null }, { replace: true });
  }, [navigate]);

  const clearShareData = useCallback(() => {
    navigate({ shareData: null }, { replace: true });
  }, [navigate]);

  const getShareDraftUrl = useCallback((shareCode: string): string => {
    const hash = buildRouteHash({ activeTab: 'draft', draftMode: 'simulator', shareData: shareCode });
    return formatShareUrl(hash);
  }, []);

  const getSharePracticeUrl = useCallback((shareCode: string): string => {
    const hash = buildRouteHash({ activeTab: 'draft', draftMode: 'practice', shareData: shareCode });
    return formatShareUrl(hash);
  }, []);

  const getHeroShareUrl = useCallback((heroIdOrSlug: string | number): string => {
    const hash = buildRouteHash({ heroIdOrSlug: String(heroIdOrSlug) });
    return formatShareUrl(hash);
  }, []);

  return {
    route,
    navigate,
    openHeroModal,
    closeHeroModal,
    clearShareData,
    getShareDraftUrl,
    getSharePracticeUrl,
    getHeroShareUrl,
  };
}
