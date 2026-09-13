import { certaintyLabel, workStatusLabel } from './format.jsx';
import React, { useEffect, useState } from 'react';
import { api, timeAgo, short } from './api.js';
import { RequestError, useResource } from './RequestState.jsx';
import { useDraft } from './Drafts.jsx';
import { Panel } from './Panels.jsx';

const HISTORY_LABELS = { created: 'Added', corrected: 'Corrected', reclassified: 'Certainty or type changed', reaffirmed: 'Confirmed again', 'earlier history truncated': 'Earlier changes not shown' };
const TYPES = { fact: 'Fact', decision: 'Decision', preference: 'Preference', constraint: 'Limit (constraint)', outcome: 'Result (outcome)', feedback: 'Feedback' };
const optionalText = (value) => value == null || typeof value === 'string';
const validEntry = (entry) => entry && typeof entry.id === 'string' && typeof entry.content === 'string'
  && ['verified', 'inference', 'assumption'].includes(entry.epistemic)
  && ['kind', 'subject', 'reviewAt', 'createdAt', 'source', 'runId', 'supersededBy', 'supersedes', 'supersedeReason'].every((key) => optionalText(entry[key]))
  && (entry.author == null || (typeof entry.author === 'object' && optionalText(entry.author.id) && optionalText(entry.author.name)));
async function readSources(id) {
  if (!id) return null;
  const data = await api(`/api/memory/${id}/lineage`);
  if (!validEntry(data?.entry) || data.entry.id !== id || !['upstream', 'downstream', 'runReads'].every((key) => Array.isArray(data[key]) && data[key].every(validEntry))
    || (data.producingRun != null && (typeof data.producingRun.id !== 'string' || typeof data.producingRun.status !== 'string'
      || !optionalText(data.producingRun.agent_id) || !optionalText(data.producingRun.instruction)))) throw new Error('The memory source response was incomplete.');
  return data;
}
async function readHistory(id) {
  if (!id) return null;
  const data = await api(`/api/memory/${id}/timeline`);
  if (!Array.isArray(data?.events) || data.events.some((event) => !event || typeof event.entryId !== 'string' || typeof event.event !== 'string'
    || !['byName', 'reason', 'at'].every((key) => optionalText(event[key])))) throw new Error('The memory history response was incomplete.');
  return data;
}

const DOT_SHAPE = { verified: 'filled', inference: 'half', assumption: 'hollow' };

export function EpiDot({ epistemic }) {
  // Decorative: the epistemic label always sits next to it in text.
  return <span className={`epi-dot ${DOT_SHAPE[epistemic] || 'hollow'}`} aria-hidden="true" />;
}

function Legend() {
  return (
    <details className="epi-legend-help"><summary>What certainty means</summary><div className="epi-legend">
      <span className="epi-legend-item epi-verified"><EpiDot epistemic="verified" /> {certaintyLabel('verified')} <i>solid</i></span>
      <span className="epi-legend-item epi-inference"><EpiDot epistemic="inference" /> {certaintyLabel('inference')} <i>dashed</i></span>
      <span className="epi-legend-item epi-assumption"><EpiDot epistemic="assumption" /> {certaintyLabel('assumption')} <i>dotted</i></span>
    </div></details>
  );
}

function Provenance({ entry, onOpenRun }) {
  return (
    <div className="mem-prov">
      <span title={`author: ${entry.author?.id}`}>{entry.author?.name || (entry.author?.id ? `Author reference: ${entry.author.id}` : 'Author unavailable')}</span>
      <span className="prov-sep">·</span>
      <span>{entry.source || 'No source recorded'}</span>
      <span className="prov-sep">·</span>
      <span title={entry.createdAt}>{timeAgo(entry.createdAt)}</span>
      {entry.runId ? (
        <button className="link-btn" onClick={() => onOpenRun(entry.runId)} title={`Work reference: ${entry.runId}`}>View work</button>
      ) : null}
    </div>
  );
}

