import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { collectOrderItems, presentQuote, quoteOrderLines } from "./finance/orderQuote.js";
import { formatTiyn, parsePriceToTiyn, percentToBasisPoints, PRODUCT_TREATMENTS } from "./finance/vat.js";
import { ensureOrganizationSchema, readOrganization } from "./organization.js";

const STORAGE_KEY = "storage";
const STORAGE_VALUE = "sqlite_v1";
const DEFAULT_IMAGE = "assets/products/plant.jpg";
const PRODUCT_LIMIT = 2000;
const mediaRoots = new WeakMap();

const SEED_PRODUCTS = [
  {
    id: "p1",
    name: "Плита перекрытия ПК 60-15",
    price: "89 000",
    unit: "шт",
    description: "Многопустотная плита перекрытия для жилых и промышленных зданий.",
    image: "assets/products/plita-pk-hollow.jpg",
  },
  {
    id: "p2",
    name: "Кольцо стеновое КС 10-9",
    price: "35 000",
    unit: "шт",
    description: "Колодезное кольцо Ø1 м, высота 0,9 м.",
    image: "assets/products/pipes.jpg",
  },
  {
    id: "p3",
    name: "Брусчатка бетонная 200×100×60",
    price: "5 200",
    unit: "м²",
    description: "Тротуарная брусчатка для дворов, парковок и благоустройства.",
    image: "assets/products/bruschatka.jpg",
  },
  {
    id: "p4",
    name: "Плита дорожная ПДН 6×2",
    price: "112 000",
    unit: "шт",
    description: "Дорожная плита 6×2 м для временных и постоянных проездов.",
    image: "assets/products/plita-dorozhnaya.jpg",
  },
  {
    id: "p5",
    name: "Крышка колодца ПП 10",
    price: "22 500",
    unit: "шт",
    description: "Плита перекрытия колодца под кольцо КС-10.",
    image: "assets/products/kryshka-pp.jpg",
  },
  {
    id: "p6",
    name: "Свая железобетонная С 30.30-6",
    price: "78 000",
    unit: "шт",
    description: "Забивная железобетонная свая сечением 300×300 мм, длина 6 м.",
    image: "assets/products/svaya.jpg",
  },
  {
    id: "p7",
    name: "Бетон товарный М300",
    price: "42 000",
    unit: "м³",
    description: "Товарный бетон с производственного узла.",
    image: "assets/products/beton.jpg",
  },
];

export class DbError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function databasePath(root) {
  return path.join(root, "data", "izim.sqlite");
}

export function openDatabase(root) {
  const dir = path.join(root, "data");
  fs.mkdirSync(dir, { recursive: true });
  const file = databasePath(root);
  const db = new DatabaseSync(file, { timeout: 5000 });
  try {
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("PRAGMA busy_timeout = 5000");
    ensureSchema(db);
    ensureOrganizationSchema(db);
    mediaRoots.set(db, root);
    const imported = migrateJson(db, root);
    return { db, file, imported };
  } catch (err) {
    try {
      db.close();
    } catch {
      /* ignore close after a failed open */
    }
    throw err;
  }
}

