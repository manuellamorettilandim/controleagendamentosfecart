import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import WebSocket from "ws";

async function testAdmin() {
  const chrome = spawn("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", [
    "--headless=new",
    "--remote-debugging-port=9222",
    "--user-data-dir=C:\\Users\\Renan\\AppData\\Local\\Temp\\chrome-admin-actions",
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

  // 1. Login Admin
  await send("Page.navigate", { url: "http://localhost:10000/login" });
  await new Promise(r => setTimeout(r, 1200));

  await send("Runtime.evaluate", { expression: `
    (() => {
      const idEl = document.querySelector("#login-identity");
      const passEl = document.querySelector("#login-password");
      idEl.value = "admin-teste@fecart.org";
      idEl.dispatchEvent(new Event("input", { bubbles: true }));
      passEl.value = "AdminFecart2026!";
      passEl.dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector("#login-submit").click();
    })()
  ` });

  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 500));
    const pathRes = await send("Runtime.evaluate", { expression: "window.location.pathname", returnByValue: true });
    if (pathRes.result?.value === "/admin") break;
  }
  await new Promise(r => setTimeout(r, 2000));

  // Testar clique em "+ Adicionar conta"
  console.log("Testando botão '+ Adicionar conta' no /admin...");
  const hasAddAccountBtn = (await send("Runtime.evaluate", {
    expression: `Boolean(document.querySelector("#btn-add-account, .add-account-card, [data-action='add-account'], button:has(.ph-plus)))`,
    returnByValue: true
  })).result?.value;
  console.log("Botão adicionar conta existe:", hasAddAccountBtn);

  if (hasAddAccountBtn) {
    await send("Runtime.evaluate", {
      expression: `document.querySelector("#btn-add-account, .add-account-card, [data-action='add-account'], button:has(.ph-plus)").click()`
    });
    await new Promise(r => setTimeout(r, 800));
    const shot = await send("Page.captureScreenshot", { format: "png" });
    await fs.writeFile("qa/test-run/16-admin-add-account-modal.png", Buffer.from(shot.data, "base64"));
    console.log("Screenshot do modal adicionar conta salvo.");
  }

  // 2. Navegar para /groups e testar ações
  console.log("Navegando para /groups...");
  await send("Page.navigate", { url: "http://localhost:10000/groups" });
  await new Promise(r => setTimeout(r, 2000));

  const groupsInfo = await send("Runtime.evaluate", { expression: `(() => {
    return {
      title: document.title,
      rows: Array.from(document.querySelectorAll("tbody tr, .group-card, [data-group-id]")).map(r => r.innerText?.replace(/\\s+/g, ' ')),
      buttons: Array.from(document.querySelectorAll("button")).map(b => b.innerText?.trim() || b.getAttribute("aria-label"))
    };
  })()`, returnByValue: true });
  console.log("Informações dos grupos:", groupsInfo.result?.value);

  // Testar botão de ação do aluno (...)
  const hasActionMenu = (await send("Runtime.evaluate", {
    expression: `Boolean(document.querySelector(".action-menu-btn, .group-actions-trigger, td:last-child button, [aria-label*='ação'], [aria-label*='mais']"))`,
    returnByValue: true
  })).result?.value;
  console.log("Tem menu de ações nos grupos?", hasActionMenu);

  // 3. Navegar para /telemetry e testar abas e botões
  console.log("Navegando para /telemetry...");
  await send("Page.navigate", { url: "http://localhost:10000/telemetry" });
  await new Promise(r => setTimeout(r, 2000));

  // Clicar em "Ranking de utilização"
  console.log("Testando clique em 'Ranking de utilização'...");
  await send("Runtime.evaluate", {
    expression: `(() => {
      const btn = Array.from(document.querySelectorAll("button")).find(b => b.innerText?.includes("Ranking"));
      if (btn) btn.click();
    })()`
  });
  await new Promise(r => setTimeout(r, 800));
  const shotRanking = await send("Page.captureScreenshot", { format: "png" });
  await fs.writeFile("qa/test-run/17-telemetry-ranking-tab.png", Buffer.from(shotRanking.data, "base64"));
  console.log("Screenshot do Ranking salvo.");

  // Clicar em "Trilha de ações"
  console.log("Testando clique em 'Trilha de ações'...");
  await send("Runtime.evaluate", {
    expression: `(() => {
      const btn = Array.from(document.querySelectorAll("button")).find(b => b.innerText?.includes("Trilha"));
      if (btn) btn.click();
    })()`
  });
  await new Promise(r => setTimeout(r, 800));
  const shotTrilha = await send("Page.captureScreenshot", { format: "png" });
  await fs.writeFile("qa/test-run/18-telemetry-trilha-tab.png", Buffer.from(shotTrilha.data, "base64"));
  console.log("Screenshot da Trilha salvo.");

  ws.close();
  chrome.kill();
}

testAdmin().catch(console.error);
