import { useEffect, useRef } from 'react';
const dialogs: HTMLElement[] = [];
let previousOverflow = '';

export function useDialogFocus(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const node = ref.current;
    if (!open || !node) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    if (!dialogs.length) { previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; }
    dialogs.push(node);
    const focusables = () => [...node.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]')].filter(element => element.getClientRects().length > 0);
    (focusables()[0] ?? node).focus();
    const handle = (event: KeyboardEvent) => {
      if (dialogs.at(-1) !== node) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close.current(); }
      if (event.key === 'Tab') {
        const targets = focusables(), first = targets[0], last = targets.at(-1);
        if (!first) { event.preventDefault(); node.focus(); }
        else if (event.shiftKey && (document.activeElement === first || document.activeElement === node)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', handle);
    return () => {
      document.removeEventListener('keydown', handle);
      const index = dialogs.indexOf(node); if (index >= 0) dialogs.splice(index, 1);
      if (!dialogs.length) document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [open]);
  return ref;
}
