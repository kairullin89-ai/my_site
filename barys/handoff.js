import { normalize } from "./text.js";

const NOT_LETTER = "[^\\p{L}\\p{N}_]";

export function wantsHuman(text) {
  const t = normalize(text);
  return new RegExp(
    [
      "связ",
      "свяж",
      "перевед",
      "соедини",
      "перезвон",
      "позвон",
      "напишите\\s*мне",
      "(?:к|ко|со?|нужен|нужна|нужно|позовите|позови|хочу)\\s+(?:человек|директор|менеджер|оператор)",
      "живой\\s*разговор",
      "не\\s*бот",
      "хочу\\s*(?:поговорить|обсудить)",
      "telegram",
      "телеграм",
      `(?:^|${NOT_LETTER})тг(?!\\p{L}|\\p{N}|_)`,
    ].join("|"),
    "iu"
  ).test(t);
}

export function looksLikeHandoff(reply) {
  const t = normalize(reply);
  return /перевед|подключу|соединю|передам|передать|направлю|направить|свяж\p{L}{0,12}\s+(?:вас\s+)?(?:с\s+)?(?:барыс|изим|ізім|директор|менеджер)/iu.test(
    t
  );
}

export function handoffText(topic) {
  const need = String(topic || "заказ / производство ЖБИ").trim().replace(/\s+/g, " ");
  const clipped = need.length > 180 ? `${need.slice(0, 180).trim()}…` : need;
  return ["Здравствуйте, Барыс! Запрос с сайта.", `Интересует: ${clipped}`].join("\n");
}

export function buildHandoffUrl(topic, contacts) {
  const base = String(contacts && contacts.whatsappUrl ? contacts.whatsappUrl : "").trim();
  if (!base) return "";
  return `${base}?text=${encodeURIComponent(handoffText(topic))}`;
}

export function buildTelegramUrl(topic, contacts) {
  const base = contacts.telegramUrl || "";
  if (!base) return "";
  return `${base}?text=${encodeURIComponent(handoffText(topic))}`;
}
