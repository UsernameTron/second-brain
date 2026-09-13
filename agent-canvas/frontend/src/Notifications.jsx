import React, { useEffect, useId, useRef, useState } from 'react';

const priority = { error: 2, warn: 1, ok: 0 };
const labels = { error: 'Problem', warn: 'Notice', ok: 'Update' };

// Short-lived feedback stays outside the work area. A burst is one compact
// notice; every message remains readable while the teammate opens its details.
export default function Notifications({ items, onClear }) {
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const opener = useRef(null);
  const detailsId = useId();
  const latest = items.at(-1);
  // A later success must not hide a problem that still needs to be read.
  const headline = items.reduce((current, item) => !current || (priority[item.kind] ?? 2) >= (priority[current.kind] ?? 2) ? item : current, null);

  useEffect(() => {
    if (!items.length || expanded || hovered || focused) return undefined;
    // Reset after the latest update; pause while reading or using the controls.
    const timer = setTimeout(onClear, 4500);
    return () => clearTimeout(timer);
  }, [items, expanded, hovered, focused, onClear]);

  useEffect(() => {
    if (!items.length) { setExpanded(false); setHovered(false); setFocused(false); }
  }, [items.length]);

  const dismiss = () => {
    if (opener.current && document.contains(opener.current)) opener.current.focus();
    onClear();
  };

  return <>
    <div className="notification-announcement" role="status" aria-live="polite" aria-atomic="true">
      {latest ? <span key={latest.id}>{labels[latest.kind] || 'Problem'}: {latest.msg}</span> : null}
    </div>
    <div className="toasts" role={items.length ? 'region' : undefined} aria-label={items.length ? 'Recent updates' : undefined}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      onFocusCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) opener.current = event.relatedTarget;
        setFocused(true);
      }} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
      {headline ? <>
        <div className={`notification-summary toast-${headline.kind}`}>
          <p className="notification-message"><strong>{labels[headline.kind] || 'Problem'}: </strong>{headline.msg}</p>
          <button className="btn small" aria-expanded={expanded} aria-controls={detailsId} onClick={() => setExpanded((value) => !value)}>
            {expanded ? 'Hide details' : items.length > 1 ? `Details (${items.length})` : 'Details'}
          </button>
          <button className="icon-btn notification-dismiss" aria-label="Dismiss updates" onClick={dismiss}>×</button>
        </div>
        {expanded ? <ul id={detailsId} className="notification-list" aria-label="Update details" tabIndex={0}>
          {items.map((item) => <li key={item.id} className={`toast toast-${item.kind}`}><strong>{labels[item.kind] || 'Problem'}: </strong>{item.msg}</li>)}
        </ul> : null}
      </> : null}
    </div>
  </>;
}
