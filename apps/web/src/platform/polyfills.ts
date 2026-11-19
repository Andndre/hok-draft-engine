let initialized = false;

function isPopoverOpen(popover: HTMLElement): boolean {
  try {
    return popover.matches(':popover-open') || popover.classList.contains(':popover-open');
  } catch {
    return popover.classList.contains(':popover-open');
  }
}

/**
 * Syncs `aria-expanded` on interest+popover toggletips and conditionally loads
 * missing Web Platform polyfills (`popover`, `interestfor`, `focusgroup`).
 */
export function initModernWebPlatform(): void {
  if (initialized || typeof window === 'undefined' || typeof document === 'undefined') return;
  initialized = true;

  // Fallback for browsers (e.g. Safari) that support `popover="auto"`/`"manual"`
  // but downgrade `popover="hint"` to `"manual"`: promote toggletips to `"auto"`
  // right before opening so Escape and light-dismiss still close them.
  const probe = document.createElement('div');
  let supportsHintPopover = false;
  try {
    (probe as HTMLElement & { popover?: string }).popover = 'hint';
    supportsHintPopover = (probe as HTMLElement & { popover?: string }).popover === 'hint';
  } catch {
    supportsHintPopover = false;
  }

  if (!supportsHintPopover) {
    document.addEventListener(
      'beforetoggle',
      (event) => {
        const target = event.target as HTMLElement | null;
        const newState = (event as Event & { newState?: string }).newState;
        if (!target || newState !== 'open') return;
        if (target.getAttribute('popover') !== 'hint' || !target.id) return;
        const hasClickInvoker = Boolean(
          document.querySelector(`[popovertarget="${CSS.escape(target.id)}"]`)
        );
        if (hasClickInvoker) {
          target.setAttribute('popover', 'auto');
        }
      },
      true
    );
  }

  // `toggle` does not bubble; capture at `document` to keep `aria-expanded` in sync
  // for toggletips triggered via `[interestfor][popovertarget]`.
  document.addEventListener(
    'toggle',
    (event) => {
      const target = event.target as HTMLElement | null;
      if (!target?.id) return;
      const escapedId = CSS.escape(target.id);
      const triggers = document.querySelectorAll<HTMLElement>(
        `[interestfor="${escapedId}"][popovertarget="${escapedId}"]`
      );
      if (!triggers.length) return;
      const expanded = String(isPopoverOpen(target));
      for (const trigger of triggers) {
        trigger.setAttribute('aria-expanded', expanded);
      }
    },
    true
  );

  // Conditionally load polyfills only when native browser support is missing.
  if (!Object.hasOwn(HTMLElement.prototype, 'popover')) {
    void import('@oddbird/popover-polyfill');
  }
  if (!('interestForElement' in HTMLButtonElement.prototype)) {
    void import('interestfor');
  }
}
