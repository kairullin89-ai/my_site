import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  createAdminSession,
  dropAdminSession,
  isAdminCredential,
  sessionValid,
} from "./adminAuth.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("admin session is issued only for the env password", () => {
  const env = { ADMIN_PASSWORD: "secret" };
  assert.equal(createAdminSession(env, "nope"), null);
  assert.equal(createAdminSession({ ADMIN_PASSWORD: "" }, "secret"), null);
  const token = createAdminSession(env, "secret");
  assert.equal(typeof token, "string");
  assert.equal(token.includes("secret"), false);
  assert.equal(sessionValid(token), true);
  assert.equal(isAdminCredential(env, token, null), true);
  assert.equal(isAdminCredential(env, "secret", null), true);
  assert.equal(isAdminCredential(env, "nope", { password: "secret" }), true);
  assert.equal(isAdminCredential(env, "", {}), false);
  assert.equal(isAdminCredential({ ADMIN_PASSWORD: "" }, "secret", {}), false);
  dropAdminSession(token);
  assert.equal(sessionValid(token), false);
  assert.equal(isAdminCredential(env, token, null), false);
  const tokens = [];
  for (let index = 0; index < 40; index += 1) tokens.push(createAdminSession(env, "secret"));
  assert.equal(sessionValid(tokens[0]), false);
  assert.equal(sessionValid(tokens[39]), true);
  for (const item of tokens) dropAdminSession(item);
});

test("storefront source does not embed an admin password", () => {
  const store = fs.readFileSync(path.join(root, "src", "lib", "store.js"), "utf8");
  assert.equal(store.includes("ADMIN_PASSWORD"), false);
  assert.equal(store.includes("izim_admin_auth"), true);
});
