import { createRoot } from "react-dom/client";
import { LegacyPage } from "../app/LegacyPage";
import template from "../templates/login.html?raw";
import { loadAuthFeature } from "../features/auth/loadAuth";
import "@phosphor-icons/web/regular";
import "../styles/login.css";

const loadController = async () => {
  await loadAuthFeature();
  await import("../legacy/login.js");
};

createRoot(document.getElementById("root")!).render(
  <LegacyPage template={template} loadController={loadController} />,
);
