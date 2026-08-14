(() => {
  "use strict";

  const THEME_KEY = "remote_codex_theme";
  const current = window.location.pathname.replace(/\/$/, "") || "/";
  document.querySelectorAll("nav a").forEach((link) => {
    const href = new URL(link.href).pathname.replace(/\/$/, "") || "/";
    if (href === current) link.classList.add("active");
  });

  function readTheme() {
    try {
      const saved = window.localStorage.getItem(THEME_KEY);
      if (saved === "light" || saved === "dark") return saved;
    } catch {
      // Use the system preference when storage is unavailable.
    }
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function updateThemeControls(theme) {
    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
      const nextTheme = theme === "dark" ? "light" : "dark";
      const label = button.querySelector(".theme-label");
      if (label) label.textContent = nextTheme === "dark" ? "Escuro" : "Claro";
      button.setAttribute("aria-label", `Usar tema ${nextTheme === "dark" ? "escuro" : "claro"}`);
      button.setAttribute("aria-pressed", String(theme === "dark"));
      button.dataset.themeTarget = nextTheme;
    });
  }

  function applyTheme(theme, persist = false) {
    const nextTheme = theme === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = nextTheme;
    document.documentElement.style.colorScheme = nextTheme;
    if (persist) {
      try { window.localStorage.setItem(THEME_KEY, nextTheme); } catch { /* best effort */ }
    }
    updateThemeControls(nextTheme);
  }

  function createPublicThemeToggle() {
    const header = document.querySelector(".site-header");
    if (!header || document.querySelector("[data-theme-toggle]")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "theme-toggle theme-toggle-compact";
    button.dataset.themeToggle = "";
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"></path></svg><span class="theme-label"></span>';
    header.append(button);
  }

  const theme = readTheme();
  applyTheme(theme);
  createPublicThemeToggle();
  updateThemeControls(theme);
  document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
    button.addEventListener("click", () => applyTheme(button.dataset.themeTarget, true));
  });
})();
