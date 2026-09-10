import React, { useEffect, useRef, useState } from 'react';
import { api, timeAgo, short } from './api.js';
import { RequestError } from './RequestState.jsx';
import { useDraft } from './Drafts.jsx';
import { Panel } from './Panels.jsx';

const DOT_SHAPE = { verified: 'filled', inference: 'half', assumption: 'hollow' };

export function EpiDot({ epistemic }) {
  // Decorative: the epistemic label always sits next to it in text.
  return <span className={`epi-dot ${DOT_SHAPE[epistemic] || 'hollow'}`} aria-hidden="true" />;
}

function Legend() {
  return (
    <div className="epi-legend">
      <span className="epi-legend-item epi-verified"><EpiDot epistemic="verified" /> verified <i>solid</i></span>
      <span className="epi-legend-item epi-inference"><EpiDot epistemic="inference" /> inference <i>dashed</i></span>
      <span className="epi-legend-item epi-assumption"><EpiDot epistemic="assumption" /> assumption <i>dotted</i></span>
    </div>
  );
}

function Provenance({ entry, onOpenRun }) {
  return (
    <div className="mem-prov mono">
      <span title={`author: ${entry.author?.id}`}>{entry.author?.name || entry.author?.id || 'unknown'}</span>
      <span className="prov-sep">·</span>
      <span>{entry.source || 'no source'}</span>
      <span className="prov-sep">·</span>
      <span title={entry.createdAt}>{timeAgo(entry.createdAt)}</span>
      {entry.runId ? (
        <button className="link-btn" onClick={() => onOpenRun(entry.runId)} title={`run ${entry.runId}`}>run ↗</button>
      ) : null}
    </div>
  );
}

