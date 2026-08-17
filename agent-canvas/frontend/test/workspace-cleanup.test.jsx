import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../src/api.js', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, api: vi.fn() };
});

vi.mock('../src/Canvas.jsx', () => ({
  default: ({ notes, files, onOpen }) => (
    <div aria-label="Canvas contents">
      {notes.map((note) => (
        <button key={note.id} onClick={() => onOpen('note', note)}>Open note {note.title}</button>
      ))}
      {files.map((file) => (
        <button key={file.id} onClick={() => onOpen('file', file)}>Open document {file.name}</button>
      ))}
    </div>
  ),
}));

import { api } from '../src/api.js';
import { AppCtx } from '../src/App.jsx';
import Workspace from '../src/Workspace.jsx';
import NeedsYouView from '../src/NeedsYouView.jsx';
import { NotePanel } from '../src/Panels.jsx';

const USER = { email: 'editor@example.com', name: 'Editor', role: 'member' };
const BUDGET = { paused: false, cost_usd: 0, budget_usd: 25, input_tokens: 0, output_tokens: 0 };

let access;
let canvasList;
let notes;
let files;

function note(overrides = {}) {
  return {
    id: 'n1', title: 'Current note', content: 'Real context', pinned: 0,
    version: 1, x: 120, y: 300, updated_by: USER.email,
    updated_at: '2026-08-16T06:00:00Z', ...overrides,
  };
}

function fileRecord(overrides = {}) {
  return {
    id: 'f1', name: 'Customer brief.md', mime: 'text/markdown', size: 42,
    x: 120, y: 840, uploaded_by: USER.email, created_at: '2026-08-16T06:00:00Z',
    ...overrides,
  };
}

function canvasState() {
  return {
    canvas: { id: 'c1', name: 'Customer work' }, access,
    agents: [{ id: 'a1', name: 'Scout', role: 'research', color: '#1677ff', status: 'idle' }],
    notes: [...notes], tasks: [], files: [...files], people: [], handoffs: [], runs: [],
  };
}

function installApi() {
  api.mockImplementation((path, opts = {}) => {
    if (path === '/api/canvases' && !opts.method) return Promise.resolve({ canvases: canvasList, archived: [] });
    if (path === '/api/control/status') return Promise.resolve(BUDGET);
    if (path === '/api/roster') return Promise.resolve({ roster: [] });
    if (path === '/api/capabilities') return Promise.resolve({ connected: false });
    if (path === '/api/health/integrations') return Promise.resolve({ aggregate: 'ready', integrations: [], queue: { queued: 0 } });
    if (path === '/api/canvases/c1' && !opts.method) return Promise.resolve(canvasState());
    if (path === '/api/canvases/c1' && opts.method === 'PATCH') {
      canvasList = [];
      return Promise.resolve({ canvas: { id: 'c1', archived: 1 } });
    }
    if (path === '/api/canvases/c1/memory') return Promise.resolve({ entries: [] });
    if (path === '/api/canvases/c1/activity?limit=300') return Promise.resolve({ events: [] });
    if (path === '/api/canvases/c1/spend') return Promise.resolve({ daily: BUDGET, perAgent: [] });
    if (path === '/api/canvases/c1/analytics') return Promise.resolve({});
    if (path === '/api/escalations') return Promise.resolve({ escalations: [] });
    if (path === '/api/attention?canvas_id=c1') return Promise.resolve({ attention: [] });
    if (path === '/api/canvases/c1/notes' && opts.method === 'POST') {
      const created = note({ id: 'n-new', title: opts.body.title, content: '', pinned: 0, x: opts.body.x, y: opts.body.y });
      notes.push(created);
      return Promise.resolve({ note: created });
    }
    if (path === '/api/canvases/c1/notes/n-new' && opts.method === 'DELETE') {
      notes = notes.filter((item) => item.id !== 'n-new');
      return Promise.resolve({ ok: true, note: { id: 'n-new' } });
    }
    if (path.startsWith('/api/canvases/c1/files?name=') && opts.method === 'POST') {
      const name = decodeURIComponent(path.split('?name=')[1]);
      const created = fileRecord({ id: 'f-new', name, mime: opts.headers['Content-Type'], size: opts.body.size, x: 0, y: 0 });
      files.push(created);
      return Promise.resolve({ file: created });
    }
    if (path === '/api/canvases/c1/files/f-new' && opts.method === 'DELETE') {
      files = files.filter((item) => item.id !== 'f-new');
      return Promise.resolve({ ok: true, file: { id: 'f-new' } });
    }
    return Promise.resolve({});
  });
}

