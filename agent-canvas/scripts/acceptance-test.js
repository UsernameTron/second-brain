'use strict';
// Local acceptance of secondary surfaces. Real browser/auth/routes; the same
// disposable, external-network-blocked fixture as the four primary journeys.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fork } = require('node:child_process');
const { chromium } = require('playwright');
const output = path.resolve(__dirname, '../docs/screenshots');
const group = process.argv[2] || 'rooms-memory';
const evidence = { group, fixture: 'Disposable database; real local routes and development sign-in; stubbed model; no external network. Does not verify Google OAuth or external integrations.', checks: [], screenshots: [], browserErrors: [] };
if (group === 'owner-diagnostics') evidence.fixture += ' Connector handshake and discovery are test stubs; probe recording and access changes use real server routes.';

function launchFixture() {
  const child = fork(path.join(__dirname, 'journey-fixture.js'), ['--local', '--acceptance', ...(group === 'owner-diagnostics' ? ['--connector-fixture'] : [])], { env: { PATH: process.env.PATH, HOME: process.env.HOME }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let logs = '';
  child.stdout.on('data', (data) => { logs += data; }); child.stderr.on('data', (data) => { logs += data; });
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Fixture startup timed out: ${logs}`)), 20000);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Fixture exited ${code}: ${logs}`)); });
    child.on('message', (message) => { if (message.type === 'ready') { clearTimeout(timer); resolve(message); } });
  });
  let sequence = 0;
  const request = (type, data) => new Promise((resolve, reject) => {
    const requestId = String(++sequence);
    const timer = setTimeout(() => { child.off('message', receive); reject(new Error(`Fixture ${type} timed out`)); }, 5000);
    const receive = (message) => { if (message.requestId === requestId) { clearTimeout(timer); child.off('message', receive); message.error ? reject(new Error(message.error)) : resolve(message.data); } };
    child.on('message', receive); child.send({ type, requestId, data });
  });
  return { ready, snapshot: () => request('snapshot'), seedReview: (data) => request('seed-review', data), stop: () => new Promise((resolve) => { if (child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill('SIGTERM'); }) };
}

async function more(page, name) {
  await page.locator('.primary-nav summary').filter({ hasText: /^More$/ }).click();
  await page.getByRole('button', { name, exact: true }).click();
}
async function shot(page, suffix, description) {
  await layout(page);
  const file = `acceptance-${group}-${suffix}.png`;
  await page.screenshot({ path: path.join(output, file), animations: 'disabled' });
  evidence.screenshots.push({ file, description, viewport: page.viewportSize() });
}
async function layout(page) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No horizontal page overflow');
  assert.ok(await page.evaluate(() => {
    const notifications = document.querySelector('.toasts')?.getBoundingClientRect();
    return !notifications?.height || [...document.querySelectorAll('[role="dialog"]')].every((dialog) => dialog.getBoundingClientRect().bottom <= notifications.top + 1);
  }), 'Notifications must not cover dialogs');
}
async function call(context, url, route, method = 'GET', body) {
  const response = await context.request.fetch(`${url}${route}`, { method, ...(body === undefined ? {} : { data: body }) });
  assert.ok(response.ok(), `${method} ${route}: ${response.status()} ${await response.text()}`);
  return response.json();
}

