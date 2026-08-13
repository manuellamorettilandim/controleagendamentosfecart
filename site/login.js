(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);

  async function init() {
    const auth = window.RemoteCodexAuth;
    if (!auth) return;
    try {
      await auth.loadConfig();
      if (auth.getSession()?.access_token) {
        window.location.replace("/admin");
        return;
      }
    } catch (error) {
      $("#login-error").textContent = error.message;
      return;
    }

    if (new URLSearchParams(window.location.search).get("expired") === "1") {
      $("#login-note").textContent = "Sua sessão expirou. Entre novamente.";
      $("#login-note").className = "admin-status warning";
    }

    $("#login-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = $("#login-submit");
      $("#login-error").textContent = "";
      button.disabled = true;
      button.textContent = "Entrando…";
      try {
        const config = await auth.loadConfig();
        await auth.passwordLogin(config, $("#login-email").value.trim(), $("#login-password").value);
        window.location.replace("/admin");
      } catch (error) {
        $("#login-error").textContent = error.message;
      } finally {
        button.disabled = false;
        button.textContent = "Entrar";
      }
    });
  }

  void init();
})();
