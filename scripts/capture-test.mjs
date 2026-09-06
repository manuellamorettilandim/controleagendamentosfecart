import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const outPath = path.resolve("tmp/validation_screenshots/test.png");
const profilePath = path.resolve("tmp/chrome-test-profile");

if (!fs.existsSync("tmp/validation_screenshots")) {
  fs.mkdirSync("tmp/validation_screenshots", { recursive: true });
}

const args = [
  "--headless=new",
  "--disable-gpu",
  "--hide-scrollbars",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-sync",
  "--disable-extensions",
  `--user-data-dir=${profilePath}`,
  "--window-size=1440,1080",
  `--screenshot=${outPath}`,
  "http://localhost:5173/dashboard.html",
];

console.log("Spawning Chrome...");
const child = spawn(chromePath, args);

child.on("close", (code) => {
  console.log("Chrome exited with code:", code);
  if (fs.existsSync(outPath)) {
    const stats = fs.statSync(outPath);
    console.log("SUCCESS! File created, size:", stats.size);
  } else {
    console.log("FILE NOT CREATED!");
  }
});