async function roomsAndMemory({ page, context, url, fault, newPage }) {
  await more(page, 'Rooms');
  await page.getByText('No rooms yet — create the first one above.', { exact: true }).waitFor();
  await page.getByLabel('Room name', { exact: true }).fill('Acceptance renewal');
  await page.getByLabel('Room type').selectOption('client');
  await page.getByText('Setup details: agents and external reference', { exact: true }).click();
  await page.getByLabel('External reference (optional)').fill('LOCAL-ONLY');
  await page.getByRole('checkbox', { name: 'Scout', exact: true }).check();
  await page.getByRole('checkbox', { name: 'teammate@agent-canvas.invalid', exact: true }).check();
  fault.current = (request) => request.url().endsWith('/api/rooms') && request.method() === 'POST' ? 503 : 0;
  await page.getByRole('button', { name: 'Create room', exact: true }).click();
  await page.getByText(/Creating the room could not be completed/).waitFor();
  assert.equal(await page.getByLabel('Room name', { exact: true }).inputValue(), 'Acceptance renewal');
  fault.current = null;
  await page.getByRole('button', { name: 'Create room', exact: true }).click();
  await page.getByRole('heading', { name: 'Acceptance renewal', exact: true }).waitFor();
  await page.getByLabel('Current project space: Acceptance renewal', { exact: true }).waitFor();
  const { rooms } = await call(context, url, '/api/rooms'); const room = rooms[0];
  assert.equal(room.roomType, 'client'); assert.equal(room.externalRef, 'LOCAL-ONLY');
  fault.current = (request) => request.url().endsWith('lens=risk') ? 503 : 0;
  await page.getByRole('radio', { name: 'Risk', exact: true }).click();
  await page.getByText(/Loading this room could not be completed/).waitFor();
  assert.equal(await page.getByRole('heading', { name: /^People/ }).count(), 0, 'Old lens content must not survive under a new lens');
  fault.current = null; await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await page.getByText('No risks recorded in this view. This does not prove there are no risks.', { exact: true }).waitFor();
  await page.getByRole('radio', { name: 'History', exact: true }).click();
  await page.getByRole('radio', { name: 'Now', exact: true }).waitFor();
  await page.getByRole('radio', { name: 'Now', exact: true }).click();
  await page.getByRole('button', { name: 'Refresh room', exact: true }).waitFor();
  fault.current = (request) => request.url().endsWith('/receipt') ? 503 : 0;
  await page.getByRole('button', { name: 'Refresh room', exact: true }).click();
  await page.getByText(/Checking refresh progress could not be completed/).waitFor();
  assert.ok(await page.getByRole('button', { name: 'Refresh in progress…', exact: true }).isDisabled());
  fault.current = null; await page.getByRole('button', { name: 'Check status', exact: true }).click();
  await page.getByText(/Refresh work: Finished/).waitFor();
  await page.getByRole('button', { name: 'View refresh work', exact: true }).click();
  await page.getByRole('paragraph').filter({ hasText: /This local test answer has no external sources/ }).waitFor();
  await page.getByRole('button', { name: 'Close panel', exact: true }).click();
  fault.current = (request) => request.url().endsWith('/activity') ? 503 : 0;
  await page.getByRole('button', { name: 'Activity', exact: true }).click();
  await page.getByText(/Loading room activity could not be completed/).waitFor();
  fault.current = null; await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await page.locator('.room-activity li').first().waitFor();
  await page.getByRole('button', { name: 'Brief', exact: true }).click();

  const memoryRoute = `/api/canvases/${room.canvasId}/memory`;
  const entries = [];
  for (const [epistemic, content] of [['verified', 'Renewal date confirmed in the test contract.'], ['inference', 'Renewal may require a service review.'], ['assumption', 'An additional sponsor may be needed.']]) {
    const { entry } = await call(context, url, memoryRoute, 'POST', { content, epistemic, source: 'Local acceptance fixture', kind: 'fact', ...(entries.length ? { cites: [entries[0].id] } : {}) });
    entries.push(entry);
  }
  await page.getByRole('button', { name: 'Export…', exact: true }).click();
  await page.getByRole('heading', { name: 'Disclosure review — what leaves, what stays', exact: true }).waitFor();
  // Real manifest conflict: append another confirmed finding AFTER preview.
  await call(context, url, memoryRoute, 'POST', { content: 'The checklist remains a draft.', epistemic: 'verified', source: 'Local acceptance fixture', kind: 'decision' });
  await page.getByRole('button', { name: 'Download client-safe HTML', exact: true }).click();
  await page.getByText('This item changed while you were working. Refresh its status before trying again.', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Download client-safe HTML', exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Review a fresh export preview', exact: true }).click();
  await page.getByRole('button', { name: 'Download client-safe HTML', exact: true }).waitFor();
  await shot(page, 'room-export', 'Owner disclosure review after a real stale-manifest conflict; included and excluded memory remain separate.');
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download client-safe HTML', exact: true }).click();
  const download = await downloadEvent; const html = fs.readFileSync(await download.path(), 'utf8');
  assert.ok(html.includes(entries[0].content)); assert.ok(!html.includes(entries[1].content)); assert.ok(!html.includes(entries[2].content));
  evidence.checks.push('Owner Room creation retains rejected input; Risk/History/Now, activity failure/recovery, refresh polling recovery, work details, real export conflict and verified-only download.');

  await page.getByRole('button', { name: 'Advanced canvas', exact: true }).click();
  await more(page, 'Memory');
  await page.locator('.mem-entry').filter({ hasText: entries[0].content }).waitFor();
  for (const [i, shape, border] of [[0, 'filled', 'solid'], [1, 'half', 'dashed'], [2, 'hollow', 'dotted']]) {
    const entry = page.locator('.mem-entry').filter({ hasText: entries[i].content });
    assert.ok(await entry.locator(`.epi-dot.${shape}`).count());
    assert.equal(await entry.evaluate((element) => getComputedStyle(element).borderTopStyle), border);
  }
  await page.getByLabel('Search memory').fill('no such claim');
  await page.getByText('Nothing matches that filter.', { exact: true }).waitFor();
  await page.getByLabel('Search memory').fill('');
  await page.getByLabel('Memory kind').selectOption('decision');
  assert.equal(await page.locator('.mem-entry').count(), 1);
  await page.getByLabel('Memory kind').selectOption('');
  const original = page.locator('.mem-entry').filter({ hasText: entries[2].content });
  await original.getByRole('button', { name: 'Correct…', exact: true }).click();
  await page.getByLabel('Corrected memory').fill('The existing sponsor confirmed ownership.');
  await page.getByLabel('Reason for the correction').fill('Checked the local test contract.');
  fault.current = (request) => request.url().endsWith('/correct') ? 503 : 0;
  await page.getByRole('button', { name: 'Correct', exact: true }).click();
  await page.getByText(/Recording your correction could not be completed/).waitFor();
  assert.equal(await page.getByLabel('Corrected memory').inputValue(), 'The existing sponsor confirmed ownership.');
  fault.current = null; await page.getByRole('button', { name: 'Correct', exact: true }).click();
  const corrected = page.locator('.mem-entry').filter({ hasText: 'The existing sponsor confirmed ownership.' });
  await corrected.waitFor();
  await page.getByLabel('history', { exact: true }).check();
  await page.locator('.mem-entry.superseded').filter({ hasText: entries[2].content }).waitFor();
  await shot(page, 'memory-correction', 'Correction preserves the original entry, its certainty, author, source, reason and replacement.');
  fault.current = (request) => request.url().endsWith('/lineage') ? 503 : 0;
  await corrected.getByRole('button', { name: 'History and sources', exact: true }).click();
  await page.getByText(/Loading memory sources could not be completed/).waitFor();
  fault.current = null; await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await page.getByRole('heading', { name: 'Lifecycle', exact: true }).waitFor();
  const { entries: history } = await call(context, url, `${memoryRoute}?include_superseded=1`);
  const old = history.find((entry) => entry.id === entries[2].id);
  const replacement = history.find((entry) => entry.id === old.supersededBy);
  assert.equal(old.content, entries[2].content); assert.equal(old.epistemic, 'assumption');
  assert.equal(replacement.content, 'The existing sponsor confirmed ownership.'); assert.equal(replacement.epistemic, 'verified');
  evidence.checks.push('Memory symbols and computed border styles match certainty; search/no matches/kind filter; failed correction retains draft; append-only replacement and history; failed lineage recovers.');
  await page.getByRole('button', { name: 'Close panel', exact: true }).click();

  // Exercise the existing server permission model with the fictional teammate.
  const member = await newPage('teammate@agent-canvas.invalid');
  await more(member.page, 'Rooms');
  await member.page.getByRole('button', { name: /Acceptance renewal/ }).click();
  await member.page.getByRole('button', { name: 'Refresh room', exact: true }).waitFor();
  assert.equal(await member.page.getByRole('button', { name: 'Export…', exact: true }).count(), 0);
  await call(context, url, `/api/canvases/${room.canvasId}/members`, 'POST', { email: 'teammate@agent-canvas.invalid', access: 'view' });
  await member.page.reload(); await more(member.page, 'Rooms');
  await member.page.getByRole('button', { name: /Acceptance renewal/ }).click();
  await member.page.getByText('view only', { exact: true }).waitFor();
  assert.equal(await member.page.getByRole('button', { name: 'Refresh room', exact: true }).count(), 0);
  await member.page.getByRole('button', { name: 'Advanced canvas', exact: true }).click();
  await more(member.page, 'Memory');
  await member.page.locator('.mem-entry').first().waitFor();
  assert.equal(await member.page.getByRole('button', { name: 'Correct…', exact: true }).count(), 0);
  assert.equal(await member.page.getByText('Change certainty', { exact: true }).count(), 0);
  await member.page.setViewportSize({ width: 390, height: 844 }); await layout(member.page);
  await shot(member.page, 'mobile-view-only', 'A view-only teammate can read memory with certainty and provenance; correction controls are absent.');
  await call(context, url, `/api/canvases/${room.canvasId}/members/teammate%40agent-canvas.invalid`, 'DELETE');
  const restricted = await member.context.request.get(`${url}/api/rooms`);
  assert.equal((await restricted.json()).rooms.length, 0);
  await member.context.close();
  evidence.checks.push('Fictional member can open a shared Room; owner export stays gated; view-only access hides refresh/correction; revoked access excludes restricted Room; 390px memory layout.');
  await more(page, 'Rooms');
  await page.getByLabel('Room name', { exact: true }).fill('Room needing a team');
  await page.getByRole('button', { name: 'Create room', exact: true }).click();
  await page.getByRole('heading', { name: 'Room needing a team', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Refresh room', exact: true }).click();
  await page.getByText(/This room needs an agent before it can refresh/).waitFor();
  await shot(page, 'needs-team', 'An unstaffed Room explains its missing prerequisite and links directly to its normal Team view.');
  await page.getByRole('button', { name: 'Open team', exact: true }).click();
  await page.getByText('No agents yet. Add one from the team templates.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Add agent', exact: true }).click();
  await page.getByRole('dialog', { name: 'Add agent', exact: true }).getByText('Scout', { exact: true }).click();
  await page.getByRole('dialog', { name: 'Add agent', exact: true }).waitFor({ state: 'detached' });
  await more(page, 'Rooms');
  await page.getByRole('button', { name: /Room needing a team/ }).click();
  await page.getByRole('button', { name: 'Refresh room', exact: true }).click();
  await page.getByText(/Refresh work: Finished/).waitFor();
  evidence.checks.push('Unstaffed Room recovery uses Open team, Add agent and a successful real local refresh without visiting Advanced.');
}

