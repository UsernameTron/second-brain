import React, { useEffect, useState } from 'react';
import { api, fmtUSD, fmtClock } from './api.js';
import { Panel, ContextReceipt } from './Panels.jsx';
import { RequestError, useResource } from './RequestState.jsx';
import ExplainMap from './ExplainMap.jsx';
import { SummaryMarkdown, formatContractTail, formatRunEventPreview } from './format.jsx';

export default function WorkDetails({ canvasId, runId, runTick, fallbackRun, fetchRunEvents, fetchRunReceipt, onFeedback, onSelectEntry, onSelectRun, onClose, embedded = false }) {
  const receiptState = useResource(() => fetchRunReceipt ? fetchRunReceipt(runId)
    : api(`/api/canvases/${canvasId}/runs/${runId}/receipt`), `${canvasId}:${runId}:receipt`);
  const eventState = useResource(() => fetchRunEvents ? fetchRunEvents(runId)
    : api(`/api/canvases/${canvasId}/runs/${runId}/events`).then((d) => d.events), `${canvasId}:${runId}:events`);
  const [showMap, setShowMap] = useState(false);
  const run = receiptState.data?.run || fallbackRun;
  const refresh = () => Promise.all([receiptState.refresh(), eventState.refresh()]);
  useEffect(() => { if (runTick) refresh(); }, [runTick]); // source-bound hooks invalidate obsolete responses
  useEffect(() => {
    if (!run || !['running', 'queued'].includes(run.status)) return undefined;
    const timer = setInterval(() => { if (document.visibilityState !== 'hidden') refresh(); }, 5000);
    return () => clearInterval(timer);
  }, [canvasId, runId, run?.status]);
  const content = <div className="run-detail">
    <button className="btn small" onClick={refresh}>Refresh work</button>
    <RequestError error={receiptState.error} subject="Loading sources and work details" onRetry={receiptState.refresh} />
    {receiptState.loading ? <p role="status">Loading work details…</p> : null}
    {receiptState.error && run ? <p>Last known work is shown below. Its current status is unavailable.</p> : null}
    {run ? <>
      <div className="run-detail-head"><span className="chip">{String(run.status).replaceAll('_', ' ')}</span><span>{run.steps_used}/{run.step_budget} steps · {fmtUSD(run.cost_usd)}</span></div>
      <p className="run-detail-instr">{run.instruction}</p>
      {run.summary ? <SummaryMarkdown text={formatContractTail(run.summary, 'humanize')} /> : <p>No summary has been recorded yet.</p>}
      {run.error ? <div role="alert">This work did not finish. Review the details, then narrow the request or try again.<details><summary>Technical details</summary>{run.error}</details></div> : null}
      <button className="btn ghost small" aria-pressed={showMap} onClick={() => setShowMap(!showMap)}>{showMap ? 'Hide map' : 'Why? → Map'}</button>
      {showMap ? <ExplainMap canvasId={canvasId} runId={runId} onSelectEntry={onSelectEntry} onSelectRun={onSelectRun} /> : null}
    </> : null}
    {receiptState.data ? <ContextReceipt receipt={receiptState.data} onFeedback={onFeedback ? async (verdict, note) => {
      await onFeedback(runId, verdict, note); await receiptState.refresh();
    } : null} /> : null}
    <RequestError error={eventState.error} subject="Loading work events" onRetry={eventState.refresh} />
    {eventState.loading ? <p role="status">Loading events…</p> : null}
    {!eventState.loading && !eventState.error && eventState.data?.length === 0 ? <p>No events recorded.</p> : null}
    <details><summary>Technical event details</summary><div className="run-events">
      {(eventState.data || []).map((event) => <div key={event.id} className="run-event">
        <span className="mono re-ts">{fmtClock(event.ts)}</span><span className="chip">{event.type}</span>
        <span className="re-payload">{formatRunEventPreview(event, 'detail')}</span>
      </div>)}
    </div></details>
  </div>;
  return embedded ? content : <Panel title="Work details" onClose={onClose}>{content}</Panel>;
}
