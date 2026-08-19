import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppCtx } from './App.jsx';
import { api, rulesApi, wsUrl, normEsc, normHandoff, fmtUSD, fmtBytes, initials } from './api.js';
import Canvas from './Canvas.jsx';
import Tray from './Tray.jsx';
import ActivityDock from './ActivityDock.jsx';
import CommandBar from './CommandBar.jsx';
import MemoryPanel from './MemoryPanel.jsx';
import RoomsView from './RoomsView.jsx';
import RulesView from './RulesView.jsx';
import { AgentPanel, NotePanel, SpendPanel } from './Panels.jsx';
import { useDialog } from './useDialog.js';
import Home from './Home.jsx';
import NeedsYouView from './NeedsYouView.jsx';
import AdminModal from './AdminModal.jsx';
import AddAgentModal from './AddAgentModal.jsx';
import CapabilitiesModal from './CapabilitiesModal.jsx';
import { TEAM_TEMPLATES, rosterIdsForTeam, teamIdForRosterSelection } from './teamTemplates.js';

let liveSeq = 0;

const FILE_ACCEPT = '.pdf,.docx,.txt,.md,.csv,.json,.xlsx';
const FILE_LIMIT_BYTES = 5 * 1024 * 1024;
const FILE_MIME = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

function fileExtension(name) {
  const match = String(name || '').toLowerCase().match(/\.[^.]+$/);
  return match ? match[0] : '';
}

