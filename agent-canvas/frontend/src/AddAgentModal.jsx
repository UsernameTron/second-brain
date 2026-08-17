import React, { useState } from 'react';
import { api } from './api.js';
import { useDialog } from './useDialog.js';
import AgentBuilder from './AgentBuilder.jsx';

// Staff a canvas: instantiate a vetted roster template (the normal path) or
// hand-build a custom agent. Roster instantiation copies the template
// server-side and pins its companion note; the copy is editable per-canvas
// and only changes on an owner resync.
export default function AddAgentModal({ canvasId, roster, builderOn, isOwner, onClose, onAdded, toast }) {
  const dialogRef = useDialog(onClose);
  const [tab, setTab] = useState(builderOn ? 'builder' : (roster.length ? 'roster' : 'custom'));
  const [busy, setBusy] = useState(false);

  // custom form
  const [name, setName] = useState('');
  const [role, setRole] = useState('research');
  const [tier, setTier] = useState('strong');
  const [color, setColor] = useState('#2080D0');
  const [prompt, setPrompt] = useState('');

  const addFromRoster = async (entry) => {
    if (busy) return;
    setBusy(true);
    try {
      await api(`/api/canvases/${canvasId}/agents`, { method: 'POST', body: { roster_id: entry.id } });
      toast(`${entry.name} added to the canvas`, 'ok');
      onAdded();
    } catch (e) { toast(e.message); } finally { setBusy(false); }
  };

  const addCustom = async (e) => {
    e.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true);
    try {
      await api(`/api/canvases/${canvasId}/agents`, {
        method: 'POST',
        body: { name: name.trim(), role, model_tier: tier, color, system_prompt: prompt },
      });
      toast(`${name.trim()} added to the canvas`, 'ok');
      onAdded();
    } catch (e2) { toast(e2.message); } finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal add-agent-modal" role="dialog" aria-modal="true" aria-label="Add agent" ref={dialogRef} tabIndex={-1}>
        <header className="modal-head">
          <h2>Add agent</h2>
          <nav className="modal-tabs">
            {builderOn ? <button className={tab === 'builder' ? 'active' : ''} onClick={() => setTab('builder')}>Describe the job</button> : null}
            <button className={tab === 'roster' ? 'active' : ''} onClick={() => setTab('roster')}>From roster</button>
            <button className={tab === 'custom' ? 'active' : ''} onClick={() => setTab('custom')}>Advanced</button>
          </nav>
          <button className="icon-btn" onClick={onClose} title="Close" aria-label="Close">✕</button>
        </header>
        {tab === 'builder' ? (
          <div className="modal-body">
            <AgentBuilder canvasId={canvasId} isOwner={isOwner} onPublished={onAdded} toast={toast} />
          </div>
        ) : null}
        {tab === 'roster' ? (
          <div className="modal-body">
            {roster.length === 0 ? <p className="empty-hint">No roster entries are enabled. The owner manages the roster in Admin.</p> : null}
            <ul className="roster-pick-list">
              {roster.map((entry) => (
                <li key={entry.id}>
                  <button className="roster-pick" disabled={busy} onClick={() => addFromRoster(entry)}>
                    <span className="roster-dot big" style={{ background: entry.color }} />
                    <span className="roster-pick-name">{entry.name}</span>
                    <span className="chip">{entry.role === 'enrichment' ? 'lead information' : entry.role}</span>
                    <span className={`chip tier-${entry.model_tier}`}>{entry.model_tier}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {tab === 'custom' ? (
          <form className="modal-body add-agent-form" onSubmit={addCustom}>
            <div className="add-agent-row">
              <input required placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
              <input placeholder="role (e.g. research)" value={role} onChange={(e) => setRole(e.target.value)} />
              <select value={tier} onChange={(e) => setTier(e.target.value)}>
                <option value="strong">strong</option>
                <option value="fast">fast</option>
              </select>
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)} title="Agent color" />
            </div>
            <textarea rows="8" placeholder="System prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
            <div className="canvas-new-actions">
              <button type="button" className="btn ghost small" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn primary small" disabled={busy || !name.trim()}>Add agent</button>
            </div>
          </form>
        ) : null}
      </div>
    </div>
  );
}