function renderWorkspace({ user = USER, config = {} } = {}) {
  return render(
    <AppCtx.Provider value={{
      user, setUser: vi.fn(), toast: vi.fn(), theme: 'light', setTheme: vi.fn(),
      config: { inquiryHome: false, needsYou: false, rooms: false, standingRules: false, ...config },
    }}>
      <Workspace />
    </AppCtx.Provider>,
  );
}

beforeEach(() => {
  access = 'edit';
  canvasList = [{ id: 'c1', name: 'Customer work' }];
  notes = [];
  files = [];
  api.mockReset();
  installApi();
  class TestWebSocket {
    static OPEN = 1;
    readyState = 1;
    send() {}
    close() {}
  }
  vi.stubGlobal('WebSocket', TestWebSocket);
});

describe('user-facing canvas cleanup', () => {
  it('removes the Workbook demo and creates then removes a real note without reload', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: '+ Note' });

    expect(screen.queryByText('Workbook')).not.toBeInTheDocument();
    expect(screen.queryByText('Run cleanup')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '+ Note' }));
    expect(await screen.findByDisplayValue('Untitled note')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open note Untitled note' })).toBeInTheDocument();
    expect(api).toHaveBeenCalledWith('/api/canvases/c1/notes', expect.objectContaining({ method: 'POST' }));

    await userEvent.click(screen.getByRole('button', { name: 'Remove note' }));
    expect(screen.getByText('Remove this note?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Yes, remove note' }));

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Open note Untitled note' })).not.toBeInTheDocument());
    expect(screen.queryByDisplayValue('Untitled note')).not.toBeInTheDocument();
    expect(api).toHaveBeenCalledWith('/api/canvases/c1/notes/n-new', { method: 'DELETE' });
  });

  it('gives a pinned note an explicit live-context warning before removal', async () => {
    const onRemove = vi.fn().mockResolvedValue(true);
    render(<NotePanel note={note({ pinned: 1 })} pinnedNotes={[note({ id: 'n-other', title: 'Client constraints', pinned: 1 })]} onSave={vi.fn()} onRemove={onRemove} onClose={vi.fn()} />);

    expect(screen.getByRole('checkbox', { name: 'Include in every agent run' })).toBeChecked();
    expect(screen.getByText(/added alongside 1 other live-context note: Client constraints/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove note' }));
    expect(screen.getByText('This note is pinned as live context.')).toBeInTheDocument();
    expect(screen.getByText(/stop being included in future agent runs\. Audit history is retained/i)).toBeInTheDocument();
    expect(onRemove).not.toHaveBeenCalled();
  });

  it('keeps note mutations out of a view-only canvas', async () => {
    access = 'view';
    notes = [note()];
    renderWorkspace();

    await userEvent.click(await screen.findByRole('button', { name: 'Open note Current note' }));
    expect(screen.queryByRole('button', { name: '+ Note' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Upload document' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Choose a document to add to this canvas')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save note' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove note' })).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('Current note')).toHaveAttribute('readonly');
    expect(screen.getByText(/View only/)).toBeInTheDocument();
  });

  it('uploads raw document content, opens agent-ready details, and removes it without a reload', async () => {
    renderWorkspace();
    const input = await screen.findByLabelText('Choose a document to add to this canvas');
    expect(input).toHaveAttribute('accept', '.pdf,.docx,.txt,.md,.csv,.json,.xlsx');

    const file = new File(['# Current customer brief'], 'Customer brief.md', { type: 'text/markdown' });
    await userEvent.upload(input, file);

    expect(await screen.findByRole('button', { name: 'Open document Customer brief.md' })).toBeInTheDocument();
    expect(screen.getByText('Customer brief.md is ready for agents.')).toBeInTheDocument();
    expect(api).toHaveBeenCalledWith(
      '/api/canvases/c1/files?name=Customer%20brief.md',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'text/markdown' },
        body: file,
      }),
    );

    expect(screen.getByRole('complementary', { name: 'Document details: Customer brief.md' })).toBeInTheDocument();
    expect(screen.getByText('Ready for agents')).toBeInTheDocument();
    expect(screen.getByText(/interpret, summarize, compare, or enrich/i)).toBeInTheDocument();
    const download = screen.getByRole('link', { name: 'Download original' });
    expect(download).toHaveAttribute('href', '/api/canvases/c1/files/f-new');

    await userEvent.click(screen.getByRole('button', { name: 'Remove document' }));
    expect(screen.getByText(/disappear from this workspace and from future agent reads/i)).toBeInTheDocument();
    expect(screen.getByText(/audit history is retained/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Yes, remove document' }));

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Open document Customer brief.md' })).not.toBeInTheDocument());
    expect(screen.queryByRole('complementary', { name: 'Document details: Customer brief.md' })).not.toBeInTheDocument();
    expect(api).toHaveBeenCalledWith('/api/canvases/c1/files/f-new', { method: 'DELETE' });
  });

  it('rejects unsupported and oversized files before upload', async () => {
    renderWorkspace();
    const input = await screen.findByLabelText('Choose a document to add to this canvas');

    await userEvent.upload(input, new File(['not supported'], 'slides.pptx', { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }), { applyAccept: false });
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a PDF, Word (.docx), TXT, Markdown, CSV, JSON, or XLSX document.');

    const tooLarge = new File(['large'], 'large.csv', { type: 'text/csv' });
    Object.defineProperty(tooLarge, 'size', { value: 5 * 1024 * 1024 + 1 });
    await userEvent.upload(input, tooLarge);
    expect(screen.getByRole('alert')).toHaveTextContent('That document is over the 5 MB upload limit.');
    expect(api.mock.calls.some(([path, opts]) => path.includes('/files?name=') && opts?.method === 'POST')).toBe(false);
  });

  it('announces an indeterminate upload and prevents a second selection while busy', async () => {
    const fallback = api.getMockImplementation();
    let resolveUpload;
    api.mockImplementation((path, opts = {}) => {
      if (path.startsWith('/api/canvases/c1/files?name=') && opts.method === 'POST') {
        return new Promise((resolve) => { resolveUpload = resolve; });
      }
      return fallback(path, opts);
    });
    renderWorkspace();
    const input = await screen.findByLabelText('Choose a document to add to this canvas');
    const file = new File(['name,amount\nAcme,10'], 'pipeline.csv', { type: 'text/csv' });

    await userEvent.upload(input, file);
    const uploadButton = screen.getByRole('button', { name: 'Upload document' });
    expect(uploadButton).toBeDisabled();
    expect(uploadButton).toHaveTextContent('Uploading…');
    expect(input).toBeDisabled();
    expect(screen.getByRole('progressbar', { name: 'Document upload in progress' })).toBeInTheDocument();
    expect(screen.getByText('Uploading pipeline.csv…')).toBeInTheDocument();

    resolveUpload({ file: fileRecord({ id: 'f-new', name: 'pipeline.csv', mime: 'text/csv', size: file.size }) });
    await waitFor(() => expect(screen.getByText('pipeline.csv is ready for agents.')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Upload document' })).toBeEnabled();
  });

  it('keeps view-only file details download-only', async () => {
    access = 'view';
    files = [fileRecord()];
    renderWorkspace();

    await userEvent.click(await screen.findByRole('button', { name: 'Open document Customer brief.md' }));
    expect(screen.getByRole('link', { name: 'Download original' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove document' })).not.toBeInTheDocument();
    expect(screen.getByText(/View only · the original can be downloaded/i)).toBeInTheDocument();
  });

  it('offers an obvious create action when no canvases exist', async () => {
    canvasList = [];
    renderWorkspace();

    expect(await screen.findByRole('heading', { name: 'Start with a canvas' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Create a canvas' }));
    expect(screen.getByPlaceholderText('New canvas name…')).toBeInTheDocument();
  });

  it('clears the last canvas completely after archive and leaves only the empty-state action', async () => {
    notes = [note({ title: 'Old canvas note' })];
    renderWorkspace({
      user: { ...USER, role: 'owner' },
      config: { needsYou: true, standingRules: true },
    });

    expect(await screen.findByRole('button', { name: 'Open note Old canvas note' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Home' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Needs you' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rules' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Memory' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Archive' }));

    expect(await screen.findByRole('heading', { name: 'Start with a canvas' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create a canvas' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Canvas contents')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open note Old canvas note' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Home' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Needs you' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rules' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Memory' })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Tell an agent what to do/i)).not.toBeInTheDocument();
    expect(api).toHaveBeenCalledWith('/api/canvases/c1', { method: 'PATCH', body: { archived: true } });
  });

  it('does not render the retired pending-change action', () => {
    const row = {
      type: 'pending_changeset', owner: {}, created_at: '2026-08-16T06:00:00Z',
      decision: 'Review a proposed demo change', context: '', contextData: null,
      consequence: '', recommendation: '', sourceRef: { id: 'legacy' },
    };
    render(
      <NeedsYouView rows={[row]} userEmail={USER.email} agentsById={{}} people={[]} agents={[]}
        onResolveEscalation={vi.fn()} onAssign={vi.fn()} onOpenMemory={vi.fn()} onOpenRun={vi.fn()}
        onRetryRun={vi.fn()} onExtendReview={vi.fn()} onAcknowledgeRuleRun={vi.fn()} />,
    );
    expect(screen.queryByRole('button', { name: /workbook/i })).not.toBeInTheDocument();
  });
});
