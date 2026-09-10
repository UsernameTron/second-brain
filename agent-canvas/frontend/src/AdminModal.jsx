import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, downloadFile, timeAgo, short } from './api.js';
import { useDraft } from './Drafts.jsx';
import { RequestError, useResource } from './RequestState.jsx';
import { choiceKeys } from './format.jsx';
import { useDialog } from './useDialog.js';

function useOwnerChange(resource) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const lock = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const run = async (operation) => {
    if (lock.current || error?.unconfirmed) return false;
    lock.current = true; setBusy(true); setError(null);
    try { await operation(); await resource.refresh(); return alive.current; }
    catch (e) { if (alive.current) setError(e); return false; }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  };
  const check = async () => { const result = await resource.refresh(); if (result !== undefined) setError(null); };
  return { busy, error, run, check, blocked: busy || error?.unconfirmed || resource.loading || !!resource.error };
}
function OwnerState({ resource, change, subject }) {
  return <><RequestError error={resource.error} subject={`Loading ${subject}`} onRetry={resource.refresh} />
    {resource.loading ? <p role="status">Loading {subject}…</p> : null}
    {resource.error && resource.data ? <p>Last known {subject} are shown. Check status before editing.</p> : null}
    {change ? <RequestError error={change.error} subject={`Saving ${subject}`} onRetry={change.check} retryLabel="Check saved status" /> : null}</>;
}
function ownerList(path, field) { return api(path).then((data) => { if (!Array.isArray(data[field])) throw new Error(`The server did not return the ${field} list.`); return data; }); }

export default function AdminModal({ onClose, toast, selfEmail }) {
  const dialogRef = useDialog(onClose);
  const [tab, setTab] = useState('allowlist');
  const [exportError, setExportError] = useState(null);
  const [exportBusy, setExportBusy] = useState(false);
  const exportLedger = async () => { if (exportBusy) return; setExportBusy(true); setExportError(null); try { await downloadFile('/api/export', 'agent-canvas-ledger.json'); } catch (e) { setExportError(e); } finally { setExportBusy(false); } };

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal admin-modal" role="dialog" aria-modal="true" aria-label="Owner settings" ref={dialogRef} tabIndex={-1}>
        <header className="modal-head">
          <h2>Owner settings</h2>
          <nav className="modal-tabs" role="tablist" aria-label="Owner settings sections" onKeyDown={(e) => choiceKeys(e, ['allowlist', 'roster', 'connectors', 'audit'], tab, setTab)}>
            <button role="tab" aria-selected={tab === 'allowlist'} className={tab === 'allowlist' ? 'active' : ''} onClick={() => setTab('allowlist')}>People and access</button>
            <button role="tab" aria-selected={tab === 'roster'} className={tab === 'roster' ? 'active' : ''} onClick={() => setTab('roster')}>Agent templates</button>
            <button role="tab" aria-selected={tab === 'connectors'} className={tab === 'connectors' ? 'active' : ''} onClick={() => setTab('connectors')}>Connections</button>
            <button role="tab" aria-selected={tab === 'audit'} className={tab === 'audit' ? 'active' : ''} onClick={() => setTab('audit')}>Audit history</button>
          </nav>
          <button className="icon-btn" onClick={onClose} title="Close" aria-label="Close">✕</button>
        </header>
        <div className="modal-body"><button className="btn small" disabled={exportBusy} onClick={exportLedger}>Download operational ledger</button><p>This export is an operational ledger, not a complete restorable backup.</p><RequestError error={exportError} subject="Downloading the operational ledger" onRetry={exportLedger} /></div>
        {tab === 'allowlist' ? <AllowlistTab toast={toast} selfEmail={selfEmail} /> : null}
        {tab === 'roster' ? <RosterTab toast={toast} /> : null}
        {tab === 'connectors' ? <ConnectorsTab toast={toast} /> : null}
        {tab === 'audit' ? <AuditTab toast={toast} /> : null}
      </div>
    </div>
  );
}

