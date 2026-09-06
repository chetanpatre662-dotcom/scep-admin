/**
 * realtime/notifyBus.js
 * -----------------------------------------------------------------------------
 * Indirection so services can push a realtime notification to a specific user's
 * live sockets WITHOUT importing the WebSocket server (mirrors realtimeBus).
 * The WebSocket layer registers a deliverer at startup; safe no-op otherwise.
 * -----------------------------------------------------------------------------
 */
'use strict';

let deliverer = null;

/** Called by the WS layer at startup: fn(userId, event, payload). */
function setNotifier(fn) {
  deliverer = typeof fn === 'function' ? fn : null;
}

/** Push a realtime event to a single user's sockets. Safe no-op if unset. */
function notifyUser(userId, event, payload) {
  if (deliverer) {
    try { deliverer(userId, event, payload); } catch (e) { /* never break persistence */ }
  }
}

module.exports = { setNotifier, notifyUser };
