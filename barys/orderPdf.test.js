import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { closeDatabase, getOrder, importStoredOrder, openDatabase } from "./db.js";
import {
  handleOrderPdfRequest,
  orderFileName,
  parseOrderRequest,
  printableOrder,
  renderOrderPdf,
} from "./pdf/orderTemplate.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(new URL("./pdf/orderTemplate.js", import.meta.url), "utf8");

function pagesOf(buffer) {
  const text = buffer.toString("latin1");
  const found = text.match(/\/Type\s*\/Page(?!s)/g);
  return found ? found.length : 0;
}

function textBottoms(buffer) {
  const raw = buffer.toString("latin1");
  const bottoms = [];
  const reStream = /stream\r?\n/g;
  let match = reStream.exec(raw);
  while (match) {
    const from = match.index + match[0].length;
    const head = raw.slice(Math.max(0, match.index - 400), match.index);
    const lengthMatch = /\/Length\s+(\d+)/.exec(head);
    if (lengthMatch) {
      const data = Buffer.from(raw.slice(from, from + Number(lengthMatch[1])), "latin1");
      let text = "";
      try {
        text = (/FlateDecode/.test(head) ? zlib.inflateSync(data) : data).toString("latin1");
      } catch {
        text = "";
      }
      const re = /1 0 0 1 ([0-9.]+) ([0-9.]+) Tm/g;
      let point = re.exec(text);
      while (point) {
        bottoms.push(Number(point[2]));
        point = re.exec(text);
      }
    }
    match = reStream.exec(raw);
  }
  return bottoms;
}

function pdfText(buffer) {
  const raw = buffer.toString("latin1");
  const parts = [];
  const re = /stream\r?\n/g;
  let match = re.exec(raw);
  while (match) {
    const from = match.index + match[0].length;
    const head = raw.slice(Math.max(0, match.index - 400), match.index);
    const lengthMatch = /\/Length\s+(\d+)/.exec(head);
    if (lengthMatch) {
      const data = Buffer.from(raw.slice(from, from + Number(lengthMatch[1])), "latin1");
      try {
        parts.push((/FlateDecode/.test(head) ? zlib.inflateSync(data) : data).toString("latin1"));
      } catch {
        /* skip a stream that is not text */
      }
    }
    match = re.exec(raw);
  }
  return parts.join("\n").toUpperCase();
}

function order(partial = {}) {
  return {
    id: "o1k2abc",
    createdAt: "2026-10-01T08:00:00.000Z",
    name: "Иван Иванов",
    phone: "+7 701 000 00 00",
    comment: "",
    currency: "kzt",
    total: "STORED-TOTAL-88",
    channel: "whatsapp",
    status: "new",
    items: [
      {
        name: "Плита перекрытия ПК 60-15",
        unit: "шт",
        qty: 2,
        price: "STORED-PRICE-77",
        lineTotal: "STORED-LINE-77",
        currentPrice: "999 999",
      },
    ],
    ...partial,
  };
}

function assertPdf(buffer) {
  assert.equal(buffer.subarray(0, 5).toString("latin1"), "%PDF-");
  assert.ok(buffer.includes(Buffer.from("%%EOF")));
  const bottoms = textBottoms(buffer);
  assert.ok(bottoms.length > 4);
  for (const y of bottoms) assert.ok(y >= 36 && y <= 810, `text y ${y}`);
}

test("шаблон заказа не пересчитывает цены и не выдумывает реквизиты", () => {
  assert.equal(source.includes("money.js"), false);
  assert.equal(source.includes("formatPrice"), false);
  assert.equal(source.includes("НДС"), false);
  assert.equal(source.includes("Счёт-фактура"), false);
  assert.equal(source.includes("Способ оплаты"), false);
  const printed = printableOrder(order());
  assert.equal(printed.total, "STORED-TOTAL-88");
  assert.equal(printed.items[0].price, "STORED-PRICE-77");
  assert.equal(printed.items[0].lineTotal, "STORED-LINE-77");
  assert.equal(printed.items[0].currentPrice, undefined);
  assert.equal(printed.showComment, false);
  assert.deepEqual(
    printableOrder(
      order({
        items: [
          { name: "C", qty: 1, unit: "м³", price: "3", lineTotal: "3" },
          { name: "A", qty: 2, unit: "м²", price: "1", lineTotal: "2" },
        ],
      })
    ).items.map((item) => item.name),
    ["C", "A"]
  );
});

test("имя файла и проверка id", () => {
  assert.equal(orderFileName("o1k2abc"), "Order-o1k2abc.pdf");
  assert.equal(parseOrderRequest({}).error, "invalid id");
  assert.equal(parseOrderRequest({ id: "../.env" }).error, "invalid id");
  assert.equal(parseOrderRequest({ id: "a/b" }).error, "invalid id");
  assert.equal(parseOrderRequest({ id: "x".repeat(65) }).error, "invalid id");
  assert.equal(parseOrderRequest({ id: "o1k2abc", lang: "en" }).error, "invalid lang");
  assert.deepEqual(parseOrderRequest({ id: "o1k2abc" }), { id: "o1k2abc", lang: "ru" });
  assert.deepEqual(parseOrderRequest({ id: "o1k2abc", lang: "kk" }), { id: "o1k2abc", lang: "kk" });
});

