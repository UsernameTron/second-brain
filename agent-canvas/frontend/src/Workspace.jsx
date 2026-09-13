import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { integrationStatus, systemStatus } from './format.jsx';
import { AppCtx } from './App.jsx';
import { api, downloadFile, rulesApi, wsUrl, normEsc, normHandoff, fmtUSD, fmtBytes, initials } from './api.js';
import Canvas from './Canvas.jsx';
import { DraftsContext } from './Drafts.jsx';
import WorkDetails from './WorkDetails.jsx';
import { RequestError, useResource } from './RequestState.jsx';
import Tray from './Tray.jsx';
import ActivityDock from './ActivityDock.jsx';
import CommandBar from './CommandBar.jsx';
import MemoryPanel from './MemoryPanel.jsx';
import RoomsView from './RoomsView.jsx';
import RulesView from './RulesView.jsx';
import { AgentPanel, NotePanel, SpendPanel } from './Panels.jsx';
import { useDialog } from './useDialog.js';
import Home from './Home.jsx';
import WorkspaceHeader from './WorkspaceHeader.jsx';
import { DocumentsView, TeamView, HelpView } from './ContextViews.jsx';
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
  const drafts = useRef(new Map());

  const [canvases, setCanvases] = useState([]);
  const [canvasesLoaded, setCanvasesLoaded] = useState(false);
  const [archivedCanvases, setArchivedCanvases] = useState([]);
  const [newCanvasOpen, setNewCanvasOpen] = useState(false);
  const [newCanvasName, setNewCanvasName] = useState('');
  const [creating, setCreating] = useState(false);
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
  const [addAgentTab, setAddAgentTab] = useState('roster');
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
  const [attention, setAttention] = useState(null); // Global, server-scoped queue
  const [attentionScope, setAttentionScope] = useState(isOwner ? 'all' : 'mine');
  const attentionScopeRef = useRef(attentionScope);
  attentionScopeRef.current = attentionScope;
  const [badgeAttention, setBadgeAttention] = useState(null);
  const [spend, setSpend] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [budget, setBudget] = useState(null);
  const [pause, setPause] = useState({ paused: null, by: null });
  const [requests, setRequests] = useState({});
  const [controlBusy, setControlBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [signingOut, setSigningOut] = useState(false);
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
      .catch(() => { setHealthDown(true); setHealth(null); });
  }, []);
  useEffect(() => {
    refreshHealth();
    const t = setInterval(refreshHealth, 60_000);
    return () => clearInterval(t);
  }, [refreshHealth]);
  const refreshCaps = useCallback(() => {
    api('/api/capabilities').then((d) => setWsConnected(!!d.connected)).catch(() => setWsConnected(null));
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
  const readSeq = useRef({});
  const readResource = useCallback(async (key, cid, read, apply) => {
    const request = (readSeq.current[key] || 0) + 1;
    readSeq.current[key] = request;
    setRequests((r) => ({ ...r, [key]: { loading: true, error: null } }));
    const current = () => readSeq.current[key] === request && (!cid || canvasIdRef.current === cid);
    try {
      const data = await read();
      if (current()) { apply(data); setRequests((r) => ({ ...r, [key]: { loading: false, error: null } })); }
      return data;
    } catch (error) {
      if (current()) setRequests((r) => ({ ...r, [key]: { loading: false, error } }));
      throw error;
    }
  }, []);
  const loadControl = useCallback(() => readResource('control', null,
    () => api('/api/control/status'), (d) => {
      if (typeof d?.paused !== 'boolean' || !Number.isFinite(d.budget_usd) || !Number.isFinite(d.cost_usd)) throw new Error('Incomplete control status');
      setBudget(d); setPause((p) => ({ ...p, paused: d.paused }));
    }), [readResource]);
  const loadState = useCallback(async (cid) => {
    return readResource('workspace', cid, () => api(`/api/canvases/${cid}`), (d) => {
    if (canvasIdRef.current !== cid) return;
    setState(d);
    });
  }, [readResource]);

  const loadMemory = useCallback(async (cid, incl) => {
    return readResource('memory', cid, () => api(`/api/canvases/${cid}/memory${incl ? '?include_superseded=1' : ''}`), (d) => {
    if (canvasIdRef.current !== cid) return;
    setMemory(d.entries || []);
    });
  }, [readResource]);

  const loadActivity = useCallback(async (cid) => {
    return readResource('activity', cid, () => api(`/api/canvases/${cid}/activity?limit=300`), (d) => {
    if (canvasIdRef.current !== cid) return;
    setActivity(d.events || []);
    });
  }, [readResource]);

  const loadSpend = useCallback(async (cid) => {
    readResource('analytics', cid, () => api(`/api/canvases/${cid}/analytics`), (data) => {
      if (canvasIdRef.current === cid) setAnalytics(data);
    }).catch(() => {});
    return readResource('spending', cid, () => api(`/api/canvases/${cid}/spend`), (data) => {
      if (canvasIdRef.current === cid) setSpend(data);
    });
  }, [readResource]);

  const loadEscalations = useCallback(async () => {
    const cid = canvasIdRef.current;
    return readResource('review', cid, () => api('/api/escalations'), (d) => {
    if (!cid || canvasIdRef.current !== cid) return;
    setEscalations((d.escalations || []).map(normEsc).filter((e) => e.status === 'open'));
    });
  }, [readResource]);

  const loadAttention = useCallback(async (scope = attentionScopeRef.current) => {
    const badgeScope = isOwner ? 'all' : 'mine';
    const queueRead = api(`/api/attention?scope=${scope}`);
    const badgeRead = scope === badgeScope ? queueRead : api(`/api/attention?scope=${badgeScope}`);
    await Promise.allSettled([
      readResource('attention', null, () => queueRead, (d) => setAttention(d.attention || [])),
      readResource('attention badge', null, () => badgeRead, (d) => setBadgeAttention(d.attention || [])),
    ]);
  }, [isOwner, readResource]);
  const changeAttentionScope = useCallback((scope) => {
    attentionScopeRef.current = scope;
    setAttentionScope(scope); setAttention(null); loadAttention(scope);
  }, [loadAttention]);
  const loadAttentionContext = useCallback((cid) => api(`/api/canvases/${cid}`), []);
  useEffect(() => {
    loadAttention();
    const tick = () => { if (document.visibilityState !== 'hidden') loadAttention(); };
    const timer = setInterval(tick, 30_000);
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(timer); window.removeEventListener('focus', tick); document.removeEventListener('visibilitychange', tick); };
  }, [loadAttention]);
  useEffect(() => { if (view === 'needsyou') loadAttention(); }, [view, loadAttention]);

  const refreshAll = useCallback(() => {
    setRunTick((n) => n + 1);
    loadControl().catch(() => {});
    refreshHealth();
    loadAttention();
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
  }, [loadState, loadMemory, loadActivity, loadSpend, loadEscalations, loadAttention, loadControl, refreshHealth, toast]);

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
    return readResource('spaces', null, () => api('/api/canvases'), (d) => {
    setCanvases(d.canvases || []);
    setArchivedCanvases(d.archived || []);
    setCanvasesLoaded(true);
    });
  }, [readResource]);

  const createCanvas = useCallback(async () => {
    const name = newCanvasName.trim();
    if (!name || creating || rosterChecked === null) return;
    setCreating(true); setActionError(null);
    try {
      const rosterIds = [...(rosterChecked || [])].filter((id) => roster.some((r) => r.id === id && r.enabled));
      const d = await api('/api/canvases', { method: 'POST', body: { name, roster_ids: rosterIds } });
      await refreshCanvases();
      setCanvasId(d.canvas.id);
      setNewCanvasOpen(false);
      setNewCanvasName('');
    } catch (e) { setActionError(e); } finally { setCreating(false); }
  }, [creating, newCanvasName, roster, rosterChecked, refreshCanvases, toast]);

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
    } catch (e) { setActionError(e); }
  }, [canvasId, refreshCanvases, toast]);

  const restoreCanvas = useCallback(async (id) => {
    try {
      await api(`/api/canvases/${id}`, { method: 'PATCH', body: { archived: false } });
      await refreshCanvases();
      setCanvasId(id);
      setArchivedOpen(false);
      toast('Canvas restored', 'ok');
    } catch (e) { setActionError(e); }
  }, [refreshCanvases, toast]);

  // ---------- roster (workspace template library) ----------
  const refreshRoster = useCallback(async () => {
    try {
      const d = await readResource('team templates', null, () => api('/api/roster'), () => {});
      const entries = d.roster || [];
      setRoster(entries);
      setRosterChecked((prev) => prev ?? new Set(entries.filter((r) => r.default_on).map((r) => r.id)));
    } catch { /* persistent retry below */ }
  }, [readResource]);
  useEffect(() => { refreshRoster(); }, [refreshRoster]);

  // ---------- boot: canvases + control status ----------
  useEffect(() => {
    refreshCanvases().then((d) => {
      if (d.canvases?.length) setCanvasId((current) => current || d.canvases[0].id);
    }).catch(() => {});
    loadControl().catch(() => {});
  }, [refreshCanvases, loadControl]);
  useEffect(() => {
    const focus = () => { if (document.visibilityState !== 'hidden') refreshAll(); };
    window.addEventListener('focus', focus);
    return () => window.removeEventListener('focus', focus);
  }, [refreshAll]);

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
      // Keep the default Home destination through the initial empty selection.
      return;
    }
    canvasIdRef.current = canvasId;
    setRequests((r) => ({ control: r.control, spaces: r.spaces, attention: r.attention, 'attention badge': r['attention badge'] }));
    setState(null); setMemory([]); setActivity([]); setSpend(null); setAnalytics(null);
    setEscalations([]); setPresence([]); setRunTick(0);
    setFileUpload({ kind: 'idle', message: '' });
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
    const cid = canvasIdRef.current;
    const d = await api(`/api/canvases/${cid}/agents/${agentId}/dispatch`, { method: 'POST', body });
    setState((s) => s?.canvas?.id === cid ? { ...s, runs: [d.run, ...s.runs] } : s);
    return d.run;
  }, []);

  // P2: assignment routes attention, never resolves it.
  const assignEscalation = useCallback(async (id, body) => {
    try {
      await api(`/api/escalations/${id}/assign`, { method: 'POST', body });
      loadEscalations().catch(() => {});
      await loadAttention();
      toast('Assigned', 'ok');
    } catch (e) {
      throw e;
    }
  }, [loadEscalations, loadAttention, toast]);

  const assignTask = useCallback(async (taskId, body) => {
    try {
      await api(`/api/canvases/${canvasIdRef.current}/tasks/${taskId}`, { method: 'PATCH', body });
      scheduleRefetch();
      toast('Assigned', 'ok');
    } catch (e) {
      throw e;
    }
  }, [scheduleRefetch, toast]);

  const addPerson = useCallback(async (email) => {
    try {
      await api(`/api/canvases/${canvasIdRef.current}/people`, { method: 'POST', body: { email } });
      scheduleRefetch();
      toast('Person added to the canvas', 'ok');
      return true;
    } catch (e) {
      setActionError(e);
      return false;
    }
  }, [scheduleRefetch, toast]);

  // P2 NEEDS YOU resolutions — each acts on the SOURCE record's endpoint.
  const retryRun = useCallback(async (sourceRef) => {
    try {
      await api(`/api/canvases/${sourceRef.canvasId}/runs/${sourceRef.id}/retry`, { method: 'POST', body: {} });
      toast('Retry dispatched', 'ok');
      await loadAttention();
    } catch (e) {
      throw e;
    }
  }, [loadAttention, toast]);

  // P5: acknowledge a standing-rule run (rule_alert / brief_ready cards).
  const acknowledgeRuleRun = useCallback(async (sourceRef) => {
    try {
      await rulesApi.acknowledge(sourceRef.id);
      toast('Acknowledged', 'ok');
      await loadAttention();
    } catch (e) {
      throw e;
    }
  }, [loadAttention, toast]);

  const extendReview = useCallback(async (sourceRef) => {
    // Re-affirm = append-only correction with a fresh date; 30 days is the
    // "still true, check again" horizon, not a policy — correct it to change.
    const reviewAt = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    try {
      await api(`/api/canvases/${sourceRef.canvasId}/memory/${sourceRef.id}/reaffirm`, { method: 'POST', body: { review_at: reviewAt } });
      toast('Re-affirmed — review pushed 30 days', 'ok');
      await loadAttention();
    } catch (e) {
      throw e;
    }
  }, [loadAttention, toast]);

  // Dismiss a projected card (conflict / overdue review / failed run) — "not
  // now", persisted server-side; the source record is untouched.
  const dismissAttention = useCallback(async (row) => {
    try {
      await api('/api/attention/dismiss', { method: 'POST', body: { canvas_id: row.sourceRef.canvasId, key: row.dismissKey } });
      toast('Dismissed', 'ok');
      await loadAttention();
    } catch (e) {
      throw e;
    }
  }, [loadAttention, toast]);

  const resolveEscalation = useCallback(async (id, body) => {
    try {
      await api(`/api/escalations/${id}/resolve`, { method: 'POST', body });
      markEscalationLeaving(id);
      await loadAttention();
      toast(body.action === 'dismiss' ? 'Dismissed' : 'Decision sent back to the agent', 'ok');
    } catch (e) {
      throw e;
    }
  }, [markEscalationLeaving, loadAttention, toast]);

  const saveNote = useCallback(async (note, draft) => {
    const cid = canvasIdRef.current;
    const d = await api(`/api/canvases/${cid}/notes/${note.id}`, {
      method: 'PUT',
      body: {
        title: draft.title,
        content: draft.content,
        pinned: draft.pinned,
        base_version: note.version,
        base_content: note.content,
      },
    });
    setState((s) => s?.canvas?.id === cid ? { ...s, notes: s.notes.map((n) => (n.id === d.note.id ? d.note : n)) } : s);
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
        setView('documents');
        setPanel({ type: 'note', id: d.note.id });
      }
      toast('Note created', 'ok');
    } catch (e) {
      setActionError(e);
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
      setActionError(e);
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
      setActionError(e);
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
        setView('documents');
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
      if (canvasIdRef.current === cid) setFileUpload({ kind: 'error', message: e.unconfirmed ? 'Upload is not confirmed. Check Documents & notes before choosing the file again.' : 'Upload failed. Choose the file again to retry.', file, error: e });
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
      setActionError(e);
      return false;
    }
  }, [state?.access, toast]);

  const correctEntry = useCallback(async (entryId, body) => {
    const cid = canvasIdRef.current;
    try {
      await api(`/api/canvases/${cid}/memory/${entryId}/correct`, { method: 'POST', body });
      await loadMemory(cid, showSupersededRef.current).catch(() => {});
      toast('Correction recorded', 'ok');
    } catch (e) {
      throw e;
    }
  }, [toast, loadMemory]);

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
    } catch (e) { setActionError(e); }
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

  const changePause = useCallback(async (paused) => {
    if (controlBusy) return;
    setControlBusy(true); setActionError(null);
    try {
      await api(`/api/control/${paused ? 'pause' : 'resume'}`, { method: 'POST', body: {} });
      await loadControl();
      toast(paused ? 'Workspace paused' : 'Workspace resumed', paused ? 'warn' : 'ok');
    } catch (e) { setActionError(e); throw e; }
    finally { setControlBusy(false); }
  }, [controlBusy, loadControl, toast]);
  const pauseAll = useCallback(() => changePause(true), [changePause]);
  const resumeAll = useCallback(() => changePause(false), [changePause]);

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
    if (signingOut) return;
    setSigningOut(true); setActionError(null);
    try { await api('/api/auth/logout', { method: 'POST', body: {} }); setUser(null); }
    catch (e) { setActionError(e); }
    finally { setSigningOut(false); }
  }, [setUser, signingOut]);

  const fetchRunEvents = useCallback(
    (runId) => api(`/api/canvases/${canvasId}/runs/${runId}/events`).then((d) => d.events || []),
    [canvasId]
  );

  const fetchRunReceipt = useCallback(
    (runId) => api(`/api/canvases/${canvasId}/runs/${runId}/receipt`),
    [canvasId]
  );

  const sendRunFeedback = useCallback(
    (runId, verdict, note) => api(`/api/canvases/${canvasId}/runs/${runId}/feedback`, {
      method: 'POST', body: { verdict, note },
    }),
    [canvasId]
  );

  const openRun = useCallback((runId, cid = canvasIdRef.current) => {
    if (runId && cid) setPanel({ type: 'work', runId, canvasId: cid });
  }, []);

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
      await loadControl().catch((e) => { throw Object.assign(e, { unconfirmed: true }); });
      toast('Daily budget updated', 'ok');
    } catch (e) { throw e; }
  }, [loadControl, toast]);

  // ---------- render ----------
  const visiblePresence = canvasId ? presence : [];
  const visibleAgents = canvasId ? (state?.agents || []) : [];
  const badgeRows = badgeAttention || [];
  const visibleAttentionCount = needsYouOn
    ? (badgeAttention === null || requests['attention badge']?.error ? '—' : badgeRows.length)
    : (requests.review?.error ? '—' : openEscalations.length);
  const globalRows = attention?.map((row) => {
    const space = canvases.find((c) => c.id === row.sourceRef.canvasId);
    return { ...row, canvasName: space?.name || 'Project space', access: space?.access || 'view' };
  }) ?? null;
  let sidePanel = null;
  if (canvasId && panel && state) {
    if (panel.type === 'agent' && agentsById[panel.id]) {
      sidePanel = (
        <AgentPanel
          key={`${canvasId}:${panel.id}`}
          agent={agentsById[panel.id]}
          runs={(state.runs || []).filter((r) => r.agent_id === panel.id)}
          spendRow={spendByAgent[panel.id]}
          initialRunId={panel.runId || null}
          paused={pause.paused}
          canvasId={canvasId}
          onSelectEntry={(id) => setPanel({ type: 'memory', entryId: id })}
          onDispatch={async (instruction) => {
            try { await dispatchToAgent(panel.id, instruction); toast(`Sent to ${agentsById[panel.id].name}`, 'ok'); }
            catch (e) { throw e; }
          }}
          isOwner={isOwner}
          editable={state.access !== 'view'}
          onCheckStatus={() => loadState(canvasId)}
          onRemove={state.access !== 'view' ? removeAgent : null}
          fetchRunEvents={fetchRunEvents}
          fetchRunReceipt={fetchRunReceipt}
          onFeedback={async (runId, verdict, note) => {
            try { return await sendRunFeedback(runId, verdict, note); }
            catch (e) { throw e; }
          }}
          onClose={() => setPanel(null)}
        />
      );
    } else if (panel.type === 'note') {
      const note = (state.notes || []).find((n) => n.id === panel.id);
      const task = panel.taskId ? (state.tasks || []).find((t) => t.id === panel.taskId) : null;
      sidePanel = (
        <NotePanel
          key={`${canvasId}:${panel.id || panel.taskId}`}
          onCheckStatus={() => loadState(canvasId)}
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
          onCorrect={state.access !== 'view' ? correctEntry : null}
          loadStatus={requests.memory}
          onRefresh={() => loadMemory(canvasId, showSuperseded).catch(() => {})}
          initialEntryId={panel.entryId}
          onClose={() => setPanel(null)}
          toast={toast}
        />
      );
    }
  }
  // The daily limit is workspace-wide and remains useful before a space exists
  // or when its contents cannot be loaded.
  if (panel?.type === 'spend') {
    sidePanel = (
      <SpendPanel
        spend={spend}
        analytics={analytics}
        hasProject={!!canvasId}
        statuses={requests}
        onRefresh={async () => { await loadControl(); if (canvasId) await loadSpend(canvasId).catch(() => {}); }}
        budget={requests.control?.error ? null : budget}
        isOwner={isOwner}
        onSetBudget={setBudgetUsd}
        onClose={() => setPanel(null)}
      />
    );
  }

  const diagnostics = (<div className="hud" role="status" aria-label="Systems console">
          <button className="hud-cell hud-btn" onClick={() => setCapsOpen(true)}
            title={healthDown ? 'Status unavailable. Open Connections and check again.' : 'Open the systems board'}>
            <span className={`lamp hexlamp lamp-${healthDown ? 'down' : systemStatus(health)}`} />
            <span className="hud-label">Systems</span>
            {healthDown ? <span className="hud-val mono hud-hot">Status unavailable</span> : null}
          </button>
          <span className={`hud-cell`} title={health?.integrations?.find((i) => i.id === 'model')?.detail || ''}>
            <span className={`lamp lamp-${integrationStatus(health?.integrations?.find((i) => i.id === 'model') || {}) || 'planned'}`} />
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
              {requests.workspace?.error ? 'Unknown' : visibleAgents.filter((a) => a.status === 'running').length} working · {health?.queue?.queued ?? '—'} waiting
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
            <span className="hud-val mono">{budget && !requests.control?.error ? `${fmtUSD(budget.cost_usd)} / ${fmtUSD(budget.budget_usd)}` : '—'}</span>
          </span>
        </div>);

  return (
    <DraftsContext.Provider value={drafts}><div className="workspace">
      <WorkspaceHeader user={user} theme={theme} setTheme={setTheme}
        spaces={{ list: canvases, id: canvasId, select: setCanvasId, archive: archiveCanvas, archived: () => setArchivedOpen(true) }}
        navigation={{ view, go: (next) => { setPanel(null); setView(next); }, needsYou: needsYouOn, count: visibleAttentionCount,
          hasSpace: !!state, rooms: roomsOn, rules: rulesOn, memory: () => setPanel({ type: 'memory' }) }}
        creation={{ open: newCanvasOpen, name: newCanvasName, setName: setNewCanvasName, show: () => setNewCanvasOpen(true),
          close: () => setNewCanvasOpen(false), create: createCanvas, roster, selected: rosterChecked, setSelected: setRosterChecked, teamId: selectedTeamId, busy: creating, error: actionError, checkStatus: refreshCanvases }}
        account={{ avatarRef, open: menuOpen, toggle: () => setMenuOpen((open) => !open), signingOut, signOut,
          admin: () => { setAdminOpen(true); setMenuOpen(false); } }}
        controls={{ budget: requests.control?.error ? null : budget, paused: pause.paused, busy: controlBusy,
          pause: () => pauseAll().catch(() => {}), resume: () => resumeAll().catch(() => {}),
          spending: () => setPanel({ type: 'spend' }), connections: () => setCapsOpen(true) }} />
      {state?.access !== 'view' && canvasId && state ? <input ref={fileInputRef} className="file-input-hidden" tabIndex={-1} type="file" accept={FILE_ACCEPT}
        aria-label="Choose a document to add to this canvas" disabled={fileUpload.kind === 'busy'} onChange={uploadFile} /> : null}
      {canvasId && fileUpload.message ? <div className={`file-upload-status is-${fileUpload.kind}`} role={fileUpload.kind === 'error' ? 'alert' : 'status'}>
        {fileUpload.kind === 'busy' ? <progress aria-label="Document upload in progress" /> : null}<span>{fileUpload.message}</span>
        {fileUpload.kind === 'error' ? <button className="btn small" onClick={() => {
          if (fileUpload.error?.unconfirmed) { setView('documents'); loadState(canvasId).catch(() => {}); }
          else if (fileUpload.file) uploadFile({ currentTarget: { files: [fileUpload.file], value: '' } });
          else fileInputRef.current?.click();
        }}>{fileUpload.error?.unconfirmed ? 'Check documents' : fileUpload.file ? 'Retry upload' : 'Choose document'}</button> : null}
      </div> : null}

      {pause.paused ? (
        <div className="pause-banner">
          <span className="pause-glyph">■</span>
          WORKSPACE PAUSED{pause.by ? ` by ${pause.by}` : ''} — all agents are frozen
          {isOwner ? <button className="btn ok small" disabled={controlBusy} onClick={() => resumeAll().catch(() => {})}>Resume</button> : null}
        </div>
      ) : null}

      <div className="workspace-notices">
        {!wsOk ? <div className="stale-notice" role="status">Live updates are reconnecting. Displayed work may be out of date. <button className="btn small" onClick={refreshAll}>Refresh status</button></div> : null}
        {Object.entries(requests).filter(([key, r]) => r?.error && !(key === 'attention badge' && requests.attention?.error) && !(key === 'attention' && view === 'needsyou')).map(([key, r]) => <RequestError key={key} error={r.error} subject={`Loading ${{ attention: 'Needs You', 'attention badge': 'the Needs You count', control: 'pause and spending status', spaces: 'project spaces' }[key] || key}`} onRetry={() => {
          if (key === 'team templates') refreshRoster();
          else if (key === 'spaces') refreshCanvases().then((d) => { if (!canvasId && d.canvases?.length) setCanvasId(d.canvases[0].id); }).catch(() => {});
          else refreshAll();
        }} />)}
        <RequestError error={actionError} subject="Updating your workspace" onRetry={() => { refreshAll(); setActionError(null); }} retryLabel="Check status" />
        {pause.paused === null && !requests.control?.error ? <p role="status">Checking pause and spending limits…</p> : null}
      </div>
      <div className="stage">
        <div className="canvas-wrap">
          {canvasId && state && view === 'home' ? (
            <Home
              key={canvasId}
              editable={state.access !== 'view'}
              canvasId={canvasId}
              agents={state?.agents || []}
              agentsById={agentsById}
              paused={pause.paused}
              runTick={runTick}
              onOpenRun={(agentId, runId) => openRun(runId)}
              onUpload={() => fileInputRef.current?.click()}
              onAddAgent={() => { setAddAgentTab('roster'); setAddAgentOpen(true); }}
              uploadBusy={fileUpload.kind === 'busy'}
              toast={toast}
            />
          ) : null}
          {view === 'needsyou' && needsYouOn ? (
            <NeedsYouView
              rows={globalRows}
              scope={attentionScope}
              onScopeChange={changeAttentionScope}
              loadStatus={requests.attention}
              onRefresh={() => loadAttention()}
              loadContext={loadAttentionContext}
              userEmail={user.email}
              defaultScope={isOwner ? 'all' : 'mine'}
              agentsById={agentsById}
              people={state?.people || []}
              agents={state?.agents || []}
              onResolveEscalation={resolveEscalation}
              onAssign={assignEscalation}
              onOpenMemory={(ref) => setPanel({ type: 'memory-source', canvasId: ref.canvasId, entryId: ref.id, secondId: ref.secondId })}
              onOpenRun={(ref) => openRun(ref.id, ref.canvasId)}
              onRetryRun={retryRun}
              onExtendReview={extendReview}
              onAcknowledgeRuleRun={acknowledgeRuleRun}
              onDismiss={dismissAttention}
              onOpenRule={rulesOn ? (ref) => { setPanel({ type: 'rule-source', canvasId: ref.canvasId, ruleId: ref.ruleId }); } : null}
            />
          ) : null}
          {view === 'help' ? <HelpView /> : null}
          {state && view === 'documents' ? <DocumentsView notes={state.notes || []} files={state.files || []} editable={state.access !== 'view'}
            onNote={createNote} onUpload={() => fileInputRef.current?.click()} uploadBusy={fileUpload.kind === 'busy'} onOpen={openNode} /> : null}
          {state && view === 'team' ? <TeamView presence={visiblePresence} connected={wsOk} agents={state.agents || []} people={state.people || []} editable={state.access !== 'view'} onOpen={openNode}
            builderOn={!!config?.agentBuilder}
            onAddAgent={() => { setAddAgentTab('roster'); setAddAgentOpen(true); }}
            onBuild={() => { setAddAgentTab('builder'); setAddAgentOpen(true); }}
            onCustom={() => { setAddAgentTab('custom'); setAddAgentOpen(true); }}
            personForm={addPersonOpen ? <form onSubmit={async (e) => { e.preventDefault(); if (await addPerson(newPersonEmail.trim())) { setAddPersonOpen(false); setNewPersonEmail(''); } }}>
              <label htmlFor="person-email">Teammate email</label><input id="person-email" type="email" required value={newPersonEmail} onChange={(e) => setNewPersonEmail(e.target.value)} />
              <button className="btn small">Add teammate</button><button type="button" className="btn ghost small" onClick={() => setAddPersonOpen(false)}>Cancel</button>
            </form> : <button className="btn" onClick={() => setAddPersonOpen(true)}>Add teammate</button>} /> : null}
          {view === 'commands' ? <section className="context-view"><h1>Advanced commands</h1><p>Describe a command, review the interpretation, then confirm it.</p></section> : null}
          {view === 'activity' ? <section className="context-view"><h1>Activity</h1><p>Detailed work events for the selected project space.</p></section> : null}
          {view === 'rooms' ? (
            <RoomsView
              user={user}
              roster={roster}
              onOpenCanvas={(id) => { setCanvasId(id); setView('canvas'); }}
              onCreated={(room) => { setCanvasId(room.canvasId); refreshCanvases().catch(() => {}); }}
              onOpenTeam={(id) => { setCanvasId(id); setView('team'); }}
              onOpenRun={({ canvasId: cid, runId }) => openRun(runId, cid)}
              toast={toast}
            />
          ) : null}
          {canvasId && state && view === 'rules' ? (
            <RulesView user={user} canvasId={canvasId} agents={state.agents || []} toast={toast} focusRuleId={ruleFocusId} />
          ) : null}
          {canvasId && state && view === 'canvas' ? (
            <Canvas
              agents={state?.agents || []}
              notes={state.notes || []}
              tasks={state.tasks || []}
              files={state.files || []}
              people={state?.people || []}
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
          {!canvasId && !['help', 'needsyou', 'rooms'].includes(view) && canvasesLoaded && !requests.spaces?.error && canvases.length === 0 ? (
            <div className="empty-canvas-cta no-canvases">
              <h2>Start with a project space</h2>
              <p>Create a focused space for the agents, people, notes, and work that belong together.</p>
              <button className="btn primary" onClick={() => setNewCanvasOpen(true)}>Create a project space</button>
            </div>
          ) : null}
          {(!canvasesLoaded && !requests.spaces?.error) || (canvasId && !state && !requests.workspace?.error) ? (
            <div className="stage-loading">
              <div className="boot-glyph" />
              Loading canvas…
            </div>
          ) : null}

          {canvasId && state && state.access !== 'view' && view === 'canvas' && (state.agents || []).length === 0 ? (
            <div className="empty-canvas-cta">
              <p>This canvas has no agents yet.</p>
              <button className="btn primary" onClick={() => setAddAgentOpen(true)}>Add your first agent</button>
            </div>
          ) : null}

          {canvasId && state && !needsYouOn ? (
            <Tray
              escalations={openEscalations}
              agentsById={agentsById}
              agents={state?.agents || []}
              people={state?.people || []}
              onResolve={resolveEscalation}
              onAssign={assignEscalation}
              loadStatus={needsYouOn ? requests.attention : requests.review}
              onRefresh={needsYouOn ? () => loadAttention() : () => loadEscalations().catch(() => {})}
              badgeOnly={needsYouOn}
              badgeCount={needsYouOn ? visibleAttentionCount : null}
              onOpen={() => setView('needsyou')}
            />
          ) : null}

          {panel?.type === 'work' ? <WorkDetails key={`${panel.canvasId}:${panel.runId}`} canvasId={panel.canvasId} runId={panel.runId} runTick={runTick}
            onClose={() => setPanel(null)} onSelectRun={(id) => openRun(id, panel.canvasId)}
            onSelectEntry={(id) => setPanel({ type: 'memory-source', canvasId: panel.canvasId, entryId: id })} />
            : panel?.type === 'memory-source' ? <MemorySource key={`${panel.canvasId}:${panel.entryId}`} source={panel} onOpenRun={openRun} onClose={() => setPanel(null)} toast={toast} />
            : panel?.type === 'rule-source' ? <div className="source-rule-panel"><button className="btn small" onClick={() => setPanel(null)}>Close scheduled work</button><RulesView user={user} canvasId={panel.canvasId} agents={[]} toast={toast} focusRuleId={panel.ruleId} /></div>
            : sidePanel}

          {canvasId && state && view === 'commands' ? (
            <CommandBar key={canvasId} canvasId={canvasId} paused={pause.paused} onCheckStatus={refreshAll} onParse={parseIntent} onConfirm={confirmIntent} toast={toast} />
          ) : null}
        </div>

        {canvasId && view === 'activity' ? (
          <ActivityDock
            activity={activity}
            loadStatus={requests.activity}
            onRefresh={() => loadActivity(canvasId).catch(() => {})}
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
          initialTab={addAgentTab}
          builderOn={!!(config && config.agentBuilder)}
          isOwner={isOwner}
          roster={roster.filter((r) => r.enabled)}
          onClose={() => setAddAgentOpen(false)}
          onAdded={() => { setAddAgentOpen(false); loadState(canvasId).catch(() => {}); }}
          onPublished={() => { loadState(canvasId).catch(() => {}); }}
          toast={toast}
        />
      ) : null}
      {archivedOpen ? (
        <ArchivedModal
          archivedCanvases={archivedCanvases}
          loadStatus={requests.spaces}
          onRefresh={refreshCanvases}
          restoreCanvas={restoreCanvas}
          onClose={() => { setArchivedOpen(false); if (avatarRef.current) avatarRef.current.focus(); }}
        />
      ) : null}
      {capsOpen ? <CapabilitiesModal diagnostics={diagnostics} onClose={() => { setCapsOpen(false); refreshCaps(); refreshHealth(); }} toast={toast} /> : null}
    </div></DraftsContext.Provider>
  );
}

function FilePanel({ file, canvasId, editable, onRemove, onClose }) {
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [downloadError, setDownloadError] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const download = async () => {
    if (downloading) return;
    setDownloading(true); setDownloadError(null);
    try { await downloadFile(`/api/canvases/${canvasId}/files/${file.id}`, file.name); }
    catch (e) { setDownloadError(e); }
    finally { setDownloading(false); }
  };

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
          aria-disabled={downloading}
          onClick={(e) => { e.preventDefault(); download(); }}
        >
          {downloading ? 'Preparing download…' : 'Download original'}
        </a>
        <RequestError error={downloadError} subject="Downloading the original document" onRetry={download} retryLabel="Try download again" />

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
function ArchivedModal({ archivedCanvases, restoreCanvas, onClose, loadStatus, onRefresh }) {
  const dialogRef = useDialog(onClose);
  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal archived-modal" role="dialog" aria-modal="true" aria-label="Archived canvases" ref={dialogRef} tabIndex={-1}>
        <header className="modal-head">
          <b>Archived canvases</b>
          <button className="icon-btn" onClick={onClose} title="Close" aria-label="Close">×</button>
        </header>
        <div className="modal-body">
          <RequestError error={loadStatus?.error} subject="Loading archived spaces" onRetry={onRefresh} />
          {loadStatus?.loading ? <p role="status">Loading archived spaces…</p> : null}
          {archivedCanvases.length === 0 && !loadStatus?.error && !loadStatus?.loading ? (
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

// Source navigation does not change the active project or borrow its edit rights.
function MemorySource({ source, onOpenRun, onClose, toast }) {
  const resource = useResource(async () => {
    const [space, memory] = await Promise.all([api(`/api/canvases/${source.canvasId}`), api(`/api/canvases/${source.canvasId}/memory?include_superseded=1`)]);
    return { space, entries: memory.entries };
  }, source.canvasId);
  const [showHistory, setShowHistory] = useState(true);
  return <MemoryPanel entries={(resource.data?.entries || []).filter((e) => showHistory || !e.supersededBy)}
    agentsById={Object.fromEntries((resource.data?.space.agents || []).map((a) => [a.id, a]))}
    initialEntryId={source.entryId} secondEntryId={source.secondId} showSuperseded={showHistory} onToggleSuperseded={() => setShowHistory((s) => !s)}
    loadStatus={resource} onRefresh={resource.refresh} onOpenRun={(id) => onOpenRun(id, source.canvasId)}
    onCorrect={resource.data?.space.access !== 'view' && resource.data ? async (id, body) => {
      await api(`/api/canvases/${source.canvasId}/memory/${id}/correct`, { method: 'POST', body });
      await resource.refresh();
    } : null} onClose={onClose} toast={toast} />;
}
