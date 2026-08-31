import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import WebSocket from "ws";

const REPORT_DIR = path.resolve("qa", "test-run");
const BASE_URL = "http://localhost:10000";

class ChromeHelper {
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
      "--user-data-dir=C:\\Users\\Renan\\AppData\\Local\\Temp\\chrome-aluno-run",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      "--disable-extensions",
    ]);

    for (let i = 0; i < 25; i++) {
      try {
        const res = await fetch("http://127.0.0.1:9222/json/version");
        if (res.ok) break;
      } catch {
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    const newTabRes = await fetch("http://127.0.0.1:9222/json/new", { method: "PUT" });
    const tabData = await newTabRes.json();
    this.ws = new WebSocket(tabData.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      this.ws.once("open", res);
      this.ws.once("error", rej);
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
        });
      } else if (msg.method === "Runtime.exceptionThrown") {
        this.pageErrors.push(msg.params.exceptionDetails);
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
    await new Promise((r) => setTimeout(r, 400));
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

  async screenshot(filename) {
    const res = await this.send("Page.captureScreenshot", { format: "png" });
    const buffer = Buffer.from(res.data, "base64");
    const filepath = path.join(REPORT_DIR, filename);
    await fs.writeFile(filepath, buffer);
    return filepath;
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

async function run() {
  console.log("Iniciando teste aprofundado do fluxo do Aluno (/dashboard)...");
  const helper = new ChromeHelper();
  await helper.start();

  try {
    await helper.navigate(`${BASE_URL}/login`);

    await helper.type("#login-identity", "aluno-teste");
    await helper.type("#login-password", "SenhaTeste123!");
    await helper.click("#login-submit");

    // Aguardar até a URL mudar para /dashboard (até 10 segundos)
    console.log("Aguardando redirecionamento para /dashboard...");
    let onDashboard = false;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const currentPath = await helper.eval("window.location.pathname");
      if (currentPath === "/dashboard") {
        onDashboard = true;
        break;
      }
    }

    console.log("Chegou no dashboard?", onDashboard);
    if (!onDashboard) {
      const errorMsg = await helper.eval(`({
        url: window.location.pathname,
        noticeVisible: !document.querySelector('#login-notice')?.hidden,
        noticeTitle: document.querySelector('#notice-title')?.textContent?.trim(),
        noticeMsg: document.querySelector('#notice-message')?.textContent?.trim()
      })`);
      console.log("Falha no login do aluno:", errorMsg);
      await helper.screenshot("aluno-login-failure.png");
      return;
    }

    // Aguardar carregamento do dashboard
    await new Promise((r) => setTimeout(r, 2000));
    await helper.screenshot("04b-aluno-dashboard-real-dark.png");
    console.log("Screenshot do Dashboard escuro salvo.");

    // Avaliar estrutura e dados da página
    const dashData = await helper.eval(`(() => {
      const headerTitle = document.querySelector('header h1, .brand-title, .app-header')?.innerText?.replace(/\\s+/g, ' ');
      const groupName = document.querySelector('.group-badge, #student-group-name, .user-name, [data-group]')?.innerText?.replace(/\\s+/g, ' ');
      
      const cards = Array.from(document.querySelectorAll('.card, .dashboard-card, section')).map(s => {
        const title = s.querySelector('h2, h3, .card-title')?.innerText?.trim();
        const content = s.innerText?.replace(/\\s+/g, ' ');
        return { title, snippet: content ? content.slice(0, 100) : '' };
      }).filter(c => c.title);

      const activeSessionBanner = document.querySelector('.active-session, .session-banner, #active-session-card, [data-session="active"]')?.innerText?.replace(/\\s+/g, ' ');
      const quotaDetails = document.querySelector('.quota-card, #quota-card, .quota-display, [data-quota]')?.innerText?.replace(/\\s+/g, ' ');
      const calendarFound = Boolean(document.querySelector('.fc, #booking-calendar, .calendar-view'));
      const buttons = Array.from(document.querySelectorAll('button:not([hidden])')).map(b => ({
        id: b.id,
        text: b.innerText?.trim(),
        ariaLabel: b.getAttribute('aria-label')
      }));

      return {
        headerTitle,
        groupName,
        cards,
        activeSessionBanner,
        quotaDetails,
        calendarFound,
        buttonsCount: buttons.length,
        buttons: buttons.slice(0, 10)
      };
    })()`);

    console.log("\n--- DADOS DO DASHBOARD DO ALUNO ---");
    console.log("Cabeçalho:", dashData.headerTitle);
    console.log("Grupo:", dashData.groupName);
    console.log("Cartões detectados:", dashData.cards);
    console.log("Banner de sessão ativa:", dashData.activeSessionBanner);
    console.log("Detalhes de cota:", dashData.quotaDetails);
    console.log("Calendário FullCalendar presente:", dashData.calendarFound);
    console.log("Botões principais:", dashData.buttons);

    // Testar tema claro no Dashboard
    await helper.click("#theme-toggle");
    await new Promise((r) => setTimeout(r, 400));
    await helper.screenshot("05b-aluno-dashboard-real-light.png");
    console.log("Screenshot do Dashboard claro salvo.");
    await helper.click("#theme-toggle");

    // Testar versão Mobile (375x812)
    await helper.setViewport(375, 812, true);
    await new Promise((r) => setTimeout(r, 500));
    await helper.screenshot("06b-aluno-dashboard-real-mobile.png");
    const mobileOverflow = await helper.eval(`({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      hasOverflow: document.documentElement.scrollWidth > window.innerWidth
    })`);
    console.log("Mobile audit dashboard:", mobileOverflow);

    await helper.setViewport(1280, 800, false);

    // Testar Modal de Agendamento do Aluno
    const hasBookingBtn = await helper.eval(`Boolean(document.querySelector('#btn-schedule, #btn-open-booking, button[data-action="book"], .btn-schedule'))`);
    console.log("Tem botão de agendamento?", hasBookingBtn);
    if (hasBookingBtn) {
      await helper.click('#btn-schedule, #btn-open-booking, button[data-action="book"], .btn-schedule');
      await new Promise((r) => setTimeout(r, 600));
      await helper.screenshot("07b-aluno-booking-modal-open.png");
      const modalData = await helper.eval(`({
        title: document.querySelector('.modal-title, [role="dialog"] h2, #booking-modal h3')?.textContent?.trim(),
        visible: !document.querySelector('#booking-modal, [role="dialog"]')?.hidden,
        fields: Array.from(document.querySelectorAll('#booking-modal input, #booking-modal select')).map(f => ({ id: f.id, type: f.type, value: f.value }))
      })`);
      console.log("Dados do Modal de Agendamento:", modalData);
      
      // Fechar modal
      await helper.eval(`document.querySelector('#booking-modal .btn-close, [role="dialog"] [aria-label*="Fechar"], #btn-close-modal')?.click()`);
    }

    console.log("Teste do aluno finalizado com sucesso!");
  } finally {
    await helper.stop();
  }
}

run().catch(console.error);
