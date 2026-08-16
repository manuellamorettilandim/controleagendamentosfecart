import { loadAuthFeature } from "../auth/loadAuth";

export async function loadTelemetryFeature(): Promise<void> {
  await loadAuthFeature();
  await import("../../lib/api/client");
  await import("../../legacy/components.js");
  await import("../../legacy/admin-shell.js");
  await import("../../legacy/telemetry.js");
}
