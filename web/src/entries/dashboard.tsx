import { createRoot } from "react-dom/client";
import { DashboardApp } from "../app/DashboardApp";
import "@phosphor-icons/web/regular";
import "../styles/tokens.css";
import "../styles/design-system.css";
import "../styles/guides.css";

const rootElement = document.getElementById("root");
if (rootElement) {
  createRoot(rootElement).render(<DashboardApp />);
}
