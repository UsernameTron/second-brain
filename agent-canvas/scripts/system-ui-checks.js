'use strict';
// Failure/recovery in the built browser app. Only the browser's network and
// speech boundaries are controlled; server routes and authentication stay real.
const assert = require('node:assert/strict');

module.exports = async function systemRecovery({ page, context, url, fault, call, shot, evidence }) {
  for (const endpoint of ['/api/config', '/api/me']) {
    fault.current = (request) => request.url().endsWith(endpoint) ? 503 : 0;
    await page.reload();
    await page.getByText(/Opening the workspace could not be completed/).waitFor();
    assert.equal(await page.getByLabel('Development sign-in').count(), 0);
    fault.current = null;
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await page.getByRole('button', { name: 'Create a project space', exact: true }).waitFor();
  }
  const malformed = (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{incomplete' });
  await page.route('**/api/config', malformed);
  await page.reload();
  await page.getByText(/Opening the workspace could not be completed/).waitFor();
  await shot(page, 'startup', 'Malformed startup response shows a durable failure and Try again; it does not pretend the account signed out.');
  await page.unroute('**/api/config', malformed);
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await page.getByRole('button', { name: 'Create a project space', exact: true }).click();
  await page.getByLabel('Project-space name').fill('Recovery checks');
  await page.getByLabel('Starting team').selectOption('revenue');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('heading', { name: 'Ask the company.' }).waitFor();
  const { canvases } = await call(context, url, '/api/canvases');
  const cid = canvases.find((canvas) => canvas.name === 'Recovery checks').id;
  evidence.checks.push('Configuration/service failures and malformed successful startup responses retain an explicit retry screen; recovery uses the existing signed-in account.');

  // Close the actual socket and prevent reconnect until the server has finished
  // work. No terminal event can reach the UI during that interval.
  await page.addInitScript(() => {
    const NativeWebSocket = window.WebSocket;
    window.__testSockets = [];
    window.WebSocket = class extends NativeWebSocket {
      constructor(...args) {
        if (window.__holdSocket) throw new Error('Local test socket interruption');
        super(...args); window.__testSockets.push(this);
      }
    };
  });
  await page.reload();
  await page.getByRole('heading', { name: 'Ask the company.' }).waitFor();
  await page.waitForFunction(() => window.__testSockets.some((socket) => socket.readyState === 1));
  await page.evaluate(() => { window.__holdSocket = true; window.__testSockets.forEach((socket) => socket.close()); });
  await page.getByText(/Live updates are reconnecting/).waitFor();
  const question = 'Check this request after the connection returns.';
  const { inquiry } = await call(context, url, `/api/canvases/${cid}/inquiries`, 'POST', { question, mode: 'ask' });
  await page.waitForFunction(async ({ cid, id }) => {
    const data = await (await fetch(`/api/canvases/${cid}/inquiries`)).json();
    return data.inquiries.some((entry) => entry.id === id && entry.status === 'answered');
  }, { cid, id: inquiry.id });
  await call(context, url, '/api/control/pause', 'POST', {});
  assert.equal(await page.locator('.answer-question').filter({ hasText: question }).count(), 0);
  await shot(page, 'disconnected', 'Disconnected work is explicitly stale while a real server-side result and pause await reconnection.');
  await page.evaluate(() => { window.__holdSocket = false; });
  await page.getByText(/Live updates are reconnecting/).waitFor({ state: 'detached' });
  await page.locator('.answer-question').filter({ hasText: question }).waitFor();
  await page.locator('.pause-banner').waitFor();
  assert.ok(await page.getByRole('button', { name: 'Ask', exact: true }).isDisabled());
  await page.locator('.pause-banner').getByRole('button', { name: 'Resume', exact: true }).click();
  await page.locator('.pause-banner').waitFor({ state: 'detached' });
  evidence.checks.push('A real socket drop misses a completed inquiry and pause; reconnect reconciles both, labels stale work, and preserves the pause safeguard.');

  // Let the mutation succeed, then lose its response. Check status must reveal
  // that single saved request without automatically submitting it again.
  let submissions = 0;
  const interrupted = async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    submissions += 1; await route.fetch(); await route.abort('connectionreset');
  };
  await page.route('**/inquiries', interrupted);
  const draft = 'A request whose confirmation was interrupted.';
  await page.getByLabel('Ask a question about the company').fill(draft);
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await page.getByText(/Sending your request is not confirmed/).waitFor();
  assert.equal(await page.getByLabel('Ask a question about the company').inputValue(), draft);
  assert.ok(await page.getByRole('button', { name: 'Ask', exact: true }).isDisabled());
  await page.getByRole('button', { name: 'Check status', exact: true }).click();
  await page.locator('.answer-question').filter({ hasText: draft }).waitFor();
  assert.equal(submissions, 1);
  const saved = await call(context, url, `/api/canvases/${cid}/inquiries`);
  assert.equal(saved.inquiries.filter((entry) => entry.question === draft).length, 1);
  await page.getByRole('button', { name: 'Check status', exact: true }).click({ trial: true });
  await shot(page, 'unconfirmed', 'A lost submission response keeps the draft, disables repeat submission and recovers the one saved answer through Check status.');
  await page.unroute('**/inquiries', interrupted);
  await page.getByRole('button', { name: 'I checked the answers; keep editing', exact: true }).click();
  evidence.checks.push('A server-accepted inquiry with a lost response remains unconfirmed, retains text, blocks repeated submission and recovers exactly one saved answer through Check status.');

  fault.current = (request) => request.url().endsWith('/api/control/status') ? 503 : 0;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByText(/Loading pause and spending status could not/).waitFor();
  await page.getByText('Spending unknown', { exact: true }).waitFor();
  fault.current = null;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await page.getByText('Spending unknown', { exact: true }).waitFor({ state: 'detached' });

  fault.current = (request) => request.url().endsWith('/api/capabilities') || request.url().endsWith('/api/health/integrations') ? 503 : 0;
  await page.getByRole('button', { name: 'Connections', exact: true }).click();
  const connections = page.getByRole('dialog', { name: 'Connections', exact: true });
  await connections.getByText(/Loading your connections could not/).waitFor();
  await connections.getByText(/Checking system status could not/).waitFor();
  assert.equal(await connections.locator('.lamp-ready').count(), 0);
  assert.equal(await connections.getByText('○ Not configured', { exact: true }).count(), 0);
  fault.current = null;
  await connections.getByRole('button', { name: 'Try again', exact: true }).first().click();
  await connections.getByText(/Loading your connections could not/).waitFor({ state: 'detached' });
  await connections.getByRole('button', { name: 'Try again', exact: true }).click();
  await connections.getByText('Answer service', { exact: true }).waitFor();
  await connections.getByRole('button', { name: 'Close', exact: true }).click();
  evidence.checks.push('Failed control and connection reads show unknown spending and unavailable status, with no substitute zero, false configuration state or green lamp; retry recovers.');

  await page.getByLabel('Ask a question about the company').fill('Keep this draft while signing in again.');
  fault.current = (request) => request.url().includes('/inquiries') ? 401 : 0;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.locator('.session-banner').waitFor();
  assert.equal(await page.getByLabel('Ask a question about the company').inputValue(), 'Keep this draft while signing in again.');
  fault.current = null;
  await page.getByRole('button', { name: 'Sign in again', exact: true }).click();
  await page.getByLabel('Development sign-in').fill('pete@cloudtechgurus.com');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('heading', { name: 'Ask the company.' }).waitFor();
  await page.locator('.answer-question').filter({ hasText: draft }).waitFor();
  evidence.checks.push('Expired read authentication warns before leaving the editable draft; Pete can sign in again and retrieve the saved result.');

  // Synthetic browser SpeechRecognition results exercise software handling,
  // never the physical microphone or external speech service.
  await page.addInitScript(() => {
    window.__recognitions = [];
    window.SpeechRecognition = class {
      constructor() { window.__recognitions.push(this); }
      start() { if (window.__speechStartFails) throw new Error('Microphone permission denied'); }
      stop() { this.onend?.(); }
      abort() { this.aborted = true; this.onend?.(); }
    };
  });
  await page.reload();
  await page.locator('.primary-nav summary').filter({ hasText: /^More$/ }).click();
  await page.locator('.primary-nav summary').filter({ hasText: /^Advanced$/ }).click();
  await page.getByRole('button', { name: 'Commands', exact: true }).click();
  const command = page.getByLabel('Advanced command');
  await command.fill('Keep my typed command.');
  await page.evaluate(() => { window.__speechStartFails = true; });
  await page.getByRole('button', { name: 'Speak a command', exact: true }).click();
  await page.getByText('The microphone could not start. Type your command instead.', { exact: true }).waitFor();
  await page.getByText('Keep your text, or type instead of using the microphone.', { exact: true }).waitFor();
  assert.equal(await command.inputValue(), 'Keep my typed command.');
  await page.evaluate(() => { window.__speechStartFails = false; });
  await page.getByRole('button', { name: 'Speak a command', exact: true }).click();
  await page.evaluate(() => {
    const recognition = window.__recognitions.at(-1);
    const first = Object.assign([{ transcript: 'Have Scout ' }], { isFinal: true });
    recognition.onresult({ resultIndex: 0, results: [first] });
    // Browser results include earlier final segments on subsequent events.
    recognition.onresult({ resultIndex: 1, results: [first, Object.assign([{ transcript: 'review the draft.' }], { isFinal: true })] });
    recognition.onend();
  });
  await page.getByRole('button', { name: 'Confirm', exact: true }).waitFor();
  assert.equal(await command.inputValue(), 'Have Scout review the draft.');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(await command.inputValue(), 'Have Scout review the draft.');
  let interpretations = 0;
  const countInterpretations = (request) => { if (request.url().endsWith('/intent')) interpretations += 1; };
  page.on('request', countInterpretations);
  await page.getByRole('button', { name: 'Speak a command', exact: true }).click();
  await page.evaluate(() => {
    const recognition = window.__recognitions.at(-1);
    recognition.onresult({ results: [Object.assign([{ transcript: 'Review ' }], { isFinal: true })] });
    const lateEnd = recognition.onend;
    recognition.onerror({ error: 'network' }); lateEnd();
  });
  await page.getByText('Voice input stopped. Type your command instead.', { exact: true }).waitFor();
  assert.equal(await command.inputValue(), 'Review ');
  assert.equal(interpretations, 0);
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, 'voice-recovery', 'Synthetic recognition failure keeps the partial transcript for typing and review; no automatic interpretation or action follows the error.');
  page.off('request', countInterpretations);
  await page.getByRole('button', { name: 'Speak a command', exact: true }).click();
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  assert.ok(await page.evaluate(() => window.__recognitions.at(-1).aborted));
  evidence.checks.push('Synthetic voice start failure keeps typed input; cumulative final transcripts are not duplicated, errors retain partial text without interpretation, confirmation remains required, Cancel keeps text and leaving Commands aborts recognition. Physical speech recognition is not verified.');
};
