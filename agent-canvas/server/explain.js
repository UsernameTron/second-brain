'use strict';
// P1 Explain Map: a run-centric graph composed from existing records only —
// run_events, memory_retrievals, memory entries + citations, evidence refs,
// handoffs/escalations/changesets, child runs, downstream cites. The user's
// question (the run instruction) is the anchor. Deterministic: fixed columns
// by node type, stable ordering, a hard node cap with a "+N more" collapse.
// Lenses are filters over ONE graph build; flow = what happened, evidence =
// why it is supportable, impact = immediate downstream work (depth 1).

const { db } = require('./db');
const memory = require('./memory');
const evidence = require('./evidence');

const LENSES = ['flow', 'evidence', 'impact'];
// Deterministic columns by node type.
const COLS = { question: 0, agent: 1, action: 2, evidence: 3, entry: 3, output: 4, impact: 4, more: null };
const NODE_CAP = 12;

function short(s, n = 90) {
  const t = String(s || '').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function buildExplainMap(runId, { lens = 'flow' } = {}) {
  if (!LENSES.includes(lens)) throw Object.assign(new Error(`lens must be one of ${LENSES.join(', ')}`), { status: 400 });
  const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(runId);
  if (!run) return null;
  const agent = db.prepare('SELECT id, name, role, color FROM agents WHERE id = ?').get(run.agent_id) || { id: run.agent_id, name: 'agent', role: '' };

  const nodes = [];
  const edges = [];
  const node = (n) => { nodes.push(n); return n.id; };
  const edge = (from, to, verb) => edges.push({ from, to, verb });

  // Anchor + agent — always present, never collapsed.
  const qId = node({ id: 'q', type: 'question', label: short(run.instruction, 140), meta: { runId: run.id } });
  const aId = node({ id: `agent:${agent.id}`, type: 'agent', label: agent.name, meta: { role: agent.role, color: agent.color, status: run.status } });
  edge(qId, aId, 'asked');

  // Actions: memory searches (grouped like the receipt) + external tool calls.
  const retrievals = db.prepare('SELECT entry_id, query, ts FROM memory_retrievals WHERE run_id = ? ORDER BY id').all(run.id);
  const searches = [];
  for (const r of retrievals) {
    let s = searches.find((x) => x.query === r.query && x.ts === r.ts);
    if (!s) { s = { query: r.query, ts: r.ts, entryIds: [] }; searches.push(s); }
    s.entryIds.push(r.entry_id);
  }
  searches.forEach((s, i) => {
    const id = node({ id: `search:${i}`, type: 'action', label: `searched “${short(s.query || '(recent entries)', 60)}”`, meta: { results: s.entryIds.length, ts: s.ts } });
    edge(aId, id, 'searched');
  });
  const toolEvents = db.prepare(
    "SELECT id, type, payload, ts FROM run_events WHERE run_id = ? AND type IN ('tool_call','web_search') ORDER BY id"
  ).all(run.id).map((e) => ({ ...e, payload: JSON.parse(e.payload) }))
    // memory tools are internal machinery, not map-worthy actions
    .filter((e) => e.type === 'web_search' || !/^memory_|^read_|^list_|^complete$|^wait$/.test(e.payload.name || ''));
  toolEvents.forEach((e) => {
    const label = e.type === 'web_search' ? `web search “${short(e.payload.query, 50)}”` : e.payload.name;
    const id = node({ id: `act:${e.id}`, type: 'action', label, meta: { ts: e.ts } });
    edge(aId, id, e.type === 'web_search' ? 'searched' : 'used');
  });

  // Entries the run wrote, their citations, and their evidence refs.
  const written = db.prepare('SELECT id FROM memory_entries WHERE run_id = ? ORDER BY created_at, id').all(run.id).map((r) => r.id);
  const citeMaps = memory.citeMapsFor(written);
  const evMaps = evidence.evidenceMapsFor(written);
  const tainted = memory.taintedSet(run.canvas_id);
  const entryNodes = new Map();
  for (const id of written) {
    const e = memory.getEntry(id);
    if (!e) continue;
    const nid = node({
      id: `entry:${id}`, type: 'entry', label: short(e.content, 90),
      meta: { epistemic: e.epistemic, tainted: tainted.has(id), superseded: !!e.supersededBy, entryId: id, citations: (citeMaps.citedBy.get(id) || []).length },
    });
    entryNodes.set(id, nid);
    edge(aId, nid, 'created');
  }
  // supported/contradicted edges: cited entry → written entry. A cite of a
  // superseded or tainted entry reads as contradicted — the support is broken.
  for (const id of written) {
    for (const citedId of citeMaps.cites.get(id) || []) {
      const cited = memory.getEntry(citedId);
      if (!cited) continue;
      let fromId = entryNodes.get(citedId);
      if (!fromId) {
        fromId = node({
          id: `entry:${citedId}`, type: 'entry', label: short(cited.content, 90),
          meta: { epistemic: cited.epistemic, tainted: tainted.has(citedId), superseded: !!cited.supersededBy, entryId: citedId, external: true },
        });
        entryNodes.set(citedId, fromId);
      }
      edge(fromId, entryNodes.get(id), (cited.supersededBy || tainted.has(citedId)) ? 'contradicted' : 'supported');
    }
    for (const ref of evMaps.get(id) || []) {
      const eid = `ev:${ref.id}`;
      if (!nodes.some((n) => n.id === eid)) {
        node({ id: eid, type: 'evidence', label: short(ref.title || ref.sourceId || ref.sourceKind, 70), meta: { sourceKind: ref.sourceKind, uri: ref.uri, refId: ref.id } });
      }
      edge(eid, entryNodes.get(id), 'supported');
    }
  }

  // Impact (depth 1): human approvals, handoffs out, changesets, child runs,
  // and entries elsewhere that cite this run's entries.
  db.prepare("SELECT id, kind, status, question FROM escalations WHERE run_id = ? ORDER BY created_at").all(run.id).forEach((es) => {
    const id = node({ id: `esc:${es.id}`, type: 'output', label: `escalation: ${short(es.question, 60)}`, meta: { status: es.status } });
    edge(aId, id, es.status === 'accepted' || es.status === 'redirected' ? 'approved' : 'created');
  });
  db.prepare('SELECT id, to_agent_id, item_key FROM handoffs WHERE run_id = ? ORDER BY ts').all(run.id).forEach((h) => {
    const to = db.prepare('SELECT name FROM agents WHERE id = ?').get(h.to_agent_id);
    const id = node({ id: `handoff:${h.id}`, type: 'output', label: `handed “${short(h.item_key, 30)}” to ${to ? to.name : 'agent'}`, meta: {} });
    edge(aId, id, 'created');
  });
  db.prepare('SELECT id, status FROM changesets WHERE run_id = ? ORDER BY created_at').all(run.id).forEach((cs) => {
    const id = node({ id: `cs:${cs.id}`, type: 'output', label: `changeset (${cs.status})`, meta: { changesetId: cs.id } });
    edge(aId, id, cs.status === 'verified' ? 'approved' : 'created');
  });
  db.prepare('SELECT id, agent_id, status, instruction FROM runs WHERE parent_run_id = ? ORDER BY created_at').all(run.id).forEach((child) => {
    const id = node({ id: `run:${child.id}`, type: 'impact', label: `child run: ${short(child.instruction, 60)}`, meta: { runId: child.id, status: child.status } });
    edge(aId, id, 'created');
  });
  for (const id of written) {
    for (const downId of (citeMaps.citedBy.get(id) || [])) {
      if (written.includes(downId)) continue; // in-run cites already drawn
      const down = memory.getEntry(downId);
      if (!down) continue;
      const nid = `impact:${downId}`;
      if (!nodes.some((n) => n.id === nid)) {
        node({ id: nid, type: 'impact', label: short(down.content, 80), meta: { entryId: downId, epistemic: down.epistemic, canvasId: down.canvasId } });
      }
      edge(entryNodes.get(id), nid, 'supported');
    }
  }

  // Lens filter over the one build.
  const KEEP = {
    flow: new Set(['question', 'agent', 'action', 'output', 'impact']),
    evidence: new Set(['question', 'agent', 'entry', 'evidence']),
    impact: new Set(['question', 'agent', 'output', 'impact']),
  }[lens];
  let kept = nodes.filter((n) => KEEP.has(n.type));

  // Node cap with deterministic collapse: question+agent always survive;
  // everything else ranks by (citations desc, insertion order) per column,
  // and the remainder of each column folds into one "+N more" node.
  if (kept.length > NODE_CAP) {
    const pinned = kept.filter((n) => n.type === 'question' || n.type === 'agent');
    const rest = kept.filter((n) => n.type !== 'question' && n.type !== 'agent');
    const rank = (n) => -(n.meta && n.meta.citations || 0);
    const byCol = new Map();
    rest.forEach((n, i) => {
      const col = COLS[n.type];
      if (!byCol.has(col)) byCol.set(col, []);
      byCol.get(col).push({ n, i });
    });
    const budget = NODE_CAP - pinned.length;
    const perColKeep = Math.max(1, Math.floor(budget / byCol.size));
    const keptRest = [];
    for (const [col, items] of [...byCol.entries()].sort((a, b) => a[0] - b[0])) {
      items.sort((a, b) => rank(a.n) - rank(b.n) || a.i - b.i);
      keptRest.push(...items.slice(0, perColKeep).map((x) => x.n));
      const dropped = items.length - perColKeep;
      if (dropped > 0) keptRest.push({ id: `more:${col}`, type: 'more', label: `+${dropped} more`, meta: { col, dropped: items.map((x) => x.n.id).slice(perColKeep) } });
    }
    kept = [...pinned, ...keptRest];
  }

  const keptIds = new Set(kept.map((n) => n.id));
  const keptEdges = edges.filter((e) => keptIds.has(e.from) && keptIds.has(e.to));

  // Layout: fixed x per column, y by order within column.
  const colCounts = {};
  const placed = kept.map((n) => {
    const col = COLS[n.type] ?? (n.meta && n.meta.col) ?? 2;
    const row = (colCounts[col] = (colCounts[col] || 0) + 1) - 1;
    return { ...n, col, row };
  });

  // "Read as steps": the flow-lens chronology as plain ordered text —
  // the same information without spatial interaction.
  const steps = [
    `${agent.name} was asked: ${short(run.instruction, 140)}`,
    ...searches.map((s) => `Searched memory for “${short(s.query || '(recent entries)', 60)}” — ${s.entryIds.length} result(s)`),
    ...toolEvents.map((e) => (e.type === 'web_search' ? `Searched the web for “${short(e.payload.query, 60)}”` : `Used ${e.payload.name}`)),
    ...written.map((id) => { const e = memory.getEntry(id); return e ? `Wrote to memory (${e.epistemic}): ${short(e.content, 100)}` : null; }).filter(Boolean),
    `Run ${run.status}${run.summary ? `: ${short(run.summary, 140)}` : ''}`,
  ];

  return {
    run: { id: run.id, status: run.status, summary: run.summary, instruction: run.instruction, agentId: agent.id, canvasId: run.canvas_id },
    lens,
    nodes: placed,
    edges: keptEdges,
    steps,
  };
}

module.exports = { buildExplainMap, LENSES, NODE_CAP };
