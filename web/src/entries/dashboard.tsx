import { createRoot } from "react-dom/client";
import { LegacyPage } from "../app/LegacyPage";
import template from "../templates/dashboard.html?raw";
import { loadDashboardFeature } from "../features/dashboard/loadDashboard";
import "@phosphor-icons/web/regular";
import "../styles/dashboard.css";

const loadController = loadDashboardFeature;

createRoot(document.getElementById("root")!).render(
  <LegacyPage template={template} loadController={loadController} />,
);
