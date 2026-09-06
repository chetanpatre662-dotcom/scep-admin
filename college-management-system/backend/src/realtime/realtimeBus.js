/**
 * realtime/realtimeBus.js
 * -----------------------------------------------------------------------------
 * Tiny indirection so services can broadcast realtime events to a class room
 * WITHOUT importing the WebSocket server (avoids circular deps and keeps
 * services transport-agnostic). The WebSocket layer registers a broadcaster at
 * startup; if none is registered (e.g. during a unit test), broadcasts are
 * safely no-ops.
 * -----------------------------------------------------------------------------
 */
'use strict';

let broadcaster = null;

/** Called by the WebSocket layer at startup: fn(classId, event, payload). */
function setBroadcaster(fn) {
  broadcaster = typeof fn === 'function' ? fn : null;
}

/** Broadcast an event to everyone in a class room. Safe no-op if unset. */
function broadcastToClass(classId, event, payload) {
  if (broadcaster) {
    try { broadcaster(classId, event, payload); } catch (e) { /* never let delivery break persistence */ }
  }
}

module.exports = { setBroadcaster, broadcastToClass };
