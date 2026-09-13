'use strict';
const assert = require('node:assert/strict');

module.exports = async function reviewClarity({ context: ownerContext, url, newPage, call, seedReview, shot, layout, evidence }) {
  const { roster } = await call(ownerContext, url, '/api/roster');
  const roster_ids = roster.filter((r) => ['scout', 'darren'].includes(r.template_key)).map((r) => r.id);
  const spaces = [];
  for (const name of ['Review test first', 'Review test second', 'Review test private']) {
    spaces.push((await call(ownerContext, url, '/api/canvases', 'POST', { name, roster_ids })).canvas.id);
  }
  await call(ownerContext, url, `/api/canvases/${spaces[2]}`, 'PATCH', { access_mode: 'restricted' });
  const rules = [];
  for (const instruction of ['Review test scheduled alert', 'Review test scheduled brief']) {
    rules.push((await call(ownerContext, url, `/api/canvases/${spaces[1]}/standing-rules/parse`, 'POST', { instruction })).rule.id);
  }
  const ids = await seedReview({ spaces, rules, decisionContext: true });
  const { page, context } = await newPage('teammate@agent-canvas.invalid');
  // The card and its source references must work outside the currently selected space.
  await page.getByLabel('Switch project space').selectOption(spaces[0]);
  await page.getByRole('button', { name: /^Needs you/ }).click();
  const card = page.locator('.ny-card').filter({ hasText: 'Review test second-space answer?' });
  const details = card.locator('.review-details');
  const contextArea = card.getByRole('region', { name: 'Decision context' });
  await contextArea.waitFor();
  assert.equal(await details.getAttribute('open'), null);
  for (const text of ['annual price: 0', 'approved: no', 'approved: yes', 'sponsor: (not set)', 'notes: (empty text)', 'terms / legal / reviewer: Pete', 'terms / legal / discount pct: 12', 'approval limit: 1500', 'Keep the original renewal date unchanged?']) {
    assert.ok((await contextArea.textContent()).includes(text), `Default context retains ${text}`);
  }
  assert.equal((await contextArea.textContent()).includes('local-review-reference'), false);
  assert.equal((await contextArea.textContent()).includes('local-model-stub'), false);
  assert.ok(await card.getByRole('button', { name: 'Answer', exact: true }).isEnabled());
  await card.evaluate((element) => { const region = element.closest('.needs-you'); region.scrollTop += element.getBoundingClientRect().top - region.getBoundingClientRect().top; });
  await shot(page, 'desktop', 'The main review card shows current/proposed terms, exact nested values, related questions and readable memory links; technical context starts collapsed.');
  const current = contextArea.locator('.review-change').first(), proposed = contextArea.locator('.review-change').last();
  const left = await current.boundingBox(), right = await proposed.boundingBox();
  assert.ok(right.x > left.x && Math.abs(right.y - left.y) < 2, 'Desktop before/after values appear side by side');
  evidence.checks.push('Decision-critical current/proposed values, zero/false/null/cleared text, unknown policy fields and related questions remain visible before Answer; work/model IDs are in Full details.');

  await card.getByText('Full details', { exact: true }).focus();
  await page.keyboard.press('Enter');
  assert.notEqual(await details.getAttribute('open'), null);
  assert.ok((await details.textContent()).includes('local-review-reference'));
  assert.ok((await details.textContent()).includes('local-model-stub'));
  assert.ok((await details.textContent()).includes(ids.conflicts[0]));
  await page.keyboard.press('Enter');
  assert.equal(await details.getAttribute('open'), null);
  await card.getByRole('button', { name: 'Memory item 2', exact: true }).click();
  const source = page.locator('.lineage > .mem-entry').first();
  await source.getByText('Local contract renews in July.', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Switch project space').inputValue(), spaces[0]);
  await page.getByRole('button', { name: 'Close panel', exact: true }).click();
  evidence.checks.push('Full details opens/closes with the keyboard and retains exact routing/source IDs; the second memory link opens the referenced entry without changing the active project.');

  await page.getByRole('button', { name: /^Needs you/ }).focus();
  await page.setViewportSize({ width: 390, height: 844 });
  const top = await current.boundingBox(), below = await proposed.boundingBox();
  assert.ok(below.y >= top.y + top.height, 'Mobile before/after values stack in reading order');
  await card.evaluate((element) => { const region = element.closest('.needs-you'); region.scrollTop += element.getBoundingClientRect().top - region.getBoundingClientRect().top; }); await shot(page, 'mobile', 'Mobile review values stack in reading order with all decision context available by scrolling, and technical details kept collapsed.');
  const mobileAnswer = card.getByRole('button', { name: 'Answer', exact: true });
  assert.ok((await mobileAnswer.boundingBox()).height >= 44, 'The mobile Answer control has a full touch target');
  await mobileAnswer.scrollIntoViewIfNeeded();
  await shot(page, 'mobile-answer', 'After reading the mobile context, Answer is a clear touch target beside Other actions; supporting memory and Full details remain available.');
  await page.setViewportSize({ width: 768, height: 900 }); await layout(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await card.getByRole('button', { name: 'Answer', exact: true }).click();
  await card.getByLabel('Your answer').fill('Keep these reviewed terms as a draft for human review.');
  await card.getByRole('button', { name: 'Submit answer', exact: true }).click();
  await card.waitFor({ state: 'detached' });
  const queue = (await call(context, url, '/api/attention?scope=all')).attention;
  assert.ok(!queue.some((row) => row.sourceRef.id === ids.answer));
  assert.ok(queue.some((row) => row.sourceRef.id === ids.first));
  evidence.checks.push('390/768/1280px layout checks pass; a fictional member answers the reviewed card through the normal route without Advanced, leaving the other review items untouched.');
};
