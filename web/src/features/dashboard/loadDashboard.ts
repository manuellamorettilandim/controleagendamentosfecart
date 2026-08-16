import "../../lib/fullcalendar";
import { loadAuthFeature } from "../auth/loadAuth";

export async function loadDashboardFeature(): Promise<void> {
  await loadAuthFeature();
  await import("../../lib/api/client");
  await import("../../legacy/components.js");
  await import("../../legacy/calendar.js");
  await import("../../legacy/dashboard.js");
}
