import { invoiceOrganizationError } from "../organization.js";
import { buildInvoiceFacturaData, esfRegistrationText } from "./buildInvoiceFacturaData.js";
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
  paintMarkedSection,
  paintRowFrame,
  paintRunHeader,
  paintWatermark,
  stampPageNumbers,
  textHeight,
} from "./documentChrome.js";
import { isAdminRequest, renderToBuffer } from "./engine.js";
import { formatCatalogDate, invoiceFacturaLabels } from "./labels.js";
import { parseOrderRequest } from "./orderTemplate.js";

const COLS = [
  { key: "index", width: 24, align: "left" },
  { key: "name", width: 149.28, align: "left" },
  { key: "qty", width: 42, align: "right" },
  { key: "unit", width: 36, align: "left" },
  { key: "price", width: 72, align: "right" },
  { key: "vat", width: 44, align: "center" },
  { key: "code", width: 44, align: "center" },
  { key: "sum", width: 88, align: "right" },
];

export function invoiceFacturaFileName(id) {
  return `InvoiceFactura-${id}.pdf`;
}

export function renderInvoiceFacturaPdf({ order, lang, root, now, seller, buyer, organization } = {}) {
  const labels = invoiceFacturaLabels(lang === "kk" ? "kk" : "ru");
  const view = buildInvoiceFacturaData(order, { now, seller, buyer, organization });
  if (!view.seller.name) {
    throw Object.assign(new Error("organization required"), { status: 500 });
  }
  const title = view.seller.isDemo ? labels.documentTitle : labels.title;
  return renderToBuffer((doc) => drawFactura(doc, view, labels, root), {
    title: `${title} ${view.document.accountingNumber}`,
    bufferPages: true,
  }).then((buffer) => ({
    buffer,
    filename: invoiceFacturaFileName(view.orderId),
  }));
}

export async function handleInvoiceFacturaPdfRequest({ method, searchParams, adminHeader, env, getOrderById, getOrganization, root, now }) {
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
  const buyer = facturaBuyerFromOrder(order);
  if (!buyer) return { status: 409, json: { error: "buyer requisites required" } };
  const pdf = await renderInvoiceFacturaPdf({ order, lang: parsed.lang, root, now, organization, buyer });
  return { status: 200, pdf };
}

function facturaBuyerFromOrder(order) {
  const bin = String(order && (order.buyerBin || order.binIin || "")).replace(/\D/g, "");
  const address = String(order && (order.buyerAddress || "")).trim();
  const name = String(order && (order.buyerName || "")).trim();
  if (!/^\d{12}$/.test(bin) || !address || !name) return null;
  return { name, binIin: bin, address };
}

function drawFactura(doc, view, labels, root) {
  const ctx = { doc, labels, view, root, y: 0, needTableHeader: false, tableOpen: false };
  openPage(ctx, true);
  drawNotice(ctx);
  drawGeneral(ctx);
  drawSeller(ctx);
  drawBuyer(ctx);
  drawBlankSections(ctx);
  ctx.needTableHeader = true;
  view.items.forEach((item, index) => drawItemRow(ctx, item, index === view.items.length - 1));
  if (!view.items.length && ctx.needTableHeader) {
    drawTableHeader(ctx, true);
    ctx.needTableHeader = false;
  }
  drawAfterTable(ctx);
  stampPageNumbers(doc);
}

function openPage(ctx, first) {
  const { doc, labels, view } = ctx;
  addPaperPage(doc);
  if (view.seller.isDemo || view.buyer.isDemo) paintWatermark(doc, labels.watermark);
  const issued = formatCatalogDate(new Date(view.document.issueDate));
  ctx.y = first
    ? paintFirstHeader(doc, {
        root: ctx.root,
        title: labels.title,
        number: `${labels.index} ${view.document.accountingNumber}`,
        date: issued,
      })
    : paintRunHeader(doc, { title: labels.title, number: `${labels.index} ${view.document.accountingNumber}` });
  if (!first) {
    if (view.seller.isDemo) ctx.y = paintBanner(doc, ctx.y, labels.demo) + 6;
    ctx.y = paintBanner(doc, ctx.y, labels.banner) + 8;
  }
  paintFooter(doc, labels.footer);
}

function drawNotice(ctx) {
  const { doc, labels, view } = ctx;
  if (view.seller.isDemo) ctx.y = paintBanner(doc, ctx.y, labels.demo) + 8;
  ctx.y = paintBanner(doc, ctx.y, labels.banner) + 12;
}

