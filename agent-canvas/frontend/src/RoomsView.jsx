import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, timeAgo, short } from './api.js';
import { formatRunEventPreview } from './format.jsx';

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
                <span className="chip">{e.sourceKind}</span>{' '}
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
        <ul className="room-list">
          {s.work.tasks.map((t) => (
            <li key={t.id}><span className="chip">task</span> {t.title} <span className={`chip tk-${t.status}`}>{t.status.replace('_', ' ')}</span>{t.assignee_email ? <span className="dim mono"> · {t.assignee_email}</span> : null}</li>
          ))}
          {s.work.runs.map((r) => (
            <li key={r.id}>
              <span className="chip">run</span>{' '}
              <button className="btn ghost small" onClick={() => onOpenRun({ canvasId: built.room.canvasId, agentId: r.agent_id, runId: r.id })}>{short(r.instruction, 60)}</button>
              <span className={`chip inq-${r.status}`}>{r.status}</span>
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
                <span className={`chip epi-${d.epistemic}`}>{d.epistemic}</span>
                {d.tainted ? <span className="chip conflict-chip">⚠ built on corrected info</span> : null}
                <span className="dim mono"> · {d.author && d.author.name} · {timeAgo(d.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Risks" count={s.risks.length}>
        {s.risks.length === 0 ? <p className="dim">Nothing risky on the radar.</p> : (
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
        <ul className="room-list">
          {s.openQuestions.escalations.map((e) => (
            <li key={e.id}><span className="chip">escalation</span> {e.question} <span className="chip">{e.status}</span><span className="dim mono"> · {timeAgo(e.created_at)}</span></li>
          ))}
          {s.openQuestions.inquiries.map((q) => (
            <li key={q.id}><span className="chip">inquiry</span> {q.question} <span className="chip">{q.status}</span><span className="dim mono"> · {timeAgo(q.created_at)}</span></li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

export default function RoomsView({ user, roster, onOpenCanvas, onOpenRun, toast }) {
  const [rooms, setRooms] = useState(null);
  const [archived, setArchived] = useState([]);
  const [roomId, setRoomId] = useState(null);
  const [built, setBuilt] = useState(null);
  const [lens, setLens] = useState('now');
  const [activity, setActivity] = useState(null); // null = Brief tab
  const [busy, setBusy] = useState(false);
  const [exportPreview, setExportPreview] = useState(null);
  const [name, setName] = useState('');
  const [roomType, setRoomType] = useState('deal');
  const [externalRef, setExternalRef] = useState('');
  const [staff, setStaff] = useState(() => new Set());
  const isOwner = user.role === 'owner';

  const loadList = useCallback(() => {
    api('/api/rooms').then((d) => { setRooms(d.rooms); setArchived(d.archived || []); }).catch((e) => toast(e.message));
  }, [toast]);
  useEffect(() => { loadList(); }, [loadList]);

  // Stale-response guard, same pattern as Home.jsx.
  const loadSeq = useRef(0);
  const loadRoom = useCallback((id, lensKey) => {
    const seq = ++loadSeq.current;
    api(`/api/rooms/${id}?lens=${lensKey}`)
      .then((d) => { if (seq === loadSeq.current) setBuilt(d); })
      .catch((e) => { if (seq === loadSeq.current) toast(e.message); });
  }, [toast]);

  const open = (id) => { setRoomId(id); setBuilt(null); setActivity(null); setLens('now'); loadRoom(id, 'now'); };
  const switchLens = (key) => { setLens(key); loadRoom(roomId, key); };

  const create = async (e) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const d = await api('/api/rooms', { method: 'POST', body: { name: name.trim(), room_type: roomType, external_ref: externalRef.trim(), roster_ids: [...staff] } });
      setName(''); setExternalRef(''); setStaff(new Set());
      loadList();
      open(d.room.id);
      toast('Room created', 'ok');
    } catch (e2) { toast(e2.message); } finally { setBusy(false); }
  };

  const refresh = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api(`/api/rooms/${roomId}/refresh`, { method: 'POST', body: {} });
      toast('Refresh dispatched — conclusions land as memory with evidence', 'ok');
      loadRoom(roomId, lens);
    } catch (e) { toast(e.message); } finally { setBusy(false); }
  };

  const showExportPreview = () => {
    api(`/api/rooms/${roomId}/export/preview`)
      .then((d) => setExportPreview(d))
      .catch((e) => toast(e.message));
  };
  const downloadExport = async () => {
    try {
      const res = await fetch(`/api/rooms/${roomId}/export`, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manifest_hash: exportPreview.manifestHash }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `room-recommendation.html`;
      a.click();
      URL.revokeObjectURL(url);
      setExportPreview(null);
      toast('Client-safe export downloaded', 'ok');
    } catch (e) { toast(e.message); }
  };

  const activitySeq = useRef(0);
  const showActivity = () => {
    const seq = ++activitySeq.current;
    const forRoom = roomId;
    api(`/api/canvases/${built.room.canvasId}/activity`)
      .then((d) => { if (seq === activitySeq.current && forRoom === roomId) setActivity(d.events || []); })
      .catch((e) => { if (seq === activitySeq.current) toast(e.message); });
  };

  if (roomId && built) {
    const room = built.room;
    return (
      <div className="rooms-view">
        <div className="room-head">
          <button className="btn ghost small" onClick={() => { setRoomId(null); setBuilt(null); loadList(); }}>← Rooms</button>
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
                onClick={() => { setActivity(null); switchLens(l.key); }}>{l.label}</button>
            ))}
          </div>
          <button className={`btn ghost small ${activity !== null ? 'lens-on' : ''}`} onClick={() => (activity === null ? showActivity() : setActivity(null))}>
            {activity === null ? 'Activity' : 'Brief'}
          </button>
          <button className="btn ghost small" onClick={() => onOpenCanvas(room.canvasId)}>Map</button>
          {built.access !== 'view' ? (
            <button className="btn primary small" disabled={busy} onClick={refresh} title="One ask-mode run: re-check sources, store only conclusions with evidence">
              {busy ? 'Refreshing…' : 'Refresh room'}
            </button>
          ) : <span className="chip">view only</span>}
          {isOwner ? (
            <button className="btn ghost small" onClick={() => (exportPreview ? setExportPreview(null) : showExportPreview())}>
              {exportPreview ? 'Close export preview' : 'Export…'}
            </button>
          ) : null}
        </div>
        {exportPreview ? (
          <div className="room-export-preview">
            <h3>Disclosure review — what leaves, what stays</h3>
            <p><b>Included:</b> {exportPreview.included.decisions.length} decisions, {exportPreview.included.facts.length} verified findings, {exportPreview.included.evidence.length} evidence references, {exportPreview.included.tasks.length} work items.</p>
            <p><b>Excluded:</b> {exportPreview.excluded.assumptionsAndInferences.length} assumptions/inferences, {exportPreview.excluded.taintedEntries.length} tainted entries, {exportPreview.excluded.privateEvidence.length} private-surface sources, {exportPreview.excluded.openEscalations.length} open escalations, and the audit chain (always).</p>
            <ul className="room-list">
              {exportPreview.excluded.privateEvidence.map((r) => (
                <li key={r.id}><span className="chip">{r.sourceKind}</span> {r.title || '(untitled)'} <span className="dim">— stays internal</span></li>
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
            <button className="btn primary small" onClick={downloadExport}>Download client-safe HTML</button>
          </div>
        ) : null}
        {activity !== null ? (
          <ul className="room-list room-activity">
            {activity.length === 0 ? <li className="dim">No activity yet.</li> : activity.map((a) => (
              <li key={a.id}><span className="chip">{a.type}</span> {short(formatRunEventPreview(a, 'room'), 120)} <span className="dim mono">· {timeAgo(a.ts)}</span></li>
            ))}
          </ul>
        ) : (
          <RoomBrief built={built} onOpenRun={onOpenRun} />
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
      {isOwner ? (
        <form className="room-create" onSubmit={create}>
          <label htmlFor="room-name" className="sr-only-label">Room name</label>
          <input id="room-name" value={name} placeholder="Room name — e.g. Acme renewal" onChange={(e) => setName(e.target.value)} />
          <select aria-label="Room type" value={roomType} onChange={(e) => setRoomType(e.target.value)}>
            {ROOM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
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
          <button className="btn primary" type="submit" disabled={busy || !name.trim()}>{busy ? 'Creating…' : 'Create room'}</button>
        </form>
      ) : null}
      {rooms === null ? <div className="empty-hint">loading…</div> : null}
      <div className="room-cards">
        {(rooms || []).map((r) => (
          <button key={r.id} className="room-card" onClick={() => open(r.id)}>
            <b>{r.name}</b>
            <span className="chip">{r.roomType}</span>
            <span className="dim mono">{r.refreshedAt ? `refreshed ${timeAgo(r.refreshedAt)}` : 'never refreshed'}</span>
          </button>
        ))}
        {rooms !== null && rooms.length === 0 ? <p className="dim">No rooms yet{isOwner ? ' — create the first one above.' : '.'}</p> : null}
      </div>
      {archived.length ? <p className="dim">{archived.length} archived room{archived.length === 1 ? '' : 's'}</p> : null}
    </div>
  );
}
