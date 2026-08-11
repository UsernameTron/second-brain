import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import Workspace from './Workspace.jsx';

export const AppCtx = createContext(null);

let toastSeq = 0;

export default function App() {
  const [config, setConfig] = useState(null);
  const [user, setUser] = useState(undefined); // undefined = booting, null = signed out
  const [toasts, setToasts] = useState([]);

  const toast = useCallback((msg, kind = 'error') => {
    const id = ++toastSeq;
    setToasts((t) => [...t, { id, msg: String(msg), kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  useEffect(() => {
    api('/api/config')
      .then(setConfig)
      .catch((e) => { setConfig({}); toast(`config: ${e.message}`); });
    api('/api/me')
      .then((d) => setUser(d.user))
      .catch(() => setUser(null));
  }, [toast]);

  return (
    <AppCtx.Provider value={{ config, user, setUser, toast }}>
      {user === undefined || config === null ? (
        <div className="boot-screen"><div className="boot-glyph" /><div>Waking the canvas…</div></div>
      ) : user ? (
        <Workspace />
      ) : (
        <SignIn />
      )}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>{t.msg}</div>
        ))}
      </div>
    </AppCtx.Provider>
  );
}

function SignIn() {
  const { config, setUser, toast } = useContext(AppCtx);
  const [err, setErr] = useState(null);
  const [devEmail, setDevEmail] = useState('');
  const [mascotOk, setMascotOk] = useState(true);
  const [busy, setBusy] = useState(false);
  const gsiRef = useRef(null);

  useEffect(() => {
    if (!config || !config.googleClientId) return;
    let cancelled = false;
    const ready = () => {
      if (cancelled || !window.google || !gsiRef.current) return;
      window.google.accounts.id.initialize({
        client_id: config.googleClientId,
        callback: async (resp) => {
          try {
            const d = await api('/api/auth/google', { method: 'POST', body: { credential: resp.credential } });
            setUser(d.user);
          } catch (e) {
            setErr(e.message);
            toast(e.message);
          }
        },
      });
      window.google.accounts.id.renderButton(gsiRef.current, { theme: 'filled_black', size: 'large', width: 300 });
    };
    if (window.google && window.google.accounts) { ready(); return undefined; }
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = ready;
    s.onerror = () => { if (!cancelled) setErr('could not load Google sign-in'); };
    document.head.appendChild(s);
    return () => { cancelled = true; };
  }, [config, setUser, toast]);

  const devSignIn = async (e) => {
    e.preventDefault();
    if (!devEmail.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const d = await api('/api/auth/dev', { method: 'POST', body: { email: devEmail.trim() } });
      setUser(d.user);
    } catch (e2) {
      setErr(e2.message);
      toast(e2.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="signin">
      <div className="signin-card">
        {mascotOk ? (
          <img
            className="signin-mascot"
            src="/mascot.png"
            alt="CUE, the Cloud Tech Gurus mascot"
            onError={() => setMascotOk(false)}
          />
        ) : (
          <div className="signin-glyph" />
        )}
        <h1>Agent Canvas</h1>
        <p className="signin-sub">
          A shared workspace where your agents work in the open.
          {config?.domain ? <span className="mono"> @{config.domain}</span> : null}
        </p>
        {config?.googleClientId ? (
          <div className="gsi-slot" ref={gsiRef} />
        ) : (
          <p className="signin-note">Google sign-in is not configured on this server.</p>
        )}
        {config?.devAuth ? (
          <form className="dev-auth" onSubmit={devSignIn}>
            <span className="dev-badge">DEV MODE</span>
            <label htmlFor="dev-email">Development sign-in</label>
            <div className="dev-row">
              <input
                id="dev-email"
                type="email"
                placeholder={config?.domain ? `you@${config.domain}` : 'you@example.com'}
                value={devEmail}
                onChange={(e) => setDevEmail(e.target.value)}
              />
              <button className="btn primary" type="submit" disabled={busy || !devEmail.trim()}>
                {busy ? '…' : 'Sign in'}
              </button>
            </div>
          </form>
        ) : null}
        {err ? <div className="signin-error">{err}</div> : null}
      </div>
    </div>
  );
}
