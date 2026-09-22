import React, { useEffect, useState } from 'react';
import { RequestError } from './RequestState.jsx';
import { api } from './api.js';
import { certaintyLabel, sourceLabel, choiceKeys, EpiDot } from './format.jsx';

// P1 Explain Map. Deterministic columns (question → agent → actions →
// evidence/entries → outputs), plain-language edge verbs, three lenses, and a
// "Read as steps" toggle that exposes the same data as an ordered list for
// keyboard/screen-reader use. No D3 — absolutely-positioned divs + one SVG.

const COL_X = 16;
const COL_W = 210;
const ROW_H = 224;
const NODE_W = 190;
const NODE_H = 200;
const TYPE_LABELS = { question: 'Question', agent: 'Agent', action: 'Action', entry: 'Memory', evidence: 'Source', output: 'Result', impact: 'Follow-up work', more: 'More records' };
const typeLabel = (type) => TYPE_LABELS[type] || `Record type: ${type}`;
const stepLabel = (text) => text.replace(/^Wrote to memory \((verified|inference|assumption)\):/, (_, value) => `Recorded memory — ${certaintyLabel(value)}:`);

const LENSES = [
  { key: 'flow', label: 'Flow', hint: 'what happened' },
  { key: 'evidence', label: 'Evidence', hint: 'why it is supportable' },
  { key: 'impact', label: 'Impact', hint: 'immediate downstream work' },
];

function nodeXY(n) {
  return { x: COL_X + (n.col || 0) * COL_W, y: 24 + n.row * ROW_H };
}

function edgePath(from, to) {
  const a = nodeXY(from); const b = nodeXY(to);
  const x1 = a.x + NODE_W; const y1 = a.y + NODE_H / 2;
  const x2 = b.x; const y2 = b.y + NODE_H / 2;
  const dx = Math.max(40, Math.abs(x2 - x1) * 0.45);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

export default function ExplainMap({ canvasId, runId, onSelectEntry, onSelectRun }) {
  const [lens, setLens] = useState('flow');
  const [asSteps, setAsSteps] = useState(false);
  const [map, setMap] = useState(null);
  const [error, setError] = useState(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let alive = true;
    setMap(null); setError(null);
    api(`/api/canvases/${canvasId}/runs/${runId}/explain-map?lens=${lens}`)
      .then((m) => {
        if (!m || !['nodes', 'edges', 'steps'].every((key) => Array.isArray(m[key])) || m.steps.some((step) => typeof step !== 'string')) throw new Error('The work map response was incomplete.');
        if (alive) setMap(m);
      })
      .catch((e) => { if (alive) setError(e); });
    return () => { alive = false; };
  }, [canvasId, runId, lens, retry]);

  const select = (n) => {
    if (n.meta && n.meta.entryId && onSelectEntry) onSelectEntry(n.meta.entryId);
    else if (n.meta && n.meta.runId && n.meta.runId !== runId && onSelectRun) onSelectRun(n.meta.runId);
    else if (n.meta && n.meta.uri) window.open(n.meta.uri, '_blank', 'noopener');
  };

  const byId = map ? Object.fromEntries(map.nodes.map((n) => [n.id, n])) : {};
  const height = map ? Math.max(...map.nodes.map((n) => nodeXY(n).y + NODE_H), 120) + 24 : 120;
  const width = COL_X + 5 * COL_W;

  return (
    <div className="explain-map">
      <div className="explain-controls">
        <div className="lens-switch" role="tablist" aria-label="Explain Map lens">
          {LENSES.map((l) => (
            <button key={l.key} role="tab" aria-selected={lens === l.key} tabIndex={lens === l.key ? 0 : -1}
              className={`btn ghost small ${lens === l.key ? 'lens-on' : ''}`}
              title={l.hint} onKeyDown={(event) => choiceKeys(event, LENSES.map((item) => item.key), l.key, setLens)} onClick={() => setLens(l.key)}>{l.label}</button>
          ))}
        </div>
        <button className="btn ghost small" aria-pressed={asSteps} onClick={() => setAsSteps(!asSteps)}>
          {asSteps ? 'Show map' : 'Read as steps'}
        </button>
      </div>

      <RequestError error={error} subject="Loading the work map" onRetry={() => setRetry((n) => n + 1)} />
      {!map && !error ? <div className="empty-hint">building the map…</div> : null}
      {map && !map.nodes.length && !map.steps.length ? <p>No work map details were returned. <button className="btn small" onClick={() => setRetry((n) => n + 1)}>Refresh map</button></p> : null}

      {map && asSteps ? (
        <ol className="explain-steps" aria-label="Run explained as ordered steps">
          {map.steps.map((s, i) => <li key={i}>{stepLabel(s)}</li>)}
        </ol>
      ) : null}

      {map && !asSteps ? (
        <div className="explain-canvas" style={{ height, width: '100%', overflowX: 'auto' }}>
          <div className="explain-world" style={{ position: 'relative', width, height }}>
            <svg className="edges-layer" width={width} height={height} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
              {map.edges.map((e, i) => {
                const from = byId[e.from]; const to = byId[e.to];
                if (!from || !to) return null;
                const d = edgePath(from, to);
                const mid = { x: (nodeXY(from).x + NODE_W + nodeXY(to).x) / 2, y: (nodeXY(from).y + nodeXY(to).y) / 2 + NODE_H / 2 };
                return (
                  <g key={i} className={`explain-edge verb-${e.verb}`}>
                    <path d={d} className="edge-line" fill="none" />
                    <text x={mid.x} y={mid.y - 6} className="edge-verb" textAnchor="middle">{e.verb}</text>
                  </g>
                );
              })}
            </svg>
            {map.nodes.map((n) => {
              const { x, y } = nodeXY(n);
              const epi = n.meta && n.meta.epistemic ? ` epi-${n.meta.epistemic}` : '';
              const certainty = n.meta?.epistemic ? certaintyLabel(n.meta.epistemic) : null;
              return (
                <button key={n.id}
                  className={`explain-node en-${n.type}${epi}${n.redacted ? ' en-redacted' : ''}`}
                  style={{ position: 'absolute', left: x, top: y, width: NODE_W, minHeight: NODE_H }}
                  onClick={() => select(n)}
                  aria-label={`${typeLabel(n.type)}: ${n.label}${certainty ? ` · ${certainty}` : ''}${n.meta?.tainted ? ' · Uses corrected information' : ''}${n.meta?.superseded ? ' · Earlier version' : ''}`}>
                  <span className="en-type">{typeLabel(n.type)}{n.meta && n.meta.sourceKind ? ` · ${sourceLabel(n.meta.sourceKind)}` : ''}</span>
                  <span className="en-label">{n.label}</span>
                  {certainty ? <span className="en-certainty"><EpiDot epistemic={n.meta.epistemic} />{certainty}</span> : null}
                  {n.meta && n.meta.tainted ? <span className="tainted-flag" title="Uses corrected information">⚠</span> : null}
                  {n.meta && n.meta.superseded ? <span className="chip">Earlier version</span> : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