function MemoryEntry({ entry, ripple, onOpenRun, onTrace, onCorrect, compact, depth }) {
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
        <span className="epi-label">{entry.epistemic}</span>
        {typeof depth === 'number' ? <span className="chip depth-chip mono">depth {depth}</span> : null}
        {entry.kind ? <span className="chip kind-chip">{entry.kind}</span> : null}
        {entry.subject ? <span className="chip subject-chip">{entry.subject}</span> : null}
        {entry.reviewAt ? <span className="chip review-chip mono" title="scheduled re-verification">review {entry.reviewAt.slice(0, 10)}</span> : null}
        {entry.tainted ? <span className="tainted-flag">⚠ built on corrected info</span> : null}
        {superseded ? <span className="chip superseded-chip">superseded</span> : null}
        {entry.supersedes ? <span className="chip correction-chip">correction</span> : null}
      </div>
      <div className="mem-content">{entry.content}</div>
      {entry.supersedeReason ? <div className="mem-reason">reason: {entry.supersedeReason}</div> : null}
      <Provenance entry={entry} onOpenRun={onOpenRun} />
      {!compact ? (
        <div className="mem-actions">
          <button className="link-btn" onClick={() => onTrace(entry.id)}>Trace lineage</button>
          {!superseded && onCorrect ? (
            <button className="link-btn" onClick={() => setCorrecting((v) => !v)}>
              {correcting ? 'Cancel correction' : 'Correct…'}
            </button>
          ) : null}
          {/* One-click reclassify: same content, new epistemic state, via the
              normal append-only correction path — reversible by correcting again. */}
          {!superseded && onCorrect ? ['verified', 'inference', 'assumption']
            .filter((epi) => epi !== entry.epistemic)
            .map((epi) => (
              <button
                key={epi}
                className="link-btn reclass-btn"
                title={`Reclassify as ${epi} (supersedes this entry, same content)`}
                disabled={saving || error?.unconfirmed}
                onClick={() => correct({
                  content: entry.content,
                  epistemic: epi,
                  reason: `reclassified ${entry.epistemic} → ${epi}`,
                })}
              >
                → {epi}
              </button>
            )) : null}
        </div>
      ) : (
        <div className="mem-actions">
          <button className="link-btn" onClick={() => onTrace(entry.id)}>Trace</button>
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
              <option value="verified">verified</option>
              <option value="inference">inference</option>
              <option value="assumption">assumption</option>
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
  entries, agentsById, showSuperseded, onToggleSuperseded, ripple, onOpenRun, onCorrect, onClose, toast, initialEntryId, loadStatus, onRefresh,
}) {
  const [lineage, setLineage] = useState(null); // {entryId, data|null}
  const [timeline, setTimeline] = useState(null); // P2: {entryId, events}|null
  const [filter, setFilter] = useState('');
  const [kindFilter, setKindFilter] = useState('');
  const [lineageError, setLineageError] = useState(null);
  const [timelineError, setTimelineError] = useState(null);
  const traceIdRef = useRef(null); // the entry being traced NOW — stale responses check it

  const trace = (entryId) => {
    traceIdRef.current = entryId;
    setLineageError(null); setTimelineError(null);
    setLineage({ entryId, data: null });
    setTimeline(null);
    api(`/api/memory/${entryId}/lineage`)
      .then((d) => setLineage((cur) => (cur && cur.entryId === entryId ? { entryId, data: d } : cur)))
      .catch((e) => { if (traceIdRef.current === entryId) setLineageError(e); });
    // The lifecycle timeline rides alongside lineage; failure never blocks it.
    // A slow response for a PREVIOUS entry must not clobber the current one's
    // timeline (codex on #184).
    api(`/api/memory/${entryId}/timeline`)
      .then((d) => { if (traceIdRef.current === entryId) setTimeline({ entryId, events: d.events || [] }); })
      .catch((e) => { if (traceIdRef.current === entryId) setTimelineError(e); });
  };

  useEffect(() => { if (initialEntryId) trace(initialEntryId); return () => { traceIdRef.current = null; }; }, [initialEntryId]);

  if (lineage) {
    const d = lineage.data;
    return (
      <Panel
        title="Lineage"
        onClose={onClose}
        headerExtra={<button className="btn ghost small" onClick={() => { traceIdRef.current = null; setLineage(null); }}>← memory</button>}
      >
        <Legend />
        <RequestError error={lineageError} subject="Loading memory sources" onRetry={() => trace(lineage.entryId)} />
        <RequestError error={timelineError} subject="Loading memory history" onRetry={() => trace(lineage.entryId)} />
        {!d && !lineageError ? <div className="empty-hint">Loading memory sources…</div> : d ? (
          <div className="lineage">
            <h3>Entry</h3>
            <MemoryEntry key={d.entry.id} entry={d.entry} ripple={ripple} onOpenRun={onOpenRun} onTrace={trace} onCorrect={onCorrect} />

            {timeline && timeline.entryId === lineage.entryId && timeline.events.length > 0 ? (
              <>
                <h3>Lifecycle</h3>
                <div className="mem-timeline">
                  {timeline.events.map((ev) => (
                    <div key={ev.entryId} className={`mem-timeline-row tl-${ev.event}`}>
                      <span className={`chip tl-chip tl-${ev.event}`}>{ev.event}</span>
                      <span className="mono dim">{String(ev.at).slice(0, 10)}</span>
                      <span className="dim">{ev.byName}</span>
                      {ev.reason ? <span className="tl-reason">{ev.reason}</span> : null}
                      {ev.entryId !== lineage.entryId ? (
                        <button className="link-btn" onClick={() => trace(ev.entryId)}>view ↗</button>
                      ) : null}
                    </div>
                  ))}
                </div>
              </>
            ) : null}

            <h3>Upstream — what fed it ({d.upstream.length})</h3>
            {d.upstream.length === 0 ? <div className="empty-hint">nothing upstream — this is a root observation</div> : null}
            {[...d.upstream].sort((a, b) => a.depth - b.depth).map((e) => (
              <MemoryEntry key={e.id} entry={e} depth={e.depth} ripple={ripple} onOpenRun={onOpenRun} onTrace={trace} compact />
            ))}

            <h3>Downstream — what it fed ({d.downstream.length})</h3>
            {d.downstream.length === 0 ? <div className="empty-hint">nothing built on this yet</div> : null}
            {[...d.downstream].sort((a, b) => a.depth - b.depth).map((e) => (
              <MemoryEntry key={e.id} entry={e} depth={e.depth} ripple={ripple} onOpenRun={onOpenRun} onTrace={trace} compact />
            ))}

            <h3>Producing run</h3>
            {d.producingRun ? (
              <div className="lineage-run">
                <div>
                  <span className="dot-inline" style={{ background: agentsById[d.producingRun.agent_id]?.color || '#8a94a8' }} />
                  <b>{agentsById[d.producingRun.agent_id]?.name || d.producingRun.agent_id}</b>
                  <span className={`chip run-${d.producingRun.status === 'completed' ? 'completed' : 'halted'}`}>{d.producingRun.status}</span>
                  <button className="link-btn" onClick={() => onOpenRun(d.producingRun.id)}>open ↗</button>
                </div>
                <div className="lineage-run-instr">{short(d.producingRun.instruction, 180)}</div>
              </div>
            ) : <div className="empty-hint">written by a human, not a run</div>}

            {d.producingRun ? (
              <>
                <h3>Entries that run read ({d.runReads.length})</h3>
                {d.runReads.length === 0 ? <div className="empty-hint">the run read nothing from memory</div> : null}
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
        <label className="superseded-toggle" title="Include superseded history (struck-through)">
          <input type="checkbox" checked={showSuperseded} onChange={onToggleSuperseded} />
          history
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
          placeholder="filter entries…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <select aria-label="Memory kind" className="mem-kind-filter" value={kindFilter} onChange={(e) => setKindFilter(e.target.value)} title="Filter by kind">
          <option value="">all kinds</option>
          {['fact', 'decision', 'preference', 'constraint', 'outcome', 'feedback'].map((k) => (
            <option key={k} value={k}>{k}</option>
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
