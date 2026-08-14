'use strict';
// Process-lifetime probe evidence for the systems board (IMPROVE finding 8):
// a lamp earns green from a successful probe, not from config presence.
// Process memory is the honest scope — a restart forgets, and an unprobed
// integration shows amber until someone probes it again.

const state = new Map(); // id -> { ok, ms, error, at }

function record(id, { ok, ms, error }) {
  state.set(String(id), {
    ok: Boolean(ok),
    ms: ms == null ? null : Number(ms),
    error: error ? String(error).slice(0, 300) : null,
    at: Date.now(),
  });
}

function get(id) {
  return state.get(String(id)) || null;
}

module.exports = { record, get, _state: state };
