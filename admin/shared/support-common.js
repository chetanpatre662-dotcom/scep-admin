// ── Support Module — Shared Logic (College & School Admin) ───────────────────
// Requires admin-common.js to be loaded first (provides API, headers, WS_URL, etc.)

/**
 * Initializes the support ticket system with WebSocket realtime sync.
 * @param {string} institution — "college" or "school"
 */
function initSupport(institution) {
  if (!verifyInstitution(institution)) return;

  let allTickets = [];
  let currentFilter = "all";
  let activeTicketId = null;
  let hasLoadedOnce = false; // tracks first successful load

  // ── Timer / async tracking ──
  let pollTimer = null;
  let ticketRefreshTimer = null;
  let loadMessagesController = null;
  let loadTicketsController = null;
  let isDestroyed = false;
  let isSending = false;

  // ── WebSocket state ──
  let ws = null;
  let wsReconnectTimer = null;
  let wsReconnectAttempts = 0;
  let wsJoinedTicketId = null;

  // ── Debounce timers ──
  let msgDebounceTimer = null;
  let ticketDebounceTimer = null;

  // ── Retry tracking ──
  let ticketRetryCount = 0;
  let messageRetryCount = 0;
  const MAX_RETRIES = 3;

  // ── DOM References (cached once) ──
  const dom = {
    sTotal: document.getElementById("sTotal"),
    sOpen: document.getElementById("sOpen"),
    sPending: document.getElementById("sPending"),
    sResolved: document.getElementById("sResolved"),
    ticketCount: document.getElementById("ticketCount"),
    ticketList: document.getElementById("ticketList"),
    searchInput: document.getElementById("searchInput"),
    chatEmpty: document.getElementById("chatEmpty"),
    chatActive: document.getElementById("chatActive"),
    chatHeader: document.getElementById("chatHeader"),
    chatMessages: document.getElementById("chatMessages"),
    profilePanel: document.getElementById("profilePanel"),
    profileContent: document.getElementById("profileContent"),
    replyInput: document.getElementById("replyInput"),
    connStatus: document.getElementById("connStatus"),
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // UX Helpers — Skeletons, empty states, error banners
  // ═══════════════════════════════════════════════════════════════════════════

  function ticketListSkeleton() {
    return Array.from({ length: 5 }, () =>
      `<div style="padding:14px 16px;margin-bottom:4px">
        <div class="skeleton-line" style="width:60%;height:12px;margin-bottom:8px"></div>
        <div class="skeleton-line" style="width:90%;height:10px;margin-bottom:6px"></div>
        <div class="skeleton-line" style="width:40%;height:8px"></div>
      </div>`
    ).join("");
  }

  function chatSkeleton() {
    return Array.from({ length: 4 }, (_, i) => {
      const isRight = i % 2 === 1;
      const w = 40 + Math.floor(Math.random() * 30);
      return `<div style="align-self:${isRight ? "flex-end" : "flex-start"};max-width:${w}%;margin-bottom:10px">
        <div class="skeleton-line" style="height:38px;border-radius:12px"></div>
      </div>`;
    }).join("");
  }

  function showTicketListError(msg, retryFn) {
    dom.ticketList.innerHTML = `
      <div class="empty-state" style="padding:32px">
        <i class="bi bi-wifi-off"></i>
        <p>${msg}</p>
        <small>Check your connection and try again</small>
        <button onclick="supportCtrl._retryTickets()" style="margin-top:12px;padding:8px 18px;border:1.5px solid var(--primary);background:transparent;color:var(--primary);border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit">
          <i class="bi bi-arrow-clockwise me-1"></i>Retry
        </button>
      </div>`;
  }

  function showChatError(msg) {
    dom.chatMessages.innerHTML = `
      <div class="empty-state" style="padding:32px">
        <i class="bi bi-exclamation-triangle"></i>
        <p>${msg}</p>
        <button onclick="supportCtrl._retryMessages()" style="margin-top:12px;padding:8px 18px;border:1.5px solid var(--primary);background:transparent;color:var(--primary);border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit">
          <i class="bi bi-arrow-clockwise me-1"></i>Retry
        </button>
      </div>`;
  }

  function showOfflineBanner() {
    if (document.getElementById("offlineBanner")) return;
    const banner = document.createElement("div");
    banner.id = "offlineBanner";
    banner.style.cssText = "position:fixed;bottom:0;left:0;right:0;background:#fef3c7;border-top:2px solid #f59e0b;padding:10px 20px;text-align:center;font-size:13px;font-weight:500;color:#92400e;z-index:9999;font-family:Poppins";
    banner.innerHTML = '<i class="bi bi-wifi-off me-2"></i>You are offline. Messages will sync when connection is restored.';
    document.body.appendChild(banner);
  }

  function hideOfflineBanner() {
    const el = document.getElementById("offlineBanner");
    if (el) el.remove();
  }

  function setSendingState(sending) {
    isSending = sending;
    const btn = dom.replyInput?.parentElement?.querySelector("button");
    if (!btn) return;
    if (sending) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status"></span>';
      btn.style.opacity = "0.7";
    } else {
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-send-fill"></i>';
      btn.style.opacity = "1";
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Network status detection
  // ═══════════════════════════════════════════════════════════════════════════

  function onOnline() {
    hideOfflineBanner();
    loadTickets();
    if (activeTicketId) loadMessages(activeTicketId);
    if (!ws || ws.readyState !== WebSocket.OPEN) connectWs();
  }
  function onOffline() { showOfflineBanner(); }

  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);

  // ═══════════════════════════════════════════════════════════════════════════
  // WebSocket — realtime events from backend
  // ═══════════════════════════════════════════════════════════════════════════

  function connectWs() {
    if (isDestroyed) return;
    if (ws) { try { ws.close(); } catch (_) {} ws = null; }
    try { ws = new WebSocket(WS_URL); } catch (_) { scheduleWsReconnect(); return; }

    ws.onopen = () => {
      wsReconnectAttempts = 0;
      updateWsStatus("connected");
      if (activeTicketId) wsJoinRoom(activeTicketId);
    };
    ws.onmessage = (event) => {
      try { handleWsEvent(JSON.parse(event.data)); } catch (_) {}
    };
    ws.onerror = () => {};
    ws.onclose = () => {
      updateWsStatus("reconnecting");
      ws = null;
      wsJoinedTicketId = null;
      if (!isDestroyed) scheduleWsReconnect();
    };
  }

  function scheduleWsReconnect() {
    if (isDestroyed) return;
    clearTimeout(wsReconnectTimer);
    wsReconnectAttempts++;
    const delay = Math.min(wsReconnectAttempts * 2000, 30000);
    wsReconnectTimer = setTimeout(connectWs, delay);
  }

  function updateWsStatus(state) {
    if (!dom.connStatus) return;
    const states = {
      connected: '<span class="badge bg-success"><i class="bi bi-wifi me-1"></i>Live</span>',
      reconnecting: '<span class="badge bg-warning text-dark"><i class="bi bi-arrow-repeat me-1"></i>Reconnecting</span>',
      offline: '<span class="badge bg-danger"><i class="bi bi-wifi-off me-1"></i>Offline</span>',
    };
    dom.connStatus.innerHTML = states[state] || states.offline;
  }

  function wsSend(payload) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify(payload)); } catch (_) {}
    }
  }

  function wsJoinRoom(ticketId) {
    if (wsJoinedTicketId === ticketId) return;
    if (wsJoinedTicketId) wsSend({ type: "ticket:leave", ticketId: wsJoinedTicketId });
    wsSend({ type: "ticket:join", ticketId });
    wsJoinedTicketId = ticketId;
  }

  // ── Handle incoming WS events ──
  function handleWsEvent(data) {
    if (isDestroyed) return;
    const { type, ticketId, senderType } = data;
    switch (type) {
      case "ticket_message":
      case "ticket:message":
        if (ticketId === activeTicketId) debouncedLoadMessages();
        debouncedLoadTickets();
        break;
      case "ticket:unread":
        debouncedLoadTickets();
        break;
      case "ticket:status":
        if (data.status && ticketId) {
          const t = allTickets.find(tk => tk.id === ticketId);
          if (t) {
            t.status = data.status;
            updateStats();
            renderTickets();
            if (ticketId === activeTicketId) {
              const sel = dom.chatHeader?.querySelector("select");
              if (sel) sel.value = data.status;
            }
          } else { debouncedLoadTickets(); }
        }
        break;
      case "ticket:typing":
        if (ticketId === activeTicketId && senderType === "user") showTypingIndicator();
        break;
      case "ticket:seen": break;
      case "ticket:ack": break;
    }
  }

  // ── Typing indicator ──
  let typingTimer = null;
  function showTypingIndicator() {
    const infoSpan = dom.chatHeader?.querySelector(".info span");
    if (!infoSpan) return;
    const original = infoSpan.dataset.original || infoSpan.textContent;
    infoSpan.dataset.original = original;
    infoSpan.textContent = "typing...";
    infoSpan.style.color = "var(--primary)";
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
      if (infoSpan) { infoSpan.textContent = infoSpan.dataset.original || original; infoSpan.style.color = ""; }
    }, 3000);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Debounced fetch helpers
  // ═══════════════════════════════════════════════════════════════════════════

  function debouncedLoadMessages() {
    clearTimeout(msgDebounceTimer);
    msgDebounceTimer = setTimeout(() => {
      if (activeTicketId && !isDestroyed) loadMessages(activeTicketId);
    }, 300);
  }

  function debouncedLoadTickets() {
    clearTimeout(ticketDebounceTimer);
    ticketDebounceTimer = setTimeout(() => {
      if (!isDestroyed) loadTickets();
    }, 500);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Data fetching — with loading states, error handling, retry
  // ═══════════════════════════════════════════════════════════════════════════

  async function loadTickets() {
    if (isDestroyed) return;
    // Show skeleton only on first load (before any data)
    if (!hasLoadedOnce) dom.ticketList.innerHTML = ticketListSkeleton();
    if (loadTicketsController) loadTicketsController.abort();
    loadTicketsController = new AbortController();
    try {
      const res = await fetch(`${API}/admin/tickets`, {
        headers: headers(),
        signal: loadTicketsController.signal,
      });
      if (!res.ok || isDestroyed) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      allTickets = data.tickets || [];
      hasLoadedOnce = true;
      ticketRetryCount = 0;
      hideOfflineBanner();
      updateStats();
      renderTickets();
    } catch (e) {
      if (e.name === "AbortError") return;
      if (!hasLoadedOnce) {
        // First load failed — show error with retry
        showTicketListError("Unable to load tickets");
      }
      // Auto-retry with backoff (max 3 times)
      if (ticketRetryCount < MAX_RETRIES) {
        ticketRetryCount++;
        setTimeout(loadTickets, ticketRetryCount * 3000);
      }
    } finally {
      loadTicketsController = null;
    }
  }

  function updateStats() {
    if (isDestroyed) return;
    dom.sTotal.innerText = allTickets.length;
    dom.sOpen.innerText = allTickets.filter(t => t.status === "open").length;
    dom.sPending.innerText = allTickets.filter(t => t.status === "pending").length;
    dom.sResolved.innerText = allTickets.filter(t => t.status === "resolved" || t.status === "closed").length;
    dom.ticketCount.textContent = `${allTickets.length} conversations`;
  }

  // ── Render Ticket List ──
  function renderTickets() {
    if (isDestroyed) return;
    const search = dom.searchInput.value.toLowerCase();
    let filtered = allTickets;
    if (currentFilter !== "all") filtered = filtered.filter(t => t.status === currentFilter);
    if (search) filtered = filtered.filter(t =>
      (t.userName || "").toLowerCase().includes(search) ||
      (t.ticketNumber || "").toLowerCase().includes(search) ||
      (t.userBusId || "").includes(search)
    );

    if (filtered.length === 0 && hasLoadedOnce) {
      const isFiltered = currentFilter !== "all" || search;
      dom.ticketList.innerHTML = `
        <div class="empty-state" style="padding:40px">
          <i class="bi ${isFiltered ? 'bi-funnel' : 'bi-inbox'}"></i>
          <p>${isFiltered ? "No tickets match your filter" : "No support tickets yet"}</p>
          ${isFiltered ? '<small>Try a different filter or search term</small>' : '<small>Tickets will appear here when students reach out</small>'}
        </div>`;
      return;
    }

    dom.ticketList.innerHTML = filtered.map(t => {
      const time = t.lastMessageAt?._seconds
        ? new Date(t.lastMessageAt._seconds * 1000).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
        : "";
      const pColor = { low: "#94a3b8", medium: "#f59e0b", high: "#f97316", urgent: "#ef4444" }[t.priority] || "#94a3b8";
      const unreadHtml = t.unreadAdmin > 0 ? `<span class="unread-badge">${t.unreadAdmin}</span>` : "";
      return `<div class="ticket-item ${t.id === activeTicketId ? 'active' : ''}" onclick="supportCtrl.openTicket('${t.id}')">
        <div class="top"><span class="name">${t.userName || "Unknown"}</span><span class="time">${time}</span></div>
        <div class="preview">${t.lastMessage || "No messages yet"}</div>
        <div class="meta"><span class="priority-dot" style="background:${pColor}"></span><span style="font-size:10px;color:var(--text-muted)">${t.ticketNumber || ""}</span>${unreadHtml}</div>
      </div>`;
    }).join("");
  }

  // ── Filter Chips ──
  function setFilter(f, el) {
    currentFilter = f;
    document.querySelectorAll(".ticket-filters .chip").forEach(c => c.classList.remove("active"));
    el.classList.add("active");
    renderTickets();
  }

  function filterTickets() { renderTickets(); }

  // ── Open Ticket ──
  async function openTicket(ticketId) {
    if (isDestroyed) return;
    activeTicketId = ticketId;
    renderTickets();
    dom.chatEmpty.style.display = "none";
    dom.chatActive.style.display = "flex";
    dom.profilePanel.style.display = "block";
    const ticket = allTickets.find(t => t.id === ticketId);
    if (!ticket) return;

    dom.chatHeader.innerHTML = `
      <div class="avatar">${(ticket.userName || "?")[0].toUpperCase()}</div>
      <div class="info"><h6>${ticket.userName || "Unknown"}</h6><span>${ticket.ticketNumber || ""} • ${ticket.userBusId || ""}</span></div>
      <div class="actions"><select onchange="supportCtrl.changeStatus('${ticketId}',this.value)">
        <option value="open" ${ticket.status === "open" ? "selected" : ""}>Open</option>
        <option value="pending" ${ticket.status === "pending" ? "selected" : ""}>Pending</option>
        <option value="resolved" ${ticket.status === "resolved" ? "selected" : ""}>Resolved</option>
        <option value="closed" ${ticket.status === "closed" ? "selected" : ""}>Closed</option>
      </select></div>`;

    dom.profileContent.innerHTML = `
      <h6>Student Details</h6>
      <div class="profile-field"><div class="label">Name</div><div class="value">${ticket.userName || "—"}</div></div>
      <div class="profile-field"><div class="label">Email</div><div class="value">${ticket.userEmail || "—"}</div></div>
      <div class="profile-field"><div class="label">Mobile</div><div class="value">${ticket.userMobile || "—"}</div></div>
      <div class="profile-field"><div class="label">Bus</div><div class="value">${ticket.userBusId || "—"}</div></div>
      <div class="profile-field"><div class="label">Course</div><div class="value">${(ticket.userCourse || "").toUpperCase()} ${ticket.userBranch || ""}</div></div>
      <div class="profile-field"><div class="label">Year</div><div class="value">${ticket.userYear || "—"}</div></div>
      <div class="profile-field"><div class="label">Status</div><div class="value"><span class="status-badge ${ticket.status}">${ticket.status}</span></div></div>
      <div class="profile-field"><div class="label">Priority</div><div class="value">${ticket.priority || "medium"}</div></div>
      <div class="profile-field"><div class="label">Messages</div><div class="value">${ticket.messageCount || 0}</div></div>`;

    // Join WS room for this ticket
    wsJoinRoom(ticketId);
    wsSend({ type: "ticket:seen", ticketId, senderType: "admin" });
    fetch(`${API}/admin/tickets/${ticketId}/read`, { method: "POST", headers: headers() });

    // Clear unread locally immediately (optimistic)
    ticket.unreadAdmin = 0;
    renderTickets();

    // Show loading skeleton in chat
    dom.chatMessages.innerHTML = chatSkeleton();
    loadMessages(ticketId);
    startPoll(ticketId);
  }

  // ── Load Messages (with abort dedup, error handling, retry) ──
  async function loadMessages(ticketId) {
    if (isDestroyed) return;
    if (loadMessagesController) loadMessagesController.abort();
    loadMessagesController = new AbortController();
    try {
      const res = await fetch(`${API}/api/tickets/${ticketId}/messages`, {
        headers: headers(),
        signal: loadMessagesController.signal,
      });
      if (isDestroyed || ticketId !== activeTicketId) return;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const msgs = data.messages || [];
      messageRetryCount = 0;

      // Remove optimistic messages that are now confirmed by the server
      optimisticMessages = optimisticMessages.filter(m => m.status === "sending" || m.status === "failed");

      if (msgs.length === 0 && optimisticMessages.length === 0) {
        dom.chatMessages.innerHTML = `
          <div class="empty-state" style="padding:40px">
            <i class="bi bi-chat-text"></i>
            <p>No messages yet</p>
            <small>Type below to start the conversation</small>
          </div>`;
      } else {
        // Render server messages
        let html = msgs.map(m => {
          const isAdmin = m.senderType === "admin";
          const time = m.createdAt?._seconds
            ? new Date(m.createdAt._seconds * 1000).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
            : "";
          return `<div class="msg ${isAdmin ? 'admin' : 'user'}">${!isAdmin ? `<div class="sender">${m.senderName || "Student"}</div>` : ""}${m.message}<div class="msg-meta">${time}</div></div>`;
        }).join("");
        // Append pending/failed optimistic messages at the bottom
        html += optimisticMessages.map(m => renderOptimisticMessage(m)).join("");
        dom.chatMessages.innerHTML = html;
      }
      dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
    } catch (e) {
      if (e.name === "AbortError") return;
      if (!dom.chatMessages.querySelector(".msg")) {
        showChatError("Unable to load messages");
      }
      if (messageRetryCount < MAX_RETRIES) {
        messageRetryCount++;
        setTimeout(() => { if (activeTicketId === ticketId) loadMessages(ticketId); }, messageRetryCount * 2000);
      }
    } finally {
      loadMessagesController = null;
    }
  }

  // ── Polling (fallback — extended interval since WS handles realtime) ──
  function startPoll(ticketId) {
    clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      if (isDestroyed) { clearInterval(pollTimer); return; }
      if (activeTicketId === ticketId) loadMessages(ticketId);
    }, 15000);
  }

  // ── Optimistic message tracking ──
  let optimisticMessages = []; // { id, text, status: "sending"|"sent"|"failed" }
  let optimisticCounter = 0;

  function renderOptimisticMessage(msg) {
    const time = new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
    const statusHtml = msg.status === "sending"
      ? '<span class="msg-status sending"><i class="bi bi-clock"></i> Sending</span>'
      : msg.status === "failed"
      ? `<span class="msg-status failed" onclick="supportCtrl._retrySend('${msg.id}')"><i class="bi bi-exclamation-circle"></i> Failed — tap to retry</span>`
      : '<span class="msg-status sent"><i class="bi bi-check2"></i> Sent</span>';
    return `<div class="msg admin optimistic" data-optimistic-id="${msg.id}">${msg.text}<div class="msg-meta">${time} ${statusHtml}</div></div>`;
  }

  function appendOptimisticToDOM(msg) {
    // Remove empty state if present
    const empty = dom.chatMessages?.querySelector(".empty-state");
    if (empty) empty.remove();
    // Append bubble
    dom.chatMessages.insertAdjacentHTML("beforeend", renderOptimisticMessage(msg));
    dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
  }

  function updateOptimisticStatus(id, status) {
    const el = dom.chatMessages?.querySelector(`[data-optimistic-id="${id}"]`);
    if (!el) return;
    const msg = optimisticMessages.find(m => m.id === id);
    if (msg) msg.status = status;
    const metaEl = el.querySelector(".msg-meta");
    if (!metaEl) return;
    const time = new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
    if (status === "sent") {
      metaEl.innerHTML = `${time} <span class="msg-status sent"><i class="bi bi-check2"></i> Sent</span>`;
      el.classList.remove("optimistic");
    } else if (status === "failed") {
      metaEl.innerHTML = `${time} <span class="msg-status failed" onclick="supportCtrl._retrySend('${id}')"><i class="bi bi-exclamation-circle"></i> Failed — tap to retry</span>`;
    }
  }

  function removeOptimisticFromDOM(id) {
    const el = dom.chatMessages?.querySelector(`[data-optimistic-id="${id}"]`);
    if (el) el.remove();
    optimisticMessages = optimisticMessages.filter(m => m.id !== id);
  }

  // ── Send Reply (optimistic — instant render, async confirmation) ──
  async function sendReply() {
    if (isDestroyed) return;
    const text = dom.replyInput.value.trim();
    if (!text || !activeTicketId) return;

    dom.replyInput.value = "";

    // Create optimistic message and show immediately
    const optId = `opt_${++optimisticCounter}_${Date.now()}`;
    const optMsg = { id: optId, text, status: "sending" };
    optimisticMessages.push(optMsg);
    appendOptimisticToDOM(optMsg);

    // Send to backend in background
    try {
      const res = await fetch(`${API}/api/tickets/${activeTicketId}/messages`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ senderId: "admin", senderType: "admin", senderName: "Admin", message: text }),
      });
      if (isDestroyed) return;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Mark as sent
      updateOptimisticStatus(optId, "sent");
      // Refresh ticket list to update lastMessage preview
      debouncedLoadTickets();
    } catch (e) {
      // Mark as failed
      updateOptimisticStatus(optId, "failed");
    }
  }

  // Retry a failed optimistic message
  function retrySend(optId) {
    const msg = optimisticMessages.find(m => m.id === optId);
    if (!msg || msg.status !== "failed") return;
    msg.status = "sending";
    updateOptimisticStatus(optId, "sending");
    // Re-send
    (async () => {
      try {
        const res = await fetch(`${API}/api/tickets/${activeTicketId}/messages`, {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({ senderId: "admin", senderType: "admin", senderName: "Admin", message: msg.text }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        updateOptimisticStatus(optId, "sent");
        debouncedLoadTickets();
      } catch (_) {
        updateOptimisticStatus(optId, "failed");
      }
    })();
  }

  // ── Change Status (optimistic + error handling) ──
  async function changeStatus(ticketId, status) {
    if (isDestroyed) return;
    const prevStatus = allTickets.find(t => t.id === ticketId)?.status;
    // Optimistic update
    const t = allTickets.find(tk => tk.id === ticketId);
    if (t) { t.status = status; updateStats(); renderTickets(); }
    try {
      const res = await fetch(`${API}/admin/tickets/${ticketId}/status`, {
        method: "PATCH", headers: headers(), body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (isDestroyed) return;
      debouncedLoadTickets();
    } catch (_) {
      // Revert on failure
      if (t && prevStatus) { t.status = prevStatus; updateStats(); renderTickets(); }
      if (typeof showToast === "function") showToast("Failed to update status", "error");
    }
  }

  // ── Manual retry functions (exposed for error state buttons) ──
  function retryTickets() { ticketRetryCount = 0; loadTickets(); }
  function retryMessages() { messageRetryCount = 0; if (activeTicketId) loadMessages(activeTicketId); }

  // ═══════════════════════════════════════════════════════════════════════════
  // Lifecycle
  // ═══════════════════════════════════════════════════════════════════════════

  function destroy() {
    isDestroyed = true;
    clearInterval(pollTimer);
    clearInterval(ticketRefreshTimer);
    clearTimeout(wsReconnectTimer);
    clearTimeout(msgDebounceTimer);
    clearTimeout(ticketDebounceTimer);
    clearTimeout(typingTimer);
    pollTimer = null;
    ticketRefreshTimer = null;
    wsReconnectTimer = null;
    msgDebounceTimer = null;
    ticketDebounceTimer = null;
    typingTimer = null;
    if (loadMessagesController) { loadMessagesController.abort(); loadMessagesController = null; }
    if (loadTicketsController) { loadTicketsController.abort(); loadTicketsController = null; }
    if (ws) { try { ws.close(1000, "page unload"); } catch (_) {} ws = null; }
    window.removeEventListener("beforeunload", onBeforeUnload);
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    hideOfflineBanner();
    Object.keys(dom).forEach(k => { dom[k] = null; });
    window.supportCtrl = null;
    window.setFilter = null;
    window.filterTickets = null;
    window.sendReply = null;
  }

  function onBeforeUnload() { destroy(); }

  function onVisibilityChange() {
    if (isDestroyed) return;
    if (document.visibilityState === "hidden") {
      clearInterval(pollTimer);
      clearInterval(ticketRefreshTimer);
      pollTimer = null;
      ticketRefreshTimer = null;
    } else if (document.visibilityState === "visible") {
      ticketRefreshTimer = setInterval(loadTickets, 30000);
      if (activeTicketId) startPoll(activeTicketId);
      loadTickets();
      if (activeTicketId) loadMessages(activeTicketId);
      if (!ws || ws.readyState !== WebSocket.OPEN) connectWs();
    }
  }

  window.addEventListener("beforeunload", onBeforeUnload);
  document.addEventListener("visibilitychange", onVisibilityChange);

  // ── Start ──
  loadTickets();
  connectWs();
  ticketRefreshTimer = setInterval(loadTickets, 30000);

  // Show offline banner if already offline at load time
  if (!navigator.onLine) showOfflineBanner();

  // ── Expose public API ──
  window.supportCtrl = {
    openTicket, sendReply, changeStatus, setFilter, filterTickets,
    destroy, _retryTickets: retryTickets, _retryMessages: retryMessages,
    _retrySend: retrySend,
  };
  window.setFilter = setFilter;
  window.filterTickets = filterTickets;
  window.sendReply = sendReply;
}
