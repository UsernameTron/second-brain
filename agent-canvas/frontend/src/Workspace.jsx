import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppCtx } from './App.jsx';
import { api, wsUrl, normEsc, normHandoff, fmtUSD, initials } from './api.js';
import Canvas from './Canvas.jsx';
import Tray from './Tray.jsx';
import ActivityDock from './ActivityDock.jsx';
import CommandBar from './CommandBar.jsx';
import MemoryPanel from './MemoryPanel.jsx';
import Workbook from './Workbook.jsx';
import { AgentPanel, NotePanel, SpendPanel } from './Panels.jsx';
import AdminModal from './AdminModal.jsx';

let liveSeq = 0;

export default function Workspace() {
  const { user, setUser, toast } = useContext(AppCtx);
  const isOwner = user.role === 'owner';

  const [canvases, setCanvases] = useState([]);
  const [canvasId, setCanvasId] = useState(null);
  const [state, setState] = useState(null); // full GET /api/canvases/:id payload
  const [memory, setMemory] = useState([]);
  const [showSuperseded, setShowSuperseded] = useState(false);
  const [activity, setActivity] = useState([]);
  const [escalations, setEscalations] = useState([]);
  const [spend, setSpend] = useState(null);
  const [budget, setBudget] = useState(null);
  const [pause, setPause] = useState({ paused: false, by: null });
  const [presence, setPresence] = useState([]);
  const [cursors, setCursors] = useState({});
  const [selections, setSelections] = useState({});
  const [mySelection, setMySelection] = useState(null);
  const [panel, setPanel] = useState(null); // {type, ...}
  const [ripple, setRipple] = useState(null); // {flash, ids:Set}
  const [amberAgents, setAmberAgents] = useState(() => new Set());
  const [hoverHandoffId, setHoverHandoffId] = useState(null);
  const [wsOk, setWsOk] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const wsRef = useRef(null);
  const canvasIdRef = useRef(null);
  const memoryRef = useRef(memory);
  const showSupersededRef = useRef(showSuperseded);
  const everConnectedRef = useRef(false);
  const refetchTimerRef = useRef(null);
  const spendTimerRef = useRef(null);
  const handlerRef = useRef(() => {});
  memoryRef.current = memory;
  showSupersededRef.current = showSuperseded;

  const send = useCallback((msg) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  // ---------- loaders ----------
  const loadState = useCallback(async (cid) => {
    const d = await api(`/api/canvases/${cid}`);
    if (canvasIdRef.current !== cid) return;
    setState(d);
    if (d.budget) {
      setBudget(d.budget);
      setPause((p) => ({ ...p, paused: !!d.budget.paused }));
    }
  }, []);

  const loadMemory = useCallback(async (cid, incl) => {
    const d = await api(`/api/canvases/${cid}/memory${incl ? '?include_superseded=1' : ''}`);
    if (canvasIdRef.current !== cid) return;
    setMemory(d.entries || []);
  }, []);

  const loadActivity = useCallback(async (cid) => {
    const d = await api(`/api/canvases/${cid}/activity?limit=300`);
    if (canvasIdRef.current !== cid) return;
    setActivity(d.events || []);
  }, []);

  const loadSpend = useCallback(async (cid) => {
    const d = await api(`/api/canvases/${cid}/spend`);
    if (canvasIdRef.current !== cid) return;
    setSpend(d);
    if (d.daily) setBudget(d.daily);
  }, []);

  const loadEscalations = useCallback(async () => {
    const d = await api('/api/escalations');
    setEscalations((d.escalations || []).map(normEsc).filter((e) => e.status === 'open'));
  }, []);

  const refreshAll = useCallback(() => {
    const cid = canvasIdRef.current;
    if (!cid) return;
    Promise.allSettled([
      loadState(cid),
      loadMemory(cid, showSupersededRef.current),
      loadActivity(cid),
      loadSpend(cid),
      loadEscalations(),
    ]).then((results) => {
      const failed = results.find((r) => r.status === 'rejected');
      if (failed) toast(failed.reason?.message || 'refresh failed');
    });
  }, [loadState, loadMemory, loadActivity, loadSpend, loadEscalations, toast]);

  const scheduleRefetch = useCallback(() => {
    clearTimeout(refetchTimerRef.current);
    refetchTimerRef.current = setTimeout(() => {
      const cid = canvasIdRef.current;
      if (cid) loadState(cid).catch((e) => toast(e.message));
    }, 450);
  }, [loadState, toast]);

  const scheduleSpend = useCallback(() => {
    clearTimeout(spendTimerRef.current);
    spendTimerRef.current = setTimeout(() => {
      const cid = canvasIdRef.current;
      if (cid) loadSpend(cid).catch(() => {});
    }, 1200);
  }, [loadSpend]);

  // ---------- boot: canvases + control status ----------
  useEffect(() => {
    api('/api/canvases')
      .then((d) => {
        setCanvases(d.canvases || []);
        if (d.canvases && d.canvases.length) setCanvasId(d.canvases[0].id);
      })
      .catch((e) => toast(e.message));
    api('/api/control/status')
      .then((d) => { setBudget(d); setPause((p) => ({ ...p, paused: !!d.paused })); })
      .catch(() => {});
  }, [toast]);

  // ---------- canvas switch ----------
  useEffect(() => {
    if (!canvasId) return;
    canvasIdRef.current = canvasId;
    setState(null); setMemory([]); setActivity([]); setSpend(null);
    setCursors({}); setSelections({}); setPanel(null); setMySelection(null);
    refreshAll();
    send({ type: 'join', canvasId });
  }, [canvasId, refreshAll, send]);

  // ---------- live event reduction ----------
  const pushActivity = useCallback((item) => {
    setActivity((prev) => [{ id: `live-${++liveSeq}`, ts: new Date().toISOString(), ...item }, ...prev].slice(0, 600));
  }, []);

  const markEscalationLeaving = useCallback((id) => {
    setEscalations((prev) => prev.map((e) => (e.id === id ? { ...e, leaving: true } : e)));
    setTimeout(() => setEscalations((prev) => prev.filter((e) => e.id !== id)), 420);
  }, []);

  handlerRef.current = (ev) => {
    if (!ev || !ev.type) return;
    if (ev.canvasId && ev.canvasId !== canvasIdRef.current &&
        !['pause_state', 'budget', 'escalation', 'escalation_resolved'].includes(ev.type)) return;
    switch (ev.type) {
      case 'presence': {
        const users = ev.users || [];
        setPresence(users);
        const emails = new Set(users.map((u) => u.email));
        setCursors((prev) => {
          const next = {};
          for (const k of Object.keys(prev)) if (emails.has(k)) next[k] = prev[k];
          return next;
        });
        setSelections((prev) => {
          const next = {};
          for (const k of Object.keys(prev)) if (emails.has(k)) next[k] = prev[k];
          return next;
        });
        break;
      }
      case 'cursor':
        if (ev.email === user.email) break;
        setCursors((prev) => ({ ...prev, [ev.email]: { x: ev.x, y: ev.y, name: ev.name, color: ev.color, ts: Date.now() } }));
        break;
      case 'selection':
        if (ev.email === user.email) break;
        setSelections((prev) => ({ ...prev, [ev.email]: { color: ev.color, ids: ev.ids || [] } }));
        break;
      case 'node_move':
        if (ev.by === user.email) break;
        applyMove(ev.kind, ev.id, ev.x, ev.y);
        break;
      case 'agent_status':
        setState((s) => s && ({ ...s, agents: s.agents.map((a) => (a.id === ev.agentId ? { ...a, status: ev.status } : a)) }));
        break;
      case 'run_status':
        setState((s) => {
          if (!s) return s;
          if (!s.runs.some((r) => r.id === ev.runId)) { scheduleRefetch(); return s; }
          return {
            ...s,
            runs: s.runs.map((r) => (r.id === ev.runId
              ? { ...r, status: ev.status, summary: ev.summary !== undefined ? ev.summary : r.summary, error: ev.error !== undefined ? ev.error : r.error }
              : r)),
          };
        });
        scheduleSpend();
        break;
      case 'run_event':
        pushActivity({ agent_id: ev.agentId, run_id: ev.runId, type: ev.eventType, payload: ev.payload });
        break;
      case 'memory_write': {
        const entry = ev.entry;
        if (!entry) break;
        setMemory((prev) => [entry, ...prev.filter((e) => e.id !== entry.id)]);
        pushActivity({ agent_id: entry.author?.type === 'agent' ? entry.author.id : null, type: 'memory', payload: entry, ts: entry.createdAt });
        break;
      }
      case 'memory_ripple': {
        const { entry, supersededId, affected = [] } = ev;
        const affectedSet = new Set(affected);
        const authors = new Set(
          memoryRef.current
            .filter((e) => affectedSet.has(e.id) && e.author?.type === 'agent')
            .map((e) => e.author.id)
        );
        setMemory((prev) => {
          const rest = prev.filter((e) => e.id !== entry.id).map((e) => {
            if (e.id === supersededId) return { ...e, supersededBy: entry.id };
            if (affectedSet.has(e.id)) return { ...e, tainted: true };
            return e;
          });
          return [entry, ...rest];
        });
        setRipple({ flash: entry.id, ids: affectedSet });
        setAmberAgents(authors);
        setTimeout(() => { setRipple(null); setAmberAgents(new Set()); }, 2400);
        pushActivity({ agent_id: entry.author?.type === 'agent' ? entry.author.id : null, type: 'memory', payload: { ...entry, content: `CORRECTED: ${entry.content}` }, ts: entry.createdAt });
        break;
      }
      case 'handoff': {
        if (!ev.handoff) break;
        setState((s) => s && ({ ...s, handoffs: [ev.handoff, ...s.handoffs.filter((h) => h.id !== ev.handoff.id)] }));
        break;
      }
      case 'escalation': {
        if (!ev.escalation) break;
        const e = normEsc(ev.escalation);
        setEscalations((prev) => [e, ...prev.filter((x) => x.id !== e.id)]);
        pushActivity({ agent_id: e.agent_id, type: 'escalation', payload: { kind: e.kind, question: e.question } });
        break;
      }
      case 'escalation_resolved':
        markEscalationLeaving(ev.escalationId);
        break;
      case 'rows_changed':
      case 'changeset':
      case 'canvas_structure':
        scheduleRefetch();
        break;
      case 'note_update':
        setState((s) => {
          if (!s) return s;
          if (!s.notes.some((n) => n.id === ev.note.id)) { scheduleRefetch(); return s; }
          return { ...s, notes: s.notes.map((n) => (n.id === ev.note.id ? ev.note : n)) };
        });
        break;
      case 'pause_state':
        setPause({ paused: !!ev.paused, by: ev.by || null });
        break;
      case 'budget':
        if (ev.usage) {
          setBudget(ev.usage);
          setPause((p) => ({ ...p, paused: !!ev.usage.paused }));
        }
        scheduleSpend(); // keep per-agent spend live
        break;
      default:
        break;
    }
  };

  function applyMove(kind, id, x, y) {
    const key = { agent: 'agents', note: 'notes', task: 'tasks', file: 'files' }[kind];
    if (!key) return;
    setState((s) => s && ({ ...s, [key]: s[key].map((n) => (n.id === id ? { ...n, x, y } : n)) }));
  }

  // ---------- websocket with backoff ----------
  useEffect(() => {
    let stopped = false;
    let attempts = 0;
    let timer = null;
    const connect = () => {
      let ws;
      try { ws = new WebSocket(wsUrl()); } catch { scheduleReconnect(); return; }
      wsRef.current = ws;
      ws.onopen = () => {
        attempts = 0;
        setWsOk(true);
        if (canvasIdRef.current) {
          ws.send(JSON.stringify({ type: 'join', canvasId: canvasIdRef.current }));
          if (everConnectedRef.current) refreshAll(); // re-sync after a drop
        }
        everConnectedRef.current = true;
      };
      ws.onmessage = (e) => {
        try { handlerRef.current(JSON.parse(e.data)); } catch { /* ignore malformed frames */ }
      };
      ws.onclose = () => { setWsOk(false); if (!stopped) scheduleReconnect(); };
      ws.onerror = () => { try { ws.close(); } catch { /* noop */ } };
    };
    const scheduleReconnect = () => {
      clearTimeout(timer);
      timer = setTimeout(connect, Math.min(8000, 500 * 2 ** Math.min(attempts++, 4)));
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      if (wsRef.current) { try { wsRef.current.close(); } catch { /* noop */ } }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // prune stale cursors
  useEffect(() => {
    const t = setInterval(() => {
      setCursors((prev) => {
        const now = Date.now();
        let changed = false;
        const next = {};
        for (const [k, v] of Object.entries(prev)) {
          if (now - v.ts < 12000) next[k] = v; else changed = true;
        }
        return changed ? next : prev;
      });
    }, 5000);
    return () => clearInterval(t);
  }, []);

  // ---------- actions ----------
  const dispatchToAgent = useCallback(async (agentId, instruction) => {
    const d = await api(`/api/canvases/${canvasIdRef.current}/agents/${agentId}/dispatch`, { method: 'POST', body: { instruction } });
    setState((s) => s && ({ ...s, runs: [d.run, ...s.runs] }));
    return d.run;
  }, []);

  const resolveEscalation = useCallback(async (id, body) => {
    try {
      await api(`/api/escalations/${id}/resolve`, { method: 'POST', body });
      markEscalationLeaving(id);
      toast(body.action === 'dismiss' ? 'Dismissed' : 'Decision sent back to the agent', 'ok');
    } catch (e) {
      toast(e.message);
    }
  }, [markEscalationLeaving, toast]);

  const saveNote = useCallback(async (note, draft) => {
    const d = await api(`/api/canvases/${canvasIdRef.current}/notes/${note.id}`, {
      method: 'PUT',
      body: {
        title: draft.title,
        content: draft.content,
        pinned: draft.pinned,
        base_version: note.version,
        base_content: note.content,
      },
    });
    setState((s) => s && ({ ...s, notes: s.notes.map((n) => (n.id === d.note.id ? d.note : n)) }));
    if (d.merged) toast('Someone edited this note at the same time — both edits were merged.', 'warn');
    return d;
  }, [toast]);

  const correctEntry = useCallback(async (entryId, body) => {
    try {
      await api(`/api/canvases/${canvasIdRef.current}/memory/${entryId}/correct`, { method: 'POST', body });
      toast('Correction recorded — ripple incoming', 'ok');
    } catch (e) {
      if (e.status === 409) toast('Correction conflict — escalated to a human decision', 'warn');
      else toast(e.message);
    }
  }, [toast]);

  const moveLive = useCallback((kind, id, x, y) => applyMove(kind, id, x, y), []);
  const moveEnd = useCallback((kind, id, x, y) => {
    applyMove(kind, id, x, y);
    api(`/api/canvases/${canvasIdRef.current}/positions`, { method: 'POST', body: { kind, id, x, y } })
      .catch((e) => toast(e.message));
  }, [toast]);

  const selectNode = useCallback((id) => {
    setMySelection(id);
    send({ type: 'selection', ids: id ? [id] : [] });
  }, [send]);

  const openNode = useCallback((kind, obj) => {
    if (kind === 'agent') setPanel({ type: 'agent', id: obj.id });
    else if (kind === 'note') setPanel({ type: 'note', id: obj.id });
    else if (kind === 'task') setPanel({ type: 'note', id: null, taskId: obj.id });
    // files: download link on the node itself
  }, []);

  const sendCursor = useCallback((x, y) => send({ type: 'cursor', x, y }), [send]);

  const toggleSuperseded = useCallback(() => {
    setShowSuperseded((v) => {
      const next = !v;
      if (canvasIdRef.current) loadMemory(canvasIdRef.current, next).catch((e) => toast(e.message));
      return next;
    });
  }, [loadMemory, toast]);

  const pauseAll = useCallback(async () => {
    try { await api('/api/control/pause', { method: 'POST', body: {} }); toast('Workspace paused', 'warn'); }
    catch (e) { toast(e.message); }
  }, [toast]);

  const resumeAll = useCallback(async () => {
    try { await api('/api/control/resume', { method: 'POST', body: {} }); toast('Workspace resumed', 'ok'); }
    catch (e) { toast(e.message); }
  }, [toast]);

  const runCleanup = useCallback(async () => {
    try {
      await api(`/api/canvases/${canvasIdRef.current}/demo/run`, { method: 'POST', body: {} });
      toast('Cleanup dispatched — the research agent is on it', 'ok');
    } catch (e) { toast(e.message); }
  }, [toast]);

  const parseIntent = useCallback(
    (text) => api(`/api/canvases/${canvasIdRef.current}/intent`, { method: 'POST', body: { text } }).then((d) => d.intent),
    []
  );

  const confirmIntent = useCallback(async (intent) => {
    if (intent.action === 'dispatch' && intent.agent_id) {
      await dispatchToAgent(intent.agent_id, intent.instruction || '');
      toast(`Dispatched to ${intent.agent_name || 'agent'}`, 'ok');
      return;
    }
    if (intent.action === 'pause') { await pauseAll(); return; }
    if (intent.action === 'resume') { await resumeAll(); return; }
    throw new Error('Nothing dispatchable in that command');
  }, [dispatchToAgent, pauseAll, resumeAll, toast]);

  const signOut = useCallback(async () => {
    try { await api('/api/auth/logout', { method: 'POST', body: {} }); } catch { /* noop */ }
    setUser(null);
  }, [setUser]);

  const fetchRunEvents = useCallback(
    (runId) => api(`/api/canvases/${canvasIdRef.current}/runs/${runId}/events`).then((d) => d.events || []),
    []
  );

  const openRun = useCallback((runId) => {
    const run = (state?.runs || []).find((r) => r.id === runId);
    if (run) setPanel({ type: 'agent', id: run.agent_id, runId });
    else toast('That run is not in the recent runs list', 'warn');
  }, [state, toast]);

  // ---------- derived ----------
  const agentsById = useMemo(() => {
    const m = {};
    for (const a of state?.agents || []) m[a.id] = a;
    return m;
  }, [state]);

  const handoffs = useMemo(() => (state?.handoffs || []).map(normHandoff), [state]);

  const memoryMap = useMemo(() => {
    const m = new Map();
    for (const e of memory) m.set(e.id, e);
    return m;
  }, [memory]);

  const spendByAgent = useMemo(() => {
    const m = {};
    for (const row of spend?.perAgent || []) m[row.agent_id] = row;
    return m;
  }, [spend]);

  const openEscalations = useMemo(
    () => escalations.filter((e) => e.status === 'open' && (!e.canvas_id || e.canvas_id === canvasId)),
    [escalations, canvasId]
  );

  const budgetPct = budget && budget.budget_usd > 0 ? Math.min(1, (budget.cost_usd || 0) / budget.budget_usd) : 0;

  const setBudgetUsd = useCallback(async (usd) => {
    try {
      await api('/api/control/budget', { method: 'POST', body: { daily_budget_usd: usd } });
      const d = await api('/api/control/status');
      setBudget(d);
      toast('Daily budget updated', 'ok');
    } catch (e) { toast(e.message); }
  }, [toast]);

  // ---------- render ----------
  let sidePanel = null;
  if (panel && state) {
    if (panel.type === 'agent' && agentsById[panel.id]) {
      sidePanel = (
        <AgentPanel
          agent={agentsById[panel.id]}
          runs={(state.runs || []).filter((r) => r.agent_id === panel.id)}
          spendRow={spendByAgent[panel.id]}
          initialRunId={panel.runId || null}
          paused={pause.paused}
          onDispatch={async (instruction) => {
            try { await dispatchToAgent(panel.id, instruction); toast(`Sent to ${agentsById[panel.id].name}`, 'ok'); }
            catch (e) { toast(e.message); }
          }}
          fetchRunEvents={fetchRunEvents}
          onClose={() => setPanel(null)}
        />
      );
    } else if (panel.type === 'note') {
      const note = (state.notes || []).find((n) => n.id === panel.id);
      const task = panel.taskId ? (state.tasks || []).find((t) => t.id === panel.taskId) : null;
      sidePanel = <NotePanel note={note} task={task} onSave={saveNote} onClose={() => setPanel(null)} />;
    } else if (panel.type === 'memory') {
      sidePanel = (
        <MemoryPanel
          entries={memory}
          agentsById={agentsById}
          showSuperseded={showSuperseded}
          onToggleSuperseded={toggleSuperseded}
          ripple={ripple}
          onOpenRun={openRun}
          onCorrect={correctEntry}
          onClose={() => setPanel(null)}
          toast={toast}
        />
      );
    } else if (panel.type === 'workbook') {
      sidePanel = (
        <Workbook
          rows={state.rows || []}
          changesets={state.changesets || []}
          agentsById={agentsById}
          paused={pause.paused}
          onRunCleanup={runCleanup}
          onClose={() => setPanel(null)}
        />
      );
    } else if (panel.type === 'spend') {
      sidePanel = (
        <SpendPanel
          spend={spend}
          budget={budget}
          isOwner={isOwner}
          onSetBudget={setBudgetUsd}
          onClose={() => setPanel(null)}
        />
      );
    }
  }

  return (
    <div className="workspace">
      <header className="topbar">
        <div className="brand">
          <span className="brand-glyph" />
          Agent&nbsp;Canvas
        </div>
        <select
          className="canvas-switch"
          value={canvasId || ''}
          onChange={(e) => setCanvasId(e.target.value)}
          title="Switch canvas"
        >
          {canvases.length === 0 ? <option value="">no canvases</option> : null}
          {canvases.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <div className="topbar-spacer" />
        {!wsOk ? <span className="ws-pip" title="Live connection lost — reconnecting"><span className="ws-dot" />reconnecting</span> : null}
        <button
          className={`budget-meter ${budgetPct > 0.9 ? 'over' : ''}`}
          onClick={() => setPanel({ type: 'spend' })}
          title="Today's spend vs daily budget — click for the spend panel"
        >
          <span className="budget-bar"><span className="budget-fill" style={{ width: `${budgetPct * 100}%` }} /></span>
          <span className="mono budget-label">
            {budget ? `${fmtUSD(budget.cost_usd)} / ${fmtUSD(budget.budget_usd)}` : '$ — / —'}
          </span>
        </button>
        <button className={`btn ghost ${panel?.type === 'memory' ? 'active' : ''}`} onClick={() => setPanel(panel?.type === 'memory' ? null : { type: 'memory' })}>Memory</button>
        <button className={`btn ghost ${panel?.type === 'workbook' ? 'active' : ''}`} onClick={() => setPanel(panel?.type === 'workbook' ? null : { type: 'workbook' })}>Workbook</button>
        {pause.paused
          ? (isOwner ? <button className="btn ok" onClick={resumeAll}>Resume</button> : <span className="chip paused-chip">paused</span>)
          : <button className="btn danger" onClick={pauseAll} title="Emergency stop — halts every agent">Pause</button>}
        <div className="presence-stack" title={presence.map((p) => p.name).join(', ')}>
          {presence.slice(0, 6).map((p) => (
            <span key={p.email} className="avatar" style={{ background: p.color }} title={`${p.name} (${p.email})`}>
              {initials(p.name)}
            </span>
          ))}
          {presence.length > 6 ? <span className="avatar more">+{presence.length - 6}</span> : null}
        </div>
        <div className="user-menu-wrap">
          <button className="avatar me" onClick={() => setMenuOpen((v) => !v)} title={user.email}>
            {user.picture ? <img src={user.picture} alt="" referrerPolicy="no-referrer" /> : initials(user.name || user.email)}
          </button>
          {menuOpen ? (
            <div className="user-menu" onMouseLeave={() => setMenuOpen(false)}>
              <div className="user-menu-id">
                <b>{user.name || user.email}</b>
                <span className="mono">{user.email}</span>
                <span className={`chip role-${user.role}`}>{user.role}</span>
              </div>
              {isOwner ? (
                <>
                  <button onClick={() => { setAdminOpen(true); setMenuOpen(false); }}>Admin — allowlist &amp; audit</button>
                  <a href="/api/export" download>Export workspace JSON</a>
                </>
              ) : null}
              <button onClick={signOut}>Sign out</button>
            </div>
          ) : null}
        </div>
      </header>

      {pause.paused ? (
        <div className="pause-banner">
          <span className="pause-glyph">■</span>
          WORKSPACE PAUSED{pause.by ? ` by ${pause.by}` : ''} — all agents are frozen
          {isOwner ? <button className="btn ok small" onClick={resumeAll}>Resume</button> : null}
        </div>
      ) : null}

      <div className="stage">
        <div className="canvas-wrap">
          {state ? (
            <Canvas
              agents={state.agents || []}
              notes={state.notes || []}
              tasks={state.tasks || []}
              files={state.files || []}
              canvasId={canvasId}
              handoffs={handoffs}
              memoryMap={memoryMap}
              agentsById={agentsById}
              cursors={cursors}
              selections={selections}
              mySelection={mySelection}
              spendByAgent={spendByAgent}
              amberAgents={amberAgents}
              paused={pause.paused}
              hoverHandoffId={hoverHandoffId}
              onOpen={openNode}
              onMoveLive={moveLive}
              onMoveEnd={moveEnd}
              onCursor={sendCursor}
              onSelect={selectNode}
            />
          ) : (
            <div className="stage-loading">
              <div className="boot-glyph" />
              {canvases.length === 0 ? 'No canvases visible to you yet.' : 'Loading canvas…'}
            </div>
          )}

          <Tray escalations={openEscalations} agentsById={agentsById} agents={state?.agents || []} onResolve={resolveEscalation} />

          {sidePanel}

          {state ? (
            <CommandBar paused={pause.paused} onParse={parseIntent} onConfirm={confirmIntent} toast={toast} />
          ) : null}
        </div>

        <ActivityDock
          activity={activity}
          handoffs={handoffs}
          agents={state?.agents || []}
          agentsById={agentsById}
          onHoverHandoff={setHoverHandoffId}
        />
      </div>

      {adminOpen ? <AdminModal onClose={() => setAdminOpen(false)} toast={toast} selfEmail={user.email} /> : null}
    </div>
  );
}
