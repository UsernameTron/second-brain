import React, { useCallback, useEffect, useRef, useState } from 'react';

export function errorMessage(error, subject = 'This request') {
  if (error?.unconfirmed) return `${subject} is not confirmed. Check status before trying again.`;
  if (error?.status === 401) return 'Your session has expired. Sign in again to continue.';
  if (error?.status === 403) return `You do not have permission to do this. Ask the project owner for access.`;
  if (error?.status === 409) return 'This item changed while you were working. Refresh its status before trying again.';
  return `${subject} could not be completed. Check your connection and try again.`;
}

export function RequestError({ error, subject, onRetry, retryLabel, children }) {
  const [retryError, setRetryError] = useState(null);
  const [retrying, setRetrying] = useState(false);
  useEffect(() => { setRetryError(null); }, [error]);
  if (!error) return null;
  const retry = async () => {
    if (retrying) return;
    setRetrying(true); setRetryError(null);
    try { await onRetry(); } catch (e) { setRetryError(e); }
    finally { setRetrying(false); }
  };
  return <div className="request-error" role="alert">
    <p>{errorMessage(retryError || error, subject)}</p>
    {onRetry ? <button type="button" className="btn small" disabled={retrying} onClick={retry}>{retryLabel || (error.unconfirmed ? 'Check status' : 'Try again')}</button> : null}
    {children}
    {error.message ? <details><summary>Technical details</summary><div>{error.message}</div></details> : null}
  </div>;
}

// React state only. Identity changes invalidate late responses; last-known
// values remain available explicitly as stale after a refresh failure.
export function useResource(loader, identity) {
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const seq = useRef(0);
  const [state, setState] = useState({ key: identity, data: null, loading: true, error: null });
  const refresh = useCallback(async () => {
    const request = ++seq.current;
    setState((s) => ({ key: identity, data: s.key === identity ? s.data : null, loading: true, error: null }));
    try {
      const data = await loaderRef.current();
      if (request === seq.current) setState({ key: identity, data, loading: false, error: null });
      return data;
    } catch (error) {
      if (request === seq.current) setState((s) => ({ ...s, loading: false, error }));
      return undefined;
    }
  }, [identity]);
  useEffect(() => { refresh(); return () => { seq.current += 1; }; }, [refresh]);
  return { ...(state.key === identity ? state : { data: null, loading: true, error: null }), refresh };
}

export class WorkspaceBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <div className="boot-screen" role="alert">
      <p>This page could not be displayed. Reload to reopen your saved work.</p>
      <button className="btn" onClick={() => window.location.reload()}>Reload page</button>
    </div>;
    return this.props.children;
  }
}
