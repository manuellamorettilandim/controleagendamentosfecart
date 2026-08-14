import { mkdir, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fullCalendarRoot = path.join(projectRoot, "node_modules", "fullcalendar");
const vendorDirectory = path.join(projectRoot, "site", "vendor");

await mkdir(vendorDirectory, { recursive: true });
await Promise.all([
  copyFile(path.join(fullCalendarRoot, "all", "global.js"), path.join(vendorDirectory, "fullcalendar.js")),
  copyFile(path.join(fullCalendarRoot, "skeleton.css"), path.join(vendorDirectory, "fullcalendar.css")),
  copyFile(path.join(fullCalendarRoot, "themes", "classic", "global.js"), path.join(vendorDirectory, "fullcalendar-theme-classic.js")),
  copyFile(path.join(fullCalendarRoot, "themes", "classic", "theme.css"), path.join(vendorDirectory, "fullcalendar-theme-classic.css")),
  copyFile(path.join(fullCalendarRoot, "themes", "classic", "palette.css"), path.join(vendorDirectory, "fullcalendar-palette-classic.css")),
  copyFile(path.join(fullCalendarRoot, "locales", "pt-br", "global.js"), path.join(vendorDirectory, "fullcalendar-locale-pt-br.js")),
]);

console.log("Site assets built: FullCalendar local bundle ready.");
