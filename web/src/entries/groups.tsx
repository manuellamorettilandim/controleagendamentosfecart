import { createRoot } from "react-dom/client";
import { LegacyPage } from "../app/LegacyPage";
import template from "../templates/groups.html?raw";
import { loadGroupsFeature } from "../features/groups/loadGroups";
import "@phosphor-icons/web/regular";
import "../styles/admin.css";
import "../styles/groups.css";

const loadController = loadGroupsFeature;

createRoot(document.getElementById("root")!).render(
  <LegacyPage template={template} loadController={loadController} dispatchReadyEvent />,
);
