import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DbError, closeDatabase, createOrder, getOrder, listOrders, listProducts, openDatabase, saveProduct } from "./db.js";
import { seedDemoOrganization, writeOrganization } from "./organization.js";
import { buildInvoiceFacturaData } from "./pdf/buildInvoiceFacturaData.js";
import { printableInvoice } from "./pdf/invoiceTemplate.js";

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "izim-tax-"));
}

test("подтверждение цен не меняет прайс и не придумывает НДС старым заказам", () => {
  const root = tempRoot();
  const opened = openDatabase(root);
  try {
    seedDemoOrganization(opened.db);
    const prices = listProducts(opened.db).map((product) => product.price);
    const legacy = createOrder(opened.db, {
      id: "legacy1",
      name: "Алия",
      phone: "+7 700 000 00 01",
      total: "890 000 ₸",
      items: [{ id: "p1", name: "Старая позиция", unit: "шт", qty: 1, price: "1 ₸", lineTotal: "1 ₸" }],
    });
    assert.equal(legacy.order.taxDataStatus, "LEGACY");
    assert.equal(legacy.order.vatTotal, null);
    assert.equal(legacy.order.total, "89 000 ₸");
    assert.equal(legacy.order.items[0].name, "Плита перекрытия ПК 60-15");
    assert.throws(
      () =>
        createOrder(opened.db, {
          name: "Тест",
          phone: "+7 700 000 00 09",
          items: [
            { id: "p1", qty: 600 },
            { id: "p1", qty: 500 },
          ],
        }),
      (err) => err instanceof DbError && err.status === 400
    );
    assert.throws(
      () =>
        createOrder(opened.db, {
          id: "legacy1",
          name: "Чужой",
          phone: "+7 700 000 00 08",
          items: [{ id: "p1", qty: 1 }],
        }),
      (err) => err instanceof DbError && err.status === 409 && !String(err.message).includes("Алия")
    );
    writeOrganization(opened.db, { confirmCatalogPrices: true, tax: { pricesIncludeVat: false } });
    assert.deepEqual(listProducts(opened.db).map((product) => product.price), prices);
    assert.equal(getOrder(opened.db, "legacy1").taxDataStatus, "LEGACY");
    assert.equal(getOrder(opened.db, "legacy1").vatTotal, null);
    assert.equal(getOrder(opened.db, "legacy1").total, "89 000 ₸");
  } finally {
    closeDatabase(opened.db);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("снимок заказа переживает смену цены и ставки", () => {
  const root = tempRoot();
  const opened = openDatabase(root);
  try {
    seedDemoOrganization(opened.db);
    writeOrganization(opened.db, { confirmCatalogPrices: true, tax: { pricesIncludeVat: false } });
    const product = listProducts(opened.db)[0];
    saveProduct(opened.db, {
      id: product.id,
      name: product.name,
      price: "100 000",
      unit: product.unit,
      description: product.description,
      image: product.image,
      vatRateSource: "ORGANIZATION",
    });
    const other = listProducts(opened.db)[1];
    saveProduct(opened.db, {
      id: other.id,
      name: other.name,
      price: other.price,
      unit: other.unit,
      description: other.description,
      image: other.image,
      vatRateSource: "PRODUCT",
      vatTreatment: "ZERO",
    });
    const created = createOrder(opened.db, {
      name: "Тест",
      phone: "+7 700 000 00 02",
      total: "10 ₸",
      items: [
        { id: product.id, qty: 2, price: "1", lineTotal: "1", vatAmount: 1 },
        { id: other.id, qty: 1, price: "1", lineTotal: "1", vatAmount: 1 },
      ],
    });
    const order = created.order;
    assert.equal(order.taxDataStatus, "SNAPSHOT");
    assert.equal(order.taxCalculationVersion, 1);
    assert.equal(order.pricesIncludeVat, false);
    assert.notEqual(order.total, "10 ₸");
    assert.equal(order.subtotalWithoutVat + order.vatTotal, order.grandTotal);
    assert.equal(order.items[0].price, "100 000 ₸");
    assert.equal(order.items[0].lineTotal, "200 000 ₸");
    assert.equal(order.items[0].amountWithoutVat, 20000000);
    assert.equal(order.items[0].vatAmount, 3200000);
    assert.equal(order.items[0].amountWithVat, 23200000);
    assert.equal(order.items[1].vatAmount, 0);
    assert.equal(order.taxLines.length, 2);
    const printed = printableInvoice(order, { isDemo: true, name: "ТОО", bin: "1", iban: "1", bic: "1", bankName: "1", address: "1", phone: "1", email: "a@b.c" });
    assert.equal(printed.taxLines.length, 2);
    assert.equal(printed.total, order.total);
    const factura = buildInvoiceFacturaData(order);
    assert.equal(factura.items[0].vatRate, "16.00");
    assert.equal(factura.items[0].vatAmount, "32 000 ₸");
    assert.equal(factura.totals.vatAmount, order.vatTotalText);
    saveProduct(opened.db, {
      id: product.id,
      name: product.name,
      price: "150 000",
      unit: product.unit,
      description: product.description,
      image: product.image,
      vatRateSource: "ORGANIZATION",
    });
    writeOrganization(opened.db, { tax: { defaultVatRate: 10 } });
    const again = getOrder(opened.db, order.id);
    assert.equal(again.subtotalWithoutVat, order.subtotalWithoutVat);
    assert.equal(again.vatTotal, order.vatTotal);
    assert.equal(again.grandTotal, order.grandTotal);
    assert.equal(again.items[0].vatAmount, 3200000);
    assert.equal(listOrders(opened.db, { limit: 10 }).orders[0].taxDataStatus, "SNAPSHOT");
    assert.throws(
      () => createOrder(opened.db, { name: "Тест", phone: "+7 700 000 00 03", items: [{ id: product.id, qty: 2.5 }] }),
      (err) => err instanceof DbError && err.status === 400
    );
    assert.throws(
      () => saveProduct(opened.db, {
        id: product.id,
        name: product.name,
        price: product.price,
        unit: product.unit,
        description: product.description,
        image: product.image,
        vatRateSource: "PRODUCT",
        vatTreatment: "STANDARD",
        vatRate: null,
      }),
      (err) => err instanceof DbError && /vat rate/.test(err.message)
    );
    assert.equal(getOrder(opened.db, order.id).vatTotal, order.vatTotal);
  } finally {
    closeDatabase(opened.db);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
