import { loadAuthFeature } from "../auth/loadAuth";

export async function loadGroupsFeature(): Promise<void> {
  await loadAuthFeature();
  await import("../../legacy/components.js");
  await import("../../legacy/admin-shell.js");
  await import("../../legacy/groups.js");
}
