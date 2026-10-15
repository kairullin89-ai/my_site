import {
  RATES,
  formatKztString,
  formatPrice,
  formatRounded,
  fromKzt,
  parseAmount,
  parseKzt,
  roundedAmount,
  toKzt,
} from "../../barys/money.js";

const PRODUCTS_KEY = "izim_products_v7";
const AUTH_KEY = "izim_admin_auth";
const SESSION_KEY = "izim_admin_session";
const CURRENCY_KEY = "izim_currency";
const CART_KEY = "izim_cart_v1";
const ORDERS_KEY = "izim_orders_v1";

export const MAX_CART_QTY = 999;
export const DEFAULT_IMAGE = "assets/products/plant.jpg";

export { formatKztString, formatPrice, fromKzt, parseAmount, parseKzt, toKzt };

export const SEED_PRODUCTS = [
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

const listeners = new Set();
let snapshot = null;
let catalogVersion = 0;
let catalogStatus = "loading";
let catalogError = "";
let catalogProducts = [];

function emit() {
  snapshot = buildSnapshot();
  listeners.forEach((fn) => fn());
}

function buildSnapshot() {
  return {
    products: getProducts(),
    catalogStatus,
    catalogError,
    cart: getCart(),
    currency: getCurrency(),
    authed: isAuthed(),
  };
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getSnapshot() {
  if (!snapshot) snapshot = buildSnapshot();
  return snapshot;
}

function uid() {
  return "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function getCurrency() {
  const c = localStorage.getItem(CURRENCY_KEY);
  return RATES[c] ? c : "kzt";
}

export function setCurrency(currency) {
  const key = RATES[currency] ? currency : "kzt";
  localStorage.setItem(CURRENCY_KEY, key);
  emit();
  return key;
}

export function getProducts() {
  return catalogProducts.slice();
}

export function getCatalogStatus() {
  return catalogStatus;
}

export function saveProducts(list) {
  catalogVersion += 1;
  catalogProducts = Array.isArray(list) ? list.slice() : [];
  catalogStatus = "ready";
  catalogError = "";
  localStorage.setItem(PRODUCTS_KEY, JSON.stringify(catalogProducts));
  emit();
}

export async function persistProductsToServer(list, password, attempt = 0) {
  const seen = catalogVersion;
  try {
    const res = await fetch("/api/products", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Password": password || adminCredential(),
      },
      body: JSON.stringify({ products: list }),
    });
    endedSession(res);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { ok: false, error: err.error || "Не удалось сохранить каталог" };
    }
    const data = await res.json();
    if (seen !== catalogVersion) {
      if (attempt < 2) return persistProductsToServer(getProducts(), password, attempt + 1);
      return {
        ok: false,
        error: "Каталог изменился во время сохранения. Нажмите сохранить ещё раз.",
      };
    }
    const products = Array.isArray(data.products) ? data.products : list;
    saveProducts(products);
    return { ok: true, products, error: null };
  } catch (e) {
    console.warn("Products save failed:", e);
    return {
      ok: false,
      error: (e && e.message) || "Сервер каталога недоступен",
    };
  }
}

function failCatalog(error) {
  console.error(error);
  catalogStatus = "error";
  catalogError = error && error.message ? error.message : "Не удалось загрузить каталог";
  catalogProducts = [];
  emit();
}

export async function loadProductsFromServer() {
  const seen = catalogVersion;
  let res;
  try {
    res = await fetch("/api/products");
  } catch (err) {
    if (seen !== catalogVersion) return getProducts();
    failCatalog(err instanceof Error ? err : new Error("Не удалось загрузить каталог"));
    throw err;
  }
  if (seen !== catalogVersion) return getProducts();
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const error = new Error(err.error || "Не удалось загрузить каталог");
    failCatalog(error);
    throw error;
  }
  const data = await res.json();
  if (seen !== catalogVersion) return getProducts();
  const serverList = Array.isArray(data.products) ? data.products : [];
  saveProducts(serverList);
  saveTaxProfile(data.tax);
  return serverList;
}

