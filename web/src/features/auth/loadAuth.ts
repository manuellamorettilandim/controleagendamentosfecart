export async function loadAuthFeature(): Promise<void> {
  await import("../../legacy/auth.js");
}
