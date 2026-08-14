import React, { useRef } from 'react';
import { fmtUSD, fmtBytes, short } from './api.js';

export const NODE_SIZES = {
  agent: { w: 232, h: 122 },
  note: { w: 222, h: 120 },
  task: { w: 210, h: 100 },
  file: { w: 200, h: 72 },
};

// Shared draggable shell: distinguishes click from drag (4px threshold),
// converts pointer deltas to world coordinates via the current zoom.
function NodeShell({ kind, id, x, y, z, className = '', style, selColor, mine, onMoveLive, onMoveEnd, onClick, children }) {
  const dragRef = useRef(null);

  const down = (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('a, button, input, textarea, select')) return;
    e.stopPropagation();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ }
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: x, oy: y, lx: x, ly: y, moved: false };
  };
  const move = (e) => {
    const d = dragRef.current;
    if (!d) return;
    e.stopPropagation();
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 4) d.moved = true;
    if (d.moved) {
      d.lx = d.ox + (e.clientX - d.sx) / z;
      d.ly = d.oy + (e.clientY - d.sy) / z;
      onMoveLive(kind, id, d.lx, d.ly);
    }
  };
  const up = (e) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    e.stopPropagation();
    if (d.moved) onMoveEnd(kind, id, Math.round(d.lx), Math.round(d.ly));
    else if (onClick) onClick(e);
  };

  return (
    <div
      className={`node ${className} ${mine ? 'sel-mine' : ''}`}
      style={{
        left: x,
        top: y,
        width: NODE_SIZES[kind].w,
        ...(selColor ? { outline: `2px solid ${selColor}`, outlineOffset: '2px' } : {}),
        ...style,
      }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
    >
      {children}
    </div>
  );
}

export function AgentNode({ agent, spend, amber, paused, ...shell }) {
  return (
    <NodeShell
      kind="agent"
      id={agent.id}
      x={agent.x}
      y={agent.y}
      className={`agent-node st-${agent.status} ${amber ? 'amber-glow' : ''} ${paused ? 'frozen' : ''}`}
      style={{ '--c': agent.color }}
      {...shell}
    >
      <div className="agent-head">
        <span className="agent-orb" />
        <span className="agent-name">{agent.name}</span>
        <span className="chip role-chip">{agent.role}</span>
      </div>
      <div className="agent-sub">
        <span className={`chip tier-chip tier-${agent.model_tier}`}>{agent.model_tier}</span>
        <span className={`agent-status as-${agent.status}`}>{agent.status}</span>
      </div>
      <div className="agent-spend mono">
        {spend
          ? `${fmtUSD(spend.cost_usd)} · ${spend.runs} run${Number(spend.runs) === 1 ? '' : 's'}`
          : '$0.00 · 0 runs'}
      </div>
    </NodeShell>
  );
}

export function NoteNode({ note, ...shell }) {
  return (
    <NodeShell
      kind="note"
      id={note.id}
      x={note.x}
      y={note.y}
      className={`note-node ${note.pinned ? 'pinned' : ''}`}
      {...shell}
    >
      {note.pinned ? <div className="live-tag">LIVE CONTEXT</div> : null}
      <div className="node-title">{note.title}</div>
      <div className="node-body">{short(note.content, 130) || '(empty note)'}</div>
    </NodeShell>
  );
}

export function TaskNode({ task, ...shell }) {
  return (
    <NodeShell
      kind="task"
      id={task.id}
      x={task.x}
      y={task.y}
      className="task-node"
      {...shell}
    >
      <div className="node-title">
        <span className="task-mark">◇</span> {task.title}
      </div>
      <div className="node-body">{short(task.description, 90)}</div>
      <span className={`chip task-st tk-${task.status}`}>{task.status.replace('_', ' ')}</span>
    </NodeShell>
  );
}

export function FileNode({ file, canvasId, ...shell }) {
  return (
    <NodeShell
      kind="file"
      id={file.id}
      x={file.x}
      y={file.y}
      className="file-node"
      {...shell}
    >
      <div className="node-title"><span className="file-mark">▤</span> {short(file.name, 26)}</div>
      <div className="file-meta mono">
        {fmtBytes(file.size)}
        <a href={`/api/canvases/${encodeURIComponent(canvasId)}/files/${encodeURIComponent(file.id)}`} download={file.name} title={`Download ${file.name}`}>
          ↓ download
        </a>
      </div>
    </NodeShell>
  );
}
