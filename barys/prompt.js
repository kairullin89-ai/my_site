import fs from "node:fs";
import path from "node:path";

function fill(template, key, value) {
  return String(template).split(key).join(value ?? "");
}

export function loadSystemPrompt(root, contacts = {}) {
  const file = path.join(root, "barys-system.txt");
  const whatsapp = String(contacts.whatsappUrl || "").trim();
  const email = String(contacts.email || "").trim();
  const telegramUrl = contacts.telegramUrl || "";
  const telegramLine = telegramUrl ? `Telegram Барыса: ${telegramUrl}` : "";
  const telegramHandoff = telegramUrl
    ? `   - дай кликабельную ссылку Telegram ровно в виде ${telegramUrl}`
    : "";

  let system = "";
  if (fs.existsSync(file)) {
    system = fs.readFileSync(file, "utf8");
  } else {
    system = `Ты Барыс, AI-консультант завода ЖБИ. Отвечай на русском. WhatsApp: ${whatsapp}. Почта: ${email}.`;
  }

  return fill(
    fill(
      fill(fill(fill(system, "{{WHATSAPP}}", whatsapp), "{{TELEGRAM_LINE}}", telegramLine), "{{TELEGRAM_HANDOFF}}", telegramHandoff),
      "{{EMAIL}}",
      email
    ),
    "{{CATALOG}}",
    "Цены только через инструменты list_catalog и search_products."
  );
}