function AllowlistTab({ toast, selfEmail }) {
  const resource = useResource(() => ownerList('/api/allowlist', 'allowlist'), 'allowlist');
  const list = resource.data?.allowlist;
  const change = useOwnerChange(resource);
  const [email, setEmail] = useDraft('owner:add-email', '');
  const [role, setRole] = useDraft('owner:add-role', 'member');
  const [name, setName] = useDraft('owner:add-name', '');
  const add = async (e) => {
    e.preventDefault();
    if (await change.run(() => api('/api/allowlist', { method: 'POST', body: { email: email.trim(), role, display_name: name.trim() || undefined } }))) {
      setEmail(''); setName(''); toast('People and access updated', 'ok');
    }
  };
  const remove = (target) => change.run(() => api(`/api/allowlist/${encodeURIComponent(target)}`, { method: 'DELETE' }));

  return (
    <div className="modal-body"><OwnerState resource={resource} change={change} subject="people and access" />
      <fieldset className="owner-controls" disabled={change.blocked}> 
      <form className="allowlist-add" onSubmit={add}>
        <input aria-label="Email address" type="email" required placeholder="email@domain" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input aria-label="Display name" placeholder="display name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
        <select aria-label="Workspace role" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="member">member</option>
          <option value="owner">owner</option>
        </select>
        <button className="btn primary" type="submit" disabled={!email.trim()}>Add</button>
      </form>
      <div className="table-scroll">
        <table className="admin-table">
          <thead><tr><th>email</th><th>name</th><th>role</th><th>added by</th><th>added</th><th /></tr></thead>
          <tbody>
            {resource.loading ? <tr><td colSpan="6" className="empty-hint">loading…</td></tr> : null}
            {list && list.length === 0 && !resource.error ? <tr><td colSpan="6" className="empty-hint">allowlist is empty</td></tr> : null}
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
      </fieldset>
    </div>
  );
}


