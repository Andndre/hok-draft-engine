/** Keep source metadata intact; strip decorative emoji only from display copy. */
export function plainText(text: string | null | undefined): string {
  return (text ?? '').replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\u200D\uFE0E\uFE0F\u20E3]/gu, '').replace(/[ \t]{2,}/g, ' ').trim();
}
export function displayCopy<T>(value: T): T {
  if (typeof value === 'string') return plainText(value) as T;
  if (Array.isArray(value)) return value.map(displayCopy) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, displayCopy(item)])) as T;
  return value;
}
function prefersReducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
export interface HeroSearchFocusOptions {
  /**
   * Select the whole query so the next keystroke starts a fresh search.
   * Used on mobile: tapping a result dismisses the keyboard, so the field is
   * handed back focused with its text highlighted for re-typing.
   */
  select?: boolean;
}

/**
 * Return focus to the roster search field, scrolling it into view only when it is
 * off-screen. Returns false when no visible search field is mounted (the toolbar of
 * an inactive tab/mode is rendered `hidden`, so its input must never be focused).
 */
export function focusHeroSearch({ select = false }: HeroSearchFocusOptions = {}): boolean {
  if (typeof document === 'undefined') return false;
  const input = document.getElementById('hero-search') as HTMLInputElement | null;
  if (!input) return false;
  const rect = input.getBoundingClientRect();
  if (!rect.width || !rect.height) return false;
  const viewportHeight = typeof window === 'undefined' ? 0 : window.innerHeight || 0;
  const fullyVisible = viewportHeight <= 0 || (rect.top >= 0 && rect.bottom <= viewportHeight);
  if (!fullyVisible) input.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  input.focus({ preventScroll: true });
  if (select && input.value && typeof input.select === 'function') input.select();
  return true;
}
