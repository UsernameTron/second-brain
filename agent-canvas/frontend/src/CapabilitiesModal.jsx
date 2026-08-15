import React, { useEffect, useState } from 'react';
import { api } from './api.js';
import { useDialog } from './useDialog.js';

// The capability matrix — what agents can and cannot do, rendered from the
// same object the server enforces. This is the expectation-setting surface:
// nobody should learn a limit by hitting it.

const ICONS = { mail: '✉', folder: '🗀', grid: '▦', calendar: '🗓', shield: '⛨' };

export default function CapabilitiesModal({ onClose, toast }) {
  const dialogRef = useDialog(onClose);
  const [caps, setCaps] = useState(null);
  const [health, setHealth] = useState(null);
  const [busy, setBusy] = useState(false);
  const [probing, setProbing] = useState({});

  const load = () => Promise.all([
    api('/api/capabilities').then(setCaps),
    api('/api/health/integrations').then(setHealth),
  ]).catch((e) => toast(e.message));

  const probe = async (surface) => {
    setProbing((p0) => ({ ...p0, [surface]: '…' }));
    try {
      const r = await api('/api/health/probe', { method: 'POST', body: { surface } });
      setProbing((p0) => ({ ...p0, [surface]: `${r.ms}ms` }));
    } catch (e) {
      setProbing((p0) => ({ ...p0, [surface]: 'FAIL' }));
      toast(e.message);
    }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const connect = async () => {
    setBusy(true);
    try {
      const d = await api('/api/google/connect', { method: 'POST' });
      window.location.href = d.url;
    } catch (e) { toast(e.message); setBusy(false); }
  };
  const disconnect = async () => {
    setBusy(true);
    try { await api('/api/google/disconnect', { method: 'POST' }); await load(); }
    catch (e) { toast(e.message); }
    setBusy(false);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal caps-modal" role="dialog" aria-modal="true" aria-label="Capabilities and systems" onClick={(e) => e.stopPropagation()} ref={dialogRef} tabIndex={-1}>
        <div className="modal-head">
          <h2>What agents can do</h2>
          <span className="caps-identity dim">
            {caps?.identityModel || ''}
          </span>
          <button className="icon-btn" onClick={onClose} title="Close" aria-label="Close">✕</button>
        </div>
        <div className="modal-body">
          <div className="sys-board">
            <div className="sys-title">Systems status</div>
            {(health?.integrations || []).map((i) => (
              <div className="sys-row" key={i.id} title={i.detail}>
                <span className="sys-label">{i.label}</span>
                <span className="sys-arrow">▶</span>
                <span className={`lamp lamp-${i.status}`} />
                <span className="sys-detail dim">{i.detail}</span>
                {i.probe ? (
                  <button className="btn small sys-probe" onClick={() => probe(i.id)}>
                    {probing[i.id] || 'Probe'}
                  </button>
                ) : null}
              </div>
            ))}
          </div>
          <div className="caps-connect">
            {caps?.connected ? (
              <>
                <span className="chip caps-on">● Workspace connected</span>
                <span className="dim">Agents you direct can use your Google account within the limits below.</span>
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
                <span className="dim">This deployment has no Workspace OAuth client yet — agents work on canvas data only. (Owner: see docs/DEPLOY.md.)</span>
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
