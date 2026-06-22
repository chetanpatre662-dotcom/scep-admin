// ── SCEP Admin Shared Utilities — Production Grade ──────────────────────────
const API = "https://scep-bus.duckdns.org";
const WS_URL = "wss://scep-bus.duckdns.org/ws";

function getToken() { return localStorage.getItem("token") || ""; }
function getInstitution() { return localStorage.getItem("institution") || "college"; }
function headers() { return { "Content-Type": "application/json", "Authorization": getToken() }; }

// ── Security ────────────────────────────────────────────────────────────────
function verifyInstitution(expected) {
  if (getInstitution() !== expected || !getToken()) {
    alert("Unauthorized. Redirecting to login.");
    localStorage.removeItem("token");
    window.location.href = "../index.html";
    return false;
  }
  return true;
}
function logout() { localStorage.removeItem("token"); localStorage.removeItem("institution"); window.location.href = "../index.html"; }

// ── Sidebar ─────────────────────────────────────────────────────────────────
function toggleSidebar() {
  document.getElementById("sidebar")?.classList.toggle("active");
  document.getElementById("sidebarBackdrop")?.classList.toggle("active");
}
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".sidebar a").forEach(link => {
    link.addEventListener("click", () => {
      if (window.innerWidth < 992) {
        document.getElementById("sidebar")?.classList.remove("active");
        document.getElementById("sidebarBackdrop")?.classList.remove("active");
      }
    });
  });
});

// ── Offline / Cache Support ─────────────────────────────────────────────────
function cacheSet(key, data) {
  try { localStorage.setItem(`cache_${key}`, JSON.stringify({ ts: Date.now(), data })); } catch (_) {}
}
function cacheGet(key, maxAgeMs = 5 * 60 * 1000) {
  try {
    const raw = localStorage.getItem(`cache_${key}`);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > maxAgeMs) return null; // expired
    return data;
  } catch (_) { return null; }
}
async function fetchWithCache(url, cacheKey, opts = {}) {
  try {
    const res = await fetch(url, { headers: headers(), ...opts });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    cacheSet(cacheKey, data);
    updateConnectionStatus(true);
    return data;
  } catch (e) {
    updateConnectionStatus(false);
    const cached = cacheGet(cacheKey, 30 * 60 * 1000); // 30 min stale allowed
    if (cached) { console.warn(`Using cached data for ${cacheKey}`); return cached; }
    throw e;
  }
}
function updateConnectionStatus(online) {
  const el = document.getElementById("connStatus");
  if (!el) return;
  if (online) { el.innerHTML = `<span class="badge bg-success"><i class="bi bi-wifi me-1"></i>Live</span>`; }
  else { el.innerHTML = `<span class="badge bg-danger"><i class="bi bi-wifi-off me-1"></i>Offline</span>`; }
}

// ── Toast Notifications ─────────────────────────────────────────────────────
function showToast(message, type = "info") {
  let container = document.getElementById("toastContainer");
  if (!container) {
    container = document.createElement("div");
    container.id = "toastContainer";
    container.style.cssText = "position:fixed;top:16px;right:16px;z-index:9999;display:flex;flex-direction:column;gap:8px;max-width:340px;";
    document.body.appendChild(container);
  }
  const colors = { info: "#2563eb", success: "#16a34a", warning: "#d97706", error: "#dc2626" };
  const toast = document.createElement("div");
  toast.style.cssText = `background:${colors[type]||colors.info};color:#fff;padding:12px 16px;border-radius:10px;font-size:13px;font-family:Poppins;box-shadow:0 4px 12px rgba(0,0,0,.15);animation:slideIn .3s ease;`;
  toast.innerHTML = `<i class="bi bi-info-circle me-2"></i>${message}`;
  container.appendChild(toast);
  setTimeout(() => { toast.style.opacity = "0"; toast.style.transition = "opacity .3s"; setTimeout(() => toast.remove(), 300); }, 4000);
}

// ── Animated Counter ────────────────────────────────────────────────────────
function animateCounter(elementId, target, duration = 800) {
  const el = document.getElementById(elementId);
  if (!el) return;
  const start = parseInt(el.innerText) || 0;
  const diff = target - start;
  if (diff === 0) { el.innerText = target; return; }
  const startTime = performance.now();
  function step(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
    el.innerText = Math.round(start + diff * eased);
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// ── Formatting ──────────────────────────────────────────────────────────────
function formatTimestamp(ts) {
  if (!ts) return "—";
  const ms = ts._seconds ? ts._seconds * 1000 : (typeof ts === "number" ? ts : new Date(ts).getTime());
  if (!ms || isNaN(ms)) return "—";
  return new Date(ms).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}
function formatDate(ts) {
  if (!ts) return "—";
  const ms = ts._seconds ? ts._seconds * 1000 : new Date(ts).getTime();
  return new Date(ms).toLocaleDateString("en-IN");
}
function timeAgo(ts) {
  if (!ts) return "";
  const ms = ts._seconds ? ts._seconds * 1000 : new Date(ts).getTime();
  const diff = Date.now() - ms;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return Math.floor(diff/60000) + "m ago";
  if (diff < 86400000) return Math.floor(diff/3600000) + "h ago";
  return Math.floor(diff/86400000) + "d ago";
}

// ── Skeleton Loader ─────────────────────────────────────────────────────────
function showTableSkeleton(tableId, cols, rows = 5) {
  const tbody = document.getElementById(tableId);
  if (!tbody) return;
  let html = "";
  for (let i = 0; i < rows; i++) { html += "<tr>"; for (let j = 0; j < cols; j++) html += `<td><div class="skeleton-line"></div></td>`; html += "</tr>"; }
  tbody.innerHTML = html;
}
