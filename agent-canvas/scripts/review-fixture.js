'use strict';
// TEST ONLY: invoked over the acceptance runner's private IPC channel AFTER
// its empty-boot assertion. No HTTP route, scheduler activation or external call.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { db, nowIso } = require('../server/db');
const memory = require('../server/memory');
const { createEscalation } = require('../server/orchestrator/tools');

module.exports = function seedReview({ spaces, rules }) {
  assert.equal(spaces.length, 3); assert.equal(rules.length, 2);
  const member = 'teammate@agent-canvas.invalid';
  const owner = 'pete@cloudtechgurus.com';
  const [first, second, privateSpace] = spaces.map((id) => {
    const canvas = db.prepare('SELECT * FROM canvases WHERE id = ?').get(id);
    assert.ok(canvas?.name.startsWith('Review test '));
    const agents = db.prepare("SELECT * FROM agents WHERE canvas_id = ? AND lifecycle = 'active'").all(id);
    assert.ok(agents.length >= 2);
    return { id, agents };
  });
  const escalation = (space, question, email) => {
    const entry = createEscalation({ canvasId: space.id, agentId: space.agents[0].id, runId: null,
      kind: 'question', question, context: { detail: 'TEST ONLY: retain this as a draft for human review.', before: 'Existing local draft', after: 'Reviewed local draft' } });
    db.prepare('UPDATE escalations SET owner_email = ? WHERE id = ?').run(email, entry.id);
    return entry.id;
  };
  const ids = {
    first: escalation(first, 'Review test first-space answer?', member),
    answer: escalation(second, 'Review test second-space answer?', member),
    redirect: escalation(second, 'Review test redirect?', member),
    dismiss: escalation(second, 'Review test dismissal?', member),
    team: escalation(second, 'Review test owner answer?', owner),
    private: escalation(privateSpace, 'Review test PRIVATE answer?', member),
  };
  const entry = (fields) => memory.writeEntry({ canvasId: second.id, authorType: 'user', authorId: owner,
    source: 'Local UI acceptance fixture', kind: 'fact', ...fields });
  ids.conflicts = [entry({ content: 'Local contract renews in June.', subject: 'local renewal month', epistemic: 'verified' }).id,
    entry({ content: 'Local contract renews in July.', subject: 'local renewal month', epistemic: 'verified' }).id];
  ids.overdue = entry({ content: 'Local sponsor still owns this review.', epistemic: 'assumption', reviewAt: '2020-01-01T00:00:00.000Z' }).id;
  ids.failed = randomUUID();
  db.prepare(`INSERT INTO runs (id, canvas_id, agent_id, status, trigger_kind, instruction, error, step_budget, wall_ms_budget, created_at)
    VALUES (?, ?, ?, 'failed', 'user', 'Review test failed work', 'Local fixture source unavailable', 10, 60000, ?)`)
    .run(ids.failed, second.id, second.agents[0].id, nowIso());
  ids.occurrences = rules.map((id, index) => {
    const rule = db.prepare('SELECT * FROM standing_rules WHERE id = ?').get(id);
    assert.equal(rule.canvas_id, second.id);
    // Historical result display only. A paused rule has no authority to execute.
    db.prepare("UPDATE standing_rules SET state = 'paused', output_type = ? WHERE id = ?").run(index ? 'brief' : 'alert', id);
    const occurrence = randomUUID();
    db.prepare(`INSERT INTO standing_rule_runs (id, rule_id, rule_version, authorization_id, occurrence_key, state, matched_count, needs_attention, result_summary, created_at, ended_at)
      VALUES (?, ?, ?, '', ?, 'completed', 2, 1, ?, ?, ?)`)
      .run(occurrence, id, rule.version, `local-ui-${occurrence}`, index ? 'Local fixture brief: keep both checklist items as drafts.\nMATCHED: 2' : 'Local fixture alert: two checklist items need review.\nMATCHED: 2', nowIso(), nowIso());
    return occurrence;
  });
  require('../server/audit').audit('system', 'ui-acceptance-fixture', 'test_fixture.seed_review', { spaces, ids });
  return ids;
};