function RosterTab({ toast }) {
  const resource = useResource(() => ownerList('/api/roster', 'roster'), 'roster');
  const list = resource.data?.roster;
  const change = useOwnerChange(resource);
  const [editing, setEditing] = useDraft('owner:roster-editing', null);
  const [adding, setAdding] = useDraft('owner:roster-adding', false);
  const [drafts, setDrafts] = useDraft('owner:roster-drafts', {});
  const draftKey = adding ? 'new' : editing;
  const draft = drafts[draftKey] || {};
  const setDraft = (value) => setDrafts((cur) => ({ ...cur, [draftKey]: value }));
  const [pendingOrder, setPendingOrder] = useDraft('owner:pending-order', null);
  const patch = (id, body, okMsg) => change.run(async () => {
    await api(`/api/roster/${id}`, { method: 'PATCH', body }); if (okMsg) toast(okMsg, 'ok');
  });
  const startEdit = (entry) => { setEditing(entry.id); setAdding(false); setDrafts((cur) => ({ ...cur, [entry.id]: cur[entry.id] || { name: entry.name, role: entry.role, color: entry.color, model_tier: entry.model_tier, system_prompt: entry.system_prompt } })); };
  const saveEdit = async () => { if (await patch(editing, draft, 'Template saved; existing agents keep their current configuration.')) setEditing(null); };
  const move = async (entry, dir) => {
    const swap = list[list.findIndex((r) => r.id === entry.id) + dir];
    if (!swap || pendingOrder) return;
    await change.run(async () => {
      await api(`/api/roster/${entry.id}`, { method: 'PATCH', body: { sort: swap.sort } });
      const remaining = { id: swap.id, sort: entry.sort }; setPendingOrder(remaining);
      try { await api(`/api/roster/${swap.id}`, { method: 'PATCH', body: { sort: entry.sort } }); setPendingOrder(null); }
      catch (e) { await resource.refresh(); throw Object.assign(e, { partial: true }); }
    });
  };
  const finishOrder = async () => { if (await patch(pendingOrder.id, { sort: pendingOrder.sort })) setPendingOrder(null); };
  const add = async (e) => { e.preventDefault(); if (await change.run(() => api('/api/roster', { method: 'POST', body: draft }))) { setAdding(false); setDraft({}); toast('Agent template added', 'ok'); } };

  return (
    <div className="modal-body"><OwnerState resource={resource} change={change} subject="agent templates" />
      <fieldset className="owner-controls" disabled={change.blocked}> 
      <div className="roster-admin-head">
        {pendingOrder ? <p role="alert">Ordering is partly saved. Check saved status, then finish the remaining move. <button className="btn small" onClick={finishOrder}>Finish ordering</button></p> : null}
        <span className="dim">Templates canvases are staffed from. Edits apply to future instantiations; existing agents change only on resync.</span>
        <button className="btn ghost small" onClick={() => { setAdding((v) => !v); setDrafts((cur) => ({ ...cur, new: cur.new || { name: '', role: 'research', color: '#2080D0', model_tier: 'strong', system_prompt: '' } })); }}>
          {adding ? 'Cancel' : 'Add entry'}
        </button>
      </div>
      {adding ? (
        <form className="roster-edit" onSubmit={add}>
          <div className="add-agent-row">
            <input aria-label="Agent name" required placeholder="Name" value={draft.name || ''} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            <input aria-label="Agent role" placeholder="role" value={draft.role || ''} onChange={(e) => setDraft({ ...draft, role: e.target.value })} />
            <select aria-label="Model strength" value={draft.model_tier || 'strong'} onChange={(e) => setDraft({ ...draft, model_tier: e.target.value })}>
              <option value="strong">Complex work (strong)</option><option value="fast">Quick work (fast)</option>
            </select>
            <input aria-label="Agent color" type="color" value={draft.color || '#2080D0'} onChange={(e) => setDraft({ ...draft, color: e.target.value })} />
          </div>
          <textarea aria-label="Operating instructions (system prompt)" rows="6" placeholder="System prompt" value={draft.system_prompt || ''} onChange={(e) => setDraft({ ...draft, system_prompt: e.target.value })} />
          <button className="btn primary small" type="submit" disabled={!(draft.name || '').trim()}>Create</button>
        </form>
      ) : null}
      <div className="table-scroll">
        <table className="admin-table">
          <thead><tr><th /><th>name</th><th>role</th><th>tier</th><th>on new canvas</th><th>enabled</th><th>order</th><th /></tr></thead>
          <tbody>
            {resource.loading ? <tr><td colSpan="8" className="empty-hint">loading…</td></tr> : null}
            {list && list.length === 0 && !resource.error ? <tr><td colSpan="8">No agent templates yet. Add an entry to create one.</td></tr> : null}
            {(list || []).map((entry, i) => (
              <React.Fragment key={entry.id}>
                <tr className={entry.enabled ? '' : 'roster-disabled'}>
                  <td><span className="roster-dot" style={{ background: entry.color }} /></td>
                  <td><b>{entry.name}</b></td>
                  <td className="mono">{entry.role}</td>
                  <td><span className={`chip tier-${entry.model_tier}`}>{{ strong: 'Complex work (strong)', fast: 'Quick work (fast)' }[entry.model_tier] || entry.model_tier}</span></td>
                  <td>
                    <input type="checkbox" aria-label={`Include ${entry.name} on new spaces`} checked={!!entry.default_on} title="Pre-checked in the new-canvas roster list"
                      onChange={() => patch(entry.id, { default_on: !entry.default_on })} />
                  </td>
                  <td>
                    <button className={`link-btn ${entry.enabled ? 'danger-link' : ''}`}
                      onClick={() => patch(entry.id, { enabled: !entry.enabled }, entry.enabled ? `${entry.name} disabled` : `${entry.name} enabled`)}>
                      {entry.enabled ? 'disable' : 'enable'}
                    </button>
                  </td>
                  <td className="mono nowrap">
                    <button className="link-btn" disabled={!!pendingOrder || i === 0} aria-label={`Move ${entry.name} up`} onClick={() => move(entry, -1)}>↑</button>
                    <button className="link-btn" disabled={!!pendingOrder || i === (list || []).length - 1} aria-label={`Move ${entry.name} down`} onClick={() => move(entry, 1)}>↓</button>
                  </td>
                  <td><button className="link-btn" onClick={() => (editing === entry.id ? setEditing(null) : startEdit(entry))}>{editing === entry.id ? 'close' : 'edit'}</button></td>
                </tr>
                {editing === entry.id ? (
                  <tr><td colSpan="8">
                    <div className="roster-edit">
                      <div className="add-agent-row">
                        <input aria-label="Agent name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                        <input aria-label="Agent role" value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })} />
                        <select aria-label="Model strength" value={draft.model_tier} onChange={(e) => setDraft({ ...draft, model_tier: e.target.value })}>
                          <option value="strong">Complex work (strong)</option><option value="fast">Quick work (fast)</option>
                        </select>
                        <input aria-label="Agent color" type="color" value={draft.color} onChange={(e) => setDraft({ ...draft, color: e.target.value })} />
                      </div>
                      <textarea aria-label="Operating instructions (system prompt)" rows="10" value={draft.system_prompt} onChange={(e) => setDraft({ ...draft, system_prompt: e.target.value })} />
                      <button className="btn primary small" onClick={saveEdit}>Save</button>
                    </div>
                  </td></tr>
                ) : null}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
      </fieldset>
    </div>
  );
}


function ConnectorsTab({ toast }) {
  const resource = useResource(() => ownerList('/api/mcp/servers', 'servers'), 'connections');
  const list = resource.data?.servers;
  const configError = resource.data?.configError;
  const refused = resource.data?.refusedTools || [];
  const change = useOwnerChange(resource);
  const [open, setOpen] = useState(null);
  const [probes, setProbes] = useState({});
  const [adding, setAdding] = useDraft('owner:connector-adding', false);
  const [draft, setDraft] = useDraft('owner:connector-draft', {});
  const [headersError, setHeadersError] = useState(null);
  const patch = (id, body, okMsg) => change.run(async () => {
    await api(`/api/mcp/servers/${id}`, { method: 'PATCH', body }); if (okMsg) toast(okMsg, 'ok');
  });
  const probe = (srv) => change.run(async () => {
    setProbes((p) => ({ ...p, [srv.id]: null })); setOpen(srv.id);
    try { const d = await api(`/api/mcp/servers/${srv.id}/probe`, { method: 'POST' }); setProbes((p) => ({ ...p, [srv.id]: d })); }
    catch (e) { setProbes((p) => ({ ...p, [srv.id]: { error: e.message } })); throw e; }
  });
  const toggleTool = (srv, toolName) => patch(srv.id, { enabledTools: srv.enabledTools.includes(toolName) ? srv.enabledTools.filter((t) => t !== toolName) : [...srv.enabledTools, toolName] });
  const add = async (e) => {
    e.preventDefault(); setHeadersError(null);
    let headers;
    try { headers = draft.headers ? JSON.parse(draft.headers) : {}; if (!headers || Array.isArray(headers) || typeof headers !== 'object') throw new Error(); }
    catch { setHeadersError('Enter headers as a JSON object, or leave the field empty.'); return; }
    if (await change.run(() => api('/api/mcp/servers', { method: 'POST', body: { name: draft.name, url: draft.url, access: draft.access || 'members', headers } }))) {
      toast('Connection added. Check it to discover available tools.', 'ok'); setAdding(false); setDraft({});
    }
  };

  return (
    <div className="modal-body"><OwnerState resource={resource} change={change} subject="connections" />
      <fieldset className="owner-controls" disabled={change.blocked}> 
      <div className="roster-admin-head">
        <span className="dim">External MCP tool servers. A connector is inert until you probe it and enable tools. "owner" access hides it from members' runs entirely; roles limit which agents are offered its tools (blank = all). Header values may be {'${ENV:NAME}'} references.</span>
        <button className="btn ghost small" onClick={() => { setAdding((v) => !v); setDraft({ access: 'members' }); }}>{adding ? 'Cancel' : 'Add connector'}</button>
      </div>
      {configError ? <p role="alert">Connection configuration could not be read. Ask the owner to correct it, then reload. Details: {configError}</p> : null}
      {headersError ? <p role="alert">{headersError}</p> : null}
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
            <input aria-label="Connection name" required placeholder="name (a-z0-9_-)" value={draft.name || ''} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            <input aria-label="Connection URL" required placeholder="https://…/mcp" value={draft.url || ''} onChange={(e) => setDraft({ ...draft, url: e.target.value })} />
            <select aria-label="Connection access" value={draft.access} onChange={(e) => setDraft({ ...draft, access: e.target.value })}>
              <option value="members">members</option><option value="owner">owner only</option>
            </select>
          </div>
          <textarea aria-label="Connection headers (JSON)" rows="3" placeholder={'headers JSON, e.g. {"x-api-key": "${ENV:MY_KEY}"}'} value={draft.headers || ''} onChange={(e) => setDraft({ ...draft, headers: e.target.value })} />
          <button className="btn primary small" type="submit" disabled={!(draft.name || '').trim() || !(draft.url || '').trim()}>Create</button>
        </form>
      ) : null}
      <div className="table-scroll">
        <table className="admin-table">
          <thead><tr><th>name</th><th>access</th><th>agent roles</th><th>tools on</th><th>enabled</th><th /><th /></tr></thead>
          <tbody>
            {resource.loading ? <tr><td colSpan="7" className="empty-hint">loading…</td></tr> : null}
            {list && list.length === 0 && !resource.error ? <tr><td colSpan="7" className="empty-hint">no connectors configured</td></tr> : null}
            {(list || []).map((srv) => (
              <React.Fragment key={srv.id}>
                <tr className={srv.enabled ? '' : 'roster-disabled'}>
                  <td><b>{srv.name}</b><div className="dim mono connector-url">{srv.url}</div></td>
                  <td>
                    <select aria-label={`Access to ${srv.name}`} value={srv.access} onChange={(e) => patch(srv.id, { access: e.target.value }, `${srv.name} → ${e.target.value}`)}>
                      <option value="members">members</option><option value="owner">owner only</option>
                    </select>
                  </td>
                  <td>
                    <input aria-label={`Current roles for ${srv.name}`} className="roles-input" placeholder="all roles" value={(srv.roles || []).join(', ')} readOnly
                      onFocus={(e) => e.target.select()} title="Edit via expand" />
                  </td>
                  <td className="mono">{srv.enabledTools.length}</td>
                  <td>
                    <button className={`link-btn ${srv.enabled ? 'danger-link' : ''}`}
                      onClick={() => patch(srv.id, { enabled: !srv.enabled }, srv.enabled ? `${srv.name} disabled` : `${srv.name} enabled`)}>
                      {srv.enabled ? 'disable' : 'enable'}
                    </button>
                  </td>
                  <td><button className="btn ghost small" disabled={change.busy} onClick={() => probe(srv)}>Check connection</button></td>
                  <td><button className="link-btn" onClick={() => setOpen(open === srv.id ? null : srv.id)}>{open === srv.id ? 'close' : 'edit'}</button></td>
                </tr>
                {open === srv.id ? (
                  <tr><td colSpan="7">
                    <div className="roster-edit">
                      <label className="dim">Agent roles offered this connector (comma-separated, blank = all):</label>
                      <input aria-label={`Agent roles for ${srv.name}`} defaultValue={(srv.roles || []).join(', ')}
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
      </fieldset>
    </div>
  );
}

function AuditTab({ toast }) {
  const [action, setAction] = useState('');
  const [limit, setLimit] = useState(100);
  const query = new URLSearchParams({ ...(action.trim() ? { action: action.trim() } : {}), limit: String(limit) });
  const resource = useResource(() => ownerList(`/api/audit?${query}`, 'entries'), query.toString());
  const entries = resource.data?.entries;
  const chain = !resource.error && !resource.loading ? resource.data?.chain : null;
  const load = resource.refresh;

  return (
    <div className="modal-body"><OwnerState resource={resource} subject="audit history" />
      {resource.error || resource.loading ? <p>Audit verification is unavailable until this check succeeds.</p> : null}
      <div className="audit-controls">
        <input aria-label="Filter audit action" placeholder="filter by action prefix, e.g. memory." value={action} onChange={(e) => setAction(e.target.value)} />
        <select aria-label="Audit result limit" value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
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
            {resource.loading ? <tr><td colSpan="4" className="empty-hint">loading…</td></tr> : null}
            {entries && entries.length === 0 && !resource.error ? <tr><td colSpan="4" className="empty-hint">no audit entries match</td></tr> : null}
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