function drawGeneral(ctx) {
  const { labels, view } = ctx;
  sectionTitle(ctx, labels.sectionA);
  fact(ctx, labels.registration, esfRegistrationText(view.document, labels.notRegistered));
  fact(ctx, labels.accounting, view.document.accountingNumber);
  fact(ctx, labels.issueDate, formatCatalogDate(new Date(view.document.issueDate)));
  note(ctx, labels.issueNote);
  fact(ctx, labels.paperDate, missing(view.document.paperIssueDate, labels));
  fact(ctx, labels.turnoverDate, missing(view.document.turnoverDate, labels));
  fact(ctx, labels.documentType, labels.ordinary);
  fact(ctx, labels.corrected, labels.notMarked);
  fact(ctx, labels.additional, labels.notMarked);
}

function drawSeller(ctx) {
  const { labels, view } = ctx;
  const seller = view.seller;
  sectionTitle(ctx, labels.sectionB);
  fact(ctx, labels.name, seller.name);
  fact(ctx, labels.bin, seller.identifier);
  fact(ctx, labels.address, missing(seller.address, labels));
  fact(ctx, labels.country, missing(seller.countryCode, labels));
  fact(ctx, labels.vatDate, missing(seller.vatRegistrationData, labels));
  fact(ctx, labels.defaultVatRate, seller.defaultVatRate == null ? labels.notSpecified : String(seller.defaultVatRate));
  fact(ctx, labels.vatTreatment, missing(seller.defaultVatTreatment, labels));
  fact(ctx, labels.category, labels.notMarked);
  sectionTitle(ctx, labels.sectionB1);
  fact(ctx, labels.kbe, missing(seller.kbe, labels));
  fact(ctx, labels.iban, missing(seller.iban, labels));
  fact(ctx, labels.bic, missing(seller.bic, labels));
  fact(ctx, labels.bank, missing(seller.bankName, labels));
}

function drawBuyer(ctx) {
  const { labels, view } = ctx;
  const buyer = view.buyer;
  sectionTitle(ctx, labels.sectionC);
  fact(ctx, labels.name, buyer.name);
  fact(ctx, labels.binIin, buyer.identifier);
  fact(ctx, labels.address, missing(buyer.address, labels));
  fact(ctx, labels.country, missing(buyer.countryCode, labels));
  fact(ctx, labels.category, labels.notMarked);
  note(ctx, labels.buyerNote);
}

function drawBlankSections(ctx) {
  const { labels } = ctx;
  sectionTitle(ctx, labels.sectionD);
  note(ctx, labels.notSpecified);
  sectionTitle(ctx, labels.sectionE);
  note(ctx, labels.notSpecified);
  sectionTitle(ctx, labels.sectionF);
  note(ctx, labels.notSpecified);
}

function drawItemRow(ctx, item, isLast) {
  const { doc, labels } = ctx;
  const cells = {
    index: String(item.index).padStart(2, "0"),
    name: item.description,
    unit: item.unit,
    qty: item.quantity,
    price: item.unitPrice,
    sum: item.lineTotal,
    vat: item.vatRateLabel || labels.blankCell,
    code: labels.blankCell,
  };
  const rowH = itemRowHeight(doc, cells);
  const headerH = ctx.tableOpen ? 18 : 40;
  const follow = isLast ? 0 : 16;
  const needed = rowH + (ctx.needTableHeader ? headerH : 0) + follow;
  if (ctx.y + needed > LIMIT_Y && ctx.y > 90 && needed < LIMIT_Y - 100) {
    openPage(ctx, false);
    ctx.needTableHeader = true;
  }
  if (ctx.needTableHeader) {
    drawTableHeader(ctx, !ctx.tableOpen);
    ctx.needTableHeader = false;
    ctx.tableOpen = true;
  }
  paintRowFrame(doc, ctx.y, rowH, COLS, "#ffffff");
  let x = MARGIN;
  const top = ctx.y + 4;
  for (const col of COLS) {
    doc.fillColor(COLOR.ink).font(col.key === "sum" ? "Noto-Bold" : "Noto").fontSize(8);
    doc.text(cells[col.key], x + 3, top, {
      width: col.width - 6,
      align: col.align,
      lineGap: 1,
    });
    x += col.width;
  }
  ctx.y += rowH;
}

