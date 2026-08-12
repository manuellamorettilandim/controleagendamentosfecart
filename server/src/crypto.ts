import crypto from "node:crypto";

export const ACCESS_TOKEN_BYTES = 32;

export function createOpaqueToken(): string {
  return crypto.randomBytes(ACCESS_TOKEN_BYTES).toString("base64url");
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

export function hashesEqual(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) {
    return false;
  }

  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

const TTL_UNITS: Record<string, number> = {
  m: 60_000,
  min: 60_000,
  h: 60 * 60_000,
  d: 24 * 60 * 60_000,
  w: 7 * 24 * 60 * 60_000,
};

export function parseTtl(input: string): number {
  const match = /^(\d+)\s*(m|min|h|d|w)$/i.exec(input.trim());
  if (!match) {
    throw new Error("TTL inválido. Use um formato como 30d, 12h ou 90min.");
  }

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const milliseconds = amount * TTL_UNITS[unit];

  if (!Number.isSafeInteger(milliseconds) || milliseconds < 60_000) {
    throw new Error("O TTL deve ser de pelo menos 1 minuto.");
  }

  const maxTtl = 365 * 24 * 60 * 60_000;
  if (milliseconds > maxTtl) {
    throw new Error("O TTL máximo é 365 dias.");
  }

  return milliseconds;
}
