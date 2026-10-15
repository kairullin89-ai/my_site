import { normalize } from "../text.js";

function render(ctx) {
  const contacts = ctx.contacts || {};
  const whatsapp = String(contacts.whatsappUrl || "").trim();
  const telegram = String(contacts.telegramUrl || "").trim();
  const direct = [whatsapp && `WhatsApp ${whatsapp}`, telegram && `Telegram ${telegram}`].filter(Boolean).join(" или ");
  return {
    text:
      "Можно двумя путями:\n" +
      "1) Корзина на сайте → заявка уйдёт Барысу в WhatsApp.\n" +
      (direct ? `2) Сразу написать Барысу: ${direct}\n` : "2) Контакты для прямой связи сейчас не настроены.\n") +
      "Если заказ крупный или нестандартный — лучше сразу к Барысу, я подготовлю переход.",
  };
}

export const orderSkill = {
  id: "order",
  priority: 30,
  tools: [
    {
      name: "explain_order",
      description: "Как оформить заказ ЖБИ: корзина на сайте или сообщение Барысу.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  ],
  match(text) {
    if (!String(text || "").trim()) return null;
    if (/заказ|заявк|оформить|купить|корзин/.test(normalize(text))) return {};
    return null;
  },
  run(_args, ctx) {
    return render(ctx);
  },
};
