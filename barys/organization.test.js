import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { closeDatabase, createOrder, listOrders, listProducts, openDatabase } from "./db.js";
import {
  handleOrganization,
  organizationToFacturaSeller,
  organizationToInvoiceCompany,
  readOrganization,
  seedDemoOrganization,
  writeOrganization,
} from "./organization.js";
import { buildInvoiceFacturaData } from "./pdf/buildInvoiceFacturaData.js";
import { printableInvoice } from "./pdf/invoiceTemplate.js";

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "izim-org-"));
}

function productionBody() {
  return {
    legalName: "ТОО Пример проверки",
    shortName: "Пример",
    bin: "123456789012",
    countryCode: "KZ",
    region: "Пример",
    city: "Пример",
    legalAddress: "Пример, адрес для проверки",
    phone: "+7 700 000 00 00",
    email: "office@example.com",
    bank: {
      name: "EXAMPLE BANK",
      iban: "KZ00TEST000000000000",
      bic: "EXMPKZKX",
      kbe: "17",
      currency: "KZT",
    },
    tax: {
      regime: "GENERAL",
      vatRegistered: true,
      defaultVatRate: 16,
      defaultVatTreatment: "STANDARD",
      vatRegistrationDate: null,
      vatRegistrationStatus: "",
    },
    isDemo: false,
    confirmProduction: true,
  };
}

