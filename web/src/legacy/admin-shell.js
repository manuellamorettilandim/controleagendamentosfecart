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
      <a class="admin-brand" href="/admin.html" aria-label="Fecart AI Share — painel administrativo">
        <img src="/assets/fecart-logo.png" alt="">
        <span>Fecart <strong>AI</strong> Share</span>
      </a>
      <button class="sidebar-collapse" type="button" aria-label="Recolher menu" title="Recolher menu">«</button>
    </div>

    <nav class="sidebar-nav" aria-label="Áreas do painel">
      ${navItems.map(({ id, icon, label }) => `
        <button class="sidebar-link${activeSection === id ? " is-active" : ""}" type="button" data-section="${id}"${activeSection === id ? ' aria-current="page"' : ""}>
          <i class="ph ${icon}" aria-hidden="true"></i><span>${label}</span>
        </button>
      `).join("")}
    </nav>

    <div class="sidebar-footer">
      <button class="sidebar-link sidebar-logout" type="button" data-admin-logout>
        <i class="ph ph-sign-out" aria-hidden="true"></i><span>Sair</span>
      </button>
    </div>
  `;
})();

export {};
