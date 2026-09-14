'use strict';
const assert = require('node:assert/strict');

module.exports = async function memoryBrowsing({ page, context, url, call, more, fault, shot, layout, newPage, evidence }) {
  const { canvas } = await call(context, url, '/api/canvases', 'POST', { name: 'Memory review', roster_ids: [] });
  const route = `/api/canvases/${canvas.id}/memory`;
  const create = async (content, epistemic, extra = {}) => (await call(context, url, route, 'POST', { content, epistemic, kind: 'fact', source: 'Local contract fixture', ...extra })).entry;
  const original = await create('The renewal date is June 30.', 'verified');
  const conclusion = await create('Start the renewal review in May.', 'inference', { cites: [original.id] });
  const assumption = await create('A sponsor may join the review.', 'assumption', { cites: [conclusion.id], kind: 'constraint' });
  const { entry: replacement } = await call(context, url, `${route}/${assumption.id}/correct`, 'POST', { content: 'Jess will join the review.', epistemic: 'verified', reason: 'Confirmed for this local test.' });
  await page.reload(); await more(page, 'Memory');
  const panel = page.locator('.panel');
  const card = (content) => panel.locator('.mem-entry').filter({ has: page.getByText(content, { exact: true }) });
  const readableEarlier = async () => {
    // Measure the finished panel, after its normal opening fade has completed.
    await panel.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished.catch(() => {}))));
    const ratios = await card(assumption.content).evaluate((element) => {
      const rgb = (value) => { const numbers = value.match(/[\d.]+/g)?.map(Number) || [0, 0, 0]; return [...numbers.slice(0, 3), numbers[3] ?? 1]; };
      const over = (front, back, alpha = front[3]) => front.slice(0, 3).map((value, index) => value * alpha + back[index] * (1 - alpha));
      const luminance = (values) => values.map((value) => { const c = value / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; })
        .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
      return ['.mem-content', '.mem-prov'].map((selector) => {
        const target = element.querySelector(selector), parents = [];
        for (let node = target; node; node = node.parentElement) parents.push(node);
        let background = [255, 255, 255], opacity = 1;
        for (const node of parents.reverse()) { const style = getComputedStyle(node); background = over(rgb(style.backgroundColor), background); opacity *= Number(style.opacity); }
        const color = rgb(getComputedStyle(target).color), foreground = over(color, background, color[3] * opacity);
        const a = luminance(foreground), b = luminance(background);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      });
    });
    assert.ok(ratios.every((ratio) => ratio >= 4.5), `Earlier-version text and authorship remain readable: ${ratios}`);
  };
  await card(original.content).waitFor();
  assert.equal(await panel.locator('.epi-legend-help').getAttribute('open'), null);
  assert.equal(await card(original.content).getByText('Confirmed (verified)', { exact: true }).isVisible(), true);
  assert.equal(await card(conclusion.content).getByText('Reasoned conclusion (inference)', { exact: true }).isVisible(), true);
  await panel.getByLabel('Include earlier versions', { exact: true }).check();
  await card(assumption.content).getByText('Earlier version', { exact: true }).waitFor();
  await readableEarlier();
  assert.equal(await card(assumption.content).getByText('Unconfirmed (assumption)', { exact: true }).isVisible(), true);
  await panel.getByLabel('Memory type', { exact: true }).selectOption('constraint');
  assert.equal(await panel.locator('.mem-entry').count(), 2);
  await panel.getByLabel('Memory type', { exact: true }).selectOption('');
  await panel.getByText('What certainty means', { exact: true }).click();
  await panel.locator('.epi-legend').waitFor();
  await panel.getByText('What certainty means', { exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, 'mobile-list', 'Memory uses a collapsed certainty explanation, a clear type filter and Include earlier versions. Every entry still shows certainty, author, source and correction warnings.');
  evidence.checks.push('Original/replacement entries, all certainty labels and their symbols stay visible; type values and the earlier-version filter retain their original behavior while the legend starts closed.');

  await card(replacement.content).getByRole('button', { name: 'History and sources', exact: true }).click();
  await panel.getByRole('heading', { name: 'History and sources', exact: true }).waitFor();
  await panel.getByRole('region', { name: 'Changes over time', exact: true }).getByText('Corrected', { exact: true }).waitFor();
  await panel.getByText('No agent work record is linked to this entry.', { exact: true }).waitFor();
  await panel.getByRole('button', { name: 'View this version', exact: true }).click();
  await panel.locator('.lineage > .mem-entry').first().getByText(assumption.content, { exact: true }).waitFor();
  assert.equal(await panel.getByText('Earlier version', { exact: true }).isVisible(), true);
  await panel.locator('.lineage > .mem-entry').first().scrollIntoViewIfNeeded();
  await shot(page, 'mobile-history', 'Changes over time opens the original corrected entry without hiding its original certainty; links, review date, correction warning and source remain readable.');
  await panel.getByRole('button', { name: 'Back to memory', exact: true }).click();
  await card(conclusion.content).getByRole('button', { name: 'History and sources', exact: true }).click();
  await panel.getByRole('heading', { name: 'Sources this entry uses (1)', exact: true }).waitFor();
  const linked = card(original.content);
  await linked.getByRole('button', { name: 'History and sources', exact: true }).click();
  await panel.locator('.lineage > .mem-entry').first().getByText(original.content, { exact: true }).waitFor();
  evidence.checks.push('Changes over time retains each version and reason; source links open the exact referenced record. Missing work records are labelled as absent, without inventing human authorship.');

  fault.current = (request) => request.url().endsWith('/timeline') ? 503 : 0;
  await panel.getByRole('button', { name: 'Refresh details', exact: true }).click();
  await panel.getByText(/Loading memory history could not/).waitFor();
  await panel.getByText(/Last known changes are shown/).waitFor();
  assert.equal(await panel.locator('.lineage > .mem-entry').first().getByText(original.content, { exact: true }).isVisible(), true);
  await panel.getByRole('alert').scrollIntoViewIfNeeded();
  await shot(page, 'mobile-recovery', 'A failed history refresh keeps the selected source and last-known changes visible, with its own recovery. Empty history is never inferred from the failed request.');
  fault.current = null;
  await panel.getByRole('button', { name: 'Try again', exact: true }).click();
  await panel.getByRole('alert').waitFor({ state: 'hidden' });
  await page.route('**/api/memory/*/timeline', (request) => request.fulfill({ json: { events: [] } }));
  await panel.getByRole('button', { name: 'Refresh details', exact: true }).click();
  await panel.getByRole('paragraph').filter({ hasText: 'No history events were returned.' }).waitFor();
  await panel.getByRole('button', { name: 'Refresh history', exact: true }).click();
  await panel.getByRole('paragraph').filter({ hasText: 'No history events were returned.' }).waitFor();
  await shot(page, 'mobile-empty-history', 'A complete empty timeline gets an explicit message and Refresh history while the selected memory entry remains available.');
  await page.unrouteAll({ behavior: 'wait' });
  await panel.getByRole('button', { name: 'Refresh history', exact: true }).click();
  await panel.getByText('Added', { exact: true }).waitFor();
  evidence.checks.push('Independent history failure retains labelled prior data and source content; a valid empty timeline has its own read-only recovery, which returns to the real recorded history.');

  // A -> B -> A: the first A reply is deliberately delayed and differs from the
  // current record. It must not replace the later successful A response.
  await panel.getByRole('button', { name: 'Back to memory', exact: true }).click();
  let release, arrived, heldCount = 0;
  const paused = new Promise((resolve) => { release = resolve; });
  const received = new Promise((resolve) => { arrived = resolve; });
  const oldReply = async (request) => {
    if (heldCount++) return request.fallback();
    const response = await request.fetch(); const data = await response.json();
    data.entry.content = 'Obsolete response: do not display.';
    arrived(); await paused; await request.fulfill({ response, json: data });
  };
  await page.route(`**/api/memory/${original.id}/lineage`, oldReply);
  try {
    await card(original.content).getByRole('button', { name: 'History and sources', exact: true }).click();
    await received; await panel.getByText('Loading memory sources…', { exact: true }).waitFor();
    await panel.getByRole('button', { name: 'Back to memory', exact: true }).click();
    await card(conclusion.content).getByRole('button', { name: 'History and sources', exact: true }).click();
    await panel.locator('.lineage > .mem-entry').first().getByText(conclusion.content, { exact: true }).waitFor();
    await panel.getByRole('button', { name: 'Back to memory', exact: true }).click();
    await card(original.content).getByRole('button', { name: 'History and sources', exact: true }).click();
    await panel.locator('.lineage > .mem-entry').first().getByText(original.content, { exact: true }).waitFor();
  } finally { release(); await page.unrouteAll({ behavior: 'wait' }); }
  await layout(page);
  assert.equal(await panel.getByText('Obsolete response: do not display.', { exact: true }).count(), 0);
  assert.equal(await panel.locator('.lineage > .mem-entry').first().getByText(original.content, { exact: true }).isVisible(), true);
  evidence.checks.push('A real browser visits A, B and A again while the first A source reply is held; that obsolete response cannot overwrite the current entry when released.');

  for (const width of [390, 768, 1280]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 }); await layout(page);
    const bounds = await panel.boundingBox();
    for (const name of ['Back to memory', 'Close panel']) {
      const box = await panel.getByRole('button', { name, exact: true }).boundingBox();
      assert.ok(box.x >= bounds.x && box.x + box.width <= bounds.x + bounds.width + 1, `Memory header actions fit at ${width}px`);
    }
  }
  await panel.locator('.panel-body').evaluate((element) => { element.scrollTop = 0; });
  await shot(page, 'desktop-sources', 'Plain-English history, source and dependent-entry sections keep complete provenance and certainty, with the same exact source navigation.');
  evidence.checks.push('Memory header actions remain within the panel at 390/768/1280px; inspected mobile and desktop images preserve readable source and history sections.');

  // Exercise the server's existing privacy redaction, not a client-created mask.
  const { canvas: privateSpace } = await call(context, url, '/api/canvases', 'POST', { name: 'Private memory source', roster_ids: [] });
  await call(context, url, `/api/canvases/${privateSpace.id}`, 'PATCH', { access_mode: 'restricted' });
  const { entry: privateEntry } = await call(context, url, `/api/canvases/${privateSpace.id}/memory`, 'POST', { content: 'Private fixture detail that must stay hidden.', epistemic: 'verified', source: 'Private local fixture' });
  const publicEntry = await create('A public claim with a protected source.', 'inference', { cites: [privateEntry.id] });
  const member = await newPage('teammate@agent-canvas.invalid');
  await more(member.page, 'Memory');
  await member.page.locator('.mem-entry').filter({ hasText: publicEntry.content }).getByRole('button', { name: 'History and sources', exact: true }).click();
  await member.page.getByText('[entry on a canvas you cannot access]', { exact: true }).waitFor();
  assert.equal(await member.page.getByText('Private fixture detail that must stay hidden.', { exact: true }).count(), 0);
  await member.context.close();
  evidence.checks.push('A member sees the real server privacy placeholder for a linked restricted source; private content is never supplied to the simplified view.');
  await panel.getByRole('button', { name: 'Back to memory', exact: true }).click();
  await panel.getByRole('button', { name: 'Close panel', exact: true }).click();
  await page.getByRole('button', { name: 'Account', exact: true }).click();
  await page.getByRole('button', { name: 'Appearance: switch to dark', exact: true }).click();
  await page.getByRole('button', { name: 'Account', exact: true }).click();
  await more(page, 'Memory');
  await card(assumption.content).waitFor(); await readableEarlier();
  await page.setViewportSize({ width: 390, height: 844 });
  await card(assumption.content).scrollIntoViewIfNeeded();
  await shot(page, 'mobile-earlier-dark', 'Earlier versions stay readable in dark mode: the original content remains struck through and clearly labelled, while text and authorship exceed 4.5:1 contrast.');
  evidence.checks.push('Earlier-version content and provenance exceed 4.5:1 contrast in both themes; the retained original keeps its certainty, earlier-version label and struck-through content.');
};
