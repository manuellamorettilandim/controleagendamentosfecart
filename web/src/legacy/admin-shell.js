(() => {
  "use strict";

  const sidebar = document.querySelector("[data-admin-sidebar]");
  if (!sidebar) return;

  const activeSection = document.body.dataset.adminSection || "overview";
  const navItems = [
    { id: "overview", icon: "ph-house", label: "Geral" },
    { id: "telemetry", icon: "ph-pulse", label: "Telemetria" },
    { id: "groups", icon: "ph-users-three", label: "Grupos" },
  ];

  sidebar.innerHTML = `
    <div class="sidebar-brand-row">
      <a class="admin-brand" href="/admin" aria-label="Fecart AI Share — painel administrativo">
        <img src="/assets/fecart-logo.png" alt="">
        <span>Fecart <strong>AI</strong> Share</span>
      </a>
      <button class="sidebar-collapse" type="button" aria-label="Recolher menu" title="Recolher menu" aria-expanded="true">
        <i class="ph ph-caret-left" aria-hidden="true"></i>
      </button>
    </div>

    <nav class="sidebar-nav" aria-label="Áreas do painel">
      ${navItems.map(({ id, icon, label }) => `
        <button class="sidebar-link${activeSection === id ? " is-active" : ""}" type="button" data-section="${id}"${activeSection === id ? ' aria-current="page"' : ""}>
          <i class="ph ${icon}" aria-hidden="true"></i><span>${label}</span>
        </button>
      `).join("")}
    </nav>

    <div class="sidebar-footer">
      <div class="sidebar-session">
        <span class="sidebar-session-avatar" data-admin-initials aria-hidden="true">AD</span>
        <span class="sidebar-session-copy"><strong data-admin-login>Administrador</strong><small data-admin-role>—</small></span>
        <button class="sidebar-logout" type="button" data-admin-logout aria-label="Sair" title="Sair">
          <i class="ph ph-sign-out" aria-hidden="true"></i>
        </button>
      </div>
    </div>
  `;

  const shell = document.querySelector(".admin-shell");
  const collapseButton = sidebar.querySelector(".sidebar-collapse");
  const collapseKey = "fecart-admin-sidebar-collapsed";

  function setCollapsed(collapsed, persist = true) {
    shell?.classList.toggle("is-collapsed", collapsed);
    collapseButton?.setAttribute("aria-expanded", String(!collapsed));
    collapseButton?.setAttribute("aria-label", collapsed ? "Expandir menu" : "Recolher menu");
    collapseButton?.setAttribute("title", collapsed ? "Expandir menu" : "Recolher menu");
    const icon = collapseButton?.querySelector(".ph");
    if (icon) icon.className = `ph ${collapsed ? "ph-caret-right" : "ph-caret-left"}`;
    if (persist) window.localStorage.setItem(collapseKey, String(collapsed));
  }

  setCollapsed(window.localStorage.getItem(collapseKey) === "true", false);
  collapseButton?.addEventListener("click", () => setCollapsed(!shell?.classList.contains("is-collapsed")));

  function setIdentity(identity = {}) {
    const role = identity.role || "";
    const login = identity.login || identity.email || "Administrador";
    document.body.dataset.adminRole = role;
    const loginOutput = sidebar.querySelector("[data-admin-login]");
    const roleOutput = sidebar.querySelector("[data-admin-role]");
    const initialsOutput = sidebar.querySelector("[data-admin-initials]");
    if (loginOutput) loginOutput.textContent = login;
    if (roleOutput) roleOutput.textContent = role === "owner" ? "Owner" : role === "admin" ? "Administrador" : "Usuário";
    if (initialsOutput) initialsOutput.textContent = login.slice(0, 2).toUpperCase();
    const telemetry = sidebar.querySelector('[data-section="telemetry"]');
    if (telemetry) telemetry.hidden = !(role === "owner" || role === "admin");
  }

  window.FecartAdminShell = {
    setRole(role) {
      setIdentity({ role });
    },
    setIdentity,
  };
})();

export {};
