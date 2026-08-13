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

test("parseTtl accepts supported units and rejects unsafe ranges", () => {
  assert.equal(parseTtl("30d"), 30 * 24 * 60 * 60_000);
  assert.equal(parseTtl("12h"), 12 * 60 * 60_000);
  assert.throws(() => parseTtl("0d"));
  assert.throws(() => parseTtl("400d"));
  assert.throws(() => parseTtl("30 months"));
});
