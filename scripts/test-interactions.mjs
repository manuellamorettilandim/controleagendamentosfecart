import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import WebSocket from "ws";

const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const profilePath = path.resolve("tmp/cdp-interactive-profile");
const outDir = path.resolve("tmp/interaction_screenshots");

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runInteractiveTests() {
  const port = 9223;
  const args = [
    "--headless=new",
    "--disable-gpu",
    "--remote-debugging-port=" + port,
    `--user-data-dir=${profilePath}`,
    "--window-size=1440,960",
    "--hide-scrollbars",
    "about:blank",
  ];

  console.log("Starting Chrome on port", port);
  const chromeProc = spawn(chromePath, args);

  for (let i = 0; i < 30; i++) {
    await sleep(500);
    try {
      const res = await fetch(`http://localhost:${port}/json/version`);
      if (res.ok) {
        console.log("Chrome ready!");
        break;
      }
    } catch {}
  }

  const pageRes = await fetch(`http://localhost:${port}/json/new?about:blank`, { method: "PUT" });
  const pageInfo = await pageRes.json();
  const ws = new WebSocket(pageInfo.webSocketDebuggerUrl);

  await new Promise((resolve, reject) => {
    let msgId = 1;
    const callbacks = new Map();

    function send(method, params = {}) {
      const id = msgId++;
      return new Promise((res) => {
        callbacks.set(id, res);
        ws.send(JSON.stringify({ id, method, params }));
      });
    }

    async function capture(filename) {
      const result = await send("Page.captureScreenshot", { format: "png" });
      if (result?.data) {
        fs.writeFileSync(path.join(outDir, filename), Buffer.from(result.data, "base64"));
        console.log(`Captured ${filename}`);
      }
    }

    ws.on("open", async () => {
      try {
        await send("Page.enable");
        await send("Runtime.enable");

        await send("Page.addScriptToEvaluateOnNewDocument", {
          source: `
            try {
              window.localStorage.setItem("remote_codex_admin_session", JSON.stringify({
                access_token: "test-token",
                refresh_token: "",
                user: { id: "test-user", email: "test@example.com" },
                expires_at: Date.now() + 36000000
              }));
              window.localStorage.setItem("fecart-theme", "light");
            } catch(e) {}
          `,
        });

        // 1. Navigate to dashboard
        await send("Page.navigate", { url: "http://localhost:5173/dashboard.html#overview" });
        await sleep(1500);

        // 2. Test CTA click and highlight
        console.log("Testing CTA 'Reservar minha sessão agora' click...");
        const ctaClicked = await send("Runtime.evaluate", {
          expression: `
            (() => {
              const btn = Array.from(document.querySelectorAll("button")).find(b => b.textContent.includes("Reservar minha sessão agora"));
              if (btn) {
                btn.click();
                return true;
              }
              return false;
            })()
          `,
          returnByValue: true,
        });
        console.log("CTA button clicked:", ctaClicked?.result?.value);
        await sleep(600);
        await capture("01_after_cta_click.png");

        // Verify highlight class is present
        const hasHighlight = await send("Runtime.evaluate", {
          expression: `
            (() => {
              const el = document.getElementById("schedule-section");
              return el ? el.classList.contains("schedule-highlight-active") : false;
            })()
          `,
          returnByValue: true,
        });
        console.log("Schedule element has highlight class during 1.5s:", hasHighlight?.result?.value);

        // Wait 1.6s and verify highlight class is removed
        await sleep(1600);
        const highlightRemoved = await send("Runtime.evaluate", {
          expression: `
            (() => {
              const el = document.getElementById("schedule-section");
              return el ? !el.classList.contains("schedule-highlight-active") : false;
            })()
          `,
          returnByValue: true,
        });
        console.log("Schedule highlight class removed after 1.5s:", highlightRemoved?.result?.value);

        // 3. Test Booking Modal opening on clicking an available slot
        console.log("Testing clicking an available slot to open BookingModal...");
        const slotClicked = await send("Runtime.evaluate", {
          expression: `
            (() => {
              const slot = document.querySelector(".schedule-slot-card.is-clickable");
              if (slot) {
                slot.click();
                return true;
              }
              return false;
            })()
          `,
          returnByValue: true,
        });
        console.log("Slot clicked:", slotClicked?.result?.value);
        await sleep(500);
        await capture("02_booking_modal_open.png");

        // Close modal
        await send("Runtime.evaluate", {
          expression: `
            (() => {
              const cancelBtn = Array.from(document.querySelectorAll("button")).find(b => b.textContent.includes("Cancelar") || b.getAttribute("aria-label") === "Fechar modal");
              if (cancelBtn) cancelBtn.click();
            })()
          `,
        });
        await sleep(500);

        // 4. Test Navigation to Active Session Tab
        console.log("Testing switch to Active Session tab...");
        await send("Runtime.evaluate", {
          expression: `
            (() => {
              const btn = Array.from(document.querySelectorAll("button")).find(b => b.textContent.includes("Ver detalhes da sessão"));
              if (btn) btn.click();
              else window.location.hash = "active-session";
            })()
          `,
        });
        await sleep(800);
        await capture("03_active_session_tab.png");

        // 5. Test Copy Command Button Feedback
        console.log("Testing Copy command button...");
        await send("Runtime.evaluate", {
          expression: `
            (() => {
              const copyBtn = Array.from(document.querySelectorAll("button")).find(b => b.textContent.includes("Copiar comando"));
              if (copyBtn) copyBtn.click();
            })()
          `,
        });
        await sleep(300);
        const copiedText = await send("Runtime.evaluate", {
          expression: `
            (() => {
              const btn = document.querySelector(".terminal-command-container button");
              return btn ? btn.textContent.trim() : "";
            })()
          `,
          returnByValue: true,
        });
        console.log("Button text immediately after copy:", copiedText?.result?.value);
        await capture("04_after_copy_click.png");

        // 6. Test Navigation to Guides Tab & opening modal
        console.log("Testing switch to Guides tab & opening guide modal...");
        await send("Runtime.evaluate", {
          expression: `
            (() => {
              const tabBtn = Array.from(document.querySelectorAll(".header-nav button")).find(b => b.textContent.includes("Guias de Acesso"));
              if (tabBtn) tabBtn.click();
            })()
          `,
        });
        await sleep(800);
        await capture("05_guides_tab.png");

        // Click "Abrir guia"
        await send("Runtime.evaluate", {
          expression: `
            (() => {
              const openGuideBtn = Array.from(document.querySelectorAll("button")).find(b => b.textContent.includes("Abrir guia"));
              if (openGuideBtn) openGuideBtn.click();
            })()
          `,
        });
        await sleep(500);
        await capture("06_guide_modal_open.png");

        // 7. Test Theme Toggle to Dark
        console.log("Testing theme toggle to Dark...");
        await send("Runtime.evaluate", {
          expression: `
            (() => {
              const themeBtn = document.querySelector(".theme-toggle-btn");
              if (themeBtn) themeBtn.click();
            })()
          `,
        });
        await sleep(500);
        const currentTheme = await send("Runtime.evaluate", {
          expression: `document.documentElement.dataset.theme`,
          returnByValue: true,
        });
        console.log("Current theme after toggle:", currentTheme?.result?.value);
        await capture("07_dark_theme_toggled.png");

        await fetch(`http://localhost:${port}/json/close/${pageInfo.id}`);
        ws.close();
        resolve();
      } catch (e) {
        reject(e);
      }
    });

    ws.on("message", (raw) => {
      const data = JSON.parse(raw.toString());
      if (data.id && callbacks.has(data.id)) {
        const cb = callbacks.get(data.id);
        callbacks.delete(data.id);
        cb(data.result);
      }
    });

    ws.on("error", reject);
  });

  chromeProc.kill();
  console.log("All interactive tests finished successfully!");
}

runInteractiveTests();
