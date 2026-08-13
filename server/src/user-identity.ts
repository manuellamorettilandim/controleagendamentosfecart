import crypto from "node:crypto";

export function normalizeUsername(username: string): string {
  return username.normalize("NFKC").trim().toLowerCase();
}

export function loginEmailForUsername(username: string): string {
  const normalized = normalizeUsername(username);
  if (!normalized) throw new Error("Nome de usuário vazio.");
  const digest = crypto.createHash("sha256").update(normalized, "utf8").digest("hex");
  return `user-${digest}@remote-codex.invalid`;
}
