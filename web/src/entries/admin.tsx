import { createRoot } from "react-dom/client";
import { LegacyPage } from "../app/LegacyPage";
import template from "../templates/admin.html?raw";
import { loadAdminFeature } from "../features/admin/loadAdmin";
import "@phosphor-icons/web/regular";
import "../styles/admin.css";

const loadController = loadAdminFeature;

createRoot(document.getElementById("root")!).render(
  <LegacyPage template={template} loadController={loadController} dispatchReadyEvent />,
);
