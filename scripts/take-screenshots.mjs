import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import WebSocket from "ws";

const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const profilePath = path.resolve("tmp/cdp-profile");
const outDir = path.resolve("tmp/validation_screenshots");

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

// Pages to capture
const targets = [
  { name: "overview_light", tab: "overview", theme: "light" },
  { name: "overview_dark", tab: "overview", theme: "dark" },
  { name: "active_session_light", tab: "active-session", theme: "light" },
  { name: "active_session_dark", tab: "active-session", theme: "dark" },
  { name: "statistics_light", tab: "statistics", theme: "light" },
  { name: "statistics_dark", tab: "statistics", theme: "dark" },
  { name: "guides_light", tab: "guides", theme: "light" },
  { name: "guides_dark", tab: "guides", theme: "dark" },
];

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function captureAll() {
  const port = 9222;
  const args = [
    "--headless=new",
    "--disable-gpu",
    "--remote-debugging-port=" + port,
    `--user-data-dir=${profilePath}`,
    "--window-size=1440,960",
    "--hide-scrollbars",
    "about:blank",
  ];

  console.log("Starting Chrome in background...");
  const chromeProc = spawn(chromePath, args);

  // Wait for remote debugging to be ready
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    try {
      const res = await fetch(`http://localhost:${port}/json/version`);
      if (res.ok) {
        const json = await res.json();
        console.log("Chrome CDP ready:", json.Browser);
        break;
      }
    } catch {
      // Retrying
    }
  }

  for (const target of targets) {
    console.log(`Capturing ${target.name}...`);
    try {
      // Create new page
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

        ws.on("open", async () => {
          try {
            await send("Page.enable");
            await send("Runtime.enable");

            // Seed auth session & theme before navigation
            await send("Page.addScriptToEvaluateOnNewDocument", {
              source: `
                try {
                  window.localStorage.setItem("remote_codex_admin_session", JSON.stringify({
                    access_token: "test-token",
                    refresh_token: "test-refresh",
                    user: { id: "test-user", email: "test@example.com" },
                    expires_at: Date.now() + 36000000
                  }));
                  window.localStorage.setItem("fecart-theme", "${target.theme}");
                } catch(e) {}
              `,
            });

            // Navigate to dashboard with tab hash
            const url = `http://localhost:5173/dashboard.html#${target.tab}`;
            await send("Page.navigate", { url });
            await sleep(1500);

            // Force theme dataset and tab hash
            await send("Runtime.evaluate", {
              expression: `
                document.documentElement.dataset.theme = '${target.theme}';
                window.location.hash = '${target.tab}';
              `,
            });
            await sleep(600);

            // Capture screenshot
            const result = await send("Page.captureScreenshot", {
              format: "png",
              captureBeyondViewport: true,
            });

            if (result && result.data) {
              const buf = Buffer.from(result.data, "base64");
              const outFile = path.join(outDir, `${target.name}.png`);
              fs.writeFileSync(outFile, buf);
              console.log(`Saved ${target.name}.png (${buf.length} bytes)`);
            }

            // Close page
            await fetch(`http://localhost:${port}/json/close/${pageInfo.id}`);
            ws.close();
            resolve();
          } catch (err) {
            reject(err);
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
    } catch (e) {
      console.error(`Error capturing ${target.name}:`, e.message);
    }
  }

  console.log("All screenshots captured. Terminating Chrome...");
  chromeProc.kill();
}

captureAll().then(() => console.log("Done!"));
