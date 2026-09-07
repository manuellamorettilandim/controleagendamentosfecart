import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { resolveCodexBinary, resolveCodexSpawn } from "../src/codex-bin.js";

test("resolveCodexSpawn returns a valid command and boolean useShell", () => {
  const resolved = resolveCodexSpawn();
  assert.ok(typeof resolved.bin === "string" && resolved.bin.length > 0);
  assert.equal(typeof resolved.useShell, "boolean");

  const binary = resolveCodexBinary();
  assert.equal(binary, resolved.bin);
});

test("resolveCodexSpawn handles custom binary arguments", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bin-test-"));
  try {
    const fakeExe = path.join(tmpDir, process.platform === "win32" ? "fake-codex.exe" : "fake-codex");
    await fs.writeFile(fakeExe, "#!/bin/sh\nexit 0\n");

    const resolved = resolveCodexSpawn(fakeExe);
    assert.equal(resolved.bin, fakeExe);
    assert.equal(resolved.useShell, false);

    if (process.platform === "win32") {
      const fakeCmd = path.join(tmpDir, "fake-codex.cmd");
      await fs.writeFile(fakeCmd, "@echo off\nexit 0\n");
      const resolvedCmd = resolveCodexSpawn(fakeCmd);
      assert.equal(resolvedCmd.bin, fakeCmd);
      assert.equal(resolvedCmd.useShell, true);
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
});
