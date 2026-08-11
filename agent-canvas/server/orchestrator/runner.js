'use strict';
// The agent run loop. Every run has a hard step budget and wall-clock timeout;
// hitting either halts the run and escalates instead of looping. The global
// pause is checked before every model call and aborts in-flight calls.

const { db, nowIso } = require('../db');
const { audit } = require('../audit');
const bus = require('../bus');
const memory = require('../memory');
const { callModel, tierConfig, webSearchToolFor } = require('./anthropic');
const { toolsForRole, executeTool, createEscalation } = require('./tools');
const control = require('./control');

function recordEvent(run, type, payload) {
  db.prepare('INSERT INTO run_events (run_id, canvas_id, agent_id, type, payload, ts) VALUES (?, ?, ?, ?, ?, ?)')
    .run(run.id, run.canvas_id, run.agent_id, type, JSON.stringify(payload), nowIso());
  bus.emit('event', { type: 'run_event', canvasId: run.canvas_id, runId: run.id, agentId: run.agent_id, eventType: type, payload });
}

function setAgentStatus(agentId, canvasId, status) {
  db.prepare('UPDATE agents SET status = ? WHERE id = ?').run(status, agentId);
  bus.emit('event', { type: 'agent_status', canvasId, agentId, status });
}

function buildSystemPrompt(agent, canvas, run) {
  const pinned = db.prepare('SELECT title, content FROM notes WHERE canvas_id = ? AND pinned = 1 ORDER BY updated_at DESC').all(canvas.id);
  const pinnedBlock = pinned.length
    ? `\n## Pinned working context (live notes on this canvas — treat as current ground rules)\n${pinned.map((n) => `### ${n.title}\n${n.content}`).join('\n\n')}\n`
    : '';
  return `You are "${agent.name}", the ${agent.role} agent on the shared canvas "${canvas.name}" in the Agent Canvas Workspace (cloudtechgurus.com).

${agent.system_prompt}

## Shared memory contract (non-negotiable)
- Record every finding that matters via memory_write, one self-contained fact per entry.
- Label the epistemic state honestly: "verified" only for facts you directly confirmed against a primary source during this run; "inference" for conclusions you derived; "assumption" for anything unconfirmed. Never upgrade another entry's state by restating it.
- When you build on existing entries, cite them (cites). When an entry you read is labeled inference or assumption, carry that uncertainty forward — do not present it as fact.
- Entries marked tainted were built on since-corrected information: re-verify before relying on them.
- If you discover an existing entry is wrong, use memory_correct with the reason — never write a contradicting entry without superseding the old one.
- Reading contract: memory delivered to you always carries its epistemic state and provenance — preserve both when you use, summarize, or pass it on; never restate an assumption or inference as plain fact. Superseded entries are excluded from what you see; do not resurrect them.
- Verification authority: you may NEVER upgrade your own earlier inference or assumption to "verified" (the server rejects it). Independent verification — another agent checking a primary source, a deterministic check, or a human decision — is what upgrades an entry.
- Web-sourced findings must carry retrieval provenance: put the URL, retrieval time, and the supporting quoted passage in the entry's source/content.

## Working rules
- You have a hard budget of ${run.step_budget} model steps and ${Math.round(run.wall_ms_budget / 1000)}s wall clock for this run. Batch your tool calls; do not re-read what you already know.
- Escalate ONLY decisions that genuinely need a human (real ambiguity the intake rules and memory cannot resolve). After escalating an item, continue with your other items.
- Hand off work with a self-contained message plus the memory entry IDs the target needs — the target does not see your conversation.
- Finish by calling complete with a short summary. Progress claims in your summary must match what you actually did with tools this run.
${pinnedBlock}`;
}

