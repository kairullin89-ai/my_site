import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { DEMO_COMPANY } from "./pdf/companyDemo.js";
import {
  handleInvoicePdfRequest,
  invoiceFileName,
  invoiceNumber,
  printableInvoice,
  renderInvoicePdf,
} from "./pdf/invoiceTemplate.js";
import { closeDatabase, getOrder, importStoredOrder, openDatabase } from "./db.js";
import { invoiceLabels } from "./pdf/labels.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const templateSource = fs.readFileSync(new URL("./pdf/invoiceTemplate.js", import.meta.url), "utf8");
const companySource = fs.readFileSync(new URL("./pdf/companyDemo.js", import.meta.url), "utf8");

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
    createdAt: "2026-09-29T08:00:00.000Z",
    name: "Иван Иванов",
    phone: "+7 701 000 00 00",
    comment: "",
    total: "STORED-TOTAL-88",
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

test("DEMO-реквизиты отделены от сайта и не похожи на настоящие", () => {
  assert.equal(DEMO_COMPANY.isDemo, true);
  assert.equal(DEMO_COMPANY.bin, "DEMO-BIN");
  assert.equal(DEMO_COMPANY.iban, "DEMO-IBAN");
  assert.equal(DEMO_COMPANY.bic, "DEMO-BIC");
  assert.equal(DEMO_COMPANY.bankName, "DEMO BANK");
  assert.equal(DEMO_COMPANY.email, "demo@example.com");
  assert.equal(/^\d{12}$/.test(DEMO_COMPANY.bin), false);
  assert.equal(companySource.includes("KZ"), false);
  assert.equal(templateSource.includes("money.js"), false);
  assert.equal(templateSource.includes("formatPrice"), false);
  assert.equal(templateSource.includes("Без НДС"), false);
  assert.equal(templateSource.includes("12%"), false);
  assert.equal(templateSource.includes("Счёт-фактура"), false);
  assert.equal(templateSource.includes("companyDemo"), false);
  const server = fs.readFileSync(path.join(root, "server.ps1"), "utf8");
  const store = fs.readFileSync(path.join(root, "src", "lib", "store.js"), "utf8");
  assert.equal(server.includes("DEMO-BIN"), false);
  assert.equal(server.includes("companyDemo"), false);
  assert.equal(store.includes("DEMO-BIN"), false);
  assert.equal(store.includes("demo@example.com"), false);
});

test("счёт берёт сохранённые цены и помечает DEMO", () => {
  const printed = printableInvoice(order(), DEMO_COMPANY, new Date(2026, 9, 1, 12, 0, 0));
  assert.equal(printed.number, "INV-o1k2abc");
  assert.equal(invoiceNumber("o1k2abc"), "INV-o1k2abc");
  assert.equal(invoiceFileName("o1k2abc"), "Invoice-o1k2abc.pdf");
  assert.equal(printed.total, "STORED-TOTAL-88");
  assert.equal(printed.items[0].price, "STORED-PRICE-77");
  assert.equal(printed.items[0].lineTotal, "STORED-LINE-77");
  assert.equal(printed.items[0].currentPrice, undefined);
  assert.equal(printed.supplier.bin, "DEMO-BIN");
  assert.equal(printed.supplier.iban, "DEMO-IBAN");
  assert.equal(printed.isDemo, true);
  assert.equal(printed.showComment, false);
  const plain = printableInvoice(order(), { ...DEMO_COMPANY, isDemo: false, name: "ТОО Рабочая" });
  assert.equal(plain.isDemo, false);
  assert.equal(plain.supplier.name, "ТОО Рабочая");
});

test("рабочий профиль печатается без требования DEMO-флага", async () => {
  const pdf = await renderInvoicePdf({
    order: order(),
    lang: "ru",
    root,
    company: { ...DEMO_COMPANY, isDemo: false, name: "ТОО Рабочая", bin: "123456789012" },
  });
  assert.equal(pdf.buffer.subarray(0, 5).toString("latin1"), "%PDF-");
});

