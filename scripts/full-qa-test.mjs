import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import WebSocket from "ws";

const REPORT_DIR = path.resolve("qa", "test-run");
const BASE_URL = "http://localhost:10000";

class ChromeController {
  constructor() {
    this.chrome = null;
    this.ws = null;
    this.id = 1;
    this.pending = new Map();
    this.consoleLogs = [];
    this.pageErrors = [];
  }

  async start() {
    this.chrome = spawn("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", [
      "--headless=new",
      "--remote-debugging-port=9222",
      "--user-data-dir=C:\\Users\\Renan\\AppData\\Local\\Temp\\chrome-qa-run",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      "--disable-extensions",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
    ]);

    let connected = false;
    for (let i = 0; i < 25; i++) {
      try {
        const res = await fetch("http://127.0.0.1:9222/json/version");
        if (res.ok) {
          connected = true;
          break;
        }
      } catch {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    if (!connected) throw new Error("Não foi possível conectar ao Chrome headless.");

    const newTabRes = await fetch("http://127.0.0.1:9222/json/new", { method: "PUT" });
    const tabData = await newTabRes.json();
    const wsUrl = tabData.webSocketDebuggerUrl;

    this.ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.once("open", resolve);
      this.ws.once("error", reject);
    });

    this.ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method === "Runtime.consoleAPICalled") {
        this.consoleLogs.push({
          type: msg.params.type,
          args: msg.params.args.map((a) => a.value ?? a.description),
          timestamp: new Date().toISOString(),
        });
      } else if (msg.method === "Runtime.exceptionThrown") {
        this.pageErrors.push({
          text: msg.params.exceptionDetails.text,
          exception: msg.params.exceptionDetails.exception?.description,
          url: msg.params.exceptionDetails.url,
          line: msg.params.exceptionDetails.lineNumber,
        });
      }
    });

    await this.send("Page.enable");
    await this.send("Runtime.enable");
    await this.send("Console.enable");
    await this.setViewport(1280, 800);
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const reqId = this.id++;
      this.pending.set(reqId, { resolve, reject });
      this.ws.send(JSON.stringify({ id: reqId, method, params }));
    });
  }

  async setViewport(width, height, mobile = false) {
    await this.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile,
      screenOrientation: mobile ? { angle: 0, type: "portraitPrimary" } : { angle: 0, type: "landscapePrimary" },
    });
  }

  async navigate(url) {
    await this.send("Page.navigate", { url });
    await new Promise((r) => setTimeout(r, 1500));
  }

  async eval(expression) {
    const res = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res.exceptionDetails) {
      throw new Error("Eval error: " + (res.exceptionDetails.exception?.description || res.exceptionDetails.text));
    }
    return res.result?.value;
  }

  async click(selector) {
    const found = await this.eval(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
    if (!found) throw new Error(`Element not found for click: ${selector}`);
    await this.eval(`document.querySelector(${JSON.stringify(selector)}).click()`);
    await new Promise((r) => setTimeout(r, 500));
  }

  async type(selector, text) {
    await this.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error("Element not found: " + ${JSON.stringify(selector)});
      el.focus();
      el.value = ${JSON.stringify(text)};
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    })()`);
    await new Promise((r) => setTimeout(r, 150));
  }

  async screenshot(filename, fullPage = false) {
    const res = await this.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: fullPage,
    });
    const buffer = Buffer.from(res.data, "base64");
    const filepath = path.join(REPORT_DIR, filename);
    await fs.writeFile(filepath, buffer);
    return filepath;
  }

  async auditAccessibilityAndLayout() {
    return await this.eval(`(() => {
      const results = {
        title: document.title,
        url: window.location.href,
        hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        missingAriaLabels: [],
        missingFormLabels: [],
        missingAltImages: [],
        interactiveElementsCount: 0,
        buttonsWithoutLabels: [],
        theme: document.documentElement.dataset.theme || "default"
      };

      document.querySelectorAll("img").forEach((img) => {
        if (!img.hasAttribute("alt")) {
          results.missingAltImages.push(img.src || img.className);
        }
      });

      document.querySelectorAll("input, select, textarea").forEach((input) => {
        if (input.type === "hidden") return;
        const id = input.id;
        const hasLabel = id && document.querySelector('label[for="' + id + '"]');
        const hasAriaLabel = input.hasAttribute("aria-label") || input.hasAttribute("aria-labelledby");
        if (!hasLabel && !hasAriaLabel) {
          results.missingFormLabels.push({
            id: input.id,
            name: input.name,
            type: input.type,
            placeholder: input.placeholder || null
          });
        }
      });

      document.querySelectorAll("button").forEach((btn) => {
        results.interactiveElementsCount++;
        const text = (btn.textContent || "").trim();
        const ariaLabel = btn.getAttribute("aria-label");
        const title = btn.getAttribute("title");
        if (!text && !ariaLabel && !title) {
          results.buttonsWithoutLabels.push({
            className: btn.className,
            id: btn.id
          });
        }
      });

      return results;
    })()`);
  }

  async stop() {
    try {
      if (this.ws) this.ws.close();
    } catch {}
    try {
      if (this.chrome) this.chrome.kill();
    } catch {}
  }
}

async function runFullQA() {
  console.log("====================================================================");
  console.log("INICIANDO AUDITORIA E TESTES E2E COMPLETOS DO FECART AI SHARE");
  console.log("====================================================================\n");

  const ctrl = new ChromeController();
  await ctrl.start();

  const auditReport = {
    startedAt: new Date().toISOString(),
    tests: [],
    screenshots: [],
    uxObservations: [],
    accessibilityFindings: [],
    performanceLogs: [],
    criticalIssues: [],
    warnings: [],
    recommendations: []
  };

  try {
    // -------------------------------------------------------------------------
    // TESTE 1: PÁGINA DE LOGIN - UI, TEMA, VALIDAÇÕES E ACESSIBILIDADE
    // -------------------------------------------------------------------------
    console.log("[1/6] Testando Página de Login (/login)...");
    await ctrl.setViewport(1280, 800);
    await ctrl.navigate(`${BASE_URL}/login`);

    const s1 = await ctrl.screenshot("01-login-desktop-dark.png");
    auditReport.screenshots.push({ name: "Login Desktop (Dark)", path: s1 });

    const loginMeta = await ctrl.eval(`({
      title: document.title,
      heading: document.querySelector('h1')?.textContent?.trim(),
      subtitle: document.querySelector('.auth-subtitle')?.textContent?.trim(),
      theme: document.documentElement.dataset.theme,
      hasThemeToggle: Boolean(document.querySelector('#theme-toggle')),
      hasIdentityInput: Boolean(document.querySelector('#login-identity')),
      hasPasswordInput: Boolean(document.querySelector('#login-password')),
      hasSubmitBtn: Boolean(document.querySelector('#login-submit')),
      hasPasswordToggle: Boolean(document.querySelector('#toggle-password')),
    })`);
    console.log("   ✓ Meta Login:", loginMeta);

    // Testar Alternância de Tema (Dark -> Light -> Dark)
    await ctrl.click("#theme-toggle");
    await new Promise((r) => setTimeout(r, 300));
    const lightTheme = await ctrl.eval(`document.documentElement.dataset.theme`);
    const s2 = await ctrl.screenshot("02-login-desktop-light.png");
    auditReport.screenshots.push({ name: "Login Desktop (Light)", path: s2 });
    console.log(`   ✓ Alternância de tema: mudou para '${lightTheme}'.`);

    // Voltar para dark
    await ctrl.click("#theme-toggle");
    await new Promise((r) => setTimeout(r, 200));

    // Testar Responsividade Mobile (375x812)
    await ctrl.setViewport(375, 812, true);
    await new Promise((r) => setTimeout(r, 300));
    const loginMobileAudit = await ctrl.auditAccessibilityAndLayout();
    const s3 = await ctrl.screenshot("03-login-mobile-dark.png");
    auditReport.screenshots.push({ name: "Login Mobile (Dark)", path: s3 });
    console.log(`   ✓ Responsividade Mobile Login: Overflow=${loginMobileAudit.hasHorizontalOverflow}`);

    // Voltar viewport desktop
    await ctrl.setViewport(1280, 800, false);

    // Testar Validação de Campos Vazios
    await ctrl.click("#login-submit");
    await new Promise((r) => setTimeout(r, 300));
    const validationEmpty = await ctrl.eval(`({
      identityMsg: document.querySelector('[data-message-for="identity"]')?.textContent?.trim(),
      hasShake: document.querySelector('#login-form')?.classList.contains('shake') || false,
      activeElementId: document.activeElement?.id
    })`);
    console.log("   ✓ Validação de campos vazios:", validationEmpty);

    // Testar Alternância de Visibilidade de Senha
    await ctrl.type("#login-password", "Teste12345");
    const passTypeBefore = await ctrl.eval(`document.querySelector('#login-password').type`);
    await ctrl.click("#toggle-password");
    const passTypeAfter = await ctrl.eval(`document.querySelector('#login-password').type`);
    console.log(`   ✓ Toggle senha: de '${passTypeBefore}' para '${passTypeAfter}'`);

    // Testar Login com Credencial Inválida
    await ctrl.type("#login-identity", "usuario-inexistente");
    await ctrl.type("#login-password", "SenhaErrada999!");
    await ctrl.click("#login-submit");
    await new Promise((r) => setTimeout(r, 1500));

    const noticeError = await ctrl.eval(`({
      visible: !document.querySelector('#login-notice')?.hidden,
      title: document.querySelector('#notice-title')?.textContent?.trim(),
      message: document.querySelector('#notice-message')?.textContent?.trim()
    })`);
    console.log("   ✓ Mensagem de erro ao falhar login:", noticeError);

    // -------------------------------------------------------------------------
    // TESTE 2: FLUXO DO ALUNO/USUÁRIO COMUM (/dashboard)
    // -------------------------------------------------------------------------
    console.log("\n[2/6] Testando Autenticação e Painel do Aluno (/dashboard)...");
    await ctrl.type("#login-identity", "aluno-teste");
    await ctrl.type("#login-password", "SenhaTeste123!");
    await ctrl.click("#login-submit");
    await new Promise((r) => setTimeout(r, 2200));

    const userUrl = await ctrl.eval("window.location.pathname");
    console.log(`   ✓ URL após login do aluno: ${userUrl}`);

    const s4 = await ctrl.screenshot("04-aluno-dashboard-dark.png");
    auditReport.screenshots.push({ name: "Aluno Dashboard (Dark)", path: s4 });

    const studentDashboardData = await ctrl.eval(`({
      title: document.title,
      groupName: document.querySelector('.brand-group, .user-name, [data-group-name]')?.textContent?.trim() || document.querySelector('header')?.innerText?.replace(/\\s+/g, ' '),
      quotaSummary: document.querySelector('.quota-summary, .quota-card, [data-quota]')?.innerText?.replace(/\\s+/g, ' '),
      hasCalendar: Boolean(document.querySelector('#booking-calendar, .fc, .calendar-container')),
      sessionStatus: document.querySelector('.session-status, #session-status, [data-session-status]')?.innerText?.replace(/\\s+/g, ' '),
      cards: Array.from(document.querySelectorAll('.dashboard-card, .card, .panel')).map(c => c.querySelector('h2, h3, .card-title')?.textContent?.trim()).filter(Boolean)
    })`);
    console.log("   ✓ Dados do Dashboard Aluno:", studentDashboardData);

    // Testar Alternância de Tema no Dashboard
    const hasThemeBtn = await ctrl.eval(`Boolean(document.querySelector('#theme-toggle'))`);
    if (hasThemeBtn) {
      await ctrl.click("#theme-toggle");
      await new Promise((r) => setTimeout(r, 300));
      const s5 = await ctrl.screenshot("05-aluno-dashboard-light.png");
      auditReport.screenshots.push({ name: "Aluno Dashboard (Light)", path: s5 });
      await ctrl.click("#theme-toggle");
    }

    // Testar Responsividade Mobile do Dashboard Aluno
    await ctrl.setViewport(375, 812, true);
    await new Promise((r) => setTimeout(r, 400));
    const studentMobileAudit = await ctrl.auditAccessibilityAndLayout();
    const s6 = await ctrl.screenshot("06-aluno-dashboard-mobile.png");
    auditReport.screenshots.push({ name: "Aluno Dashboard Mobile", path: s6 });
    console.log(`   ✓ Responsividade Mobile Dashboard Aluno: Overflow=${studentMobileAudit.hasHorizontalOverflow} (scrollWidth=${studentMobileAudit.scrollWidth}px vs innerWidth=${studentMobileAudit.innerWidth}px)`);

    await ctrl.setViewport(1280, 800, false);

    // Testar Abertura do Modal de Agendamento ou Interação com Calendário
    const tryOpenBooking = await ctrl.eval(`(() => {
      const btn = document.querySelector('#btn-open-booking, #btn-schedule, [data-action="book"], .schedule-action-btn, #action-schedule');
      if (btn) {
        btn.click();
        return { clicked: true, id: btn.id || btn.className };
      }
      return { clicked: false };
    })()`);
    if (tryOpenBooking.clicked) {
      await new Promise((r) => setTimeout(r, 600));
      const sModal = await ctrl.screenshot("07-aluno-booking-modal.png");
      auditReport.screenshots.push({ name: "Modal de Agendamento Aluno", path: sModal });
      const modalInfo = await ctrl.eval(`({
        title: document.querySelector('.modal-title, #modal-title, [role="dialog"] h2')?.textContent?.trim(),
        inputs: Array.from(document.querySelectorAll('#booking-modal input, .booking-dialog input')).map(i => ({ id: i.id, name: i.name, type: i.type })),
        buttons: Array.from(document.querySelectorAll('#booking-modal button, .booking-dialog button')).map(b => b.textContent.trim())
      })`);
      console.log("   ✓ Modal de agendamento aberto:", modalInfo);

      await ctrl.eval(`(() => {
        const closeBtn = document.querySelector('#booking-modal .btn-close, .booking-dialog [aria-label="Fechar"], #btn-close-modal, .modal-close');
        if (closeBtn) closeBtn.click();
      })()`);
    }

    // Testar Logout do Aluno
    console.log("   ✓ Efetuando logout do Aluno...");
    await ctrl.eval(`(() => {
      window.RemoteCodexAuth?.clearSession();
      window.location.replace('/login');
    })()`);
    await new Promise((r) => setTimeout(r, 1200));

    // -------------------------------------------------------------------------
    // TESTE 3: FLUXO DO ADMINISTRADOR (/admin)
    // -------------------------------------------------------------------------
    console.log("\n[3/6] Testando Autenticação e Painel Administrativo (/admin)...");
    await ctrl.navigate(`${BASE_URL}/login`);
    await ctrl.type("#login-identity", "admin-teste@fecart.org");
    await ctrl.type("#login-password", "AdminFecart2026!");
    await ctrl.click("#login-submit");
    await new Promise((r) => setTimeout(r, 2200));

    const adminUrl = await ctrl.eval("window.location.pathname");
    console.log(`   ✓ URL após login do admin: ${adminUrl}`);

    const s8 = await ctrl.screenshot("08-admin-dashboard-dark.png");
    auditReport.screenshots.push({ name: "Admin Dashboard (Dark)", path: s8 });

    const adminDashboardData = await ctrl.eval(`({
      title: document.title,
      headerText: document.querySelector('.admin-header, header')?.innerText?.replace(/\\s+/g, ' '),
      navLinks: Array.from(document.querySelectorAll('.admin-nav a, nav a, .sidebar a')).map(a => ({ text: a.textContent.trim(), href: a.getAttribute('href') })),
      kpiCards: Array.from(document.querySelectorAll('.kpi-card, .metric-card, .stat-card')).map(c => c.innerText?.replace(/\\s+/g, ' ')),
      sections: Array.from(document.querySelectorAll('section h2, .panel h2, .card-title')).map(s => s.textContent.trim())
    })`);
    console.log("   ✓ Dados do Painel Admin:", adminDashboardData);

    // Testar tema claro no Admin
    if (hasThemeBtn) {
      await ctrl.click("#theme-toggle");
      await new Promise((r) => setTimeout(r, 300));
      const s9 = await ctrl.screenshot("09-admin-dashboard-light.png");
      auditReport.screenshots.push({ name: "Admin Dashboard (Light)", path: s9 });
      await ctrl.click("#theme-toggle");
    }

    // Testar Responsividade Mobile do Admin
    await ctrl.setViewport(375, 812, true);
    await new Promise((r) => setTimeout(r, 400));
    const adminMobileAudit = await ctrl.auditAccessibilityAndLayout();
    const s10 = await ctrl.screenshot("10-admin-dashboard-mobile.png");
    auditReport.screenshots.push({ name: "Admin Dashboard Mobile", path: s10 });
    console.log(`   ✓ Responsividade Mobile Admin: Overflow=${adminMobileAudit.hasHorizontalOverflow} (scrollWidth=${adminMobileAudit.scrollWidth}px vs innerWidth=${adminMobileAudit.innerWidth}px)`);

    await ctrl.setViewport(1280, 800, false);

    // -------------------------------------------------------------------------
    // TESTE 4: GESTÃO DE TURMAS E USUÁRIOS (/groups)
    // -------------------------------------------------------------------------
    console.log("\n[4/6] Testando Gestão de Turmas e Usuários (/groups)...");
    await ctrl.navigate(`${BASE_URL}/groups`);
    await new Promise((r) => setTimeout(r, 1500));

    const s11 = await ctrl.screenshot("11-admin-groups-dark.png");
    auditReport.screenshots.push({ name: "Admin Grupos (Dark)", path: s11 });

    const groupsPageData = await ctrl.eval(`({
      title: document.title,
      groupCount: document.querySelectorAll('.group-card, .user-row, [data-group-id], tr.group-row').length,
      hasSearchInput: Boolean(document.querySelector('#search-groups, input[type="search"], #group-filter, input[placeholder*="Buscar"]')),
      hasNewGroupBtn: Boolean(document.querySelector('#btn-create-group, #btn-new-group, [data-action="new-group"], .btn-primary')),
      sampleGroups: Array.from(document.querySelectorAll('.group-name, .user-title, [data-group-name]')).slice(0, 5).map(el => el.textContent.trim())
    })`);
    console.log("   ✓ Dados da Gestão de Turmas:", groupsPageData);

    // Testar Responsividade Mobile de Grupos
    await ctrl.setViewport(375, 812, true);
    await new Promise((r) => setTimeout(r, 400));
    const groupsMobileAudit = await ctrl.auditAccessibilityAndLayout();
    const s12 = await ctrl.screenshot("12-admin-groups-mobile.png");
    auditReport.screenshots.push({ name: "Admin Grupos Mobile", path: s12 });
    console.log(`   ✓ Responsividade Mobile Grupos: Overflow=${groupsMobileAudit.hasHorizontalOverflow} (scrollWidth=${groupsMobileAudit.scrollWidth}px vs innerWidth=${groupsMobileAudit.innerWidth}px)`);

    await ctrl.setViewport(1280, 800, false);

    // -------------------------------------------------------------------------
    // TESTE 5: TELEMETRIA E RELATÓRIOS (/telemetry)
    // -------------------------------------------------------------------------
    console.log("\n[5/6] Testando Telemetria e Relatórios (/telemetry)...");
    await ctrl.navigate(`${BASE_URL}/telemetry`);
    await new Promise((r) => setTimeout(r, 1500));

    const s13 = await ctrl.screenshot("13-admin-telemetry-dark.png");
    auditReport.screenshots.push({ name: "Admin Telemetria (Dark)", path: s13 });

    const telemetryData = await ctrl.eval(`({
      title: document.title,
      kpis: Array.from(document.querySelectorAll('.metric-card, .telemetry-card, .stat-card')).map(c => c.innerText?.replace(/\\s+/g, ' ')),
      hasDatePicker: Boolean(document.querySelector('#date-range-from, #date-range, .date-filter, input[type="date"]')),
      hasExportButtons: Array.from(document.querySelectorAll('.btn-export, [data-export], button')).map(b => b.textContent.trim()).filter(t => t.toLowerCase().includes('pdf') || t.toLowerCase().includes('csv') || t.toLowerCase().includes('excel') || t.toLowerCase().includes('relat')),
      hasCharts: document.querySelectorAll('canvas, svg, .chart-container, .bar-chart').length
    })`);
    console.log("   ✓ Dados da Telemetria:", telemetryData);

    // Testar tema claro na Telemetria
    if (hasThemeBtn) {
      await ctrl.click("#theme-toggle");
      await new Promise((r) => setTimeout(r, 300));
      const s14 = await ctrl.screenshot("14-admin-telemetry-light.png");
      auditReport.screenshots.push({ name: "Admin Telemetria (Light)", path: s14 });
      await ctrl.click("#theme-toggle");
    }

    // Testar Responsividade Mobile de Telemetria
    await ctrl.setViewport(375, 812, true);
    await new Promise((r) => setTimeout(r, 400));
    const telemetryMobileAudit = await ctrl.auditAccessibilityAndLayout();
    const s15 = await ctrl.screenshot("15-admin-telemetry-mobile.png");
    auditReport.screenshots.push({ name: "Admin Telemetria Mobile", path: s15 });
    console.log(`   ✓ Responsividade Mobile Telemetria: Overflow=${telemetryMobileAudit.hasHorizontalOverflow} (scrollWidth=${telemetryMobileAudit.scrollWidth}px vs innerWidth=${telemetryMobileAudit.innerWidth}px)`);

    await ctrl.setViewport(1280, 800, false);

    // Testar Geração de Relatório via API (Preview e Exportação)
    console.log("   ✓ Testando geração de Relatório de Uso (PDF, CSV, XLSX)...");
    const exportTestResults = await ctrl.eval(`(async () => {
      const session = window.RemoteCodexAuth?.getSession();
      if (!session?.access_token) return { error: "Sem token de sessão" };
      const headers = {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + session.access_token
      };

      const now = new Date();
      const from = new Date(now.getTime() - 14 * 86400000).toISOString().slice(0, 10);
      const to = now.toISOString().slice(0, 10);

      const previewRes = await fetch("/api/admin/reports/usage/preview", {
        method: "POST",
        headers,
        body: JSON.stringify({ from, to })
      });
      const previewOk = previewRes.ok;
      const previewData = previewOk ? await previewRes.json() : null;

      const csvRes = await fetch("/api/admin/reports/usage/export", {
        method: "POST",
        headers,
        body: JSON.stringify({ from, to, format: "csv" })
      });

      const xlsxRes = await fetch("/api/admin/reports/usage/export", {
        method: "POST",
        headers,
        body: JSON.stringify({ from, to, format: "xlsx" })
      });

      const pdfRes = await fetch("/api/admin/reports/usage/export", {
        method: "POST",
        headers,
        body: JSON.stringify({ from, to, format: "pdf" })
      });

      return {
        previewOk,
        previewStatus: previewRes.status,
        groupsCount: previewData?.groups?.length || 0,
        totalTokens: previewData?.summary?.totalTokens || 0,
        csvStatus: csvRes.status,
        xlsxStatus: xlsxRes.status,
        pdfStatus: pdfRes.status
      };
    })()`);
    console.log("   ✓ Resultado dos testes de relatório:", exportTestResults);

    // -------------------------------------------------------------------------
    // TESTE 6: AUDITORIA CONSOLIDADA DE UX, ACESSIBILIDADE E ERROS
    // -------------------------------------------------------------------------
    console.log("\n[6/6] Consolidando Auditoria Geral...");

    auditReport.consoleLogs = ctrl.consoleLogs;
    auditReport.pageErrors = ctrl.pageErrors;
    auditReport.summary = {
      totalConsoleErrors: ctrl.consoleLogs.filter((l) => l.type === "error").length,
      totalConsoleWarnings: ctrl.consoleLogs.filter((l) => l.type === "warning").length,
      totalUnhandledExceptions: ctrl.pageErrors.length,
      testedPages: ["/login", "/dashboard", "/admin", "/groups", "/telemetry"],
      themesVerified: ["dark", "light"],
      viewportsVerified: ["desktop (1280x800)", "mobile (375x812)"],
      userTypesVerified: ["aluno (end-user)", "admin/owner (privileged)"],
      exportApiTested: exportTestResults,
    };

    console.log("====================================================================");
    console.log(`RESULTADO DA AUDITORIA:`);
    console.log(` - Erros no Console: ${auditReport.summary.totalConsoleErrors}`);
    console.log(` - Avisos no Console: ${auditReport.summary.totalConsoleWarnings}`);
    console.log(` - Exceções não tratadas: ${auditReport.summary.totalUnhandledExceptions}`);
    console.log(` - Screenshots gerados: ${auditReport.screenshots.length}`);
    console.log("====================================================================\n");

    const jsonReportPath = path.join(REPORT_DIR, "qa-audit-report.json");
    await fs.writeFile(jsonReportPath, JSON.stringify(auditReport, null, 2));
    console.log(`Relatório salvo em: ${jsonReportPath}`);
  } finally {
    await ctrl.stop();
  }
}

runFullQA().catch((err) => {
  console.error("FATAL ERROR NO RUNNER:", err);
  process.exit(1);
});