async function executeRun(runId) {
  const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(runId);
  if (!run || run.status !== 'queued') return;
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(run.agent_id);
  const canvas = db.prepare('SELECT * FROM canvases WHERE id = ?').get(run.canvas_id);
  if (!agent || !canvas) {
    db.prepare("UPDATE runs SET status = 'failed', error = 'agent or canvas missing', ended_at = ? WHERE id = ?").run(nowIso(), runId);
    return;
  }

  const { provider, model } = tierConfig(agent.model_tier);
  const startedAt = Date.now();
  db.prepare("UPDATE runs SET status = 'running', model = ?, started_at = ? WHERE id = ?").run(model, nowIso(), runId);
  run.status = 'running'; run.model = model;
  setAgentStatus(agent.id, canvas.id, 'running');
  bus.emit('event', { type: 'run_status', canvasId: canvas.id, runId, agentId: agent.id, status: 'running' });
  recordEvent(run, 'run_started', { instruction: run.instruction.slice(0, 500), model, trigger: run.trigger_kind });
  audit('agent', agent.id, 'run.start', { runId, model, trigger: run.trigger_kind });

  const controller = new AbortController();
  control.registerAbort(runId, controller);
  // The workspace generation this run belongs to. If pause bumps the epoch
  // while a model call is in flight, the response is dropped — its tool calls
  // never execute (zombie rejection).
  const runEpoch = control.currentEpoch();

  const system = buildSystemPrompt(agent, canvas, run);
  const tools = toolsForRole(agent.role);
  // Web search rides the Claude providers only in v1 (Google grounding has a
  // different result shape); Gemini research agents work from row data + memory.
  if (agent.role === 'research' && process.env.ENABLE_WEB_SEARCH !== '0' && provider !== 'gemini') {
    tools.push(webSearchToolFor(model, provider));
  }
  const messages = [{ role: 'user', content: run.instruction }];
  const ctx = { run, agent, canvas, runEpoch };

  const finish = (status, { summary = null, error = null } = {}) => {
    db.prepare('UPDATE runs SET status = ?, summary = ?, error = ?, ended_at = ? WHERE id = ?')
      .run(status, summary, error, nowIso(), runId);
    control.unregisterAbort(runId);
    const stillRunning = db.prepare("SELECT COUNT(*) AS n FROM runs WHERE agent_id = ? AND status = 'running' AND id != ?").get(agent.id, runId);
    if (stillRunning.n === 0) setAgentStatus(agent.id, canvas.id, 'idle');
    bus.emit('event', { type: 'run_status', canvasId: canvas.id, runId, agentId: agent.id, status, summary, error });
    recordEvent(run, 'run_finished', { status, summary: summary ? summary.slice(0, 500) : null, error });
    audit('agent', agent.id, 'run.finish', { runId, status, stepsUsed: run.steps_used, costUsd: run.cost_usd });
  };

  const haltAndEscalate = (status, kind, question) => {
    finish(status, { error: kind });
    if (kind !== 'paused') {
      createEscalation({ canvasId: canvas.id, runId, agentId: agent.id, kind, question, context: { stepsUsed: run.steps_used, model } });
    }
  };

  try {
    let steps = 0;
    while (true) {
      // Hard limits: halt and escalate rather than loop.
      if (control.isPaused()) return finish('halted_paused', { error: 'global pause' });
      if (steps >= run.step_budget) {
        return haltAndEscalate('halted_steps', 'steps',
          `${agent.name} hit its hard step budget (${run.step_budget} steps) before finishing: "${run.instruction.slice(0, 160)}". Resume with a bigger budget, narrow the task, or drop it?`);
      }
      if (Date.now() - startedAt > run.wall_ms_budget) {
        return haltAndEscalate('halted_timeout', 'timeout',
          `${agent.name} hit its wall-clock limit (${Math.round(run.wall_ms_budget / 1000)}s) on: "${run.instruction.slice(0, 160)}". Resume, narrow the task, or drop it?`);
      }
      if (control.budgetExceeded()) {
        return haltAndEscalate('halted_budget', 'budget',
          `The daily token budget ($${control.getDailyBudget()}) is spent. New agent work is suspended until the budget is raised or the day rolls over.`);
      }

      let response;
      try {
        response = await callModel({ provider, model, system, messages, tools, signal: controller.signal });
      } catch (err) {
        if (controller.signal.aborted || /abort/i.test(String(err.message))) {
          return finish(control.isPaused() ? 'halted_paused' : 'failed', { error: control.isPaused() ? 'global pause' : `aborted: ${err.message}` });
        }
        throw err;
      }

      steps += 1;
      const cost = control.addUsage(response.model || model, response.usage || {});
      run.steps_used = steps;
      run.cost_usd = (run.cost_usd || 0) + cost;
      db.prepare('UPDATE runs SET steps_used = ?, input_tokens = input_tokens + ?, output_tokens = output_tokens + ?, cost_usd = cost_usd + ? WHERE id = ?')
        .run(steps, (response.usage && response.usage.input_tokens) || 0, (response.usage && response.usage.output_tokens) || 0, cost, runId);

      if (response._refusalFallbackFrom) {
        recordEvent(run, 'refusal_fallback', { from: response._refusalFallbackFrom, to: response.model });
      }

      if (response.stop_reason === 'refusal') {
        return haltAndEscalate('refused', 'refusal',
          `${agent.name}'s request was declined by the model's safety classifiers (and the fallback model also declined): "${run.instruction.slice(0, 160)}". Rephrase the task or handle it manually.`);
      }

      // Epoch check AFTER the model call: if pause hit while the request was in
      // flight (and the response landed before the abort), drop it — no tool
      // from a stale epoch executes.
      if (control.epochStale(runEpoch)) {
        return finish('halted_paused', { error: 'global pause (stale epoch — response dropped)' });
      }

      const textBlocks = response.content.filter((b) => b.type === 'text');
      for (const block of textBlocks) {
        if (block.text.trim()) recordEvent(run, 'text', { text: block.text.slice(0, 2000) });
      }
      for (const block of response.content) {
        if (block.type === 'server_tool_use') {
          recordEvent(run, 'web_search', { query: (block.input && block.input.query) || '' });
        }
      }

      // Server-side tool loop paused mid-turn: append the assistant turn and
      // re-request — the API resumes where it left off.
      if (response.stop_reason === 'pause_turn') {
        messages.push({ role: 'assistant', content: response.content });
        continue;
      }

      const toolUses = response.content.filter((b) => b.type === 'tool_use');
      if (response.stop_reason === 'tool_use' && toolUses.length) {
        messages.push({ role: 'assistant', content: response.content });
        const results = [];
        let end = null;
        for (const toolUse of toolUses) {
          if (control.epochStale(runEpoch)) {
            return finish('halted_paused', { error: 'global pause (stale epoch mid tool batch)' });
          }
          recordEvent(run, 'tool_call', { name: toolUse.name, input: toolUse.input });
          let result;
          try {
            result = await executeTool(toolUse.name, toolUse.input || {}, ctx);
          } catch (err) {
            result = { content: `Tool error: ${err.message}`, isError: true };
          }
          recordEvent(run, 'tool_result', { name: toolUse.name, isError: !!result.isError, preview: String(result.content).slice(0, 600) });
          results.push({ type: 'tool_result', tool_use_id: toolUse.id, content: result.content, is_error: !!result.isError });
          if (result.end && !end) end = result.end;
        }
        messages.push({ role: 'user', content: results });
        if (end) return finish(end.status, { summary: end.summary });
        continue;
      }

      if (response.stop_reason === 'max_tokens') {
        messages.push({ role: 'assistant', content: response.content });
        messages.push({ role: 'user', content: 'Your last message was cut off by the output limit. Continue exactly where you stopped.' });
        continue;
      }

      // end_turn without complete(): treat the final text as the summary.
      const summary = textBlocks.map((b) => b.text).join('\n').trim() || '(no summary)';
      return finish('completed', { summary });
    }
  } catch (err) {
    finish('failed', { error: String(err.message || err).slice(0, 500) });
  }
}

module.exports = { executeRun, recordEvent };
