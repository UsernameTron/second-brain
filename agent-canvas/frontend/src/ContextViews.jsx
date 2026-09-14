import React from 'react';
import { fmtBytes } from './api.js';

export function DocumentsView({ notes, files, editable, onNote, onUpload, uploadBusy, onOpen }) {
  return <section className="context-view" aria-label="Documents and notes"><h1>Documents &amp; notes</h1>
    <p>Documents and pinned notes help agents working in this project space.</p>
    {editable ? <div className="context-actions"><button className="btn primary" onClick={onNote}>Add note</button><button className="btn" disabled={uploadBusy} onClick={onUpload}>Add document</button></div> : <p>View only. You can read and download existing material.</p>}
    <h2>Notes</h2>{notes.length === 0 ? <p>No notes yet. {editable ? 'Add a note to give your team context.' : ''}</p> : null}
    <div className="context-list">{notes.map((note) => <button className="context-card" aria-label={`Open note ${note.title}`} key={note.id} onClick={() => onOpen('note', note)}><strong>{note.title || 'Untitled note'}</strong><span>{note.pinned ? 'Included in future agent work' : 'Available in this space'}</span></button>)}</div>
    <h2>Documents</h2>{files.length === 0 ? <p>No documents yet. {editable ? 'Add a document to work with its contents.' : ''}</p> : null}
    <div className="context-list">{files.map((file) => <button className="context-card" aria-label={`Open document ${file.name}`} key={file.id} onClick={() => onOpen('file', file)}><strong>{file.name}</strong><span>{fmtBytes(file.size)} · View details and download</span></button>)}</div>
  </section>;
}

export function TeamView({ agents, people, editable, onOpen, onAddAgent, onBuild, onCustom, builderOn, personForm, presence = [], connected }) {
  return <section className="context-view" aria-label="Project team"><h1>Team</h1><p>The agents and teammates working in this project space.</p>
    {editable ? <div className="context-actions"><button className="btn primary" onClick={onAddAgent}>Add agent</button>{personForm}</div> : null}
    <h2>Agents</h2>{agents.length === 0 ? <p>No agents yet. Add one from the team templates.</p> : null}
    <div className="context-list">{agents.map((agent) => <button className="context-card" key={agent.id} onClick={() => onOpen('agent', agent)}><strong>{agent.name}</strong><span>{agent.role === 'enrichment' ? 'Lead information' : agent.role} · View work and settings</span></button>)}</div>
    <p>{connected ? `Here now: ${presence.map((person) => person.name || person.email).join(", ") || "No other teammates"}` : "Live presence is unavailable. Reconnect to see who is here."}</p>
    <h2>Teammates</h2>{people.length === 0 ? <p>No teammate cards yet.</p> : null}
    {people.map((person) => <p key={person.id}>{person.display || person.email}</p>)}
    {editable ? <details><summary>Advanced</summary><div className="context-actions">{builderOn ? <button className="btn" onClick={onBuild}>Build an agent</button> : null}<button className="btn" onClick={onCustom}>Custom agent</button></div></details> : null}
  </section>;
}

export function HelpView() {
  return <section className="context-view help-view"><h1>Getting started</h1>
    <ol><li><strong>Sign in.</strong> Use your CTG Google account. Open Connections to see which services are available; connecting an account does not prove each service works.</li>
      <li><strong>Ask.</strong> Open Home, type your question and choose Ask. Read the answer and Sources and details. If no supporting sources were recorded, verify the answer before relying on it.</li>
      <li><strong>Act on an answer.</strong> Choose Act on this beside the answer. Review the attached context, type your follow-up and choose Act. The agent can draft or stage changes; CRM changes still require a preview and your approval. Email is always draft-only.</li>
      <li><strong>Answer a Needs You item.</strong> Open Needs you, read the project name and full context, choose Answer, type your decision and choose Submit answer. Wait for acceptance.</li></ol>
    <h2>If something goes wrong</h2><p>Use Try again for a failed read. If a change is not confirmed, Check status before repeating it. Unsaved text is kept while this workspace stays open; copy it before reloading or signing out.</p>
    <p>More contains Rooms, Memory, Scheduled work, Documents &amp; notes and Team. Advanced contains the full Canvas, Commands and Activity. Pause is always available in the header; only the owner can Resume.</p>
    <p>Need help? Give Pete the project name, what you clicked and the approximate time.</p>
  </section>;
}
