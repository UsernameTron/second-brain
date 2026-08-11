'use strict';
// WebSocket hub: live canvas events + human presence (cursors, selections).
// Auth rides the same session cookie as HTTP; canvas access is re-checked
// server-side on join.

const { WebSocketServer } = require('ws');
const bus = require('./bus');
const { tokenFromReq, verifySessionToken, canAccessCanvas } = require('./auth');

const PRESENCE_COLORS = ['#e8641f', '#4cc2ab', '#eaa521', '#a67fc0', '#a9c94f', '#d9482b', '#6aa1c4', '#c9b48e'];

function attachWebSocket(server) {
  const wss = new WebSocketServer({ noServer: true });
  const channels = new Map(); // canvasId -> Set<ws>

  server.on('upgrade', (req, socket, head) => {
    if (!req.url.startsWith('/ws')) return socket.destroy();
    let user;
    try {
      const token = tokenFromReq(req);
      if (!token) throw new Error('no session');
      user = verifySessionToken(token);
    } catch {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.user = user;
      ws.color = PRESENCE_COLORS[Math.abs(hash(user.email)) % PRESENCE_COLORS.length];
      wss.emit('connection', ws, req);
    });
  });

  function channel(canvasId) {
    if (!channels.has(canvasId)) channels.set(canvasId, new Set());
    return channels.get(canvasId);
  }

  function broadcast(canvasId, message, except = null) {
    const payload = JSON.stringify(message);
    const targets = canvasId ? channel(canvasId) : allClients();
    for (const ws of targets) {
      if (ws !== except && ws.readyState === ws.OPEN) ws.send(payload);
    }
  }

  function allClients() {
    const all = new Set();
    for (const set of channels.values()) for (const ws of set) all.add(ws);
    return all;
  }

  function presenceList(canvasId) {
    return [...channel(canvasId)].map((ws) => ({
      email: ws.user.email, name: ws.user.name || ws.user.email, color: ws.color, cursor: ws.cursor || null, selection: ws.selection || [],
    }));
  }

  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (msg.type === 'join') {
        const check = canAccessCanvas(ws.user, msg.canvasId);
        if (!check.ok) return ws.send(JSON.stringify({ type: 'error', error: check.error }));
        if (ws.canvasId) channel(ws.canvasId).delete(ws);
        ws.canvasId = msg.canvasId;
        channel(msg.canvasId).add(ws);
        broadcast(msg.canvasId, { type: 'presence', canvasId: msg.canvasId, users: presenceList(msg.canvasId) });
      } else if (msg.type === 'cursor' && ws.canvasId) {
        ws.cursor = { x: msg.x, y: msg.y };
        broadcast(ws.canvasId, { type: 'cursor', canvasId: ws.canvasId, email: ws.user.email, name: ws.user.name || ws.user.email, color: ws.color, x: msg.x, y: msg.y }, ws);
      } else if (msg.type === 'selection' && ws.canvasId) {
        ws.selection = Array.isArray(msg.ids) ? msg.ids.slice(0, 50) : [];
        broadcast(ws.canvasId, { type: 'selection', canvasId: ws.canvasId, email: ws.user.email, color: ws.color, ids: ws.selection }, ws);
      }
    });
    ws.on('close', () => {
      if (ws.canvasId) {
        channel(ws.canvasId).delete(ws);
        broadcast(ws.canvasId, { type: 'presence', canvasId: ws.canvasId, users: presenceList(ws.canvasId) });
      }
    });
  });

  // Orchestrator/domain events → the right canvas channel (null = everyone).
  bus.on('event', (event) => broadcast(event.canvasId, event));

  return wss;
}

function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return h;
}

module.exports = { attachWebSocket };
