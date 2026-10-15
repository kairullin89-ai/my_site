import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAdminSession, dropAdminSession } from "./adminAuth.js";
import { assertRuntimeConfig } from "./config.js";
import { handleData } from "./dataApi.js";
import { closeDatabase, getOrder, listProducts, openDatabase } from "./db.js";
import { handleOrganization, readOrganization } from "./organization.js";
import { handleChat } from "./handle.js";
import {
  parseCatalogRequest,
  renderCatalogPdf,
  selectCatalogProducts,
} from "./pdf/catalogTemplate.js";
import { handleInvoiceFacturaPdfRequest } from "./pdf/invoiceFacturaTemplate.js";
import { handleInvoicePdfRequest } from "./pdf/invoiceTemplate.js";
import { handleOrderPdfRequest } from "./pdf/orderTemplate.js";
import { clientIp, guardRate, servePublicFile } from "./publicSite.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT) || 5510;
const host = process.env.HOST || "127.0.0.1";
const publicSite = process.env.PUBLIC_SITE === "1";
const maxBody = 16 * 1024 * 1024;
const opened = openDatabase(root);
const db = opened.db;
if (!opened.imported.already) {
  console.log(`SQLite import: ${opened.imported.products} products, ${opened.imported.orders} orders`);
}
console.log(`SQLite ${opened.file}`);

function readEnv(file) {
  const map = {};
  if (!fs.existsSync(file)) return map;
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 1) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    map[key] = value;
  }
  for (const [key, value] of Object.entries(process.env)) {
    if (value == null || !String(value).length) continue;
    map[key] = value;
  }
  return map;
}

function readProducts() {
  return listProducts(db).filter((item) => item && item.name);
}

function catalogPricesIncludeVat() {
  const org = readOrganization(db);
  const tax = org && org.tax ? org.tax : null;
  if (!tax) return false;
  return tax.catalogPricesConfirmed === true && tax.pricesIncludeVat === true;
}

function contactsFromEnv(env) {
  const whatsapp = String(env.WHATSAPP_NUMBER || "").trim();
  const telegram = String(env.TELEGRAM_USERNAME || "").replace(/^@/, "").trim();
  const email = String(env.SUPPORT_EMAIL || "").trim();
  if (!whatsapp || !telegram || !email) {
    const error = new Error("contacts are not configured");
    error.status = 500;
    throw error;
  }
  return {
    whatsapp,
    whatsappUrl: `https://wa.me/${whatsapp}`,
    telegram,
    telegramUrl: telegram ? `https://t.me/${telegram}` : "",
    email,
  };
}

function logServerError(err, status = 500) {
  console.error(JSON.stringify({
    level: "error",
    status,
    message: err && err.message ? err.message : String(err),
    stack: err && err.stack ? err.stack : "",
  }));
}

