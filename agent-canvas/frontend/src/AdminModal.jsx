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
            <button className={tab === 'audit' ? 'active' : ''} onClick={() => setTab('audit')}>Audit log</button>
          </nav>
          <button className="icon-btn" onClick={onClose} title="Close">✕</button>
        </header>
        {tab === 'allowlist'
          ? <AllowlistTab toast={toast} selfEmail={selfEmail} />
          : <AuditTab toast={toast} />}
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
