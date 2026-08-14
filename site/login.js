(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const state = { config: null, role: "user" };

  function setConfigState(error = null) {
    const unavailable = Boolean(error);
    const alert = $("#login-config-alert");
    const note = $("#login-note");
    const securityNote = $("#login-security-note");
    const formControls = document.querySelectorAll("#login-form input, #login-form button");
    alert.hidden = !unavailable;
    securityNote.hidden = unavailable;
    note.hidden = false;
    $("#login-config-message").textContent = unavailable
      ? "Configure o relay central antes de liberar o login."
      : "";
    $("#login-error").textContent = "";
    formControls.forEach((control) => { control.disabled = unavailable; });
  }

  async function loadAuthConfig() {
    try {
      state.config = await window.RemoteCodexAuth.loadConfig();
      setConfigState();
      return true;
    } catch (error) {
      state.config = null;
      setConfigState(error);
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

  function selectRole(role) {
    state.role = role;
    document.querySelectorAll("[data-role]").forEach((button) => {
      const active = button.dataset.role === role;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    const admin = role === "admin";
    $("#login-title").textContent = admin ? "Controle central" : "Acesse sua agenda";
    $("#login-description").textContent = admin ? "Use seu email administrativo autorizado." : "Entre com o nome e a senha da sua equipe.";
    $("#login-identity-label").textContent = admin ? "Email" : "Usuário";
    const input = $("#login-identity");
    input.type = admin ? "email" : "text";
    input.placeholder = admin ? "voce@exemplo.com" : "nome da equipe";
    input.value = "";
    $("#login-error").textContent = "";
    input.focus();
  }

  async function routeExistingSession() {
    const session = window.RemoteCodexAuth.getSession();
    if (!session?.access_token) return false;
    const headers = { Authorization: `Bearer ${session.access_token}` };
    const admin = await fetch("/api/admin/accounts", { headers, cache: "no-store" });
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
    const submitButton = $("#login-submit");
    const error = $("#login-error");
    error.textContent = "";
    submitButton.disabled = true;
    submitButton.classList.add("loading");
    try {
      if (!state.config) throw new Error("Configure o relay antes de entrar.");
      const identity = $("#login-identity").value.trim();
      const password = $("#login-password").value;
      const email = state.role === "admin" ? identity.toLowerCase() : await loginEmailForUsername(identity);
      await window.RemoteCodexAuth.passwordLogin(state.config, email, password);
      const target = state.role === "admin" ? "/api/admin/accounts" : "/api/user/dashboard";
      const response = await fetch(target, {
        headers: { Authorization: `Bearer ${window.RemoteCodexAuth.getSession().access_token}` },
        cache: "no-store",
      });
      if (!response.ok) {
        window.RemoteCodexAuth.clearSession();
        throw new Error(state.role === "admin" ? "Este login não possui acesso administrativo." : "Usuário não habilitado ou ainda não migrado.");
      }
      window.location.replace(state.role === "admin" ? "/admin" : "/dashboard");
    } catch (caught) {
      error.textContent = caught instanceof Error ? caught.message : "Não foi possível entrar.";
    } finally {
      submitButton.disabled = false;
      submitButton.classList.remove("loading");
    }
  }

  async function init() {
    const params = new URLSearchParams(window.location.search);
    if (params.get("mode") === "admin") selectRole("admin");
    if (params.get("expired") === "1") $("#login-note").textContent = "Sua sessão expirou. Entre novamente.";
    document.querySelectorAll("[data-role]").forEach((button) => button.addEventListener("click", () => selectRole(button.dataset.role)));
    $("#toggle-password").addEventListener("click", () => {
      const input = $("#login-password");
      const visible = input.type === "text";
      input.type = visible ? "password" : "text";
      $("#toggle-password .password-toggle-label").textContent = visible ? "Mostrar" : "Ocultar";
      $("#toggle-password").setAttribute("aria-label", visible ? "Mostrar senha" : "Ocultar senha");
    });
    $("#login-form").addEventListener("submit", submit);
    $("#retry-config").addEventListener("click", async () => {
      const retry = $("#retry-config");
      retry.disabled = true;
      retry.textContent = "Verificando…";
      const ready = await loadAuthConfig();
      retry.disabled = false;
      retry.textContent = "Tentar novamente";
      if (ready) await routeExistingSession();
    });
    if (!(await loadAuthConfig())) return;
    if (await routeExistingSession()) return;
  }

  init().catch((error) => { setConfigState(error); });
})();
