import React, { useCallback, useEffect, useState } from 'react';
import { api, timeAgo, short } from './api.js';
import { useDialog } from './useDialog.js';

export default function AdminModal({ onClose, toast, selfEmail }) {
  const dialogRef = useDialog(onClose);
  const [tab, setTab] = useState('allowlist');

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal admin-modal" role="dialog" aria-modal="true" aria-label="Admin" ref={dialogRef} tabIndex={-1}>
        <header className="modal-head">
          <h2>Admin</h2>
          <nav className="modal-tabs">
            <button className={tab === 'allowlist' ? 'active' : ''} onClick={() => setTab('allowlist')}>Allowlist</button>
            <button className={tab === 'roster' ? 'active' : ''} onClick={() => setTab('roster')}>Roster</button>
            <button className={tab === 'connectors' ? 'active' : ''} onClick={() => setTab('connectors')}>Connectors</button>
            <button className={tab === 'audit' ? 'active' : ''} onClick={() => setTab('audit')}>Audit log</button>
          </nav>
          <button className="icon-btn" onClick={onClose} title="Close" aria-label="Close">✕</button>
        </header>
        {tab === 'allowlist' ? <AllowlistTab toast={toast} selfEmail={selfEmail} /> : null}
        {tab === 'roster' ? <RosterTab toast={toast} /> : null}
        {tab === 'connectors' ? <ConnectorsTab toast={toast} /> : null}
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


function ConnectorsTab({ toast }) {
  const [list, setList] = useState(null);
  const [configError, setConfigError] = useState(null);
  const [refused, setRefused] = useState([]);
  const [open, setOpen] = useState(null);      // server id with expanded row
  const [probes, setProbes] = useState({});    // server id -> { ok, ms, tools } | { error }
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({});

  const load = useCallback(() => {
    api('/api/mcp/servers')
      .then((d) => { setList(d.servers || []); setConfigError(d.configError || null); setRefused(d.refusedTools || []); })
      .catch((e) => { toast(e.message); setList([]); });
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const patch = async (id, body, okMsg) => {
    try {
      await api(`/api/mcp/servers/${id}`, { method: 'PATCH', body });
      if (okMsg) toast(okMsg, 'ok');
      load();
    } catch (e) { toast(e.message); }
  };

  const probe = async (srv) => {
    setBusy(true);
    try {
      const d = await api(`/api/mcp/servers/${srv.id}/probe`, { method: 'POST' });
      setProbes((p) => ({ ...p, [srv.id]: d }));
      setOpen(srv.id);
      toast(`${srv.name}: ${d.tools.length} tools in ${d.ms}ms`, 'ok');
    } catch (e) {
      setProbes((p) => ({ ...p, [srv.id]: { error: e.message } }));
      toast(e.message);
    } finally { setBusy(false); }
  };

  const toggleTool = (srv, toolName) => {
    const next = srv.enabledTools.includes(toolName)
      ? srv.enabledTools.filter((t) => t !== toolName)
      : [...srv.enabledTools, toolName];
    patch(srv.id, { enabledTools: next });
  };

  const add = async (e) => {
    e.preventDefault();
    try {
      let headers = {};
      try { headers = draft.headers ? JSON.parse(draft.headers) : {}; } catch { toast('headers must be JSON, e.g. {"x-api-key":"${ENV:MY_KEY}"}'); return; }
      await api('/api/mcp/servers', { method: 'POST', body: { name: draft.name, url: draft.url, access: draft.access || 'members', headers } });
      toast('Connector added — probe it to discover tools', 'ok');
      setAdding(false); setDraft({});
      load();
    } catch (e2) { toast(e2.message); }
  };

  return (
    <div className="modal-body">
      <div className="roster-admin-head">
        <span className="dim">External MCP tool servers. A connector is inert until you probe it and enable tools. "owner" access hides it from members' runs entirely; roles limit which agents are offered its tools (blank = all). Header values may be {'${ENV:NAME}'} references.</span>
        <button className="btn ghost small" onClick={() => { setAdding((v) => !v); setDraft({ access: 'members' }); }}>{adding ? 'Cancel' : 'Add connector'}</button>
      </div>
      {configError ? <p className="empty-hint">Config error: {configError}</p> : null}
      {refused.length ? (
        <p className="empty-hint">
          {refused.map((r) => `${r.server}: ${r.tools.join(', ')}`).join(' · ')} — refused as write tools.
          Connectors are read lanes; CRM writes go through the ops-runner preview/apply lane. Every other
          tool on these connectors is unaffected.
        </p>
      ) : null}
      {adding ? (
        <form className="roster-edit" onSubmit={add}>
          <div className="add-agent-row">
            <input required placeholder="name (a-z0-9_-)" value={draft.name || ''} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            <input required placeholder="https://…/mcp" value={draft.url || ''} onChange={(e) => setDraft({ ...draft, url: e.target.value })} />
            <select value={draft.access} onChange={(e) => setDraft({ ...draft, access: e.target.value })}>
              <option value="members">members</option><option value="owner">owner only</option>
            </select>
          </div>
          <textarea rows="3" placeholder={'headers JSON, e.g. {"x-api-key": "${ENV:MY_KEY}"}'} value={draft.headers || ''} onChange={(e) => setDraft({ ...draft, headers: e.target.value })} />
          <button className="btn primary small" type="submit" disabled={!(draft.name || '').trim() || !(draft.url || '').trim()}>Create</button>
        </form>
      ) : null}
      <div className="table-scroll">
        <table className="admin-table">
          <thead><tr><th>name</th><th>access</th><th>agent roles</th><th>tools on</th><th>enabled</th><th /><th /></tr></thead>
          <tbody>
            {list === null ? <tr><td colSpan="7" className="empty-hint">loading…</td></tr> : null}
            {list && list.length === 0 ? <tr><td colSpan="7" className="empty-hint">no connectors configured</td></tr> : null}
            {(list || []).map((srv) => (
              <React.Fragment key={srv.id}>
                <tr className={srv.enabled ? '' : 'roster-disabled'}>
                  <td><b>{srv.name}</b><div className="dim mono connector-url">{srv.url}</div></td>
                  <td>
                    <select value={srv.access} onChange={(e) => patch(srv.id, { access: e.target.value }, `${srv.name} → ${e.target.value}`)}>
                      <option value="members">members</option><option value="owner">owner only</option>
                    </select>
                  </td>
                  <td>
                    <input className="roles-input" placeholder="all roles" value={(srv.roles || []).join(', ')} readOnly
                      onFocus={(e) => e.target.select()} title="Edit via expand" />
                  </td>
                  <td className="mono">{srv.enabledTools.length}</td>
                  <td>
                    <button className={`link-btn ${srv.enabled ? 'danger-link' : ''}`}
                      onClick={() => patch(srv.id, { enabled: !srv.enabled }, srv.enabled ? `${srv.name} disabled` : `${srv.name} enabled`)}>
                      {srv.enabled ? 'disable' : 'enable'}
                    </button>
                  </td>
                  <td><button className="btn ghost small" disabled={busy} onClick={() => probe(srv)}>Probe</button></td>
                  <td><button className="link-btn" onClick={() => setOpen(open === srv.id ? null : srv.id)}>{open === srv.id ? 'close' : 'edit'}</button></td>
                </tr>
                {open === srv.id ? (
                  <tr><td colSpan="7">
                    <div className="roster-edit">
                      <label className="dim">Agent roles offered this connector (comma-separated, blank = all):</label>
                      <input defaultValue={(srv.roles || []).join(', ')}
                        onBlur={(e) => {
                          const roles = e.target.value.split(',').map((r) => r.trim()).filter(Boolean);
                          if (roles.join(',') !== (srv.roles || []).join(',')) patch(srv.id, { roles });
                        }} />
                      <label className="dim">Headers (values masked; {'${ENV:NAME}'} references shown as-is):</label>
                      <div className="mono connector-headers">{Object.entries(srv.headers || {}).map(([k, v]) => `${k}: ${v}`).join('\n') || '(none)'}</div>
                      {probes[srv.id]?.tools ? (
                        <>
                          <label className="dim">Discovered tools — tick to enable for agents:</label>
                          <ul className="connector-tools">
                            {probes[srv.id].tools.map((t) => (
                              <li key={t.name}>
                                <label className="roster-check">
                                  <input type="checkbox" checked={srv.enabledTools.includes(t.name)} onChange={() => toggleTool(srv, t.name)} />
                                  <span className="mono">{t.name}</span>
                                  <span className="dim">{t.description}</span>
                                </label>
                              </li>
                            ))}
                          </ul>
                        </>
                      ) : probes[srv.id]?.error ? (
                        <p className="empty-hint">Probe failed: {probes[srv.id].error}</p>
                      ) : (
                        <p className="dim">Probe to discover this server's tools. Currently enabled: {srv.enabledTools.join(', ') || 'none'}.</p>
                      )}
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
