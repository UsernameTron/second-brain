'use strict';
const assert = require('node:assert/strict');

module.exports = async function connectionChecks({ page, context, url, fault, newPage, call, shot, layout, evidence }) {
  const open = async (target = page) => {
    await target.getByRole('button', { name: 'Connections', exact: true }).click();
    const dialog = target.getByRole('dialog', { name: 'Connections', exact: true });
    await dialog.getByRole('button', { name: 'Refresh status', exact: true }).waitFor();
    await dialog.getByText('Checking connections and services…', { exact: true }).waitFor({ state: 'hidden' });
    return dialog;
  };
  const dialog = await open();
  const answer = dialog.locator('.connection-overview [data-service="model"]');
  await dialog.getByText('Google Workspace is not set up here', { exact: true }).waitFor();
  assert.equal(await dialog.locator('details[open]').count(), 0);
  assert.equal(await dialog.getByRole('button', { name: 'Check now', exact: true }).count(), 1);
  assert.equal(await dialog.locator('.connection-overview .lamp-ready').count(), 0);
  await shot(page, 'desktop', 'The first view shows the answer service, Google account availability and clear safety limits. Optional service checks, supported functions and Advanced details start closed.');
  evidence.checks.push('Pete sees one primary service check, honest Google setup status and collapsed optional details; configuration alone does not earn a green answer status.');

  // This runs the real probe route and records evidence; ONLY the external
  // model call is the fixture stub already used by the primary journeys.
  await answer.getByRole('button', { name: 'Check now', exact: true }).click();
  await answer.getByText('Checked', { exact: true }).waitFor();
  assert.equal((await call(context, url, '/api/health/integrations')).integrations.find((item) => item.id === 'model').status, 'ready');
  await answer.getByText('Service details', { exact: true }).click();
  await answer.getByText(/Latest check result: passed/).waitFor();
  assert.equal(await answer.getByRole('button', { name: 'Check again', exact: true }).count(), 1);
  evidence.checks.push('An explicit answer-service check reaches the real probe-recording route with a stubbed model; green appears only after the recorded success, and full result/timing remains in Service details.');

  // A rejected request must not reveal the old ready result on the follow-up GET.
  fault.current = (request) => request.url().endsWith('/api/health/probe') ? 503 : 0;
  await answer.getByRole('button', { name: 'Check again', exact: true }).click();
  await answer.getByRole('alert').waitFor();
  await answer.getByText('Status unavailable', { exact: true }).waitFor();
  assert.equal(await dialog.locator('[data-service="model"] .lamp-ready').count(), 0);
  await dialog.getByRole('button', { name: 'Refresh status', exact: true }).click();
  await answer.getByText('Status unavailable', { exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await answer.getByRole('button', { name: 'Check again', exact: true }).scrollIntoViewIfNeeded();
  assert.equal(await answer.getByRole('button', { name: 'Check again', exact: true }).count(), 1);
  assert.ok((await answer.getByRole('button', { name: 'Check again', exact: true }).boundingBox()).height >= 44);
  await shot(page, 'mobile-recovery', 'A failed request keeps its recovery beside the answer service. The previous successful probe cannot remain green after this failure, even when a later read returns that older record.');
  fault.current = null;
  await answer.getByRole('button', { name: 'Check again', exact: true }).click();
  await answer.getByText('Checked', { exact: true }).waitFor();
  evidence.checks.push('Failed probe request masks older successful evidence across Refresh status; the mobile recovery runs a new explicit check and restores confirmed status.');

  // Failed reads likewise invalidate status without hiding the last-known details.
  fault.current = (request) => request.url().endsWith('/api/health/integrations') ? 503 : 0;
  await dialog.getByRole('button', { name: 'Refresh status', exact: true }).click();
  await dialog.getByText('Last known details below. Current status is unavailable.', { exact: true }).waitFor();
  assert.equal(await dialog.locator('.lamp-ready').count(), 0);
  fault.current = null;
  await dialog.getByRole('button', { name: 'Try again', exact: true }).click();
  await answer.getByText('Checked', { exact: true }).waitFor();
  evidence.checks.push('Failed health refresh invalidates every green claim, keeps labelled last-known details and recovers through a read without repeating a probe.');

  // A pending request survives collapsing its disclosure and cannot be duplicated.
  await dialog.locator('.connection-details > summary').click();
  const advancedAnswer = dialog.locator('.sys-board [data-service="model"]');
  await dialog.getByRole('status', { name: 'Systems console', exact: true }).waitFor();
  assert.equal(await dialog.locator('.hud-cell').filter({ has: page.getByText('Model', { exact: true }) }).locator('.lamp-ready').count(), 1);
  let release, started, probePosts = 0;
  const held = new Promise((resolve) => { release = resolve; });
  const sent = new Promise((resolve) => { started = resolve; });
  const holdProbe = async (route) => {
    probePosts += 1; started(); await held; await route.continue();
  };
  await page.route('**/api/health/probe', holdProbe);
  await advancedAnswer.getByRole('button', { name: 'Check again', exact: true }).dblclick();
  await sent;
  assert.equal(await dialog.getByRole('status', { name: 'Systems console', exact: true }).count(), 0);
  assert.equal(await advancedAnswer.getByRole('button', { name: 'Checking…', exact: true }).isDisabled(), true);
  await dialog.locator('.connection-details > summary').click();
  assert.equal(await answer.getByRole('button', { name: 'Checking…', exact: true }).isDisabled(), true);
  await dialog.locator('.connection-details > summary').click();
  assert.equal(await advancedAnswer.getByRole('button', { name: 'Checking…', exact: true }).isDisabled(), true);
  release(); await advancedAnswer.getByText('Checked', { exact: true }).waitFor();
  await dialog.getByRole('status', { name: 'Systems console', exact: true }).waitFor();
  await page.unroute('**/api/health/probe', holdProbe);
  assert.equal(probePosts, 1);
  evidence.checks.push('Double-clicking a check produces one request; both primary and Advanced views show the same pending state through disclosure changes.');

  // Every original service and capability remains reachable, including full raw details.
  const health = await call(context, url, '/api/health/integrations');
  const capabilities = await call(context, url, '/api/capabilities');
  assert.equal(await dialog.locator('.sys-board .service-check').count(), health.integrations.length);
  for (const item of health.integrations) {
    const row = dialog.locator('.sys-board .service-check').filter({ has: page.locator(`code:text-is("${item.id}")`) });
    await row.getByText('Service details', { exact: true }).click();
    assert.ok((await row.textContent()).includes(item.detail));
    if (item.probe) assert.equal(await row.getByRole('button', { name: /Check now|Check again/ }).isEnabled(), true);
  }
  for (const surface of capabilities.surfaces) {
    const details = dialog.locator('.caps-surface').filter({ has: page.getByText(surface.can[0]?.label || surface.cannot[0]?.label, { exact: true }) });
    await details.locator(':scope > summary').click();
    for (const item of [...surface.can, ...surface.cannot]) {
      assert.ok((await details.textContent()).includes(item.label));
      assert.ok((await details.textContent()).includes(item.detail));
    }
  }
  const responsive = async () => {
    await layout(page);
    const result = await dialog.evaluate((element) => {
      const body = element.querySelector('.modal-body'), bounds = body.getBoundingClientRect();
      const visible = (target) => target.checkVisibility();
      const buttons = [...element.querySelectorAll('.service-check button')].filter(visible);
      const boxes = buttons.map((button) => button.getBoundingClientRect());
      const luminance = (color) => {
        const values = color.match(/[\d.]+/g).slice(0, 3).map(Number).map((value) => {
          const c = value / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
        return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
      };
      const cards = [...element.querySelectorAll('.service-check')].filter(visible);
      const contrast = cards.map((card) => {
        const text = getComputedStyle(card.querySelector('.service-status')), background = getComputedStyle(card);
        const a = luminance(text.color), b = luminance(background.backgroundColor);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      });
      return { noClip: body.scrollWidth <= body.clientWidth + 1,
        buttonsFit: boxes.every((box) => box.x >= bounds.x && box.right <= bounds.right && box.height >= 44),
        contrast: Math.min(...contrast) };
    });
    assert.ok(result.noClip && result.buttonsFit, 'Complete 44px check buttons fit the modal without horizontal clipping');
    assert.ok(result.contrast >= 4.5, 'Every visible service status has readable text contrast');
  };
  for (const width of [390, 768, 1280]) { await page.setViewportSize({ width, height: width === 390 ? 844 : 900 }); await responsive(); }
  await page.setViewportSize({ width: 390, height: 844 });
  await advancedAnswer.scrollIntoViewIfNeeded();
  await shot(page, 'mobile-advanced', 'Every original service remains in Advanced details with readable status, complete service reference, full source text and a reachable 44px check control on mobile.');
  evidence.checks.push('All original capability labels/details and service records/check controls remain reachable. At 390/768/1280px the full board wraps, buttons fit and status text exceeds 4.5:1 contrast.');

  // Check native disclosure keyboard behavior and the dialog's actual tab boundary.
  await dialog.locator('.connection-details > summary').click();
  for (const summary of await dialog.locator('details[open] > summary').all()) if (await summary.isVisible()) await summary.click();
  await dialog.getByRole('button', { name: 'Close', exact: true }).focus();
  await page.keyboard.press('Shift+Tab');
  assert.equal(await dialog.locator('.connection-details > summary').evaluate((element) => element === document.activeElement), true);
  await page.keyboard.press('Enter');
  assert.equal(await dialog.locator('.connection-details').getAttribute('open'), '');
  await page.keyboard.press('Tab');
  assert.equal(await advancedAnswer.getByRole('button', { name: 'Check again', exact: true }).evaluate((element) => element === document.activeElement), true);
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await page.getByRole('button', { name: 'Connections', exact: true }).evaluate((element) => element === document.activeElement), true);
  evidence.checks.push('Shift+Tab wraps to the last visible disclosure; Enter expands it, Tab reaches its real check button, and Escape restores focus to Connections.');

  await page.getByRole('button', { name: 'Account', exact: true }).click();
  await page.getByRole('button', { name: 'Appearance: switch to dark', exact: true }).click();
  await page.getByRole('button', { name: 'Account', exact: true }).click();
  await open(); await responsive();
  await shot(page, 'mobile-dark', 'The simplified account and answer checks retain readable text and complete controls in dark mode.');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Account', exact: true }).click();
  await page.getByRole('button', { name: 'Appearance: switch to light', exact: true }).click();
  await page.getByRole('button', { name: 'Account', exact: true }).click();
  await open();
  await shot(page, 'mobile', 'Mobile Connections starts with readable account access and an answer-service check; all additional functions and diagnostics are available through named disclosures.');
  await page.keyboard.press('Escape');
  evidence.checks.push('Light and dark mobile views retain 4.5:1 status contrast and complete primary controls.');

  const member = await newPage('teammate@agent-canvas.invalid');
  await member.page.setViewportSize({ width: 390, height: 844 });
  const memberDialog = await open(member.page);
  assert.equal(await memberDialog.getByRole('button', { name: 'Check now', exact: true }).isEnabled(), true);
  await memberDialog.getByText('Advanced details', { exact: true }).click();
  assert.equal(await memberDialog.locator('.sys-board .service-check').count(), health.integrations.length);
  await member.page.keyboard.press('Escape');
  evidence.checks.push('The fictional member retains both primary checks and the full Advanced service board; no new owner-only restriction was introduced.');
  await member.context.close();

  // Response fixtures exercise unreadable/empty configuration and the Google
  // recovery interface. No Google authentication or external request occurs.
  let capsReply = { connected: false }, healthReply = { integrations: [null] };
  await page.route('**/api/capabilities', (route) => route.fulfill({ json: capsReply }));
  await page.route('**/api/health/integrations', (route) => route.fulfill({ json: healthReply }));
  await open();
  await dialog.getByText(/Loading your connections could not/).waitFor();
  await dialog.getByText(/Checking system status could not/).waitFor();
  assert.equal(await dialog.getByText('Google Workspace is not set up here', { exact: true }).count(), 0);
  assert.equal(await dialog.locator('.lamp-ready').count(), 0);
  capsReply = { connected: false, oauthReady: false, surfaces: [] }; healthReply = { integrations: [] };
  await dialog.getByRole('button', { name: 'Refresh status', exact: true }).click();
  await dialog.getByText(/No service checks were returned/).waitFor();
  await dialog.getByText(/No function details were returned/).waitFor();
  assert.equal(await dialog.getByRole('alert').count(), 0);
  await shot(page, 'mobile-empty', 'A complete empty response gets an explicit no-details message and Refresh status. Malformed responses earlier showed separate errors instead of pretending nothing was configured.');
  evidence.checks.push('Malformed connection/service responses fail visibly without invented configuration or green checks; explicit refresh distinguishes a valid empty response from failure.');

  capsReply = { ...capabilities, oauthReady: true, connected: false }; healthReply = health;
  await dialog.getByRole('button', { name: 'Refresh status', exact: true }).click();
  await dialog.getByRole('button', { name: 'Connect Google Workspace', exact: true }).waitFor();
  // The fixture has no Google OAuth configuration: its real route rejects this.
  await dialog.getByRole('button', { name: 'Connect Google Workspace', exact: true }).click();
  await dialog.getByText(/Updating the connection could not/).waitFor();
  await dialog.getByText('Google connection status is not confirmed', { exact: true }).waitFor();
  await dialog.getByRole('button', { name: 'Check status', exact: true }).click();
  await dialog.getByText('Workspace not connected', { exact: true }).waitFor();
  assert.equal(await dialog.getByRole('alert').count(), 0);
  assert.equal(page.url(), `${url}/`);
  await page.keyboard.press('Escape');
  await page.unrouteAll({ behavior: 'wait' });
  evidence.checks.push('A simulated available Google account button receives the real fixture server’s unconfigured response; the user stays on Connections with status recovery, and no OAuth or external call is made.');
};
