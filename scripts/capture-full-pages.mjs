import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import WebSocket from "ws";

async function fullPageCaptures() {
  const chrome = spawn("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", [
    "--headless=new",
    "--remote-debugging-port=9222",
    "--user-data-dir=C:\\Users\\Renan\\AppData\\Local\\Temp\\chrome-full-captures",
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
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

  // 1. Aluno Full Page
  await send("Page.navigate", { url: "http://localhost:10000/login" });
  await new Promise(r => setTimeout(r, 1200));

  await send("Runtime.evaluate", { expression: `
    (() => {
      document.querySelector("#login-identity").value = "aluno-teste";
      document.querySelector("#login-password").value = "SenhaTeste123!";
      document.querySelector("#login-submit").click();
    })()
  ` });

  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 500));
    const path = (await send("Runtime.evaluate", { expression: "window.location.pathname", returnByValue: true })).result?.value;
    if (path === "/dashboard") break;
  }
  await new Promise(r => setTimeout(r, 2500));

  const alunoFull = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  await fs.writeFile("qa/test-run/full-01-dashboard.png", Buffer.from(alunoFull.data, "base64"));
  console.log("Full dashboard captured.");

  // Guias view
  await send("Runtime.evaluate", { expression: `document.querySelector("#tab-guides").click();` });
  await new Promise(r => setTimeout(r, 1000));
  const guiasFull = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  await fs.writeFile("qa/test-run/full-01b-dashboard-guias.png", Buffer.from(guiasFull.data, "base64"));
  console.log("Full guias captured.");

  // 2. Admin Full Pages
  await send("Runtime.evaluate", { expression: `
    window.RemoteCodexAuth.clearSession();
    window.location.replace("/login");
  ` });
  await new Promise(r => setTimeout(r, 1200));

  await send("Runtime.evaluate", { expression: `
    (() => {
      document.querySelector("#login-identity").value = "admin-teste@fecart.org";
      document.querySelector("#login-password").value = "AdminFecart2026!";
      document.querySelector("#login-submit").click();
    })()
  ` });

  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 500));
    const path = (await send("Runtime.evaluate", { expression: "window.location.pathname", returnByValue: true })).result?.value;
    if (path === "/admin") break;
  }
  await new Promise(r => setTimeout(r, 2500));

  const adminFull = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  await fs.writeFile("qa/test-run/full-02-admin.png", Buffer.from(adminFull.data, "base64"));
  console.log("Full admin captured.");

  // Groups
  await send("Page.navigate", { url: "http://localhost:10000/groups" });
  await new Promise(r => setTimeout(r, 2000));
  const groupsFull = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  await fs.writeFile("qa/test-run/full-03-groups.png", Buffer.from(groupsFull.data, "base64"));
  console.log("Full groups captured.");

  // Telemetry
  await send("Page.navigate", { url: "http://localhost:10000/telemetry" });
  await new Promise(r => setTimeout(r, 2000));
  const telemetryFull = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  await fs.writeFile("qa/test-run/full-04-telemetry.png", Buffer.from(telemetryFull.data, "base64"));
  console.log("Full telemetry captured.");

  console.log("All full-page screenshots captured successfully!");
  ws.close();
  chrome.kill();
}

fullPageCaptures().catch(console.error);