function itemRowHeight(doc, cells) {
  let height = 16;
  for (const col of COLS) {
    const font = col.key === "sum" ? "Noto-Bold" : "Noto";
    height = Math.max(height, textHeight(doc, cells[col.key] || " ", col.width - 6, font, 8, 1) + 8);
  }
  return height;
}

function drawTableHeader(ctx, withSection) {
  const { doc, labels } = ctx;
  if (withSection) sectionTitle(ctx, labels.sectionG);
  const titles = {
    index: labels.index,
    name: labels.item,
    unit: labels.unit,
    qty: labels.qty,
    price: labels.price,
    sum: labels.sum,
    vat: labels.vat,
    code: labels.code,
  };
  const headerH = 18;
  paintRowFrame(doc, ctx.y, headerH, COLS, COLOR.field, COLOR.ink);
  doc.fillColor(COLOR.ink).font("Noto-Bold").fontSize(6.5);
  let x = MARGIN;
  for (const col of COLS) {
    doc.text(String(titles[col.key] || "").toUpperCase(), x + 3, ctx.y + 5, {
      width: col.width - 6,
      align: col.align,
      lineBreak: false,
    });
    x += col.width;
  }
  ctx.y += headerH;
}

function drawAfterTable(ctx) {
  const { doc, labels, view } = ctx;
  ensure(ctx, 28);
  note(ctx, view.hasTaxSnapshot ? labels.priceNoteSnapshot : labels.priceNote);
  const vatValue = view.totals.vatAmount == null || view.totals.vatAmount === "" ? labels.notSpecified : String(view.totals.vatAmount);
  const box = 220;
  ensure(ctx, 46);
  ctx.y += 10;
  doc.fillColor(COLOR.mute).font("Noto").fontSize(8);
  doc.text(labels.orderTotal, MARGIN, ctx.y, { width: CONTENT_W, align: "right", lineBreak: false });
  ctx.y += 13;
  doc.fillColor(COLOR.ink).font("Noto-Bold").fontSize(14);
  doc.text(view.totals.orderTotal || labels.notSpecified, MARGIN + CONTENT_W - box, ctx.y, {
    width: box,
    align: "right",
    lineBreak: false,
  });
  const lineY = ctx.y + 18;
  doc.moveTo(MARGIN + CONTENT_W - 88, lineY).lineTo(MARGIN + CONTENT_W, lineY).lineWidth(1.4).strokeColor(COLOR.hot).stroke();
  ctx.y = lineY + 12;
  if (view.totals.amountWithoutVat) fact(ctx, labels.withoutVat, view.totals.amountWithoutVat);
  fact(ctx, labels.vatTotal, vatValue);
  sectionTitle(ctx, labels.sectionK);
  fact(ctx, labels.relatedOrder, view.orderId || labels.notSpecified);
  fact(ctx, labels.phone, view.orderPhone || labels.notSpecified);
  if (view.orderComment) fact(ctx, labels.comment, view.orderComment);
  sectionTitle(ctx, labels.sectionL);
  note(ctx, labels.noSignature);
  fact(ctx, labels.issuer, labels.notSpecified);
  ensure(ctx, 36);
  ctx.y = paintBanner(doc, ctx.y, labels.closing) + 8;
}

function sectionTitle(ctx, text) {
  ensure(ctx, 36);
  ctx.y += 8;
  ctx.y = paintMarkedSection(ctx.doc, ctx.y, text);
}

function fact(ctx, label, value) {
  const { doc } = ctx;
  const labelWidth = 214;
  const text = String(value || "");
  const height = measureLabelValue(doc, label, text, CONTENT_W, labelWidth);
  ensure(ctx, height);
  ctx.y = paintLabelValue(doc, MARGIN, ctx.y, label, text, CONTENT_W, labelWidth);
}

function note(ctx, text) {
  const { doc } = ctx;
  const inner = CONTENT_W - 12;
  doc.font("Noto").fontSize(8);
  const height = doc.heightOfString(text, { width: inner, lineGap: 1 });
  ensure(ctx, height + 8);
  doc.fillColor(COLOR.mute).text(text, MARGIN + 12, ctx.y + 2, { width: inner, lineGap: 1 });
  ctx.y += height + 8;
}

function ensure(ctx, height) {
  if (ctx.y + height <= LIMIT_Y) return;
  openPage(ctx, false);
}

function missing(value, labels) {
  const text = value == null ? "" : String(value).trim();
  return text || labels.notSpecified;
}
