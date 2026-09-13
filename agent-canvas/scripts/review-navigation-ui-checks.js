'use strict';
const assert = require('node:assert/strict');

module.exports = async function reviewNavigation({ context: ownerContext, url, newPage, call, seedReview, shot, evidence }) {
  const member = 'teammate@agent-canvas.invalid';
  const { roster } = await call(ownerContext, url, '/api/roster');
  const roster_ids = roster.filter((r) => ['scout', 'darren'].includes(r.template_key)).map((r) => r.id);
  const spaces = [];
  for (const name of ['Review test first', 'Review test second', 'Review test private']) {
    spaces.push((await call(ownerContext, url, '/api/canvases', 'POST', { name, roster_ids })).canvas.id);
  }
  await call(ownerContext, url, `/api/canvases/${spaces[2]}`, 'PATCH', { access_mode: 'restricted' });
  await call(ownerContext, url, `/api/canvases/${spaces[1]}/people`, 'POST', { email: member });
  await call(ownerContext, url, `/api/canvases/${spaces[1]}/people`, 'POST', { email: 'pete@cloudtechgurus.com' });
  const rules = [];
  for (const instruction of ['Review test scheduled alert', 'Review test scheduled brief']) {
    rules.push((await call(ownerContext, url, `/api/canvases/${spaces[1]}/standing-rules/parse`, 'POST', { instruction })).rule.id);
  }
  const ids = await seedReview({ spaces, rules });
  const { page, context } = await newPage(member);
  const card = (question) => page.locator('.ny-card').filter({ hasText: question });
  const queue = () => call(context, url, '/api/attention?scope=all');
  const enter = () => page.getByRole('button', { name: /^Needs you/ }).click();
  const scope = async (name) => {
    const loaded = page.waitForResponse((r) => r.url().includes(`/api/attention?scope=${name.toLowerCase()}`));
    await page.getByRole('tab', { name, exact: true }).click(); await loaded;
  };
  const hold = async (endpoint, outcome = 'success', method = 'POST') => {
    let release, count = 0;
    const waiting = page.waitForRequest((request) => request.method() === method && new URL(request.url()).pathname === endpoint);
    const gate = new Promise((resolve) => { release = resolve; });
    const pattern = `**${endpoint}`;
    const handler = async (route) => {
      if (route.request().method() !== method) return route.fallback();
      count += 1; await gate;
      // Lost requests never reach this test server. The UI must still treat
      // them as unconfirmed, because it cannot know where the connection broke.
      if (outcome === 'lost') return route.abort('connectionreset');
      if (outcome === 'rejected') return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Local acceptance fault' }) });
      const response = await route.fetch(); assert.ok(response.ok());
      return route.fulfill({ response });
    };
    await page.route(pattern, handler);
    const matches = (request) => request.method() === method && new URL(request.url()).pathname === endpoint;
    return { started: waiting, count: () => count, finish: async () => {
      const finished = outcome === 'lost' ? page.waitForEvent('requestfailed', { predicate: matches }) : page.waitForResponse((r) => matches(r.request()));
      // Each helper owns the only page-level route. Drain active handlers
      // before removing it; a response event can arrive before fulfill ends.
      release(); await finished; await page.unrouteAll({ behavior: 'wait' });
    } };
  };
  const answer = async (item, text) => {
    await item.getByRole('button', { name: 'Answer', exact: true }).click();
    await item.getByLabel('Your answer').fill(text);
    await item.getByRole('button', { name: 'Submit answer', exact: true }).click();
  };
  await enter();
  const first = card('Review test first-space answer?');
  const pending = await hold(`/api/escalations/${ids.first}/resolve`);
  await answer(first, 'Keep this as a draft for review.'); await pending.started;
  await scope('Team'); await scope('Mine');
  await first.getByText('Submitting…', { exact: true }).waitFor();
  assert.ok(await first.getByRole('button', { name: 'Submit answer', exact: true }).isDisabled());
  await page.getByRole('button', { name: 'Home', exact: true }).click(); await enter();
  await first.getByText('Submitting…', { exact: true }).waitFor();
  const other = card('Review test second-space answer?');
  await other.getByRole('button', { name: 'Answer', exact: true }).click();
  await other.getByLabel('Your answer').fill('This other project keeps its own answer.');
  await shot(page, 'pending', 'A pending answer remains disabled after filter and Home navigation; another project’s answer can still be edited.');
  await pending.finish(); await first.waitFor({ state: 'detached' });
  assert.equal(pending.count(), 1);
  assert.equal(await other.getByLabel('Your answer').inputValue(), 'This other project keeps its own answer.');
  assert.ok(!(await queue()).attention.some((row) => row.sourceRef.id === ids.first));
  evidence.checks.push('Pending answer survives Team/Mine and Home navigation, cannot repeat, saves to its source once and preserves another project’s answer draft.');

  const rejected = await hold(`/api/escalations/${ids.answer}/resolve`, 'rejected');
  await other.getByRole('button', { name: 'Submit answer', exact: true }).click(); await rejected.started;
  await scope('Team'); await rejected.finish(); await scope('Mine');
  await other.getByText(/Saving your response could not be completed/).waitFor();
  assert.equal(await other.getByLabel('Your answer').inputValue(), 'This other project keeps its own answer.');
  assert.equal(await card('Review test redirect?').getByRole('alert').count(), 0);
  await other.getByRole('button', { name: 'Submit answer', exact: true }).click();
  await other.waitFor({ state: 'detached' }); assert.equal(rejected.count(), 1);
  evidence.checks.push('A rejected answer arriving under a different filter retains its exact draft and error only on the originating card; one explicit retry succeeds.');

  const uncertain = card('Review test dismissal?');
  const lost = await hold(`/api/escalations/${ids.dismiss}/resolve`, 'lost');
  await answer(uncertain, 'Keep this answer until its status is known.'); await lost.started;
  await page.getByRole('button', { name: 'Home', exact: true }).click(); await lost.finish(); await enter();
  await uncertain.getByText(/Saving your response is not confirmed/).waitFor();
  await uncertain.getByRole('button', { name: 'Check status', exact: true }).click();
  await scope('Team'); await scope('Mine');
  assert.ok(await uncertain.getByRole('button', { name: 'Submit answer', exact: true }).isDisabled());
  assert.equal(await uncertain.getByLabel('Your answer').inputValue(), 'Keep this answer until its status is known.');
  assert.equal(lost.count(), 1);
  assert.ok((await queue()).attention.some((row) => row.sourceRef.id === ids.dismiss));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => !document.querySelector('.toasts')?.children.length);
  await uncertain.scrollIntoViewIfNeeded();
  await shot(page, 'unconfirmed-mobile', 'A lost answer reply remains unconfirmed across Home and filter navigation, with its draft and Check status recovery at 390px.');
  await uncertain.getByRole('button', { name: 'I checked the queue; keep editing', exact: true }).click();
  await uncertain.getByRole('button', { name: 'Submit answer', exact: true }).click();
  await uncertain.waitFor({ state: 'detached' });
  await page.setViewportSize({ width: 1280, height: 900 });
  evidence.checks.push('A lost answer remains guarded after leaving the queue and checking status; mobile recovery preserves the draft and requires explicit confirmation before retrying.');

  await scope('All');
  const assigned = card('Review test owner answer?');
  const assignment = await hold(`/api/escalations/${ids.team}/assign`);
  await assigned.getByText('Other actions', { exact: true }).click();
  await assigned.getByLabel('Assign this item').selectOption(`p:${member}`); await assignment.started;
  await scope('Mine'); await scope('All');
  assert.ok(await assigned.getByRole('button', { name: 'Answer', exact: true }).isDisabled());
  await assignment.finish();
  await assigned.getByText(`→ ${member}`, { exact: true }).waitFor();
  await assigned.getByRole('button', { name: 'Answer', exact: true }).click();
  await assigned.getByRole('button', { name: 'Back', exact: true }).click();
  assert.equal(assignment.count(), 1);
  evidence.checks.push('Pending assignment stays guarded across filters and returns to editable review after confirmed success; assignment does not mark the question answered.');

  const redirected = card('Review test redirect?');
  const current = (await queue()).attention.find((row) => row.sourceRef.id === ids.redirect);
  const second = await call(context, url, `/api/canvases/${spaces[1]}`);
  const target = second.agents.find((agent) => agent.id !== current.escalatingAgentId);
  const redirect = await hold(`/api/escalations/${ids.redirect}/resolve`, 'rejected');
  await redirected.getByText('Other actions', { exact: true }).click();
  await redirected.getByRole('button', { name: 'Ask another agent', exact: true }).click();
  await redirected.getByLabel('Agent to ask').selectOption(target.id);
  await redirected.getByLabel('Your answer').fill('Prepare only a local review draft.');
  await redirected.getByRole('button', { name: 'Ask another agent', exact: true }).click(); await redirect.started;
  await page.getByRole('button', { name: 'Home', exact: true }).click(); await redirect.finish(); await enter();
  await redirected.getByText(/Saving your response could not be completed/).waitFor();
  assert.equal(await redirected.getByLabel('Your answer').inputValue(), 'Prepare only a local review draft.');
  await redirected.getByRole('option', { name: new RegExp(`^${target.name} \\(`) }).waitFor({ state: 'attached' });
  assert.equal(await redirected.getByLabel('Agent to ask').inputValue(), target.id);
  await redirected.getByRole('button', { name: 'Ask another agent', exact: true }).click();
  await redirected.waitFor({ state: 'detached' }); assert.equal(redirect.count(), 1);
  evidence.checks.push('A redirect rejected while the queue is closed preserves the original target, exact instructions and failure; the same redirect succeeds on explicit retry.');
};
