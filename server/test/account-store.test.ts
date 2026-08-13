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

    await store.setDefault(secondary.accountId);
    assert.equal(await store.defaultId(), secondary.accountId);
    assert.equal((await store.getDefault())?.accountId, secondary.accountId);
    await assert.rejects(() => store.setEnabled(secondary.accountId, false));
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
