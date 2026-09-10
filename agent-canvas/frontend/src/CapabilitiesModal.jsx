import React, { useEffect, useState } from 'react';
import { api } from './api.js';
import { RequestError, useResource } from './RequestState.jsx';
import { useDialog } from './useDialog.js';

// The capability matrix — what agents can and cannot do, rendered from the
// same object the server enforces. This is the expectation-setting surface:
// nobody should learn a limit by hitting it.

const ICONS = { mail: '✉', folder: '🗀', grid: '▦', calendar: '🗓', shield: '⛨' };

export default function CapabilitiesModal({ onClose, toast }) {
  const dialogRef = useDialog(onClose);
  const capsState = useResource(() => api('/api/capabilities'), 'capabilities');
  const healthState = useResource(() => api('/api/health/integrations'), 'health');
  const caps = capsState.data;
  const health = healthState.data;
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [probing, setProbing] = useState({});

  const load = () => Promise.all([capsState.refresh(), healthState.refresh()]);

  const probe = async (surface) => {
    if (probing[surface] === 'Checking…') return;
    setError(null);
    setProbing((p0) => ({ ...p0, [surface]: 'Checking…' }));
    try {
      const r = await api('/api/health/probe', { method: 'POST', body: { surface } });
      setProbing((p0) => ({ ...p0, [surface]: `${r.ms}ms` }));
    } catch (e) {
      setProbing((p0) => ({ ...p0, [surface]: 'FAIL' }));
      setError(e);
    } finally { await healthState.refresh(); }
  };

  const connect = async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const d = await api('/api/google/connect', { method: 'POST' });
      window.location.href = d.url;
    } catch (e) { setError(e); setBusy(false); }
  };
  const disconnect = async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try { await api('/api/google/disconnect', { method: 'POST' }); await load(); }
    catch (e) { setError(e); }
    setBusy(false);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal caps-modal" role="dialog" aria-modal="true" aria-label="Connections" onClick={(e) => e.stopPropagation()} ref={dialogRef} tabIndex={-1}>
        <div className="modal-head">
          <h2>Connections</h2>
          <span className="caps-identity dim">
            {caps?.identityModel || ''}
          </span>
          <button className="icon-btn" onClick={onClose} title="Close" aria-label="Close">✕</button>
        </div>
        <div className="modal-body">
          <RequestError error={capsState.error} subject="Loading your connections" onRetry={capsState.refresh} />
          <RequestError error={healthState.error} subject="Checking system status" onRetry={healthState.refresh} />
          <RequestError error={error} subject="Updating the connection" onRetry={async () => { await load(); setError(null); }} retryLabel="Check status" />
          {capsState.loading || healthState.loading ? <p role="status">Checking connections and services…</p> : null}
          {healthState.error && health ? <p>Last known details below. Current status is unavailable.</p> : null}
          <div className="sys-board">
            <div className="sys-title">Systems status</div>
            {(health?.integrations || []).map((i) => (
              <div className="sys-row" key={i.id} title={i.detail}>
                <span className="sys-label">{i.label}</span>
                <span className="sys-arrow">▶</span>
                <span className={`lamp lamp-${healthState.error || healthState.loading || probing[i.id] === 'Checking…' ? 'planned' : i.status}`} />
                <span className="sys-detail dim">{i.detail}</span>
                {i.probe ? (
                  <button className="btn small sys-probe" disabled={probing[i.id] === 'Checking…'} onClick={() => probe(i.id)}>
                    {probing[i.id] || 'Check now'}
                  </button>
                ) : null}
              </div>
            ))}
          </div>
          <div className="caps-connect">
            {!caps || capsState.error || capsState.loading ? <p>Google connection status is not confirmed. Use Check status or try loading again.</p> : caps.connected ? (
              <>
                <span className="chip">Workspace account connected</span>
                <span className="dim">Account access is granted. Check each service above to confirm it is working; the limits below always apply.</span>
                <button className="btn small" disabled={busy} onClick={disconnect}>Disconnect</button>
              </>
            ) : caps?.oauthReady ? (
              <>
                <span className="chip caps-off">○ Workspace not connected</span>
                <span className="dim">Connect your Google account so agents you direct can read and draft on your behalf.</span>
                <button className="btn primary" disabled={busy} onClick={connect}>Connect Google Workspace</button>
              </>
            ) : (
              <>
                <span className="chip caps-off">○ Not configured</span>
                <span className="dim">Google Workspace is not set up here. Ask the owner to connect it. Other available data sources are listed above.</span>
              </>
            )}
          </div>

          {(caps?.surfaces || []).map((sf) => (
            <div className="caps-surface" key={sf.surface}>
              <h3>{ICONS[sf.icon] || '•'} {sf.surface}</h3>
              <div className="caps-grid">
                {sf.can.map((c) => (
                  <div className="caps-row" key={c.label} title={c.detail}>
                    <span className="caps-mark can">✓</span>
                    <span className="caps-label">{c.label}</span>
                    <span className="caps-detail dim">{c.detail}</span>
                  </div>
                ))}
                {sf.cannot.map((c) => (
                  <div className="caps-row" key={c.label} title={c.detail}>
                    <span className="caps-mark cannot">✕</span>
                    <span className="caps-label">{c.label}</span>
                    <span className="caps-detail dim">{c.detail}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}

          <p className="caps-foot dim">
            Every workspace action is written to the tamper-evident audit log with who directed it,
            which agent performed it, and what it touched. The "cannot" column is not policy — those
            operations do not exist in the system to be called.
          </p>
        </div>
      </div>
    </div>
  );
}