test("организация создаётся один раз и не трогает товары и заказы", () => {
  const root = tempRoot();
  const opened = openDatabase(root);
  try {
    assert.equal(readOrganization(opened.db), null);
    assert.equal(seedDemoOrganization(opened.db), true);
    assert.equal(seedDemoOrganization(opened.db), false);
    const first = readOrganization(opened.db);
    assert.equal(first.legalName, "ТОО «DEMO BETON SYSTEMS»");
    assert.equal(first.bin, "DEMO-BIN-000001");
    assert.equal(first.isDemo, true);
    assert.equal(first.tax.defaultVatRate, 16);
    assert.equal(typeof first.tax.defaultVatRate, "number");
    assert.equal(first.tax.vatRegistered, true);
    assert.equal(first.tax.defaultVatTreatment, "STANDARD");
    assert.equal(first.bank.iban, "DEMO-IBAN-KZ");
    const productsBefore = listProducts(opened.db).length;
    createOrder(opened.db, {
      id: "order-keep",
      name: "Алия",
      phone: "87015554433",
      comment: "",
      currency: "kzt",
      total: "HISTORICAL-TOTAL",
      channel: "whatsapp",
      items: [{ id: "p1", name: "Первая", unit: "шт", qty: 1, price: "10", lineTotal: "10" }],
    });
    const ordersBefore = listOrders(opened.db).orders.length;
    const columns = opened.db.prepare("PRAGMA table_info(orders)").all().map((col) => col.name);
    assert.deepEqual(columns, [
      "id", "created_at", "name", "phone", "comment", "currency", "total", "channel", "status",
      "tax_data_status", "prices_include_vat", "tax_calculation_version", "subtotal_without_vat", "vat_total", "grand_total",
      "phone_key",
    ]);
    closeDatabase(opened.db);
    const again = openDatabase(root);
    try {
      assert.equal(readOrganization(again.db).bin, "DEMO-BIN-000001");
      assert.equal(again.db.prepare("SELECT COUNT(*) AS n FROM organization_settings").get().n, 1);
      assert.equal(listProducts(again.db).length, productsBefore);
      assert.equal(listOrders(again.db).orders.length, ordersBefore);
      assert.equal(listOrders(again.db).orders[0].total, "89 000 ₸");
      assert.equal(listOrders(again.db).orders[0].currency, "kzt");
    } finally {
      closeDatabase(again.db);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("организация доступна только администратору и сохраняет правки", () => {
  const root = tempRoot();
  const opened = openDatabase(root);
  const env = { ADMIN_PASSWORD: "secret" };
  try {
    assert.equal(seedDemoOrganization(opened.db), true);
    const denied = handleOrganization({ db: opened.db, method: "GET", raw: "", env, adminHeader: "" });
    const wrong = handleOrganization({ db: opened.db, method: "PUT", raw: "{}", env, adminHeader: "nope" });
    assert.equal(denied.status, 401);
    assert.equal(wrong.status, 401);
    const saved = handleOrganization({
      db: opened.db,
      method: "PUT",
      raw: JSON.stringify({ city: "DEMO CITY 2", phone: "+7 XXX XXX XX 00" }),
      env,
      adminHeader: "secret",
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.city, "DEMO CITY 2");
    assert.equal(saved.body.phone, "+7 XXX XXX XX 00");
    assert.equal(saved.body.isDemo, true);
    assert.equal(saved.body.bin, "DEMO-BIN-000001");
    const unknown = handleOrganization({
      db: opened.db,
      method: "PUT",
      raw: JSON.stringify({ id: 2, created_at: "2000-01-01", password: "secret", token: "x" }),
      env,
      adminHeader: "secret",
    });
    assert.equal(unknown.status, 400);
    assert.equal(unknown.body.error, "unknown field");
    assert.equal(readOrganization(opened.db).bin, "DEMO-BIN-000001");
  } finally {
    closeDatabase(opened.db);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("DEMO принимает placeholders, рабочий режим их отклоняет", () => {
  const root = tempRoot();
  const opened = openDatabase(root);
  try {
    assert.equal(seedDemoOrganization(opened.db), true);
    const demo = writeOrganization(opened.db, { bin: "DEMO-BIN", iban: "DEMO-IBAN" });
    assert.equal(demo.bin, "DEMO-BIN");
    assert.equal(demo.bank.iban, "DEMO-IBAN");
    assert.throws(() => writeOrganization(opened.db, { ...productionBody(), bin: "DEMO-BIN-000001" }), /invalid bin/);
    assert.throws(() => writeOrganization(opened.db, { ...productionBody(), bank: { ...productionBody().bank, iban: "DEMO-IBAN-KZ" } }), /invalid iban/);
    assert.throws(() => writeOrganization(opened.db, { ...productionBody(), confirmProduction: false }), /production confirmation required/);
    assert.throws(() => writeOrganization(opened.db, { ...productionBody(), legalName: "ТОО «DEMO BETON SYSTEMS»" }), /invalid name/);
    assert.throws(() => writeOrganization(opened.db, { ...productionBody(), legalAddress: "DEMO ADDRESS — НЕСУЩЕСТВУЮЩИЙ АДРЕС" }), /invalid address/);
    assert.throws(() => writeOrganization(opened.db, { ...productionBody(), tax: { ...productionBody().tax, vatRegistrationDate: "2026-02-31" } }), /invalid vat date/);
    const spaced = writeOrganization(opened.db, {
      ...productionBody(),
      bank: { ...productionBody().bank, iban: "kz00 test 000000000000", bic: "exmpkzkx" },
    });
    assert.equal(spaced.bank.iban, "KZ00TEST000000000000");
    assert.equal(spaced.bank.bic, "EXMPKZKX");
    assert.equal(spaced.tax.vatRegistrationStatus, "");
    writeOrganization(opened.db, { isDemo: true, bin: "DEMO-BIN-000001", iban: "DEMO-IBAN-KZ", bankName: "DEMO BANK — НЕСУЩЕСТВУЮЩИЙ", bic: "DEMO-BIC", kbe: "DEMO", legalName: "ТОО «DEMO BETON SYSTEMS»", legalAddress: "DEMO ADDRESS — НЕСУЩЕСТВУЮЩИЙ АДРЕС", email: "demo@example.invalid", city: "DEMO CITY", region: "DEMO" });
    const live = writeOrganization(opened.db, productionBody());
    assert.equal(live.isDemo, false);
    assert.equal(live.bin, "123456789012");
    const noVat = writeOrganization(opened.db, {
      tax: { vatRegistered: false, defaultVatRate: null, defaultVatTreatment: "EXEMPT" },
    });
    assert.equal(noVat.tax.vatRegistered, false);
    assert.equal(noVat.tax.defaultVatRate, null);
    assert.equal(noVat.tax.defaultVatTreatment, "EXEMPT");
  } finally {
    closeDatabase(opened.db);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("счёт и счёт-фактура читают организацию и не считают НДС", () => {
  const root = tempRoot();
  const opened = openDatabase(root);
  try {
    assert.equal(seedDemoOrganization(opened.db), true);
    const org = readOrganization(opened.db);
    const company = organizationToInvoiceCompany(org);
    const printed = printableInvoice(
      { id: "o1", name: "Клиент", phone: "1", comment: "", total: "100", items: [{ name: "Товар", unit: "шт", qty: 1, price: "100", lineTotal: "100" }] },
      company
    );
    assert.equal(printed.isDemo, true);
    assert.equal(printed.supplier.name, "ТОО «DEMO BETON SYSTEMS»");
    assert.equal(printed.supplier.bin, "DEMO-BIN-000001");
    assert.equal(printed.supplier.iban, "DEMO-IBAN-KZ");
    const seller = organizationToFacturaSeller(org);
    const factura = buildInvoiceFacturaData(
      { id: "o1", total: "100", items: [{ name: "Товар", unit: "шт", qty: 1, price: "100", lineTotal: "100" }] },
      { organization: org, seller }
    );
    assert.equal(factura.seller.name, "ТОО «DEMO BETON SYSTEMS»");
    assert.equal(factura.seller.identifier, "DEMO-BIN-000001");
    assert.equal(factura.seller.defaultVatRate, 16);
    assert.equal(factura.seller.isDemo, true);
    assert.equal(factura.items[0].vatRate, null);
    assert.equal(factura.items[0].vatAmount, null);
    assert.equal(factura.totals.vatAmount, null);
    assert.equal(factura.document.esfRegistrationNumber, null);
  } finally {
    closeDatabase(opened.db);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
