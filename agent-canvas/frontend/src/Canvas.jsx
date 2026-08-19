import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AgentNode, NoteNode, TaskNode, FileNode, PersonNode, NODE_SIZES } from './Nodes.jsx';
import { short, timeAgo } from './api.js';

const MIN_Z = 0.15;
const MAX_Z = 2.5;
const CLUSTER_Z = 0.5;
const EDGE_TTL_MS = 10 * 60 * 1000;

export default function Canvas({
  agents, notes, tasks, files, people, canvasId, handoffs, memoryMap, agentsById,
  cursors, selections, mySelection, spendByAgent, amberAgents, paused,
  hoverHandoffId, onOpen, onMoveLive, onMoveEnd, onCursor, onSelect,
  fitSignal, onArrange,
}) {
  const rootRef = useRef(null);
  const [view, setView] = useState({ x: 80, y: 60, z: 0.9 });
  const [size, setSize] = useState({ w: 1200, h: 800 });
  const [tip, setTip] = useState(null); // { handoff, x, y } — screen coords
  const [tick, setTick] = useState(0);
  const panRef = useRef(null);
  const fittedRef = useRef(false);
  const cursorLastRef = useRef(0);
  const viewRef = useRef(view);
  viewRef.current = view;

  // refit when switching canvas
  useEffect(() => { fittedRef.current = false; }, [canvasId]);

  // measure container
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return undefined;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // wheel zoom toward cursor (non-passive so we can preventDefault)
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      setView((v) => {
        const z2 = Math.min(MAX_Z, Math.max(MIN_Z, v.z * Math.exp(-e.deltaY * 0.0016)));
        if (z2 === v.z) return v;
        return { x: mx - (mx - v.x) * (z2 / v.z), y: my - (my - v.y) * (z2 / v.z), z: z2 };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // clock for edge age fading
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  // fit all content in view (used on first load, on demand, and after Tidy)
  const fitNow = useCallback(() => {
    const pts = [...agents, ...notes, ...tasks, ...files, ...people];
    if (!pts.length || !size.w || !size.h) return false;
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const minX = Math.min(...xs) - 90;
    const maxX = Math.max(...xs) + 330;
    const minY = Math.min(...ys) - 120;
    const maxY = Math.max(...ys) + 260;
    const z = Math.min(1.05, Math.max(MIN_Z, Math.min(size.w / (maxX - minX), size.h / (maxY - minY)) * 0.94));
    setView({
      x: size.w / 2 - ((minX + maxX) / 2) * z,
      y: size.h / 2 - ((minY + maxY) / 2) * z,
      z,
    });
    return true;
  }, [agents, notes, tasks, files, people, size]);

  // auto-fit content once per canvas
  useEffect(() => {
    if (fittedRef.current) return;
    if (fitNow()) fittedRef.current = true;
  }, [fitNow]);

  // refit exactly once per external signal (after Tidy re-lays nodes out)
  const lastFitSignal = useRef(0);
  useEffect(() => {
    if (fitSignal && fitSignal !== lastFitSignal.current) {
      lastFitSignal.current = fitSignal;
      fitNow();
    }
  }, [fitSignal, fitNow]);

  const toWorld = useCallback((clientX, clientY) => {
    const rect = rootRef.current.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (clientX - rect.left - v.x) / v.z, y: (clientY - rect.top - v.y) / v.z };
  }, []);

  // ---------- background pan + cursor broadcast ----------
  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('.node, .minimap, .edge-tip, .cluster-chip')) return;
    panRef.current = { sx: e.clientX, sy: e.clientY, ox: viewRef.current.x, oy: viewRef.current.y, moved: false };
    try { rootRef.current.setPointerCapture(e.pointerId); } catch { /* noop */ }
  };
  const onPointerMove = (e) => {
    const now = Date.now();
    if (now - cursorLastRef.current > 66) { // ~15/s
      cursorLastRef.current = now;
      const w = toWorld(e.clientX, e.clientY);
      onCursor(Math.round(w.x), Math.round(w.y));
    }
    const p = panRef.current;
    if (p) {
      const dx = e.clientX - p.sx;
      const dy = e.clientY - p.sy;
      if (Math.abs(dx) + Math.abs(dy) > 3) p.moved = true;
      setView((v) => ({ ...v, x: p.ox + dx, y: p.oy + dy }));
    }
  };
  const onPointerUp = () => {
    if (panRef.current && !panRef.current.moved) onSelect(null);
    panRef.current = null;
  };

  // ---------- selections: nodeId -> color ----------
  const selColors = useMemo(() => {
    const m = {};
    for (const sel of Object.values(selections)) {
      for (const id of sel.ids || []) if (!m[id]) m[id] = sel.color;
    }
    return m;
  }, [selections]);

  // ---------- handoff edges ----------
  const edges = useMemo(() => {
    const now = Date.now();
    const list = [];
    for (const h of handoffs) {
      const from = agentsById[h.from_agent_id];
      const to = agentsById[h.to_agent_id];
      if (!from || !to) continue;
      const age = now - (Date.parse(h.ts) || now);
      const pinned = hoverHandoffId === h.id;
      if (age > EDGE_TTL_MS && !pinned) continue;
      list.push({ h, from, to, age, pinned });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handoffs, agentsById, hoverHandoffId, tick]);

  const edgePath = (from, to) => {
    const { w: AW, h: AH } = NODE_SIZES.agent;
    let x1; let x2; let dir;
    if (to.x >= from.x + AW / 2) { x1 = from.x + AW; x2 = to.x; dir = 1; } else { x1 = from.x; x2 = to.x + AW; dir = -1; }
    const y1 = from.y + AH / 2;
    const y2 = to.y + AH / 2;
    const dx = Math.max(70, Math.abs(x2 - x1) * 0.45);
    return `M ${x1} ${y1} C ${x1 + dir * dx} ${y1}, ${x2 - dir * dx} ${y2}, ${x2} ${y2}`;
  };

  // ---------- role clustering below CLUSTER_Z ----------
  const clustered = view.z < CLUSTER_Z;
  const clusters = useMemo(() => {
    if (!clustered) return [];
    const byRole = {};
    for (const a of agents) {
      (byRole[a.role] = byRole[a.role] || []).push(a);
    }
    return Object.entries(byRole).map(([role, list]) => ({
      role,
      list,
      color: list[0].color,
      x: list.reduce((s, a) => s + a.x, 0) / list.length + NODE_SIZES.agent.w / 2,
      y: list.reduce((s, a) => s + a.y, 0) / list.length + NODE_SIZES.agent.h / 2,
    }));
  }, [agents, clustered]);

  const jumpTo = useCallback((wx, wy, z = viewRef.current.z) => {
    setView({ x: size.w / 2 - wx * z, y: size.h / 2 - wy * z, z });
  }, [size]);

  const tipEntries = tip
    ? (tip.handoff.entry_ids || []).map((id) => memoryMap.get(id) || { id, missing: true })
    : [];

  return (
    <div
      ref={rootRef}
      className="canvas-root"
      style={{
        backgroundSize: `${28 * view.z}px ${28 * view.z}px`,
        backgroundPosition: `${view.x}px ${view.y}px`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <div className="world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}>
        <svg className="edges-layer" width="1" height="1">
          {edges.map(({ h, from, to, age, pinned }) => {
            const d = edgePath(from, to);
            const hovered = pinned || (tip && tip.handoff.id === h.id);
            const opacity = hovered ? 1 : Math.max(0.25, 1 - (age / EDGE_TTL_MS) * 0.75);
            return (
              <g key={h.id} className={`edge ${hovered ? 'edge-hovered' : ''}`} style={{ opacity }}>
                <path className="edge-glow" d={d} stroke={from.color} />
                <path className="edge-line" d={d} stroke={from.color} />
                <path
                  className="edge-hit"
                  d={d}
                  strokeWidth={Math.max(14, 18 / view.z)}
                  onMouseEnter={(e) => setTip({ handoff: h, x: e.clientX, y: e.clientY })}
                  onMouseMove={(e) => setTip({ handoff: h, x: e.clientX, y: e.clientY })}
                  onMouseLeave={() => setTip(null)}
                />
              </g>
            );
          })}
        </svg>

        {!clustered && agents.map((a) => (
          <AgentNode
            key={a.id}
            agent={a}
            spend={spendByAgent[a.id]}
            amber={amberAgents.has(a.id)}
            paused={paused}
            z={view.z}
            selColor={selColors[a.id]}
            mine={mySelection === a.id}
            onMoveLive={onMoveLive}
            onMoveEnd={onMoveEnd}
            onClick={() => { onSelect(a.id); onOpen('agent', a); }}
          />
        ))}
        {clustered && clusters.map((c) => (
          <div
            key={c.role}
            className="cluster-chip"
            style={{ left: c.x, top: c.y, '--c': c.color, transform: `translate(-50%, -50%) scale(${1 / view.z})` }}
            onClick={() => jumpTo(c.x, c.y, 0.85)}
            title={`${c.list.map((a) => `${a.name} (${a.status})`).join(', ')} — click to zoom in`}
          >
            <span className="cluster-role">{c.role}</span>
            <span className="cluster-count mono">×{c.list.length}</span>
            <span className="cluster-dots">
              {c.list.slice(0, 8).map((a) => (
                <span key={a.id} className={`cluster-dot ${a.status === 'running' ? 'on' : ''} ${a.status === 'error' ? 'err' : ''}`} />
              ))}
              {c.list.length > 8 ? <span className="mono">+{c.list.length - 8}</span> : null}
            </span>
          </div>
        ))}

        {notes.map((n) => (
          <NoteNode
            key={n.id}
            note={n}
            z={view.z}
            selColor={selColors[n.id]}
            mine={mySelection === n.id}
            onMoveLive={onMoveLive}
            onMoveEnd={onMoveEnd}
            onClick={() => { onSelect(n.id); onOpen('note', n); }}
          />
        ))}
        {tasks.map((t) => (
          <TaskNode
            key={t.id}
            task={t}
            z={view.z}
            selColor={selColors[t.id]}
            mine={mySelection === t.id}
            onMoveLive={onMoveLive}
            onMoveEnd={onMoveEnd}
            onClick={() => { onSelect(t.id); onOpen('task', t); }}
          />
        ))}
        {people.map((p) => (
          <PersonNode
            key={p.id}
            person={p}
            z={view.z}
            selColor={selColors[p.id]}
            mine={mySelection === p.id}
            onMoveLive={onMoveLive}
            onMoveEnd={onMoveEnd}
            onClick={() => onSelect(p.id)}
          />
        ))}
        {files.map((f) => (
          <FileNode
            key={f.id}
            file={f}
            canvasId={canvasId}
            z={view.z}
            selColor={selColors[f.id]}
            mine={mySelection === f.id}
            onMoveLive={onMoveLive}
            onMoveEnd={onMoveEnd}
            onClick={() => { onSelect(f.id); onOpen('file', f); }}
          />
        ))}

        {Object.entries(cursors).map(([email, c]) => (
          <div key={email} className="peer-cursor" style={{ left: c.x, top: c.y, transform: `scale(${1 / view.z})` }}>
            <svg width="15" height="17" viewBox="0 0 15 17">
              <path d="M1 1 L14 8.4 L8 9.8 L5.6 16 Z" fill={c.color} stroke="#ffffff" strokeWidth="1" />
            </svg>
            <span className="peer-name" style={{ background: c.color }}>{c.name}</span>
          </div>
        ))}
      </div>

      <Minimap
        agents={agents}
        notes={notes}
        tasks={tasks}
        files={files}
        people={people}
        view={view}
        size={size}
        onJump={(wx, wy) => jumpTo(wx, wy)}
      />

      <div className="canvas-controls">
        <button className="btn small" onClick={onArrange} title="Line the canvas up: tasks on top, agents in role columns (research → coding → review), notes and files below. Positions are presentation only — handoffs never depend on them.">Tidy up</button>
        <button className="btn small" onClick={fitNow} title="Fit everything in view">Fit</button>
      </div>
      <div className="zoom-readout mono">{Math.round(view.z * 100)}%</div>

      {tip ? (
        <div
          className="edge-tip"
          style={{
            left: Math.min(tip.x + 14, size.w - 340),
            top: Math.min(tip.y + 12, Math.max(60, size.h - 60 - 40 * (tipEntries.length + 2))),
          }}
        >
          <div className="edge-tip-head">
            <b>{agentsById[tip.handoff.from_agent_id]?.name || '?'}</b>
            <span className="edge-tip-arrow">⇄</span>
            <b>{agentsById[tip.handoff.to_agent_id]?.name || '?'}</b>
            <span className="chip">{tip.handoff.item_key || 'handoff'}</span>
            <span className="edge-tip-time mono">{timeAgo(tip.handoff.ts)}</span>
          </div>
          {tip.handoff.message ? <div className="edge-tip-msg">{short(tip.handoff.message, 160)}</div> : null}
          <div className="edge-tip-entries">
            <div className="edge-tip-label">memory passed ({tipEntries.length})</div>
            {tipEntries.length === 0 ? <div className="edge-tip-empty">no memory entries attached</div> : null}
            {tipEntries.slice(0, 6).map((e) => (
              <div key={e.id} className={`edge-tip-entry ${e.missing ? '' : `epi-${e.epistemic}`}`}>
                {e.missing
                  ? <span className="mono">entry {String(e.id).slice(0, 8)}… (not in current memory view)</span>
                  : (
                    <>
                      <span className={`epi-dot ${e.epistemic === 'verified' ? 'filled' : e.epistemic === 'inference' ? 'half' : 'hollow'}`} />
                      <span>{short(e.content, 110)}</span>
                    </>
                  )}
              </div>
            ))}
            {tipEntries.length > 6 ? <div className="edge-tip-empty">+{tipEntries.length - 6} more</div> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Minimap({ agents, notes, tasks, files, people, view, size, onJump }) {
  const MW = 200;
  const MH = 140;
  const all = [
    ...agents.map((a) => ({ ...a, kind: 'agent' })),
    ...notes.map((n) => ({ ...n, kind: 'note' })),
    ...tasks.map((t) => ({ ...t, kind: 'task' })),
    ...files.map((f) => ({ ...f, kind: 'file' })),
    ...people.map((p) => ({ ...p, kind: 'person' })),
  ];
  if (!all.length) {
    return <div className="minimap"><svg width={MW} height={MH} /></div>;
  }
  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y);
  const pad = 220;
  const minX = Math.min(...xs) - pad;
  const maxX = Math.max(...xs) + NODE_SIZES.agent.w + pad;
  const minY = Math.min(...ys) - pad;
  const maxY = Math.max(...ys) + NODE_SIZES.agent.h + pad;
  const scale = Math.min(MW / (maxX - minX), MH / (maxY - minY));
  const ox = (MW - (maxX - minX) * scale) / 2;
  const oy = (MH - (maxY - minY) * scale) / 2;
  const mx = (wx) => (wx - minX) * scale + ox;
  const my = (wy) => (wy - minY) * scale + oy;
  // current viewport in world coords
  const vx = -view.x / view.z;
  const vy = -view.y / view.z;
  const vw = size.w / view.z;
  const vh = size.h / view.z;

  const click = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    onJump((px - ox) / scale + minX, (py - oy) / scale + minY);
  };

  return (
    <div className="minimap" title="Minimap — click to jump">
      <svg width={MW} height={MH} onClick={click}>
        {all.map((n) => (n.kind === 'agent' ? (
          <g key={n.id}>
            <circle cx={mx(n.x + NODE_SIZES.agent.w / 2)} cy={my(n.y + NODE_SIZES.agent.h / 2)} r="4.5" fill={n.color} opacity="0.9" />
            <circle
              cx={mx(n.x + NODE_SIZES.agent.w / 2) + 5}
              cy={my(n.y + NODE_SIZES.agent.h / 2) - 5}
              r="2"
              fill={n.status === 'running' ? 'var(--green)' : 'var(--amber)'}
              opacity={n.status === 'running' ? 1 : 0.55}
            />
          </g>
        ) : (
          <rect key={n.id} x={mx(n.x) - 1.5} y={my(n.y) - 1.5} width="3" height="3" fill="rgba(232,232,242,0.4)" />
        )))}
        <rect
          x={mx(vx)}
          y={my(vy)}
          width={Math.max(6, vw * scale)}
          height={Math.max(6, vh * scale)}
          className="minimap-viewport"
        />
      </svg>
    </div>
  );
}
