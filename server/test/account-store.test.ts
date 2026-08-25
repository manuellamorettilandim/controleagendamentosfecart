import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { AccountStore } from "../src/account-store.js";

test("AccountStore keeps separate CODEX_HOME paths and switches only the default", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "remote-codex-accounts-"));
  try {
    const store = new AccountStore(path.join(directory, "accounts.json"), path.join(directory, "accounts"));
    const primary = await store.ensurePrimary({ accountId: "primary", label: "Primary", codeHome: path.join(directory, "primary-home"), appServerPort: 4500 });
    const secondary = await store.add("Secondary");

    assert.equal(primary.accountId, "primary");
    assert.notEqual(primary.codeHome, secondary.codeHome);
    assert.notEqual(primary.appServerPort, secondary.appServerPort);
    assert.equal(await store.defaultId(), "primary");

    const primaryAgain = await store.ensurePrimary({ accountId: "primary", label: "Renamed primary", codeHome: path.join(directory, "other-home"), appServerPort: 4599 });
    assert.equal(primaryAgain.accountId, "primary");
    assert.equal((await store.list()).length, 2);
    assert.equal((await store.get(secondary.accountId))?.label, "Secondary");

    await store.setDefault(secondary.accountId);
    assert.equal(await store.defaultId(), secondary.accountId);
    assert.equal((await store.getDefault())?.accountId, secondary.accountId);
    await assert.rejects(() => store.setEnabled(secondary.accountId, false));

    await store.setDefault(primary.accountId);
    await assert.rejects(() => store.remove(primary.accountId), /conta padrão/i);
    await store.remove(secondary.accountId);
    assert.equal(await store.get(secondary.accountId), null);
    await assert.rejects(() => fs.access(secondary.codeHome));
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("AccountStore removes only the placeholder and promotes a real enabled account", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "remote-codex-placeholder-"));
  try {
    const store = new AccountStore(path.join(directory, "accounts.json"), path.join(directory, "accounts"));
    await store.ensurePrimary({ accountId: "primary", label: "Primary", codeHome: path.join(directory, "primary-home"), appServerPort: 4500 });
    const real = await store.add("Real account");

    const result = await store.removePlaceholder("primary");

    assert.deepEqual(result, { removed: true, defaultAccountId: real.accountId });
    assert.equal(await store.get("primary"), null);
    assert.equal((await store.getDefault())?.accountId, real.accountId);
    assert.equal((await store.list()).length, 1);
    await fs.access(real.codeHome);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