export function retryCatalog() {
  catalogStatus = "loading";
  catalogError = "";
  emit();
  return loadProductsFromServer();
}

let taxProfile = { catalogPricesConfirmed: false, pricesIncludeVat: null, vatRegistered: false, defaultVatRate: null };

function saveTaxProfile(tax) {
  if (!tax || typeof tax !== "object") return;
  taxProfile = {
    catalogPricesConfirmed: tax.catalogPricesConfirmed === true,
    pricesIncludeVat: tax.pricesIncludeVat === true ? true : tax.pricesIncludeVat === false ? false : null,
    vatRegistered: tax.vatRegistered === true,
    defaultVatRate: tax.defaultVatRate ?? null,
    defaultVatTreatment: tax.defaultVatTreatment || "",
  };
  emit();
}

export function getTaxProfile() {
  return taxProfile;
}

export async function quoteCart(items) {
  const res = await fetch("/api/orders/quote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return null;
  return body.quote || null;
}

export async function pushProductsToServer(password) {
  return persistProductsToServer(getProducts(), password);
}

async function writeProductRequest(method, body, password) {
  const res = await fetch("/api/products", {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Password": password || adminCredential(),
    },
    body: JSON.stringify(body),
  });
  endedSession(res);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return { ok: false, error: err.error || "Не удалось сохранить товар" };
  }
  const data = await res.json();
  return { ok: true, ...data };
}

export async function persistOneProduct(product, { create = false, password } = {}) {
  try {
    const result = await writeProductRequest(create ? "POST" : "PATCH", { product }, password);
    if (!result.ok) return result;
    const saved = result.product || product;
    const list = getProducts();
    const index = list.findIndex((item) => item.id === saved.id);
    if (index === -1) list.unshift(saved);
    else list[index] = saved;
    saveProducts(list);
    return { ok: true, product: saved, error: null };
  } catch (e) {
    console.warn("Product save failed:", e);
    return { ok: false, error: (e && e.message) || "Сервер каталога недоступен" };
  }
}

export async function deleteProductOnServer(id, password) {
  try {
    const result = await writeProductRequest("DELETE", { id }, password);
    if (!result.ok) return result;
    saveProducts(getProducts().filter((item) => item.id !== id));
    return { ok: true, error: null };
  } catch (e) {
    console.warn("Product delete failed:", e);
    return { ok: false, error: (e && e.message) || "Сервер каталога недоступен" };
  }
}

export function addProduct(data) {
  const list = getProducts();
  const item = {
    id: uid(),
    name: String(data.name || "").trim(),
    price: String(data.price || "").trim(),
    unit: String(data.unit || "шт").trim() || "шт",
    description: String(data.description || "").trim(),
    image: String(data.image || DEFAULT_IMAGE).trim() || DEFAULT_IMAGE,
    vatRateSource: data.vatRateSource || "ORGANIZATION",
    vatTreatment: data.vatTreatment || "",
    vatRate: data.vatRate ?? null,
  };
  if (!item.name || !item.price) return null;
  list.unshift(item);
  saveProducts(list);
  return item;
}

export function updateProduct(id, data) {
  const list = getProducts().map((p) => {
    if (p.id !== id) return p;
    return {
      ...p,
      name: String(data.name || "").trim(),
      price: String(data.price || "").trim(),
      unit: String(data.unit || "шт").trim() || "шт",
      description: String(data.description || "").trim(),
      image: String(data.image || DEFAULT_IMAGE).trim() || DEFAULT_IMAGE,
      vatRateSource: data.vatRateSource || p.vatRateSource || "ORGANIZATION",
      vatTreatment: data.vatTreatment || "",
      vatRate: data.vatRate ?? null,
    };
  });
  saveProducts(list);
}

export function deleteProduct(id) {
  saveProducts(getProducts().filter((p) => p.id !== id));
}

export function resetProducts() {
  saveProducts(SEED_PRODUCTS.slice());
}

export function clearProducts() {
  saveProducts([]);
}

function endedSession(res) {
  if (res && res.status === 401) logout();
  return res;
}

