import { useEffect } from 'react';
import type React from 'react';

/**
 * Polyfills `focusgroup` only on the given tablist element (when native `focusgroup`
 * support is absent) instead of observing the entire `document.body`.
 */
export function useFocusgroup(
  ref: React.RefObject<HTMLElement | null>,
  enabled = true
): void {
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el || typeof window === 'undefined' || typeof HTMLElement === 'undefined') {
      return;
    }
    if ('focusgroup' in HTMLElement.prototype || Object.hasOwn(HTMLElement.prototype, 'focusGroup')) {
      return;
    }
    let cancelled = false;
    void import('@microsoft/focusgroup-polyfill/shadowless').then((mod) => {
      if (cancelled || !el.isConnected) return;
      mod.polyfill(el);
    });
    return () => {
      cancelled = true;
    };
  }, [ref, enabled]);
}
