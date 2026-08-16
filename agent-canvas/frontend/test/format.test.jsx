// Display formatting contracts (src/format.jsx): the markdown subset renders
// as elements, the standing-rule contract tail is stripped/humanized only when
// unambiguous, previews collapse to prose, and structured payloads read as
// labeled lines instead of JSON.
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import {
  SummaryMarkdown, formatContractTail, plainPreview, humanizePayload, humanizeDetail, formatRunEventPreview,
} from '../src/format.jsx';
import ActivityDock from '../src/ActivityDock.jsx';
import Tray from '../src/Tray.jsx';
import NeedsYouView from '../src/NeedsYouView.jsx';

describe('SummaryMarkdown', () => {
  it('renders headings, paragraphs, unordered and ordered lists, and bold', () => {
    const { container } = render(
      <SummaryMarkdown text={'## Brief\nA paragraph with **bold** text.\n- first\n- second\n1. one\n2) two'} />,
    );
    expect(screen.getByRole('heading', { name: 'Brief' })).toBeInTheDocument();
    expect(container.querySelector('b').textContent).toBe('bold');
    const uls = container.querySelectorAll('ul.md-list');
    expect(uls).toHaveLength(1);
    expect([...uls[0].querySelectorAll('li')].map((li) => li.textContent)).toEqual(['first', 'second']);
    const ols = container.querySelectorAll('ol.md-list');
    expect(ols).toHaveLength(1);
    expect([...ols[0].querySelectorAll('li')].map((li) => li.textContent)).toEqual(['one', 'two']);
  });

  it('keeps an unmatched ** literal instead of silently rewriting content', () => {
    const { container } = render(<SummaryMarkdown text={'A stray ** delimiter here'} />);
    expect(container.textContent).toBe('A stray ** delimiter here');
    expect(container.querySelector('b')).toBeNull();
  });

  it('preserves the source numbering of ordered lists', () => {
    const { container } = render(<SummaryMarkdown text={'5. five\n6. six'} />);
    const items = [...container.querySelectorAll('ol.md-list li')];
    expect(items.map((li) => li.getAttribute('value'))).toEqual(['5', '6']);
    expect(items.map((li) => li.textContent)).toEqual(['five', 'six']);
  });

  it('keeps HTML-looking input as visible text, never elements', () => {
    const { container } = render(<SummaryMarkdown text={'<script>alert(1)</script> and <b>tag</b>'} />);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('p b')).toBeNull();
    expect(container.textContent).toContain('<script>alert(1)</script>');
  });

  it('keeps headings restrained (never h1-h3) and passes className through', () => {
    const { container } = render(<SummaryMarkdown className="rehearsal-summary" text={'# Top'} />);
    expect(container.querySelector('h1, h2, h3')).toBeNull();
    expect(container.querySelector('h4')).not.toBeNull();
    expect(container.querySelector('.summary-markdown.rehearsal-summary')).not.toBeNull();
  });
});

describe('formatContractTail', () => {
  it('strips a marker on its own final line, including trailing blank lines and CRLF', () => {
    expect(formatContractTail('## Brief\nAll set.\nMATCHED: 2', 'strip')).toBe('## Brief\nAll set.');
    expect(formatContractTail('All set.\r\nNOTHING MATCHED\r\n\r\n', 'strip')).toBe('All set.');
  });

  it('keeps same-line prose while removing the trailing token', () => {
    expect(formatContractTail('All steady. NOTHING MATCHED', 'strip')).toBe('All steady.');
  });

  it('humanizes with correct pluralization', () => {
    expect(formatContractTail('MATCHED: 1', 'humanize')).toBe('1 item matched.');
    expect(formatContractTail('MATCHED: 4', 'humanize')).toBe('4 items matched.');
    expect(formatContractTail('NOTHING MATCHED', 'humanize')).toBe('Nothing matched.');
    expect(formatContractTail('Done. MATCHED: 2', 'humanize')).toBe('Done. 2 items matched.');
  });

  it('leaves ambiguous or mid-prose markers unchanged', () => {
    const midProse = 'The report mentioned MATCHED: 0 yesterday';
    expect(formatContractTail(midProse, 'strip')).toBe(midProse);
    const contradictory = 'MATCHED: 2 NOTHING MATCHED';
    expect(formatContractTail(contradictory, 'strip')).toBe(contradictory);
    expect(formatContractTail('3 items were UNMATCHED', 'strip')).toBe('3 items were UNMATCHED');
    expect(formatContractTail('prose only', 'strip')).toBe('prose only');
    expect(formatContractTail('anything', 'preserve')).toBe('anything');
  });

  it('leaves no dangling separator when the stripped line was the only content after prose', () => {
    const out = plainPreview(formatContractTail('## Brief\nAll quiet.\nNOTHING MATCHED', 'strip'));
    expect(out).toBe('Brief · All quiet.');
    expect(out.endsWith('·')).toBe(false);
  });
});

