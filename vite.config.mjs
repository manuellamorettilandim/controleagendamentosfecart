import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const webRoot = path.join(projectRoot, "web");

export default defineConfig({
  root: webRoot,
  base: "/",
  plugins: [react()],
  build: {
    outDir: path.resolve(projectRoot, process.env.VITE_OUT_DIR || "site"),
    emptyOutDir: true,
    manifest: true,
    sourcemap: true,
    assetsDir: "assets",
    rollupOptions: {
      input: {
        login: path.join(webRoot, "login.html"),
        dashboard: path.join(webRoot, "dashboard.html"),
        admin: path.join(webRoot, "admin.html"),
        groups: path.join(webRoot, "groups.html"),
        telemetry: path.join(webRoot, "telemetry.html"),
      },
    },
  },
});
