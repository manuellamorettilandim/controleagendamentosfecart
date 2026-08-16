import { createRoot } from "react-dom/client";
import { LegacyPage } from "../app/LegacyPage";
import template from "../templates/telemetry.html?raw";
import { loadTelemetryFeature } from "../features/telemetry/loadTelemetry";
import "@phosphor-icons/web/regular";
import "../styles/admin.css";
import "../styles/telemetry.css";

createRoot(document.getElementById("root")!).render(
  <LegacyPage template={template} loadController={loadTelemetryFeature} dispatchReadyEvent />,
);
