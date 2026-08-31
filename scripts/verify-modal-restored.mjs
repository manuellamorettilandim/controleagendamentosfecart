import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import WebSocket from "ws";

async function verifyModal() {
  const chrome = spawn("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", [
    "--headless=new",
    "--remote-debugging-port=9222",
    "--user-data-dir=C:\\Users\\Renan\\AppData\\Local\\Temp\\chrome-verify-modal",
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

  // Navigate & Login
  await send("Page.navigate", { url: "http://localhost:10000/login" });
  await new Promise(r => setTimeout(r, 1200));

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

  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 500));
    const pathRes = await send("Runtime.evaluate", { expression: "window.location.pathname", returnByValue: true });
    if (pathRes.result?.value === "/dashboard") break;
  }
  await new Promise(r => setTimeout(r, 2000));

  // Open modal
  await send("Runtime.evaluate", { expression: `document.querySelector("#open-booking-top").click();` });
  await new Promise(r => setTimeout(r, 600));

  const shot = await send("Page.captureScreenshot", { format: "png" });
  await fs.writeFile("qa/test-run/booking-modal-restored.png", Buffer.from(shot.data, "base64"));

  const modalState = await send("Runtime.evaluate", { expression: `(() => {
    const modal = document.querySelector("#booking-modal");
    return {
      open: modal ? modal.open : false,
      title: document.querySelector("#booking-title")?.textContent,
      summaryTitle: document.querySelector("#booking-summary-title")?.textContent,
      summaryWindow: document.querySelector("#booking-summary-window")?.textContent,
      accountValue: document.querySelector("#booking-account")?.value,
      dateValue: document.querySelector("#booking-date")?.value,
      timeValue: document.querySelector("#booking-time")?.value
    };
  })()`, returnByValue: true });

  console.log("Modal Restored State:", modalState.result?.value);

  ws.close();
  chrome.kill();
}

verifyModal().catch(console.error);
