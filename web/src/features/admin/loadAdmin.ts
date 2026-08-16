import { loadAuthFeature } from "../auth/loadAuth";

export async function loadAdminFeature(): Promise<void> {
  await loadAuthFeature();
  await import("../../lib/api/client");
  await import("../../legacy/components.js");
  await import("../../legacy/admin-shell.js");
  await import("../../legacy/admin.js");
}
