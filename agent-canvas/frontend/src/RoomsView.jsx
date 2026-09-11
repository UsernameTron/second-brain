import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, timeAgo, short } from './api.js';
import { useDraft } from './Drafts.jsx';
import { RequestError, useResource } from './RequestState.jsx';
import { sourceLabel, choiceKeys, certaintyLabel, workStatusLabel, formatRunEventPreview } from './format.jsx';

// P3 Evidence Rooms. A Room is a lens over its canvas: Brief (six sections +
// now/history/risk), Map (the canvas itself), Activity (the existing feed).
// Every fact shows its source and freshness; nothing here is a new store.

const ROOM_TYPES = ['deal', 'client', 'initiative', 'decision'];
const LENSES = [
  { key: 'now', label: 'Now', hint: 'open and active items' },
  { key: 'history', label: 'History', hint: 'includes resolved and superseded' },
  { key: 'risk', label: 'Risk', hint: 'only what can bite' },
];

function Section({ title, count, children }) {
  return (
    <section className="room-section">
      <h3>{title}{count !== undefined ? <span className="chip">{count}</span> : null}</h3>
      {children}
    </section>
  );
}

function RoomBrief({ built, onOpenRun }) {
  const s = built.sections;
  return (
    <div className="room-brief">
      <Section title="People" count={s.people.members.length + s.people.onCanvas.length}>
        {s.people.members.length + s.people.onCanvas.length === 0 ? <p className="dim">No people yet — the owner can add members or person cards from the canvas.</p> : (
          <ul className="room-list">
            {s.people.members.map((m) => (
              <li key={`m-${m.email}`}><span className="mono">{m.email}</span> <span className="chip">{m.access}</span></li>
            ))}
            {s.people.onCanvas.filter((p) => !s.people.members.some((m) => m.email.toLowerCase() === p.email.toLowerCase())).map((p) => (
              <li key={`p-${p.id}`}><span className="mono">{p.display || p.email}</span> <span className="chip">on canvas</span></li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Evidence" count={s.evidence.length}>
        {s.evidence.length === 0 ? <p className="dim">Nothing retrieved yet — Refresh the room to gather evidence.</p> : (
          <ul className="room-list">
            {s.evidence.map((e) => (
              <li key={e.id}>
                <span className="chip">{sourceLabel(e.sourceKind)}</span>{' '}
                {e.redacted ? <span title="source visible to the directing user only">{e.title || '(untitled)'} · redacted</span>
                  : e.uri ? <a href={e.uri} target="_blank" rel="noopener noreferrer">{e.title || e.uri}</a>
                  : <span>{e.title || '(untitled)'}</span>}
                <span className="dim mono"> · {timeAgo(e.retrievedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Work" count={s.work.tasks.length + s.work.runs.length}>
        {!s.work.tasks.length && !s.work.runs.length ? <p>No work recorded yet.</p> : null}
        <ul className="room-list">
          {s.work.tasks.map((t) => (
            <li key={t.id}><span className="chip">task</span> {t.title} <span className={`chip tk-${t.status}`}>{t.status.replace('_', ' ')}</span>{t.assignee_email ? <span className="dim mono"> · {t.assignee_email}</span> : null}</li>
          ))}
          {s.work.runs.map((r) => (
            <li key={r.id}>
              <span className="chip">agent work</span>{' '}
              <button className="btn ghost small" onClick={() => onOpenRun({ canvasId: built.room.canvasId, agentId: r.agent_id, runId: r.id })}>{short(r.instruction, 60)}</button>
              <span className={`chip inq-${r.status}`}>{workStatusLabel(r.status)}</span>
              <span className="dim mono"> · {timeAgo(r.created_at)}</span>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Decisions" count={s.decisions.length}>
        {s.decisions.length === 0 ? <p className="dim">No recorded decisions.</p> : (
          <ul className="room-list">
            {s.decisions.map((d) => (
              <li key={d.id}>
                {d.content}
                <span className={`chip epi-${d.epistemic}`}>{certaintyLabel(d.epistemic)}</span>
                {d.tainted ? <span className="chip conflict-chip">⚠ built on corrected info</span> : null}
                <span className="dim mono"> · {d.author && d.author.name} · {timeAgo(d.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Risks" count={s.risks.length}>
        {s.risks.length === 0 ? <p className="dim">No risks recorded in this view. This does not prove there are no risks.</p> : (
          <ul className="room-list">
            {s.risks.map((r) => (
              // Risks are attention cards — `decision` is the field they
              // actually carry (server/attention.js card contract).
              <li key={`${r.sourceRef.kind}-${r.sourceRef.id}`}><span className="chip">{r.sourceRef.kind.replace('_', ' ')}</span> {r.decision || r.title || r.summary || r.question || 'Needs review'} <span className="dim mono">· {timeAgo(r.created_at)}</span></li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Open questions" count={s.openQuestions.escalations.length + s.openQuestions.inquiries.length}>
        {!s.openQuestions.escalations.length && !s.openQuestions.inquiries.length ? <p>No open questions recorded.</p> : null}
        <ul className="room-list">
          {s.openQuestions.escalations.map((e) => (
            <li key={e.id}><span className="chip">needs an answer</span> {e.question} <span className="chip">{e.status}</span><span className="dim mono"> · {timeAgo(e.created_at)}</span></li>
          ))}
          {s.openQuestions.inquiries.map((q) => (
            <li key={q.id}><span className="chip">inquiry</span> {q.question} <span className="chip">{q.status}</span><span className="dim mono"> · {timeAgo(q.created_at)}</span></li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

export default function RoomsView({ user, roster, onOpenCanvas, onOpenRun, onCreated, toast }) {
  const [roomId, setRoomId] = useState(null);
  const [lens, setLens] = useState('now');
  const [tab, setTab] = useState('brief');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [exportError, setExportError] = useState(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportPreview, setExportPreview] = useState(null);
  const [refreshRun, setRefreshRun] = useState(null);
  const [pollError, setPollError] = useState(null);
  const [pollTick, setPollTick] = useState(0);
  const [name, setName] = useDraft(`room-create:${user.email}:name`, '');
  const [roomType, setRoomType] = useDraft(`room-create:${user.email}:roomType`, 'deal');
  const [externalRef, setExternalRef] = useDraft(`room-create:${user.email}:externalRef`, '');
  const [staff, setStaff] = useDraft(`room-create:${user.email}:staff`, () => new Set());
  const [members, setMembers] = useDraft(`room-create:${user.email}:members`, () => new Set());
  const isOwner = user.role === 'owner';
  const active = useRef(roomId);
  active.current = roomId;
  const exportSeq = useRef(0);
  const list = useResource(() => api('/api/rooms'), 'rooms');
  const players = useResource(() => isOwner ? api('/api/allowlist') : Promise.resolve(null), `players:${user.email}:${isOwner}`);
  const detail = useResource(() => roomId ? api(`/api/rooms/${roomId}?lens=${lens}`) : Promise.resolve(null), `${roomId}:${lens}`);
  const activityState = useResource(() => tab === 'activity' && detail.data ? api(`/api/canvases/${detail.data.room.canvasId}/activity`) : Promise.resolve(null), `${roomId}:${tab}:${detail.data?.room.canvasId}`);
  const rooms = list.data?.rooms;
  const archived = list.data?.archived || [];
  const people = (players.data?.allowlist || []).filter((p) => p.email !== user.email);
  const built = detail.data;
  const activity = tab === 'activity' ? activityState.data?.events : null;
  const running = refreshRun && ['queued', 'running', 'pending'].includes(refreshRun.status);
  const open = (id) => {
    active.current = id; exportSeq.current += 1;
    setRoomId(id); setLens('now'); setTab('brief'); setExportPreview(null);
    setError(null); setExportError(null); setBusy(false); setExportBusy(false); setRefreshRun(null); setPollError(null);
  };
  useEffect(() => () => { active.current = null; exportSeq.current += 1; }, []);
  useEffect(() => {
    if (!running || !built) return;
    let cancelled = false;
    let timer;
    const check = async () => {
      try {
        const d = await api(`/api/canvases/${built.room.canvasId}/runs/${refreshRun.id}/receipt`);
        if (cancelled) return;
        setPollError(null);
        if (d.run && !['queued', 'running', 'pending'].includes(d.run.status)) {
          setRefreshRun(d.run); detail.refresh();
        } else timer = setTimeout(check, 5000);
      } catch (e) { if (!cancelled) setPollError(e); }
    };
    check();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [roomId, refreshRun?.id, running, pollTick, built?.room.canvasId]);

  const create = async (e) => {
    e.preventDefault();
    if (!name.trim() || busy || error?.unconfirmed || players.loading || players.error) return;
    setBusy(true); setError(null);
    try {
      const d = await api('/api/rooms', { method: 'POST', body: { name: name.trim(), room_type: roomType, external_ref: externalRef.trim(), roster_ids: [...staff], member_emails: [...members] } });
      if (active.current !== null) return;
      setName(''); setExternalRef(''); setStaff(new Set()); setMembers(new Set());
      list.refresh(); open(d.room.id);
      onCreated?.(d.room);
      toast('Room created', 'ok');
    } catch (e2) { if (active.current === null) setError(e2); }
    finally { if (active.current === null) setBusy(false); }
  };
  const refresh = async () => {
    if (busy || running || error?.unconfirmed) return;
    const id = roomId;
    setBusy(true); setError(null);
    try {
      const d = await api(`/api/rooms/${id}/refresh`, { method: 'POST', body: {} });
      if (active.current !== id) return;
      setRefreshRun({ ...d.run, status: d.run?.status || 'queued' });
      detail.refresh();
    } catch (e) { if (active.current === id) setError(e); }
    finally { if (active.current === id) setBusy(false); }
  };
  const showExportPreview = async () => {
    const id = roomId;
    const seq = ++exportSeq.current;
    setExportBusy(true); setExportError(null); setExportPreview(null);
    try {
      const d = await api(`/api/rooms/${id}/export/preview`);
      if (active.current === id && seq === exportSeq.current) setExportPreview(d);
    } catch (e) { if (active.current === id && seq === exportSeq.current) setExportError(e); }
    finally { if (active.current === id && seq === exportSeq.current) setExportBusy(false); }
  };
  const downloadExport = async () => {
    if (exportBusy || !exportPreview) return;
    const id = roomId;
    const seq = exportSeq.current;
    setExportBusy(true); setExportError(null);
    try {
      const blob = await api(`/api/rooms/${id}/export`, { method: 'POST', body: { manifest_hash: exportPreview.manifestHash }, responseType: 'blob' });
      if (active.current !== id || seq !== exportSeq.current) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'room-recommendation.html'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportPreview(null);
      toast('Export download started', 'ok');
    } catch (e) { if (active.current === id && seq === exportSeq.current) { setExportError(e); if (e.status === 409) setExportPreview(null); } }
    finally { if (active.current === id && seq === exportSeq.current) setExportBusy(false); }
  };

  if (roomId && !built) return <div className="rooms-view"><button className="btn" onClick={() => open(null)}>← Rooms</button>
    {detail.loading ? <p role="status">Loading room…</p> : null}<RequestError error={detail.error} subject="Loading this room" onRetry={detail.refresh} /></div>;
  if (roomId && built) {
    const room = built.room;
    return (
      <div className="rooms-view">
        <div className="room-head">
          <button className="btn ghost small" onClick={() => { open(null); list.refresh(); }}>← Rooms</button>
          <h1>{room.name}</h1>
          <span className="chip">{room.roomType}</span>
          {room.externalRef ? <span className="chip mono">{room.externalRef}</span> : null}
          <span className="dim mono">
            {room.refreshedAt ? `refreshed ${timeAgo(room.refreshedAt)} by ${room.refreshedBy}` : 'never refreshed'}
          </span>
        </div>
        <div className="room-toolbar">
          <div className="mode-switch" role="radiogroup" aria-label="Lens">
            {LENSES.map((l) => (
              <button key={l.key} type="button" role="radio" aria-checked={lens === l.key} title={l.hint}
                className={`btn ghost small ${lens === l.key ? 'lens-on' : ''}`}
                onKeyDown={(e) => choiceKeys(e, LENSES.map((x) => x.key), lens, setLens)} onClick={() => { setTab('brief'); setLens(l.key); }}>{l.label}</button>
            ))}
          </div>
          <button className={`btn ghost small ${tab === 'activity' ? 'lens-on' : ''}`} onClick={() => setTab(tab === 'brief' ? 'activity' : 'brief')}>
            {tab === 'brief' ? 'Activity' : 'Brief'}
          </button>
          <button className="btn ghost small" onClick={() => onOpenCanvas(room.canvasId)}>Advanced canvas</button>
          {built.access !== 'view' ? (
            <button className="btn primary small" disabled={busy || running || error?.unconfirmed} onClick={refresh} title="One ask-mode run: re-check sources, store only conclusions with evidence">
              {busy ? 'Requesting refresh…' : running ? 'Refresh in progress…' : 'Refresh room'}
            </button>
          ) : <span className="chip">view only</span>}
          {isOwner ? (
            <button className="btn ghost small" disabled={exportBusy} onClick={() => (exportPreview ? setExportPreview(null) : showExportPreview())}>
              {exportPreview ? 'Close export preview' : 'Export…'}
            </button>
          ) : null}
        </div>
        <RequestError error={detail.error} subject="Loading this room" onRetry={detail.refresh} />
        {detail.loading ? <p role="status">Updating room…</p> : null}
        {detail.error ? <p>Last known room details are shown. Refresh before relying on them.</p> : null}
        <RequestError error={error} subject="Requesting the room refresh" onRetry={detail.refresh} retryLabel="Check room status" />
        {error?.unconfirmed ? <button className="btn small" onClick={() => setError(null)}>I checked the work; keep editing</button> : null}
        {refreshRun ? <p role="status">{running ? 'Refresh requested. Work is still in progress; the brief is not yet updated.' : `Refresh work: ${workStatusLabel(refreshRun.status)}. Review its result before relying on the brief.`} <button className="btn small" onClick={() => onOpenRun({ canvasId: room.canvasId, runId: refreshRun.id })}>View refresh work</button></p> : null}
        <RequestError error={pollError} subject="Checking refresh progress" onRetry={() => { setPollError(null); setPollTick((n) => n + 1); }} retryLabel="Check status" />
        <RequestError error={exportError} subject="Preparing the room export" onRetry={showExportPreview} retryLabel="Review a fresh export preview" />
        {exportBusy ? <p role="status">Preparing export…</p> : null}
        {exportPreview ? (
          <div className="room-export-preview">
            <h3>Disclosure review — what leaves, what stays</h3>
            <p><b>Included:</b> {exportPreview.included.decisions.length} decisions, {exportPreview.included.facts.length} verified findings, {exportPreview.included.evidence.length} evidence references, {exportPreview.included.tasks.length} work items.</p>
            <p><b>Excluded:</b> {exportPreview.excluded.assumptionsAndInferences.length} assumptions/inferences, {exportPreview.excluded.taintedEntries.length} tainted entries, {exportPreview.excluded.privateEvidence.length} private-surface sources, {exportPreview.excluded.openEscalations.length} open escalations, and the audit chain (always).</p>
            <ul className="room-list">
              {exportPreview.excluded.privateEvidence.map((r) => (
                <li key={r.id}><span className="chip">{sourceLabel(r.sourceKind)}</span> {r.title || '(untitled)'} <span className="dim">— stays internal</span></li>
              ))}
            </ul>
            {(exportPreview.contentWarnings || []).length > 0 ? (
              <>
                <p><b>Mentions internal sources — review wording:</b> these items ship as written, but their text names a private-surface source.</p>
                <ul className="room-list">
                  {exportPreview.contentWarnings.map((w) => (
                    <li key={w.id}><span className="chip">{w.kind}</span> {w.content} <span className="dim">— names: {w.matchedTitles.join(', ')}</span></li>
                  ))}
                </ul>
              </>
            ) : null}
            <button className="btn primary small" disabled={exportBusy} onClick={downloadExport}>Download client-safe HTML</button>
          </div>
        ) : null}
        {tab === 'activity' ? <><RequestError error={activityState.error} subject="Loading room activity" onRetry={activityState.refresh} />{activityState.loading ? <p role="status">Loading activity…</p> : null}</> : null}
        {tab === 'activity' && activity ? (
          <ul className="room-list room-activity">
            {activity.length === 0 ? <li className="dim">No activity yet.</li> : activity.map((a) => (
              <li key={a.id}><span className="chip">{a.type}</span> {short(formatRunEventPreview(a, 'room'), 120)} <span className="dim mono">· {timeAgo(a.ts)}</span></li>
            ))}
          </ul>
        ) : (
          tab === 'brief' ? <RoomBrief built={built} onOpenRun={onOpenRun} /> : null
        )}
      </div>
    );
  }

  return (
    <div className="rooms-view">
      <div className="home-hero">
        <h1>Evidence Rooms</h1>
        <p className="home-sub">One room per deal, client, initiative, or decision — every fact with its source and freshness.</p>
      </div>
      <RequestError error={list.error} subject="Loading rooms" onRetry={list.refresh} />
      {list.error && rooms ? <p>Last known rooms are shown; this list may be out of date.</p> : null}
      <RequestError error={error} subject="Creating the room" onRetry={list.refresh} retryLabel="Check rooms" />
      {error?.unconfirmed ? <button className="btn small" onClick={() => setError(null)}>I checked the rooms; keep editing</button> : null}
      {isOwner ? (
        <form className="room-create" onSubmit={create}>
          <label htmlFor="room-name" className="sr-only-label">Room name</label>
          <input id="room-name" value={name} placeholder="Room name — e.g. Acme renewal" onChange={(e) => setName(e.target.value)} />
          <select aria-label="Room type" value={roomType} onChange={(e) => setRoomType(e.target.value)}>
            {ROOM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <details><summary>Setup details: agents and external reference</summary>
          <input aria-label="External reference (optional)" value={externalRef} placeholder="external ref (CRM id…)" onChange={(e) => setExternalRef(e.target.value)} />
          <div className="room-staff">
            {(roster || []).filter((r) => r.enabled).map((r) => (
              <label key={r.id} className="chip staff-chip">
                <input type="checkbox" checked={staff.has(r.id)}
                  onChange={(e) => setStaff((cur) => { const next = new Set(cur); if (e.target.checked) next.add(r.id); else next.delete(r.id); return next; })} />
                {r.name}
              </label>
            ))}
          </div>
          </details>
          <RequestError error={players.error} subject="Loading people who can access this room" onRetry={players.refresh} />
          {players.loading ? <p role="status">Loading people…</p> : !players.error && people.length === 0 ? <p>No other people are available to add. The owner will have access.</p> : null}
          {people.length ? (
            <div className="room-staff" aria-label="Players — people who can see this room">
              {people.map((p) => (
                <label key={p.email} className="chip staff-chip">
                  <input type="checkbox" checked={members.has(p.email)}
                    onChange={(e) => setMembers((cur) => { const next = new Set(cur); if (e.target.checked) next.add(p.email); else next.delete(p.email); return next; })} />
                  {p.email}
                </label>
              ))}
            </div>
          ) : null}
          <button className="btn primary" type="submit" disabled={busy || !name.trim() || players.loading || !!players.error || error?.unconfirmed}>{busy ? 'Creating…' : 'Create room'}</button>
        </form>
      ) : null}
      {list.loading ? <div className="empty-hint">Loading rooms…</div> : null}
      <div className="room-cards">
        {(rooms || []).map((r) => (
          <button key={r.id} className="room-card" onClick={() => open(r.id)}>
            <b>{r.name}</b>
            <span className="chip">{r.roomType}</span>
            <span className="dim mono">{r.refreshedAt ? `refreshed ${timeAgo(r.refreshedAt)}` : 'never refreshed'}</span>
          </button>
        ))}
        {rooms && rooms.length === 0 && !list.error ? <p className="dim">No rooms yet{isOwner ? ' — create the first one above.' : '.'}</p> : null}
      </div>
      {archived.length ? <p className="dim">{archived.length} archived room{archived.length === 1 ? '' : 's'}</p> : null}
    </div>
  );
}
