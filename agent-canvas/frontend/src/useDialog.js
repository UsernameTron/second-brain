import { useEffect, useRef } from 'react';

// P2.1 shared dialog behavior: on mount, move focus into the dialog (first
// focusable element, else the dialog itself); trap Tab inside; Escape closes;
// on unmount, restore focus to whatever opened it.
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';
function focusable(dialog) {
  return Array.from(dialog.querySelectorAll(FOCUSABLE)).filter((element) => {
    if (element.tabIndex < 0 || element.matches('input[type="hidden"]')) return false;
    for (let parent = element; parent && parent !== dialog; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (parent.hidden || parent.hasAttribute('inert') || style.display === 'none' || style.visibility === 'hidden') return false;
      if (parent.tagName === 'DETAILS' && !parent.open && !parent.querySelector(':scope > summary')?.contains(element)) return false;
    }
    return true;
  });
}

export function useDialog(onClose) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose; // callers may pass an inline closure — never re-run the effect for it
  // Capture the opener during the first render, before the same commit can
  // unmount it (e.g. a menu item that closes its menu while opening a modal).
  const openerRef = useRef(null);
  if (openerRef.current === null) openerRef.current = document.activeElement;
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return undefined;
    const opener = openerRef.current;
    const first = focusable(dialog)[0];
    (first || dialog).focus();

    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusable(dialog);
      if (!items.length) { e.preventDefault(); return; }
      const head = items[0];
      const tail = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === head || document.activeElement === dialog)) { e.preventDefault(); tail.focus(); }
      else if (!e.shiftKey && document.activeElement === tail) { e.preventDefault(); head.focus(); }
    };
    dialog.addEventListener('keydown', onKey);
    return () => {
      dialog.removeEventListener('keydown', onKey);
      // Restore only to a real, still-mounted opener — never yank focus to
      // <body>, and never fight a caller's own onClose focus handoff.
      if (opener && opener !== document.body && typeof opener.focus === 'function' && document.contains(opener)) opener.focus();
    };
  }, []);
  return ref;
}
