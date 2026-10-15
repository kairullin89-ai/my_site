import { isAdminRequest, renderToBuffer, resolveLogo } from "./engine.js";
import { formatCatalogDate, orderLabels } from "./labels.js";

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const PAPER = "#f2f1ec";
const INK = "#15171b";
const MUTE = "#5a6068";
const HOT = "#e63b00";
const LINE = "#c9cac4";
const MARGIN = 46;
const CONTENT_W = PAGE_W - MARGIN * 2;
const LIMIT_Y = PAGE_H - 86;
const RUN_TOP = 70;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const COLS = [
  { key: "index", width: 28 },
  { key: "name", width: 210 },
  { key: "qty", width: 74 },
  { key: "unit", width: 44 },
  { key: "price", width: 72 },
  { key: "sum", width: 71 },
];

export function parseOrderRequest({ id, lang } = {}) {
  const language = lang == null || lang === "" ? "ru" : String(lang);
  if (language !== "ru" && language !== "kk") return { error: "invalid lang" };
  const key = String(id ?? "").trim();
  if (!ID_RE.test(key)) return { error: "invalid id" };
  return { id: key, lang: language };
}

export function orderFileName(id) {
  return `Order-${id}.pdf`;
}

export function printableOrder(order) {
  const source = order && typeof order === "object" ? order : {};
  const items = Array.isArray(source.items) ? source.items : [];
  return {
    id: String(source.id || ""),
    createdAt: String(source.createdAt || ""),
    name: String(source.name || "").trim(),
    phone: String(source.phone || "").trim(),
    comment: String(source.comment || ""),
    showComment: Boolean(String(source.comment || "").trim()),
    total: String(source.total ?? ""),
    channel: String(source.channel || ""),
    status: String(source.status || ""),
    items: items.map((item, index) => ({
      index: index + 1,
      name: String(item && item.name ? item.name : ""),
      qty: item && item.qty != null ? String(item.qty) : "",
      unit: String(item && item.unit ? item.unit : ""),
      price: String(item && item.price != null ? item.price : ""),
      lineTotal: String(item && item.lineTotal != null ? item.lineTotal : ""),
    })),
  };
}

export async function handleOrderPdfRequest({ method, searchParams, adminHeader, env, getOrderById, root }) {
  if (method !== "GET") return { status: 405, json: { error: "method not allowed" } };
  if (!isAdminRequest(env, adminHeader, null)) return { status: 401, json: { error: "unauthorized" } };
  const parsed = parseOrderRequest({
    id: searchParams ? searchParams.get("id") : "",
    lang: searchParams ? searchParams.get("lang") : "",
  });
  if (parsed.error) return { status: 400, json: { error: parsed.error } };
  const order = getOrderById(parsed.id);
  if (!order) return { status: 404, json: { error: "Order not found" } };
  const pdf = await renderOrderPdf({ order, lang: parsed.lang, root });
  return { status: 200, pdf };
}

export function renderOrderPdf({ order, lang, root }) {
  const labels = orderLabels(lang === "kk" ? "kk" : "ru");
  const view = printableOrder(order);
  return renderToBuffer((doc) => drawOrder(doc, view, labels, root), { title: labels.documentTitle }).then((buffer) => ({
    buffer,
    filename: orderFileName(view.id),
  }));
}

function drawOrder(doc, view, labels, root) {
  const ctx = {
    doc,
    labels,
    view,
    root,
    page: 0,
    y: 0,
    needTableHeader: false,
  };
  openPage(ctx, true);
  drawIdentity(ctx);
  ctx.needTableHeader = true;
  for (const item of view.items) drawItemRow(ctx, item);
  drawTotal(ctx);
  if (view.showComment) drawComment(ctx);
  drawFacts(ctx);
}

function openPage(ctx, first) {
  const { doc } = ctx;
  doc.addPage({ size: "A4", margin: 0 });
  doc.rect(0, 0, PAGE_W, PAGE_H).fill(PAPER);
  ctx.page += 1;
  drawChrome(ctx, first);
  ctx.y = first ? 92 : RUN_TOP;
}

function drawChrome(ctx, first) {
  const { doc, labels, view } = ctx;
  if (first) {
    const logo = ctx.root ? resolveLogo(ctx.root) : "";
    if (logo) {
      try {
        doc.image(logo, MARGIN, 36, { fit: [36, 36], align: "center", valign: "center" });
      } catch {
        /* the request still prints without a logo */
      }
    }
    doc.fillColor(INK).font("Noto-Bold").fontSize(13);
    doc.text("БАРЫС", logo ? MARGIN + 46 : MARGIN, 46, {
      characterSpacing: 2.2,
      lineBreak: false,
    });
  } else {
    doc.fillColor(MUTE).font("Noto").fontSize(8.5);
    doc.text("БАРЫС", MARGIN, 38, { characterSpacing: 1.1, lineBreak: false });
    doc.text(`${labels.index} ${view.id}`, MARGIN, 38, {
      width: CONTENT_W,
      align: "right",
      lineBreak: false,
    });
  }
  doc
    .moveTo(MARGIN, PAGE_H - 68)
    .lineTo(MARGIN + CONTENT_W, PAGE_H - 68)
    .lineWidth(0.6)
    .strokeColor(LINE)
    .stroke();
  const folio = String(ctx.page).padStart(2, "0");
  doc.fillColor(INK).font("Noto").fontSize(10);
  doc.text(folio, MARGIN, PAGE_H - 50, { width: CONTENT_W, align: "right", lineBreak: false });
  doc.fillColor(MUTE).font("Noto").fontSize(8.5);
  doc.text("БАРЫС", MARGIN, PAGE_H - 48, { characterSpacing: 1, lineBreak: false });
}

