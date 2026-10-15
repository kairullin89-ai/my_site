import { normalize } from "../text.js";

const TEXT =
  "Отгрузка с завода. Сроки и доставка зависят от объёма и адреса — уточните в WhatsApp или в комментарии к заказу.";

export const deliverySkill = {
  id: "delivery",
  priority: 40,
  tools: [
    {
      name: "explain_delivery",
      description: "Как устроена отгрузка и доставка с завода ЖБИ.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  ],
  match(text) {
    if (!String(text || "").trim()) return null;
    if (/доставк|самовывоз|логистик|привез|отгруз/.test(normalize(text))) return {};
    return null;
  },
  run() {
    return { text: TEXT };
  },
};
