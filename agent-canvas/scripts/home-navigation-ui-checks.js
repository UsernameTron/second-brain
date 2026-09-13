'use strict';
const assert = require('node:assert/strict');

module.exports = async function homeNavigation({ page, context, url, call, more, shot, evidence }) {
  const hold = async (outcome = 'success') => {
    let seen, release;
    const started = new Promise((resolve) => { seen = resolve; });
    const gate = new Promise((resolve) => { release = resolve; });
    const handler = async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      const response = outcome === 'rejected' ? null : await route.fetch();
      if (response) assert.ok(response.ok(), 'The fixture inquiry must be accepted');
      seen(); await gate;
      if (outcome === 'lost') return route.abort('connectionreset');
      if (outcome === 'rejected') return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Local acceptance fault' }) });
      return route.fulfill({ response });
    };
    await page.route('**/inquiries', handler);
    const matches = (request) => request.method() === 'POST' && request.url().endsWith('/inquiries');
    return { started, finish: async () => {
      const finished = outcome === 'lost' ? page.waitForEvent('requestfailed', { predicate: matches }) : page.waitForResponse((response) => matches(response.request()));
      // Each helper owns the only page-level route. Drain active handlers
      // before removing it; a response event can arrive before fulfill ends.
      release(); await finished; await page.unrouteAll({ behavior: 'wait' });
    } };
  };
  const home = () => page.getByRole('button', { name: 'Home', exact: true }).click();
  const create = async (name) => {
    await page.getByLabel('Project-space name').fill(name);
    await page.getByLabel('Starting team').selectOption('revenue');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await page.getByRole('heading', { name: 'Ask the company.' }).waitFor();
  };
  await page.getByRole('button', { name: 'Create a project space', exact: true }).click();
  await create('First request space');
  await page.getByLabel('Project-space actions', { exact: true }).click();
  await page.getByRole('button', { name: 'New project space', exact: true }).click();
  await create('Second request space');
  const { canvases } = await call(context, url, '/api/canvases');
  const first = canvases.find((space) => space.name === 'First request space').id;
  const second = canvases.find((space) => space.name === 'Second request space').id;
  await page.getByLabel('Switch project space').selectOption(first);
  const question = page.getByLabel('Ask a question about the company');
  const saved = async (cid = first) => (await call(context, url, `/api/canvases/${cid}/inquiries`)).inquiries;

  const accepted = await hold();
  await question.fill('Keep track of this request while I navigate.');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await accepted.started;
  await more(page, 'Help'); await home();
  assert.ok(await page.getByRole('button', { name: 'Sending…', exact: true }).isDisabled());
  assert.ok(await question.isDisabled());
  await shot(page, 'pending', 'After leaving Home and returning, the accepted request still awaits its response and cannot be submitted again.');
  await page.getByLabel('Switch project space').selectOption(second);
  await question.fill('This other project has its own draft.');
  await accepted.finish();
  assert.equal(await question.inputValue(), 'This other project has its own draft.');
  await page.getByLabel('Switch project space').selectOption(first);
  await page.getByRole('button', { name: 'Ask', exact: true }).waitFor();
  assert.equal(await question.inputValue(), '');
  assert.equal((await saved()).length, 1); assert.equal((await saved(second)).length, 0);
  evidence.checks.push('Pending Home request survives Help/Home navigation, blocks repeated submission, finishes against its originating space and leaves the other project draft untouched.');

  const lost = await hold('lost');
  await question.fill('Recover the confirmation lost while Home was closed.');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await lost.started; await more(page, 'Help'); await lost.finish(); await home();
  await page.getByText(/Sending your request is not confirmed/).waitFor();
  assert.equal(await question.inputValue(), 'Recover the confirmation lost while Home was closed.');
  assert.ok(await page.getByRole('button', { name: 'Ask', exact: true }).isDisabled());
  await page.getByRole('button', { name: 'Check status', exact: true }).click();
  await page.locator('.answer-question').filter({ hasText: /^Recover the confirmation lost while Home was closed\.$/ }).waitFor();
  assert.equal((await saved()).length, 2);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.home-view').evaluate((element) => element.scrollTo(0, 0));
  await shot(page, 'unconfirmed-mobile', 'A response lost while Home is closed remains explicitly unconfirmed on return; Check status recovers the one saved answer without repeating it.');
  await page.getByRole('button', { name: 'I checked the answers; keep editing', exact: true }).click();
  await page.setViewportSize({ width: 1280, height: 900 });
  evidence.checks.push('A lost response received offscreen remains unconfirmed on return, retains its question, blocks another submission and supports read-only status recovery at 390px.');

  const rejected = await hold('rejected');
  await question.fill('Retry only after this rejected request returns.');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await rejected.started;
  await page.getByLabel('Switch project space').selectOption(second);
  await rejected.finish();
  assert.equal(await page.getByText(/Sending your request could not be completed/).count(), 0);
  assert.equal(await question.inputValue(), 'This other project has its own draft.');
  await page.getByLabel('Switch project space').selectOption(first);
  await page.getByText(/Sending your request could not be completed/).waitFor();
  assert.equal(await question.inputValue(), 'Retry only after this rejected request returns.');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await page.locator('.answer-question').filter({ hasText: /^Retry only after this rejected request returns\.$/ }).waitFor();
  assert.equal((await saved()).length, 3);
  evidence.checks.push('A rejected background request reports its failure only in the originating project, preserves the draft and succeeds through one explicit retry.');
};