function drawIdentity(ctx) {
  const { doc, labels, view } = ctx;
  const titleSize = fitSize(doc, labels.title, "Noto-Bold", 20, CONTENT_W, 0.4);
  doc.fillColor(INK).font("Noto-Bold").fontSize(titleSize);
  doc.text(labels.title, MARGIN, ctx.y, { width: CONTENT_W, characterSpacing: 0.4, lineBreak: false });
  ctx.y += titleSize + 8;
  doc.moveTo(MARGIN, ctx.y).lineTo(MARGIN + 56, ctx.y).lineWidth(1.5).strokeColor(HOT).stroke();
  ctx.y += 16;
  doc.fillColor(INK).font("Noto-Bold").fontSize(12);
  doc.text(`${labels.index} ${view.id}`, MARGIN, ctx.y, { lineBreak: false });
  ctx.y += 18;
  doc.fillColor(MUTE).font("Noto").fontSize(10);
  doc.text(`${labels.date}: ${orderDateLabel(view.createdAt)}`, MARGIN, ctx.y, { lineBreak: false });
  ctx.y += 22;
  rule(ctx);
  ctx.y += 16;
  doc.fillColor(MUTE).font("Noto").fontSize(8.5);
  doc.text(labels.client, MARGIN, ctx.y, { characterSpacing: 1.4, lineBreak: false });
  ctx.y += 16;
  fieldRow(ctx, labels.name, view.name || "—");
  fieldRow(ctx, labels.phone, view.phone || "—");
  ctx.y += 8;
  rule(ctx);
  ctx.y += 14;
}

function fieldRow(ctx, label, value) {
  const { doc } = ctx;
  doc.fillColor(MUTE).font("Noto").fontSize(10);
  doc.text(label, MARGIN, ctx.y, { width: 88, lineBreak: false });
  doc.fillColor(INK).font("Noto").fontSize(11);
  const height = doc.heightOfString(value, { width: CONTENT_W - 96, lineGap: 2 });
  doc.text(value, MARGIN + 96, ctx.y, { width: CONTENT_W - 96, lineGap: 2 });
  ctx.y += Math.max(16, height) + 6;
}

function drawItemRow(ctx, item) {
  const { doc, labels } = ctx;
  doc.font("Noto").fontSize(10);
  const nameH = doc.heightOfString(item.name || " ", { width: colWidth("name") - 8, lineGap: 1 });
  const rowH = Math.max(18, nameH) + 10;
  const headerH = 20;
  if (ctx.y + rowH + (ctx.needTableHeader ? headerH : 0) > LIMIT_Y) {
    openPage(ctx, false);
    ctx.needTableHeader = true;
  }
  if (ctx.needTableHeader) {
    drawTableHeader(ctx, labels);
    ctx.needTableHeader = false;
  }
  const top = ctx.y + 4;
  const cells = {
    index: String(item.index),
    name: item.name,
    qty: item.qty,
    unit: item.unit,
    price: item.price,
    sum: item.lineTotal,
  };
  let x = MARGIN;
  for (const col of COLS) {
    const align = col.key === "name" || col.key === "unit" || col.key === "index" ? "left" : "right";
    doc.fillColor(INK).font(col.key === "name" ? "Noto" : "Noto").fontSize(10);
    doc.text(cells[col.key], x + (align === "left" ? 0 : 0), top, {
      width: col.width - 8,
      align,
      lineGap: 1,
    });
    x += col.width;
  }
  ctx.y += rowH;
  doc
    .moveTo(MARGIN, ctx.y)
    .lineTo(MARGIN + CONTENT_W, ctx.y)
    .lineWidth(0.4)
    .strokeColor(LINE)
    .stroke();
}

function drawTableHeader(ctx, labels) {
  const { doc } = ctx;
  const titles = {
    index: labels.index,
    name: labels.item,
    qty: labels.qty,
    unit: labels.unit,
    price: labels.price,
    sum: labels.sum,
  };
  doc.fillColor(MUTE).font("Noto").fontSize(8);
  let x = MARGIN;
  for (const col of COLS) {
    const align = col.key === "name" || col.key === "unit" || col.key === "index" ? "left" : "right";
    doc.text(titles[col.key], x, ctx.y, { width: col.width - 8, align, lineBreak: false });
    x += col.width;
  }
  ctx.y += 14;
  doc
    .moveTo(MARGIN, ctx.y)
    .lineTo(MARGIN + CONTENT_W, ctx.y)
    .lineWidth(0.8)
    .strokeColor(INK)
    .stroke();
  ctx.y += 6;
}