describe('plainPreview', () => {
  it('collapses markdown to one line of prose', () => {
    expect(plainPreview('## Head\n- **x** moved\n2. item two\n\nplain')).toBe('Head · x moved · item two · plain');
  });

  it('keeps a literal unmatched ** instead of deleting it', () => {
    expect(plainPreview('a stray ** delimiter')).toBe('a stray ** delimiter');
    expect(plainPreview('the **rate** is 2**8')).toBe('the rate is 2**8');
  });
});

describe('humanizePayload', () => {
  it('labels objects without JSON punctuation, one nested level deep', () => {
    expect(humanizePayload({ deal_name: 'Acme', amount: 5000, active: true, none: null }))
      .toEqual(['deal name: Acme', 'amount: 5000', 'active: yes', 'none: —']);
    expect(humanizePayload({ filters: { stage: 'closed', open: false }, tags: ['a', 'b'] }))
      .toEqual(['filters / stage: closed', 'filters / open: no', 'tags: a, b']);
  });

  it('bounds deeper structures instead of dumping JSON', () => {
    const lines = humanizePayload({ nested: { deep: { a: 1, b: 2, c: 3 } } });
    expect(lines).toEqual(['nested / deep: 3 fields']);
  });

  it('full mode walks every nested level so expanded detail omits nothing', () => {
    const ctx = {
      deal: { terms: { discount_pct: 12, approved: false }, contacts: ['ann@x.com', 'bo@x.com'] },
      note: null,
    };
    expect(humanizePayload(ctx, { full: true })).toEqual([
      'deal / terms / discount pct: 12',
      'deal / terms / approved: no',
      'deal / contacts: ann@x.com, bo@x.com',
      'note: —',
    ]);
    // The bounded default would have collapsed terms to "2 fields".
    expect(humanizePayload(ctx)).toContain('deal / terms: 2 fields');
  });

  it('salvages truncated JSON previews instead of showing broken braces', () => {
    const cut = '{"deal_name":"Acme","amount":5000,"nested":{"stage":"legal","ow';
    const lines = humanizePayload(cut);
    expect(lines).toContain('deal name: Acme');
    expect(lines).toContain('amount: 5000');
    expect(lines[lines.length - 1]).toBe('… (result truncated)');
    expect(lines.join('\n')).not.toContain('{');
  });

  it('recovers a value cut mid-string, and never returns raw broken syntax', () => {
    const midValue = humanizePayload('{"deal_name":"Acme Cor');
    expect(midValue).toContain('deal name: Acme Cor');
    expect(midValue.join('\n')).not.toContain('{');
    // Nothing structured survived at all — still no braces or quotes.
    const shredded = humanizePayload('[{"a":').join('\n');
    expect(shredded).not.toMatch(/[{}[\]"]/);
    expect(shredded).toContain('(result truncated)');
  });

  it('renders empty collections as (none), never as blank', () => {
    expect(humanizePayload([])).toEqual(['(none)']);
    expect(humanizePayload({ tags: [], meta: {} })).toEqual(['tags: (none)', 'meta: (none)']);
    expect(humanizePayload({ tags: [] }, { full: true })).toEqual(['tags: (none)']);
  });
});

describe('humanizeDetail', () => {
  it('returns every field uncapped for ordinary payloads', () => {
    const text = humanizeDetail({ a: 'x'.repeat(900), b: { c: 'y'.repeat(900) } });
    expect(text).toContain('x'.repeat(900)); // the old 800-char cap would have cut here
    expect(text).toContain('b / c:');
    expect(text).not.toContain('not shown');
  });

  it('says so explicitly when a pathological payload is bounded', () => {
    const huge = Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`field_${i}`, 'v'.repeat(100)]));
    const text = humanizeDetail(huge);
    expect(text).toMatch(/… \d+ more field\(s\) not shown/);
  });

  it('parses JSON-encoded strings and preserves ordinary ones', () => {
    expect(humanizePayload('{"q":"renewals","limit":5}')).toEqual(['q: renewals', 'limit: 5']);
    expect(humanizePayload('[1,2,3]')).toEqual(['1, 2, 3']);
    expect(humanizePayload('{not json')).toEqual(['{not json']);
    expect(humanizePayload('plain sentence')).toEqual(['plain sentence']);
    expect(humanizePayload(null)).toEqual(['—']);
    expect(humanizePayload(false)).toEqual(['no']);
  });
});

describe('formatRunEventPreview', () => {
  it('humanizes tool-call inputs and JSON tool-result previews', () => {
    const call = formatRunEventPreview({ type: 'tool_call', payload: { name: 'hs_search', input: { q: 'renewals', limit: 5 } } }, 'dock');
    expect(call).toBe('hs_search: q: renewals · limit: 5');
    const result = formatRunEventPreview({ type: 'tool_result', payload: { name: 'hs_search', preview: '{"count":3,"stale":false}' } }, 'detail');
    expect(result).toBe('hs_search → count: 3 · stale: no');
    expect(result).not.toContain('{');
  });

  it('keeps run status, error marker, and dock prefixes', () => {
    const fin = formatRunEventPreview({ type: 'run_finished', payload: { status: 'completed', summary: '## Done\nAll good.\nMATCHED: 2', error: 'nope' } }, 'dock');
    expect(fin).toBe('run completed — Done · All good. · 2 items matched. ⚠ nope');
    const err = formatRunEventPreview({ type: 'tool_result', payload: { name: 't', preview: 'x', isError: true } }, 'dock');
    expect(err).toContain('⚠');
  });
});