export function closeDatabase(db) {
  db.close();
}

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      price TEXT NOT NULL,
      unit TEXT NOT NULL DEFAULT 'шт',
      description TEXT NOT NULL DEFAULT '',
      image TEXT NOT NULL DEFAULT '${DEFAULT_IMAGE}',
      position INTEGER NOT NULL DEFAULT 0
    ) STRICT;

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      comment TEXT NOT NULL DEFAULT '',
      currency TEXT NOT NULL DEFAULT 'kzt',
      total TEXT NOT NULL DEFAULT '',
      channel TEXT NOT NULL DEFAULT 'whatsapp',
      status TEXT NOT NULL DEFAULT 'new'
    ) STRICT;

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL,
      unit TEXT NOT NULL DEFAULT 'шт',
      qty INTEGER NOT NULL DEFAULT 1,
      price TEXT NOT NULL DEFAULT '',
      line_total TEXT NOT NULL DEFAULT '',
      position INTEGER NOT NULL DEFAULT 0
    ) STRICT;

    CREATE INDEX IF NOT EXISTS orders_created_at ON orders (created_at DESC);
    CREATE INDEX IF NOT EXISTS orders_phone ON orders (phone);
    CREATE INDEX IF NOT EXISTS order_items_order_id ON order_items (order_id, position);
  `);
  ensureTaxColumns(db);
  db.exec(`

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) STRICT;
  `);
}

function columnNames(db, table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name));
}

function addColumn(db, table, name, definition) {
  if (columnNames(db, table).has(name)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
}

function ensureTaxColumns(db) {
  addColumn(db, "products", "vat_status", "TEXT NOT NULL DEFAULT 'VAT_NOT_CONFIGURED'");
  addColumn(db, "products", "vat_rate_source", "TEXT NOT NULL DEFAULT 'ORGANIZATION'");
  addColumn(db, "products", "vat_treatment", "TEXT NOT NULL DEFAULT ''");
  addColumn(db, "products", "vat_rate_bp", "INTEGER");
  addColumn(db, "orders", "tax_data_status", "TEXT NOT NULL DEFAULT 'LEGACY'");
  addColumn(db, "orders", "prices_include_vat", "INTEGER");
  addColumn(db, "orders", "tax_calculation_version", "INTEGER");
  addColumn(db, "orders", "subtotal_without_vat", "INTEGER");
  addColumn(db, "orders", "vat_total", "INTEGER");
  addColumn(db, "orders", "grand_total", "INTEGER");
  addColumn(db, "order_items", "unit_price", "INTEGER");
  addColumn(db, "order_items", "price_includes_vat", "INTEGER");
  addColumn(db, "order_items", "vat_treatment", "TEXT");
  addColumn(db, "order_items", "vat_rate_bp", "INTEGER");
  addColumn(db, "order_items", "unit_price_without_vat", "INTEGER");
  addColumn(db, "order_items", "unit_vat_amount", "INTEGER");
  addColumn(db, "order_items", "unit_price_with_vat", "INTEGER");
  addColumn(db, "order_items", "line_amount_without_vat", "INTEGER");
  addColumn(db, "order_items", "line_vat_amount", "INTEGER");
  addColumn(db, "order_items", "line_amount_with_vat", "INTEGER");
  addColumn(db, "orders", "phone_key", "TEXT NOT NULL DEFAULT ''");
  db.exec("CREATE INDEX IF NOT EXISTS orders_phone_key ON orders (phone_key)");
  backfillPhoneKeys(db);
}

function backfillPhoneKeys(db) {
  const rows = db.prepare("SELECT id, phone FROM orders WHERE phone_key = ''").all();
  if (!rows.length) return;
  const update = db.prepare("UPDATE orders SET phone_key = ? WHERE id = ?");
  for (const row of rows) update.run(clientPhoneKey(row.phone), row.id);
}

function setting(db, key) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? row.value : "";
}

function jsonSource(root, name) {
  const live = path.join(root, "data", name);
  const bak = `${live}.bak`;
  if (fs.existsSync(live)) return { file: live, retire: true };
  if (fs.existsSync(bak)) return { file: bak, retire: false };
  return null;
}

function readJsonArray(file) {
  const raw = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  if (!raw.trim()) return [];
  const parsed = JSON.parse(raw);
  if (parsed == null) return [];
  return Array.isArray(parsed) ? parsed : [parsed];
}

function retireJson(file) {
  const bak = `${file}.bak`;
  if (fs.existsSync(bak)) fs.rmSync(file);
  else fs.renameSync(file, bak);
}

function migrateJson(db, root) {
  if (setting(db, STORAGE_KEY) === STORAGE_VALUE) {
    return { products: 0, orders: 0, already: true };
  }

  const productSource = jsonSource(root, "products.json");
  const orderSource = jsonSource(root, "orders.json");
  const productRows = productSource ? readJsonArray(productSource.file) : SEED_PRODUCTS;
  const orderRows = orderSource ? readJsonArray(orderSource.file) : [];
  const products = [];
  const seenProducts = new Set();
  for (const item of productRows) {
    const product = normalizeProduct(item, products.length);
    if (!product) throw new Error("SQLite import rejected a product");
    if (seenProducts.has(product.id)) throw new Error("SQLite import found a duplicate product");
    seenProducts.add(product.id);
    products.push(product);
  }

  const orders = [];
  const seenOrders = new Set();
  for (const item of orderRows) {
    const order = normalizeOrder(item, { keepStatus: true });
    if (!order) throw new Error("SQLite import rejected an order");
    if (seenOrders.has(order.id)) throw new Error("SQLite import found a duplicate order");
    seenOrders.add(order.id);
    orders.push(order);
  }

  withTransaction(db, () => {
    const insertProduct = db.prepare(
      "INSERT INTO products (id, name, price, unit, description, image, position) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    products.forEach((product, index) => {
      insertProduct.run(product.id, product.name, product.price, product.unit, product.description, product.image, index);
    });
    for (const order of orders) insertOrder(db, order);
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(STORAGE_KEY, STORAGE_VALUE);
  });

  try {
    if (productSource && productSource.retire) retireJson(productSource.file);
    if (orderSource && orderSource.retire) retireJson(orderSource.file);
  } catch (err) {
    console.error(err && err.message ? err.message : err);
  }
  return { products: products.length, orders: orders.length, already: false };
}

function withTransaction(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* ignore rollback failure */
    }
    throw err;
  }
}

function clip(value, max) {
  const text = String(value ?? "").trim();
  return text.length > max ? text.slice(0, max) : text;
}

export function normalizeProduct(item, index = 0) {
  if (!item || typeof item !== "object") return null;
  const name = clip(item.name, 200);
  const price = clip(item.price, 40);
  if (!name || !price) return null;
  let unit = clip(item.unit, 20) || "шт";
  const description = clip(item.description, 800);
  let image = String(item.image ?? "").trim() || DEFAULT_IMAGE;
  if (image.length > 2097152) return null;
  let id = clip(item.id, 64);
  if (!id) id = "p" + Date.now().toString(16) + index.toString(16);
  const vat = readVatInput(item);
  return { id, name, price, unit, description, image, vat };
}

function readVatInput(item) {
  if (!item || !Object.prototype.hasOwnProperty.call(item, "vatRateSource")) return null;
  const source = item.vatRateSource === "PRODUCT" ? "PRODUCT" : "ORGANIZATION";
  if (source === "ORGANIZATION") {
    return { vatRateSource: "ORGANIZATION", vatTreatment: "", vatRateBp: null };
  }
  const treatment = String(item.vatTreatment || "").trim().toUpperCase();
  if (!PRODUCT_TREATMENTS.includes(treatment)) {
    throw new DbError(400, "invalid vat treatment");
  }
  const needsRate = treatment === "CUSTOM" || treatment === "STANDARD";
  const rateBp = item.vatRate == null || item.vatRate === "" ? null : percentToBasisPoints(item.vatRate);
  if (needsRate && rateBp == null) throw new DbError(400, "invalid vat rate");
  if (item.vatRate != null && item.vatRate !== "" && rateBp == null) throw new DbError(400, "invalid vat rate");
  return {
    vatRateSource: "PRODUCT",
    vatTreatment: treatment,
    vatRateBp: treatment === "ZERO" ? 0 : treatment === "EXEMPT" || treatment === "NOT_APPLICABLE" ? null : rateBp,
  };
}

export function isKzPhone(phone) {
  let digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("8")) digits = "7" + digits.slice(1);
  if (digits.length === 10) digits = "7" + digits;
  return digits.length === 11 && digits.startsWith("7");
}

function normalizeOrder(body, options = {}) {
  if (!body || typeof body !== "object") return null;
  const name = clip(body.name, 120);
  const phone = clip(body.phone, 40);
  if (!name || !phone || !isKzPhone(phone)) return null;
  const items = normalizeItems(body.items);
  if (!items.length) return null;
  let channel = clip(body.channel, 20).toLowerCase();
  if (channel !== "telegram") channel = "whatsapp";
  let status = clip(body.status, 20).toLowerCase();
  if (!options.keepStatus || !["new", "done", "cancelled"].includes(status)) status = "new";
  const id = clip(body.id, 64) || "o" + Date.now().toString(16);
  const createdAt = clip(body.createdAt, 64) || new Date().toISOString();
  return {
    id,
    createdAt,
    name,
    phone,
    comment: clip(body.comment, 500),
    currency: clip(body.currency, 8) || "kzt",
    total: clip(body.total, 80),
    channel,
    status,
    items,
  };
}

function normalizeItems(value) {
  const source = Array.isArray(value) ? value : [];
  const items = [];
  for (const item of source) {
    if (!item || typeof item !== "object") continue;
    const name = clip(item.name, 200);
    if (!name) continue;
    let qty = Number.parseInt(item.qty, 10);
    if (!Number.isFinite(qty)) qty = 1;
    qty = Math.min(999, Math.max(1, qty));
    items.push({
      id: clip(item.id, 64),
      name,
      unit: clip(item.unit, 20) || "шт",
      qty,
      price: clip(item.price, 80),
      lineTotal: clip(item.lineTotal, 80),
    });
    if (items.length >= 50) break;
  }
  return items;
}

function toProduct(row) {
  return {
    id: row.id,
    name: row.name,
    price: row.price,
    unit: row.unit,
    description: row.description,
    image: row.image,
    vatStatus: row.vat_status || "VAT_NOT_CONFIGURED",
    vatRateSource: row.vat_rate_source || "ORGANIZATION",
    vatTreatment: row.vat_treatment || "",
    vatRateBp: row.vat_rate_bp == null ? null : Number(row.vat_rate_bp),
  };
}

function toOrder(row, items) {
  const status = row.tax_data_status || "LEGACY";
  const order = {
    id: row.id,
    createdAt: row.created_at,
    name: row.name,
    phone: row.phone,
    comment: row.comment,
    currency: row.currency,
    total: row.total,
    channel: row.channel,
    status: row.status,
    taxDataStatus: status,
    pricesIncludeVat: row.prices_include_vat == null ? null : row.prices_include_vat === 1,
    taxCalculationVersion: row.tax_calculation_version == null ? null : Number(row.tax_calculation_version),
    subtotalWithoutVat: row.subtotal_without_vat == null ? null : Number(row.subtotal_without_vat),
    vatTotal: row.vat_total == null ? null : Number(row.vat_total),
    grandTotal: row.grand_total == null ? null : Number(row.grand_total),
    items,
  };
  if (status === "SNAPSHOT") {
    const presented = presentQuote({
      version: order.taxCalculationVersion,
      pricesIncludeVat: order.pricesIncludeVat === true,
      totals: { net: order.subtotalWithoutVat || 0, vat: order.vatTotal || 0, gross: order.grandTotal || 0 },
      groups: snapshotGroups(items),
      lines: [],
    });
    order.subtotalWithoutVatText = presented.subtotalWithoutVatText;
    order.vatTotalText = presented.vatTotalText;
    order.grandTotalText = presented.grandTotalText;
    order.taxLines = presented.taxLines;
  }
  return order;
}

function snapshotGroups(items) {
  const groups = new Map();
  for (const item of items) {
    if (item.vatAmount == null && item.amountWithoutVat == null) continue;
    const rate = item.vatRateBp == null ? null : (item.vatRateBp / 100).toFixed(2);
    const key = `${item.vatTreatment || ""}|${rate || ""}`;
    const current = groups.get(key) || { treatment: item.vatTreatment, rateBp: item.vatRateBp, net: 0, vat: 0 };
    current.net += item.amountWithoutVat || 0;
    current.vat += item.vatAmount || 0;
    groups.set(key, current);
  }
  return [...groups.values()].map((group) => ({
    treatment: group.treatment,
    rate: group.rateBp == null ? null : (group.rateBp / 100).toFixed(2),
    caption: captionFor(group.treatment, group.rateBp),
    net: group.net,
    vat: group.vat,
  }));
}

function captionFor(treatment, rateBp) {
  const rate = rateBp == null ? null : (rateBp / 100).toFixed(2);
  if (treatment === "EXEMPT") return "Освобождено";
  if (treatment === "NOT_APPLICABLE") return "НДС не применяется";
  if (treatment === "ZERO" || rateBp === 0) return "НДС 0%";
  if (!rate) return "НДС";
  return `НДС ${String(rate).replace(/\.00$/, "").replace(".", ",")}%`;
}

function mapItems(rows) {
  return rows.map((item) => ({
    id: item.product_id,
    name: item.name,
    unit: item.unit,
    qty: item.qty,
    price: item.price,
    lineTotal: item.line_total,
    vatTreatment: item.vat_treatment || null,
    vatRateBp: item.vat_rate_bp == null ? null : Number(item.vat_rate_bp),
    priceIncludesVat: item.price_includes_vat == null ? null : item.price_includes_vat === 1,
    unitPriceWithoutVat: item.unit_price_without_vat == null ? null : Number(item.unit_price_without_vat),
    unitVatAmount: item.unit_vat_amount == null ? null : Number(item.unit_vat_amount),
    unitPriceWithVat: item.unit_price_with_vat == null ? null : Number(item.unit_price_with_vat),
    amountWithoutVat: item.line_amount_without_vat == null ? null : Number(item.line_amount_without_vat),
    vatAmount: item.line_vat_amount == null ? null : Number(item.line_vat_amount),
    amountWithVat: item.line_amount_with_vat == null ? null : Number(item.line_amount_with_vat),
  }));
}

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function safeUploadId(id) {
  const clean = String(id || "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 80);
  return clean || "img";
}

function imageExtension(kind) {
  const lower = String(kind || "").toLowerCase();
  if (lower === "jpeg" || lower === "jpg") return "jpg";
  if (lower === "png" || lower === "webp" || lower === "gif") return lower;
  return "";
}

function stageImage(db, id, image) {
  const value = String(image || "");
  if (!value.startsWith("data:")) {
    return { image: value, finish() {}, cancel() {} };
  }
  const match = /^data:image\/(png|jpeg|jpg|webp|gif);base64,([A-Za-z0-9+/=\r\n]+)$/i.exec(value);
  if (!match) throw new DbError(400, "invalid image");
  const bytes = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (!bytes.length || bytes.length > 2097152) throw new DbError(400, "invalid image");
  const root = mediaRoots.get(db);
  if (!root) throw new DbError(500, "media root missing");
  const ext = imageExtension(match[1]);
  const safeId = safeUploadId(id);
  const relative = `assets/products/uploads/${safeId}.${ext}`;
  const uploads = path.resolve(root, "assets", "products", "uploads");
  const file = path.resolve(root, relative);
  if (!file.startsWith(uploads + path.sep)) throw new DbError(400, "invalid image");
  fs.mkdirSync(uploads, { recursive: true });
  const tmp = path.join(uploads, `${safeId}.${ext}.tmp`);
  fs.writeFileSync(tmp, bytes);
  return {
    image: relative,
    finish() {
      fs.copyFileSync(tmp, file);
      fs.rmSync(tmp, { force: true });
      for (const otherExt of ["png", "jpg", "webp", "gif"]) {
        if (otherExt === ext) continue;
        fs.rmSync(path.join(uploads, `${safeId}.${otherExt}`), { force: true });
      }
    },
    cancel() {
      fs.rmSync(tmp, { force: true });
    },
  };
}

function clientPhoneKey(phone) {
  let digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("8")) digits = "7" + digits.slice(1);
  if (digits.length === 10) digits = "7" + digits;
  return digits || String(phone || "").trim();
}

function sameStoredProduct(row, product, position) {
  return (
    row.name === product.name &&
    row.price === product.price &&
    row.unit === product.unit &&
    row.description === product.description &&
    row.image === product.image &&
    row.position === position
  );
}

export function listProducts(db) {
  return db
    .prepare(
      "SELECT id, name, price, unit, description, image, vat_status, vat_rate_source, vat_treatment, vat_rate_bp FROM products ORDER BY position ASC, id ASC"
    )
    .all()
    .map(toProduct);
}

export function replaceProducts(db, incoming) {
  if (!Array.isArray(incoming)) throw new DbError(400, "products required");
  if (incoming.length > PRODUCT_LIMIT) throw new DbError(400, `too many products (max ${PRODUCT_LIMIT})`);
  const stored = [];
  const seen = new Set();
  const staged = [];
  try {
    for (const item of incoming) {
      const product = normalizeProduct(item, stored.length);
      if (!product) throw new DbError(400, "invalid product");
      if (seen.has(product.id)) throw new DbError(400, "duplicate product id");
      seen.add(product.id);
      const step = stageImage(db, product.id, product.image);
      staged.push(step);
      stored.push({ ...product, image: step.image });
    }
    const org = readOrganization(db);
    const confirmed = Boolean(org && org.tax && org.tax.catalogPricesConfirmed === true);
    const current = db
      .prepare("SELECT id, name, price, unit, description, image, position FROM products")
      .all();
    const byId = new Map(current.map((row) => [row.id, row]));
    withTransaction(db, () => {
      const insert = db.prepare(
        "INSERT INTO products (id, name, price, unit, description, image, position) VALUES (?, ?, ?, ?, ?, ?, ?)"
      );
      const update = db.prepare(
        "UPDATE products SET name = ?, price = ?, unit = ?, description = ?, image = ?, position = ? WHERE id = ?"
      );
      stored.forEach((product, index) => {
        const prev = byId.get(product.id);
        if (!prev) {
          insert.run(product.id, product.name, product.price, product.unit, product.description, product.image, index);
          if (confirmed) {
            db.prepare(
              "UPDATE products SET vat_status = 'INHERIT' WHERE id = ? AND vat_status = 'VAT_NOT_CONFIGURED'"
            ).run(product.id);
          }
          return;
        }
        if (sameStoredProduct(prev, product, index)) return;
        update.run(product.name, product.price, product.unit, product.description, product.image, index, product.id);
      });
      const remove = db.prepare("DELETE FROM products WHERE id = ?");
      for (const row of current) {
        if (!seen.has(row.id)) remove.run(row.id);
      }
    });
  } catch (err) {
    for (const step of staged) step.cancel();
    throw err;
  }
  for (const step of staged) step.finish();
  return stored;
}

export function saveProduct(db, data, options = {}) {
  const product = normalizeProduct(data, 0);
  if (!product) throw new DbError(400, "invalid product");
  const existing = db.prepare("SELECT id FROM products WHERE id = ?").get(product.id);
  if (options.create && existing) throw new DbError(409, "product exists");
  if (!options.create && !existing) throw new DbError(404, "product not found");
  if (options.create) {
    const count = db.prepare("SELECT COUNT(*) AS n FROM products").get();
    if (Number(count && count.n) >= PRODUCT_LIMIT) {
      throw new DbError(400, `too many products (max ${PRODUCT_LIMIT})`);
    }
  }
  const staged = stageImage(db, product.id, product.image);
  product.image = staged.image;
  const org = readOrganization(db);
  const confirmed = Boolean(org && org.tax && org.tax.catalogPricesConfirmed === true);
  try {
    withTransaction(db, () => {
      if (options.create) {
        db.prepare("UPDATE products SET position = position + 1").run();
        db.prepare(
          "INSERT INTO products (id, name, price, unit, description, image, position) VALUES (?, ?, ?, ?, ?, ?, 0)"
        ).run(product.id, product.name, product.price, product.unit, product.description, product.image);
      } else {
        db.prepare(
          "UPDATE products SET name = ?, price = ?, unit = ?, description = ?, image = ? WHERE id = ?"
        ).run(product.name, product.price, product.unit, product.description, product.image, product.id);
      }
      if (product.vat) {
        const status = !confirmed ? "VAT_NOT_CONFIGURED" : product.vat.vatRateSource === "PRODUCT" ? "CONFIGURED" : "INHERIT";
        db.prepare(
          "UPDATE products SET vat_rate_source = ?, vat_treatment = ?, vat_rate_bp = ?, vat_status = ? WHERE id = ?"
        ).run(product.vat.vatRateSource, product.vat.vatTreatment, product.vat.vatRateBp, status, product.id);
      }
    });
  } catch (err) {
    staged.cancel();
    throw err;
  }
  staged.finish();
  return toProduct(
    db.prepare(
      "SELECT id, name, price, unit, description, image, vat_status, vat_rate_source, vat_treatment, vat_rate_bp FROM products WHERE id = ?"
    ).get(product.id)
  );
}

function removeUploadFile(db, image) {
  const relative = String(image || "");
  if (!relative.startsWith("assets/products/uploads/")) return;
  const root = mediaRoots.get(db);
  if (!root) return;
  const uploads = path.resolve(root, "assets", "products", "uploads");
  const file = path.resolve(root, relative);
  if (!file.startsWith(uploads + path.sep)) return;
  fs.rmSync(file, { force: true });
}

export function removeProduct(db, id) {
  const key = String(id || "").trim();
  if (!key) throw new DbError(400, "product id required");
  const row = db.prepare("SELECT image FROM products WHERE id = ?").get(key);
  const result = db.prepare("DELETE FROM products WHERE id = ?").run(key);
  if (!result.changes) throw new DbError(404, "product not found");
  if (row) removeUploadFile(db, row.image);
  return { id: key };
}

export function listOrders(db, options = {}) {
  const limit = clampInt(options.limit, 50, 1, 100);
  const offset = clampInt(options.offset, 0, 0, 1000000);
  const totals = db
    .prepare(
      "SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) AS fresh FROM orders"
    )
    .get();
  const total = Number(totals && totals.total) || 0;
  const fresh = Number(totals && totals.fresh) || 0;
  const orders = db
    .prepare(
      `SELECT id, created_at, name, phone, comment, currency, total, channel, status,
              tax_data_status, prices_include_vat, tax_calculation_version,
              subtotal_without_vat, vat_total, grand_total
       FROM orders
       ORDER BY created_at DESC, id DESC
       LIMIT ? OFFSET ?`
    )
    .all(limit, offset);
  if (!orders.length) return { orders: [], total, fresh };
  const items = db
    .prepare(
      `SELECT order_id, product_id, name, unit, qty, price, line_total, position,
              vat_treatment, vat_rate_bp, price_includes_vat,
              unit_price_without_vat, unit_vat_amount, unit_price_with_vat,
              line_amount_without_vat, line_vat_amount, line_amount_with_vat
       FROM order_items
       WHERE order_id IN (${orders.map(() => "?").join(", ")})
       ORDER BY position ASC, id ASC`
    )
    .all(...orders.map((row) => row.id));
  const grouped = new Map();
  for (const item of items) {
    if (!grouped.has(item.order_id)) grouped.set(item.order_id, []);
    grouped.get(item.order_id).push(item);
  }
  return {
    orders: orders.map((row) => toOrder(row, mapItems(grouped.get(row.id) || []))),
    total,
    fresh,
  };
}

export function listClients(db, limit = 200) {
  const cap = clampInt(limit, 200, 1, 500);
  const clients = db
    .prepare(
      `WITH ranked AS (
         SELECT id, created_at, name, phone, phone_key, total, channel,
                ROW_NUMBER() OVER (
                  PARTITION BY CASE WHEN phone_key = '' THEN 'id:' || id ELSE phone_key END
                  ORDER BY created_at DESC, id DESC
                ) AS rn,
                COUNT(*) OVER (
                  PARTITION BY CASE WHEN phone_key = '' THEN 'id:' || id ELSE phone_key END
                ) AS orders_count
         FROM orders
       )
       SELECT id AS lastOrderId, created_at AS lastAt, name, phone, phone_key AS phoneKey,
              total AS lastTotal, channel, orders_count AS ordersCount
       FROM ranked
       WHERE rn = 1
       ORDER BY lastAt DESC, lastOrderId DESC
       LIMIT ?`
    )
    .all(cap);
  if (!clients.length) return [];
  const items = db
    .prepare(
      `SELECT order_id, product_id, name, unit, qty, price, line_total,
              vat_treatment, vat_rate_bp, price_includes_vat,
              unit_price_without_vat, unit_vat_amount, unit_price_with_vat,
              line_amount_without_vat, line_vat_amount, line_amount_with_vat
       FROM order_items
       WHERE order_id IN (${clients.map(() => "?").join(", ")})
       ORDER BY position ASC, id ASC`
    )
    .all(...clients.map((client) => client.lastOrderId));
  const grouped = new Map();
  for (const item of items) {
    if (!grouped.has(item.order_id)) grouped.set(item.order_id, []);
    grouped.get(item.order_id).push(item);
  }
  return clients.map((client) => ({
    name: client.name || "—",
    phone: client.phone,
    phoneKey: client.phoneKey,
    ordersCount: Number(client.ordersCount) || 0,
    lastAt: client.lastAt,
    lastTotal: client.lastTotal,
    channel: client.channel,
    lastOrder: {
      id: client.lastOrderId,
      name: client.name === "—" ? "" : client.name,
      phone: client.phone,
      total: client.lastTotal,
      channel: client.channel,
      items: mapItems(grouped.get(client.lastOrderId) || []),
    },
  }));
}

export function getOrder(db, id) {
  const row = db
    .prepare(
      `SELECT id, created_at, name, phone, comment, currency, total, channel, status,
              tax_data_status, prices_include_vat, tax_calculation_version,
              subtotal_without_vat, vat_total, grand_total
       FROM orders WHERE id = ?`
    )
    .get(id);
  if (!row) return null;
  const items = db
    .prepare(
      `SELECT product_id, name, unit, qty, price, line_total,
              vat_treatment, vat_rate_bp, price_includes_vat,
              unit_price_without_vat, unit_vat_amount, unit_price_with_vat,
              line_amount_without_vat, line_vat_amount, line_amount_with_vat
       FROM order_items WHERE order_id = ? ORDER BY position ASC, id ASC`
    )
    .all(id);
  return toOrder(row, mapItems(items));
}

function insertOrder(db, order) {
  db.prepare(
    `INSERT INTO orders (id, created_at, name, phone, comment, currency, total, channel, status, phone_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    order.id,
    order.createdAt,
    order.name,
    order.phone,
    order.comment,
    order.currency,
    order.total,
    order.channel,
    order.status,
    clientPhoneKey(order.phone)
  );
  const insertItem = db.prepare(
    `INSERT INTO order_items (order_id, product_id, name, unit, qty, price, line_total, position)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  order.items.forEach((item, index) => {
    insertItem.run(order.id, item.id, item.name, item.unit, item.qty, item.price, item.lineTotal, index);
  });
}

const ORDER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function requestedItems(items) {
  try {
    return collectOrderItems(items);
  } catch (err) {
    throw new DbError(err && err.status ? err.status : 400, err && err.message ? err.message : "invalid order");
  }
}

function requestKey(parts) {
  const items = [...parts.items].map((item) => `${item.id}\t${item.qty}`).sort().join("\n");
  return [clientPhoneKey(parts.phone), parts.name, parts.comment, parts.channel, items].join("\n");
}

function sameOrderRequest(existing, parts) {
  return (
    requestKey({
      phone: existing.phone,
      name: existing.name,
      comment: existing.comment || "",
      channel: existing.channel === "telegram" ? "telegram" : "whatsapp",
      items: (existing.items || []).map((item) => ({ id: item.id, qty: item.qty })),
    }) === requestKey(parts)
  );
}

function isUniqueOrder(err) {
  const message = String(err && err.message ? err.message : "");
  return message.includes("UNIQUE constraint");
}

function commitNewOrder(db, order, insert) {
  try {
    withTransaction(db, () => insert());
  } catch (err) {
    if (!isUniqueOrder(err)) throw err;
    const existing = getOrder(db, order.id);
    if (existing && sameOrderRequest(existing, order)) return { order: existing, duplicate: true };
    throw new DbError(409, "order id already used");
  }
  const saved = getOrder(db, order.id);
  return { order: saved || order, duplicate: false };
}

export function importStoredOrder(db, body) {
  const order = normalizeOrder(body, { keepStatus: true });
  if (!order) throw new DbError(400, "invalid order");
  const existing = getOrder(db, order.id);
  if (existing) return { order: existing, duplicate: true };
  return commitNewOrder(db, order, () => insertOrder(db, order));
}

export function createOrder(db, body) {
  if (!body || typeof body !== "object") throw new DbError(400, "invalid json");
  const name = clip(body.name, 120);
  const phone = clip(body.phone, 40);
  if (!name || !phone) throw new DbError(400, "name and phone required");
  if (!isKzPhone(phone)) throw new DbError(400, "invalid phone");
  const items = requestedItems(body.items);
  let channel = clip(body.channel, 20).toLowerCase();
  if (channel !== "telegram") channel = "whatsapp";
  const comment = clip(body.comment, 500);
  let id = clip(body.id, 64);
  if (id && !ORDER_ID_RE.test(id)) throw new DbError(400, "invalid id");
  if (!id) id = "o" + randomBytes(9).toString("hex");
  const draft = { id, createdAt: new Date().toISOString(), name, phone, comment, channel, items };
  const existing = getOrder(db, id);
  if (existing) {
    if (!sameOrderRequest(existing, draft)) throw new DbError(409, "order id already used");
    return { order: existing, duplicate: true };
  }
  const org = readOrganization(db);
  if (org && org.tax && org.tax.catalogPricesConfirmed === true) return createSnapshotOrder(db, draft, org);
  return createCatalogOrder(db, draft);
}

function createCatalogOrder(db, draft) {
  const byId = new Map(listProducts(db).map((product) => [product.id, product]));
  const items = [];
  let totalTiyn = 0;
  for (const requested of draft.items) {
    const product = byId.get(requested.id);
    if (!product) throw new DbError(400, "unknown product");
    const unit = parsePriceToTiyn(product.price);
    if (unit == null) throw new DbError(400, "invalid price");
    const line = unit * requested.qty;
    if (!Number.isSafeInteger(line)) throw new DbError(400, "invalid price");
    totalTiyn += line;
    items.push({
      id: product.id,
      name: product.name,
      unit: product.unit || "шт",
      qty: requested.qty,
      price: formatTiyn(unit),
      lineTotal: formatTiyn(line),
    });
  }
  if (!Number.isSafeInteger(totalTiyn)) throw new DbError(400, "invalid price");
  const order = {
    id: draft.id,
    createdAt: draft.createdAt,
    name: draft.name,
    phone: draft.phone,
    comment: draft.comment,
    currency: "kzt",
    total: formatTiyn(totalTiyn),
    channel: draft.channel,
    status: "new",
    items,
  };
  return commitNewOrder(db, order, () => insertOrder(db, order));
}

export function quoteOrder(db, items) {
  const org = readOrganization(db);
  const products = listProducts(db);
  try {
    const quote = quoteOrderLines(normalizeQuoteItems(items), products, org);
    return presentQuote(quote);
  } catch (err) {
    throw new DbError(err && err.status ? err.status : 400, err && err.message ? err.message : "invalid order");
  }
}

function normalizeQuoteItems(value) {
  const source = Array.isArray(value) ? value : [];
  return source.map((item) => {
    const raw = item && item.qty;
    const qty = Number.isInteger(raw) ? raw : Number(raw);
    return { id: item && item.id, qty };
  });
}

function createSnapshotOrder(db, draft, org) {
  let quote;
  try {
    quote = quoteOrderLines(draft.items, listProducts(db), org);
  } catch (err) {
    throw new DbError(err && err.status ? err.status : 400, err && err.message ? err.message : "invalid order");
  }
  const view = presentQuote(quote);
  const order = {
    id: draft.id,
    createdAt: draft.createdAt,
    name: draft.name,
    phone: draft.phone,
    comment: draft.comment,
    currency: "kzt",
    total: view.grandTotalText,
    channel: draft.channel,
    status: "new",
    items: view.items.map((item) => ({
      id: item.id,
      name: item.name,
      unit: item.unit,
      qty: item.qty,
      price: item.price,
      lineTotal: item.lineTotal,
    })),
  };
  return commitNewOrder(db, order, () => insertSnapshotOrder(db, order, view));
}

function insertSnapshotOrder(db, order, view) {
  db.prepare(
    `INSERT INTO orders (
      id, created_at, name, phone, comment, currency, total, channel, status, phone_key,
      tax_data_status, prices_include_vat, tax_calculation_version,
      subtotal_without_vat, vat_total, grand_total
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SNAPSHOT', ?, ?, ?, ?, ?)`
  ).run(
    order.id,
    order.createdAt,
    order.name,
    order.phone,
    order.comment,
    order.currency,
    order.total,
    order.channel,
    order.status,
    clientPhoneKey(order.phone),
    view.pricesIncludeVat ? 1 : 0,
    view.taxCalculationVersion,
    view.subtotalWithoutVat,
    view.vatTotal,
    view.grandTotal
  );
  const insertItem = db.prepare(
    `INSERT INTO order_items (
      order_id, product_id, name, unit, qty, price, line_total, position,
      unit_price, price_includes_vat, vat_treatment, vat_rate_bp,
      unit_price_without_vat, unit_vat_amount, unit_price_with_vat,
      line_amount_without_vat, line_vat_amount, line_amount_with_vat
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  view.items.forEach((item, index) => {
    insertItem.run(
      order.id,
      item.id,
      item.name,
      item.unit,
      item.qty,
      item.price,
      item.lineTotal,
      index,
      item.unitPrice,
      item.priceIncludesVat ? 1 : 0,
      item.vatTreatment,
      item.vatRate == null ? null : percentToBasisPoints(item.vatRate),
      item.unitPriceWithoutVat,
      item.unitVatAmount,
      item.unitPriceWithVat,
      item.amountWithoutVat,
      item.vatAmount,
      item.amountWithVat
    );
  });
}

export function updateOrderStatus(db, id, status) {
  const orderId = clip(id, 64);
  if (!orderId) throw new DbError(400, "id required");
  const next = clip(status, 20).toLowerCase();
  if (!["new", "done", "cancelled"].includes(next)) {
    throw new DbError(400, "status must be new|done|cancelled");
  }
  const result = db.prepare("UPDATE orders SET status = ? WHERE id = ?").run(next, orderId);
  if (!result.changes) throw new DbError(404, "order not found");
  return { id: orderId, status: next };
}