function adminCredential() {
  try {
    return sessionStorage.getItem(SESSION_KEY) || "";
  } catch {
    return "";
  }
}

export function isAuthed() {
  return Boolean(adminCredential());
}

export async function login(password) {
  let res;
  try {
    res = await fetch("/api/admin/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
  } catch {
    return "offline";
  }
  const body = await res.json().catch(() => ({}));
  if (res.status === 429) return "limited";
  if (!res.ok || !body.token) return res.status >= 500 ? "offline" : false;
  sessionStorage.setItem(SESSION_KEY, body.token);
  localStorage.removeItem(AUTH_KEY);
  emit();
  return true;
}

export function logout() {
  const token = adminCredential();
  sessionStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(AUTH_KEY);
  emit();
  if (!token) return;
  fetch("/api/admin/session", {
    method: "DELETE",
    headers: { "X-Admin-Password": token },
  }).catch(() => {});
}

export function normalizePhoneDigits(phone) {
  let digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("8")) {
    digits = "7" + digits.slice(1);
  }
  if (digits.length === 10) {
    digits = "7" + digits;
  }
  return digits;
}

export function isValidPhone(phone) {
  const digits = normalizePhoneDigits(phone);
  return digits.length === 11 && digits.startsWith("7");
}

export function formatPhoneDisplay(phone) {
  const digits = normalizePhoneDigits(phone);
  if (digits.length !== 11) return String(phone || "").trim();
  return `+${digits[0]} ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7, 9)} ${digits.slice(9, 11)}`;
}

