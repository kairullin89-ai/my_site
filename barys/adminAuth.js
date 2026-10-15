import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const sessions = new Map();
const SESSION_MS = 12 * 60 * 60 * 1000;
const SESSION_CAP = 32;

function pruneSessions() {
  const now = Date.now();
  for (const [token, expires] of sessions) {
    if (expires < now) sessions.delete(token);
  }
  while (sessions.size > SESSION_CAP) {
    const oldest = sessions.keys().next().value;
    sessions.delete(oldest);
  }
}

function digest(value) {
  return createHash("sha256").update(String(value), "utf8").digest();
}

export function passwordsMatch(input, expected) {
  return timingSafeEqual(digest(input), digest(expected));
}

export function sessionValid(token) {
  const key = String(token || "").trim();
  if (!key) return false;
  const expires = sessions.get(key);
  if (!expires) return false;
  if (expires < Date.now()) {
    sessions.delete(key);
    return false;
  }
  return true;
}

export function createAdminSession(env, password) {
  const expected = String((env && env.ADMIN_PASSWORD) || "").trim();
  const given = password == null ? "" : String(password).trim();
  if (!expected || !passwordsMatch(given, expected)) return null;
  const token = randomBytes(32).toString("hex");
  sessions.set(token, Date.now() + SESSION_MS);
  pruneSessions();
  return token;
}

export function dropAdminSession(token) {
  sessions.delete(String(token || "").trim());
}

export function isAdminCredential(env, header, body) {
  const expected = String((env && env.ADMIN_PASSWORD) || "").trim();
  if (!expected) return false;
  const fromHeader = Array.isArray(header) ? header[0] : header;
  const headerText = fromHeader == null ? "" : String(fromHeader).trim();
  if (headerText && passwordsMatch(headerText, expected)) return true;
  if (headerText && sessionValid(headerText)) return true;
  const fromBody = body && body.password != null ? String(body.password).trim() : "";
  if (fromBody && passwordsMatch(fromBody, expected)) return true;
  return false;
}
