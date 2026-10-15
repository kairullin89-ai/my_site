import { normalize } from "../text.js";
import { findProducts } from "./catalog.js";

const GENERIC = /^(?:цена|цены|цену|стоит|стоят|сколько|почем|почём|тенге|доллар|доллара|доллары|рубль|рубля|рублей|валюта|валюте|валюты|курс|курса|этот|эта|это|мне|для)$/u;

function asksAboutProduct(text, products) {
  const tokens = normalize(text)
    .split(/[\s,./]+/)
    .filter((token) => token.length > 2 && !GENERIC.test(token));
  if (!tokens.length) return false;
  return findProducts(tokens.join(" "), products).length > 0;
}

const TEXT = "Цены можно смотреть в ₸, $ или ₽ — переключатель в блоке «Товары». Базовая валюта каталога — тенге.";

export const currencySkill = {
  id: "currency",
  priority: 50,
  tools: [
    {
      name: "explain_currency",
      description: "В каких валютах показаны цены каталога и какая валюта базовая.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  ],
  match(text, ctx) {
    const t = normalize(text);
    if (!t || !/валют|тенге|доллар|рубл|курс/.test(t)) return null;
    if (asksAboutProduct(text, ctx?.products || [])) return null;
    return {};
  },
  run() {
    return { text: TEXT };
  },
};
