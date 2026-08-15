(() => {
  "use strict";

  const root = document.documentElement;
  const THEME_KEY = "fecart-theme";
  let toastTimer = null;

  function setTheme(theme, persist = true) {
    const nextTheme = theme === "light" ? "light" : "dark";
    root.dataset.theme = nextTheme;
    root.style.colorScheme = nextTheme;

    const toggle = document.querySelector("#theme-toggle");
    if (toggle) {
      const light = nextTheme === "light";
      toggle.setAttribute("aria-pressed", String(!light));
      toggle.setAttribute("aria-label", light ? "Ativar tema escuro" : "Ativar tema claro");
      toggle.title = light ? "Ativar tema escuro" : "Ativar tema claro";
      const label = toggle.querySelector("[data-theme-label]");
      if (label) label.textContent = light ? "Tema escuro" : "Tema claro";
      const icon = toggle.querySelector(".ph");
      if (icon) icon.className = `ph ${light ? "ph-moon" : "ph-sun"}`;
    }

    if (persist) {
      try { window.localStorage.setItem(THEME_KEY, nextTheme); } catch { /* storage can be unavailable */ }
    }
    return nextTheme;
  }

  function initTheme() {
    let saved = null;
    try { saved = window.localStorage.getItem(THEME_KEY); } catch { /* storage can be unavailable */ }
    setTheme(saved === "light" || saved === "dark" ? saved : "dark", false);
    const toggle = document.querySelector("#theme-toggle");
    if (toggle && !toggle.dataset.bound) {
      toggle.dataset.bound = "true";
      toggle.addEventListener("click", () => setTheme(root.dataset.theme === "light" ? "dark" : "light"));
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initTheme, { once: true });
  } else {
    initTheme();
  }

  function showToast(message, type = "info") {
    const toast = document.querySelector("#toast");
    if (!toast) return;
    if (toastTimer) window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.className = `toast toast--${type}`;
    toast.hidden = false;
    toastTimer = window.setTimeout(() => {
      toast.hidden = true;
    }, type === "error" ? 5600 : 3600);
  }

  function escapeHTML(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function asDate(value) {
    const date = value instanceof Date ? new Date(value) : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function formatDate(value, options = {}) {
    const date = asDate(value);
    if (!date) return "—";
    return new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "short",
      ...options,
    }).format(date).replaceAll(".", "");
  }

  function formatLongDate(value) {
    const date = asDate(value);
    if (!date) return "—";
    return new Intl.DateTimeFormat("pt-BR", {
      weekday: "long",
      day: "2-digit",
      month: "long",
    }).format(date);
  }

  function formatTime(value) {
    const date = asDate(value);
    if (!date) return "—";
    return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(date);
  }

  function formatDateTime(value) {
    const date = asDate(value);
    if (!date) return "—";
    return new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date).replaceAll(".", "");
  }

  function setProgress(element, value, label) {
    if (!element) return;
    const safeValue = Math.max(0, Math.min(100, Number(value) || 0));
    const level = safeValue >= 88 ? "100" : safeValue >= 62 ? "75" : safeValue >= 37 ? "50" : safeValue >= 12 ? "25" : "0";
    element.dataset.level = level;
    element.setAttribute("aria-label", label || `${Math.round(safeValue)}%`);
  }

  window.FecartComponents = {
    asDate,
    escapeHTML,
    formatDate,
    formatDateTime,
    formatLongDate,
    formatTime,
    initTheme,
    setProgress,
    setTheme,
    showToast,
  };
})();
