import React, { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { RequestError, useResource } from './RequestState.jsx';
import { useDialog } from './useDialog.js';
import ServiceCheck from './ServiceCheck.jsx';

const EVERYDAY_SERVICES = new Set(['gmail', 'drive', 'sheets', 'calendar', 'websearch', 'hubspot', 'enrichment', 'standing_rules']);
const surfaceName = (name) => ({ 'Drive & Docs': 'Google Drive and Docs', Sheets: 'Google Sheets', Calendar: 'Google Calendar', 'Everything else': 'Other limits', 'MCP connectors': 'Additional connector tools (MCP)' })[name] || name;

async function capabilities() {
  const data = await api('/api/capabilities');
  if (!data || typeof data.connected !== 'boolean' || typeof data.oauthReady !== 'boolean' || !Array.isArray(data.surfaces)
    || data.surfaces.some((s) => !s || typeof s.surface !== 'string' || !Array.isArray(s.can) || !Array.isArray(s.cannot)
      || [...s.can, ...s.cannot].some((item) => !item || typeof item.label !== 'string' || typeof item.detail !== 'string'))) {
    throw new Error('The connection response was incomplete.');
  }
  return data;
}
async function services() {
  const data = await api('/api/health/integrations');
  if (!Array.isArray(data?.integrations) || data.integrations.some((item) => !item || typeof item.id !== 'string' || !item.id
    || !['ready', 'down', 'attention', 'planned'].includes(item.status))
    || new Set(data.integrations.map((item) => item.id)).size !== data.integrations.length) throw new Error('The service response was incomplete.');
  return data;
}

function CapabilitySurface({ surface }) {
  return <details className="caps-surface">
    <summary>{surfaceName(surface.surface)}</summary>
    {[[surface.can, 'Available functions'], [surface.cannot, 'Not available']].map(([items, label]) => items.length ? <section key={label}>
      <h4>{label}</h4>
      <ul className="caps-functions">{items.map((item) => <li key={item.label}><strong>{item.label}</strong><p>{item.detail}</p></li>)}</ul>
    </section> : null)}
  </details>;
}

export default function CapabilitiesModal({ onClose, diagnostics, connectionNotice }) {
  const dialogRef = useDialog(onClose);
  const capsState = useResource(capabilities, 'capabilities');
  const healthState = useResource(services, 'health');
  const caps = capsState.data, health = healthState.data;
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [probing, setProbing] = useState({});
  const pending = useRef(new Set());
  const connectionBusy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const load = () => Promise.all([capsState.refresh(), healthState.refresh()]);

  const probe = async (surface) => {
    if (pending.current.has(surface)) return;
    pending.current.add(surface);
    setProbing((value) => ({ ...value, [surface]: { pending: true } }));
    let result, failure;
    try {
      result = await api('/api/health/probe', { method: 'POST', body: { surface } });
      if (typeof result?.ok !== 'boolean') throw Object.assign(new Error('The check returned no result. Check status before trying again.'), { unconfirmed: true });
      if (!result.ok) throw new Error(result.error || 'The service did not pass its check.');
    } catch (e) { failure = e; }
    finally {
      if (mounted.current) {
        await load();
        if (mounted.current) setProbing((value) => ({ ...value, [surface]: { pending: false, result, error: failure } }));
      }
      pending.current.delete(surface);
    }
  };

  const changeConnection = async (connect) => {
    if (connectionBusy.current) return;
    connectionBusy.current = true; setError(null); setBusy(true);
    try {
      if (connect) {
        const data = await api('/api/google/connect', { method: 'POST' });
        const destination = typeof data?.url === 'string' ? new URL(data.url) : null;
        if (!destination || destination.protocol !== 'https:' || destination.hostname !== 'accounts.google.com') throw new Error('A valid Google sign-in link was not returned.');
        if (mounted.current) window.location.href = destination.href;
      } else {
        await api('/api/google/disconnect', { method: 'POST' });
        if (mounted.current) await load();
      }
    } catch (e) { if (mounted.current) setError(e); }
    finally { connectionBusy.current = false; if (mounted.current) setBusy(false); }
  };
  const rows = health?.integrations || [];
  const model = rows.find((item) => item.id === 'model') || { id: 'model' };
  const everyday = rows.filter((item) => EVERYDAY_SERVICES.has(item.id));
  const diagnosticsUnavailable = healthState.error || healthState.loading || Object.values(probing).some((attempt) => attempt.pending || attempt.error);
  const check = (item, technical = false) => <ServiceCheck key={item.id} item={item} technical={technical}
    loading={healthState.loading} unavailable={!!healthState.error} attempt={probing[item.id]} onProbe={probe} onRefresh={load} />;

  return <div className="modal-overlay" onClick={onClose}>
    <div className="modal caps-modal" role="dialog" aria-modal="true" aria-label="Connections" onClick={(event) => event.stopPropagation()} ref={dialogRef} tabIndex={-1}>
      <div className="modal-head"><h2>Connections</h2><button className="icon-btn" onClick={onClose} title="Close" aria-label="Close">✕</button></div>
      <div className="modal-body">
        <p className="connections-intro">Check what is available before asking an agent to use it.</p>
        {connectionNotice ? <div className="request-error" role="alert"><p>{connectionNotice.message}</p>
          <details><summary>Technical setup details</summary><p>{connectionNotice.details}</p></details>
        </div> : null}
        <RequestError error={capsState.error} subject="Loading your connections" onRetry={capsState.refresh} />
        <RequestError error={healthState.error} subject="Checking system status" onRetry={healthState.refresh} />
        <RequestError error={error} subject="Updating the connection" onRetry={async () => { const results = await load(); if (results.every(Boolean)) setError(null); }} retryLabel="Check status" />
        <button className="btn small connections-refresh" disabled={capsState.loading || healthState.loading} onClick={load}>Refresh status</button>
        {capsState.loading || healthState.loading ? <p role="status">Checking connections and services…</p> : null}
        {healthState.error && health ? <p>Last known details below. Current status is unavailable.</p> : null}
        <div className="connection-overview">
          {check(model)}
          <section className="caps-connect" aria-label="Google Workspace account">
            <h3>Google Workspace</h3>
            {!caps || capsState.error || capsState.loading ? <p>Google connection status is not confirmed. Refresh status or try loading again.</p> : caps.connected ? <>
              <strong>{busy ? 'Updating account access…' : error ? 'Google connection status is not confirmed' : 'Workspace account connected'}</strong>
              <p>{busy || error ? 'Check status before relying on this connection.' : 'Account access is granted. Use More service checks to confirm each service is working.'}</p>
              <button className="btn small" disabled={busy} onClick={() => changeConnection(false)}>{busy ? 'Updating…' : 'Disconnect'}</button>
            </> : caps.oauthReady ? <>
              <strong>{error ? 'Google connection status is not confirmed' : 'Workspace not connected'}</strong><p>Connect your Google account to use its documents, spreadsheets and calendar. Agents use your permissions.</p>
              <button className="btn primary" disabled={busy} onClick={() => changeConnection(true)}>{busy ? 'Opening Google…' : 'Connect Google Workspace'}</button>
            </> : <><strong>Google Workspace is not set up here</strong><p>Ask the owner to set up Google access. You can still use other available sources.</p></>}
          </section>
        </div>
        {!healthState.loading && !healthState.error && !rows.length ? <p className="empty-hint">No service checks were returned. Choose Refresh status to try again.</p> : null}
        {everyday.length ? <details className="other-service-checks"><summary>More service checks ({everyday.length})</summary>{everyday.map((item) => check(item))}</details> : null}
        <p className="connection-safeguards">Email stays draft-only. Customer record changes (CRM) still require a preview and your approval. Pause and spending limits continue to apply.</p>
        <h3 className="capabilities-title">Functions and limits</h3>
        <p>These describe supported functions when the matching service is available. They are not proof that an account is connected or that a service has passed its check.</p>
        {capsState.error && caps ? <p>Last-known function details are shown below. Refresh connections to confirm the current list.</p> : null}
        {(caps?.surfaces || []).filter((surface) => surface.surface !== 'MCP connectors').map((surface) => <CapabilitySurface key={surface.surface} surface={surface} />)}
        {!capsState.loading && !capsState.error && !caps?.surfaces.length ? <p className="empty-hint">No function details were returned. Choose Refresh status to try again.</p> : null}
        <details className="connection-details"><summary>Advanced details</summary>
          <p>Account permissions: {caps?.identityModel || 'Unavailable'}</p>
          <div className="sys-board"><h3>All service checks</h3>{rows.map((item) => check(item, true))}</div>
          {(caps?.surfaces || []).filter((surface) => surface.surface === 'MCP connectors').map((surface) => <CapabilitySurface key={surface.surface} surface={surface} />)}
          {!diagnosticsUnavailable ? (typeof diagnostics === 'function' ? diagnostics({ health }) : diagnostics) : <p>System details are unavailable until the status check succeeds. Use the recovery actions above.</p>}
        </details>
        <p className="caps-foot">Each workspace action records who directed it, which agent performed it and what it touched in the audit history.</p>
      </div>
    </div>
  </div>;
}
