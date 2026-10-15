import { currencyAsked, formatPrice } from "../money.js";
import { normalize } from "../text.js";

function usableProducts(products) {
  return (products || []).filter((product) => product && product.name);
}

function priceOf(product, currency, ctx) {
  const base = formatPrice(product.price, currency || "kzt");
  if (ctx && ctx.pricesIncludeVat === true && (currency || "kzt") === "kzt") return `${base} с НДС`;
  return base;
}

export function catalogText(products, currency) {
  const list = usableProducts(products);
  if (!list.length) return "Каталог пуст.";
  return list
    .map((p) => {
      const desc = p.description ? ` — ${p.description}` : "";
      return `• ${p.name}: ${priceOf(p, currency)} / ${p.unit || "шт"}${desc}`;
    })
    .join("\n");
}

function listProducts(products, currency, limit, ctx) {
  const list = usableProducts(products);
  if (!list.length) return "Сейчас в каталоге пусто. Загляните в раздел «Товары» позже.";
  const slice = list.slice(0, limit || 8);
  const lines = slice.map((p, i) => `${i + 1}. ${p.name} — ${priceOf(p, currency, ctx)} / ${p.unit || "шт"}`);
  const more =
    list.length > slice.length
      ? `\n\nВсего позиций: ${list.length}. Полный список — в разделе «Товары» на сайте.`
      : "";
  return `В каталоге сейчас:\n${lines.join("\n")}${more}`;
}

export function findProducts(query, products) {
  const q = normalize(query);
  const tokens = q.split(/[\s,./]+/).filter((t) => t.length > 2);
  return usableProducts(products).filter((p) => {
    const hay = normalize(`${p.name} ${p.description || ""} ${p.unit || ""}`);
    return tokens.some((t) => hay.includes(t)) || (q && hay.includes(q));
  });
}

function describeProduct(p, currency, ctx) {
  const desc = p.description ? `\n${p.description}` : "";
  return `${p.name}\nЦена: ${priceOf(p, currency, ctx)} за ${p.unit || "шт"}.${desc}`;
}

function searchText(query, products, currency, mode, ctx) {
  const matched = findProducts(query, products);
  if (mode === "name" && matched.length === 0) return null;
  if (matched.length === 1) {
    const tail =
      mode === "name"
        ? "\n\nЧтобы заказать — добавьте в корзину или напишите в WhatsApp."
        : "\n\nМогу подсказать ещё позиции или помочь с заказом.";
    return `${describeProduct(matched[0], currency, ctx)}${tail}`;
  }
  if (matched.length > 1) {
    const title = mode === "name" ? "Похожие позиции:" : "Нашёл несколько позиций:";
    const tail = mode === "name" ? "\n\nКакую именно интересует?" : "\n\nУточните название — расскажу подробнее.";
    return (
      title +
      "\n" +
      matched
        .slice(0, 5)
        .map((p) => `• ${p.name} — ${priceOf(p, currency, ctx)} / ${p.unit || "шт"}`)
        .join("\n") +
      tail
    );
  }
  if (mode === "price") {
    return listProducts(products, currency, 6, ctx) + "\n\nНапишите название изделия — дам точную цену.";
  }
  return `В каталоге нет точного совпадения.\n${listProducts(products, currency, 6, ctx)}`;
}

const listSchema = {
  type: "object",
  properties: {
    limit: { type: "integer", description: "Сколько позиций показать, от 1 до 20" },
  },
  additionalProperties: false,
};

const searchSchema = {
  type: "object",
  properties: {
    query: { type: "string", description: "Слова клиента: название изделия или вопрос о цене" },
  },
  required: ["query"],
  additionalProperties: false,
};

export const catalogSkill = {
  id: "catalog",
  priority: 60,
  tools: [
    {
      name: "list_catalog",
      description: "Список товаров каталога завода ЖБИ с ценами. Вызывай, когда клиент просит каталог, прайс, ассортимент или что есть в наличии.",
      parameters: listSchema,
    },
    {
      name: "search_products",
      description: "Найти изделия по словам клиента и вернуть точные цены из каталога. Вызывай на любой вопрос о цене или названии ЖБИ.",
      parameters: searchSchema,
    },
  ],
  match(text, ctx) {
    const t = normalize(text);
    if (!t) return null;
    if (/прайс|каталог|ассортимент|что\s*есть|какие\s*(?:товар|жби|издели)|список|номенклатур/.test(t)) {
      return { tool: "list_catalog", limit: 8 };
    }
    if (/цен|стоим|сколько|поч[её]м/.test(t)) {
      return { tool: "search_products", query: text, mode: "price" };
    }
    if (findProducts(text, ctx?.products || []).length) {
      return { tool: "search_products", query: text, mode: "name" };
    }
    return null;
  },
  run(args, ctx) {
    const products = ctx.products || [];
    const currency = currencyAsked(ctx.raw) || ctx.currency || "kzt";
    const tool = args.tool;
    if (tool === "list_catalog" || args.mode === "list") {
      const limit = Math.min(20, Math.max(1, Number(args.limit) || 8));
      return { text: listProducts(products, currency, limit, ctx), source: "catalog" };
    }
    const mode = args.mode || "tool";
    const query = args.query || ctx.raw || "";
    const text = searchText(query, products, currency, mode, ctx);
    if (!text) return null;
    return { text, source: "catalog" };
  },
};
