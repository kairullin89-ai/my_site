import {
  createOrder,
  DbError,
  listClients,
  listOrders,
  listProducts,
  quoteOrder,
  removeProduct,
  replaceProducts,
  saveProduct,
  updateOrderStatus,
} from "./db.js";
import { isAdminCredential } from "./adminAuth.js";
import { readOrganization } from "./organization.js";

function fail(status, error) {
  const err = new DbError(status, error);
  return err;
}

function adminPassword(env, header, body) {
  return isAdminCredential(env, header, body);
}

function parseBody(raw) {
  if (!raw || !String(raw).trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    throw fail(400, "invalid json");
  }
}

function queryInt(searchParams, key, fallback, min, max) {
  if (!searchParams) return fallback;
  return clampQuery(searchParams.get(key), fallback, min, max);
}

function clampQuery(value, fallback, min, max) {
  if (value == null || value === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function handleData({ db, method, pathname, raw, env, adminHeader, searchParams }) {
  if (pathname === "/api/products" && method === "GET") {
    const products = listProducts(db);
    const org = readOrganization(db);
    const tax = org && org.tax ? org.tax : {};
    return {
      status: 200,
      body: {
        ok: true,
        products,
        count: products.length,
        tax: {
          catalogPricesConfirmed: tax.catalogPricesConfirmed === true,
          pricesIncludeVat: tax.pricesIncludeVat,
          vatRegistered: tax.vatRegistered === true,
          defaultVatRate: tax.defaultVatRate,
          defaultVatTreatment: tax.defaultVatTreatment,
        },
      },
    };
  }

  if (pathname === "/api/products" && method === "PUT") {
    const body = parseBody(raw);
    if (!adminPassword(env, adminHeader, body)) throw fail(401, "unauthorized");
    const incoming = Array.isArray(body) ? body : body.products;
    if (!Array.isArray(incoming)) throw fail(400, "products required");
    const products = replaceProducts(db, incoming);
    return { status: 200, body: { ok: true, products, count: products.length } };
  }

  if (pathname === "/api/products" && (method === "POST" || method === "PATCH")) {
    const body = parseBody(raw);
    if (!adminPassword(env, adminHeader, body)) throw fail(401, "unauthorized");
    const product = saveProduct(db, body.product || body, { create: method === "POST" });
    return { status: method === "POST" ? 201 : 200, body: { ok: true, product } };
  }

  if (pathname === "/api/products" && method === "DELETE") {
    const body = parseBody(raw);
    if (!adminPassword(env, adminHeader, body)) throw fail(401, "unauthorized");
    const removed = removeProduct(db, body.id);
    return { status: 200, body: { ok: true, id: removed.id } };
  }

  if (pathname === "/api/orders/quote" && method === "POST") {
    const body = parseBody(raw);
    const quote = quoteOrder(db, body.items);
    return { status: 200, body: { ok: true, configured: Boolean(quote), quote } };
  }

  if (pathname === "/api/orders" && method === "POST") {
    const body = parseBody(raw);
    const saved = createOrder(db, body);
    return {
      status: saved.duplicate ? 200 : 201,
      body: { ok: true, order: saved.order, duplicate: saved.duplicate || undefined },
    };
  }

  if (pathname === "/api/orders" && method === "GET") {
    if (!adminPassword(env, adminHeader, null)) throw fail(401, "unauthorized");
    if (searchParams && searchParams.get("view") === "clients") {
      const clients = listClients(db, queryInt(searchParams, "limit", 200, 1, 500));
      return { status: 200, body: { ok: true, clients, count: clients.length } };
    }
    const limit = queryInt(searchParams, "limit", 50, 1, 100);
    const offset = queryInt(searchParams, "offset", 0, 0, 1000000);
    const page = listOrders(db, { limit, offset });
    return {
      status: 200,
      body: { ok: true, orders: page.orders, count: page.total, fresh: page.fresh, limit, offset },
    };
  }

  if (pathname === "/api/orders" && method === "PATCH") {
    const body = parseBody(raw);
    if (!adminPassword(env, adminHeader, body)) throw fail(401, "unauthorized");
    const updated = updateOrderStatus(db, body.id, body.status);
    return { status: 200, body: { ok: true, id: updated.id, status: updated.status } };
  }

  throw fail(405, "method not allowed");
}
