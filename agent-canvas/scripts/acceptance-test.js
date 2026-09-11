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

function launchFixture() {
  const child = fork(path.join(__dirname, 'journey-fixture.js'), ['--local'], { env: { PATH: process.env.PATH, HOME: process.env.HOME }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let logs = '';
  child.stdout.on('data', (data) => { logs += data; }); child.stderr.on('data', (data) => { logs += data; });
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Fixture startup timed out: ${logs}`)), 20000);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Fixture exited ${code}: ${logs}`)); });
    child.on('message', (message) => { if (message.type === 'ready') { clearTimeout(timer); resolve(message); } });
  });
  const snapshot = () => new Promise((resolve, reject) => {
    const requestId = String(Date.now());
    const timer = setTimeout(() => reject(new Error('Fixture snapshot timed out')), 5000);
    const receive = (message) => { if (message.requestId === requestId) { clearTimeout(timer); child.off('message', receive); resolve(message.data); } };
    child.on('message', receive); child.send({ type: 'snapshot', requestId });
  });
  return { ready, snapshot, stop: () => new Promise((resolve) => { if (child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill('SIGTERM'); }) };
}

async function more(page, name) {
  await page.locator('.primary-nav summary').filter({ hasText: /^More$/ }).click();
  await page.getByRole('button', { name, exact: true }).click();
}
async function shot(page, suffix, description) {
  const file = `acceptance-${group}-${suffix}.png`;
  await page.screenshot({ path: path.join(output, file), animations: 'disabled' });
  evidence.screenshots.push({ file, description, viewport: page.viewportSize() });
}
async function layout(page) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No horizontal page overflow');
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
    assert.equal(group, 'rooms-memory', 'Unknown acceptance group');
    await roomsAndMemory({ ...owner, url, fault, newPage });
    const snapshot = await fixture.snapshot();
    assert.equal(snapshot.externalAttempts, 0); assert.deepEqual(evidence.browserErrors, []);
    evidence.bootCounts = bootCounts; evidence.externalAttempts = snapshot.externalAttempts;
    fs.writeFileSync(path.join(output, `acceptance-${group}.json`), `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(`${group}: ${evidence.checks.length} acceptance groups passed; no browser errors or external calls.`);
  } finally { await browser?.close(); await fixture.stop(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
