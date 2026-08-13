import assert from "node:assert/strict";
import test from "node:test";

import { loginEmailForUsername, normalizeUsername } from "../src/user-identity.js";

test("legacy usernames map deterministically to non-disclosing auth emails", () => {
  assert.equal(normalizeUsername("  Inteligência "), "inteligência");
  assert.equal(loginEmailForUsername("Equipe X"), loginEmailForUsername(" equipe x "));
  assert.match(loginEmailForUsername("Equipe X"), /^user-[a-f0-9]{64}@remote-codex\.invalid$/);
  assert.equal(loginEmailForUsername("Equipe X").includes("equipe"), false);
});
