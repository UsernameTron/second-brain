import { useEffect, useRef } from 'react';

// P2.1 shared dialog behavior: on mount, move focus into the dialog (first
// focusable element, else the dialog itself); trap Tab inside; Escape closes;
// on unmount, restore focus to whatever opened it.
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useDialog(onClose) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose; // callers may pass an inline closure — never re-run the effect for it
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return undefined;
    const opener = document.activeElement;
    const first = dialog.querySelector(FOCUSABLE);
    (first || dialog).focus();

    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = Array.from(dialog.querySelectorAll(FOCUSABLE));
      if (!items.length) return;
      const head = items[0];
      const tail = items[items.length - 1];
      if (e.shiftKey && document.activeElement === head) { e.preventDefault(); tail.focus(); }
      else if (!e.shiftKey && document.activeElement === tail) { e.preventDefault(); head.focus(); }
    };
    dialog.addEventListener('keydown', onKey);
    return () => {
      dialog.removeEventListener('keydown', onKey);
      if (opener && typeof opener.focus === 'function' && document.contains(opener)) opener.focus();
    };
  }, []);
  return ref;
}
