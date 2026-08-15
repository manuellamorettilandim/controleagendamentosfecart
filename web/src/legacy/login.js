(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const root = document.documentElement;
  const state = {
    config: null,
    noticeTimer: null,
  };

  const noticeIcons = {
    info: "ph-info",
    warning: "ph-warning-circle",
    error: "ph-warning-circle",
    success: "ph-check-circle",
  };

  function setTheme(theme, persist = true) {
    const isLight = theme === "light";
    root.dataset.theme = isLight ? "light" : "dark";
    const toggle = $("#theme-toggle");
    if (!toggle) return;
    toggle.setAttribute("aria-pressed", String(!isLight));
    toggle.setAttribute("aria-label", isLight ? "Ativar tema escuro" : "Ativar tema claro");
    toggle.querySelector(".theme-toggle-label").textContent = isLight ? "Escuro" : "Claro";
    toggle.querySelector(".ph").className = `ph ${isLight ? "ph-moon" : "ph-sun"}`;
    if (persist) window.localStorage.setItem("fecart-theme", root.dataset.theme);
  }

  function initTheme() {
    let saved = null;
    try { saved = window.localStorage.getItem("fecart-theme"); } catch { /* storage can be unavailable */ }
    setTheme(saved === "light" || saved === "dark" ? saved : "dark", false);
    $("#theme-toggle").addEventListener("click", () => {
      setTheme(root.dataset.theme === "light" ? "dark" : "light");
    });
  }

  function setNotice(type, title, message, options = {}) {
    const notice = $("#login-notice");
    const icon = notice.querySelector(".notice-icon .ph");
    notice.className = `login-notice notice--${type}`;
    icon.className = `ph ${noticeIcons[type] || noticeIcons.info}`;
    $("#notice-title").textContent = title;
    $("#notice-message").textContent = message;
    $("#retry-config").hidden = !options.retry;
    notice.hidden = false;
    if (state.noticeTimer) window.clearTimeout(state.noticeTimer);
    if (options.autoHide) {
      state.noticeTimer = window.setTimeout(() => { notice.hidden = true; }, options.autoHide);
    }
  }

  function clearNotice() {
    $("#login-notice").hidden = true;
    if (state.noticeTimer) window.clearTimeout(state.noticeTimer);
  }

  function setFormAvailability(available) {
    document.querySelectorAll("#login-form input, #login-form button").forEach((control) => {
      control.disabled = !available;
    });
    $("#theme-toggle").disabled = false;
  }

  function fieldMessage(name, message = "") {
    const field = document.querySelector(`[data-field="${name}"]`);
    const output = document.querySelector(`[data-message-for="${name}"]`);
    if (!field || !output) return;
    output.textContent = message;
    field.classList.toggle("has-error", Boolean(message));
    if (!message) field.classList.remove("has-success");
  }

  function validateField(name) {
    const input = name === "identity" ? $("#login-identity") : $("#login-password");
    const value = input.value.trim();
    if (!value) {
      fieldMessage(name, name === "identity" ? "Informe o grupo ou e-mail para continuar." : "Informe sua senha para continuar.");
      return false;
    }
    if (name === "identity" && value.includes("@") && (!value.includes(".") || value.endsWith("."))) {
      fieldMessage(name, "Confira o formato do e-mail.");
      return false;
    }
    fieldMessage(name);
    document.querySelector(`[data-field="${name}"]`).classList.add("has-success");
    return true;
  }

  function validateForm() {
    const identityValid = validateField("identity");
    const passwordValid = validateField("password");
    if (!identityValid || !passwordValid) {
      $("#login-form").classList.remove("shake");
      void $("#login-form").offsetWidth;
      $("#login-form").classList.add("shake");
      const firstInvalid = !identityValid ? $("#login-identity") : $("#login-password");
      firstInvalid.focus();
      return false;
    }
    return true;
  }

  function setLoading(loading) {
    const button = $("#login-submit");
    button.disabled = loading;
    button.classList.toggle("is-loading", loading);
    button.setAttribute("aria-busy", String(loading));
  }

  async function loadAuthConfig() {
    try {
      state.config = await window.RemoteCodexAuth.loadConfig();
      setFormAvailability(true);
      clearNotice();
      return true;
    } catch (error) {
      state.config = null;
      setFormAvailability(false);
      setNotice("warning", "Login temporariamente indisponível", "O serviço de autenticação ainda não está configurado. Tente novamente em alguns instantes.", { retry: true });
      return false;
    }
  }

  async function loginEmailForUsername(username) {
    const normalized = username.normalize("NFKC").trim().toLowerCase();
    const bytes = new TextEncoder().encode(normalized);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const hex = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
    return `user-${hex}@remote-codex.invalid`;
  }

  async function routeExistingSession() {
    const session = window.RemoteCodexAuth.getSession();
    if (!session?.access_token) return false;
    const headers = { Authorization: `Bearer ${session.access_token}` };
    const admin = await fetch("/api/admin/session", { headers, cache: "no-store" });
    if (admin.ok) {
      window.location.replace("/admin");
      return true;
    }
    const user = await fetch("/api/user/dashboard", { headers, cache: "no-store" });
    if (user.ok) {
      window.location.replace("/dashboard");
      return true;
    }
    window.RemoteCodexAuth.clearSession();
    return false;
  }

  async function submit(event) {
    event.preventDefault();
    clearNotice();
    if (!validateForm()) return;
    if (!state.config && !(await loadAuthConfig())) return;

    setLoading(true);
    try {
      const identity = $("#login-identity").value.trim();
      const password = $("#login-password").value;
      const email = identity.includes("@") ? identity.toLowerCase() : await loginEmailForUsername(identity);
      await window.RemoteCodexAuth.passwordLogin(state.config, email, password);
      const token = window.RemoteCodexAuth.getSession()?.access_token;
      const targets = [
        ["/api/admin/session", "/admin"],
        ["/api/user/dashboard", "/dashboard"],
      ];
      for (const [target, destination] of targets) {
        const response = await fetch(target, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
        if (response.ok) {
          setNotice("success", "Login realizado", "Redirecionando para seu ambiente…", { autoHide: 2400 });
          window.setTimeout(() => window.location.replace(destination), 260);
          return;
        }
      }
      window.RemoteCodexAuth.clearSession();
      throw new Error("Esta credencial não possui acesso habilitado.");
    } catch (error) {
      setNotice("error", "Não foi possível entrar", error instanceof Error ? error.message : "Confira seus dados e tente novamente.");
      $("#login-form").classList.remove("shake");
      void $("#login-form").offsetWidth;
      $("#login-form").classList.add("shake");
    } finally {
      setLoading(false);
    }
  }

  function initInteractions() {
    $("#login-form").addEventListener("submit", submit);
    ["identity", "password"].forEach((name) => {
      const input = name === "identity" ? $("#login-identity") : $("#login-password");
      input.addEventListener("blur", () => { if (input.value) validateField(name); });
      input.addEventListener("input", () => {
        if (document.querySelector(`[data-field="${name}"]`).classList.contains("has-error")) validateField(name);
      });
    });

    $("#toggle-password").addEventListener("click", () => {
      const input = $("#login-password");
      const visible = input.type === "text";
      input.type = visible ? "password" : "text";
      const button = $("#toggle-password");
      button.setAttribute("aria-pressed", String(!visible));
      button.setAttribute("aria-label", visible ? "Mostrar senha" : "Ocultar senha");
      button.querySelector(".ph").className = `ph ${visible ? "ph-eye" : "ph-eye-slash"}`;
    });

    $("#forgot-password").addEventListener("click", () => {
      setNotice("info", "Fale com o administrador", "A redefinição de acesso é feita pelo responsável pela sua equipe.", { autoHide: 5600 });
    });

    $("#notice-close").addEventListener("click", clearNotice);
    $("#retry-config").addEventListener("click", async () => {
      const retry = $("#retry-config");
      retry.disabled = true;
      retry.textContent = "Verificando…";
      await loadAuthConfig();
      retry.disabled = false;
      retry.textContent = "Tentar novamente";
    });
  }

  async function init() {
    initTheme();
    initInteractions();
    const params = new URLSearchParams(window.location.search);
    const expired = params.get("expired") === "1";
    if (!(await loadAuthConfig())) return;
    if (expired) setNotice("warning", "Sua sessão expirou", "Entre novamente para continuar usando o Fecart AI Share.");
    await routeExistingSession();
  }

  init().catch((error) => {
    setFormAvailability(false);
    setNotice("error", "Algo não saiu como esperado", error instanceof Error ? error.message : "Recarregue a página e tente novamente.");
  });
})();

export {};
