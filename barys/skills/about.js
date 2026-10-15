import { normalize } from "../text.js";
import { findProducts } from "./catalog.js";

const TEXT =
  "Барыс. Фокус: железобетон любой сложности, ритм цеха, рост выпуска и качество для стройки.";

export const aboutSkill = {
  id: "about",
  priority: 55,
  tools: [
    {
      name: "about_factory",
      description: "Кто такой Барыс и чем занимается завод ЖБИ.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  ],
  match(text, ctx) {
    const t = normalize(text);
    if (!t) return null;
    if (/цен|стоим|сколько|поч[её]м|прайс|каталог|ассортимент|какие\s|что\s*есть|доставк|заказ|куп|корзин/.test(t)) return null;
    if (findProducts(text, ctx?.products || []).length) return null;
    if (/чем\s*занима|о\s+заводе|про\s+завод|ваш\s+завод|о\s+производств|кто\s+(?:такой\s+)?(?:ізім|изим)/.test(t)) return {};
    if (/^(?:завод|производство)$/.test(t)) return {};
    return null;
  },
  run() {
    return { text: TEXT };
  },
};
