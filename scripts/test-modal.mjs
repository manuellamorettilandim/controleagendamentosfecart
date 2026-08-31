import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import WebSocket from "ws";

async function testModal() {
  const chrome = spawn("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", [
    "--headless=new",
    "--remote-debugging-port=9222",
    "--user-data-dir=C:\\Users\\Renan\\AppData\\Local\\Temp\\chrome-modal-test",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--disable-extensions"
  ]);

  for (let i = 0; i < 25; i++) {
    try {
      const res = await fetch("http://127.0.0.1:9222/json/version");
      if (res.ok) break;
    } catch {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  const newTabRes = await fetch("http://127.0.0.1:9222/json/new", { method: "PUT" });
  const tabData = await newTabRes.json();
  const ws = new WebSocket(tabData.webSocketDebuggerUrl);
  await new Promise(res => ws.once("open", res));

  let id = 1;
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const reqId = id++;
    const handler = (raw) => {
      const msg = JSON.parse(raw);
      if (msg.id === reqId) {
        ws.off("message", handler);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    };
    ws.on("message", handler);
    ws.send(JSON.stringify({ id: reqId, method, params }));
  });

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });

  // Navegar para login
  await send("Page.navigate", { url: "http://localhost:10000/login" });
  await new Promise(r => setTimeout(r, 1200));

  // Logar como aluno
  await send("Runtime.evaluate", { expression: `
    (() => {
      const idEl = document.querySelector("#login-identity");
      const passEl = document.querySelector("#login-password");
      idEl.value = "aluno-teste";
      idEl.dispatchEvent(new Event("input", { bubbles: true }));
      passEl.value = "SenhaTeste123!";
      passEl.dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector("#login-submit").click();
    })()
  ` });

  // Aguardar /dashboard
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 500));
    const pathRes = await send("Runtime.evaluate", { expression: "window.location.pathname", returnByValue: true });
    if (pathRes.result?.value === "/dashboard") break;
  }
  await new Promise(r => setTimeout(r, 2000));

  // Clicar em Agendar horário
  await send("Runtime.evaluate", { expression: `document.querySelector("#open-booking-top").click();` });
  await new Promise(r => setTimeout(r, 800));

  // Capturar screenshot do modal aberto
  const shot = await send("Page.captureScreenshot", { format: "png" });
  await fs.writeFile("qa/test-run/07c-booking-modal-open-success.png", Buffer.from(shot.data, "base64"));

  const modalInfo = await send("Runtime.evaluate", { expression: `(() => {
    const modal = document.querySelector("#booking-modal");
    return {
      isOpen: modal ? modal.open : false,
      title: document.querySelector("#booking-title")?.textContent,
      dayName: document.querySelector("#booking-date-day-name")?.textContent,
      formattedDate: document.querySelector("#booking-date-formatted")?.textContent,
      slotsCount: document.querySelectorAll(".booking-slot-card, .carousel-slot, .slot-button").length,
      feedbackText: document.querySelector("#booking-feedback-text")?.textContent,
      submitDisabled: document.querySelector("#booking-submit")?.disabled
    };
  })()`, returnByValue: true });

  console.log("Modal info:", modalInfo.result?.value);

  // Testar clique em Próximo dia
  await send("Runtime.evaluate", { expression: `document.querySelector("#booking-date-next").click();` });
  await new Promise(r => setTimeout(r, 600));

  const shotNextDay = await send("Page.captureScreenshot", { format: "png" });
  await fs.writeFile("qa/test-run/07d-booking-modal-next-day.png", Buffer.from(shotNextDay.data, "base64"));

  const nextDayInfo = await send("Runtime.evaluate", { expression: `(() => {
    return {
      dayName: document.querySelector("#booking-date-day-name")?.textContent,
      formattedDate: document.querySelector("#booking-date-formatted")?.textContent,
      feedbackText: document.querySelector("#booking-feedback-text")?.textContent
    };
  })()`, returnByValue: true });

  console.log("Next day info:", nextDayInfo.result?.value);

  // Testar fechar modal
  // Testar no mobile (375x812)
  console.log("Testando modal no mobile...");
  await send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
  await new Promise(r => setTimeout(r, 400));
  await send("Runtime.evaluate", { expression: `document.querySelector("#open-booking-top").click();` });
  await new Promise(r => setTimeout(r, 800));

  const mobileShot = await send("Page.captureScreenshot", { format: "png" });
  await fs.writeFile("qa/test-run/07e-booking-modal-mobile.png", Buffer.from(mobileShot.data, "base64"));

  const mobileMetrics = await send("Runtime.evaluate", { expression: `(() => {
    const modal = document.querySelector("#booking-modal");
    return {
      isOpen: modal ? modal.open : false,
      modalScrollWidth: modal ? modal.scrollWidth : 0,
      windowWidth: window.innerWidth,
      viewportScrollWidth: document.documentElement.scrollWidth,
      hasOverflow: document.documentElement.scrollWidth > window.innerWidth
    };
  })()`, returnByValue: true });

  console.log("Mobile modal metrics:", mobileMetrics.result?.value);

  ws.close();
  chrome.kill();
}

testModal().catch(console.error);