function MemoryEntry({ entry, ripple, onOpenRun, onTrace, onCorrect, compact, depth, selected }) {
  const [correcting, setCorrecting] = useState(false);
  const [cContent, setCContent] = useDraft(`correction:${entry.id}:content`, entry.content);
  const [cEpi, setCEpi] = useDraft(`correction:${entry.id}:certainty`, 'verified');
  const [cReason, setCReason] = useDraft(`correction:${entry.id}:reason`, '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const correct = async (body) => {
    if (saving || error?.unconfirmed) return;
    setSaving(true); setError(null);
    try { await onCorrect(entry.id, body); setCorrecting(false); } catch (e) { setError(e); }
    finally { setSaving(false); }
  };

  const superseded = !!entry.supersededBy;
  const cls = [
    'mem-entry',
    `epi-${entry.epistemic}`,
    superseded ? 'superseded' : '',
    ripple && ripple.flash === entry.id ? 'mem-flash' : '',
    ripple && ripple.ids && ripple.ids.has(entry.id) ? 'mem-ripple' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={cls}>
      <div className="mem-top">
        <EpiDot epistemic={entry.epistemic} />
        <span className="epi-label">{certaintyLabel(entry.epistemic)}</span>
        {typeof depth === 'number' ? <span className="chip depth-chip mono">Link distance: {depth}</span> : null}
        {entry.kind ? <span className="chip kind-chip">{TYPES[entry.kind] || `Type: ${entry.kind}`}</span> : null}
        {entry.subject ? <span className="chip subject-chip">{entry.subject}</span> : null}
        {entry.reviewAt ? <span className="chip review-chip mono" title="Date this information needs review">Review by {entry.reviewAt.slice(0, 10)}</span> : null}
        {entry.tainted ? <span className="tainted-flag">⚠ Uses information that was corrected</span> : null}
        {superseded ? <span className="chip superseded-chip">Earlier version</span> : null}
        {entry.supersedes ? <span className="chip correction-chip">Correction</span> : null}
      </div>
      <div className="mem-content">{entry.content}</div>
      {entry.supersedeReason ? <div className="mem-reason">Reason: {entry.supersedeReason}</div> : null}
      <Provenance entry={entry} onOpenRun={onOpenRun} />
      {!compact ? (
        <div className="mem-actions">
          <button className="link-btn" onClick={() => onTrace(entry.id)}>{selected ? 'Refresh details' : 'History and sources'}</button>
          {!superseded && onCorrect ? (
            <button className="link-btn" onClick={() => setCorrecting((v) => !v)}>
              {correcting ? 'Cancel correction' : 'Correct…'}
            </button>
          ) : null}
          {/* One-click reclassify: same content, new epistemic state, via the
              normal append-only correction path — reversible by correcting again. */}
          {!superseded && onCorrect ? <details><summary>Change certainty</summary><p>This creates a correction and preserves the original entry.</p>{['verified', 'inference', 'assumption']
            .filter((epi) => epi !== entry.epistemic)
            .map((epi) => (
              <button
                key={epi}
                className="link-btn reclass-btn"
                title={`Change to ${certaintyLabel(epi)}; keep the original entry and unchanged wording`}
                disabled={saving || error?.unconfirmed}
                onClick={() => correct({
                  content: entry.content,
                  epistemic: epi,
                  reason: `reclassified ${certaintyLabel(entry.epistemic)} → ${epi}`,
                })}
              >
                → {certaintyLabel(epi)}
              </button>
            ))}</details> : null}
        </div>
      ) : (
        <div className="mem-actions">
          <button className="link-btn" onClick={() => onTrace(entry.id)}>History and sources</button>
        </div>
      )}
      <RequestError error={error} subject="Recording your correction" onRetry={() => onTrace(entry.id)} retryLabel="Check memory history" />
      {error?.unconfirmed ? <button className="btn small" onClick={() => setError(null)}>I checked memory history; keep editing</button> : null}
      {correcting ? (
        <form
          className="correct-form"
          onSubmit={(e) => {
            e.preventDefault();
            correct({ content: cContent, epistemic: cEpi, reason: cReason });
          }}
        >
          <textarea aria-label="Corrected memory" disabled={saving} rows="3" value={cContent} onChange={(e) => setCContent(e.target.value)} />
          <div className="correct-row">
            <select aria-label="Certainty" disabled={saving} value={cEpi} onChange={(e) => setCEpi(e.target.value)}>
              <option value="verified">{certaintyLabel('verified')}</option>
              <option value="inference">{certaintyLabel('inference')}</option>
              <option value="assumption">{certaintyLabel('assumption')}</option>
            </select>
            <input aria-label="Reason for the correction" disabled={saving} placeholder="reason for the correction" value={cReason} onChange={(e) => setCReason(e.target.value)} />
            <button className="btn primary small" type="submit" disabled={saving || error?.unconfirmed || !cContent.trim()}>Correct</button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

export default function MemoryPanel({
  entries, agentsById, showSuperseded, onToggleSuperseded, ripple, onOpenRun, onCorrect, onClose, toast, initialEntryId, secondEntryId, loadStatus, onRefresh,
}) {
  const [entryId, setEntryId] = useState(initialEntryId || null);
  const sources = useResource(() => readSources(entryId), entryId);
  const history = useResource(() => readHistory(entryId), entryId);
  const [filter, setFilter] = useState('');
  const [kindFilter, setKindFilter] = useState('');
  useEffect(() => { if (initialEntryId) setEntryId(initialEntryId); }, [initialEntryId]);
  const trace = (id) => {
    if (id === entryId) { sources.refresh(); history.refresh(); }
    else setEntryId(id);
  };

  if (entryId) {
    const d = sources.data;
    return (
      <Panel
        title="History and sources"
        onClose={onClose}
        headerExtra={<button className="btn ghost small" onClick={() => setEntryId(null)}>Back to memory</button>}
      >
        <Legend />
        <RequestError error={loadStatus?.error} subject="Loading the source project" onRetry={onRefresh} />
        {secondEntryId ? <button className="btn small" onClick={() => trace(entryId === secondEntryId ? initialEntryId : secondEntryId)}>Review the other conflicting entry</button> : null}
        <RequestError error={sources.error} subject="Loading memory sources" onRetry={sources.refresh} />
        {sources.loading ? <p role="status">Loading memory sources…</p> : null}
        {sources.error && d ? <p>Last known sources are shown. Try again to confirm their current details.</p> : null}
        <section aria-label="Changes over time" className="memory-history">
          <h3>Changes over time</h3>
          <RequestError error={history.error} subject="Loading memory history" onRetry={history.refresh} />
          {history.loading ? <p role="status">Loading memory history…</p> : null}
          {history.error && history.data ? <p>Last known changes are shown. Try again to confirm the current history.</p> : null}
          {!history.loading && !history.error && history.data?.events.length === 0 ? <p>No history events were returned. <button className="btn small" onClick={history.refresh}>Refresh history</button></p> : null}
          {history.data?.events.length > 0 ? <div className="mem-timeline">{history.data.events.map((event) => (
            <div key={event.entryId} className={`mem-timeline-row tl-${event.event}`}>
              <span className={`chip tl-chip tl-${event.event}`} title={`Recorded event: ${event.event}`}>{HISTORY_LABELS[event.event] || `History event: ${event.event}`}</span>
              <span className="dim">{event.at ? String(event.at).slice(0, 10) : 'Date unavailable'}</span>
              <span className="dim">{event.byName || 'Author unavailable'}</span>
              {event.reason ? <span className="tl-reason">{event.reason}</span> : null}
              {event.entryId !== entryId ? <button className="link-btn" onClick={() => trace(event.entryId)}>View this version</button> : null}
            </div>
          ))}</div> : null}
        </section>
        {d ? (
          <div className="lineage">
            <h3>This entry</h3>
            <MemoryEntry key={d.entry.id} entry={d.entry} ripple={ripple} onOpenRun={onOpenRun} onTrace={trace} onCorrect={onCorrect} selected />

            <h3>Sources this entry uses ({d.upstream.length})</h3>
            {d.upstream.length === 0 ? <div className="empty-hint">No earlier memory entries are linked as sources.</div> : null}
            {[...d.upstream].sort((a, b) => a.depth - b.depth).map((e) => (
              <MemoryEntry key={e.id} entry={e} depth={e.depth} ripple={ripple} onOpenRun={onOpenRun} onTrace={trace} compact />
            ))}

            <h3>Entries that use this information ({d.downstream.length})</h3>
            {d.downstream.length === 0 ? <div className="empty-hint">No other memory entries are linked to this information.</div> : null}
            {[...d.downstream].sort((a, b) => a.depth - b.depth).map((e) => (
              <MemoryEntry key={e.id} entry={e} depth={e.depth} ripple={ripple} onOpenRun={onOpenRun} onTrace={trace} compact />
            ))}

            <h3>Work that created this entry</h3>
            {d.producingRun ? (
              <div className="lineage-run">
                <div>
                  <span className="dot-inline" style={{ background: agentsById?.[d.producingRun.agent_id]?.color || '#8a94a8' }} />
                  <b>{agentsById?.[d.producingRun.agent_id]?.name || 'Agent name unavailable'}</b>
                  <span className={`chip run-${d.producingRun.status === 'completed' ? 'completed' : 'halted'}`}>{workStatusLabel(d.producingRun.status)}</span>
                  <button className="link-btn" onClick={() => onOpenRun(d.producingRun.id)}>View work</button>
                </div>
                <div className="lineage-run-instr">{short(d.producingRun.instruction, 180)}</div>
                <details><summary>Technical details</summary><p>Agent reference: {d.producingRun.agent_id || 'Unavailable'}</p><p>Work reference: {d.producingRun.id}</p><p>Recorded status: {d.producingRun.status}</p></details>
              </div>
            ) : <div className="empty-hint">No agent work record is linked to this entry.</div>}

            {d.producingRun ? (
              <>
                <h3>Memory read during that work ({d.runReads.length})</h3>
                {d.runReads.length === 0 ? <div className="empty-hint">No memory reads were recorded for that work.</div> : null}
                {d.runReads.map((e) => (
                  <MemoryEntry key={e.id} entry={e} ripple={ripple} onOpenRun={onOpenRun} onTrace={trace} compact />
                ))}
              </>
            ) : null}
          </div>
        ) : null}
      </Panel>
    );
  }

  const visible = entries
    .filter((e) => !filter || (e.content || '').toLowerCase().includes(filter.toLowerCase())
      || (e.subject || '').toLowerCase().includes(filter.toLowerCase()))
    .filter((e) => !kindFilter || e.kind === kindFilter);

  return (
    <Panel
      title={`Memory (${loadStatus?.loading || loadStatus?.error ? '—' : entries.length})`}
      onClose={onClose}
      headerExtra={
        <label className="superseded-toggle" title="Include original entries that were replaced by corrections">
          <input type="checkbox" checked={showSuperseded} onChange={onToggleSuperseded} />
          Include earlier versions
        </label>
      }
    >
      <Legend />
      <RequestError error={loadStatus?.error} subject="Loading memory" onRetry={onRefresh} />
      {loadStatus?.loading ? <p role="status">Loading memory…</p> : null}
      {loadStatus?.error && entries.length > 0 ? <p>Last known memory is shown; refresh before editing.</p> : null}
      <div className="mem-filter-row">
        <input
          className="mem-filter"
          aria-label="Search memory"
          placeholder="Search memory…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <select aria-label="Memory type" className="mem-kind-filter" value={kindFilter} onChange={(e) => setKindFilter(e.target.value)} title="Filter by type">
          <option value="">All types</option>
          {['fact', 'decision', 'preference', 'constraint', 'outcome', 'feedback'].map((k) => (
            <option key={k} value={k}>{TYPES[k]}</option>
          ))}
        </select>
      </div>
      {visible.length === 0 && !loadStatus?.loading && !loadStatus?.error ? (
        <div className="empty-hint">
          {entries.length === 0 ? 'No memory yet — agents write here as they work.' : 'Nothing matches that filter.'}
        </div>
      ) : null}
      {visible.map((e) => (
        <MemoryEntry
          key={e.id}
          entry={e}
          ripple={ripple}
          onOpenRun={onOpenRun}
          onTrace={trace}
          onCorrect={onCorrect}
        />
      ))}
    </Panel>
  );
}
