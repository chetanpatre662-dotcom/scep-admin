// ══════════════════════════════════════════════════════════════════════════════
// SCEP Admin — Dynamic Sidebar Generator
// Renders sidebar HTML based on user role and institution config.
// Depends on: config.js (must be loaded first)
// Include via: <script src="../shared/config.js"></script>
//              <script src="../shared/sidebar.js"></script>
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Renders the admin sidebar into an element with id="sidebar".
 * Automatically detects institution from localStorage and highlights the active page.
 *
 * @param {Object} options
 * @param {string} [options.institution] - "college"|"school"|"superadmin" (auto-detected if omitted)
 * @param {string} [options.activePage]  - id of the active menu item (auto-detected from URL if omitted)
 * @param {string} [options.containerId] - id of sidebar container element (default: "sidebar")
 */
function renderSidebar(options = {}) {
  const cfg = getConfig(options.institution);
  const containerId = options.containerId || "sidebar";
  const container = document.getElementById(containerId);
  if (!container) return;

  // Auto-detect active page from current URL filename
  const currentFile = window.location.pathname.split("/").pop() || "dashboard.html";
  const activePage = options.activePage || currentFile.replace(".html", "");

  // Build menu HTML
  const menuHtml = cfg.menuItems.map(item => {
    const isActive = item.id === activePage || item.href === currentFile;
    return `<a href="${item.href}"><div class="nav-item${isActive ? ' active' : ''}"><i class="bi ${item.icon}"></i>${item.label}</div></a>`;
  }).join("\n        ");

  // Build full sidebar HTML
  container.innerHTML = `
        <h4><i class="bi ${cfg.institution.icon} me-2"></i>${cfg.institution.title}</h4>
        ${menuHtml}
        <div class="nav-item mt-4" onclick="logout()" style="color:#f87171;cursor:pointer"><i class="bi bi-box-arrow-left"></i>Logout</div>
  `;
}

/**
 * Creates the sidebar backdrop element if it doesn't exist.
 * Call once on page load.
 */
function initSidebarBackdrop() {
  if (!document.getElementById("sidebarBackdrop")) {
    const backdrop = document.createElement("div");
    backdrop.className = "sidebar-backdrop";
    backdrop.id = "sidebarBackdrop";
    backdrop.onclick = toggleSidebar;
    document.body.insertBefore(backdrop, document.body.firstChild);
  }
}

/**
 * Full sidebar initialization — call this to set up everything.
 * Safe to call from any page. Idempotent.
 *
 * @param {Object} options - Same as renderSidebar options
 */
function initSidebar(options = {}) {
  initSidebarBackdrop();
  renderSidebar(options);
}

// ── Auto-init on DOMContentLoaded if sidebar element exists ──────────────────
// Pages that include this script and have <div id="sidebar"></div> will
// get automatic sidebar rendering without any additional JS code.
document.addEventListener("DOMContentLoaded", () => {
  const sidebar = document.getElementById("sidebar");
  // Only auto-render if sidebar is empty (hasn't been manually populated)
  if (sidebar && sidebar.children.length === 0) {
    initSidebar();
  }
});