// encodeURIComponent deliberately leaves a few punctuation characters alone,
// while api() only permits percent-encoded query values. Encode those last
// characters too so a valid filename can never be rejected as an API path.
function encodeFileName(name) {
  return encodeURIComponent(String(name)).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

export default function Workspace() {
  const { user, setUser, toast, theme, setTheme } = useContext(AppCtx);
  const isOwner = user.role === 'owner';

  const [canvases, setCanvases] = useState([]);
  const [canvasesLoaded, setCanvasesLoaded] = useState(false);
  const [archivedCanvases, setArchivedCanvases] = useState([]);
  const [newCanvasOpen, setNewCanvasOpen] = useState(false);
  const [newCanvasName, setNewCanvasName] = useState('');
  const [roster, setRoster] = useState([]);
  const [rosterChecked, setRosterChecked] = useState(null); // null until roster loads
  const enabledRoster = useMemo(() => roster.filter((entry) => entry.enabled), [roster]);
  const availableTeams = useMemo(
    () => TEAM_TEMPLATES.filter((team) => rosterIdsForTeam(team.id, roster).length > 0),
    [roster],
  );
  const selectedTeamId = useMemo(
    () => teamIdForRosterSelection(rosterChecked, roster),
    [roster, rosterChecked],
  );
  const selectedTeam = availableTeams.find((team) => team.id === selectedTeamId);
  const selectedRosterMembers = useMemo(
    () => enabledRoster.filter((entry) => rosterChecked && rosterChecked.has(entry.id)),
    [enabledRoster, rosterChecked],
  );
  const [addAgentOpen, setAddAgentOpen] = useState(false);
  const [addPersonOpen, setAddPersonOpen] = useState(false);
  const [newPersonEmail, setNewPersonEmail] = useState('');
  const fileInputRef = useRef(null);
  const [fileUpload, setFileUpload] = useState({ kind: 'idle', message: '' });
  const [canvasId, setCanvasId] = useState(null);
  const [state, setState] = useState(null); // full GET /api/canvases/:id payload
  const [memory, setMemory] = useState([]);
  const [showSuperseded, setShowSuperseded] = useState(false);
  const [activity, setActivity] = useState([]);
  const [escalations, setEscalations] = useState([]);
  const [attention, setAttention] = useState(null); // P2 NEEDS YOU projection (current canvas)
  const [spend, setSpend] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [budget, setBudget] = useState(null);
  const [pause, setPause] = useState({ paused: false, by: null });
  const [presence, setPresence] = useState([]);
  const [cursors, setCursors] = useState({});
  const [selections, setSelections] = useState({});
  const [mySelection, setMySelection] = useState(null);
  const [panel, setPanel] = useState(null); // {type, ...}
  // P1 Inquiry Home: 'home' | 'canvas'. Default comes from the server's
  // inquiry_home flag (reversible exposure — flip the setting, no deploy).
  const { config } = useContext(AppCtx);
  const [view, setView] = useState(config && config.inquiryHome ? 'home' : 'canvas');
  // P2 unified NEEDS YOU: view 'needsyou' + Tray collapsed to its badge.
  // Reversible exposure: setSetting('needs_you','0') restores the inline tray.
  const needsYouOn = !!(config && config.needsYou);
  const roomsOn = !!(config && config.rooms);
  // P5 reversible exposure: setSetting('standing_rules','0') hides Rules & Briefs.
  const rulesOn = !!(config && config.standingRules);
  // Rule a NEEDS YOU card asked to open; RulesView mounts straight onto it.
  const [ruleFocusId, setRuleFocusId] = useState(null);
  const [runTick, setRunTick] = useState(0); // bumps on run_status → Home refetch
  const [ripple, setRipple] = useState(null); // {flash, ids:Set}
  const [amberAgents, setAmberAgents] = useState(() => new Set());
  const [hoverHandoffId, setHoverHandoffId] = useState(null);
  const [wsOk, setWsOk] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [capsOpen, setCapsOpen] = useState(false);
  const [wsConnected, setWsConnected] = useState(null); // null = unknown yet
  const [health, setHealth] = useState(null);
  const [healthDown, setHealthDown] = useState(false);
  const refreshHealth = useCallback(() => {
    api('/api/health/integrations')
      .then((d) => { setHealth(d); setHealthDown(false); })
      .catch(() => setHealthDown(true));
  }, []);
  useEffect(() => {
    refreshHealth();
    const t = setInterval(refreshHealth, 60_000);
    return () => clearInterval(t);
  }, [refreshHealth]);
  const refreshCaps = useCallback(() => {
    api('/api/capabilities').then((d) => setWsConnected(!!d.connected)).catch(() => {});
  }, []);
  useEffect(() => { refreshCaps(); }, [refreshCaps]);
  useEffect(() => {
    const ws = new URLSearchParams(window.location.search).get('ws');
    if (!ws) return;
    window.history.replaceState({}, '', window.location.pathname);
    if (ws === 'connected') { toast('Google Workspace connected — agents you direct can now use it', 'ok'); refreshCaps(); setCapsOpen(true); }
    else if (ws === 'blocked') {
      toast('Google blocked the connection: this account is not on the app\'s test-user list. Owner: Google Auth Platform → Audience → add the account as a test user (as the project-owner Google identity), wait ~2 minutes, retry. Or deploy with GOOGLE_WORKSPACE_SCOPES=standard to skip the tester gate (no Gmail).');
      setCapsOpen(true);
    }
    else if (ws === 'denied') { toast('Workspace connection was cancelled before granting access'); }
  }, [refreshCaps, toast]);
  const [menuOpen, setMenuOpen] = useState(false);
  // Modals opened from the user menu unmount their opener with the menu —
  // hand focus back to the avatar when they close.
  const avatarRef = useRef(null);

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
    // Analytics rides the same refresh cadence; failure never blocks spend.
    api(`/api/canvases/${cid}/analytics`)
      .then((a) => { if (canvasIdRef.current === cid) setAnalytics(a); })
      .catch(() => {});
  }, []);

  const loadEscalations = useCallback(async () => {
    const cid = canvasIdRef.current;
    const d = await api('/api/escalations');
    if (!cid || canvasIdRef.current !== cid) return;
    setEscalations((d.escalations || []).map(normEsc).filter((e) => e.status === 'open'));
  }, []);

  // P2: the attention projection for the current canvas (badge + NEEDS YOU
  // view share this one fetch). Failure never blocks the escalation tray.
  const loadAttention = useCallback(async () => {
    const cid = canvasIdRef.current;
    if (!cid) return;
    try {
      const d = await api(`/api/attention?canvas_id=${encodeURIComponent(cid)}`);
      if (canvasIdRef.current === cid) setAttention(d.attention || []);
    } catch { /* projection only — tray still works */ }
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
      loadAttention(),
    ]).then((results) => {
      const failed = results.find((r) => r.status === 'rejected');
      if (failed) toast(failed.reason?.message || 'refresh failed');
    });
  }, [loadState, loadMemory, loadActivity, loadSpend, loadEscalations, loadAttention, toast]);

  const scheduleRefetch = useCallback(() => {
    clearTimeout(refetchTimerRef.current);
    refetchTimerRef.current = setTimeout(() => {
      const cid = canvasIdRef.current;
      if (cid) loadState(cid).catch((e) => toast(e.message));
    }, 450);
  }, [loadState, toast]);

  // Attention rides its own debounce: run/memory/escalation events
  // all feed the projection, and a burst should cost one refetch.
  const attentionTimerRef = useRef(null);
  const scheduleAttention = useCallback(() => {
    clearTimeout(attentionTimerRef.current);
    attentionTimerRef.current = setTimeout(() => { loadAttention(); }, 600);
  }, [loadAttention]);

  const scheduleSpend = useCallback(() => {
    clearTimeout(spendTimerRef.current);
    spendTimerRef.current = setTimeout(() => {
      const cid = canvasIdRef.current;
      if (cid) loadSpend(cid).catch(() => {});
    }, 1200);
  }, [loadSpend]);

  // ---------- canvas lifecycle: create + archive/restore ----------
  // Archive is reversible by design (destroy-never): no confirm dialog needed.
  const refreshCanvases = useCallback(async () => {
    const d = await api('/api/canvases');
    setCanvases(d.canvases || []);
    setArchivedCanvases(d.archived || []);
    setCanvasesLoaded(true);
    return d;
  }, []);

  const createCanvas = useCallback(async () => {
    const name = newCanvasName.trim();
    if (!name) { setNewCanvasOpen(false); setNewCanvasName(''); return; }
    try {
      const rosterIds = [...(rosterChecked || [])].filter((id) => roster.some((r) => r.id === id && r.enabled));
      const d = await api('/api/canvases', { method: 'POST', body: { name, roster_ids: rosterIds } });
      await refreshCanvases();
      setCanvasId(d.canvas.id);
      setNewCanvasOpen(false);
      setNewCanvasName('');
    } catch (e) { toast(e.message); }
  }, [newCanvasName, roster, rosterChecked, refreshCanvases, toast]);

  const archiveCanvas = useCallback(async () => {
    if (!canvasId) return;
    try {
      await api(`/api/canvases/${canvasId}`, { method: 'PATCH', body: { archived: true } });
      const d = await refreshCanvases();
      // The current canvas just left the active list — land on the first
      // remaining one (or the empty state). It stays reachable from the
      // Archived canvases list in the user menu.
      const next = (d.canvases || [])[0];
      setCanvasId(next ? next.id : null);
    } catch (e) { toast(e.message); }
  }, [canvasId, refreshCanvases, toast]);

  const restoreCanvas = useCallback(async (id) => {
    try {
      await api(`/api/canvases/${id}`, { method: 'PATCH', body: { archived: false } });
      await refreshCanvases();
      setCanvasId(id);
      setArchivedOpen(false);
      toast('Canvas restored', 'ok');
    } catch (e) { toast(e.message); }
  }, [refreshCanvases, toast]);

  // ---------- roster (workspace template library) ----------
  const refreshRoster = useCallback(async () => {
    try {
      const d = await api('/api/roster');
      const entries = d.roster || [];
      setRoster(entries);
      setRosterChecked((prev) => prev ?? new Set(entries.filter((r) => r.default_on).map((r) => r.id)));
    } catch { /* roster endpoint unavailable - creation still works, unstaffed */ }
  }, []);
  useEffect(() => { refreshRoster(); }, [refreshRoster]);

  // ---------- boot: canvases + control status ----------
  useEffect(() => {
    api('/api/canvases')
      .then((d) => {
        setCanvases(d.canvases || []);
        setArchivedCanvases(d.archived || []);
        if (d.canvases && d.canvases.length) setCanvasId(d.canvases[0].id);
      })
      .catch((e) => toast(e.message))
      .finally(() => setCanvasesLoaded(true));
    api('/api/control/status')
      .then((d) => { setBudget(d); setPause((p) => ({ ...p, paused: !!d.paused })); })
      .catch(() => {});
  }, [toast]);

  // ---------- canvas switch ----------
  useEffect(() => {
    clearTimeout(refetchTimerRef.current);
    clearTimeout(spendTimerRef.current);
    clearTimeout(attentionTimerRef.current);
    if (!canvasId) {
      canvasIdRef.current = null;
      setState(null);
      setMemory([]);
      setShowSuperseded(false);
      setActivity([]);
      setEscalations([]);
      setAttention(null);
      setSpend(null);
      setAnalytics(null);
      setPresence([]);
      setCursors({});
      setSelections({});
      setMySelection(null);
      setPanel(null);
      setRuleFocusId(null);
      setRunTick(0);
      setRipple(null);
      setAmberAgents(new Set());
      setHoverHandoffId(null);
      setFileUpload({ kind: 'idle', message: '' });
      setView((current) => (['home', 'needsyou', 'rules'].includes(current) ? 'canvas' : current));
      return;
    }
    canvasIdRef.current = canvasId;
    setState(null); setMemory([]); setActivity([]); setSpend(null); setAnalytics(null);
    setEscalations([]); setPresence([]); setRunTick(0);
    setFileUpload({ kind: 'idle', message: '' });
    setAttention(null); // stale cards carry old-canvas sourceRefs — never keep them across a switch
    setCursors({}); setSelections({}); setPanel(null); setMySelection(null);
    setRuleFocusId(null); setRipple(null); setAmberAgents(new Set()); setHoverHandoffId(null);
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
      case 'agent_removed':
        setState((s) => s && ({ ...s, agents: (s.agents || []).filter((a) => a.id !== ev.agentId) }));
        setPanel((current) => (current?.type === 'agent' && current.id === ev.agentId ? null : current));
        break;
      case 'run_status':
        setRunTick((t) => t + 1);
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
        scheduleAttention(); // terminal failures surface as attention cards
        break;
      case 'run_event':
        pushActivity({ agent_id: ev.agentId, run_id: ev.runId, type: ev.eventType, payload: ev.payload });
        break;
      case 'memory_write': {
        const entry = ev.entry;
        if (!entry) break;
        setMemory((prev) => [entry, ...prev.filter((e) => e.id !== entry.id)]);
        pushActivity({ agent_id: entry.author?.type === 'agent' ? entry.author.id : null, type: 'memory', payload: entry, ts: entry.createdAt });
        scheduleAttention(); // new conflicts / reviews can appear
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
        scheduleAttention(); // corrections resolve conflicts / overdue reviews
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
        scheduleAttention();
        break;
      }
      case 'escalation_resolved':
        markEscalationLeaving(ev.escalationId);
        scheduleAttention();
        break;
      case 'canvas_structure':
        scheduleRefetch();
        scheduleAttention();
        break;
      case 'note_update':
        setState((s) => {
          if (!s) return s;
          if (!s.notes.some((n) => n.id === ev.note.id)) { scheduleRefetch(); return s; }
          return { ...s, notes: s.notes.map((n) => (n.id === ev.note.id ? ev.note : n)) };
        });
        break;
      case 'note_removed':
        setState((s) => s && ({ ...s, notes: (s.notes || []).filter((n) => n.id !== ev.noteId) }));
        setPanel((current) => (current?.type === 'note' && current.id === ev.noteId ? null : current));
        break;
      case 'file_removed':
        setState((s) => s && ({ ...s, files: (s.files || []).filter((f) => f.id !== ev.fileId) }));
        setPanel((current) => (current?.type === 'file' && current.id === ev.fileId ? null : current));
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
    const key = { agent: 'agents', note: 'notes', task: 'tasks', file: 'files', person: 'people' }[kind];
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
  const dispatchToAgent = useCallback(async (agentId, instruction, mode) => {
    const body = mode && mode !== 'act' ? { instruction, mode } : { instruction };
    const d = await api(`/api/canvases/${canvasIdRef.current}/agents/${agentId}/dispatch`, { method: 'POST', body });
    setState((s) => s && ({ ...s, runs: [d.run, ...s.runs] }));
    return d.run;
  }, []);

  // P2: assignment routes attention, never resolves it.
  const assignEscalation = useCallback(async (id, body) => {
    try {
      await api(`/api/escalations/${id}/assign`, { method: 'POST', body });
      loadEscalations().catch(() => {});
      loadAttention();
      toast('Assigned', 'ok');
    } catch (e) {
      toast(e.message);
    }
  }, [loadEscalations, loadAttention, toast]);

  const assignTask = useCallback(async (taskId, body) => {
    try {
      await api(`/api/canvases/${canvasIdRef.current}/tasks/${taskId}`, { method: 'PATCH', body });
      scheduleRefetch();
      toast('Assigned', 'ok');
    } catch (e) {
      toast(e.message);
    }
  }, [scheduleRefetch, toast]);

  const addPerson = useCallback(async (email) => {
    try {
      await api(`/api/canvases/${canvasIdRef.current}/people`, { method: 'POST', body: { email } });
      scheduleRefetch();
      toast('Person added to the canvas', 'ok');
      return true;
    } catch (e) {
      toast(e.message);
      return false;
    }
  }, [scheduleRefetch, toast]);

  // P2 NEEDS YOU resolutions — each acts on the SOURCE record's endpoint.
  const retryRun = useCallback(async (sourceRef) => {
    try {
      await api(`/api/canvases/${sourceRef.canvasId}/runs/${sourceRef.id}/retry`, { method: 'POST', body: {} });
      toast('Retry dispatched', 'ok');
      loadAttention();
    } catch (e) {
      toast(e.message);
    }
  }, [loadAttention, toast]);

  // P5: acknowledge a standing-rule run (rule_alert / brief_ready cards).
  const acknowledgeRuleRun = useCallback(async (sourceRef) => {
    try {
      await rulesApi.acknowledge(sourceRef.id);
      toast('Acknowledged', 'ok');
      loadAttention();
    } catch (e) {
      toast(e.message);
    }
  }, [loadAttention, toast]);

  const extendReview = useCallback(async (sourceRef) => {
    // Re-affirm = append-only correction with a fresh date; 30 days is the
    // "still true, check again" horizon, not a policy — correct it to change.
    const reviewAt = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    try {
      await api(`/api/canvases/${sourceRef.canvasId}/memory/${sourceRef.id}/reaffirm`, { method: 'POST', body: { review_at: reviewAt } });
      toast('Re-affirmed — review pushed 30 days', 'ok');
      loadAttention();
    } catch (e) {
      toast(e.message);
    }
  }, [loadAttention, toast]);

  // Dismiss a projected card (conflict / overdue review / failed run) — "not
  // now", persisted server-side; the source record is untouched.
  const dismissAttention = useCallback(async (row) => {
    try {
      await api('/api/attention/dismiss', { method: 'POST', body: { canvas_id: row.sourceRef.canvasId, key: row.dismissKey } });
      toast('Dismissed', 'ok');
      loadAttention();
    } catch (e) {
      toast(e.message);
    }
  }, [loadAttention, toast]);

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

  const createNote = useCallback(async () => {
    if (!state || state.access === 'view' || !canvasIdRef.current) return;
    const cid = canvasIdRef.current;
    const index = (state.notes || []).length;
    try {
      const d = await api(`/api/canvases/${cid}/notes`, {
        method: 'POST',
        body: {
          title: 'Untitled note',
          content: '',
          pinned: false,
          x: 150 + (index % 4) * 260,
          y: 540 + Math.floor(index / 4) * 180,
        },
      });
      setState((s) => (s?.canvas?.id === cid ? {
        ...s, notes: [...(s.notes || []).filter((n) => n.id !== d.note.id), d.note],
      } : s));
      if (canvasIdRef.current === cid) {
        setView('canvas');
        setPanel({ type: 'note', id: d.note.id });
      }
      toast('Note created', 'ok');
    } catch (e) {
      toast(e.message);
    }
  }, [state, toast]);

  const removeNote = useCallback(async (note) => {
    if (!note || state?.access === 'view' || !canvasIdRef.current) return false;
    const cid = canvasIdRef.current;
    try {
      await api(`/api/canvases/${cid}/notes/${note.id}`, { method: 'DELETE' });
      setState((s) => (s?.canvas?.id === cid ? { ...s, notes: (s.notes || []).filter((n) => n.id !== note.id) } : s));
      if (canvasIdRef.current === cid) {
        setPanel((current) => (current?.type === 'note' && current.id === note.id ? null : current));
      }
      toast(note.pinned ? 'Pinned note removed from future agent context' : 'Note removed', 'ok');
      return true;
    } catch (e) {
      toast(e.message);
      return false;
    }
  }, [state?.access, toast]);

  const removeAgent = useCallback(async (agent) => {
    if (!agent || state?.access === 'view' || !canvasIdRef.current) return false;
    const cid = canvasIdRef.current;
    try {
      await api(`/api/canvases/${cid}/agents/${agent.id}`, { method: 'DELETE' });
      setState((s) => (s?.canvas?.id === cid ? { ...s, agents: (s.agents || []).filter((a) => a.id !== agent.id) } : s));
      setPanel((current) => (current?.type === 'agent' && current.id === agent.id ? null : current));
      toast(`${agent.name} removed from this canvas. History was retained.`, 'ok');
      return true;
    } catch (e) {
      toast(e.message);
      return false;
    }
  }, [state?.access, toast]);

  const uploadFile = useCallback(async (event) => {
    const input = event.currentTarget;
    const file = input.files && input.files[0];
    if (!file || !state || state.access === 'view' || !canvasIdRef.current) {
      input.value = '';
      return;
    }

    const ext = fileExtension(file.name);
    if (!Object.hasOwn(FILE_MIME, ext)) {
      setFileUpload({ kind: 'error', message: 'Choose a PDF, Word (.docx), TXT, Markdown, CSV, JSON, or XLSX document.' });
      input.value = '';
      return;
    }
    if (file.size === 0) {
      setFileUpload({ kind: 'error', message: 'That document is empty. Choose one with content.' });
      input.value = '';
      return;
    }
    if (file.size > FILE_LIMIT_BYTES) {
      setFileUpload({ kind: 'error', message: 'That document is over the 5 MB upload limit.' });
      input.value = '';
      return;
    }

    const cid = canvasIdRef.current;
    const index = (state.files || []).length;
    const x = 150 + (index % 4) * 240;
    const y = 840 + Math.floor(index / 4) * 120;
    setFileUpload({ kind: 'busy', message: `Uploading ${file.name}…` });
    try {
      // A File is a Blob: api() sends it as the raw request body, not as
      // multipart form data or a JSON wrapper.
      const d = await api(`/api/canvases/${cid}/files?name=${encodeFileName(file.name)}`, {
        method: 'POST',
        headers: { 'Content-Type': FILE_MIME[ext] },
        body: file,
      });
      if (!d?.file?.id) throw new Error('The upload completed without a document record.');
      const uploaded = {
        ...d.file,
        canvas_id: cid,
        x,
        y,
        uploaded_by: user.email,
        created_at: new Date().toISOString(),
      };
      setState((s) => (s?.canvas?.id === cid ? {
        ...s, files: [...(s.files || []).filter((f) => f.id !== uploaded.id), uploaded],
      } : s));
      if (canvasIdRef.current === cid) {
        setView('canvas');
        setPanel({ type: 'file', id: uploaded.id });
        setFileUpload({ kind: 'success', message: `${file.name} is ready for agents.` });
        toast('Document ready for agents', 'ok');
      } else {
        toast(`${file.name} was added to the canvas where the upload began.`, 'ok');
      }

      // Upload records default to (0, 0). Persist the useful canvas position
      // separately; a placement failure does not undo or hide the upload.
      api(`/api/canvases/${cid}/positions`, {
        method: 'POST', body: { kind: 'file', id: uploaded.id, x, y },
      }).catch(() => toast('Document added, but its canvas position could not be saved.', 'warn'));
    } catch (e) {
      setFileUpload({ kind: 'error', message: e.message || 'Document upload failed.' });
      toast(e.message || 'Document upload failed');
    } finally {
      input.value = '';
    }
  }, [state, toast, user.email]);

  const removeFile = useCallback(async (file) => {
    if (!file || state?.access === 'view' || !canvasIdRef.current) return false;
    const cid = canvasIdRef.current;
    try {
      await api(`/api/canvases/${cid}/files/${file.id}`, { method: 'DELETE' });
      setState((s) => (s?.canvas?.id === cid ? { ...s, files: (s.files || []).filter((f) => f.id !== file.id) } : s));
      if (canvasIdRef.current === cid) {
        setPanel((current) => (current?.type === 'file' && current.id === file.id ? null : current));
        setFileUpload({ kind: 'success', message: `${file.name} removed from this canvas.` });
      }
      toast('Document removed', 'ok');
      return true;
    } catch (e) {
      toast(e.message);
      return false;
    }
  }, [state?.access, toast]);

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

  // Tidy: deterministic pipeline layout. Tasks along the top, agents in role
  // columns ordered research -> coding -> review (other roles after, A-Z),
  // notes then files in rows below. Layout is presentation, not semantics —
  // handoffs and memory never depend on where a node sits.
  const [fitSignal, setFitSignal] = useState(0);
  const arrangeCanvas = useCallback(async () => {
    if (!state) return;
    const ROLE_ORDER = ['research', 'coding', 'review', 'strategic', 'commercial', 'operational', 'workspace'];
    const roles = [...new Set((state.agents || []).map((a) => a.role))].sort((a, b) => {
      const ia = ROLE_ORDER.indexOf(a); const ib = ROLE_ORDER.indexOf(b);
      return (ia === -1 ? 9 : ia) - (ib === -1 ? 9 : ib) || String(a).localeCompare(String(b));
    });
    const moves = [];
    const rowByRole = {};
    for (const a of state.agents || []) {
      const col = roles.indexOf(a.role);
      const row = (rowByRole[a.role] = (rowByRole[a.role] ?? -1) + 1);
      moves.push({ kind: 'agent', id: a.id, x: 150 + col * 340, y: 200 + row * 200 });
    }
    (state.tasks || []).forEach((t, i) => moves.push({ kind: 'task', id: t.id, x: 150 + i * 250, y: 20 }));
    (state.notes || []).forEach((n, i) => moves.push({ kind: 'note', id: n.id, x: 150 + i * 260, y: 640 }));
    (state.files || []).forEach((f, i) => moves.push({ kind: 'file', id: f.id, x: 150 + i * 240, y: 840 }));
    (state.people || []).forEach((p, i) => moves.push({ kind: 'person', id: p.id, x: 150 + i * 240, y: -140 }));
    for (const m of moves) applyMove(m.kind, m.id, m.x, m.y);
    setFitSignal((n) => n + 1);
    try {
      await Promise.all(moves.map((m) => api(`/api/canvases/${canvasIdRef.current}/positions`, { method: 'POST', body: m })));
    } catch (e) { toast(e.message); }
  }, [state, toast]);
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
    else if (kind === 'file') setPanel({ type: 'file', id: obj.id });
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

  const parseIntent = useCallback(
    // Mode rides client-side on the parsed intent — the parse itself is
    // mode-agnostic; the mode only matters at dispatch time.
    (text, mode) => api(`/api/canvases/${canvasIdRef.current}/intent`, { method: 'POST', body: { text } })
      .then((d) => ({ ...d.intent, mode: mode || 'act' })),
    []
  );

  const confirmIntent = useCallback(async (intent) => {
    if (intent.action === 'dispatch' && intent.agent_id) {
      await dispatchToAgent(intent.agent_id, intent.instruction || '', intent.mode);
      toast(`Dispatched to ${intent.agent_name || 'agent'}${intent.mode && intent.mode !== 'act' ? ` (${intent.mode})` : ''}`, 'ok');
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

  const fetchRunReceipt = useCallback(
    (runId) => api(`/api/canvases/${canvasIdRef.current}/runs/${runId}/receipt`),
    []
  );

  const sendRunFeedback = useCallback(
    (runId, verdict, note) => api(`/api/canvases/${canvasIdRef.current}/runs/${runId}/feedback`, {
      method: 'POST', body: { verdict, note },
    }),
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
  const visiblePresence = canvasId ? presence : [];
  const visibleAgents = canvasId ? (state?.agents || []) : [];
  const visibleAttentionCount = canvasId
    ? (needsYouOn ? (attention || []).length : openEscalations.length)
    : 0;
  let sidePanel = null;
  if (canvasId && panel && state) {
    if (panel.type === 'agent' && agentsById[panel.id]) {
      sidePanel = (
        <AgentPanel
          agent={agentsById[panel.id]}
          runs={(state.runs || []).filter((r) => r.agent_id === panel.id)}
          spendRow={spendByAgent[panel.id]}
          initialRunId={panel.runId || null}
          paused={pause.paused}
          canvasId={canvasId}
          onSelectEntry={() => setPanel({ type: 'memory' })}
          onDispatch={async (instruction) => {
            try { await dispatchToAgent(panel.id, instruction); toast(`Sent to ${agentsById[panel.id].name}`, 'ok'); }
            catch (e) { toast(e.message); }
          }}
          onRemove={state.access !== 'view' ? removeAgent : null}
          fetchRunEvents={fetchRunEvents}
          fetchRunReceipt={fetchRunReceipt}
          onFeedback={async (runId, verdict, note) => {
            try { return await sendRunFeedback(runId, verdict, note); }
            catch (e) { toast(e.message); return null; }
          }}
          onClose={() => setPanel(null)}
        />
      );
    } else if (panel.type === 'note') {
      const note = (state.notes || []).find((n) => n.id === panel.id);
      const task = panel.taskId ? (state.tasks || []).find((t) => t.id === panel.taskId) : null;
      sidePanel = (
        <NotePanel
          note={note}
          task={task}
          people={state.people || []}
          agents={state.agents || []}
          pinnedNotes={(state.notes || []).filter((n) => n.id !== note?.id && n.pinned)}
          editable={state.access !== 'view'}
          onAssignTask={state.access !== 'view' ? assignTask : null}
          onSave={saveNote}
          onRemove={removeNote}
          onClose={() => setPanel(null)}
        />
      );
    } else if (panel.type === 'file') {
      const file = (state.files || []).find((f) => f.id === panel.id);
      if (file) {
        sidePanel = (
          <FilePanel
            file={file}
            canvasId={canvasId}
            editable={state.access !== 'view'}
            onRemove={removeFile}
            onClose={() => setPanel(null)}
          />
        );
      }
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
    } else if (panel.type === 'spend') {
      sidePanel = (
        <SpendPanel
          spend={spend}
          analytics={analytics}
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
        {canvases.length > 1 ? (
          <label className="canvas-switch-wrap">
            <span>Canvas</span>
            <select
              className="canvas-switch"
              value={canvasId || ''}
              onChange={(e) => setCanvasId(e.target.value)}
              aria-label="Switch canvas"
            >
              {canvases.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        ) : canvases.length === 1 ? (
          <span className="canvas-current" aria-label={`Current canvas: ${canvases[0].name}`}>
            <span>Canvas</span>
            <strong>{canvases[0].name}</strong>
          </span>
        ) : null}
        {newCanvasOpen ? (
          <div className="canvas-new-pop">
            <input
              className="canvas-new-input"
              autoFocus
              placeholder="New canvas name…"
              value={newCanvasName}
              onChange={(e) => setNewCanvasName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') createCanvas();
                if (e.key === 'Escape') { setNewCanvasOpen(false); setNewCanvasName(''); }
              }}
            />
            {enabledRoster.length ? (
              <fieldset className="canvas-team-picker">
                <legend className="canvas-team-label">Choose a starting team</legend>
                <div className="canvas-team-options">
                  {availableTeams.map((team) => (
                    <button
                      key={team.id}
                      type="button"
                      className={`canvas-team-option ${selectedTeamId === team.id ? 'selected' : ''}`}
                      aria-pressed={selectedTeamId === team.id}
                      onClick={() => setRosterChecked(new Set(rosterIdsForTeam(team.id, roster)))}
                    >
                      <strong>{team.name}</strong>
                      <span>{team.description}</span>
                    </button>
                  ))}
                </div>
                {!selectedTeam ? <p className="canvas-team-description">Custom team selected.</p> : null}
                <div className="canvas-team-members" aria-live="polite">
                  {selectedRosterMembers.map((entry) => (
                    <span className="canvas-team-member" key={entry.id}>
                      <span className="roster-dot" style={{ background: entry.color }} />
                      {entry.name}
                    </span>
                  ))}
                  {selectedRosterMembers.length === 0 ? <span className="dim">No agents selected</span> : null}
                </div>
                <details className="canvas-team-customize">
                  <summary>Customize agents ({selectedRosterMembers.length})</summary>
                  <div className="canvas-new-roster">
                    {enabledRoster.map((r) => (
                      <label key={r.id} className="roster-check">
                        <input
                          type="checkbox"
                          checked={rosterChecked ? rosterChecked.has(r.id) : false}
                          onChange={() => setRosterChecked((prev) => {
                            const next = new Set(prev || []);
                            if (next.has(r.id)) next.delete(r.id); else next.add(r.id);
                            return next;
                          })}
                        />
                        <span className="roster-dot" style={{ background: r.color }} />
                        {r.name} <span className="dim">{r.role === 'enrichment' ? 'lead information' : r.role}</span>
                      </label>
                    ))}
                  </div>
                </details>
              </fieldset>
            ) : null}
            <div className="canvas-new-actions">
              <button className="btn ghost small" onClick={() => { setNewCanvasOpen(false); setNewCanvasName(''); }}>Cancel</button>
              <button className="btn primary small" disabled={!newCanvasName.trim()} onClick={createCanvas}>Create</button>
            </div>
          </div>
        ) : null}
        <button
          className="btn ghost small new-canvas-btn"
          aria-expanded={newCanvasOpen}
          onClick={() => setNewCanvasOpen(true)}
        >New canvas</button>
        {canvasId && state && state.access !== 'view' ? (
          <button className="icon-btn agent-add-btn" title="Add an agent to this canvas" onClick={() => setAddAgentOpen(true)}>+ Agent</button>
        ) : null}
        {canvasId && state && state.access !== 'view' ? (
          addPersonOpen ? (
            <div className="canvas-new-pop">
              <input
                className="canvas-new-input"
                autoFocus
                placeholder="person@cloudtechgurus.com"
                value={newPersonEmail}
                onChange={(e) => setNewPersonEmail(e.target.value)}
                onKeyDown={async (e) => {
                  if (e.key === 'Enter' && newPersonEmail.trim()) {
                    if (await addPerson(newPersonEmail.trim())) { setAddPersonOpen(false); setNewPersonEmail(''); }
                  }
                  if (e.key === 'Escape') { setAddPersonOpen(false); setNewPersonEmail(''); }
                }}
              />
              <div className="canvas-new-actions">
                <button className="btn ghost small" onClick={() => { setAddPersonOpen(false); setNewPersonEmail(''); }}>Cancel</button>
                <button
                  className="btn primary small"
                  disabled={!newPersonEmail.trim()}
                  onClick={async () => { if (await addPerson(newPersonEmail.trim())) { setAddPersonOpen(false); setNewPersonEmail(''); } }}
                >
                  Add
                </button>
              </div>
            </div>
          ) : (
            <button className="icon-btn" title="Add a person card — the email must be on the workspace allowlist" onClick={() => setAddPersonOpen(true)}>+ Person</button>
          )
        ) : null}
        {canvasId && state && state.access !== 'view' ? (
          <button className="icon-btn" title="Add a note to this canvas" onClick={createNote}>+ Note</button>
        ) : null}
        {canvasId && state && state.access !== 'view' ? (
          <>
            <input
              ref={fileInputRef}
              className="file-input-hidden"
              type="file"
              accept={FILE_ACCEPT}
              aria-label="Choose a document to add to this canvas"
              disabled={fileUpload.kind === 'busy'}
              onChange={uploadFile}
            />
            <button
              className="icon-btn"
              aria-label="Upload document"
              title="Upload a PDF, Word (.docx), TXT, Markdown, CSV, JSON, or XLSX document for agents to read (5 MB maximum)"
              disabled={fileUpload.kind === 'busy'}
              aria-describedby={fileUpload.message ? 'file-upload-status' : undefined}
              onClick={() => {
                setFileUpload({ kind: 'idle', message: '' });
                fileInputRef.current?.click();
              }}
            >
              {fileUpload.kind === 'busy' ? 'Uploading…' : '+ Document'}
            </button>
          </>
        ) : null}
        {canvasId && fileUpload.message ? (
          <span
            id="file-upload-status"
            className={`file-upload-status is-${fileUpload.kind}`}
            role={fileUpload.kind === 'error' ? 'alert' : 'status'}
            aria-live={fileUpload.kind === 'error' ? 'assertive' : 'polite'}
            aria-atomic="true"
          >
            {fileUpload.kind === 'busy' ? <progress aria-label="Document upload in progress" /> : null}
            <span>{fileUpload.message}</span>
          </span>
        ) : null}
        {isOwner && canvasId ? (
          <button
            className="icon-btn"
            title="Archive this canvas — reversible, nothing is deleted"
            onClick={archiveCanvas}
          >
            Archive
          </button>
        ) : null}
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
        {canvasId && state ? (
          <button className={`btn ghost ${view === 'home' ? 'active' : ''}`} onClick={() => setView(view === 'home' ? 'canvas' : 'home')}>
            {view === 'home' ? 'Canvas' : 'Home'}
          </button>
        ) : null}
        {canvasId && state && needsYouOn ? (
          <button
            className={`btn ghost ny-btn ${view === 'needsyou' ? 'active' : ''}`}
            onClick={() => setView(view === 'needsyou' ? 'canvas' : 'needsyou')}
            title="Everything waiting on a human — escalations, conflicts, overdue reviews, failed runs, alerts, and briefs"
          >
            Needs you{attention && attention.length ? <span className="tray-badge">{attention.length}</span> : null}
          </button>
        ) : null}
        {roomsOn ? (
          <button className={`btn ghost ${view === 'rooms' ? 'active' : ''}`}
            onClick={() => setView(view === 'rooms' ? 'canvas' : 'rooms')}
            title="Evidence Rooms — one room per deal, client, initiative, or decision">
            Rooms
          </button>
        ) : null}
        {canvasId && state && rulesOn ? (
          <button className={`btn ghost ${view === 'rules' ? 'active' : ''}`}
            onClick={() => { setRuleFocusId(null); setView(view === 'rules' ? 'canvas' : 'rules'); }}
            title="Rules & Briefs — standing instructions that watch, alert, and brief on a cadence">
            Rules
          </button>
        ) : null}
        {canvasId && state ? (
          <button className={`btn ghost ${panel?.type === 'memory' ? 'active' : ''}`} onClick={() => setPanel(panel?.type === 'memory' ? null : { type: 'memory' })}>Memory</button>
        ) : null}
        <button
          className="btn ghost theme-btn"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          title={theme === 'dark' ? 'Switch to the light CTG theme' : 'Switch to the dark bridge console'}
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          <span className="theme-glyph" aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span>
          {theme === 'dark' ? 'Light' : 'Dark'}
        </button>
        <button className="btn ghost caps-btn" onClick={() => setCapsOpen(true)} title={wsConnected ? 'Google Workspace connected — see what agents can and cannot do' : 'Google Workspace not connected — click to see what agents can do and connect'}>
          <span className={`caps-state-dot ${wsConnected ? 'on' : 'off'}`} />
          Capabilities
        </button>
        {pause.paused
          ? (isOwner ? <button className="btn ok" onClick={resumeAll}>Resume</button> : <span className="chip paused-chip">paused</span>)
          : <button className="btn danger" onClick={pauseAll} title="Emergency stop — halts every agent">Pause</button>}
        <div className="presence-stack" title={visiblePresence.filter((p) => p.email !== user.email).map((p) => p.name).join(', ') || 'No one else is here'}>
          {visiblePresence.filter((p) => p.email !== user.email).slice(0, 6).map((p) => (
            <span key={p.email} className="avatar" style={{ background: p.color }} title={`${p.name} (${p.email})`}>
              {initials(p.name)}
            </span>
          ))}
          {visiblePresence.filter((p) => p.email !== user.email).length > 6 ? <span className="avatar more">+{visiblePresence.filter((p) => p.email !== user.email).length - 6}</span> : null}
        </div>
        <div className="user-menu-wrap">
          <button className="avatar me" ref={avatarRef} onClick={() => setMenuOpen((v) => !v)} title={user.email}>
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
                  <button onClick={() => { setArchivedOpen(true); setMenuOpen(false); }}>
                    Archived canvases{archivedCanvases.length ? ` (${archivedCanvases.length})` : ''}
                  </button>
                  <a href="/api/export" download>Export operational ledger (JSON)</a>
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
          {canvasId && state && view === 'home' ? (
            <Home
              canvasId={canvasId}
              agents={state.agents || []}
              agentsById={agentsById}
              paused={pause.paused}
              runTick={runTick}
              onOpenRun={(agentId, runId) => { setView('canvas'); openRun(runId); }}
              toast={toast}
            />
          ) : null}
          {canvasId && state && view === 'needsyou' ? (
            <NeedsYouView
              rows={attention}
              userEmail={user.email}
              agentsById={agentsById}
              people={state.people || []}
              agents={state.agents || []}
              onResolveEscalation={(id, body) => resolveEscalation(id, body).then(() => loadAttention())}
              onAssign={assignEscalation}
              onOpenMemory={() => setPanel({ type: 'memory' })}
              onOpenRun={(ref) => { setView('canvas'); openRun(ref.id); }}
              onRetryRun={retryRun}
              onExtendReview={extendReview}
              onAcknowledgeRuleRun={acknowledgeRuleRun}
              onDismiss={dismissAttention}
              onOpenRule={rulesOn ? (ref) => { setRuleFocusId(ref.ruleId); setView('rules'); } : null}
            />
          ) : null}
          {view === 'rooms' ? (
            <RoomsView
              user={user}
              roster={roster}
              onOpenCanvas={(id) => { setCanvasId(id); setView('canvas'); }}
              onOpenRun={({ canvasId: cid, agentId, runId }) => {
                // The room's canvas may not be the selected one — switch first;
                // the agent panel renders as soon as that canvas state loads.
                if (cid && cid !== canvasId) setCanvasId(cid);
                setView('canvas');
                setPanel({ type: 'agent', id: agentId, runId });
              }}
              toast={toast}
            />
          ) : null}
          {canvasId && state && view === 'rules' ? (
            <RulesView user={user} canvasId={canvasId} agents={state.agents || []} toast={toast} focusRuleId={ruleFocusId} />
          ) : null}
          {canvasId && state && view !== 'home' && view !== 'needsyou' && view !== 'rooms' && view !== 'rules' ? (
            <Canvas
              agents={state.agents || []}
              notes={state.notes || []}
              tasks={state.tasks || []}
              files={state.files || []}
              people={state.people || []}
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
              fitSignal={fitSignal}
              onArrange={arrangeCanvas}
              onCursor={sendCursor}
              onSelect={selectNode}
            />
          ) : null}
          {!canvasId && canvasesLoaded && canvases.length === 0 ? (
            <div className="empty-canvas-cta no-canvases">
              <h2>Start with a canvas</h2>
              <p>Create a focused space for the agents, people, notes, and work that belong together.</p>
              <button className="btn primary" onClick={() => setNewCanvasOpen(true)}>Create a canvas</button>
            </div>
          ) : null}
          {!canvasesLoaded || (canvasId && !state) ? (
            <div className="stage-loading">
              <div className="boot-glyph" />
              Loading canvas…
            </div>
          ) : null}

          {canvasId && state && state.access !== 'view' && (state.agents || []).length === 0 ? (
            <div className="empty-canvas-cta">
              <p>This canvas has no agents yet.</p>
              <button className="btn primary" onClick={() => setAddAgentOpen(true)}>Add your first agent</button>
            </div>
          ) : null}

          {canvasId && state ? (
            <Tray
              escalations={openEscalations}
              agentsById={agentsById}
              agents={state.agents || []}
              people={state.people || []}
              onResolve={resolveEscalation}
              onAssign={assignEscalation}
              badgeOnly={needsYouOn}
              badgeCount={needsYouOn ? (attention || []).length : null}
              onOpen={() => setView('needsyou')}
            />
          ) : null}

          {sidePanel}

          {canvasId && state ? (
            <CommandBar paused={pause.paused} onParse={parseIntent} onConfirm={confirmIntent} toast={toast} />
          ) : null}
        </div>

        <div className="hud" role="status" aria-label="Systems console">
          <button className="hud-cell hud-btn" onClick={() => setCapsOpen(true)}
            title={healthDown ? 'TELEMETRY OFFLINE — the server predates this console or is unreachable. Restart the app (Ctrl+C, npm run dev).' : 'Open the systems board'}>
            <span className={`lamp hexlamp lamp-${healthDown ? 'down' : (health?.aggregate || 'planned')}`} />
            <span className="hud-label">Systems</span>
            {healthDown ? <span className="hud-val mono hud-hot">TELEMETRY OFFLINE — RESTART SERVER</span> : null}
          </button>
          <span className={`hud-cell`} title={health?.integrations?.find((i) => i.id === 'model')?.detail || ''}>
            <span className={`lamp lamp-${health?.integrations?.find((i) => i.id === 'model')?.status || 'planned'}`} />
            <span className="hud-label">Model</span>
            <span className="hud-val mono">{(health?.provider || '—').toUpperCase()}</span>
          </span>
          <span className="hud-cell" title="Google Workspace connection for your account">
            <span className={`lamp lamp-${health?.integrations?.find((i) => i.id === 'gmail')?.status || 'planned'}`} />
            <span className="hud-label">Workspace</span>
          </span>
          <span className="hud-cell" title={wsOk ? 'Live link up' : 'Live link down — reconnecting'}>
            <span className={`lamp ${wsOk ? 'lamp-ready' : 'lamp-down'}`} />
            <span className="hud-label">Link</span>
          </span>
          <span className="hud-sep" />
          <span className="hud-cell" title="One segment per agent — lit green while running, amber waiting, red on error">
            <span className="hud-label">Agents</span>
            <span className="segbar">
              {visibleAgents.slice(0, 12).map((a) => (
                <span key={a.id} className={`seg seg-${a.status || 'idle'}`} title={`${a.name} — ${a.status || 'idle'}`} />
              ))}
              {visibleAgents.length === 0 ? <span className="seg seg-idle" /> : null}
            </span>
          </span>
          <span className="hud-cell">
            <span className="hud-label">Runs</span>
            <span className="hud-val mono">
              {visibleAgents.filter((a) => a.status === 'running').length} act · {health?.queue?.queued ?? '—'} q
            </span>
          </span>
          <span className="hud-cell">
            <span className="hud-label">Needs you</span>
            <span className={`hud-val mono ${visibleAttentionCount > 0 ? 'hud-hot' : ''}`}>
              {visibleAttentionCount}
            </span>
          </span>
          <span className="hud-cell hud-gauge-cell" title="Daily spend against budget">
            <span className="hud-label">Spend</span>
            <span className="hud-gauge"><span className="hud-gauge-fill" style={{ width: `${Math.min(100, budget?.budget_usd ? (100 * (budget.cost_usd || 0)) / budget.budget_usd : 0)}%` }} /></span>
            <span className="hud-val mono">{budget ? `${fmtUSD(budget.cost_usd)} / ${fmtUSD(budget.budget_usd)}` : '—'}</span>
          </span>
        </div>
        {canvasId ? (
          <ActivityDock
            activity={activity}
            handoffs={handoffs}
            agents={state?.agents || []}
            agentsById={agentsById}
            onHoverHandoff={setHoverHandoffId}
          />
        ) : null}
      </div>

      {adminOpen ? <AdminModal onClose={() => { setAdminOpen(false); refreshRoster(); if (avatarRef.current) avatarRef.current.focus(); }} toast={toast} selfEmail={user.email} /> : null}
      {addAgentOpen && canvasId ? (
        <AddAgentModal
          canvasId={canvasId}
          builderOn={!!(config && config.agentBuilder)}
          isOwner={isOwner}
          roster={roster.filter((r) => r.enabled)}
          onClose={() => setAddAgentOpen(false)}
          onAdded={() => { setAddAgentOpen(false); loadState(canvasId); }}
          toast={toast}
        />
      ) : null}
      {archivedOpen ? (
        <ArchivedModal
          archivedCanvases={archivedCanvases}
          restoreCanvas={restoreCanvas}
          onClose={() => { setArchivedOpen(false); if (avatarRef.current) avatarRef.current.focus(); }}
        />
      ) : null}
      {capsOpen ? <CapabilitiesModal onClose={() => { setCapsOpen(false); refreshCaps(); refreshHealth(); }} toast={toast} /> : null}
    </div>
  );
}

function FilePanel({ file, canvasId, editable, onRemove, onClose }) {
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);

  const confirmRemove = async () => {
    setRemoving(true);
    const removed = await onRemove(file);
    if (!removed) setRemoving(false);
  };

  return (
    <aside className="panel file-panel" aria-label={`Document details: ${file.name}`}>
      <header className="panel-head">
        <h2>Document</h2>
        <button className="icon-btn" onClick={onClose} title="Close" aria-label="Close document details">×</button>
      </header>
      <div className="panel-body file-panel-body">
        <div className="file-panel-status"><strong>Ready for agents</strong><span>Ask an agent to interpret, summarize, compare, or enrich the people and companies in this document.</span></div>
        <div className="file-panel-name">{file.name}</div>
        <div className="file-panel-meta mono">
          <span>{fmtBytes(file.size)}</span>
          {file.uploaded_by ? <span>Added by {file.uploaded_by}</span> : null}
        </div>
        <a
          className="btn primary file-download-btn"
          href={`/api/canvases/${encodeURIComponent(canvasId)}/files/${encodeURIComponent(file.id)}`}
          download={file.name}
        >
          Download original
        </a>

        {editable && !confirming ? (
          <button className="link-btn danger-link file-remove-link" onClick={() => setConfirming(true)}>Remove document</button>
        ) : null}
        {editable && confirming ? (
          <div className="file-remove-confirm" role="alert">
            <strong>Remove this document?</strong>
            <span>It will disappear from this workspace and from future agent reads. Audit history is retained.</span>
            <div className="note-actions">
              <button className="btn ghost small" disabled={removing} onClick={() => setConfirming(false)}>Cancel</button>
              <button className="btn danger small" disabled={removing} onClick={confirmRemove}>
                {removing ? 'Removing…' : 'Yes, remove document'}
              </button>
            </div>
          </div>
        ) : null}
        {!editable ? <p className="file-readonly dim">View only · the original can be downloaded; changing documents is not available.</p> : null}
      </div>
    </aside>
  );
}

// Archived-canvas list in its own component so the shared dialog behavior
// (focus trap, Escape, focus restore) mounts with it.
function ArchivedModal({ archivedCanvases, restoreCanvas, onClose }) {
  const dialogRef = useDialog(onClose);
  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal archived-modal" role="dialog" aria-modal="true" aria-label="Archived canvases" ref={dialogRef} tabIndex={-1}>
        <header className="modal-head">
          <b>Archived canvases</b>
          <button className="icon-btn" onClick={onClose} title="Close" aria-label="Close">×</button>
        </header>
        <div className="modal-body">
          {archivedCanvases.length === 0 ? (
            <p className="dim">Nothing here — archived canvases will show up in this list.</p>
          ) : (
            <ul className="archived-list">
              {archivedCanvases.map((c) => (
                <li key={c.id} className="archived-row">
                  <span className="archived-name">{c.name}</span>
                  <button className="btn ghost small" onClick={() => restoreCanvas(c.id)}>Restore</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
