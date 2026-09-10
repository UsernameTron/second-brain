import React, { useRef } from 'react';
import { fmtUSD, initials } from './api.js';
import { RequestError } from './RequestState.jsx';
import { useDialog } from './useDialog.js';
import { TEAM_TEMPLATES, rosterIdsForTeam } from './teamTemplates.js';

export default function WorkspaceHeader({ user, theme, setTheme, spaces, navigation, creation, account, controls }) {
  const moreRef = useRef(null);
  const go = (view) => { navigation.go(view); if (moreRef.current) moreRef.current.open = false; };
  const current = spaces.list.find((space) => space.id === spaces.id);
  return <>
    <header className="topbar simple-topbar">
      <div className="brand"><span className="brand-glyph" />Agent Canvas</div>
      <div className="project-picker">
        {spaces.list.length > 1 ? <label>Project space<select aria-label="Switch project space" value={spaces.id || ''} onChange={(e) => spaces.select(e.target.value)}>
          {spaces.list.map((space) => <option key={space.id} value={space.id}>{space.name}</option>)}
        </select></label> : current ? <span aria-label={`Current project space: ${current.name}`}><small>Project space</small><strong>{current.name}</strong></span> : <span>No project space selected</span>}
        <details className="header-menu"><summary aria-label="Project-space actions">Space actions</summary><div className="header-menu-content">
          <button onClick={creation.show}>New project space</button>
          {user.role === 'owner' ? <details><summary>Owner actions</summary>
            {spaces.id ? <button onClick={spaces.archive}>Archive current space</button> : null}
            <button onClick={spaces.archived}>Archived spaces and restore</button>
          </details> : null}
        </div></details>
      </div>
      <nav className="primary-nav" aria-label="Main navigation">
        <button className={`btn ghost ${navigation.view === 'home' ? 'active' : ''}`} aria-current={navigation.view === 'home' ? 'page' : undefined} onClick={() => go('home')}>Home</button>
        {navigation.needsYou ? <button className={`btn ghost ny-btn ${navigation.view === 'needsyou' ? 'active' : ''}`} onClick={() => go('needsyou')}>Needs you{navigation.count !== 0 ? <span className="tray-badge">{navigation.count}</span> : null}</button> : null}
        <details className="header-menu" ref={moreRef}><summary>More</summary><div className="header-menu-content">
          {navigation.rooms ? <button onClick={() => go('rooms')}>Rooms</button> : null}
          {navigation.hasSpace ? <>
            <button onClick={() => { navigation.memory(); if (moreRef.current) moreRef.current.open = false; }}>Memory</button>
            {navigation.rules ? <button onClick={() => go('rules')}>Scheduled work</button> : null}
            <button onClick={() => go('documents')}>Documents &amp; notes</button>
            <button onClick={() => go('team')}>Team</button>
          </> : null}
          <button onClick={() => go('help')}>Help</button>
          <details><summary>Advanced</summary>
            <button onClick={() => go('canvas')}>Canvas</button>
            <button onClick={() => go('commands')}>Commands</button>
            <button onClick={() => go('activity')}>Activity</button>
          </details>
        </div></details>
      </nav>
      <div className="header-safety">
        <button className="budget-meter" onClick={controls.spending} aria-label="Spending and daily cap"><span>{controls.budget ? `${fmtUSD(controls.budget.cost_usd)} / ${fmtUSD(controls.budget.budget_usd)}` : 'Spending unknown'}</span></button>
        <button className="btn ghost" onClick={controls.connections}>Connections</button>
        {controls.paused ? user.role === 'owner' ? <button disabled={controls.busy} className="btn ok" onClick={controls.resume}>Resume</button> : <span className="chip">Paused</span>
          : <button disabled={controls.busy} className="btn danger" onClick={controls.pause}>Pause</button>}
      </div>
      <div className="user-menu-wrap">
        <button className="avatar me" ref={account.avatarRef} aria-label="Account" aria-expanded={account.open} onClick={account.toggle} title={user.email}>{user.picture ? <img src={user.picture} alt="" referrerPolicy="no-referrer" /> : initials(user.name || user.email)}</button>
        {account.open ? <div className="user-menu" onKeyDown={(e) => { if (e.key === 'Escape') { account.toggle(); account.avatarRef.current?.focus(); } }}>
          <div className="user-menu-id"><b>{user.name || user.email}</b><span>{user.email}</span><span>{user.role === 'owner' ? 'Workspace owner' : 'Team member'}</span></div>
          <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>Appearance: {theme === 'dark' ? 'switch to light' : 'switch to dark'}</button>
          {user.role === 'owner' ? <><button onClick={account.admin}>Owner settings</button><a href="/api/export" download>Download operational ledger</a></> : null}
          <button disabled={account.signingOut} onClick={account.signOut}>{account.signingOut ? 'Signing out…' : 'Sign out'}</button>
        </div> : null}
      </div>
    </header>
    {creation.open ? <CreateSpaceDialog {...creation} /> : null}
  </>;
}

function CreateSpaceDialog({ name, setName, close, create, roster, selected, setSelected, teamId, busy, error, checkStatus }) {
  const ref = useDialog(close);
  const members = roster.filter((entry) => entry.enabled && selected?.has(entry.id));
  return <div className="modal-overlay"><div className="modal" role="dialog" aria-modal="true" aria-label="New project space" ref={ref} tabIndex={-1}>
    <div className="modal-head"><h2>New project space</h2><button className="icon-btn" onClick={close} aria-label="Close">×</button></div>
    <form className="modal-body" onSubmit={(e) => { e.preventDefault(); create(); }}>
      <RequestError error={error} subject="Creating this project space" onRetry={checkStatus} retryLabel="Check project spaces" />
      <label htmlFor="project-name">Project-space name</label><input id="project-name" autoFocus required value={name} onChange={(e) => setName(e.target.value)} placeholder="New project-space name…" disabled={busy} />
      <fieldset className="canvas-team-picker" disabled={busy || selected === null}>
        <legend>Choose a starting team</legend>
        <select aria-label="Starting team" value={teamId} onChange={(e) => setSelected(new Set(rosterIdsForTeam(e.target.value, roster)))}>
          {TEAM_TEMPLATES.map((team) => <option key={team.id} value={team.id} disabled={rosterIdsForTeam(team.id, roster).length === 0}>{team.name}</option>)}
          <option value="custom">Custom team</option>
        </select>
        <p>{TEAM_TEMPLATES.find((team) => team.id === teamId)?.description || 'Custom team selected.'}</p>
        <div className="canvas-team-members">{members.map((entry) => <span className="canvas-team-member" key={entry.id}>{entry.name}</span>)}</div>
        {selected === null ? <p>Team templates are unavailable. Close this form and retry the team list.</p> : members.length === 0 ? <p>No agents selected. This space will start without agents.</p> : null}
        <details><summary>Customize team ({members.length})</summary>{roster.filter((entry) => entry.enabled).map((entry) => <label className="roster-check" key={entry.id}>
          <input type="checkbox" checked={selected?.has(entry.id) || false} onChange={() => setSelected((previous) => { const next = new Set(previous || []); if (next.has(entry.id)) next.delete(entry.id); else next.add(entry.id); return next; })} />{entry.name} <span className="dim">{entry.role}</span>
        </label>)}</details>
      </fieldset>
      <div className="canvas-new-actions"><button type="button" className="btn ghost" onClick={close}>Cancel</button><button className="btn primary" disabled={busy || error?.unconfirmed || !name.trim() || selected === null}>{busy ? 'Creating…' : 'Create'}</button></div>
    </form>
  </div></div>;
}
