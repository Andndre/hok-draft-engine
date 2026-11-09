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
export function focusHeroSearch() {
  const input = document.getElementById('hero-search') as HTMLInputElement | null;
  input?.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  input?.focus({ preventScroll: true });
}
