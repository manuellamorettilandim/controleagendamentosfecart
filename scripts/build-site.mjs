import { mkdir, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fullCalendarRoot = path.join(projectRoot, "node_modules", "fullcalendar");
const picoRoot = path.join(projectRoot, "node_modules", "@picocss", "pico", "css");
const scheduleXCalendarRoot = path.join(projectRoot, "node_modules", "@schedule-x", "calendar", "dist");
const scheduleXEventsRoot = path.join(projectRoot, "node_modules", "@schedule-x", "events-service", "dist");
const scheduleXControlsRoot = path.join(projectRoot, "node_modules", "@schedule-x", "calendar-controls", "dist");
const scheduleXThemeRoot = path.join(projectRoot, "node_modules", "@schedule-x", "theme-default", "dist");
const preactRoot = path.join(projectRoot, "node_modules", "preact");
const preactSignalsRoot = path.join(projectRoot, "node_modules", "@preact", "signals");
const preactSignalsCoreRoot = path.join(projectRoot, "node_modules", "@preact", "signals-core");
const phosphorRoot = path.join(projectRoot, "node_modules", "@phosphor-icons", "web", "src", "regular");
const vendorDirectory = path.join(projectRoot, "site", "vendor");

await mkdir(vendorDirectory, { recursive: true });
await Promise.all([
  copyFile(path.join(picoRoot, "pico.min.css"), path.join(vendorDirectory, "pico.min.css")),
  copyFile(path.join(fullCalendarRoot, "all", "global.js"), path.join(vendorDirectory, "fullcalendar.js")),
  copyFile(path.join(fullCalendarRoot, "skeleton.css"), path.join(vendorDirectory, "fullcalendar.css")),
  copyFile(path.join(fullCalendarRoot, "themes", "classic", "global.js"), path.join(vendorDirectory, "fullcalendar-theme-classic.js")),
  copyFile(path.join(fullCalendarRoot, "themes", "classic", "theme.css"), path.join(vendorDirectory, "fullcalendar-theme-classic.css")),
  copyFile(path.join(fullCalendarRoot, "themes", "classic", "palette.css"), path.join(vendorDirectory, "fullcalendar-palette-classic.css")),
  copyFile(path.join(fullCalendarRoot, "locales", "pt-br", "global.js"), path.join(vendorDirectory, "fullcalendar-locale-pt-br.js")),
  copyFile(path.join(preactRoot, "dist", "preact.min.js"), path.join(vendorDirectory, "preact.min.js")),
  copyFile(path.join(preactRoot, "hooks", "dist", "hooks.umd.js"), path.join(vendorDirectory, "preact-hooks.umd.js")),
  copyFile(path.join(preactRoot, "jsx-runtime", "dist", "jsxRuntime.umd.js"), path.join(vendorDirectory, "preact-jsx-runtime.umd.js")),
  copyFile(path.join(preactRoot, "compat", "dist", "compat.umd.js"), path.join(vendorDirectory, "preact-compat.umd.js")),
  copyFile(path.join(preactSignalsCoreRoot, "dist", "signals-core.min.js"), path.join(vendorDirectory, "preact-signals-core.min.js")),
  copyFile(path.join(preactSignalsRoot, "dist", "signals.min.js"), path.join(vendorDirectory, "preact-signals.min.js")),
  copyFile(path.join(phosphorRoot, "style.css"), path.join(vendorDirectory, "phosphor.css")),
  copyFile(path.join(phosphorRoot, "Phosphor.woff2"), path.join(vendorDirectory, "Phosphor.woff2")),
  copyFile(path.join(scheduleXCalendarRoot, "core.umd.js"), path.join(vendorDirectory, "schedule-x-calendar.js")),
  copyFile(path.join(scheduleXEventsRoot, "core.umd.js"), path.join(vendorDirectory, "schedule-x-events.js")),
  copyFile(path.join(scheduleXControlsRoot, "core.umd.js"), path.join(vendorDirectory, "schedule-x-controls.js")),
  copyFile(path.join(scheduleXThemeRoot, "index.css"), path.join(vendorDirectory, "schedule-x.css")),
]);

console.log("Site assets built: Pico, FullCalendar and Schedule-X local bundles ready.");
