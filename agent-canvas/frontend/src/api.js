// Tiny fetch helper + WS URL + shape normalizers + formatters.
// Same-origin, cookie-authenticated: no custom auth headers, ever.

// Only these characters may appear in a caller-supplied API path. Rejects
// scheme separators, hosts, backslashes, and dot segments outright, so no input
// can express anything but a relative path on this origin's own API.
const API_PATH = /^\/api(?:\/[A-Za-z0-9._~-]+)*\/?(?:\?[A-Za-z0-9._~=&%-]*)?$/;

export async function api(path, opts = {}) {
  // Requests can only ever target this origin's API surface. The path is
  // allowlist-validated (no scheme, host, backslash, or dot segment can pass),
  // then the request URL is rebuilt from a constant prefix.
  const candidate = String(path);
  if (!API_PATH.test(candidate) || candidate.includes('..')) {
    throw Object.assign(new Error('invalid API path'), { status: 0 });
  }
  const url = `/api${candidate.slice(4)}`;
  const { body, headers, ...rest } = opts;
  const init = { ...rest, headers: { ...(headers || {}) } };
  if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
    if (!init.headers['Content-Type']) init.headers['Content-Type'] = 'application/json';
  }
  let res;
  try {
    res = await fetch(url, init);
  } catch {
    throw Object.assign(new Error('network error — server unreachable'), { status: 0 });
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    const message = (data && data.error) || `${res.status} ${res.statusText || 'request failed'}`;
    throw Object.assign(new Error(message), { status: res.status, data });
  }
  return data;
}

export function wsUrl() {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/ws`;
}

// Escalations arrive snake_case from SQL rows and camelCase from live WS events.
export function normEsc(e) {
  return {
    id: e.id,
    canvas_id: e.canvas_id !== undefined ? e.canvas_id : (e.canvasId !== undefined ? e.canvasId : null),
    run_id: e.run_id !== undefined ? e.run_id : e.runId,
    agent_id: e.agent_id !== undefined ? e.agent_id : e.agentId,
    kind: e.kind,
    question: e.question,
    context: e.context,
    status: e.status || 'open',
    owner_email: e.owner_email !== undefined ? e.owner_email : (e.ownerEmail ?? null),
    owner_agent_id: e.owner_agent_id !== undefined ? e.owner_agent_id : (e.ownerAgentId ?? null),
    due_at: e.due_at !== undefined ? e.due_at : (e.dueAt ?? null),
    created_at: e.created_at || e.createdAt,
    leaving: e.leaving || false,
  };
}

// Handoffs: SQL rows use from_agent_id/payload_entry_ids; WS uses fromAgentId/entryIds.
export function normHandoff(h) {
  return {
    id: h.id,
    from_agent_id: h.from_agent_id || h.fromAgentId,
    to_agent_id: h.to_agent_id || h.toAgentId,
    item_key: h.item_key !== undefined ? h.item_key : (h.itemKey || ''),
    message: h.message || '',
    entry_ids: h.payload_entry_ids || h.entryIds || [],
    ts: h.ts,
  };
}

export function fmtUSD(n) {
  const v = Number(n) || 0;
  if (v === 0) return '$0.00';
  if (v < 0.01) return `$${v.toFixed(4)}`;
  if (v < 1) return `$${v.toFixed(3)}`;
  return `$${v.toFixed(2)}`;
}

export function fmtBytes(n) {
  const v = Number(n) || 0;
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  return `${(v / (1024 * 1024)).toFixed(1)} MB`;
}

export function timeAgo(ts) {
  if (!ts) return '—';
  const ms = Date.now() - Date.parse(ts);
  if (!Number.isFinite(ms)) return '—';
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 45) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function fmtClock(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

export function initials(name = '') {
  const parts = String(name).trim().split(/[\s@.]+/).filter(Boolean);
  return ((parts[0] || '?')[0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
}

export function short(str, n = 100) {
  const s = String(str || '');
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
