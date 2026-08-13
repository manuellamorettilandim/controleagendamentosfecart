import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { AccessStore } from "../src/access-store.js";
import { hashToken, parseTtl } from "../src/crypto.js";

test("AccessStore issues concurrent device tokens and persists only hashes", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "remote-codex-access-"));
  const filePath = path.join(directory, "remote-access.json");
  try {
    const store = new AccessStore(filePath);
    const now = new Date("2026-08-12T12:00:00.000Z");
    const issued = await Promise.all([
      store.issue("notebook", parseTtl("30d"), now),
      store.issue("desktop", parseTtl("12h"), now),
      store.issue("tablet", parseTtl("7d"), now),
    ]);

    assert.equal(new Set(issued.map(({ device }) => device.deviceId)).size, 3);
    assert.equal(new Set(issued.map(({ token }) => token)).size, 3);

    const raw = await fs.readFile(filePath, "utf8");
    for (const { token, device } of issued) {
      assert.match(raw, new RegExp(device.tokenHash));
      assert.equal(raw.includes(token), false);
    assert.equal(device.tokenHash, hashToken(token));
    }

    const revoked = await store.revoke(issued[0].device.deviceId, new Date("2026-08-12T13:00:00.000Z"));
    assert.equal(revoked?.revokedAt, "2026-08-12T13:00:00.000Z");
    assert.equal((await store.active(new Date("2026-08-12T13:00:00.000Z"))).length, 2);

    const disabled = await store.disable(issued[1].device.deviceId, new Date("2026-08-12T13:30:00.000Z"));
    assert.equal(disabled?.disabledAt, "2026-08-12T13:30:00.000Z");
    assert.equal((await store.active(new Date("2026-08-12T13:30:00.000Z"))).length, 1);
    const enabled = await store.enable(issued[1].device.deviceId, new Date("2026-08-12T13:45:00.000Z"));
    assert.equal(enabled?.disabledAt, null);
    assert.equal((await store.active(new Date("2026-08-12T13:45:00.000Z"))).length, 2);

    const expired = await store.active(new Date("2026-09-12T12:01:00.000Z"));
    assert.equal(expired.length, 0);

    assert.equal(await store.revokeAll(new Date("2026-08-12T14:00:00.000Z")), 2);
    assert.equal((await store.list()).filter((device) => device.revokedAt !== null).length, 3);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("AccessStore persists sanitized reservation ownership metadata", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "remote-codex-session-"));
  try {
    const store = new AccessStore(path.join(directory, "access.json"));
    const issued = await store.issue("Sessão teste", 3_600_000, new Date("2026-08-13T12:00:00.000Z"), {
      accountId: "primary",
      userId: "user-123",
      reservationId: "reservation-123",
      quotaBaseUsedPercent: 18.5,
      quotaBudgetPercent: 5,
    });
    const stored = (await store.list()).at(-1);
    assert.equal(stored?.userId, "user-123");
    assert.equal(stored?.reservationId, "reservation-123");
    assert.equal(stored?.quotaBaseUsedPercent, 18.5);
    assert.equal(stored?.quotaBudgetPercent, 5);
    assert.notEqual(stored?.tokenHash, issued.token);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("AccessStore enforces a session quota as delta, including after account reset", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "remote-codex-quota-"));
  try {
    const store = new AccessStore(path.join(directory, "access.json"));
    const issued = await store.issue("scheduled session", 3_600_000, new Date("2026-08-13T12:00:00.000Z"), {
      accountId: "primary",
      quotaBaseUsedPercent: 80,
      quotaBudgetPercent: 5,
      weeklyLimitPercent: 85,
    });
    await store.updateAccountLimit("primary", 84.9, 10_080, 1_800_000_000);
    assert.equal((await store.list()).find((device) => device.deviceId === issued.device.deviceId)?.usage.usageLimitReachedAt, null);
    await store.updateAccountLimit("primary", 85, 10_080, 1_800_000_000, new Date("2026-08-13T12:10:00.000Z"));
    assert.equal((await store.list()).find((device) => device.deviceId === issued.device.deviceId)?.usage.usageLimitReachedAt, "2026-08-13T12:10:00.000Z");

    await store.updateAccountLimit("primary", 4.9, 10_080, 1_800_604_800);
    assert.equal((await store.list()).find((device) => device.deviceId === issued.device.deviceId)?.usage.usageLimitReachedAt, null);
    await store.updateAccountLimit("primary", 5, 10_080, 1_800_604_800, new Date("2026-08-13T12:20:00.000Z"));
    assert.equal((await store.list()).find((device) => device.deviceId === issued.device.deviceId)?.usage.usageLimitReachedAt, "2026-08-13T12:20:00.000Z");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("parseTtl accepts supported units and rejects unsafe ranges", () => {
  assert.equal(parseTtl("30d"), 30 * 24 * 60 * 60_000);
  assert.equal(parseTtl("12h"), 12 * 60 * 60_000);
  assert.throws(() => parseTtl("0d"));
  assert.throws(() => parseTtl("400d"));
  assert.throws(() => parseTtl("30 months"));
});

test("AccessStore binds one token per account, records observed usage, and keeps revocations", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "remote-codex-device-policy-"));
  try {
    const store = new AccessStore(path.join(directory, "remote-access.json"));
    const issued = await store.issue("notebook", 7 * 24 * 60 * 60_000, new Date("2026-08-12T12:00:00.000Z"), {
      accountId: "primary",
      weeklyLimitPercent: 40,
    });
    assert.equal(issued.device.accountId, "primary");
    assert.equal(issued.device.weeklyLimitPercent, 40);
    await assert.rejects(() => store.issue("duplicate", 60 * 60_000, new Date("2026-08-12T12:01:00.000Z"), { accountId: "primary" }));

    await store.recordUsage("device-does-not-exist", {
      threadId: "thread-1",
      total: { totalTokens: 10, inputTokens: 8, cachedInputTokens: 1, outputTokens: 2, reasoningOutputTokens: 0 },
      last: null,
      accountUsedPercent: 10,
      accountWindowDurationMins: 10_080,
      accountResetsAt: 1_800_000_000,
    }, new Date("2026-08-12T12:00:00.000Z"));
    const first = await store.recordUsage(issued.device.deviceId, {
      threadId: "thread-1",
      total: { totalTokens: 100, inputTokens: 80, cachedInputTokens: 10, outputTokens: 20, reasoningOutputTokens: 5 },
      last: { totalTokens: 100, inputTokens: 80, cachedInputTokens: 10, outputTokens: 20, reasoningOutputTokens: 5 },
      accountUsedPercent: 12,
      accountWindowDurationMins: 10_080,
      accountResetsAt: 1_800_000_000,
    }, new Date("2026-08-12T12:00:00.000Z"));
    assert.equal(first?.usage.observedTokens, 100);
    assert.equal(first?.usage.observedOutputTokens, 20);

    const repeated = await store.recordUsage(issued.device.deviceId, {
      threadId: "thread-1",
      total: { totalTokens: 100, inputTokens: 80, cachedInputTokens: 10, outputTokens: 20, reasoningOutputTokens: 5 },
      last: null,
      accountUsedPercent: 12,
      accountWindowDurationMins: 10_080,
      accountResetsAt: 1_800_000_000,
    }, new Date("2026-08-12T12:00:00.000Z"));
    assert.equal(repeated?.usage.observedTokens, 100);

    const next = await store.recordUsage(issued.device.deviceId, {
      threadId: "thread-1",
      total: { totalTokens: 150, inputTokens: 120, cachedInputTokens: 15, outputTokens: 30, reasoningOutputTokens: 8 },
      last: null,
      accountUsedPercent: 41,
      accountWindowDurationMins: 10_080,
      accountResetsAt: 1_800_000_000,
    }, new Date("2026-08-12T12:00:00.000Z"));
    assert.equal(next?.usage.observedTokens, 150);
    assert.equal(next?.usage.usageLimitReachedAt, "2026-08-12T12:00:00.000Z");

    const changed = await store.updatePolicy(issued.device.deviceId, { weeklyLimitPercent: 50 });
    assert.equal(changed?.weeklyLimitPercent, 50);
    const revoked = await store.revoke(issued.device.deviceId);
    assert.ok(revoked?.revokedAt);
    assert.equal((await store.list()).length, 1);
    assert.equal((await store.enable(issued.device.deviceId)), null);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
