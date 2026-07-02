// ══════════════════════════════════════════════════════════════════════════════
// SCEP Admin — Universal Configuration
// Central config for role-based UI, branding, and feature flags.
// Include via: <script src="../shared/config.js"></script>
// ══════════════════════════════════════════════════════════════════════════════

const ADMIN_CONFIG = {

  // ── Institution Definitions ────────────────────────────────────────────────
  institutions: {
    college: {
      id: "college",
      title: "College Admin",
      subtitle: "SCEP Bus Management",
      icon: "bi-mortarboard",
      themeColor: "#2563eb",
      badgeClass: "bg-primary",
      badgeText: "College Admin",
      roles: ["student", "faculty"],
      userLabels: { student: "Student", faculty: "Faculty" },
    },
    school: {
      id: "school",
      title: "School Admin",
      subtitle: "SCEP Bus Management",
      icon: "bi-book",
      themeColor: "#0ea5e9",
      badgeClass: "bg-info",
      badgeText: "School Admin",
      roles: ["parent", "faculty"],
      userLabels: { parent: "Parent", faculty: "Faculty" },
    },
    superadmin: {
      id: "superadmin",
      title: "Super Admin",
      subtitle: "Full System Control",
      icon: "bi-shield-lock",
      themeColor: "#7c3aed",
      badgeClass: "bg-dark",
      badgeText: "Super Admin",
      roles: ["student", "faculty", "parent"],
      userLabels: { student: "Student", faculty: "Faculty", parent: "Parent" },
    },
  },

  // ── Menu Items ─────────────────────────────────────────────────────────────
  // Each item: { id, label, icon, href, feature }
  // 'feature' maps to featureFlags below for visibility control.
  menuItems: [
    { id: "dashboard",     label: "Dashboard",     icon: "bi-grid",           href: "dashboard.html",     feature: "dashboard" },
    { id: "users",         label: "Users",         icon: "bi-people",         href: "users.html",         feature: "users" },
    { id: "attendance",    label: "Attendance",    icon: "bi-check2-square",  href: "attendance.html",    feature: "attendance" },
    { id: "bus",           label: "Bus Monitoring", icon: "bi-bus-front",      href: "bus.html",           feature: "busTracking" },
    { id: "routes",        label: "Routes",        icon: "bi-signpost-split", href: "routes.html",        feature: "routes" },
    { id: "notifications", label: "Notifications", icon: "bi-bell",           href: "notifications.html", feature: "notifications" },
    { id: "complaints",    label: "Complaints",    icon: "bi-chat-dots",      href: "complaints.html",    feature: "complaints" },
    { id: "reports",       label: "Reports",       icon: "bi-bar-chart",      href: "reports.html",       feature: "reports" },
  ],

  // ── Feature Flags ──────────────────────────────────────────────────────────
  // true = visible for that institution, false = hidden
  featureFlags: {
    college: {
      dashboard: true,
      users: true,
      attendance: true,
      busTracking: true,
      routes: true,
      notifications: true,
      complaints: true,
      reports: true,
    },
    school: {
      dashboard: true,
      users: true,
      attendance: false,   // attendance is college-only
      busTracking: true,
      routes: true,
      notifications: true,
      complaints: true,
      reports: true,
    },
    superadmin: {
      dashboard: true,
      users: true,
      attendance: true,
      busTracking: true,
      routes: true,
      notifications: true,
      complaints: true,
      reports: true,
    },
  },
};

// ── Helper Function ──────────────────────────────────────────────────────────
// Usage: const cfg = getConfig("college");
//        const cfg = getConfig(); // auto-detects from localStorage
function getConfig(institution, role) {
  // Auto-detect from localStorage if not provided
  const inst = (institution || localStorage.getItem("institution") || "college").toLowerCase();

  // Normalize: "all" from superadmin JWT maps to "superadmin" config
  const configKey = inst === "all" ? "superadmin" : inst;

  const institutionConfig = ADMIN_CONFIG.institutions[configKey] || ADMIN_CONFIG.institutions.college;
  const flags = ADMIN_CONFIG.featureFlags[configKey] || ADMIN_CONFIG.featureFlags.college;

  // Build allowed menu items
  const allowedMenus = ADMIN_CONFIG.menuItems.filter(item => flags[item.feature] === true);

  return {
    institution: institutionConfig,
    featureFlags: flags,
    menuItems: allowedMenus,
    role: role || "admin",
    isFeatureEnabled: (feature) => flags[feature] === true,
  };
}