export function getCart() {
  try {
    const raw = localStorage.getItem(CART_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveCart(items) {
  localStorage.setItem(CART_KEY, JSON.stringify(items));
  emit();
}

export function cartCount(cart) {
  const ids = new Set(getProducts().map((product) => product.id));
  return (cart || []).reduce((sum, item) => {
    if (!ids.has(item.id)) return sum;
    return sum + (Number(item.qty) || 0);
  }, 0);
}

export function addToCart(productId, qty) {
  const product = getProducts().find((p) => p.id === productId);
  if (!product) return null;

  const amount = Math.max(1, Math.min(MAX_CART_QTY, Math.floor(Number(qty) || 1)));
  const cart = getCart();
  const existing = cart.find((item) => item.id === productId);

  if (existing) {
    existing.qty = Math.min(MAX_CART_QTY, (Number(existing.qty) || 0) + amount);
  } else {
    cart.push({ id: product.id, qty: amount });
  }

  saveCart(cart);
  return cart;
}

export function setCartQty(productId, qty) {
  const amount = Math.max(0, Math.min(MAX_CART_QTY, Math.floor(Number(qty) || 0)));
  let cart = getCart();

  if (amount <= 0) {
    cart = cart.filter((item) => item.id !== productId);
  } else {
    const existing = cart.find((item) => item.id === productId);
    if (existing) existing.qty = amount;
    else cart.push({ id: productId, qty: amount });
  }

  saveCart(cart);
  return cart;
}

export function removeFromCart(productId) {
  saveCart(getCart().filter((item) => item.id !== productId));
}

export function clearCart() {
  saveCart([]);
}

export function getCartLines(currency) {
  const currencyKey = currency || getCurrency();
  const products = getProducts();
  return getCart()
    .map((item) => {
      const product = products.find((p) => p.id === item.id);
      if (!product) return null;
      const qty = Math.max(1, Math.min(MAX_CART_QTY, Math.floor(Number(item.qty) || 1)));
      const unitAmount = roundedAmount(product.price, currencyKey);
      const lineAmount = unitAmount * qty;
      return {
        id: product.id,
        name: product.name,
        unit: product.unit || "шт",
        image: product.image,
        price: product.price,
        qty,
        lineAmount,
        lineTotalKzt: parseKzt(product.price) * qty,
        unitFormatted: formatRounded(unitAmount, currencyKey),
        lineFormatted: formatRounded(lineAmount, currencyKey),
      };
    })
    .filter(Boolean);
}

export function getCartTotalFormatted(currency) {
  const currencyKey = currency || getCurrency();
  const total = getCartLines(currencyKey).reduce((sum, line) => sum + line.lineAmount, 0);
  return formatRounded(total, currencyKey);
}

function saveOrder(order) {
  let list = [];
  try {
    const raw = localStorage.getItem(ORDERS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) list = parsed;
    }
  } catch {
    list = [];
  }
  list.unshift(order);
  localStorage.setItem(ORDERS_KEY, JSON.stringify(list.slice(0, 50)));
  return order;
}

export function getLocalOrders() {
  try {
    const raw = localStorage.getItem(ORDERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function persistOrderToServer(order) {
  try {
    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(order),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { ok: false, status: res.status, order: null, error: err.error || "Не удалось сохранить заказ" };
    }
    const data = await res.json();
    return { ok: true, order: data.order || order, error: null };
  } catch (e) {
    console.warn("CRM save failed:", e);
    return {
      ok: false,
      order: null,
      error: (e && e.message) || "Сервер CRM недоступен",
    };
  }
}

export async function fetchOrdersFromServer(password, { offset = 0, limit = 50 } = {}) {
  const params = new URLSearchParams({
    offset: String(offset),
    limit: String(limit),
  });
  const res = await fetch(`/api/orders?${params}`, {
    headers: { "X-Admin-Password": password || adminCredential() },
  });
  endedSession(res);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Не удалось загрузить заказы");
  }
  return res.json();
}

function catalogFallbackName(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `Catalog-${y}-${m}-${d}.pdf`;
}

function filenameFromDisposition(header) {
  const value = String(header || "");
  const plain = /filename="([^"]+)"/i.exec(value);
  return plain ? plain[1] : "";
}

async function downloadPdfFile(url, init, fallbackName) {
  let objectUrl = "";
  try {
    const res = await fetch(url, init);
    endedSession(res);
    const type = String(res.headers.get("Content-Type") || "").toLowerCase();
    if (!res.ok || !type.includes("application/pdf")) return { ok: false };
    const blob = await res.blob();
    if (!blob || blob.size < 5) return { ok: false };
    const filename = filenameFromDisposition(res.headers.get("Content-Disposition")) || fallbackName;
    objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    return { ok: true };
  } catch {
    return { ok: false };
  } finally {
    if (objectUrl) {
      const current = objectUrl;
      setTimeout(() => URL.revokeObjectURL(current), 2000);
    }
  }
}

export async function downloadCatalogPdf(password) {
  return downloadPdfFile(
    "/api/documents/catalog",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Password": password || adminCredential(),
      },
      body: JSON.stringify({ lang: "ru", currency: "kzt" }),
    },
    catalogFallbackName()
  );
}

function orderDocumentUrl(type, orderId) {
  const id = String(orderId || "").trim();
  const params = new URLSearchParams({ id, lang: "ru" });
  const paths = {
    invoice: "/api/documents/invoice",
    factura: "/api/documents/invoice-factura",
  };
  const path = paths[type] || "/api/documents/order";
  return { id, url: `${path}?${params}` };
}

export async function downloadOrderPdf(orderId, password) {
  const { id, url } = orderDocumentUrl("order", orderId);
  const safeId = id.replace(/[^A-Za-z0-9_-]/g, "") || "order";
  return downloadPdfFile(
    url,
    {
      method: "GET",
      headers: { "X-Admin-Password": password || adminCredential() },
    },
    `Order-${safeId}.pdf`
  );
}

export async function downloadInvoicePdf(orderId, password) {
  const { id, url } = orderDocumentUrl("invoice", orderId);
  const safeId = id.replace(/[^A-Za-z0-9_-]/g, "") || "order";
  return downloadPdfFile(
    url,
    {
      method: "GET",
      headers: { "X-Admin-Password": password || adminCredential() },
    },
    `Invoice-${safeId}.pdf`
  );
}

