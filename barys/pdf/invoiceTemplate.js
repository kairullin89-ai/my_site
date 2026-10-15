import { invoiceOrganizationError, organizationToInvoiceCompany } from "../organization.js";
import {
  COLOR,
  CONTENT_W,
  LIMIT_Y,
  MARGIN,
  addPaperPage,
  paintBanner,
  paintFirstHeader,
  paintFooter,
  measureLabelValue,
  paintLabelValue,
  paintRowFrame,
  paintRunHeader,
  paintWatermark,
  stampPageNumbers,
  textHeight,
} from "./documentChrome.js";
import { isAdminRequest, renderToBuffer } from "./engine.js";
import { formatCatalogDate, invoiceLabels } from "./labels.js";
import { parseOrderRequest } from "./orderTemplate.js";

const COLS = [
  { key: "index", width: 28, align: "left" },
  { key: "name", width: 207.28, align: "left" },
  { key: "qty", width: 48, align: "right" },
  { key: "unit", width: 40, align: "left" },
  { key: "price", width: 86, align: "right" },
  { key: "sum", width: 90, align: "right" },
];

export function invoiceFileName(id) {
  return `Invoice-${id}.pdf`;
}

export function invoiceNumber(id) {
  return `INV-${id}`;
}

export function printableInvoice(order, company, now = new Date()) {
  const source = order && typeof order === "object" ? order : {};
  const seller = company && typeof company === "object" ? company : null;
  const items = Array.isArray(source.items) ? source.items : [];
  const issued = now instanceof Date ? now : new Date();
  return {
    id: String(source.id || ""),
    number: invoiceNumber(String(source.id || "")),
    issuedAt: issued.toISOString(),
    createdAt: String(source.createdAt || ""),
    name: String(source.name || "").trim(),
    phone: String(source.phone || "").trim(),
    comment: String(source.comment || ""),
    showComment: Boolean(String(source.comment || "").trim()),
    total: String(source.total ?? ""),
    pricesIncludeVat: source.pricesIncludeVat === true,
    subtotalText: source.taxDataStatus === "SNAPSHOT" ? String(source.subtotalWithoutVatText || "") : "",
    taxLines: source.taxDataStatus === "SNAPSHOT" && Array.isArray(source.taxLines)
      ? source.taxLines.map((line) => ({
          caption: String(line.caption || ""),
          amount: String(line.vatText || ""),
        }))
      : [],
    isDemo: Boolean(seller && seller.isDemo === true),
    supplier: seller
      ? {
          name: String(seller.name || ""),
          bin: String(seller.bin || ""),
          iban: String(seller.iban || ""),
          bic: String(seller.bic || ""),
          bankName: String(seller.bankName || ""),
          kbe: String(seller.kbe || ""),
          address: String(seller.address || ""),
          phone: String(seller.phone || ""),
          email: String(seller.email || ""),
        }
      : null,
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

export async function handleInvoicePdfRequest({ method, searchParams, adminHeader, env, getOrderById, getOrganization, root, now }) {
  if (method !== "GET") return { status: 405, json: { error: "method not allowed" } };
  if (!isAdminRequest(env, adminHeader, null)) return { status: 401, json: { error: "unauthorized" } };
  const parsed = parseOrderRequest({
    id: searchParams ? searchParams.get("id") : "",
    lang: searchParams ? searchParams.get("lang") : "",
  });
  if (parsed.error) return { status: 400, json: { error: parsed.error } };
  const order = getOrderById(parsed.id);
  if (!order) return { status: 404, json: { error: "Order not found" } };
  const organization = typeof getOrganization === "function" ? getOrganization() : null;
  const missing = invoiceOrganizationError(organization);
  if (missing) return missing;
  const pdf = await renderInvoicePdf({
    order,
    lang: parsed.lang,
    root,
    now,
    company: organizationToInvoiceCompany(organization),
  });
  return { status: 200, pdf };
}

export function renderInvoicePdf({ order, lang, root, now, company } = {}) {
  const seller = company && typeof company === "object" ? company : null;
  if (!seller) {
    throw Object.assign(new Error("organization required"), { status: 500 });
  }
  const labels = invoiceLabels(lang === "kk" ? "kk" : "ru");
  const view = printableInvoice(order, seller, now);
  return renderToBuffer((doc) => drawInvoice(doc, view, labels, root), {
    title: view.isDemo ? labels.documentTitle : labels.title,
    bufferPages: true,
  }).then((buffer) => ({
    buffer,
    filename: invoiceFileName(view.id),
  }));
}

function drawInvoice(doc, view, labels, root) {
  const ctx = { doc, labels, view, root, y: 0, needTableHeader: true };
  openPage(ctx, true);
  drawParties(ctx);
  drawPayment(ctx);
  drawBasis(ctx);
  view.items.forEach((item, index) => drawItemRow(ctx, item, index === view.items.length - 1));
  if (!view.items.length) drawTableHeader(ctx);
  drawTotal(ctx);
  if (view.showComment) drawComment(ctx);
  drawSigns(ctx);
  stampPageNumbers(doc);
}

function openPage(ctx, first) {
  const { doc, labels, view } = ctx;
  addPaperPage(doc);
  if (view.isDemo) paintWatermark(doc, labels.watermark);
  const issued = formatCatalogDate(new Date(view.issuedAt));
  ctx.y = first
    ? paintFirstHeader(doc, { root: ctx.root, title: labels.title, number: `${labels.index} ${view.number}`, date: issued })
    : paintRunHeader(doc, { title: labels.title, number: `${labels.index} ${view.number}` });
  if (view.isDemo) {
    ctx.y = paintBanner(doc, ctx.y, labels.demo) + (first ? 14 : 8);
  }
  const supplier = view.supplier || {};
  paintFooter(doc, [supplier.phone, supplier.email].filter(Boolean).join("    "));
}

function drawParties(ctx) {
  const { doc, labels, view } = ctx;
  const gap = 12;
  const colW = (CONTENT_W - gap) / 2;
  const supplier = view.supplier;
  const leftFacts = [
    [labels.bin, supplier.bin],
    [labels.address, supplier.address],
    [labels.phone, supplier.phone],
    [labels.email, supplier.email],
  ];
  const rightFacts = [[labels.phone, view.phone]];
  const leftH = partyHeight(doc, supplier.name, leftFacts, colW);
  const rightH = partyHeight(doc, view.name || "—", rightFacts, colW);
  const height = Math.max(leftH, rightH);
  if (ctx.y + height > LIMIT_Y && height <= LIMIT_Y - 80) openPage(ctx, false);
  const top = ctx.y;
  paintParty(doc, MARGIN, top, colW, height, labels.supplier, supplier.name, leftFacts);
  paintParty(doc, MARGIN + colW + gap, top, colW, height, labels.buyer, view.name || "—", rightFacts);
  ctx.y = top + height + 14;
}

function partyHeight(doc, name, facts, width) {
  const inner = width - 20;
  let height = 28 + textHeight(doc, name || "—", inner, "Noto-Bold", 10.5, 1) + 8;
  for (const [, value] of facts) height += factLineHeight(doc, value, inner);
  return height + 8;
}

function factLineHeight(doc, value, width) {
  return Math.max(12, textHeight(doc, value || "—", width - 72, "Noto", 8.5, 1)) + 5;
}

function paintParty(doc, x, y, width, height, title, name, facts) {
  doc.save();
  doc.roundedRect(x, y, width, height, 3).lineWidth(0.8).strokeColor(COLOR.line).stroke();
  doc.rect(x, y, width, 2.5).fill(COLOR.steel);
  doc.restore();
  doc.fillColor(COLOR.steel).font("Noto-Bold").fontSize(8);
  doc.text(title, x + 10, y + 10, { width: width - 20, characterSpacing: 0.7, lineBreak: false });
  const inner = width - 20;
  let cursor = y + 26;
  doc.fillColor(COLOR.ink).font("Noto-Bold").fontSize(10.5);
  const nameHeight = doc.heightOfString(name || "—", { width: inner, lineGap: 1 });
  doc.text(name || "—", x + 10, cursor, { width: inner, lineGap: 1 });
  cursor += nameHeight + 6;
  for (const [label, value] of facts) cursor = paintFactLine(doc, x + 10, cursor, inner, label, value);
  return cursor;
}

function paintFactLine(doc, x, y, width, label, value) {
  const labelW = 72;
  const text = value || "—";
  const rowH = factLineHeight(doc, text, width);
  doc.fillColor(COLOR.mute).font("Noto").fontSize(8);
  doc.text(label, x, y, { width: labelW - 6, lineBreak: false });
  doc.fillColor(COLOR.ink).font("Noto").fontSize(8.5);
  doc.text(text, x + labelW, y, { width: width - labelW, lineGap: 1 });
  return y + rowH;
}

function drawPayment(ctx) {
  const { doc, labels, view } = ctx;
  const supplier = view.supplier;
  const cells = [
    [labels.bank, supplier.bankName],
    [labels.kbe, supplier.kbe],
    [labels.iban, supplier.iban],
    [labels.bic, supplier.bic],
  ];
  const colW = CONTENT_W / 2;
  const rowHeights = [0, 1].map((row) => {
    const left = cells[row * 2];
    const right = cells[row * 2 + 1];
    return Math.max(cellHeight(doc, left[1], colW - 16), cellHeight(doc, right[1], colW - 16));
  });
  const blockH = rowHeights[0] + rowHeights[1];
  if (ctx.y + blockH + 18 > LIMIT_Y) openPage(ctx, false);
  doc.fillColor(COLOR.steel).font("Noto-Bold").fontSize(8);
  doc.text(labels.payment, MARGIN, ctx.y, { characterSpacing: 0.6, lineBreak: false });
  const top = ctx.y + 14;
  doc.save();
  doc.rect(MARGIN, top, CONTENT_W, blockH).lineWidth(0.8).strokeColor(COLOR.line).stroke();
  doc.moveTo(MARGIN, top + rowHeights[0]).lineTo(MARGIN + CONTENT_W, top + rowHeights[0]).stroke();
  doc.moveTo(MARGIN + colW, top).lineTo(MARGIN + colW, top + blockH).stroke();
  doc.restore();
  let y = top;
  for (let row = 0; row < 2; row += 1) {
    paintPayCell(doc, MARGIN, y, colW, cells[row * 2]);
    paintPayCell(doc, MARGIN + colW, y, colW, cells[row * 2 + 1]);
    y += rowHeights[row];
  }
  ctx.y = top + blockH + 14;
}

function cellHeight(doc, value, width) {
  return 22 + textHeight(doc, value || "—", width, "Noto", 9.5, 1);
}

function paintPayCell(doc, x, y, width, cell) {
  doc.fillColor(COLOR.mute).font("Noto").fontSize(7.5);
  doc.text(String(cell[0] || "").toUpperCase(), x + 8, y + 5, { width: width - 16, lineBreak: false });
  doc.fillColor(COLOR.ink).font("Noto").fontSize(9.5);
  doc.text(cell[1] || "—", x + 8, y + 16, { width: width - 16, lineGap: 1 });
}

function drawBasis(ctx) {
  const { doc, labels, view } = ctx;
  const rows = [
    [labels.basis, `${labels.order} ${labels.index} ${view.id}`],
    [labels.orderDate, orderDateLabel(view.createdAt)],
  ];
  const height = rows.reduce((sum, row) => sum + measureLabelValue(doc, row[0], row[1], CONTENT_W, 150), 0);
  if (ctx.y + height > LIMIT_Y) openPage(ctx, false);
  for (const [label, value] of rows) ctx.y = paintLabelValue(doc, MARGIN, ctx.y, label, value, CONTENT_W, 150);
  ctx.y += 10;
}

function drawItemRow(ctx, item, isLast) {
  const { doc } = ctx;
  const cells = {
    index: String(item.index).padStart(2, "0"),
    name: item.name,
    qty: item.qty,
    unit: item.unit,
    price: item.price,
    sum: item.lineTotal,
  };
  const rowH = itemRowHeight(doc, cells);
  const headerH = 20;
  const follow = isLast ? 0 : 18;
  const needed = rowH + (ctx.needTableHeader ? headerH : 0) + follow;
  if (ctx.y + needed > LIMIT_Y && ctx.y > 90 && needed < LIMIT_Y - 100) {
    openPage(ctx, false);
    ctx.needTableHeader = true;
  }
  if (ctx.needTableHeader) {
    drawTableHeader(ctx);
    ctx.needTableHeader = false;
  }
  paintRowFrame(doc, ctx.y, rowH, COLS, "#ffffff");
  let x = MARGIN;
  const top = ctx.y + 5;
  for (const col of COLS) {
    doc.fillColor(COLOR.ink).font(col.key === "sum" ? "Noto-Bold" : "Noto").fontSize(9);
    doc.text(cells[col.key], x + 4, top, {
      width: col.width - 8,
      align: col.align,
      lineGap: 1,
    });
    x += col.width;
  }
  ctx.y += rowH;
}

function itemRowHeight(doc, cells) {
  let height = 18;
  for (const col of COLS) {
    const font = col.key === "sum" ? "Noto-Bold" : "Noto";
    height = Math.max(height, textHeight(doc, cells[col.key] || " ", col.width - 8, font, 9, 1) + 10);
  }
  return height;
}

function drawTableHeader(ctx) {
  const { doc, labels } = ctx;
  const titles = {
    index: labels.index,
    name: labels.item,
    qty: labels.qty,
    unit: labels.unit,
    price: labels.price,
    sum: labels.sum,
  };
  const headerH = 20;
  paintRowFrame(doc, ctx.y, headerH, COLS, COLOR.field, COLOR.ink);
  doc.fillColor(COLOR.ink).font("Noto-Bold").fontSize(7.5);
  let x = MARGIN;
  for (const col of COLS) {
    doc.text(String(titles[col.key] || "").toUpperCase(), x + 4, ctx.y + 6, {
      width: col.width - 8,
      align: col.align,
      lineBreak: false,
    });
    x += col.width;
  }
  ctx.y += headerH;
}

function drawTotal(ctx) {
  const { doc, labels, view } = ctx;
  const lines = Array.isArray(view.taxLines) ? view.taxLines : [];
  const box = 220;
  ensure(ctx, 48 + (view.subtotalText && !view.pricesIncludeVat ? 16 : 0) + lines.length * 16);
  ctx.y += 12;
  if (view.subtotalText && !view.pricesIncludeVat) {
    drawMoneyLine(ctx, labels.withoutVat, view.subtotalText);
  }
  for (const line of lines) {
    const caption = view.pricesIncludeVat ? `${labels.includedVat} ${line.caption}` : line.caption;
    drawMoneyLine(ctx, caption, line.amount);
  }
  doc.fillColor(COLOR.mute).font("Noto").fontSize(8);
  doc.text(labels.total, MARGIN, ctx.y, { width: CONTENT_W, align: "right", lineBreak: false });
  ctx.y += 14;
  doc.fillColor(COLOR.ink).font("Noto-Bold").fontSize(16);
  doc.text(view.total || "—", MARGIN + CONTENT_W - box, ctx.y, { width: box, align: "right", lineBreak: false });
  const lineY = ctx.y + 20;
  doc.moveTo(MARGIN + CONTENT_W - 92, lineY).lineTo(MARGIN + CONTENT_W, lineY).lineWidth(1.5).strokeColor(COLOR.hot).stroke();
  ctx.y = lineY + 16;
}

function drawMoneyLine(ctx, label, amount) {
  const { doc } = ctx;
  const box = 230;
  doc.fillColor(COLOR.mute).font("Noto").fontSize(8);
  doc.text(label, MARGIN, ctx.y, { width: CONTENT_W - box - 8, align: "right", lineBreak: false });
  doc.fillColor(COLOR.ink).font("Noto").fontSize(9);
  doc.text(amount || "—", MARGIN + CONTENT_W - box, ctx.y - 1, { width: box, align: "right", lineBreak: false });
  ctx.y += 16;
}

function drawSigns(ctx) {
  const { doc, labels } = ctx;
  const blockH = 36;
  ensure(ctx, blockH);
  const y = ctx.y + 8;
  const half = CONTENT_W / 2;
  paintSign(doc, MARGIN, y, half - 18, labels.director);
  paintSign(doc, MARGIN + half + 6, y, half - 18, labels.accountant);
  ctx.y = y + 28;
}

function paintSign(doc, x, y, width, label) {
  doc.fillColor(COLOR.mute).font("Noto").fontSize(8);
  doc.text(label, x, y, { lineBreak: false });
  const labelW = Math.min(doc.widthOfString(label) + 10, width - 48);
  doc.moveTo(x + labelW, y + 9).lineTo(x + width, y + 9).lineWidth(0.6).strokeColor(COLOR.mute).stroke();
}

function drawComment(ctx) {
  const { doc, labels, view } = ctx;
  const text = String(view.comment || "").trim();
  if (!text) return;
  ensure(ctx, 36);
  doc.fillColor(COLOR.steel).font("Noto-Bold").fontSize(8);
  doc.text(String(labels.comment || "").toUpperCase(), MARGIN, ctx.y, { characterSpacing: 0.4, lineBreak: false });
  ctx.y += 14;
  let rest = text;
  while (rest) {
    const room = LIMIT_Y - ctx.y;
    if (room < 24) {
      openPage(ctx, false);
      continue;
    }
    const chunk = takeChunk(doc, rest, CONTENT_W, room);
    doc.fillColor(COLOR.ink).font("Noto").fontSize(10);
    const height = doc.heightOfString(chunk.head, { width: CONTENT_W, lineGap: 2 });
    doc.text(chunk.head, MARGIN, ctx.y, { width: CONTENT_W, lineGap: 2 });
    ctx.y += height + 8;
    rest = chunk.rest;
  }
}

function ensure(ctx, height) {
  if (ctx.y + height <= LIMIT_Y) return;
  openPage(ctx, false);
}

function orderDateLabel(value) {
  const stamp = new Date(value);
  if (!value || Number.isNaN(stamp.getTime())) return String(value || "").trim();
  return formatCatalogDate(stamp);
}

function takeChunk(doc, text, width, maxHeight) {
  doc.font("Noto").fontSize(10);
  if (doc.heightOfString(text, { width, lineGap: 2 }) <= maxHeight) return { head: text, rest: "" };
  let low = 1;
  let high = text.length;
  let best = 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const height = doc.heightOfString(text.slice(0, mid), { width, lineGap: 2 });
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
