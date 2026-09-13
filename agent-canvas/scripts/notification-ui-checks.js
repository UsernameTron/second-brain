'use strict';
const assert = require('node:assert/strict');

module.exports = async function notificationChecks({ page: ownerPage, context: ownerContext, url, newPage, call, seedReview, fault, shot, layout, evidence }) {
  const email = 'teammate@agent-canvas.invalid';
  const { roster } = await call(ownerContext, url, '/api/roster');
  const roster_ids = roster.filter((row) => ['scout', 'darren'].includes(row.template_key)).map((row) => row.id);
  const spaces = [];
  for (const name of ['Review test first', 'Review test second', 'Review test private']) {
    spaces.push((await call(ownerContext, url, '/api/canvases', 'POST', { name, roster_ids })).canvas.id);
  }
  await call(ownerContext, url, `/api/canvases/${spaces[2]}`, 'PATCH', { access_mode: 'restricted' });
  await call(ownerContext, url, `/api/canvases/${spaces[1]}/people`, 'POST', { email });
  const rules = [];
  for (const instruction of ['Review test scheduled alert', 'Review test scheduled brief']) {
    rules.push((await call(ownerContext, url, `/api/canvases/${spaces[1]}/standing-rules/parse`, 'POST', { instruction })).rule.id);
  }
  const ids = await seedReview({ spaces, rules });
  const { page, context } = await newPage(email);
  const bar = page.getByRole('region', { name: 'Recent updates', exact: true });
  const card = (question) => page.locator('.ny-card').filter({ hasText: question });
  const setAppearance = async (theme) => {
    await page.getByRole('button', { name: 'Account', exact: true }).click();
    await page.getByRole('button', { name: `Appearance: switch to ${theme}`, exact: true }).click();
    await page.getByRole('button', { name: 'Account', exact: true }).click();
  };
  const readableUpload = async () => {
    const result = await page.locator('.file-upload-status').evaluate((element) => {
      const style = getComputedStyle(element), text = element.querySelector('span');
      const luminance = (color) => {
        const values = color.match(/[\d.]+/g).slice(0, 3).map(Number).map((value) => {
          const channel = value / 255;
          return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        });
        return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
      };
      const foreground = luminance(style.color), background = luminance(style.backgroundColor);
      return { contrast: (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05),
        unclipped: text.scrollWidth <= text.clientWidth + 1 && text.scrollHeight <= text.clientHeight + 1 };
    });
    assert.ok(result.contrast >= 4.5, 'Upload feedback has readable text contrast');
    assert.ok(result.unclipped, 'The complete upload message wraps without clipping');
  };
  await page.getByLabel('Switch project space').selectOption(spaces[0]);
  await page.setViewportSize({ width: 390, height: 844 });

  // A real rejected upload exercises App's notification API and its separate,
  // persistent recovery. The long response is only a local network fixture.
  const explanation = `This local upload test cannot be completed. ${'The original document remains on your computer. '.repeat(14)}Use Retry upload when the connection is ready.`;
  await page.route(/\/api\/canvases\/[^/]+\/files(?:\?|$)/, (route) => route.request().method() === 'POST'
    ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: explanation }) }) : route.fallback());
  await page.getByLabel('Choose a document to add to this canvas').setInputFiles({ name: 'notification-test.txt', mimeType: 'text/plain', buffer: Buffer.from('A disposable local document.') });
  await page.getByRole('button', { name: 'Retry upload', exact: true }).waitFor();
  await bar.getByRole('button', { name: 'Details', exact: true }).click();
  await page.unrouteAll({ behavior: 'wait' });
  await readableUpload(); await setAppearance('dark'); await readableUpload(); await setAppearance('light');
  await page.getByRole('button', { name: /^Needs you/ }).click();
  await page.getByRole('tab', { name: 'All', exact: true }).click();
  const assignment = card('Review test owner answer?');
  await assignment.getByText('Other actions', { exact: true }).click();
  const second = await call(context, url, `/api/canvases/${spaces[1]}`);
  const agent = second.agents.find((row) => row.name === 'Darren');
  for (const [value, label] of [[`p:${email}`, `→ ${email}`], [`a:${agent.id}`, '→ Darren'], ['clear', 'Unassigned']]) {
    await assignment.getByLabel('Assign this item').selectOption(value);
    await assignment.getByText(label, { exact: true }).waitFor();
  }
  await page.waitForFunction(() => document.querySelectorAll('.notification-list li').length === 4);
  assert.equal(await bar.locator('.notification-summary').count(), 1);
  assert.ok((await bar.locator('.notification-message').textContent()).includes('Problem:'));
  assert.equal(await bar.getByRole('listitem').first().textContent(), `Problem: ${explanation}`);
  await page.waitForTimeout(5000); // Older messages must not expire while their details are being read.
  assert.equal(await bar.getByRole('listitem').count(), 4);
  await bar.getByRole('list').evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await shot(page, 'mobile-details', 'All four updates remain in a scrollable details list after the normal expiry; the original upload problem stays in the compact headline despite later successful assignments.');
  evidence.checks.push('Real failed upload plus three successful assignments produce one notice; every complete message remains readable beyond normal expiry, and the problem retains headline priority.');

  // Leave the update list open while arranging the form, then verify the compact
  // strip leaves the complete primary recovery action above it at every size.
  const answer = card('Review test first-space answer?');
  await answer.getByRole('button', { name: 'Answer', exact: true }).click();
  const draft = 'Keep this local answer for human review.';
  await answer.getByLabel('Your answer').fill(draft);
  fault.current = (request) => request.url().endsWith(`/escalations/${ids.first}/resolve`) ? 503 : 0;
  await answer.getByRole('button', { name: 'Submit answer', exact: true }).click();
  await answer.getByRole('alert').waitFor();
  await bar.getByRole('button', { name: 'Hide details', exact: true }).click();
  const toggle = bar.getByRole('button', { name: 'Details (4)', exact: true });
  // Keyboard focus pauses expiry while checking geometry; it never moves on its own.
  await toggle.focus();
  const action = answer.getByRole('button', { name: 'Check status', exact: true });
  for (const width of [390, 768, 1280]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await action.scrollIntoViewIfNeeded();
    await layout(page);
    const bounds = await bar.boundingBox(), target = await action.boundingBox();
    assert.ok(bounds.height <= 65, `Collapsed feedback remains compact at ${width}px`);
    assert.ok(target.y >= 0 && target.y + target.height <= bounds.y, `Recovery remains above feedback at ${width}px`);
    assert.ok(await action.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    }), 'The recovery control receives its own pointer');
    if (width !== 768) await shot(page, width === 390 ? 'mobile-answer' : 'desktop', 'One compact update strip leaves the answer draft and its recovery controls usable; dismissed notifications cannot clear the failed answer or upload.');
  }
  evidence.checks.push('At 390/768/1280px a four-message burst stays in one strip under 65px; the failed answer recovery is wholly above it and receives its pointer.');

  await page.setViewportSize({ width: 390, height: 844 });
  await answer.getByLabel('Your answer').focus();
  await toggle.focus(); await page.keyboard.press('Enter');
  assert.equal(await bar.getByRole('button', { name: 'Hide details', exact: true }).getAttribute('aria-expanded'), 'true');
  await page.keyboard.press('Tab');
  assert.ok(await bar.getByRole('button', { name: 'Dismiss updates' }).evaluate((element) => element === document.activeElement));
  await page.keyboard.press('Enter');
  await bar.waitFor({ state: 'hidden' });
  assert.ok(await answer.getByLabel('Your answer').evaluate((element) => element === document.activeElement));
  assert.equal(await answer.getByLabel('Your answer').inputValue(), draft);
  await answer.getByRole('alert').waitFor();
  await page.getByRole('button', { name: 'Retry upload', exact: true }).waitFor();
  fault.current = null;
  await answer.getByRole('button', { name: 'Check status', exact: true }).click();
  await answer.getByRole('button', { name: 'Submit answer', exact: true }).click();
  await answer.waitFor({ state: 'detached' });
  assert.equal((await call(context, url, `/api/canvases/${spaces[0]}`)).escalations.find((item) => item.id === ids.first).status, 'accepted');
  evidence.checks.push('Keyboard Details/Dismiss restores focus to the answer; dismissal retains both durable recoveries and the draft, which succeeds only through an explicit subsequent submission.');

  await page.getByRole('button', { name: 'Retry upload', exact: true }).click();
  await page.locator('.file-upload-status.is-success').waitFor();
  await page.getByRole('link', { name: 'Download original', exact: true }).waitFor();
  await readableUpload(); await shot(page, 'mobile-upload-light', 'The saved document has a readable, wrapping confirmation in light mode; its original download remains available.');
  await setAppearance('dark'); await readableUpload();
  await shot(page, 'mobile-upload-dark', 'The same confirmed document and feedback retain readable text in dark mode.');
  assert.equal((await call(context, url, `/api/canvases/${spaces[0]}`)).files.length, 1);
  evidence.checks.push('Upload failure and success text exceed 4.5:1 contrast and wrap without clipping in light and dark themes; explicit Retry upload saves exactly one document.');
  await bar.getByRole('button', { name: /^Details/ }).click();
  await page.getByRole('button', { name: 'Close document details', exact: true }).click();
  await page.getByRole('button', { name: 'Account', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByLabel('Development sign-in').waitFor();
  assert.equal(await page.getByRole('region', { name: 'Recent updates' }).count(), 0);
  evidence.checks.push('Confirmed sign-out clears expanded feedback so messages do not carry into another session.');

  // Exercise a dialog in the same resized work area while feedback is present.
  await ownerPage.reload();
  await ownerPage.getByRole('button', { name: 'Pause', exact: true }).click();
  const ownerBar = ownerPage.getByRole('region', { name: 'Recent updates' });
  await ownerBar.getByRole('button', { name: 'Details', exact: true }).click();
  await ownerPage.getByRole('button', { name: 'Connections', exact: true }).click();
  await ownerPage.setViewportSize({ width: 390, height: 844 });
  await ownerPage.getByRole('dialog').waitFor();
  await shot(ownerPage, 'mobile-dialog', 'The Connections dialog stays above expanded updates; its close and recovery controls remain in the reserved work area. Global Pause was exercised only in this disposable fixture.');
  await ownerPage.keyboard.press('Escape');
  await ownerPage.getByRole('dialog').waitFor({ state: 'hidden' });
  await ownerBar.getByRole('button', { name: 'Dismiss updates' }).click();
  await ownerPage.getByRole('button', { name: 'Resume', exact: true }).first().click();
  assert.equal((await call(ownerContext, url, '/api/healthz')).paused, false);
  evidence.checks.push('A mobile Connections dialog and global Pause/Resume remain usable with expanded feedback; no notification covers the dialog.');
};
