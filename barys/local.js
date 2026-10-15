import { buildHandoffUrl, buildTelegramUrl, handoffText, looksLikeHandoff, wantsHuman } from "./handoff.js";
import { runLocal as dispatchLocal } from "./kernel.js";
import { catalogText } from "./skills/catalog.js";
import "./skills/index.js";
import { BARYS_GREETING } from "./skills/smalltalk.js";

export { BARYS_GREETING, buildHandoffUrl, buildTelegramUrl, catalogText, handoffText, looksLikeHandoff, wantsHuman };

export function createContext(input = {}) {
  const attachments = Array.isArray(input.attachments) ? input.attachments : [];
  const message = String(input.raw ?? input.message ?? "").trim();
  const raw = message || String(attachments[0]?.name || "").trim();
  return {
    raw,
    products: Array.isArray(input.products) ? input.products : [],
    currency: input.currency || "kzt",
    contacts: input.contacts || {},
    pricesIncludeVat: input.pricesIncludeVat === true,
    attachments,
  };
}

export function runLocal(input) {
  return dispatchLocal(createContext(input));
}

export function replyLocal(input) {
  return runLocal(input).text;
}
