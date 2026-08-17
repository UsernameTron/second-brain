// P2.1: canvas nodes are keyboard-first-class — focusable, labeled, and
// Enter/Space activates the same handler as a click.
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AgentNode, FileNode, NoteNode } from '../src/Nodes.jsx';

const shell = (onClick) => ({ z: 1, onMoveLive: vi.fn(), onMoveEnd: vi.fn(), onClick });
const AGENT = { id: 'a1', name: 'Scout', role: 'research', status: 'idle', model_tier: 'fast', color: '#0af', x: 0, y: 0 };

describe('canvas node keyboard access', () => {
  it('agent node is a focusable labeled button', () => {
    render(<AgentNode agent={AGENT} spend={null} {...shell(vi.fn())} />);
    const node = screen.getByRole('button', { name: 'Scout, research agent' });
    expect(node).toHaveAttribute('tabindex', '0');
  });

  it('describes the Enrichment agent in plain language', () => {
    render(<AgentNode agent={{ ...AGENT, name: 'Enrichment', role: 'enrichment' }} spend={null} {...shell(vi.fn())} />);
    const node = screen.getByRole('button', { name: 'Enrichment, lead information agent' });
    expect(node).toHaveTextContent('lead information');
  });

  it('Enter and Space activate the node click handler', async () => {
    const onClick = vi.fn();
    render(<NoteNode note={{ id: 'n1', title: 'Plan', content: 'text', x: 0, y: 0 }} {...shell(onClick)} />);
    const node = screen.getByRole('button', { name: 'Note: Plan' });
    node.focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard(' ');
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('opens file details from the file node keyboard target while keeping a real download link', async () => {
    const onClick = vi.fn();
    render(<FileNode file={{ id: 'f1', name: 'brief.md', size: 42, x: 0, y: 0 }} canvasId="c1" {...shell(onClick)} />);
    const node = screen.getByRole('group', { name: 'Document: brief.md' });
    const download = screen.getByRole('link', { name: 'Download' });

    node.focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard(' ');

    expect(onClick).toHaveBeenCalledTimes(2);
    expect(download).toHaveAttribute('href', '/api/canvases/c1/files/f1');
  });
});
