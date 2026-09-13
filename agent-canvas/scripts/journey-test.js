'use strict';
// Real browser + real local routes. Only model responses and test assignment
// are fixtures; sign-in cookies, requests, receipts and resolution are real.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { fork } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'docs', 'screenshots');
fs.mkdirSync(output, { recursive: true });
const evidence = { fixture: 'Disposable in-memory DB; real development auth and application routes; stubbed model; external network blocked. Does not verify Google OAuth or live integrations.', journeys: [], screenshots: [], browserErrors: [] };
function launchFixture(local) {
  const child = fork(path.join(__dirname, 'journey-fixture.js'), local ? ['--local'] : [], { env: { PATH: process.env.PATH, HOME: process.env.HOME, AGENT_CANVAS_JOURNEY_FIXTURE: '1' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let logs = '';
  child.stdout.on('data', (data) => { logs += data; }); child.stderr.on('data', (data) => { logs += data; });
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Fixture startup timed out: ${logs}`)), 20000);
    child.once('exit', (code) => { clearTimeout(timer); if (code) reject(new Error(`Fixture exited ${code}: ${logs}`)); });
    child.on('message', (message) => { if (message.type === 'ready') { clearTimeout(timer); resolve(message); } });
  });
  const snapshot = () => new Promise((resolve, reject) => {
    const requestId = String(Date.now());
    const timer = setTimeout(() => reject(new Error('Fixture snapshot timed out')), 5000);
    const receive = (message) => { if (message.requestId === requestId) { clearTimeout(timer); child.off('message', receive); resolve(message.data); } };
    child.on('message', receive); child.send({ type: 'snapshot', requestId });
  });
  return { child, ready, snapshot, stop: () => new Promise((resolve) => { if (child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill('SIGTERM'); }) };
}
let capture = true;
async function screenshot(page, name, description) {
  if (!capture) return;
  await page.screenshot({ path: path.join(output, name), fullPage: false, animations: 'disabled' });
  evidence.screenshots.push({ file: name, description, viewport: page.viewportSize() });
}
async function layout(page) {
  const result = await page.evaluate(() => {
    const width = innerWidth;
    const buttons = [...document.querySelectorAll('.header-safety button')].map((el) => { const r = el.getBoundingClientRect(); return { text: el.textContent, left: r.left, right: r.right, top: r.top, bottom: r.bottom }; });
    const stage = document.querySelector('.stage')?.getBoundingClientRect(); const notifications = document.querySelector('.toasts')?.getBoundingClientRect();
    return { overlap: notifications?.height > 0 && stage?.bottom > notifications.top + 1, width, scrollWidth: document.documentElement.scrollWidth, buttons };
  });
  assert.equal(result.overlap, false, 'Notifications do not cover work');
  assert.ok(result.scrollWidth <= result.width + 1, `Horizontal overflow: ${JSON.stringify(result)}`);
  assert.ok(result.buttons.length >= 3, 'Spending, Connections and Pause stay visible');
  for (const button of result.buttons) assert.ok(button.left >= 0 && button.right <= result.width + 1, `Hidden safety control: ${button.text}`);
}
async function more(page, name) { await page.locator('.primary-nav summary').filter({ hasText: /^More$/ }).click(); await page.getByRole('button', { name, exact: true }).click(); }
async function checkBrowserZoom(url, originalContext) {
  // A disposable extension uses Chromium's actual tab zoom API. This is browser
  // zoom (640 CSS px at 200% in a 1280px viewport), not CSS transforms or DPR-only emulation.
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-canvas-zoom-'));
  const extension = path.join(directory, 'extension'); fs.mkdirSync(extension);
  fs.writeFileSync(path.join(extension, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'Local journey zoom check', version: '1.0', permissions: ['tabs'], background: { service_worker: 'worker.js' } }));
  fs.writeFileSync(path.join(extension, 'worker.js'), 'chrome.runtime.onInstalled.addListener(() => {});');
  let zoomContext;
  try {
    zoomContext = await chromium.launchPersistentContext(path.join(directory, 'profile'), { channel: 'chromium', headless: true, viewport: { width: 1280, height: 900 }, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    await zoomContext.addCookies((await originalContext.storageState()).cookies);
    await zoomContext.route('**/*', (route) => new URL(route.request().url()).origin === url ? route.continue() : route.abort());
    const worker = zoomContext.serviceWorkers()[0] || await zoomContext.waitForEvent('serviceworker');
    const page = await zoomContext.newPage(); await page.goto(url);
    page.on('pageerror', (error) => evidence.browserErrors.push(`zoom: ${error.message}`));
    await page.getByRole('heading', { name: 'Ask the company.' }).waitFor();
    const factors = await worker.evaluate(async () => { const tabs = await chrome.tabs.query({ url: 'http://127.0.0.1/*' }); for (const tab of tabs) await chrome.tabs.setZoom(tab.id, 2); return Promise.all(tabs.map((tab) => chrome.tabs.getZoom(tab.id))); });
    await page.waitForFunction(() => innerWidth === 640 && devicePixelRatio === 2);
    await layout(page);
    evidence.browserZoom = { factors, ...(await page.evaluate(() => ({ cssWidth: innerWidth, devicePixelRatio }))) };
    assert.ok(factors.length && factors.every((factor) => factor === 2));
    await screenshot(page, 'journey-desktop-200-percent.png', 'Actual Chromium tab zoom at 200%; safety controls remain visible without horizontal scrolling.');
  } finally { await zoomContext?.close(); fs.rmSync(directory, { recursive: true, force: true }); }
}
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const scenario of [
      { size: 'desktop', viewport: { width: 1280, height: 900 } },
      { size: 'mobile', viewport: { width: 390, height: 844 } },
      { size: 'pete-preview', viewport: { width: 1280, height: 900 }, local: true },
    ]) {
      const { size, viewport, local } = scenario;
      capture = !local;
      const fixture = launchFixture(local);
      let context;
      try {
        const { url, bootCounts, identity } = await fixture.ready;
        context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
        await context.route('**/*', (route) => new URL(route.request().url()).origin === url ? route.continue() : route.abort());
        const page = await context.newPage();
        page.on('pageerror', (error) => evidence.browserErrors.push(`${size}: ${error.message}`));
        await page.goto(url);
        await page.getByLabel('Development sign-in').fill(identity.email);
        await screenshot(page, `journey-${size}-01-sign-in.png`, 'Development sign-in; Google OAuth is not configured in this isolated fixture.');
        await page.getByRole('button', { name: 'Sign in', exact: true }).click();
        await page.getByRole('button', { name: 'Spending and daily cap' }).click();
        await page.getByRole('heading', { name: 'Spending', exact: true }).waitFor();
        await page.getByText('Advanced spending details', { exact: true }).click();
        await page.getByText('Select or create a project space to view spending history and agent statistics.', { exact: true }).waitFor();
        assert.equal(await page.getByLabel('Set daily budget (USD)').count(), identity.role === 'owner' ? 1 : 0);
        await page.getByRole('button', { name: 'Close panel', exact: true }).click();
        await page.getByRole('button', { name: 'Create a project space', exact: true }).click();
        await page.getByLabel('Project-space name').fill('Renewal review');
        await page.getByRole('button', { name: 'Create', exact: true }).click();
        await page.getByRole('heading', { name: 'Ask the company.' }).waitFor();
        const session = await (await context.request.get(`${url}/api/me`)).json();
        assert.equal(session.user.email, identity.email, 'Signed in as the intended test identity');
        assert.equal(session.user.role, identity.role, 'Existing account role preserved');
        assert.equal(await page.getByRole('textbox').count(), 1, 'One default composer');
        await page.getByRole('button', { name: 'Connections', exact: true }).click();
        await page.getByText('○ Not configured', { exact: true }).waitFor();
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: 'Home', exact: true }).click();
        const question = page.getByLabel('Ask a question about the company');
        await question.fill('What should we check before a customer renewal?');
        assert.equal(await page.getByRole('radio', { name: 'Ask', exact: true }).getAttribute('aria-checked'), 'true');
        await page.getByRole('button', { name: 'Ask', exact: true }).click();
        await page.locator('.answer-card.status-answered').waitFor();
        await page.getByText(/No supporting sources were recorded/).waitFor();
        await layout(page);
        await screenshot(page, `journey-${size}-02-ask.png`, 'Member Ask answered; absent supporting sources are explicit.');
        await page.getByRole('button', { name: 'Act on this', exact: true }).click();
        await question.fill('Draft a short checklist from this answer.');
        assert.equal(await page.getByRole('radio', { name: 'Act', exact: true }).getAttribute('aria-checked'), 'true');
        await page.getByText('Answer attached to your follow-up').waitFor();
        await screenshot(page, `journey-${size}-03-act-context.png`, 'Visible removable answer context and editable follow-up; nothing auto-submits.');
        await page.getByRole('button', { name: 'Act', exact: true }).click();
        await page.getByText('Draft checklist:', { exact: true }).waitFor();
        await screenshot(page, `journey-${size}-03b-act-result.png`, 'Act produced the draft checklist through the existing inquiry endpoint.');
        await page.getByRole('button', { name: /^Needs you/ }).click();
        if (local) await page.getByRole('tab', { name: 'Mine', exact: true }).click();
        const review = page.locator('.ny-card').filter({ hasText: 'Should we prepare the renewal checklist?' });
        await review.waitFor();
        await review.getByRole('button', { name: 'Answer', exact: true }).click();
        await review.getByLabel('Your answer').fill('Yes, prepare a draft checklist for review.');
        await screenshot(page, `journey-${size}-04-needs-you.png`, 'Assigned member review with decision context, retained answer and Submit answer.');
        const accepted = page.waitForResponse((response) => response.url().includes('/escalations/') && response.url().endsWith('/resolve') && response.request().method() === 'POST');
        await review.getByRole('button', { name: 'Submit answer', exact: true }).click();
        assert.equal((await accepted).status(), 200);
        await review.waitFor({ state: 'detached' });
        await screenshot(page, `journey-${size}-05-review-saved.png`, 'Accepted response cleared the card; this empty queue follows a successful read.');
        // Local fault injection checks recovery against the real mounted app.
        await page.route('**/api/attention?*', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"test-only temporary failure"}' }));
        await page.getByRole('button', { name: 'Refresh queue', exact: true }).click();
        await page.getByText(/Loading Needs You could not/).waitFor();
        assert.equal(await page.getByText(/Nothing needs you/).count(), 0);
        await screenshot(page, `journey-${size}-06-queue-recovery.png`, 'Unavailable queue stays distinct from verified empty and offers recovery.');
        await page.unroute('**/api/attention?*');
        await page.getByRole('button', { name: 'Refresh queue', exact: true }).click();
        await page.getByText(/Loading Needs You could not/).waitFor({ state: 'detached' });
        await page.getByRole('button', { name: 'Home', exact: true }).click();
        await page.getByRole('radio', { name: 'Ask', exact: true }).click(); await page.keyboard.press('ArrowRight');
        assert.equal(await page.getByRole('radio', { name: 'Act', exact: true }).getAttribute('aria-checked'), 'true');
        await layout(page);
        if (size === 'desktop') {
          await page.setViewportSize({ width: 768, height: 1024 }); await layout(page);
          await screenshot(page, 'journey-tablet-768.png', '768px intermediate layout, with keyboard selection exercised.');
          await page.setViewportSize(viewport);
          await checkBrowserZoom(url, context);
          // Secondary control reachability; the four journeys above used none.
          await more(page, 'Documents & notes'); await page.getByRole('heading', { name: 'Documents & notes' }).waitFor();
          await more(page, 'Team'); await page.getByRole('heading', { name: 'Team', exact: true }).waitFor();
          await more(page, 'Rooms'); await page.getByRole('heading', { name: 'Evidence Rooms' }).waitFor();
          await more(page, 'Scheduled work'); await page.getByRole('heading', { name: 'Scheduled work', exact: true }).waitFor();
          await page.locator('.primary-nav summary').filter({ hasText: /^More$/ }).click();
          await page.locator('.header-menu-content summary').filter({ hasText: /^Advanced$/ }).click();
          await page.getByRole('button', { name: 'Canvas', exact: true }).click();
          await page.getByRole('button', { name: 'Fit', exact: true }).waitFor();
          await page.getByRole('button', { name: 'Tidy up', exact: true }).waitFor();
        }
        // Keep the intentional empty-team path usable from Home, including
        // when a teammate reaches it without reading the setup instructions.
        await page.getByLabel('Project-space actions').click();
        await layout(page);
        await page.getByRole('button', { name: 'New project space', exact: true }).click();
        assert.equal(await page.getByLabel('Project-space actions').evaluate((el) => el.parentElement.open), false, 'Choosing a space action closes its menu');
        await page.getByLabel('Project-space name').fill('Unstaffed review');
        await page.getByLabel('Starting team').selectOption('custom');
        await page.getByText('No agents selected. Add an agent from Home before asking questions or starting work.', { exact: true }).waitFor();
        await page.getByRole('button', { name: 'Create', exact: true }).click();
        await page.getByRole('button', { name: 'Home', exact: true }).click();
        await page.getByText(/This project space needs an agent/).waitFor();
        await question.fill('What is our ICP?');
        assert.equal(await page.getByRole('button', { name: 'Ask', exact: true }).isEnabled(), false);
        await question.press('Enter');
        await layout(page);
        await page.locator('.primary-nav summary').filter({ hasText: /^More$/ }).click();
        await layout(page);
        await page.locator('.primary-nav summary').filter({ hasText: /^More$/ }).click();
        await screenshot(page, `journey-${size}-07-add-agent.png`, 'An unstaffed space explains why Ask is unavailable and offers Add agent directly from Home.');
        const beforeStaffing = await fixture.snapshot();
        await page.getByRole('button', { name: 'Add agent', exact: true }).click();
        await page.getByRole('button', { name: /^Scout/ }).click();
        await page.getByRole('dialog').waitFor({ state: 'detached' });
        await page.getByText(/This project space needs an agent/).waitFor({ state: 'detached' });
        assert.equal(await question.inputValue(), 'What is our ICP?');
        assert.equal(await page.getByRole('button', { name: 'Ask', exact: true }).isEnabled(), true);
        assert.deepEqual((await fixture.snapshot()).inquiries, beforeStaffing.inquiries, 'Staffing does not submit the retained question');
        await page.getByRole('button', { name: 'Ask', exact: true }).click();
        await page.locator('.answer-card.status-answered').waitFor();
        await screenshot(page, `journey-${size}-08-staffed-answer.png`, 'After adding a template, the retained question submits only on Ask and receives a labelled local test answer.');
        const saved = await fixture.snapshot();
        assert.equal(saved.externalAttempts, 0, 'No external model or connector calls');
        assert.ok(saved.inquiries.some((item) => item.mode === 'ask' && item.status === 'answered'));
        assert.ok(saved.inquiries.some((item) => item.mode === 'act' && item.status === 'answered' && item.question.includes('Selected answer for context')));
        assert.equal(saved.identity.email, local ? 'pete@cloudtechgurus.com' : 'teammate@agent-canvas.invalid');
        assert.equal(saved.identity.role, local ? 'owner' : 'member');
        assert.ok(saved.escalations.some((item) => item.status === 'accepted' && item.owner_email === identity.email));
        assert.ok(saved.decisions.some((item) => item.epistemic === 'verified' && item.content.includes('Yes, prepare a draft checklist for review.')), 'Human decision captured through the existing memory contract');
        evidence.journeys.push({ size, bootCounts, ...saved, result: 'passed' });
        process.stdout.write(`${size}: four ${identity.role} journeys, queue recovery and Home staffing recovery passed\n`);
      } finally { await context?.close(); await fixture.stop(); }
    }
    assert.deepEqual(evidence.browserErrors, [], 'No browser runtime errors');
    fs.writeFileSync(path.join(output, 'manifest.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  } finally { await browser.close(); }
})().catch((error) => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
