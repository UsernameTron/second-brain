// P3 Rooms UI contracts: list + create form, open room → sections render,
// lens switch refetches, refresh posts, view-only hides the refresh action.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../src/api.js', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, api: vi.fn() };
});

import { api } from '../src/api.js';
import RoomsView from '../src/RoomsView.jsx';

const OWNER = { email: 'pete@cloudtechgurus.com', role: 'owner' };
const MEMBER = { email: 'jessica@cloudtechgurus.com', role: 'member' };
const ROOM = { id: 'r1', canvasId: 'c1', roomType: 'deal', externalRef: 'CRM-42', lifecycle: 'active', name: 'Acme renewal', refreshedAt: null, refreshedBy: null };
const EMPTY_SECTIONS = {
  people: { onCanvas: [], members: [{ email: 'pete@cloudtechgurus.com', access: 'edit' }] },
  evidence: [], work: { tasks: [], runs: [] }, decisions: [], risks: [],
  openQuestions: { escalations: [], inquiries: [] },
};
const built = (over = {}) => ({ room: ROOM, lens: 'now', sections: EMPTY_SECTIONS, refreshes: [], access: 'edit', generatedAt: new Date().toISOString(), ...over });

function renderRooms(props = {}) {
  return render(<RoomsView user={OWNER} roster={[]} onOpenCanvas={vi.fn()} onOpenRun={vi.fn()} toast={vi.fn()} {...props} />);
}

beforeEach(() => { api.mockReset(); });

describe('Evidence Rooms view', () => {
  it('lists rooms and shows the create form to the owner only', async () => {
    api.mockResolvedValue({ rooms: [ROOM], archived: [] });
    renderRooms();
    expect(await screen.findByText('Acme renewal')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Room name/)).toBeInTheDocument();
  });

  it('members see no create form', async () => {
    api.mockResolvedValue({ rooms: [], archived: [] });
    renderRooms({ user: MEMBER });
    expect(await screen.findByText(/No rooms yet/)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Room name/)).toBeNull();
  });

  it('opening a room renders the six sections; lens switch refetches', async () => {
    api.mockImplementation((path) => {
      if (path === '/api/rooms') return Promise.resolve({ rooms: [ROOM], archived: [] });
      return Promise.resolve(built({ lens: path.includes('lens=risk') ? 'risk' : 'now' }));
    });
    renderRooms();
    await userEvent.click(await screen.findByText('Acme renewal'));
    for (const title of ['People', 'Evidence', 'Work', 'Decisions', 'Risks', 'Open questions']) {
      expect(await screen.findByText(title)).toBeInTheDocument();
    }
    await userEvent.click(screen.getByRole('radio', { name: 'Risk' }));
    expect(api).toHaveBeenLastCalledWith('/api/rooms/r1?lens=risk');
  });

  it('Refresh room posts; view-only access hides it', async () => {
    api.mockImplementation((path, opts) => {
      if (path === '/api/rooms') return Promise.resolve({ rooms: [ROOM], archived: [] });
      if (opts && opts.method === 'POST') return Promise.resolve({ room: ROOM, run: { id: 'run1', mode: 'ask' } });
      return Promise.resolve(built());
    });
    renderRooms();
    await userEvent.click(await screen.findByText('Acme renewal'));
    await userEvent.click(await screen.findByRole('button', { name: 'Refresh room' }));
    expect(api).toHaveBeenCalledWith('/api/rooms/r1/refresh', { method: 'POST', body: {} });
  });

  it('view-only access hides the refresh action', async () => {
    api.mockImplementation((path) => {
      if (path === '/api/rooms') return Promise.resolve({ rooms: [ROOM], archived: [] });
      return Promise.resolve(built({ access: 'view' }));
    });
    renderRooms({ user: MEMBER });
    await userEvent.click(await screen.findByText('Acme renewal'));
    expect(await screen.findByText('view only')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refresh room' })).toBeNull();
  });
});
