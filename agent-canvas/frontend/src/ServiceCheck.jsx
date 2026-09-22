import React from 'react';
import { integrationStatus } from './format.jsx';
import { RequestError } from './RequestState.jsx';

const NAMES = { model: 'Answer service', gmail: 'Gmail', drive: 'Google Drive and Docs', sheets: 'Google Sheets',
  calendar: 'Google Calendar', audit: 'Audit integrity', db: 'Saved data and backups', websearch: 'Web research',
  hubspot: 'HubSpot', enrichment: 'Contact information', standing_rules: 'Scheduled work delivery', mcp: 'Additional connections' };
export const serviceName = (item) => NAMES[item.id] || (item.id.startsWith('mcp:') ? `Additional connection: ${item.id.slice(4)}` : `Additional service: ${item.label || item.id}`);

export default function ServiceCheck({ item, unavailable, loading, attempt, onProbe, onRefresh, technical = false }) {
  const name = serviceName(item), pending = attempt?.pending;
  const unknown = unavailable || attempt?.error || !item.status;
  const status = loading || pending || unknown ? 'planned' : integrationStatus(item);
  const configuredOnly = ['db', 'websearch'].includes(item.id) && item.status === 'ready';
  const label = loading || pending ? 'Checking…' : unknown ? 'Status unavailable' : configuredOnly ? 'Configured; delivery not verified'
    : ({ ready: 'Checked', down: 'Unavailable', planned: 'Not confirmed', attention: 'Needs attention' })[status] || 'Status unknown';

  return <section className="service-check" aria-label={name} data-service={item.id}>
    <div className="service-heading">
      <h3>{name}</h3>
      <span className="service-status"><span className={`lamp lamp-${status}`} aria-hidden="true" />{label}</span>
      {item.probe && (!attempt?.error || attempt.error.unconfirmed) ? <button className="btn small" disabled={pending || loading} onClick={() => onProbe(item.id)}>
        {pending ? 'Checking…' : attempt ? 'Check again' : 'Check now'}
      </button> : null}
    </div>
    {unknown && !attempt?.error ? <p>Refresh status for the latest result.</p>
      : !loading && !pending && !attempt?.error && status !== 'ready' ? <p>{item.probe
        ? 'Check this service before asking an agent to use it.'
        : 'Working access is not confirmed. Ask the owner for help if you need this service.'}</p> : null}
    <RequestError error={attempt?.error} subject={`Checking ${name}`} onRetry={attempt?.error?.unconfirmed ? onRefresh : () => onProbe(item.id)}
      retryLabel={attempt?.error?.unconfirmed ? 'Check status' : 'Check again'} />
    {item.detail || attempt?.result || technical ? <details className="service-details">
      <summary>Service details</summary>
      <p>{item.detail || 'No further detail was returned.'}</p>
      {technical ? <p>Service reference: <code>{item.id}</code>{item.label ? ` · ${item.label}` : ''}</p> : null}
      {attempt?.result ? <p>Latest check result: {attempt.result.ok === true ? 'passed' : attempt.result.ok === false ? 'did not pass' : 'not confirmed'}{Number.isFinite(attempt.result.ms) ? ` · ${attempt.result.ms} milliseconds` : ''}.</p> : null}
      {unknown || loading || pending ? <p>These are last-known details. Current working status is not confirmed.</p> : null}
    </details> : null}
  </section>;
}