async function schedulingAndBuilder({ page, context, url, fault, newPage }) {
  await page.getByRole('button', { name: 'Create a project space', exact: true }).click();
  await page.getByLabel('Project-space name').fill('Local scheduled review');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('heading', { name: 'Ask the company.' }).waitFor();
  const { canvases } = await call(context, url, '/api/canvases'); const canvas = canvases[0];
  await more(page, 'Scheduled work');
  await page.getByText(/No standing rules yet/).waitFor();
  await page.getByLabel('Describe the standing rule').fill('Review our local renewal checklist every Monday.');
  fault.current = (request) => request.url().endsWith('/standing-rules/parse') ? 503 : 0;
  await page.getByRole('button', { name: 'Interpret', exact: true }).click();
  await page.getByText(/Interpreting your instruction could not be completed/).waitFor();
  assert.equal(await page.getByLabel('Describe the standing rule').inputValue(), 'Review our local renewal checklist every Monday.');
  fault.current = null; await page.getByRole('button', { name: 'Interpret', exact: true }).click();
  await page.getByRole('heading', { name: 'What this rule means', exact: true }).waitFor();
  const consent = page.locator('.room-section').filter({ has: page.getByRole('heading', { name: 'What this rule means', exact: true }) });
  for (const name of ['Watched', 'Sources', 'Scope', 'Cadence', 'Run by', 'Reads as', 'Output', 'Budget', 'Expires', 'Can', 'Cannot', 'Next run']) await consent.getByText(name, { exact: true }).waitFor();
  assert.ok(await page.getByRole('button', { name: 'Activate', exact: true }).isDisabled());
  await page.getByText('Settings — cadence, sources, budget, expiry', { exact: true }).click();
  await page.getByLabel('Hour (UTC)', { exact: true }).fill('18');
  fault.current = (request) => /\/standing-rules\/[^/]+$/.test(request.url()) && request.method() === 'PATCH' ? 503 : 0;
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await page.getByText(/Saving scheduled work could not be completed/).waitFor();
  assert.equal(await page.getByLabel('Hour (UTC)', { exact: true }).inputValue(), '18');
  fault.current = null; await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await consent.getByText('weekly on Monday at 18:00 UTC', { exact: true }).waitFor();
  fault.current = (request) => /\/standing-rules\/[^/]+$/.test(request.url()) && request.method() === 'GET' ? 503 : 0;
  await page.getByRole('button', { name: 'Rehearse', exact: true }).click();
  await page.getByText(/Checking the rehearsal could not be completed/).waitFor();
  assert.ok(await page.getByRole('button', { name: 'Rehearsing…', exact: true }).isDisabled());
  assert.ok(await page.getByRole('button', { name: 'Activate', exact: true }).isDisabled());
  fault.current = null; await page.getByRole('button', { name: 'Check status', exact: true }).click();
  await page.getByText(/Nothing matched\./).waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent === 'Activate' && !b.disabled));
  await shot(page, 'consent', 'Every consent field remains visible; successful rehearsal identifies Pete and preserves the zero-result meaning.');
  await page.getByRole('button', { name: 'Activate', exact: true }).click();
  await page.getByText(/Authorized by/).waitFor();
  await page.locator('.rooms-view').getByRole('button', { name: 'Pause', exact: true }).click();
  await consent.getByText('paused — nothing runs until it is resumed', { exact: true }).waitFor();
  await page.locator('.rooms-view').getByRole('button', { name: 'Resume', exact: true }).click();
  await page.locator('.rooms-view').getByRole('button', { name: 'Pause', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Revoke', exact: true }).click();
  await consent.getByText('never — the authorization is revoked', { exact: true }).waitFor();
  const rules = await call(context, url, `/api/canvases/${canvas.id}/standing-rules`);
  assert.equal(rules.rules[0].state, 'revoked'); assert.equal(rules.rules[0].cadence_hour, 18);
  evidence.checks.push('Scheduled instruction and settings failures retain drafts; all consent fields; failed rehearsal polling recovers without duplicate dispatch; zero matches; owner activation/pause/resume/revoke through real local routes.');

  await more(page, 'Team');
  await page.locator('.context-view summary').filter({ hasText: /^Advanced$/ }).click();
  await page.getByRole('button', { name: 'Build an agent', exact: true }).click();
  await page.getByLabel('Describe the job').fill('Prepare a local renewal draft and ask me about missing evidence.');
  fault.current = (request) => request.url().endsWith('/agent-drafts/propose') ? 503 : 0;
  await page.getByRole('button', { name: 'Propose agent', exact: true }).click();
  await page.getByText(/Saving this agent could not be completed/).waitFor();
  assert.ok((await page.getByLabel('Describe the job').inputValue()).includes('renewal draft'));
  fault.current = null; await page.getByRole('button', { name: 'Propose agent', exact: true }).click();
  await page.getByLabel('Operating instructions').waitFor();
  assert.ok(await page.getByRole('button', { name: 'Publish', exact: true }).isDisabled());
  fault.current = (request) => /\/agent-drafts\/[^/]+$/.test(request.url()) && request.method() === 'PATCH' ? 503 : 0;
  await page.getByLabel('Operating instructions').fill('Keep every checklist as a draft for human review.');
  await page.getByLabel('Escalation conditions').click();
  await page.getByText(/Saving this agent could not be completed/).waitFor();
  assert.equal(await page.getByLabel('Operating instructions').inputValue(), 'Keep every checklist as a draft for human review.');
  fault.current = null; await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  fault.current = (request) => /\/agent-drafts\/[^/]+$/.test(request.url()) && request.method() === 'GET' ? 503 : 0;
  await page.getByRole('button', { name: 'Rehearse', exact: true }).click();
  await page.getByText(/Checking the rehearsal could not be completed/).waitFor();
  assert.ok(await page.getByRole('button', { name: 'Rehearsing…', exact: true }).isDisabled());
  fault.current = null; await page.getByRole('button', { name: 'Check status', exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Publish' && !b.disabled));
  await page.locator('.authority-list input').first().check();
  assert.ok(await page.getByRole('button', { name: 'Publish', exact: true }).isDisabled(), 'A changed permission requires another rehearsal');
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Rehearse' && !b.disabled));
  await page.getByRole('button', { name: 'Rehearse', exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Publish' && !b.disabled));
  await page.getByRole('checkbox', { name: 'save as template', exact: true }).check();
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await page.getByRole('heading', { name: 'Published', exact: true }).waitFor();
  await page.getByText('is now active. What changed:', { exact: false }).waitFor();
  await page.getByText('Full change details', { exact: true }).click();
  assert.ok((await page.locator('.published-change-details').innerText()).includes('Keep every checklist as a draft for human review.'));
  await page.getByText('Full change details', { exact: true }).click();
  await shot(page, 'published', 'Owner can inspect the actual published-change details before closing the Builder.');
  const { agents } = await call(context, url, `/api/canvases/${canvas.id}`);
  assert.ok(agents.some((agent) => agent.name === 'Local review assistant'));
  const { roster } = await call(context, url, '/api/roster');
  assert.ok(roster.some((entry) => entry.name === 'Local review assistant'));
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  evidence.checks.push('Builder proposal/save failures retain drafts; failed rehearsal polling recovers; changed authority resets publication gate; actual local owner publication and saved template; published diff remains reviewable.');

  const member = await newPage('teammate@agent-canvas.invalid');
  await more(member.page, 'Team'); await member.page.locator('.context-view summary').filter({ hasText: /^Advanced$/ }).click();
  await member.page.getByRole('button', { name: 'Build an agent', exact: true }).click();
  await member.page.getByLabel('Describe the job').fill('Prepare a read-only test checklist.');
  await member.page.getByRole('button', { name: 'Propose agent', exact: true }).click();
  await member.page.getByText('Publishing needs the owner.', { exact: true }).waitFor();
  assert.equal(await member.page.getByRole('button', { name: 'Publish', exact: true }).count(), 0);
  await member.page.setViewportSize({ width: 390, height: 844 }); await layout(member.page);
  await shot(member.page, 'member-builder-mobile', 'A member can review a proposal and its permissions on mobile; publishing requires the owner.');
  await member.context.close();
  evidence.checks.push('Fictional member can propose an agent; publication remains owner-only; Builder has no page overflow at 390px.');
}

async function ownerAndDiagnostics({ page, context, url, fault, newPage }) {
  await page.getByRole('button', { name: 'Account', exact: true }).click();
  await page.getByRole('button', { name: 'Owner settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Owner settings', exact: true });
  for (const [tab, path, subject] of [['Agent templates', '/api/roster', 'agent templates'], ['Connections', '/api/mcp/servers', 'connections'], ['Audit history', '/api/audit', 'audit history'], ['People and access', '/api/allowlist', 'people and access']]) {
    fault.current = (request) => new URL(request.url()).pathname === path ? 503 : 0;
    await dialog.getByRole('tab', { name: tab, exact: true }).click();
    await dialog.getByText(`Loading ${subject} could not be completed. Check your connection and try again.`, { exact: true }).waitFor();
    assert.equal(await dialog.getByText(/allowlist is empty|no connectors configured|no audit entries match|No agent templates/).count(), 0);
    fault.current = null; await dialog.getByRole('button', { name: 'Try again', exact: true }).click();
    await dialog.locator('.request-error').waitFor({ state: 'detached' });
  }
  const testEmail = 'acceptance-fixture@cloudtechgurus.com';
  await dialog.getByLabel('Email address').fill(testEmail);
  await dialog.getByLabel('Display name').fill('Local acceptance person');
  fault.current = (request) => request.url().endsWith('/api/allowlist') && request.method() === 'POST' ? 503 : 0;
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await dialog.getByText(/Saving people and access could not be completed/).waitFor();
  assert.equal(await dialog.getByLabel('Email address').inputValue(), testEmail);
  fault.current = null; await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  const person = dialog.locator('tr').filter({ hasText: testEmail }); await person.waitFor();
  await person.getByRole('button', { name: 'remove', exact: true }).click();
  await person.waitFor({ state: 'detached' });
  await dialog.getByRole('tab', { name: 'Agent templates', exact: true }).click();
  const { roster } = await call(context, url, '/api/roster'); const [first, second] = roster;
  const template = dialog.locator('tr').filter({ has: page.getByText(first.name, { exact: true }) });
  await template.getByRole('button', { name: 'edit', exact: true }).click();
  await dialog.getByLabel('Agent name', { exact: true }).fill(`${first.name} local`);
  fault.current = (request) => request.url().endsWith(`/api/roster/${first.id}`) && request.method() === 'PATCH' ? 503 : 0;
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await dialog.getByText(/Saving agent templates could not be completed/).waitFor();
  assert.equal(await dialog.getByLabel('Agent name', { exact: true }).inputValue(), `${first.name} local`);
  fault.current = null; await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await dialog.getByRole('button', { name: `Move ${first.name} local down`, exact: true }).waitFor();
  fault.current = (request) => request.url().endsWith(`/api/roster/${second.id}`) && request.method() === 'PATCH' ? 503 : 0;
  await dialog.getByRole('button', { name: `Move ${first.name} local down`, exact: true }).click();
  await dialog.getByText(/Ordering is partly saved/).waitFor();
  assert.ok(await dialog.getByRole('button', { name: `Move ${first.name} local down`, exact: true }).isDisabled());
  fault.current = null; await dialog.getByRole('button', { name: 'Finish ordering', exact: true }).click();
  await dialog.getByText(/Ordering is partly saved/).waitFor({ state: 'detached' });
  const afterOrder = await call(context, url, '/api/roster');
  assert.equal(afterOrder.roster.find((entry) => entry.id === first.id).sort, second.sort);
  assert.equal(afterOrder.roster.find((entry) => entry.id === second.id).sort, first.sort);
  evidence.checks.push('Every owner table distinguishes unavailable from empty and retries; access add/remove and template edits use real routes; failed drafts persist; partial two-write ordering finishes only the remaining change.');

  await dialog.getByRole('tab', { name: 'Connections', exact: true }).click();
  await dialog.getByRole('button', { name: 'Add connector', exact: true }).click();
  await dialog.getByLabel('Connection name').fill('local_acceptance');
  await dialog.getByLabel('Connection URL').fill('https://connector.agent-canvas.invalid/mcp');
  await dialog.getByLabel('Connection access', { exact: true }).selectOption('owner');
  await dialog.getByLabel('Connection headers (JSON)').fill('invalid');
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await dialog.getByText('Enter headers as a JSON object, or leave the field empty.', { exact: true }).waitFor();
  await dialog.getByLabel('Connection headers (JSON)').fill('{}');
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  const connection = dialog.locator('tr').filter({ has: page.getByText('local_acceptance', { exact: true }) });
  await connection.getByRole('button', { name: 'Check connection', exact: true }).click();
  await dialog.getByText('Probe failed: Local fixture connection unavailable', { exact: true }).waitFor();
  assert.equal(await dialog.locator('.connector-tools input').count(), 0);
  await shot(page, 'failed-probe', 'A failed connector boundary probe exposes failure and recovery without discovered tools or a green status.');
  await connection.getByRole('button', { name: 'Check connection', exact: true }).click();
  await dialog.getByRole('checkbox', { name: 'search Search local fixture records', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.connector-tools input')?.checked === true);
  await connection.getByLabel('Access to local_acceptance').selectOption('members');
  await page.waitForFunction(() => !document.querySelector('[aria-label="Access to local_acceptance"]').disabled);
  await connection.getByLabel('Access to local_acceptance').selectOption('owner');
  await page.waitForFunction(() => !document.querySelector('[aria-label="Access to local_acceptance"]').disabled);
  const { servers } = await call(context, url, '/api/mcp/servers'); const savedConnection = servers.find((server) => server.name === 'local_acceptance');
  assert.equal(savedConnection.access, 'owner'); assert.deepEqual(savedConnection.enabledTools, ['search']);
  evidence.checks.push('Connection form validation, failed probe/recovery, discovered tool checkbox and serialized access changes; connector boundary stubbed, configuration/probe-record/audit routes real.');

  await dialog.getByRole('tab', { name: 'Audit history', exact: true }).click();
  await dialog.getByText('✓ chain verified', { exact: true }).waitFor();
  fault.current = (request) => new URL(request.url()).pathname === '/api/audit' ? 503 : 0;
  await dialog.getByRole('button', { name: 'Refresh', exact: true }).click();
  await dialog.getByText('Audit verification is unavailable until this check succeeds.', { exact: true }).waitFor();
  assert.equal(await dialog.getByText('✓ chain verified', { exact: true }).count(), 0);
  fault.current = null; await dialog.getByRole('button', { name: 'Try again', exact: true }).click();
  await dialog.getByText('✓ chain verified', { exact: true }).waitFor();
  await dialog.getByLabel('Filter audit action').fill('no.such.action');
  await dialog.getByText('no audit entries match', { exact: true }).waitFor();
  await dialog.getByLabel('Filter audit action').fill('');
  await dialog.getByLabel('Audit result limit').selectOption('50');
  await dialog.getByText('✓ chain verified', { exact: true }).waitFor();
  await shot(page, 'audit', 'Audit chain is checked by the real local server; a failed refresh cleared its old verification claim.');
  fault.current = (request) => request.url().endsWith('/api/export') ? 503 : 0;
  await dialog.getByRole('button', { name: 'Download operational ledger', exact: true }).click();
  await dialog.getByText(/Downloading the operational ledger could not be completed/).waitFor();
  fault.current = null; const downloadEvent = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Try again', exact: true }).click();
  const ledger = JSON.parse(fs.readFileSync(await (await downloadEvent).path(), 'utf8')); assert.ok(Array.isArray(ledger.memory_entries));
  await page.setViewportSize({ width: 390, height: 844 }); await layout(page);
  await shot(page, 'mobile-owner', 'Owner tools remain scrollable and reachable at 390px.');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('button', { name: 'Create a project space', exact: true }).click();
  await page.getByLabel('Project-space name').fill('Local diagnostics');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('heading', { name: 'Ask the company.' }).waitFor();
  await page.getByLabel('Ask a question about the company').fill('Review the local checklist.');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await page.getByText(/This local test answer has no external sources/).waitFor();
  await page.locator('.primary-nav summary').filter({ hasText: /^More$/ }).click();
  await page.locator('.primary-nav summary').filter({ hasText: /^Advanced$/ }).click();
  await page.locator('.primary-nav').getByRole('button', { name: 'Activity', exact: true }).click();
  await page.locator('.dock-head').click();
  assert.equal(await page.locator('.dock-filters button[aria-pressed="true"]').count(), 7);
  for (const button of await page.locator('.dock-filters button').all()) await button.click();
  await page.getByText('No activity matches these filters. Select more categories or all agents.', { exact: true }).waitFor();
  const member = await newPage('teammate@agent-canvas.invalid');
  await member.page.getByRole('button', { name: 'Account', exact: true }).click();
  assert.equal(await member.page.getByRole('button', { name: 'Owner settings', exact: true }).count(), 0);
  await member.context.close();
  evidence.checks.push('Audit verified/unavailable/no-matches states, result limit, ledger download failure/retry, all seven activity filters, mobile owner layout and member ownership gate.');
}

(async () => {
  const fixture = launchFixture(); let browser;
  try {
    const { url, bootCounts } = await fixture.ready;
    browser = await chromium.launch({ headless: true });
    const fault = { current: null };
    const newPage = async (email) => {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
      await context.route('**/*', async (route) => {
        if (new URL(route.request().url()).origin !== url) return route.abort();
        const status = fault.current?.(route.request());
        return status ? route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ error: 'Local acceptance fault' }) }) : route.continue();
      });
      const page = await context.newPage(); page.setDefaultTimeout(12000);
      page.on('pageerror', (error) => evidence.browserErrors.push(error.message));
      await page.goto(url); await page.getByLabel('Development sign-in').fill(email);
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await page.getByRole('button', { name: 'Account', exact: true }).waitFor();
      return { context, page };
    };
    const owner = await newPage('pete@cloudtechgurus.com');
    const run = { 'rooms-memory': roomsAndMemory, 'scheduling-builder': schedulingAndBuilder, 'owner-diagnostics': ownerAndDiagnostics,
      'workspace-tools': require('./workspace-ui-checks'), 'needs-you': require('./review-ui-checks'),
      'system-recovery': require('./system-ui-checks'), 'draft-safety': require('./draft-ui-checks'),
      'home-navigation': require('./home-navigation-ui-checks'),
      'review-navigation': require('./review-navigation-ui-checks'),
      'review-clarity': require('./review-clarity-ui-checks') }[group];
    assert.ok(run, 'Unknown acceptance group');
    try { await run({ ...owner, url, fault, newPage, call, more, shot, layout, evidence, seedReview: fixture.seedReview }); }
    catch (error) {
      const activePage = browser.contexts().flatMap((context) => context.pages()).filter((page) => !page.isClosed()).at(-1) || owner.page;
      await activePage.screenshot({ path: '/tmp/agent-canvas-acceptance-failure.png' });
      console.error('Visible recovery details:', await activePage.getByRole('alert').allTextContents()); throw error;
    }
    const snapshot = await fixture.snapshot();
    assert.equal(snapshot.externalAttempts, 0); assert.deepEqual(evidence.browserErrors, []);
    evidence.bootCounts = bootCounts; evidence.externalAttempts = snapshot.externalAttempts;
    if (group === 'owner-diagnostics') { assert.equal(snapshot.connectorProbeCalls, 2); evidence.connectorProbeCalls = snapshot.connectorProbeCalls; }
    fs.writeFileSync(path.join(output, `acceptance-${group}.json`), `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(`${group}: ${evidence.checks.length} acceptance groups passed; no browser errors or external calls.`);
  } finally { await browser?.close(); await fixture.stop(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