function drawTotal(ctx) {
  ensure(ctx, 36, false);
  const { doc, labels, view } = ctx;
  ctx.y += 8;
  doc.fillColor(MUTE).font("Noto").fontSize(9);
  doc.text(labels.total, MARGIN, ctx.y + 2, { width: CONTENT_W - 180, align: "right", lineBreak: false });
  doc.fillColor(HOT).font("Noto-Bold").fontSize(16);
  doc.text(view.total || "—", MARGIN + CONTENT_W - 170, ctx.y, {
    width: 170,
    align: "right",
    lineBreak: false,
  });
  ctx.y += 28;
}

function drawComment(ctx) {
  const { doc, labels, view } = ctx;
  const text = String(view.comment || "").trim();
  if (!text) return;
  ensure(ctx, 36, false);
  doc.fillColor(MUTE).font("Noto").fontSize(8.5);
  doc.text(labels.comment, MARGIN, ctx.y, { characterSpacing: 1.2, lineBreak: false });
  ctx.y += 16;
  let rest = text;
  while (rest) {
    const room = LIMIT_Y - ctx.y;
    if (room < 24) {
      openPage(ctx, false);
      continue;
    }
    const chunk = takeChunk(doc, rest, CONTENT_W, room, 11, 3);
    doc.fillColor(INK).font("Noto").fontSize(11);
    const height = doc.heightOfString(chunk.head, { width: CONTENT_W, lineGap: 3 });
    doc.text(chunk.head, MARGIN, ctx.y, { width: CONTENT_W, lineGap: 3 });
    ctx.y += height + 8;
    rest = chunk.rest;
  }
}

function drawFacts(ctx) {
  ensure(ctx, 42, false);
  const { doc, labels, view } = ctx;
  ctx.y += 6;
  labeledFact(ctx, labels.status, statusText(labels, view.status));
  labeledFact(ctx, labels.channel, channelText(labels, view.channel));
}

function labeledFact(ctx, label, value) {
  const { doc } = ctx;
  const caption = `${label}:`;
  doc.font("Noto").fontSize(10);
  const labelWidth = doc.widthOfString(caption) + 10;
  doc.fillColor(MUTE).text(caption, MARGIN, ctx.y, { lineBreak: false });
  doc.fillColor(INK).font("Noto").fontSize(11);
  doc.text(value, MARGIN + labelWidth, ctx.y, { width: CONTENT_W - labelWidth, lineBreak: false });
  ctx.y += 18;
}

function ensure(ctx, height) {
  if (ctx.y + height <= LIMIT_Y) return;
  openPage(ctx, false);
}

function rule(ctx) {
  ctx.doc
    .moveTo(MARGIN, ctx.y)
    .lineTo(MARGIN + CONTENT_W, ctx.y)
    .lineWidth(0.6)
    .strokeColor(LINE)
    .stroke();
}

function colWidth(key) {
  const found = COLS.find((col) => col.key === key);
  return found ? found.width : 40;
}

function statusText(labels, status) {
  if (status === "done") return labels.statusDone;
  if (status === "cancelled") return labels.statusCancelled;
  if (status === "new") return labels.statusNew;
  return String(status || "");
}

function channelText(labels, channel) {
  if (channel === "telegram") return labels.channelTelegram;
  if (channel === "whatsapp") return labels.channelWhatsapp;
  return String(channel || "");
}

function orderDateLabel(value) {
  const stamp = new Date(value);
  if (!value || Number.isNaN(stamp.getTime())) return String(value || "").trim();
  return formatCatalogDate(stamp);
}

function fitSize(doc, value, font, size, maxWidth, spacing) {
  let current = size;
  doc.font(font);
  while (current > 11) {
    doc.fontSize(current);
    if (doc.widthOfString(value, { characterSpacing: spacing }) <= maxWidth) return current;
    current -= 0.5;
  }
  return current;
}

function takeChunk(doc, text, width, maxHeight, size, lineGap) {
  doc.font("Noto").fontSize(size);
  if (doc.heightOfString(text, { width, lineGap }) <= maxHeight) return { head: text, rest: "" };
  let low = 1;
  let high = text.length;
  let best = 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const height = doc.heightOfString(text.slice(0, mid), { width, lineGap });
    if (height <= maxHeight) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  let cut = best;
  const window = text.slice(0, best);
  const breakAt = Math.max(window.lastIndexOf("\n"), window.lastIndexOf(" "));
  if (breakAt > 24) cut = breakAt + 1;
  const head = text.slice(0, cut).trimEnd() || text.slice(0, 1);
  const rest = text.slice(head.length).trimStart();
  return { head, rest };
}
