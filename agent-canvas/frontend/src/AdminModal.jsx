import React, { useCallback, useEffect, useState } from 'react';
import { api, timeAgo, short } from './api.js';

export default function AdminModal({ onClose, toast, selfEmail }) {
  const [tab, setTab] = useState('allowlist');

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal admin-modal">
        <header className="modal-head">
          <h2>Admin</h2>
          <nav className="modal-tabs">
            <button className={tab === 'allowlist' ? 'active' : ''} onClick={() => setTab('allowlist')}>Allowlist</button>
            <button className={tab === 'roster' ? 'active' : ''} onClick={() => setTab('roster')}>Roster</button>
            <button className={tab === 'audit' ? 'active' : ''} onClick={() => setTab('audit')}>Audit log</button>
          </nav>
          <button className="icon-btn" onClick={onClose} title="Close">✕</button>
        </header>
        {tab === 'allowlist' ? <AllowlistTab toast={toast} selfEmail={selfEmail} /> : null}
        {tab === 'roster' ? <RosterTab toast={toast} /> : null}
        {tab === 'audit' ? <AuditTab toast={toast} /> : null}
      </div>
    </div>
  );
}

function AllowlistTab({ toast, selfEmail }) {
  const [list, setList] = useState(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [name, setName] = useState('');

  const load = useCallback(() => {
    api('/api/allowlist')
      .then((d) => setList(d.allowlist || []))
      .catch((e) => { toast(e.message); setList([]); });
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const add = async (e) => {
    e.preventDefault();
    try {
      await api('/api/allowlist', { method: 'POST', body: { email: email.trim(), role, display_name: name.trim() || undefined } });
      setEmail(''); setName('');
      toast('Allowlist updated', 'ok');
      load();
    } catch (e2) { toast(e2.message); }
  };

  const remove = async (target) => {
    try {
      await api(`/api/allowlist/${encodeURIComponent(target)}`, { method: 'DELETE' });
      toast(`Removed ${target}`, 'ok');
      load();
    } catch (e2) { toast(e2.message); }
  };

  return (
    <div className="modal-body">
      <form className="allowlist-add" onSubmit={add}>
        <input type="email" required placeholder="email@domain" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input placeholder="display name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
        <select value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="member">member</option>
          <option value="owner">owner</option>
        </select>
        <button className="btn primary" type="submit" disabled={!email.trim()}>Add</button>
      </form>
      <div className="table-scroll">
        <table className="admin-table">
          <thead><tr><th>email</th><th>name</th><th>role</th><th>added by</th><th>added</th><th /></tr></thead>
          <tbody>
            {list === null ? <tr><td colSpan="6" className="empty-hint">loading…</td></tr> : null}
            {list && list.length === 0 ? <tr><td colSpan="6" className="empty-hint">allowlist is empty</td></tr> : null}
            {(list || []).map((row) => (
              <tr key={row.email}>
                <td className="mono">{row.email}</td>
                <td>{row.display_name || '—'}</td>
                <td><span className={`chip role-${row.role}`}>{row.role}</span></td>
                <td className="dim">{row.added_by || '—'}</td>
                <td className="dim">{timeAgo(row.added_at)}</td>
                <td>
                  {row.email.toLowerCase() !== String(selfEmail).toLowerCase() ? (
                    <button className="link-btn danger-link" onClick={() => remove(row.email)}>remove</button>
                  ) : <span className="dim">you</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}


function RosterTab({ toast }) {
  const [list, setList] = useState(null);
  const [editing, setEditing] = useState(null); // roster entry id being edited
  const [draft, setDraft] = useState({});
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    api('/api/roster')
      .then((d) => setList(d.roster || []))
      .catch((e) => { toast(e.message); setList([]); });
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const patch = async (id, body, okMsg) => {
    try {
      await api(`/api/roster/${id}`, { method: 'PATCH', body });
      if (okMsg) toast(okMsg, 'ok');
      load();
    } catch (e) { toast(e.message); }
  };

  const startEdit = (entry) => {
    setEditing(entry.id);
    setDraft({ name: entry.name, role: entry.role, color: entry.color, model_tier: entry.model_tier, system_prompt: entry.system_prompt });
  };

  const saveEdit = async () => {
    await patch(editing, draft, 'Roster entry updated — existing canvas agents change only on resync');
    setEditing(null);
  };

  const move = async (entry, dir) => {
    const idx = list.findIndex((r) => r.id === entry.id);
    const swap = list[idx + dir];
    if (!swap) return;
    await patch(entry.id, { sort: swap.sort });
    await patch(swap.id, { sort: entry.sort });
  };

  const add = async (e) => {
    e.preventDefault();
    try {
      await api('/api/roster', { method: 'POST', body: draft });
      toast('Roster entry added', 'ok');
      setAdding(false); setDraft({});
      load();
    } catch (e2) { toast(e2.message); }
  };

  return (
    <div className="modal-body">
      <div className="roster-admin-head">
        <span className="dim">Templates canvases are staffed from. Edits apply to future instantiations; existing agents change only on resync.</span>
        <button className="btn ghost small" onClick={() => { setAdding((v) => !v); setDraft({ name: '', role: 'research', color: '#2080D0', model_tier: 'strong', system_prompt: '' }); }}>
          {adding ? 'Cancel' : 'Add entry'}
        </button>
      </div>
      {adding ? (
        <form className="roster-edit" onSubmit={add}>
          <div className="add-agent-row">
            <input required placeholder="Name" value={draft.name || ''} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            <input placeholder="role" value={draft.role || ''} onChange={(e) => setDraft({ ...draft, role: e.target.value })} />
            <select value={draft.model_tier || 'strong'} onChange={(e) => setDraft({ ...draft, model_tier: e.target.value })}>
              <option value="strong">strong</option><option value="fast">fast</option>
            </select>
            <input type="color" value={draft.color || '#2080D0'} onChange={(e) => setDraft({ ...draft, color: e.target.value })} />
          </div>
          <textarea rows="6" placeholder="System prompt" value={draft.system_prompt || ''} onChange={(e) => setDraft({ ...draft, system_prompt: e.target.value })} />
          <button className="btn primary small" type="submit" disabled={!(draft.name || '').trim()}>Create</button>
        </form>
      ) : null}
      <div className="table-scroll">
        <table className="admin-table">
          <thead><tr><th /><th>name</th><th>role</th><th>tier</th><th>on new canvas</th><th>enabled</th><th>order</th><th /></tr></thead>
          <tbody>
            {list === null ? <tr><td colSpan="8" className="empty-hint">loading…</td></tr> : null}
            {(list || []).map((entry, i) => (
              <React.Fragment key={entry.id}>
                <tr className={entry.enabled ? '' : 'roster-disabled'}>
                  <td><span className="roster-dot" style={{ background: entry.color }} /></td>
                  <td><b>{entry.name}</b></td>
                  <td className="mono">{entry.role}</td>
                  <td><span className={`chip tier-${entry.model_tier}`}>{entry.model_tier}</span></td>
                  <td>
                    <input type="checkbox" checked={!!entry.default_on} title="Pre-checked in the new-canvas roster list"
                      onChange={() => patch(entry.id, { default_on: !entry.default_on })} />
                  </td>
                  <td>
                    <button className={`link-btn ${entry.enabled ? 'danger-link' : ''}`}
                      onClick={() => patch(entry.id, { enabled: !entry.enabled }, entry.enabled ? `${entry.name} disabled` : `${entry.name} enabled`)}>
                      {entry.enabled ? 'disable' : 'enable'}
                    </button>
                  </td>
                  <td className="mono nowrap">
                    <button className="link-btn" disabled={i === 0} onClick={() => move(entry, -1)}>↑</button>
                    <button className="link-btn" disabled={i === (list || []).length - 1} onClick={() => move(entry, 1)}>↓</button>
                  </td>
                  <td><button className="link-btn" onClick={() => (editing === entry.id ? setEditing(null) : startEdit(entry))}>{editing === entry.id ? 'close' : 'edit'}</button></td>
                </tr>
                {editing === entry.id ? (
                  <tr><td colSpan="8">
                    <div className="roster-edit">
                      <div className="add-agent-row">
                        <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                        <input value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })} />
                        <select value={draft.model_tier} onChange={(e) => setDraft({ ...draft, model_tier: e.target.value })}>
                          <option value="strong">strong</option><option value="fast">fast</option>
                        </select>
                        <input type="color" value={draft.color} onChange={(e) => setDraft({ ...draft, color: e.target.value })} />
                      </div>
                      <textarea rows="10" value={draft.system_prompt} onChange={(e) => setDraft({ ...draft, system_prompt: e.target.value })} />
                      <button className="btn primary small" onClick={saveEdit}>Save</button>
                    </div>
                  </td></tr>
                ) : null}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AuditTab({ toast }) {
  const [entries, setEntries] = useState(null);
  const [chain, setChain] = useState(null);
  const [action, setAction] = useState('');
  const [limit, setLimit] = useState(100);

  const load = useCallback(() => {
    const q = new URLSearchParams();
    if (action.trim()) q.set('action', action.trim());
    q.set('limit', String(limit));
    api(`/api/audit?${q}`)
      .then((d) => { setEntries(d.entries || []); setChain(d.chain || null); })
      .catch((e) => { toast(e.message); setEntries([]); });
  }, [action, limit, toast]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="modal-body">
      <div className="audit-controls">
        <input placeholder="filter by action prefix, e.g. memory." value={action} onChange={(e) => setAction(e.target.value)} />
        <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
          <option value="50">50</option>
          <option value="100">100</option>
          <option value="200">200</option>
          <option value="500">500</option>
        </select>
        <button className="btn ghost small" onClick={load}>Refresh</button>
        {chain ? (
          <span className={`chip chain-badge ${chain.ok ? 'chain-ok' : 'chain-broken'}`}
            title={chain.ok ? `${chain.entries} entries verified` : `broken at seq ${chain.brokenAt}: ${chain.reason}`}>
            {chain.ok ? '✓ chain verified' : '✕ CHAIN BROKEN'}
          </span>
        ) : null}
      </div>
      <div className="table-scroll audit-scroll">
        <table className="admin-table audit-table">
          <thead><tr><th>ts</th><th>actor</th><th>action</th><th>detail</th></tr></thead>
          <tbody>
            {entries === null ? <tr><td colSpan="4" className="empty-hint">loading…</td></tr> : null}
            {entries && entries.length === 0 ? <tr><td colSpan="4" className="empty-hint">no audit entries match</td></tr> : null}
            {(entries || []).map((e) => (
              <tr key={e.seq}>
                <td className="mono nowrap" title={e.ts}>{new Date(e.ts).toLocaleString()}</td>
                <td className="mono">{e.actor_type}:{short(e.actor_id, 24)}</td>
                <td className="mono">{e.action}</td>
                <td className="audit-detail mono" title={JSON.stringify(e.detail)}>
                  {short(JSON.stringify(e.detail), 90)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