function send(res, status, payload) {
  if (res.writableEnded || res.headersSent) return;
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function sendPdf(res, buffer, filename) {
  if (res.writableEnded || res.headersSent) return;
  res.writeHead(200, {
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Content-Length": buffer.length,
    "Cache-Control": "no-store",
  });
  res.end(buffer);
}

async function handleCatalog(req, res) {
  if (req.method !== "POST") {
    send(res, 405, { error: "method not allowed" });
    return;
  }
  let raw = "";
  try {
    raw = await readBody(req);
  } catch (err) {
    const status = err && err.status ? err.status : 400;
    send(res, status, { error: status === 413 ? "request too large" : "invalid request" });
    return;
  }
  let body = {};
  if (String(raw || "").trim()) {
    try {
      body = JSON.parse(raw);
    } catch {
      send(res, 400, { error: "invalid json" });
      return;
    }
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    send(res, 400, { error: "invalid json" });
    return;
  }
  const env = readEnv(path.join(root, ".env"));
  const parsed = parseCatalogRequest(body);
  if (parsed.error) {
    send(res, 400, { error: parsed.error });
    return;
  }
  const selected = selectCatalogProducts(listProducts(db), parsed.ids);
  if (selected.error) {
    send(res, 400, { error: selected.error });
    return;
  }
  try {
    const pdf = await renderCatalogPdf({
      root,
      products: selected.products,
      lang: parsed.lang,
      currency: parsed.currency,
      contacts: contactsFromEnv(env),
      now: new Date(),
    });
    sendPdf(res, pdf.buffer, pdf.filename);
  } catch (err) {
    logServerError(err);
    send(res, 500, { error: "catalog failed" });
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBody) {
        reject(Object.assign(new Error("request too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/api/health")) {
      const env = readEnv(path.join(root, ".env"));
      send(res, 200, { ok: true, openai: Boolean(env.OPENAI_API_KEY) });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/contacts") {
      const env = readEnv(path.join(root, ".env"));
      send(res, 200, { ok: true, ...contactsFromEnv(env) });
      return;
    }

    if (url.pathname === "/api/admin/session") {
      const env = readEnv(path.join(root, ".env"));
      if (req.method === "DELETE") {
        dropAdminSession(req.headers["x-admin-password"]);
        send(res, 200, { ok: true });
        return;
      }
      if (req.method !== "POST") {
        send(res, 405, { error: "method not allowed" });
        return;
      }
      if (publicSite && !guardRate("login", clientIp(req), 8)) {
        send(res, 429, { error: "Слишком много попыток. Подождите минуту." });
        req.resume();
        return;
      }
      const raw = await readBody(req);
      let body = {};
      try {
        body = raw && String(raw).trim() ? JSON.parse(raw) : {};
      } catch {
        send(res, 400, { error: "invalid json" });
        return;
      }
      const token = createAdminSession(env, body && body.password);
      if (!token) {
        send(res, 401, { error: "unauthorized" });
        return;
      }
      send(res, 200, { ok: true, token });
      return;
    }

    if (url.pathname === "/api/admin/organization") {
      const raw = req.method === "GET" || req.method === "HEAD" ? "" : await readBody(req);
      const env = readEnv(path.join(root, ".env"));
      const result = handleOrganization({
        db,
        method: req.method,
        raw,
        env,
        adminHeader: req.headers["x-admin-password"],
      });
      send(res, result.status, result.body);
      return;
    }

    if (url.pathname === "/api/products" || url.pathname === "/api/orders" || url.pathname === "/api/orders/quote") {
      if (publicSite && url.pathname === "/api/orders" && req.method === "POST" && !guardRate("order", clientIp(req), 12)) {
        send(res, 429, { error: "Слишком много заявок. Подождите минуту." });
        req.resume();
        return;
      }
      const raw = req.method === "GET" || req.method === "HEAD" ? "" : await readBody(req);
      const env = readEnv(path.join(root, ".env"));
      const result = handleData({
        db,
        method: req.method,
        pathname: url.pathname,
        searchParams: url.searchParams,
        raw,
        env,
        adminHeader: req.headers["x-admin-password"],
      });
      send(res, result.status, result.body);
      return;
    }

    if (url.pathname === "/api/documents/catalog") {
      if (publicSite && req.method === "POST" && !guardRate("catalog", clientIp(req), 10)) {
        send(res, 429, { error: "Слишком много запросов. Подождите минуту." });
        req.resume();
        return;
      }
      await handleCatalog(req, res);
      return;
    }

    if (url.pathname === "/api/documents/order") {
      try {
        const result = await handleOrderPdfRequest({
          method: req.method,
          searchParams: url.searchParams,
          adminHeader: req.headers["x-admin-password"],
          env: readEnv(path.join(root, ".env")),
          getOrderById: (id) => getOrder(db, id),
          root,
        });
        if (result.pdf) sendPdf(res, result.pdf.buffer, result.pdf.filename);
        else send(res, result.status, result.json);
      } catch (err) {
        logServerError(err);
        send(res, 500, { error: "order failed" });
      }
      return;
    }

    if (url.pathname === "/api/documents/invoice") {
      try {
        const result = await handleInvoicePdfRequest({
          method: req.method,
          searchParams: url.searchParams,
          adminHeader: req.headers["x-admin-password"],
          env: readEnv(path.join(root, ".env")),
          getOrderById: (id) => getOrder(db, id),
          getOrganization: () => readOrganization(db),
          root,
        });
        if (result.pdf) sendPdf(res, result.pdf.buffer, result.pdf.filename);
        else send(res, result.status, result.json);
      } catch (err) {
        logServerError(err);
        send(res, 500, { error: "invoice failed" });
      }
      return;
    }

    if (url.pathname === "/api/documents/invoice-factura") {
      try {
        const result = await handleInvoiceFacturaPdfRequest({
          method: req.method,
          searchParams: url.searchParams,
          adminHeader: req.headers["x-admin-password"],
          env: readEnv(path.join(root, ".env")),
          getOrderById: (id) => getOrder(db, id),
          getOrganization: () => readOrganization(db),
          root,
        });
        if (result.pdf) sendPdf(res, result.pdf.buffer, result.pdf.filename);
        else send(res, result.status, result.json);
      } catch (err) {
        logServerError(err);
        send(res, 500, { error: "invoice factura failed" });
      }
      return;
    }

    if (req.method === "POST" && (url.pathname === "/chat" || url.pathname === "/api/barys")) {
      if (publicSite && !guardRate("chat", clientIp(req), 20)) {
        send(res, 429, { error: "Слишком много запросов. Подождите минуту." });
        req.resume();
        return;
      }
      const raw = await readBody(req);
      let body = {};
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        send(res, 400, { error: "invalid json" });
        return;
      }
      const message = body.message ? String(body.message) : "";
      const attachments = Array.isArray(body.attachments)
        ? body.attachments
        : body.attachments && typeof body.attachments === "object"
          ? [body.attachments]
          : [];
      if (!message.trim() && attachments.length < 1) {
        send(res, 400, { error: "message or attachment required" });
        return;
      }
      const env = readEnv(path.join(root, ".env"));
      const currency = ["kzt", "usd", "rub"].includes(body.currency) ? body.currency : "kzt";
      const result = await handleChat({
        message,
        history: body.history,
        attachments,
        products: readProducts(),
        currency,
        contacts: contactsFromEnv(env),
        pricesIncludeVat: catalogPricesIncludeVat(),
        apiKey: env.OPENAI_API_KEY || "",
        model: String(env.OPENAI_MODEL || "").trim(),
        root,
      });
      send(res, 200, result);
      return;
    }

    if (publicSite && servePublicFile(req, res, root)) return;

    send(res, 404, { error: "not found" });
  } catch (err) {
    const status = err && Number.isInteger(err.status) ? err.status : 500;
    if (status >= 500) logServerError(err, status);
    const message = status === 429
      ? (err && err.message ? err.message : "Превышен лимит запросов к ИИ-ассистенту. Пожалуйста, подождите")
      : status >= 500
        ? "Internal Server Error"
        : err && err.message
          ? err.message
          : "error";
    if (!res.headersSent) send(res, status, { error: message });
  }
});

server.on("error", (err) => {
  logServerError(err);
  process.exit(1);
});

process.on("unhandledRejection", (err) => {
  logServerError(err);
});

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 8000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

process.on("exit", () => {
  try {
    closeDatabase(db);
  } catch {
    /* ignore close on shutdown */
  }
});

assertRuntimeConfig(readEnv(path.join(root, ".env")));

server.listen(port, host, () => {
  console.log(`Barys worker http://${host}:${port}/`);
});
