/**
 * realtime/wsServer.js
 * -----------------------------------------------------------------------------
 * Authenticated WebSocket realtime pipeline. Attaches to the existing HTTP
 * server (shares the port). PostgreSQL is the source of truth; this layer only
 * authenticates, enforces class access, persists messages via services, and
 * delivers events to class rooms. No polling anywhere.
 *
 * Protocol (JSON text frames): { event, ...payload }
 *   client -> server:
 *     auth           { token }                  (must be first)
 *     class.join     { classId }
 *     class.leave    { classId }
 *     message.send   { classId, text, clientMsgId? }
 *     ping           {}
 *   server -> client:
 *     auth.success   { user:{id,role,name} }
 *     auth.error     { error }
 *     class.joined   { classId, access }
 *     class.left     { classId }
 *     message.created{ ...message, clientMsgId? }   (broadcast to room)
 *     note.created / questionPaper.created / assignment.created / project.created
 *        (+ .updated/.deleted)                       (broadcast to room)
 *     error          { error, code? }
 *     pong           {}
 *
 * Security: unauthenticated sockets can only send `auth`. class.join is
 * access-checked server-side (faculty owner/admin or eligible student). Room
 * membership is derived from verified identity — never from client-sent role.
 * -----------------------------------------------------------------------------
 */
'use strict';

const { WebSocketServer } = require('ws');
const firebaseAdmin = require('../config/firebaseAdmin');
const userRepository = require('../repositories/userRepository');
const classService = require('../services/classService');
const messageService = require('../services/messageService');
const { setBroadcaster } = require('./realtimeBus');
const { setNotifier } = require('./notifyBus');

// classId(string) -> Set<ws>
const rooms = new Map();
// userId(string) -> Set<ws>  (for per-user notification delivery)
const userSockets = new Map();

function trackUser(ws) {
  const key = String(ws.user.id);
  if (!userSockets.has(key)) userSockets.set(key, new Set());
  userSockets.get(key).add(ws);
}
function untrackUser(ws) {
  if (!ws.user) return;
  const set = userSockets.get(String(ws.user.id));
  if (set) { set.delete(ws); if (!set.size) userSockets.delete(String(ws.user.id)); }
}

/** Push an event to every live socket of a specific user. */
function sendToUser(userId, event, payload) {
  const set = userSockets.get(String(userId));
  if (!set) return;
  const frame = JSON.stringify({ event, ...payload });
  for (const ws of set) { if (ws.readyState === ws.OPEN) ws.send(frame); }
}

function roomFor(classId) {
  const key = String(classId);
  if (!rooms.has(key)) rooms.set(key, new Set());
  return rooms.get(key);
}

function send(ws, event, payload = {}) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({ event, ...payload }));
  }
}

/** Broadcast to every socket currently joined to a class room. */
function broadcastToClass(classId, event, payload) {
  const set = rooms.get(String(classId));
  if (!set) return;
  const frame = JSON.stringify({ event, ...payload });
  for (const ws of set) {
    if (ws.readyState === ws.OPEN) ws.send(frame);
  }
}

function leaveAllRooms(ws) {
  untrackUser(ws);
  if (!ws.joinedClasses) return;
  for (const classId of ws.joinedClasses) {
    rooms.get(String(classId))?.delete(ws);
  }
  ws.joinedClasses.clear();
}

async function handleMessage(ws, raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch { return send(ws, 'error', { error: 'Invalid JSON.' }); }
  const { event } = msg || {};

  // --- Authentication must happen first ---
  if (event === 'auth') {
    try {
      const decoded = await firebaseAdmin.verifyIdToken(msg.token);
      const user = await userRepository.findByFirebaseUid(decoded.uid);
      if (!user) { send(ws, 'auth.error', { error: 'No application profile.' }); return; }
      ws.user = { id: user.id, role: user.role, name: user.display_name || user.email || 'User' };
      ws.joinedClasses = new Set();
      trackUser(ws); // enable per-user notification delivery
      send(ws, 'auth.success', { user: ws.user });
    } catch (e) {
      send(ws, 'auth.error', { error: 'Authentication failed.' });
    }
    return;
  }

  if (!ws.user) { return send(ws, 'error', { error: 'Not authenticated.', code: 'AUTH_REQUIRED' }); }

  switch (event) {
    case 'ping':
      return send(ws, 'pong', {});

    case 'class.join': {
      try {
        const { access } = await classService.getClassForUser(ws.user, msg.classId);
        roomFor(msg.classId).add(ws);
        ws.joinedClasses.add(String(msg.classId));
        send(ws, 'class.joined', { classId: Number(msg.classId), access });
      } catch (e) {
        send(ws, 'error', { error: e.message || 'Cannot join class.', code: e.code || 'JOIN_DENIED' });
      }
      return;
    }

    case 'class.leave': {
      rooms.get(String(msg.classId))?.delete(ws);
      ws.joinedClasses.delete(String(msg.classId));
      return send(ws, 'class.left', { classId: Number(msg.classId) });
    }

    case 'message.send': {
      // Must have joined the room (which was access-checked on join).
      if (!ws.joinedClasses.has(String(msg.classId))) {
        return send(ws, 'error', { error: 'Join the class before sending.', code: 'NOT_JOINED' });
      }
      try {
        const saved = await messageService.sendMessage(ws.user, msg.classId, { text: msg.text, messageType: 'text' });
        // Broadcast the persisted, server-authoritative message to the room.
        // clientMsgId is echoed so the sender can de-dupe its optimistic copy.
        broadcastToClass(msg.classId, 'message.created', { message: saved, clientMsgId: msg.clientMsgId || null });
      } catch (e) {
        send(ws, 'error', { error: e.message || 'Could not send message.', code: e.code || 'SEND_FAILED' });
      }
      return;
    }

    default:
      return send(ws, 'error', { error: `Unknown event: ${event}` });
  }
}

/** Attach a WebSocket server to an existing HTTP server at path /ws. */
function attach(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', (raw) => { handleMessage(ws, raw).catch(() => {}); });
    ws.on('close', () => leaveAllRooms(ws));
    ws.on('error', () => leaveAllRooms(ws));
  });

  // Heartbeat: drop dead sockets (keeps rooms clean; not polling for data).
  const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) { leaveAllRooms(ws); return ws.terminate(); }
      ws.isAlive = false;
      try { ws.ping(); } catch { /* ignore */ }
    });
  }, 30000);
  heartbeat.unref?.();
  wss.on('close', () => clearInterval(heartbeat));

  // Let services broadcast content events to rooms + per-user notifications.
  setBroadcaster(broadcastToClass);
  setNotifier(sendToUser);

  return wss;
}

module.exports = { attach, broadcastToClass, sendToUser, rooms };
