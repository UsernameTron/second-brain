'use strict';
const assert = require('node:assert/strict');

module.exports = async function draftSafety({ page, context, url, call, more, shot, evidence }) {
  // Complete each real server mutation, then hold only its browser response.
  // New drafts are edited while that earlier response is still outstanding.
  const hold = async (pattern, method) => {
    let accept, release;
    const accepted = new Promise((resolve) => { accept = resolve; });
    const gate = new Promise((resolve) => { release = resolve; });
    const handler = async (route) => {
      if (route.request().method() !== method) return route.fallback();
      const response = await route.fetch();
      assert.ok(response.ok(), 'The held mutation must have been accepted');
      accept(); await gate; await route.fulfill({ response });
    };
    await page.route(pattern, handler);
    return { accepted, finish: async () => {
      const received = page.waitForResponse((response) => response.request().method() === method && response.url().includes(pattern.replaceAll('*', '')));
      // Each helper owns the only page-level route. Drain active handlers
      // before removing it; a response event can arrive before fulfill ends.
      release(); await received; await page.unrouteAll({ behavior: 'wait' });
    } };
  };
  const close = () => page.getByRole('button', { name: 'Close panel', exact: true }).click();
  const commands = async () => {
    await page.locator('.primary-nav summary').filter({ hasText: /^More$/ }).click();
    const advanced = page.locator('.primary-nav summary').filter({ hasText: /^Advanced$/ });
    if (!await advanced.evaluate((element) => element.parentElement.open)) await advanced.click();
    await page.locator('.primary-nav').getByRole('button', { name: 'Commands', exact: true }).click();
  };

  await page.getByRole('button', { name: 'Create a project space', exact: true }).click();
  await page.getByLabel('Project-space name').fill('Draft safety checks');
  await page.getByLabel('Starting team').selectOption('revenue');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('heading', { name: 'Ask the company.' }).waitFor();
  const { canvases } = await call(context, url, '/api/canvases');
  const cid = canvases.find((space) => space.name === 'Draft safety checks').id;
  const state = () => call(context, url, `/api/canvases/${cid}`);

  await more(page, 'Documents & notes');
  await page.getByRole('button', { name: 'Add note', exact: true }).click();
  await page.getByLabel('Note title').fill('Draft protection');
  await page.getByLabel('Note content').fill('First saved version');
  const noteId = (await state()).notes[0].id;
  const noteSave = await hold(`**/notes/${noteId}`, 'PUT');
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await noteSave.accepted; await close();
  await page.getByRole('button', { name: 'Open note Draft protection', exact: true }).click();
  await page.getByLabel('Note content').fill('My next unsaved note');
  await noteSave.finish(); await close();
  await page.getByRole('button', { name: 'Open note Draft protection', exact: true }).click();
  assert.equal(await page.getByLabel('Note content').inputValue(), 'My next unsaved note');
  assert.equal((await state()).notes[0].content, 'First saved version');
  await shot(page, 'note', 'A late note-save response preserves the newer unsaved draft after closing and reopening. The server still holds only the first submitted version.');
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await page.getByText('Note saved.', { exact: true }).waitFor();
  assert.equal((await state()).notes[0].content, 'My next unsaved note');
  await close();
  evidence.checks.push('A note save accepted before navigation cannot overwrite a newer reopened draft; only a second explicit Save note updates the server again.');

  await more(page, 'Team');
  await page.locator('.context-card').filter({ hasText: /^Scout/ }).click();
  await page.getByLabel('Send to Scout').fill('First direct instruction');
  const dispatch = await hold('**/dispatch', 'POST');
  await page.getByRole('button', { name: 'Dispatch to Scout', exact: true }).click();
  await dispatch.accepted; await close();
  await page.locator('.context-card').filter({ hasText: /^Scout/ }).click();
  await page.getByLabel('Send to Scout').fill('Next unsent instruction');
  await dispatch.finish(); await close();
  await page.locator('.context-card').filter({ hasText: /^Scout/ }).click();
  assert.equal(await page.getByLabel('Send to Scout').inputValue(), 'Next unsent instruction');
  assert.equal((await state()).runs.filter((run) => run.instruction === 'First direct instruction').length, 1);
  assert.equal((await state()).runs.filter((run) => run.instruction === 'Next unsent instruction').length, 0);
  await close();
  evidence.checks.push('A late direct dispatch clears only the submitted instruction; a newer draft survives reopening and is never automatically dispatched.');

  await commands();
  await page.getByLabel('Advanced command').fill('Have Scout review the first draft.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const commandSave = await hold('**/dispatch', 'POST');
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await commandSave.accepted;
  await page.getByLabel('Advanced command').fill('Have Scout review the next draft.');
  await commandSave.finish();
  await page.getByRole('button', { name: 'Confirm', exact: true }).waitFor({ state: 'detached' });
  assert.equal(await page.getByLabel('Advanced command').inputValue(), 'Have Scout review the next draft.');
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await commands();
  assert.equal(await page.getByLabel('Advanced command').inputValue(), 'Have Scout review the next draft.');
  const parse = await hold('**/intent', 'POST');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await parse.accepted;
  await page.getByLabel('Advanced command').fill('Keep this newer command instead.');
  await parse.finish();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(await page.getByLabel('Advanced command').inputValue(), 'Keep this newer command instead.');
  evidence.checks.push('Late command confirmation and cancellation both preserve newer typed text, including a view change; no next command is automatically interpreted or confirmed.');

  for (const question of ['First answer context', 'Second answer context']) {
    await call(context, url, `/api/canvases/${cid}/inquiries`, 'POST', { question, mode: 'ask' });
  }
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  const first = page.locator('article').filter({ has: page.locator('.answer-question').filter({ hasText: /^First answer context$/ }) });
  const second = page.locator('article').filter({ has: page.locator('.answer-question').filter({ hasText: /^Second answer context$/ }) });
  await first.getByRole('button', { name: 'Act on this', exact: true }).click();
  await page.getByLabel('Ask a question about the company').fill('Draft the first follow-up.');
  const inquirySave = await hold('**/inquiries', 'POST');
  await page.getByRole('button', { name: 'Act', exact: true }).click();
  await inquirySave.accepted;
  await second.getByRole('button', { name: 'Act on this', exact: true }).click();
  await inquirySave.finish();
  await page.getByRole('button', { name: 'Sending…', exact: true }).waitFor({ state: 'detached' });
  assert.ok((await page.locator('.home-ask .answer-context').textContent()).includes('Second answer context'));
  assert.equal(await page.getByLabel('Ask a question about the company').inputValue(), '');
  const inquiries = (await call(context, url, `/api/canvases/${cid}/inquiries`)).inquiries;
  const sent = inquiries.find((inquiry) => inquiry.question.startsWith('Follow-up request:'));
  assert.ok(sent.question.includes('First answer context'));
  assert.ok(!sent.question.includes('Second answer context'));
  await page.locator('.home-view').evaluate((element) => element.scrollTo(0, 0));
  await shot(page, 'answer-context', 'The submitted follow-up retains its original answer; selecting a different answer while waiting keeps that newer context for the next request.');
  evidence.checks.push('Home sends the originally selected answer and preserves a different context attached during that submission for the next request.');

  await more(page, 'Scheduled work');
  await page.getByLabel('Describe the standing rule').fill('Review the first schedule.');
  const interpretation = await hold('**/standing-rules/parse', 'POST');
  await page.getByRole('button', { name: 'Interpret', exact: true }).click();
  await interpretation.accepted;
  await page.getByLabel('Describe the standing rule').fill('Review the next schedule.');
  await interpretation.finish();
  await page.getByRole('button', { name: '← Rules', exact: true }).click();
  assert.equal(await page.getByLabel('Describe the standing rule').inputValue(), 'Review the next schedule.');
  const rules = (await call(context, url, `/api/canvases/${cid}/standing-rules`)).rules;
  assert.equal(rules.length, 1); assert.equal(rules[0].instruction, 'Review the first schedule.');
  assert.equal(rules[0].state, 'draft');
  evidence.checks.push('Scheduled-work interpretation preserves the next typed instruction; only the first draft exists on the server and no schedule is activated.');
};
