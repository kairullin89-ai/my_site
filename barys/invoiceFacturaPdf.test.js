import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { buildInvoiceFacturaData, esfRegistrationText } from "./pdf/buildInvoiceFacturaData.js";
import { DEMO_FACTURA_BUYER, DEMO_FACTURA_SELLER } from "./pdf/invoiceFacturaDemo.js";
import { handleInvoiceFacturaPdfRequest, renderInvoiceFacturaPdf } from "./pdf/invoiceFacturaTemplate.js";
import { invoiceFacturaLabels } from "./pdf/labels.js";
import { closeDatabase, getOrder, importStoredOrder, openDatabase } from "./db.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildSource = fs.readFileSync(new URL("./pdf/buildInvoiceFacturaData.js", import.meta.url), "utf8");
const templateSource = fs.readFileSync(new URL("./pdf/invoiceFacturaTemplate.js", import.meta.url), "utf8");

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

test("DEMO-профиль не похож на настоящие реквизиты и не считает НДС", () => {
  assert.equal(DEMO_FACTURA_SELLER.isDemo, true);
  assert.equal(DEMO_FACTURA_SELLER.bin, "DEMO-BIN");
  assert.equal(DEMO_FACTURA_SELLER.iban, "DEMO-IBAN");
  assert.equal(DEMO_FACTURA_SELLER.bic, "DEMO-BIC");
  assert.equal(DEMO_FACTURA_BUYER.name, "DEMO BUYER");
  assert.equal(DEMO_FACTURA_BUYER.binIin, "DEMO");
  assert.equal(/^\d{12}$/.test(DEMO_FACTURA_SELLER.bin), false);
  assert.equal(/^\d{12}$/.test(DEMO_FACTURA_BUYER.binIin), false);
  assert.equal(templateSource.includes("money.js"), false);
  assert.equal(templateSource.includes("formatPrice"), false);
  assert.equal(buildSource.includes("0.12"), false);
  assert.equal(buildSource.includes("12%"), false);
  assert.equal(buildSource.includes("esfRegistrationNumber: null"), true);
  assert.equal(templateSource.includes("INV-"), false);
  const labels = invoiceFacturaLabels("ru");
  assert.equal(esfRegistrationText({ status: "preliminary", esfRegistrationNumber: "ESF-999" }, labels.notRegistered), "НЕ ЗАРЕГИСТРИРОВАНО");
  assert.equal(esfRegistrationText({ status: "registered", esfRegistrationNumber: "" }, labels.notRegistered), "НЕ ЗАРЕГИСТРИРОВАНО");
  assert.equal(esfRegistrationText({ status: "registered", esfRegistrationNumber: "ESF-FROM-SYSTEM" }, labels.notRegistered), "ESF-FROM-SYSTEM");
});

test("модель отделяет учётный номер от регистрации и сохраняет позиции", () => {
  const data = buildInvoiceFacturaData(order({ comment: "   " }));
  assert.equal(data.document.status, "preliminary");
  assert.equal(data.document.type, "ordinary");
  assert.equal(data.document.accountingNumber, "SF-o1k2abc");
  assert.equal(data.document.esfRegistrationNumber, null);
  assert.equal(data.document.turnoverDate, null);
  assert.equal(data.seller.name, "ТОО «БАРЫС» (DEMO)");
  assert.equal(data.seller.bin === undefined ? data.seller.identifier : data.seller.identifier, "DEMO-BIN");
  assert.equal(data.buyer.name, "DEMO BUYER");
  assert.notEqual(data.buyer.name, "Иван Иванов");
  assert.equal(data.buyer.identifier, "DEMO");
  assert.equal(data.orderComment, "");
  assert.equal(data.items[0].unitPrice, "STORED-PRICE-77");
  assert.equal(data.items[0].lineTotal, "STORED-LINE-77");
  assert.equal(data.items[0].vatRate, null);
  assert.equal(data.items[0].vatAmount, null);
  assert.equal(data.items[0].productCode, null);
  assert.equal(data.items[0].amountWithoutVat, null);
  assert.equal(data.totals.orderTotal, "STORED-TOTAL-88");
  assert.equal(data.totals.vatAmount, null);
  assert.equal(data.seller.vatRegistered, null);
});

