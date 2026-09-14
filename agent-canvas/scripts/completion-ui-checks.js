'use strict';
const assert = require('node:assert/strict');

// Regressions found by the completion audit. All writes use the disposable
// fixture. Map payloads deliberately exercise all certainty/legacy flags while
// linking to real fixture memory records; no external integration is contacted.
module.exports = async function completion({ page, context, url, call, more, shot, layout, evidence }) {
  const roster = (await call(context, url, '/api/roster')).roster;
  const scout = roster.find((entry) => entry.name === 'Scout' && entry.enabled);
  const spaces = [];
  for (const name of ['Completion review', 'Second project']) spaces.push((await call(context, url, '/api/canvases', 'POST', { name, roster_ids: [scout.id] })).canvas);
  const templateError = page.getByText('Loading team templates could not be completed. Check your connection and try again.', { exact: true });
  const addDialog = page.getByRole('dialog', { name: 'Add agent', exact: true });
  const openTeam = async () => { await more(page, 'Team'); await page.getByRole('button', { name: 'Add agent', exact: true }).click(); };
  const openCreation = async () => {
    await page.getByLabel('Project-space actions', { exact: true }).click();
    await page.getByRole('button', { name: 'New project space', exact: true }).click();
    return page.getByRole('dialog', { name: 'New project space', exact: true });
  };

  for (const order of ['before', 'after']) {
    let releaseSpaces, releaseTemplates, recovering = false, reads = 0;
    const spacesReady = new Promise((resolve) => { releaseSpaces = resolve; });
    const templatesReady = new Promise((resolve) => { releaseTemplates = resolve; });
    await page.route('**/api/canvases', async (route) => { if (route.request().method() === 'GET') await spacesReady; await route.fallback(); });
    await page.route('**/api/roster', async (route) => {
      reads++; await templatesReady;
      return recovering ? route.fallback() : route.fulfill({ status: 503, json: { error: 'Completion fixture: unavailable team list' } });
    });
    try {
      await page.reload({ waitUntil: 'domcontentloaded' });
      if (order === 'before') { releaseTemplates(); await templateError.waitFor(); }
      releaseSpaces(); await page.getByRole('heading', { name: 'Ask the company.' }).waitFor();
      releaseTemplates(); await templateError.waitFor();
      await page.getByLabel('Switch project space').selectOption(spaces[1].id);
      await openTeam();
      await addDialog.getByRole('alert').waitFor();
      assert.equal(await addDialog.getByText(/No agent templates are available/).count(), 0);
      assert.equal(await addDialog.getByRole('button', { name: 'Retry team list', exact: true }).isEnabled(), true);
      if (order === 'before') {
        await page.setViewportSize({ width: 390, height: 844 });
        await shot(page, 'mobile-team-recovery', 'A failed team list survives project selection and remains recoverable inside Add agent; it never claims the team list is empty.');
      }
      recovering = true;
      await addDialog.getByRole('button', { name: 'Retry team list', exact: true }).click();
      await addDialog.getByRole('button', { name: /Scout.*Complex work \(strong\)/ }).waitFor();
      assert.equal(reads, 2, 'One initial read and one explicit retry, with no automatic repeat');
      assert.equal(await addDialog.getByRole('alert').count(), 0);
      await page.keyboard.press('Escape');
    } finally { releaseSpaces(); releaseTemplates(); await page.unrouteAll({ behavior: 'wait' }); }
  }
  evidence.checks.push('Both response orders: team read failure survives initial and later project selection; Add agent offers one successful retry without page reload or a false empty state.');

  let templateReply = 'failed';
  await page.route('**/api/roster', (route) => templateReply === 'ready' ? route.fallback()
    : route.fulfill({ status: templateReply === 'failed' ? 503 : 200, json: templateReply === 'empty' ? { roster: [] } : {} }));
  try {
    await page.reload(); await templateError.waitFor();
    const create = await openCreation();
    await create.getByLabel('Project-space name', { exact: true }).fill('Keep this project name');
    assert.equal(await create.getByRole('button', { name: 'Create', exact: true }).isDisabled(), true);
    templateReply = 'incomplete';
    await create.getByRole('button', { name: 'Retry team list', exact: true }).click();
    await create.getByRole('alert').waitFor();
    assert.equal(await create.getByRole('button', { name: 'Create', exact: true }).isDisabled(), true);
    templateReply = 'ready';
    await create.getByRole('button', { name: 'Retry team list', exact: true }).click();
    await create.getByRole('button', { name: 'Create', exact: true }).and(page.locator(':enabled')).waitFor();
    await create.getByRole('alert').waitFor({ state: 'detached' });
    assert.equal(await create.getByLabel('Project-space name').inputValue(), 'Keep this project name');
    assert.equal(await create.getByRole('button', { name: 'Create', exact: true }).isEnabled(), true);
    await shot(page, 'mobile-project-recovered', 'New project space retains the name after failed and incomplete team replies. Its own retry restores the starting teams and enables creation.');
    await create.getByRole('button', { name: 'Cancel', exact: true }).click();

    templateReply = 'failed'; await page.reload(); await templateError.waitFor();
    await more(page, 'Rooms');
    await page.getByLabel('Room name', { exact: true }).fill('Keep this room name');
    assert.equal(await page.getByRole('button', { name: 'Create room', exact: true }).isDisabled(), true);
    templateReply = 'ready'; await page.getByRole('button', { name: 'Retry team list', exact: true }).click();
    await page.getByRole('button', { name: 'Create room', exact: true }).and(page.locator(':enabled')).waitFor();
    await page.getByRole('alert').waitFor({ state: 'detached' });
    assert.equal(await page.getByLabel('Room name', { exact: true }).inputValue(), 'Keep this room name');
    assert.equal(await page.getByRole('button', { name: 'Create room', exact: true }).isEnabled(), true);
    templateReply = 'empty'; await page.reload(); await openTeam();
    await addDialog.getByText(/No agent templates are available/).waitFor();
    assert.equal(await addDialog.getByRole('alert').count(), 0);
    assert.equal(await addDialog.locator('.roster-pick').count(), 0);
    await page.keyboard.press('Escape');
  } finally { await page.unrouteAll({ behavior: 'wait' }); }
  assert.equal((await call(context, url, '/api/canvases')).canvases.length, 2, 'Recovery never creates a project or Room automatically');
  evidence.checks.push('Failed and malformed template reads block project/Room creation while retaining names; retry recovers both forms. A successful empty team list has a distinct owner-settings explanation.');

  await page.reload(); await openTeam();
  await addDialog.locator('.tier-strong').first().waitFor();
  await addDialog.locator('.tier-fast').first().waitFor();
  for (const element of await addDialog.locator('.tier-strong').all()) assert.equal(await element.innerText(), 'Complex work (strong)');
  for (const element of await addDialog.locator('.tier-fast').all()) assert.equal(await element.innerText(), 'Quick work (fast)');
  for (const width of [390, 768, 1280]) { await page.setViewportSize({ width, height: 900 }); await layout(page); }
  await shot(page, 'desktop-team-labels', 'Team templates explains both reasoning levels while preserving every template choice.');
  await addDialog.getByRole('button', { name: 'Advanced', exact: true }).click();
  for (const label of ['Agent name', 'Agent role', 'Reasoning level', 'Agent color', 'Operating instructions']) await addDialog.getByLabel(label, { exact: true }).waitFor();
  await addDialog.getByLabel('Reasoning level').selectOption('fast');
  assert.equal(await addDialog.getByLabel('Reasoning level').inputValue(), 'fast');
  for (const width of [1280, 768, 390]) { await page.setViewportSize({ width, height: 900 }); await layout(page); }
  assert.ok((await addDialog.getByLabel('Reasoning level').boundingBox()).width >= 200, 'The selected reasoning label has room at mobile width');
  await shot(page, 'mobile-custom-labels', 'Custom agent creation retains every field and exact tier values, with accessible visible labels at narrow widths.');
  await addDialog.getByRole('button', { name: 'Team templates', exact: true }).click();
  await addDialog.getByRole('button', { name: /Darren.*Complex work \(strong\)/ }).click();
  await addDialog.waitFor({ state: 'detached' });
  await page.locator('.context-card').filter({ hasText: 'Darren' }).click();
  await page.locator('.panel').getByText('Complex work (strong)', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Close panel', exact: true }).click();
  evidence.checks.push('Both tier labels, every custom input, and unchanged option values are accessible at 390/768/1280px; adding a real template opens an agent with the same plain-English tier.');

  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await page.getByLabel('Ask a question about the company').fill('Check this local completion review.');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await page.locator('.answer-card.status-answered').waitFor();
  const activeSpace = await page.getByLabel('Switch project space').inputValue();
  const entries = [];
  const certainties = ['verified', 'inference', 'assumption'];
  const certaintyNames = ['Confirmed (verified)', 'Reasoned conclusion (inference)', 'Unconfirmed (assumption)'];
  for (const [index, epistemic] of certainties.entries()) entries.push((await call(context, url, `/api/canvases/${activeSpace}/memory`, 'POST', {
    content: index === 0 ? 'W'.repeat(90) : `Completion source ${index + 1}: keep the original wording and certainty.`, epistemic, source: 'Disposable completion fixture',
  })).entry);
  const map = { nodes: entries.map((entry, row) => ({ id: `entry:${entry.id}`, type: 'entry', col: 3, row, label: entry.content,
    meta: { entryId: entry.id, epistemic: certainties[row], ...(row === 0 ? { tainted: true, superseded: true } : {}) } })), edges: [],
    steps: entries.map((entry, row) => `Wrote to memory (${certainties[row]}): ${entry.content}`) };
  let mapReply = 'ready';
  await page.route('**/explain-map?*', (route) => route.fulfill({ json: mapReply === 'ready' ? map : mapReply === 'empty' ? { nodes: [], edges: [], steps: [] } : {} }));
  try {
    const openMap = async () => {
      await page.getByRole('button', { name: 'View work', exact: true }).click();
      await page.getByRole('button', { name: 'Why? → Map', exact: true }).click();
    };
    await openMap();
    const graph = page.locator('.explain-map');
    for (const lens of ['Flow', 'Evidence', 'Impact']) {
      await graph.getByRole('tab', { name: lens, exact: true }).click();
      await graph.locator('.en-certainty').first().waitFor();
      for (const [index, value] of certainties.entries()) {
        const node = graph.locator(`.explain-node.epi-${value}`);
        assert.equal(await node.locator('.en-certainty').innerText(), certaintyNames[index]);
        assert.ok((await node.getAttribute('aria-label')).includes(certaintyNames[index]));
        assert.equal(await node.locator('.epi-dot').count(), 1);
      }
    }
    for (const width of [1280, 768, 390]) {
      await page.setViewportSize({ width, height: 900 }); await layout(page);
      const geometry = await graph.locator('.explain-node').evaluateAll((nodes) => nodes.map((node) => ({ top: node.offsetTop, height: node.offsetHeight, width: node.clientWidth, contentWidth: node.scrollWidth })));
      for (let i = 0; i < geometry.length; i++) {
        assert.ok(geometry[i].contentWidth <= geometry[i].width + 1, `Map text fits its node at ${width}px: ${JSON.stringify(geometry)}`);
        if (i) assert.ok(geometry[i - 1].top + geometry[i - 1].height <= geometry[i].top, `Map nodes do not overlap at ${width}px: ${JSON.stringify(geometry)}`);
      }
    }
    await graph.locator('.explain-node').first().scrollIntoViewIfNeeded();
    await shot(page, 'mobile-map-certainty', 'Every memory node has written and accessible certainty plus its original symbol and border. Long source text and correction flags remain inside distinct nodes.');
    await graph.locator('.epi-assumption').scrollIntoViewIfNeeded();
    await shot(page, 'mobile-map-unconfirmed', 'The unconfirmed memory node keeps its complete certainty label and hollow symbol, matching the independently recorded memory value.');
    await graph.getByRole('tab', { name: 'Flow', exact: true }).focus(); await page.keyboard.press('ArrowRight');
    await graph.getByRole('tab', { name: 'Evidence', exact: true }).and(page.locator('[aria-selected="true"]')).waitFor();
    assert.equal(await graph.getByRole('tab', { name: 'Evidence', exact: true }).getAttribute('aria-selected'), 'true');
    await graph.locator('.en-certainty').first().waitFor();
    await graph.getByRole('button', { name: 'Read as steps', exact: true }).click();
    for (const [index, entry] of entries.entries()) await graph.getByText(`Recorded memory — ${certaintyNames[index]}: ${entry.content}`, { exact: true }).waitFor();
    await graph.getByRole('button', { name: 'Show map', exact: true }).click();
    await graph.locator('.epi-inference').click();
    await page.locator('.mem-entry').filter({ hasText: entries[1].content }).waitFor();
    await page.getByRole('button', { name: 'Close panel', exact: true }).click();
    await openMap(); await graph.locator('.en-certainty').first().waitFor();
    mapReply = 'incomplete'; await graph.getByRole('tab', { name: 'Impact', exact: true }).click();
    await graph.getByRole('alert').waitFor();
    mapReply = 'empty'; await graph.getByRole('button', { name: 'Try again', exact: true }).click();
    await graph.getByText(/No work map details were returned/).waitFor();
    mapReply = 'ready'; await graph.getByRole('button', { name: 'Refresh map', exact: true }).click();
    await graph.locator('.en-certainty').first().waitFor();
    await page.getByRole('button', { name: 'Close panel', exact: true }).click();
    await page.getByRole('button', { name: 'Account', exact: true }).click();
    await page.getByRole('button', { name: 'Appearance: switch to dark', exact: true }).click();
    await page.getByRole('button', { name: 'Account', exact: true }).click();
    await openMap(); await graph.locator('.en-certainty').first().scrollIntoViewIfNeeded();
    await page.setViewportSize({ width: 1280, height: 900 });
    await shot(page, 'desktop-map-dark', 'The work map preserves certainty, source wording and correction flags in dark mode; Read as steps and all three lenses remain reachable.');
    await page.getByRole('button', { name: 'Close panel', exact: true }).click();
  } finally { await page.unrouteAll({ behavior: 'wait' }); }
  evidence.checks.push('Explicit three-certainty map payload: all lenses, symbols, accessible names, long source text, correction flags, mobile geometry, keyboard switching, ordered steps, exact real memory navigation, malformed/empty recovery and both themes pass.');

  await page.goto(`${url}/?ws=blocked`);
  const connections = page.getByRole('dialog', { name: 'Connections', exact: true });
  await connections.getByText(/Google did not allow this account to connect/).waitFor();
  assert.equal(await connections.getByText(/GOOGLE_WORKSPACE_SCOPES=standard/).isVisible(), false);
  assert.ok(!(await page.locator('.toasts').innerText()).includes('GOOGLE_WORKSPACE_SCOPES'));
  await connections.getByText('Technical setup details', { exact: true }).focus(); await page.keyboard.press('Enter');
  assert.equal(await connections.getByText(/GOOGLE_WORKSPACE_SCOPES=standard/).isVisible(), true);
  await connections.getByText('Technical setup details', { exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, 'mobile-connection-recovery', 'The blocked-account callback explains how to recover in plain English. Owner setup details remain available under a collapsed keyboard-operable disclosure.');
  evidence.checks.push('Blocked-Google callback uses a plain recovery message; complete technical setup instructions remain behind labelled details, reachable by keyboard. No OAuth or external call is attempted.');
};
