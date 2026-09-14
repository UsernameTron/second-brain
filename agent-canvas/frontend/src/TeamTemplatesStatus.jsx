import React from 'react';
import { RequestError } from './RequestState.jsx';

// A workspace-wide list: changing projects cannot turn an unavailable list
// into a confirmed empty team, or hide the way to load it again.
export default function TeamTemplatesStatus({ status, entries = [], onRefresh }) {
  return <>
    <RequestError error={status?.error} subject="Loading team templates" onRetry={onRefresh} retryLabel="Retry team list" />
    {status?.loading ? <p role="status">Loading team templates…</p> : null}
    {status?.error && entries.length > 0 ? <p>Last known team templates are shown. Retry the team list before choosing an agent.</p> : null}
    {!status?.error && !status?.loading && entries.length === 0 ? <p className="empty-hint">No agent templates are available. The owner can add or enable them in Owner settings → Agent templates.</p> : null}
  </>;
}