test("рабочий поставщик не включает расчёт НДС в строки", async () => {
  const pdf = await renderInvoiceFacturaPdf({
    order: order(),
    lang: "ru",
    root,
    seller: {
      isDemo: false,
      name: "ТОО Рабочая",
      bin: "123456789012",
      defaultVatRate: 16,
      defaultVatTreatment: "STANDARD",
      vatRegistered: true,
    },
  });
  assert.equal(pdf.buffer.subarray(0, 5).toString("latin1"), "%PDF-");
  const data = buildInvoiceFacturaData(order(), {
    seller: { isDemo: false, name: "ТОО Рабочая", bin: "123456789012", defaultVatRate: 16, vatRegistered: true },
  });
  assert.equal(data.seller.isDemo, false);
  assert.equal(data.seller.defaultVatRate, 16);
  assert.equal(data.items[0].vatRate, null);
  assert.equal(data.items[0].vatAmount, null);
  assert.equal(data.totals.vatAmount, null);
});

test("доступ к счёту-фактуре: 401, 400 и 404 до чтения чужого заказа", async () => {
  let reads = 0;
  const env = { ADMIN_PASSWORD: "secret" };
  const denied = await handleInvoiceFacturaPdfRequest({
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
  const missingPassword = await handleInvoiceFacturaPdfRequest({
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
  const invalid = await handleInvoiceFacturaPdfRequest({
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
  const absent = await handleInvoiceFacturaPdfRequest({
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

test("заявка из корзины не становится счётом-фактурой", async () => {
  const env = { ADMIN_PASSWORD: "secret" };
  const cartOrder = order();
  const demo = await handleInvoiceFacturaPdfRequest({
    method: "GET",
    searchParams: new URLSearchParams({ id: cartOrder.id }),
    adminHeader: "secret",
    env,
    getOrderById: () => cartOrder,
    getOrganization: () => ({ isDemo: true, legalName: "ТОО «DEMO BETON SYSTEMS»" }),
    root,
  });
  assert.equal(demo.status, 422);
  assert.equal(demo.json.error, "Организация не настроена");
  assert.equal(demo.pdf, undefined);
  const live = await handleInvoiceFacturaPdfRequest({
    method: "GET",
    searchParams: new URLSearchParams({ id: cartOrder.id }),
    adminHeader: "secret",
    env,
    getOrderById: () => cartOrder,
    getOrganization: () => ({ isDemo: false, legalName: "ТОО Рабочая" }),
    root,
  });
  assert.equal(live.status, 409);
  assert.equal(live.json.error, "buyer requisites required");
  const namedOnly = { ...cartOrder, buyerName: cartOrder.name };
  const person = await handleInvoiceFacturaPdfRequest({
    method: "GET",
    searchParams: new URLSearchParams({ id: cartOrder.id }),
    adminHeader: "secret",
    env,
    getOrderById: () => namedOnly,
    getOrganization: () => ({ isDemo: false, legalName: "ТОО Рабочая" }),
    root,
  });
  assert.equal(person.status, 409);
  const ready = {
    ...cartOrder,
    buyerName: "ТОО Покупатель",
    buyerBin: "123456789012",
    buyerAddress: "Алматы, ул. Абая, 1",
  };
  const pdf = await handleInvoiceFacturaPdfRequest({
    method: "GET",
    searchParams: new URLSearchParams({ id: cartOrder.id }),
    adminHeader: "secret",
    env,
    getOrderById: () => ready,
    getOrganization: () => ({ isDemo: false, legalName: "ТОО Рабочая", bin: "123456789012" }),
    root,
  });
  assert.equal(pdf.status, 200);
  assert.equal(pdf.pdf.buffer.subarray(0, 5).toString("latin1"), "%PDF-");
  const data = buildInvoiceFacturaData(ready, {
    organization: { isDemo: false, legalName: "ТОО Рабочая", bin: "123456789012" },
    buyer: { name: ready.buyerName, binIin: ready.buyerBin, address: ready.buyerAddress },
  });
  assert.equal(data.buyer.name, "ТОО Покупатель");
  assert.equal(data.buyer.name.includes(cartOrder.name), false);
});

test("русский и казахский предварительный PDF", async () => {
  const now = new Date(2026, 9, 1, 12, 0, 0);
  const ru = await renderInvoiceFacturaPdf({ order: order(), lang: "ru", root, now });
  assert.equal(ru.filename, "InvoiceFactura-o1k2abc.pdf");
  assertPdf(ru.buffer);
  const raw = ru.buffer.toString("latin1");
  assert.equal(raw.includes("SF-o1k2abc") || raw.includes("S\u0000F\u0000-") || raw.includes("\u0000S\u0000F"), true);
  const facturaLabels = invoiceFacturaLabels("ru");
  assert.equal(facturaLabels.documentTitle.includes("DEMO"), false);
  assert.equal(facturaLabels.watermark, "");
  assert.equal(facturaLabels.demo.includes("DEMO"), false);
  assert.equal(facturaLabels.buyerNote.includes("DEMO"), false);

  const kk = await renderInvoiceFacturaPdf({ order: order(), lang: "kk", root, now });
  assertPdf(kk.buffer);
  const text = pdfText(kk.buffer);
  for (const code of ["0406", "04E9"]) assert.equal(text.includes(code), true, code);
});

test("50 позиций разбиваются на страницы без пересчёта", async () => {
  const items = Array.from({ length: 50 }, (_, index) => ({
    name: `Изделие ${index + 1}`,
    unit: "шт",
    qty: index + 1,
    price: `PRICE-${index}-NOT-RECALC`,
    lineTotal: `LINE-${index}-NOT-RECALC`,
  }));
  const body = order({ id: "order50", total: "TOTAL-50-SNAPSHOT", comment: "Только комментарий", items });
  const data = buildInvoiceFacturaData(body);
  assert.equal(data.items[0].description, "Изделие 1");
  assert.equal(data.items[49].unitPrice, "PRICE-49-NOT-RECALC");
  assert.equal(data.items[49].productCode, null);
  assert.equal(data.orderComment, "Только комментарий");
  const pdf = await renderInvoiceFacturaPdf({ order: body, lang: "ru", root, now: new Date(2026, 9, 1) });
  assertPdf(pdf.buffer);
  assert.ok(pagesOf(pdf.buffer) >= 2);
});

test("getOrder сохраняет порядок и исторические суммы для счёта-фактуры", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "izim-factura-pdf-"));
  const opened = openDatabase(dir);
  try {
    importStoredOrder(opened.db, {
      id: "order-snap",
      name: "Алия",
      phone: "87015554433",
      comment: "",
      currency: "kzt",
      total: "HISTORICAL-TOTAL",
      channel: "whatsapp",
      items: [
        { id: "p2", name: "Вторая", unit: "м²", qty: 3, price: "HISTORICAL-2", lineTotal: "HISTORICAL-LINE-2" },
        { id: "p1", name: "Первая", unit: "шт", qty: 1, price: "HISTORICAL-1", lineTotal: "HISTORICAL-LINE-1" },
      ],
    });
    const saved = getOrder(opened.db, "order-snap");
    const data = buildInvoiceFacturaData(saved);
    assert.deepEqual(
      data.items.map((item) => item.lineTotal),
      ["HISTORICAL-LINE-2", "HISTORICAL-LINE-1"]
    );
    assert.equal(data.totals.orderTotal, "HISTORICAL-TOTAL");
    assert.equal(data.document.accountingNumber, "SF-order-snap");
    assert.equal(data.document.esfRegistrationNumber, null);
  } finally {
    closeDatabase(opened.db);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
