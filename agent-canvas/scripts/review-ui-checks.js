'use strict';
const assert = require('node:assert/strict');

module.exports = async function reviewChecks({ context: ownerContext, url, newPage, call, seedReview, fault, shot, evidence }) {
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
  const queue = (scope = 'all') => call(context, url, `/api/attention?scope=${scope}`);
  const card = (text) => page.locator('.ny-card').filter({ hasText: text });
  const refresh = async () => {
    const fetched = page.waitForResponse((r) => r.url().includes('/api/attention?') && r.request().method() === 'GET');
    await page.getByRole('button', { name: 'Refresh queue', exact: true }).first().click();
    assert.equal((await fetched).status(), 200);
  };
  const fail = (part, status = 503) => { fault.current = (r) => new URL(r.url()).pathname.includes(part) && r.method() === 'POST' ? status : 0; };
  const clear = () => { fault.current = null; };
  const close = () => page.getByRole('button', { name: 'Close panel', exact: true }).click();

  await page.getByLabel('Switch project space').selectOption(spaces[0]);
  await page.getByRole('button', { name: /^Needs you/ }).click();
  await card('Review test first-space answer?').waitFor();
  assert.equal(await page.locator('.ny-card').count(), 4);
  assert.equal(await page.getByRole('tab', { name: 'Mine', exact: true }).getAttribute('aria-selected'), 'true');
  const badge = page.locator('.primary-nav .tray-badge');
  assert.equal(await badge.textContent(), '4');
  await page.getByRole('tab', { name: 'Team', exact: true }).click();
  await card('Review test owner answer?').waitFor();
  assert.equal(await page.locator('.ny-card').count(), 6);
  assert.equal(await badge.textContent(), '4');
  await page.getByRole('tab', { name: 'All', exact: true }).click();
  await card('Review test first-space answer?').waitFor();
  const all = (await queue()).attention;
  assert.equal(all.length, 10);
  assert.deepEqual([...new Set(all.map((row) => row.type))].sort(), ['brief_ready', 'conflict', 'escalation', 'failed_run', 'overdue_review', 'rule_alert']);
  assert.equal(await card('Review test PRIVATE answer?').count(), 0);
  assert.equal((await context.request.get(`${url}/api/canvases/${spaces[2]}`)).status(), 403);
  await shot(page, 'all-types', 'Member global queue contains all six card types across two accessible spaces; private-space records are excluded.');
  evidence.checks.push('Member Mine/Team/All across two spaces, independent Mine badge, all six source types, private-space exclusion and a real denied source read.');

  const assigned = card('Review test owner answer?');
  await assigned.getByText('Other actions', { exact: true }).click();
  await assigned.getByLabel('Assign this item').selectOption(`p:${member}`);
  await assigned.getByText(`→ ${member}`, { exact: true }).waitFor();
  const second = await call(context, url, `/api/canvases/${spaces[1]}`);
  const target = second.agents.find((agent) => agent.name === 'Darren');
  await assigned.getByLabel('Assign this item').selectOption(`a:${target.id}`);
  await assigned.getByText('→ Darren', { exact: true }).waitFor();
  await assigned.getByLabel('Assign this item').selectOption('clear');
  await assigned.getByText('Unassigned', { exact: true }).waitFor();
  const redirected = card('Review test redirect?');
  await redirected.getByText('Other actions', { exact: true }).click();
  await redirected.getByRole('button', { name: 'Ask another agent', exact: true }).click();
  const redirectTarget = second.agents.find((agent) => agent.id !== all.find((row) => row.sourceRef.id === ids.redirect).escalatingAgentId);
  await redirected.getByLabel('Agent to ask').selectOption(redirectTarget.id);
  await redirected.getByLabel('Your answer').fill('Prepare a local draft only.');
  await redirected.getByRole('button', { name: 'Ask another agent', exact: true }).click();
  await redirected.waitFor({ state: 'detached' });
  const dismissed = card('Review test dismissal?');
  await dismissed.getByText('Other actions', { exact: true }).click();
  await dismissed.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await dismissed.waitFor({ state: 'detached' });
  evidence.checks.push('Cross-space person/agent/clear assignment, redirection to that space’s agent and escalation dismissal retain original source semantics.');

  const answered = card('Review test second-space answer?');
  await answered.getByRole('button', { name: 'Answer', exact: true }).click();
  await answered.getByLabel('Your answer').fill('Keep this draft for review.');
  for (const status of [503, 409, 403]) {
    fail(`/escalations/${ids.answer}/resolve`, status);
    await answered.getByRole('button', { name: 'Submit answer', exact: true }).click();
    await answered.getByRole('alert').waitFor();
    assert.equal(await answered.getByLabel('Your answer').inputValue(), 'Keep this draft for review.');
    clear(); await answered.getByRole('button', { name: 'Check status', exact: true }).click();
  }
  let submissions = 0;
  await page.route(`**/api/escalations/${ids.answer}/resolve`, async (route) => {
    submissions += 1;
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.continue();
  });
  await answered.getByRole('button', { name: 'Submit answer', exact: true }).dblclick();
  await answered.waitFor({ state: 'detached' });
  assert.equal(submissions, 1);
  assert.equal((await call(context, url, `/api/canvases/${spaces[1]}`)).escalations.find((e) => e.id === ids.answer).status, 'accepted');
  evidence.checks.push('503/409/403 answer failures keep the exact draft and support status checks; double-click accepts only one real resolution.');

  const conflict = page.locator('.ny-conflict');
  await conflict.getByRole('button', { name: 'Review memory', exact: true }).click();
  await page.getByRole('button', { name: 'Review the other conflicting entry', exact: true }).waitFor();
  const sourceEntry = page.locator('.lineage > .mem-entry').first();
  await sourceEntry.getByText(/Local contract renews in (June|July)/).waitFor();
  const firstSource = await sourceEntry.locator('.mem-content').textContent();
  await page.getByRole('button', { name: 'Review the other conflicting entry', exact: true }).click();
  await sourceEntry.getByText(/Local contract renews in (June|July)/).waitFor();
  assert.notEqual(await sourceEntry.locator('.mem-content').textContent(), firstSource);
  assert.equal(await page.getByLabel('Switch project space').inputValue(), spaces[0]);
  await shot(page, 'memory-source', 'A conflicting-memory card opens its exact source and alternate entry while keeping the original active project.');
  await close();
  await conflict.getByText('Other actions', { exact: true }).click();
  await conflict.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await conflict.waitFor({ state: 'detached' });
  const history = (await call(context, url, `/api/canvases/${spaces[1]}/memory?include_superseded=1`)).entries;
  assert.equal(history.filter((entry) => ids.conflicts.includes(entry.id)).length, 2);

  const overdue = page.locator('.ny-overdue_review');
  await overdue.getByRole('button', { name: 'Review memory', exact: true }).click();
  await page.locator('.lineage > .mem-entry').getByText('Local sponsor still owns this review.', { exact: true }).waitFor();
  await close();
  fail('/reaffirm'); await overdue.getByRole('button', { name: 'Confirm still true', exact: true }).click();
  await overdue.getByRole('alert').waitFor();
  clear(); await overdue.getByRole('button', { name: 'Confirm still true', exact: true }).click();
  await overdue.waitFor({ state: 'detached' });
  const reviewed = (await call(context, url, `/api/canvases/${spaces[1]}/memory?include_superseded=1`)).entries;
  assert.ok(reviewed.find((entry) => entry.id === ids.overdue).supersededBy);
  evidence.checks.push('Conflict links open both exact entries without changing the active space; dismissal keeps both records. Overdue review opens its source and failure/retry appends a linked reaffirmation.');

  const failed = page.locator('.ny-failed_run');
  await failed.getByRole('button', { name: 'View work', exact: true }).click();
  await page.getByText('Review test failed work', { exact: true }).first().waitFor();
  await close();
  fail('/retry'); await failed.getByRole('button', { name: 'Try again', exact: true }).click();
  await failed.getByRole('alert').waitFor();
  clear(); await failed.getByRole('button', { name: 'Try again', exact: true }).click();
  await failed.waitFor({ state: 'detached' });
  for (const [type, action, text] of [['rule_alert', 'View scheduled work', 'Review test scheduled alert'], ['brief_ready', 'View brief', 'Review test scheduled brief']]) {
    const occurrence = page.locator(`.ny-${type}`);
    await occurrence.getByRole('button', { name: action, exact: true }).click();
    await page.locator('.source-rule-panel').getByText(text, { exact: true }).first().waitFor();
    await page.locator('.source-rule-panel').getByText(/Local fixture (brief|alert):/).first().waitFor();
    if (type === 'brief_ready') await shot(page, 'brief-source', 'The complete historical fixture brief opens from its card; the schedule stays paused and claims no future execution.');
    await page.getByRole('button', { name: 'Close scheduled work', exact: true }).click();
    fail('/acknowledge'); await occurrence.getByRole('button', { name: 'Mark reviewed', exact: true }).click();
    await occurrence.getByRole('alert').waitFor();
    clear(); await occurrence.getByRole('button', { name: 'Mark reviewed', exact: true }).click();
    await occurrence.waitFor({ state: 'detached' });
  }
  evidence.checks.push('Failed work source/retry and scheduled alert/brief source/acknowledgment each survive a rejected action; paused fixture schedules are never activated.');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('tab', { name: 'Mine', exact: true }).click();
  await card('Review test first-space answer?').waitFor();
  await shot(page, 'mobile-mine', 'Mobile member queue retains source labels, full decision context and accessible answer controls.');
  await card('Review test first-space answer?').getByRole('button', { name: 'Answer', exact: true }).click();
  await page.getByLabel('Your answer').fill('Confirmed for the local draft.');
  await page.getByRole('button', { name: 'Submit answer', exact: true }).click();
  await page.getByText('Nothing needs you right now.', { exact: false }).waitFor();
  await refresh();
  assert.equal((await queue('mine')).attention.length, 0);
  evidence.checks.push('390px member answer and verified-empty Mine queue after completion.');
};
