import { useCallback, useLayoutEffect, useRef } from 'react';

function isPointerOutsideDialog(event: PointerEvent, dialog: HTMLDialogElement): boolean {
  const rect = dialog.getBoundingClientRect();
  return (
    event.clientX < rect.left ||
    event.clientX > rect.right ||
    event.clientY < rect.top ||
    event.clientY > rect.bottom
  );
}

/**
 * Guards against async `'close'` events left over from a prior close cycle
 * (such as React StrictMode mount -> cleanup -> remount) while the dialog is open again.
 */
export function shouldNotifyDialogClose(active: boolean, dialog: Pick<HTMLDialogElement, 'open'>): boolean {
  return active && !dialog.open;
}

/**
 * Manages a native modal `<dialog>` element opened via `showModal()`, relying on
 * browser top-layer, inertness, focus trapping, focus return, and `Esc` handling,
 * with a `closedby="any"` pointer fallback for browsers without native `closedBy`.
 */
export function useNativeModalDialog(open: boolean, onClose: () => void) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const requestClose = useCallback(() => {
    const node = dialogRef.current;
    if (node?.open && typeof node.close === 'function') {
      node.close();
    } else {
      closeRef.current();
    }
  }, []);

  useLayoutEffect(() => {
    const node = dialogRef.current;
    if (!open || !node) return;
    let active = true;

    if (typeof node.showModal === 'function' && !node.open) {
      node.showModal();
    }

    const handleClose = () => {
      if (!shouldNotifyDialogClose(active, node)) return;
      closeRef.current();
    };
    node.addEventListener('close', handleClose);

    // Fallback light-dismiss when `closedby="any"` is unsupported (e.g. Safari).
    const supportsClosedBy =
      typeof HTMLDialogElement !== 'undefined' && 'closedBy' in HTMLDialogElement.prototype;
    let pressedOutside = false;
    const handlePointerDown = (event: PointerEvent) => {
      pressedOutside = isPointerOutsideDialog(event, node);
    };
    const handlePointerUp = (event: PointerEvent) => {
      if (pressedOutside && isPointerOutsideDialog(event, node)) {
        node.close();
      }
      pressedOutside = false;
    };

    if (!supportsClosedBy) {
      node.addEventListener('pointerdown', handlePointerDown);
      node.addEventListener('pointerup', handlePointerUp);
    }

    return () => {
      active = false;
      node.removeEventListener('close', handleClose);
      if (!supportsClosedBy) {
        node.removeEventListener('pointerdown', handlePointerDown);
        node.removeEventListener('pointerup', handlePointerUp);
      }
      if (node.open && typeof node.close === 'function') {
        node.close();
      }
    };
  }, [open]);

  return { dialogRef, requestClose };
}
