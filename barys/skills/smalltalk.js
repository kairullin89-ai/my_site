import { normalize } from "../text.js";

const GREETING = /^(?:добрый\s+(?:день|вечер|утро)|доброе\s+утро|здравствуйте|здравствуй|привет|салам|салем|hello|hi)(?=$|[\s!.,?;:)])/u;

function greetingOnly(text) {
  const match = GREETING.exec(text);
  if (!match) return false;
  const rest = text.slice(match[0].length).replace(/^[\s!.,?;:)]+/, "").trim();
  return !rest || /^(?:барыс|изим|ізім)$/u.test(rest);
}

export const BARYS_GREETING =
  "Сәлем! Я Барыс — AI-консультант завода ЖБИ. Подскажу по каталогу и ценам; если нужен живой разговор — спокойно переведу на Барыса в WhatsApp или Telegram. Можно прикрепить файл или фото кнопкой +.";

export const smalltalkSkill = {
  id: "smalltalk",
  priority: 10,
  tools: [],
  match(text) {
    const t = normalize(text);
    if (!t) return { intent: "empty" };
    if (greetingOnly(t)) return { intent: "hello" };
    if (/как\s*(ты|дела|сам)|что\s*нового|how\s*are\s*you/.test(t)) return { intent: "mood" };
    if (/кто\s*(ты|вы|барыс)|тво[её]\s*имя|как\s*тебя\s*зовут/.test(t)) return { intent: "who" };
    return null;
  },
  run(args) {
    if (args.intent === "empty") return { text: "Напишите вопрос — про плиты, бетон, цены или заказ." };
    if (args.intent === "hello") return { text: "Привет! Чем помочь: каталог, цены, доставка или связь с Барысом?" };
    if (args.intent === "mood") {
      return { text: "В порядке — на связи и готов помочь по ЖБИ. Что нужно: цена, каталог или связать с Барысом?" };
    }
    if (args.intent === "who") {
      return { text: "Я Барыс — AI-консультант завода ЖБИ на сайте Барыс. Подскажу по изделиям и оформлению заказа." };
    }
    return null;
  },
};

export const smalltalkCloseSkill = {
  id: "smalltalk-close",
  priority: 80,
  tools: [],
  match(text) {
    const t = normalize(text);
    if (!t) return null;
    if (/спасибо|рахмет|благодар/.test(t)) return { intent: "thanks" };
    if (/помоги|что\s*умеешь|как\s*работ/.test(t)) return { intent: "help" };
    return null;
  },
  run(args) {
    if (args.intent === "thanks") return { text: "Пожалуйста. Если понадобится — я здесь, в правом нижнем углу." };
    if (args.intent === "help") {
      return {
        text: "Могу: каталог и цены, изделие по названию, оформление заказа. Для ответа директора нажмите кнопку WhatsApp или Telegram. Спросите, например: «плита перекрытия» или «сколько стоит свая».",
      };
    }
    return null;
  },
};