test("доступ к счёту: 401, 400 и 404 без чтения чужого заказа", async () => {
  let reads = 0;
  const env = { ADMIN_PASSWORD: "secret" };
  const denied = await handleInvoicePdfRequest({
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
  const missingPassword = await handleInvoicePdfRequest({
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
  const invalid = await handleInvoicePdfRequest({
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
  const absent = await handleInvoicePdfRequest({
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

test("русский и казахский DEMO-счёт, пустой комментарий", async () => {
  const now = new Date(2026, 9, 1, 12, 0, 0);
  const ru = await renderInvoicePdf({ order: order({ comment: "   " }), lang: "ru", root, now, company: DEMO_COMPANY });
  assert.equal(ru.filename, "Invoice-o1k2abc.pdf");
  assertPdf(ru.buffer);
  assert.equal(pagesOf(ru.buffer), 1);
  assert.equal(printableInvoice(order({ comment: "   " }), DEMO_COMPANY).showComment, false);

  const kk = await renderInvoicePdf({ order: order(), lang: "kk", root, now, company: DEMO_COMPANY });
  assertPdf(kk.buffer);
  const text = pdfText(kk.buffer);
  for (const code of ["04E8", "0492"]) assert.equal(text.includes(code), true, code);
  assert.equal(printableInvoice(order(), DEMO_COMPANY).isDemo, true);
  const labels = invoiceLabels("kk");
  assert.equal(labels.documentTitle.includes("DEMO"), false);
  assert.equal(labels.watermark, "");
  assert.equal(labels.demo.includes("DEMO"), false);
});

test("50 позиций дают несколько страниц, итог остаётся снимком", async () => {
  const items = Array.from({ length: 50 }, (_, index) => ({
    name: `Изделие ${index + 1} ${"железобетон ".repeat(index % 5 === 0 ? 5 : 1)}`.trim(),
    unit: index % 3 === 0 ? "м²" : index % 3 === 1 ? "м³" : "шт",
    qty: index + 1,
    price: `PRICE-${index}-NOT-RECALC`,
    lineTotal: `LINE-${index}-NOT-RECALC`,
  }));
  const body = order({
    id: "order50",
    total: "TOTAL-50-SNAPSHOT",
    comment: `Комментарий к счёту.\n${"Доставка упомянута только как текст. ".repeat(8)}`,
    items,
  });
  const printed = printableInvoice(body, DEMO_COMPANY);
  assert.equal(printed.total, "TOTAL-50-SNAPSHOT");
  assert.equal(printed.items[49].price, "PRICE-49-NOT-RECALC");
  assert.equal(printed.showComment, true);
  const pdf = await renderInvoicePdf({ order: body, lang: "ru", root, now: new Date(2026, 9, 1), company: DEMO_COMPANY });
  assertPdf(pdf.buffer);
  assert.ok(pagesOf(pdf.buffer) >= 2);
});

test("getOrder для счёта сохраняет исторические суммы", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "izim-invoice-pdf-"));
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
      items: [
        { id: "p2", name: "Вторая", unit: "м²", qty: 3, price: "HISTORICAL-2", lineTotal: "HISTORICAL-LINE-2" },
        { id: "p1", name: "Первая", unit: "шт", qty: 1, price: "HISTORICAL-1", lineTotal: "HISTORICAL-LINE-1" },
      ],
    });
    const saved = getOrder(opened.db, "order-snap");
    const printed = printableInvoice(saved, DEMO_COMPANY);
    assert.deepEqual(
      printed.items.map((item) => item.lineTotal),
      ["HISTORICAL-LINE-2", "HISTORICAL-LINE-1"]
    );
    assert.equal(printed.total, "HISTORICAL-TOTAL");
    assert.equal(printed.supplier.bic, "DEMO-BIC");
  } finally {
    closeDatabase(opened.db);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