export async function downloadInvoiceFacturaPdf(orderId, password) {
  const { id, url } = orderDocumentUrl("factura", orderId);
  const safeId = id.replace(/[^A-Za-z0-9_-]/g, "") || "order";
  return downloadPdfFile(
    url,
    {
      method: "GET",
      headers: { "X-Admin-Password": password || adminCredential() },
    },
    `InvoiceFactura-${safeId}.pdf`
  );
}

export async function fetchOrganization(password) {
  const res = await fetch("/api/admin/organization", {
    headers: { "X-Admin-Password": password || adminCredential() },
  });
  endedSession(res);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Не удалось загрузить организацию");
  if (body == null) return null;
  return body;
}

export async function saveOrganization(payload, password) {
  const res = await fetch("/api/admin/organization", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Password": password || adminCredential(),
    },
    body: JSON.stringify(payload || {}),
  });
  endedSession(res);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Не удалось сохранить организацию");
  return body;
}

export async function fetchClientsFromServer(password, limit = 200) {
  const res = await fetch(`/api/orders?view=clients&limit=${encodeURIComponent(limit)}`, {
    headers: { "X-Admin-Password": password || adminCredential() },
  });
  endedSession(res);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Не удалось загрузить клиентов");
  }
  return res.json();
}

export async function updateOrderStatus(id, status, password) {
  const res = await fetch("/api/orders", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Password": password || adminCredential(),
    },
    body: JSON.stringify({ id, status }),
  });
  endedSession(res);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Не удалось обновить статус");
  }
  return res.json();
}

let pendingOrder = null;

export function forgetPendingOrder() {
  pendingOrder = null;
}

export function buildOrder(data, quote) {
  const lines = getCartLines("kzt");
  if (!lines.length) return null;

  const name = String(data.name || "").trim();
  const phoneRaw = String(data.phone || "").trim();
  const comment = String(data.comment || "").trim().slice(0, 500);
  const channel =
    String(data.channel || "whatsapp").trim().toLowerCase() === "telegram" ? "telegram" : "whatsapp";
  if (!name || !phoneRaw || !isValidPhone(phoneRaw)) return null;

  const phone = formatPhoneDisplay(phoneRaw);
  const currency = "kzt";
  const quotedFor = (line) =>
    quote && Array.isArray(quote.items)
      ? quote.items.find((item) => item.id === line.id && Number(item.qty) === line.qty)
      : null;
  const quoteMatches = Boolean(quote) && lines.every((line) => quotedFor(line));
  const key = JSON.stringify({
    name,
    phone,
    comment,
    channel,
    currency,
    lines: lines.map((line) => [line.id, line.qty]),
  });
  const order = {
    id: "o" + Date.now().toString(36),
    createdAt: new Date().toISOString(),
    name,
    phone,
    comment,
    currency,
    total: quoteMatches ? quote.grandTotalText : getCartTotalFormatted(currency),
    channel,
    status: "new",
    items: lines.map((line) => {
      const quoted = quoteMatches ? quotedFor(line) : null;
      return {
        id: line.id,
        name: line.name,
        unit: line.unit,
        qty: line.qty,
        price: quoted ? quoted.price : line.unitFormatted,
        lineTotal: quoted ? quoted.lineTotal : line.lineFormatted,
      };
    }),
  };
  if (pendingOrder && pendingOrder.key === key) {
    order.id = pendingOrder.id;
    order.createdAt = pendingOrder.createdAt;
  }
  pendingOrder = { key, id: order.id, createdAt: order.createdAt };
  return order;
}

export function commitOrder(order) {
  pendingOrder = null;
  saveOrder(order);
  clearCart();
  return order;
}

export function placeOrder(data, quote) {
  const order = buildOrder(data, quote);
  if (!order) return null;
  return commitOrder(order);
}

async function syncLocalOrders() {
  const local = getLocalOrders();
  for (const order of local) {
    const result = await persistOrderToServer(order);
    if (result.ok) continue;
    if (result.status && result.status < 500) continue;
    return;
  }
}

loadProductsFromServer().catch((err) => {
  console.error(err);
});
syncLocalOrders().catch(() => {});