test("доступ к заявке: 401, 400 и 404 без чтения чужого заказа", async () => {
  let reads = 0;
  const env = { ADMIN_PASSWORD: "secret" };
  const denied = await handleOrderPdfRequest({
    method: "GET",
    searchParams: new URLSearchParams({ id: "o1k2abc" }),
    adminHeader: "wrong",
    env,
    getOrderById() {
      reads += 1;
      return order();
    },
    root,
  });
  assert.equal(denied.status, 401);
  assert.equal(reads, 0);

  const missingPassword = await handleOrderPdfRequest({
    method: "GET",
    searchParams: new URLSearchParams({ id: "bad id" }),
    adminHeader: "",
    env,
    getOrderById() {
      reads += 1;
      return null;
    },
    root,
  });
  assert.equal(missingPassword.status, 401);
  assert.equal(reads, 0);

  const invalid = await handleOrderPdfRequest({
    method: "GET",
    searchParams: new URLSearchParams({ id: "../secret" }),
    adminHeader: "secret",
    env,
    getOrderById() {
      reads += 1;
      return order();
    },
    root,
  });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.json.error, "invalid id");
  assert.equal(reads, 0);

  const absent = await handleOrderPdfRequest({
    method: "GET",
    searchParams: new URLSearchParams({ id: "missing-order" }),
    adminHeader: "secret",
    env,
    getOrderById() {
      reads += 1;
      return null;
    },
    root,
  });
  assert.equal(absent.status, 404);
  assert.equal(absent.json.error, "Order not found");
  assert.equal(reads, 1);
});

test("сохранённый заказ печатается на русском и казахском", async () => {
  const ru = await renderOrderPdf({ order: order(), lang: "ru", root });
  assert.equal(ru.filename, "Order-o1k2abc.pdf");
  assertPdf(ru.buffer);
  assert.equal(pagesOf(ru.buffer), 1);

  const kk = await renderOrderPdf({
    order: order({ comment: "" }),
    lang: "kk",
    root,
  });
  assertPdf(kk.buffer);
  const text = pdfText(kk.buffer);
  for (const code of ["049A", "04E8", "0406"]) assert.equal(text.includes(code), true, code);
});

test("пустой комментарий не нужен, длинный переносится", async () => {
  const quiet = printableOrder(order({ comment: "   " }));
  assert.equal(quiet.showComment, false);
  const quietPdf = await renderOrderPdf({ order: order({ comment: "   " }), lang: "ru", root });
  assertPdf(quietPdf.buffer);

  const long = `Строка комментария к заявке.\n${"Очень длинный комментарий заказчика. ".repeat(80)}`;
  const loud = await renderOrderPdf({
    order: order({ comment: long, status: "done", channel: "telegram" }),
    lang: "ru",
    root,
  });
  assertPdf(loud.buffer);
  assert.equal(printableOrder(order({ comment: long })).showComment, true);
  assert.ok(pagesOf(loud.buffer) >= 1);
});

test("1, 5, 20 и 50 позиций, итог берётся из заказа", async () => {
  async function renderCount(count) {
    const items = Array.from({ length: count }, (_, index) => ({
      name: `Изделие ${index + 1} ${"железобетон ".repeat(index % 4 === 0 ? 6 : 1)}`.trim(),
      unit: index % 3 === 0 ? "м²" : index % 3 === 1 ? "м³" : "шт",
      qty: index + 1,
      price: `PRICE-${index}-NOT-RECALC`,
      lineTotal: `LINE-${index}-NOT-RECALC`,
    }));
    const body = order({
      id: `order${count}`,
      total: `TOTAL-${count}-SNAPSHOT`,
      items,
      comment: "",
    });
    const printed = printableOrder(body);
    assert.equal(printed.total, `TOTAL-${count}-SNAPSHOT`);
    assert.equal(printed.items[0].price, "PRICE-0-NOT-RECALC");
    assert.equal(printed.items[count - 1].lineTotal, `LINE-${count - 1}-NOT-RECALC`);
    assert.deepEqual(
      printed.items.map((item) => item.index),
      items.map((_, index) => index + 1)
    );
    const pdf = await renderOrderPdf({ order: body, lang: "ru", root });
    assertPdf(pdf.buffer);
    return pagesOf(pdf.buffer);
  }

  assert.equal(await renderCount(1), 1);
  assert.equal(await renderCount(5), 1);
  const pages20 = await renderCount(20);
  const pages50 = await renderCount(50);
  assert.ok(pages20 >= 1);
  assert.ok(pages50 > pages20);
  assert.ok(pages50 >= 2);
});

test("getOrder отдаёт снимок позиции без пересчёта", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "izim-order-pdf-"));
  const opened = openDatabase(dir);
  try {
    importStoredOrder(opened.db, {
      id: "order-snap",
      name: "Алия",
      phone: "87015554433",
      comment: "",
      currency: "usd",
      total: "HISTORICAL-TOTAL",
      channel: "telegram",
      status: "new",
      items: [
        { id: "p9", name: "Вторая", unit: "м²", qty: 4, price: "HISTORICAL-2", lineTotal: "HISTORICAL-LINE-2" },
        { id: "p1", name: "Первая", unit: "шт", qty: 2, price: "HISTORICAL-1", lineTotal: "HISTORICAL-LINE-1" },
      ],
    });
    assert.equal(getOrder(opened.db, "missing-order"), null);
    const saved = getOrder(opened.db, "order-snap");
    const printed = printableOrder(saved);
    assert.deepEqual(
      printed.items.map((item) => item.name),
      ["Вторая", "Первая"]
    );
    assert.equal(printed.items[0].price, "HISTORICAL-2");
    assert.equal(printed.items[1].lineTotal, "HISTORICAL-LINE-1");
    assert.equal(printed.total, "HISTORICAL-TOTAL");
    assert.equal(printed.showComment, false);
  } finally {
    closeDatabase(opened.db);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
