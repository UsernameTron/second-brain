import React from 'react';
import { timeAgo, short } from './api.js';
import { Panel } from './Panels.jsx';

const FIELDS = ['company', 'website', 'employee_count', 'industry', 'contact_name', 'contact_email', 'phone', 'city', 'state'];

const CS_STATUS = { proposed: 'cs-proposed', verified: 'cs-verified', partially_verified: 'cs-partial', rejected: 'cs-rejected' };

export default function Workbook({ rows, changesets, agentsById, paused, onRunCleanup, onClose }) {
  return (
    <Panel
      title={`Workbook (${rows.length} rows)`}
      wide
      onClose={onClose}
      headerExtra={
        <button
          className="btn run-cleanup"
          onClick={onRunCleanup}
          disabled={paused}
          title={paused ? 'Workspace is paused' : 'Dispatch the research agent to triage every pending row'}
        >
          ▶ Run cleanup
        </button>
      }
    >
      <div className="table-scroll">
        <table className="workbook-table">
          <thead>
            <tr>
              <th>#</th>
              {FIELDS.map((f) => <th key={f}>{f.replace('_', ' ')}</th>)}
              <th>status</th>
              <th>notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={FIELDS.length + 3} className="empty-hint">No rows in this workbook.</td></tr>
            ) : null}
            {rows.map((r) => (
              <tr key={r.id} className={`row-${r.status}`}>
                <td className="mono">{r.row_index}</td>
                {FIELDS.map((f) => (
                  <td key={f} title={String(r.data?.[f] ?? '')}>{short(String(r.data?.[f] ?? ''), 28)}</td>
                ))}
                <td><span className={`chip row-st st-${r.status}`}>{r.status}</span></td>
                <td className="wb-notes" title={r.notes || ''}>{short(r.notes, 60)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3>Change sets ({changesets.length})</h3>
      {changesets.length === 0 ? (
        <div className="empty-hint">No change sets yet — the coding agent proposes them after research flags rows.</div>
      ) : null}
      {changesets.map((cs) => (
        <div key={cs.id} className="changeset">
          <div className="changeset-head">
            <span className={`chip ${CS_STATUS[cs.status] || ''}`}>{cs.status.replace('_', ' ')}</span>
            <span className="dim">by {agentsById[cs.agent_id]?.name || cs.agent_id || 'unknown'}</span>
            <span className="mono dim">{timeAgo(cs.created_at)}</span>
            <span className="mono dim">{(cs.changes || []).length} changes</span>
          </div>
          <div className="table-scroll">
            <table className="changes-table">
              <thead>
                <tr><th>row</th><th>field</th><th>old → new</th><th>reason</th><th>verdict</th></tr>
              </thead>
              <tbody>
                {(cs.changes || []).map((c) => (
                  <tr key={c.id}>
                    <td className="mono">{c.row_index}</td>
                    <td className="mono">{c.field}</td>
                    <td>
                      <span className="old-val">{short(c.old_value, 30) || '(empty)'}</span>
                      <span className="arrow"> → </span>
                      <span className="new-val">{short(c.new_value, 30) || '(cleared)'}</span>
                    </td>
                    <td className="change-reason" title={c.reason}>{short(c.reason, 70)}</td>
                    <td>
                      {c.verdict
                        ? (
                          <span className={`chip verdict-${c.verdict}`} title={c.verdict_reason || ''}>
                            {c.verdict}
                          </span>
                        )
                        : <span className="chip verdict-pending">pending</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </Panel>
  );
}