describe('component surfaces', () => {
  it('Activity Dock previews carry no raw JSON braces', () => {
    const activity = [
      { id: 1, ts: '2026-08-16T10:00:00Z', agent_id: 'a1', type: 'tool_call', payload: { name: 'hs_search', input: { q: 'renewals' } } },
      { id: 2, ts: '2026-08-16T10:01:00Z', agent_id: 'a1', type: 'run_finished', payload: { status: 'completed', summary: 'All good.' } },
    ];
    const { container } = render(
      <ActivityDock activity={activity} handoffs={[]} agents={[]} agentsById={{}} onHoverHandoff={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Activity/ }));
    expect(container.textContent).toContain('hs_search: q: renewals');
    expect(container.textContent).toContain('run completed — All good.');
    expect(container.textContent).not.toContain('{');
  });

  it('Tray expanded context keeps every nested decision-critical detail', async () => {
    const esc = {
      id: 'e1', kind: 'question', question: 'Proceed?', created_at: new Date().toISOString(),
      context: { deal_name: 'Acme', terms: { discount_pct: 12, legal: { reviewer: 'Jess' } } },
    };
    render(<Tray escalations={[esc]} agentsById={{}} agents={[]} people={[]} onResolve={vi.fn()} onAssign={vi.fn()} />);
    fireEvent.click(screen.getByText('context'));
    const pre = await screen.findByText(/deal name: Acme/);
    expect(pre.textContent).toContain('terms / discount pct: 12');
    expect(pre.textContent).toContain('terms / legal / reviewer: Jess');
    expect(pre.textContent).not.toContain('fields'); // never a bounded "2 fields" stub
    expect(pre.textContent).not.toContain('{');
  });

  it('Needs You strips contract text on rule cards but keeps meaning elsewhere', () => {
    const base = {
      owner: {}, created_at: new Date().toISOString(), consequence: '', recommendation: null,
      contextData: null, sourceRef: { id: 'x' },
    };
    const rows = [
      { ...base, type: 'brief_ready', decision: 'Read the brief', context: '## Brief\nAll quiet.\nNOTHING MATCHED', sourceRef: { id: 'r1', ruleId: 'sr1' } },
      { ...base, type: 'escalation', decision: 'Decide', context: 'Scan done. MATCHED: 2', sourceRef: { id: 'e1' } },
    ];
    const { container } = render(
      <NeedsYouView rows={rows} userEmail="pete@x.com" agentsById={{}} people={[]} agents={[]}
        onResolveEscalation={vi.fn()} onAssign={vi.fn()} onOpenMemory={vi.fn()} onOpenRun={vi.fn()}
        onOpenWorkbook={vi.fn()} onRetryRun={vi.fn()} onExtendReview={vi.fn()}
        onAcknowledgeRuleRun={vi.fn()} onOpenRule={vi.fn()} />,
    );
    expect(screen.getByText('Scan done. 2 items matched.')).toBeInTheDocument();
    // brief_ready carries no count on the card, so its result is humanized —
    // stripping would delete the only statement of what matched.
    expect(screen.getByText('Brief · All quiet. · Nothing matched.')).toBeInTheDocument();
    expect(container.textContent).not.toContain('NOTHING MATCHED');
    expect(container.textContent).not.toContain('MATCHED: 2');
  });

  it('Needs You strips a rule_alert result, whose count is on the card', () => {
    const row = {
      owner: {}, created_at: new Date().toISOString(), consequence: '', recommendation: null,
      contextData: null, type: 'rule_alert', decision: 'Standing rule matched 2 item(s)',
      context: 'Two deals went quiet.\nMATCHED: 2', sourceRef: { id: 'r1', ruleId: 'sr1' },
    };
    const { container } = render(
      <NeedsYouView rows={[row]} userEmail="pete@x.com" agentsById={{}} people={[]} agents={[]}
        onResolveEscalation={vi.fn()} onAssign={vi.fn()} onOpenMemory={vi.fn()} onOpenRun={vi.fn()}
        onOpenWorkbook={vi.fn()} onRetryRun={vi.fn()} onExtendReview={vi.fn()}
        onAcknowledgeRuleRun={vi.fn()} onOpenRule={vi.fn()} />,
    );
    expect(screen.getByText('Two deals went quiet.')).toBeInTheDocument();
    expect(screen.getByText('Standing rule matched 2 item(s)')).toBeInTheDocument();
    expect(container.textContent).not.toContain('MATCHED: 2');
  });
});
