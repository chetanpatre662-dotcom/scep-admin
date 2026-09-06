/**
 * services/realtimeService.js — ONE shared authenticated WebSocket pipeline.
 * -----------------------------------------------------------------------------
 * Class detail pages use this single connection (never raw WebSocket per page).
 * Responsibilities: connect + Firebase-token auth, auto-reconnect with backoff,
 * join/leave class rooms, subscribe/emit events, connection-state callbacks, and
 * duplicate suppression (by server message id).
 *
 * No polling anywhere: live updates arrive as server-pushed events.
 * -----------------------------------------------------------------------------
 */
import { ENV } from '../config.js';
import { getIdToken } from '../firebase/auth.js';

/** Derive ws(s)://host/ws from the configured API base URL. */
function wsUrl() {
  if (ENV.WS_URL) return ENV.WS_URL;
  try {
    const api = new URL(ENV.API_BASE_URL, window.location.origin);
    const proto = api.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${api.host}/ws`;
  } catch {
    return 'ws://162.245.191.109:5000/ws';
  }
}

const listeners = new Map();      // event -> Set<cb>
const stateListeners = new Set(); // cb(state)
const joinedClasses = new Set();  // rooms to (re)join on reconnect
const seenMessageIds = new Set(); // dedupe delivered message ids

let ws = null;
let state = 'disconnected';       // disconnected | connecting | connected | authenticated | reconnecting
let authed = false;
let reconnectAttempts = 0;
let manualClose = false;

function setState(s) {
  state = s;
  stateListeners.forEach((cb) => { try { cb(s); } catch {} });
}

export function getState() { return state; }
export function onStateChange(cb) { stateListeners.add(cb); return () => stateListeners.delete(cb); }

export function subscribe(event, cb) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(cb);
  return () => listeners.get(event)?.delete(cb);
}
function dispatch(event, msg) { listeners.get(event)?.forEach((cb) => { try { cb(msg); } catch {} }); }

/** Open the shared connection and authenticate. Safe to call repeatedly. */
export async function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  manualClose = false;
  setState(reconnectAttempts > 0 ? 'reconnecting' : 'connecting');

  const token = await getIdToken();
  if (!token) { setState('disconnected'); return; }

  ws = new WebSocket(wsUrl());

  ws.onopen = () => {
    authed = false;
    ws.send(JSON.stringify({ event: 'auth', token }));
  };

  ws.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }

    if (msg.event === 'auth.success') {
      authed = true;
      reconnectAttempts = 0;
      setState('authenticated');
      // Rejoin any active rooms after (re)connect.
      joinedClasses.forEach((classId) => ws.send(JSON.stringify({ event: 'class.join', classId })));
      dispatch('auth.success', msg);
      return;
    }
    if (msg.event === 'auth.error') { setState('disconnected'); dispatch('auth.error', msg); return; }

    // Duplicate suppression for messages (survives reconnect rebroadcasts).
    if (msg.event === 'message.created' && msg.message && msg.message.id != null) {
      if (seenMessageIds.has(msg.message.id)) return;
      seenMessageIds.add(msg.message.id);
    }
    dispatch(msg.event, msg);
  };

  ws.onclose = () => {
    authed = false;
    if (manualClose) { setState('disconnected'); return; }
    // Exponential backoff reconnect (no polling of data — just connection retry).
    reconnectAttempts += 1;
    const delay = Math.min(1000 * 2 ** (reconnectAttempts - 1), 15000);
    setState('reconnecting');
    setTimeout(() => connect(), delay);
  };

  ws.onerror = () => { try { ws.close(); } catch {} };
}

function whenAuthed(fn, tries = 0) {
  if (authed && ws && ws.readyState === WebSocket.OPEN) return fn();
  if (tries > 50) return; // ~5s give-up; onopen auth will re-drive joins anyway
  setTimeout(() => whenAuthed(fn, tries + 1), 100);
}

export function joinClass(classId) {
  joinedClasses.add(Number(classId));
  connect();
  whenAuthed(() => ws.send(JSON.stringify({ event: 'class.join', classId: Number(classId) })));
}

export function leaveClass(classId) {
  joinedClasses.delete(Number(classId));
  if (authed && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ event: 'class.leave', classId: Number(classId) }));
  }
}

/** Send a chat message (persisted + broadcast by the server). */
export function sendMessage(classId, text, clientMsgId) {
  whenAuthed(() => ws.send(JSON.stringify({ event: 'message.send', classId: Number(classId), text, clientMsgId })));
}

/** Fully disconnect (e.g. on logout). */
export function disconnect() {
  manualClose = true;
  joinedClasses.clear();
  seenMessageIds.clear();
  if (ws) { try { ws.close(); } catch {} }
  setState('disconnected');
}
