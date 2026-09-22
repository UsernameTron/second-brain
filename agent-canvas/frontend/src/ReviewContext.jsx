import React from 'react';
import { humanizeDetail } from './format.jsx';
import { timeAgo } from './api.js';

// Only known routing/diagnostic fields move out of the main reading area.
// Unknown fields, nested proposals and source-authored text remain visible.
const diagnosticFields = new Set(['entry_ids', 'item_key', 'model', 'stepsUsed']);
const labels = { detail: 'What you need to know', before: 'Current value', after: 'Proposed value', attempted: 'Proposed information', incomplete: 'Work is unfinished', error: 'What happened', attempts: 'Attempts so far', from: 'From', to: 'To', crossings: 'Times passed between agents' };
function label(key) {
  const words = String(key).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
  return labels[key] || words.charAt(0).toUpperCase() + words.slice(1);
}
function readableValue(value) {
  let parsed = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); if (!parsed || typeof parsed !== 'object') return value || '(empty text)'; }
    catch { return value || '(empty text)'; }
  }
  const explicitEmpty = (item) => {
    if (item === null) return '(not set)';
    if (item === '') return '(empty text)';
    if (Array.isArray(item)) return item.map(explicitEmpty);
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).map(([key, val]) => [key, explicitEmpty(val)]));
    return item;
  };
  return humanizeDetail(explicitEmpty(parsed));
}
function asContext(value) {
  if (typeof value === 'string') {
    try { const parsed = JSON.parse(value); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed; } catch { /* Ordinary text stays verbatim. */ }
    return { detail: value };
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value : { detail: value };
}

export default function ReviewContext({ data, canvasId, agentsById = {}, onOpenMemory }) {
  if (data == null) return null;
  const context = asContext(data);
  const fields = Object.entries(context).filter(([key]) => !diagnosticFields.has(key));
  const refs = Array.isArray(context.entry_ids) ? context.entry_ids.filter((id) => typeof id === 'string' && id.trim()) : [];
  if (!fields.length && !refs.length) return null;
  return <section className="review-context" aria-label="Decision context">
    <dl className="review-fields">
      {fields.map(([key, value]) => {
        // Coalesced questions are business context. The original timestamps,
        // kinds and agent IDs remain in the card's complete details.
        const updates = key === 'updates' && Array.isArray(value) && value.length && value.every((update) =>
          update && typeof update.question === 'string' && Object.keys(update).every((field) => ['at', 'agentId', 'kind', 'question'].includes(field)));
        return <div key={key} className={`review-field${['before', 'after'].includes(key) ? ' review-change' : ''}`}>
          <dt>{key === 'updates' ? 'Related questions' : label(key)}</dt>
          <dd>{updates ? <ul>{value.map((update, index) => <li key={index}>
            <div>{update.question}</div>
            <small>{agentsById[update.agentId]?.name || 'Agent'}{update.at ? ` · ${timeAgo(update.at)}` : ''}</small>
          </li>)}</ul> : <div className="review-value">{readableValue(value)}</div>}</dd>
        </div>;
      })}
    </dl>
    {refs.length ? <div className="review-references">
      <span>Related memory</span>
      {refs.map((id, index) => onOpenMemory ? <button key={`${id}:${index}`} className="btn small" onClick={() => onOpenMemory({ canvasId, id })}>Memory item {index + 1}</button>
        : <span key={`${id}:${index}`}>Memory item {index + 1} — reference in Full details</span>)}
    </div> : null}
  </section>;
}
