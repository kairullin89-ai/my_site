import { wantsHuman } from "../handoff.js";
import { normalize } from "../text.js";

function contactsOf(ctx) {
  const contacts = ctx.contacts || {};
  return {
    whatsapp: String(contacts.whatsappUrl || "").trim(),
    telegram: String(contacts.telegramUrl || "").trim(),
    email: String(contacts.email || "").trim(),
  };
}

function render(ctx, topic) {
  const { whatsapp, telegram, email } = contactsOf(ctx);
  const lines = ["Могу сразу перевести вас на Барыса — директора по производству.", "Кратко напишите, что нужно (изделие, объём, город) — или жмите кнопку ниже, я уже подставлю текст."];
  if (whatsapp) lines.push(`WhatsApp: ${whatsapp}`);
  if (telegram) lines.push(`Telegram: ${telegram}`);
  if (email) lines.push(`Почта: ${email}`);
  if (!whatsapp && !telegram && !email) lines.push("Контакты сейчас не настроены.");
  return {
    text: lines.join("\n"),
    handoff: true,
    topic: String(topic || ctx.raw || "").trim(),
  };
}

export const contactsSkill = {
  id: "contacts",
  priority: 20,
  tools: [
    {
      name: "handoff_to_izim",
      description:
        "Контакты Барыса и перевод на живой разговор. Вызывай, когда клиент просит человека, директора, менеджера, WhatsApp, Telegram, почту, звонок или нестандартный заказ.",
      parameters: {
        type: "object",
        properties: {
          topic: { type: "string", description: "Кратко, что нужно клиенту" },
        },
        additionalProperties: false,
      },
    },
  ],
  match(text) {
    if (!String(text || "").trim()) return null;
    if (
      wantsHuman(text) ||
      /контакт|связ|свяж|телефон|whatsapp|ватсап|вацап|почт|email|мейл|написать\s+(?:вам|тебе|мне|барыс|изим|ізім|на\s+почт|в\s+)/.test(
        normalize(text)
      )
    ) {
      return { topic: text };
    }
    return null;
  },
  run(args, ctx) {
    return render(ctx, args.topic || ctx.raw);
  },
};
